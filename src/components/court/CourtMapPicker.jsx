import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MapPin, Star, X } from "lucide-react";
import useBodyScrollLock from "../../hooks/useBodyScrollLock.js";
import { loadNaverMapsSdk } from "../../lib/naverAddress.js";
import { getCourtAddress, getCourtCoordinate, isCourtInRegion } from "../../lib/courts.js";
import Button from "../common/Button.jsx";
import ModalShell from "../common/ModalShell.jsx";

const DISTRICT_OVERVIEW_ZOOM = 13;
const WIDE_DISTRICT_OVERVIEW_ZOOM = 14;
const WIDE_MAP_MIN_WIDTH = 720;
const DEFAULT_OVERVIEW_ZOOM = 12;

function getClusterCellSize(zoom = 12) {
  if (zoom <= 9) return 0.35;
  if (zoom <= 10) return 0.18;
  if (zoom <= 11) return 0.09;
  if (zoom <= 12) return 0.045;
  if (zoom <= 13) return 0.022;
  if (zoom <= 14) return 0.011;
  if (zoom <= 15) return 0.005;
  if (zoom <= 16) return 0.002;
  if (zoom <= 17) return 0.0007;
  return 0.00008;
}

function clusterCourts(courts = [], zoom = 12) {
  const cellSize = getClusterCellSize(zoom);
  const groups = new Map();

  courts.forEach((court) => {
    const coordinate = getCourtCoordinate(court);
    if (!coordinate) return;
    const key = `${Math.floor(coordinate.lat / cellSize)}:${Math.floor(coordinate.lng / cellSize)}`;
    const group = groups.get(key) ?? [];
    group.push({ court, coordinate });
    groups.set(key, group);
  });

  return [...groups.values()].map((items) => ({
    items,
    lat: items.reduce((sum, item) => sum + item.coordinate.lat, 0) / items.length,
    lng: items.reduce((sum, item) => sum + item.coordinate.lng, 0) / items.length,
  }));
}

function getInitialViewport(courts = [], selectedCourt, currentRegion = "", mapWidth = 0) {
  const selectedCoordinate = getCourtCoordinate(selectedCourt);
  const regionalCourts = courts.filter((court) => isCourtInRegion(court, currentRegion));
  const focusCourts = selectedCoordinate ? [selectedCourt] : regionalCourts.length ? regionalCourts : courts;
  const coordinates = focusCourts.map(getCourtCoordinate).filter(Boolean);
  const fallback = selectedCoordinate ?? getCourtCoordinate(courts[0]) ?? { lat: 37.5665, lng: 126.978 };
  const districtZoom = mapWidth >= WIDE_MAP_MIN_WIDTH ? WIDE_DISTRICT_OVERVIEW_ZOOM : DISTRICT_OVERVIEW_ZOOM;

  if (!coordinates.length) return { ...fallback, zoom: DEFAULT_OVERVIEW_ZOOM };
  return {
    lat: coordinates.reduce((sum, coordinate) => sum + coordinate.lat, 0) / coordinates.length,
    lng: coordinates.reduce((sum, coordinate) => sum + coordinate.lng, 0) / coordinates.length,
    zoom: regionalCourts.length || selectedCoordinate ? districtZoom : DEFAULT_OVERVIEW_ZOOM,
  };
}

function makeMarkerElement(group, activeCourtId) {
  const element = document.createElement("button");
  const isCluster = group.items.length > 1;
  const court = group.items[0]?.court;
  element.type = "button";
  element.className = [
    "court-map-marker",
    isCluster ? "is-cluster" : "is-court",
    !isCluster && court?.id === activeCourtId ? "is-active" : "",
  ].filter(Boolean).join(" ");
  element.textContent = isCluster ? String(group.items.length) : "1";
  element.setAttribute("aria-label", isCluster ? `등록 구장 ${group.items.length}개 확대` : `${court?.name ?? "구장"} 확인`);
  return element;
}

function removeMapListener(maps, listener) {
  if (!listener) return;
  try {
    maps.Event.removeListener(listener);
  } catch {
    // Naver Maps can invalidate a listener before React runs effect cleanup.
  }
}

function detachMapMarker(marker) {
  try {
    marker?.setMap?.(null);
  } catch {
    // A failed Naver Maps initialization can leave partially initialized markers.
  }
}

export default function CourtMapPicker({
  open,
  courts = [],
  selectedCourt = null,
  currentRegion = "",
  loading = false,
  loadError = "",
  onSelect,
  onClose,
}) {
  const mapElementRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const markerListenersRef = useRef([]);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [mapVersion, setMapVersion] = useState(0);
  const [mapRetrySequence, setMapRetrySequence] = useState(0);
  const [candidateId, setCandidateId] = useState(getCourtCoordinate(selectedCourt) ? selectedCourt?.id ?? "" : "");
  const [clusterCourtIds, setClusterCourtIds] = useState([]);
  useBodyScrollLock(open);

  const coordinateCourts = useMemo(
    () => courts.filter((court) => court?.id && getCourtCoordinate(court)),
    [courts],
  );
  const mappedCourts = useMemo(() => {
    const regionalCourts = coordinateCourts.filter((court) => isCourtInRegion(court, currentRegion));
    if (!getCourtCoordinate(selectedCourt) || regionalCourts.some((court) => court.id === selectedCourt?.id)) return regionalCourts;
    return [...regionalCourts, selectedCourt];
  }, [coordinateCourts, currentRegion, selectedCourt]);
  const missingCoordinateCount = Math.max(0, courts.length - coordinateCourts.length);
  const candidate = courts.find((court) => court.id === candidateId) ?? null;
  const clusteredCourtRows = clusterCourtIds
    .map((courtId) => courts.find((court) => court.id === courtId))
    .filter(Boolean);

  useEffect(() => {
    if (!open) return;
    setCandidateId(getCourtCoordinate(selectedCourt) ? selectedCourt?.id ?? "" : "");
    setClusterCourtIds([]);
  }, [open, selectedCourt?.id]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  useEffect(() => {
    if (!open || !mapElementRef.current) return undefined;
    if (!mappedCourts.length) {
      setStatus(loading ? "loading" : loadError ? "error" : "empty");
      setError(loadError);
      return undefined;
    }

    let cancelled = false;
    setStatus("loading");
    setError("");

    loadNaverMapsSdk()
      .then(() => {
        if (cancelled || !mapElementRef.current) return;
        const viewport = getInitialViewport(mappedCourts, selectedCourt, currentRegion, mapElementRef.current.clientWidth);
        const map = new window.naver.maps.Map(mapElementRef.current, {
          center: new window.naver.maps.LatLng(viewport.lat, viewport.lng),
          zoom: viewport.zoom,
          minZoom: 8,
          maxZoom: 19,
          zoomControl: true,
          mapDataControl: false,
          scaleControl: false,
        });
        mapRef.current = map;
        setStatus("ready");
        setMapVersion((value) => value + 1);
      })
      .catch((loadError) => {
        if (cancelled) return;
        setStatus("error");
        setError("지도를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
      });

    return () => {
      cancelled = true;
      mapRef.current = null;
    };
  }, [currentRegion, loadError, loading, mapRetrySequence, mappedCourts, open, selectedCourt]);

  useEffect(() => {
    const map = mapRef.current;
    if (!open || status !== "ready" || !map || !window.naver?.maps) return undefined;
    const maps = window.naver.maps;

    const clearMarkers = () => {
      markerListenersRef.current.forEach((listener) => removeMapListener(maps, listener));
      markersRef.current.forEach(detachMapMarker);
      markerListenersRef.current = [];
      markersRef.current = [];
    };

    const drawMarkers = () => {
      clearMarkers();
      const groups = clusterCourts(mappedCourts, map.getZoom());
      groups.forEach((group) => {
        const position = new maps.LatLng(group.lat, group.lng);
        const isCluster = group.items.length > 1;
        const marker = new maps.Marker({
          position,
          map,
          clickable: true,
          zIndex: isCluster ? 120 : group.items[0]?.court?.id === candidateId ? 140 : 100,
          icon: {
            content: makeMarkerElement(group, candidateId),
            anchor: new maps.Point(0, 0),
          },
        });
        const listener = maps.Event.addListener(marker, "click", () => {
          if (isCluster) {
            const nextZoom = Math.min(19, Number(map.getZoom()) + 2);
            setCandidateId("");
            if (nextZoom > Number(map.getZoom())) {
              setClusterCourtIds([]);
              map.setCenter(position);
              map.setZoom(nextZoom, true);
            } else {
              setClusterCourtIds(group.items.map((item) => item.court.id));
            }
            return;
          }
          setClusterCourtIds([]);
          setCandidateId(group.items[0].court.id);
          map.panTo(position);
        });
        markersRef.current.push(marker);
        markerListenersRef.current.push(listener);
      });
    };

    drawMarkers();
    const idleListener = maps.Event.addListener(map, "idle", drawMarkers);

    return () => {
      removeMapListener(maps, idleListener);
      clearMarkers();
    };
  }, [candidateId, mapVersion, mappedCourts, open, status]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="court-map-picker-backdrop" role="presentation" onMouseDown={onClose}>
      <ModalShell
        className="court-map-picker-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="등록 구장 지도"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="court-map-picker-header">
          <div>
            <span>COURT MAP</span>
            <h2>지도에서 구장 찾기</h2>
            <p>숫자는 등록 구장 또는 구장 묶음입니다. 번호를 누르면 아래에서 이름과 주소를 확인할 수 있습니다.</p>
          </div>
          <Button type="button" variant="secondary" size="sm" className="court-map-picker-close" aria-label="지도 닫기" onClick={onClose}>
            <X size={18} />
          </Button>
        </header>

        <div className="court-map-picker-canvas-wrap">
          <div ref={mapElementRef} className="court-map-picker-canvas" aria-label="등록 구장 지도" />
          {status !== "ready" ? (
            <div className="court-map-picker-state" role="status">
              <MapPin size={24} />
              <strong>{status === "loading" ? "등록 구장 지도 불러오는 중" : status === "empty" ? "좌표가 저장된 구장 없음" : "지도를 불러오지 못함"}</strong>
              <span>{status === "error" ? error : status === "empty" ? "선택한 지역에는 좌표가 저장된 구장이 없습니다." : "잠시만 기다려 주세요."}</span>
              {status === "error" && mappedCourts.length ? <Button type="button" size="sm" variant="secondary" onClick={() => setMapRetrySequence((value) => value + 1)}>다시 시도</Button> : null}
            </div>
          ) : null}
        </div>

        {clusteredCourtRows.length > 1 ? (
          <div className="court-map-picker-cluster-list" aria-label="같은 위치 구장">
            <strong>이 위치의 구장 {clusteredCourtRows.length}개</strong>
            <div>
              {clusteredCourtRows.map((court) => (
                <button
                  key={court.id}
                  type="button"
                  onClick={() => {
                    setCandidateId(court.id);
                    setClusterCourtIds([]);
                  }}
                >
                  <b>{court.name}</b>
                  <span>{getCourtAddress(court)}</span>
                </button>
              ))}
            </div>
          </div>
        ) : candidate ? (
          <div className="court-map-picker-selection">
            <div className="court-map-picker-selection-icon"><MapPin size={19} /></div>
            <div>
              <strong>{candidate.name}</strong>
              <span>{getCourtAddress(candidate)}</span>
              <em>
                {candidate.region || "지역 미정"}
                {Number(candidate.reviewCount) > 0 ? <><Star size={13} fill="currentColor" /> 보정 {Number(candidate.adjustedRating ?? candidate.rating ?? 0).toFixed(1)}</> : " · 평가 전"}
              </em>
            </div>
            <Button type="button" size="sm" onClick={() => onSelect?.(candidate)}>이 구장 선택</Button>
          </div>
        ) : (
          <div className="court-map-picker-hint">
            <MapPin size={17} />
            <span>지도에서 번호 마커를 누르면 아래에서 구장명과 주소를 확인할 수 있습니다.</span>
          </div>
        )}

        <footer className="court-map-picker-footer">
          <span>{currentRegion ? `${currentRegion} · ` : ""}지도 표시 {mappedCourts.length}개</span>
          {missingCoordinateCount ? <span>좌표 없는 구장 {missingCoordinateCount}개는 검색으로 선택</span> : null}
        </footer>
      </ModalShell>
    </div>,
    document.body,
  );
}
