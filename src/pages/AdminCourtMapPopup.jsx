import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, MapPin, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import Button from "../components/common/Button.jsx";
import { getCourtMapUrl, getOptionalCourtCoordinate } from "../lib/courts.js";
import { loadNaverMapsSdk, loadNaverPanoramaSdk } from "../lib/naverAddress.js";

const MAP_ZOOM = 18;

export default function AdminCourtMapPopup() {
  const [searchParams] = useSearchParams();
  const mapRef = useRef(null);
  const panoramaRef = useRef(null);
  const panoramaOnly = searchParams.get("view") === "panorama";
  const [status, setStatus] = useState("지도와 거리뷰를 불러오는 중입니다.");
  const court = useMemo(() => ({
    name: searchParams.get("name") ?? "농구장",
    addressText: searchParams.get("address") ?? "",
    lat: getOptionalCourtCoordinate(searchParams.get("lat"), -90, 90),
    lng: getOptionalCourtCoordinate(searchParams.get("lng"), -180, 180),
  }), [searchParams]);
  const hasCoordinates = court.lat !== null && court.lng !== null;
  const externalMapUrl = getCourtMapUrl(court, { zoom: MAP_ZOOM });

  useEffect(() => {
    document.title = `${court.name} 지도 · BOXTIER`;
    if (!hasCoordinates) {
      setStatus("좌표가 없어 주소 검색으로 확인해야 합니다.");
      return undefined;
    }

    let cancelled = false;
    let map = null;
    let panorama = null;
    let panoramaTimer = 0;
    void (async () => {
      try {
        await loadNaverMapsSdk();
        if (cancelled || !panoramaRef.current || (!panoramaOnly && !mapRef.current)) return;
        const { maps } = window.naver;
        const center = new maps.LatLng(court.lat, court.lng);
        if (!panoramaOnly) {
          map = new maps.Map(mapRef.current, {
            center,
            zoom: MAP_ZOOM,
            zoomControl: true,
            zoomControlOptions: { position: maps.Position.TOP_RIGHT },
          });
          new maps.Marker({ position: center, map, title: court.name });
        }
        setStatus(panoramaOnly ? "가장 가까운 거리뷰를 확인하는 중입니다." : "확대 18 · 지도 표시 완료 · 거리뷰를 확인하는 중입니다.");
        try {
          await loadNaverPanoramaSdk();
        } catch {
          if (!cancelled) setStatus("확대 18 지도는 표시됐습니다. 거리뷰를 불러오지 못했습니다.");
          return;
        }
        if (cancelled || !panoramaRef.current) return;
        panorama = new maps.Panorama(panoramaRef.current, {
          position: center,
          zoomControl: true,
          zoomControlOptions: { position: maps.Position.TOP_RIGHT },
        });
        maps.Event.addListener(panorama, "init", () => {
          window.clearTimeout(panoramaTimer);
          if (!cancelled) setStatus("확대 18 · 핀 위치와 가장 가까운 거리뷰입니다.");
        });
        panoramaTimer = window.setTimeout(() => {
          if (!cancelled) setStatus("지도는 표시됐습니다. 주변에 거리뷰 촬영 지점이 없을 수 있습니다.");
        }, 7000);
      } catch (error) {
        if (!cancelled) setStatus(error.message || "지도 기능을 불러오지 못했습니다.");
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(panoramaTimer);
      if (window.naver?.maps?.Event) {
        if (map) window.naver.maps.Event.clearInstanceListeners(map);
        if (panorama) window.naver.maps.Event.clearInstanceListeners(panorama);
      }
    };
  }, [court, hasCoordinates, panoramaOnly]);

  return (
    <main className="admin-court-map-popup">
      <header>
        <div>
          <p className="eyebrow">Naver Map · Zoom {MAP_ZOOM}</p>
          <h1><MapPin size={22} /> {court.name}</h1>
          <small>{court.addressText || "주소 미입력"}</small>
        </div>
        <div className="admin-court-map-popup-actions">
          <Button as="a" variant="secondary" size="sm" href={externalMapUrl} target="rankball-court-map-external">
            <ExternalLink size={14} /> 네이버 지도 웹
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => window.close()}><X size={15} /> 창 닫기</Button>
        </div>
      </header>
      <p className="admin-court-map-popup-status">{status}</p>
      {hasCoordinates ? (
        <section className={`admin-court-map-popup-grid ${panoramaOnly ? "is-panorama-only" : ""}`}>
          {!panoramaOnly ? <div><strong>지도</strong><div ref={mapRef} className="admin-court-map-canvas" /></div> : null}
          <div><strong>거리뷰</strong><div ref={panoramaRef} className="admin-court-panorama-canvas" /></div>
        </section>
      ) : (
        <section className="admin-court-map-popup-empty">
          <p>위도·경도를 먼저 입력하면 확대 18 지도와 거리뷰를 함께 볼 수 있습니다.</p>
          <Button as="a" href={externalMapUrl} target="rankball-court-map-external">주소로 네이버 지도 열기</Button>
        </section>
      )}
    </main>
  );
}
