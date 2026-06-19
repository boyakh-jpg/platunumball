import { useEffect, useRef, useState } from "react";
import { ExternalLink, MapPin, Navigation, Star } from "lucide-react";
import HoverPortal from "../common/HoverPortal.jsx";
import useBodyScrollLock from "../../hooks/useBodyScrollLock.js";
import { COURTS } from "../../lib/constants.js";
import { getCourtHashtag } from "../../lib/handles.js";
import { clearPinnedHoverPreview, getPinnedHoverPreviewKey, pinHoverPreview, subscribePinnedHoverPreview } from "../../lib/hoverPreviewPin.js";

function canUseHoverPreview() {
  return typeof window === "undefined" || !window.matchMedia("(hover: none), (pointer: coarse)").matches;
}

function getCourtMapUrl(court = {}) {
  const query = [court.addressText, court.name].filter(Boolean).join(" ");
  return `https://map.naver.com/p/search/${encodeURIComponent(query || court.name || "농구장")}`;
}

function resolveCourt(court, courtName = "") {
  if (court?.id || court?.name) return court;
  return COURTS.find((item) => item.name === courtName) ?? {
    id: `court-${courtName || "unknown"}`,
    name: courtName || "구장 미정",
    region: "",
    type: "",
    addressText: "",
    locationNote: "등록된 위치 정보가 없습니다.",
  };
}

export default function CourtHoverCard({ court, courtName = "", children, className = "" }) {
  const resolvedCourt = resolveCourt(court, courtName);
  const [hoverOpen, setHoverOpen] = useState(false);
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const [pinnedHoverKey, setPinnedHoverKey] = useState(getPinnedHoverPreviewKey);
  const anchorRef = useRef(null);
  const cardRef = useRef(null);
  const cardKey = resolvedCourt?.id ? `court:${resolvedCourt.id}` : "";
  useBodyScrollLock(pinnedOpen);

  const closePinned = () => {
    setPinnedOpen(false);
    clearPinnedHoverPreview(cardKey);
  };
  const openPinned = () => {
    setHoverOpen(false);
    pinHoverPreview(cardKey);
    setPinnedOpen(true);
  };

  useEffect(() => subscribePinnedHoverPreview(setPinnedHoverKey), []);

  useEffect(() => {
    if (pinnedOpen && pinnedHoverKey && pinnedHoverKey !== cardKey) setPinnedOpen(false);
  }, [cardKey, pinnedHoverKey, pinnedOpen]);

  useEffect(() => () => clearPinnedHoverPreview(cardKey), [cardKey]);

  useEffect(() => {
    if (!pinnedOpen) return undefined;
    const closeOutside = (event) => {
      const target = event.target;
      if (anchorRef.current?.contains(target) || cardRef.current?.contains(target)) return;
      closePinned();
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") closePinned();
    };
    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [cardKey, pinnedOpen]);

  const showHover = () => {
    if (canUseHoverPreview() && !pinnedHoverKey) setHoverOpen(true);
  };
  const hideHover = () => setHoverOpen(false);
  const open = pinnedOpen || (!pinnedHoverKey && canUseHoverPreview() && hoverOpen);
  const mapUrl = getCourtMapUrl(resolvedCourt);

  return (
    <span
      ref={anchorRef}
      className={`court-hover-trigger ${className}`}
      role="button"
      tabIndex={0}
      onBlur={hideHover}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        openPinned();
      }}
      onFocus={showHover}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          hideHover();
          closePinned();
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          openPinned();
        }
      }}
      onMouseEnter={showHover}
      onMouseLeave={hideHover}
    >
      {children ?? resolvedCourt.name}
      <HoverPortal
        anchorRef={anchorRef}
        className={`court-hover-card hover-portal-card ${pinnedOpen ? "touch-open" : ""}`}
        estimatedHeight={300}
        open={open}
        portalRef={cardRef}
      >
        <button type="button" className="hover-card-close" onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          closePinned();
        }}>닫기</button>
        <span className="court-hover-head">
          <span className="court-hover-icon"><MapPin size={22} /></span>
          <span>
            <strong>{resolvedCourt.name}</strong>
            <span className="hover-hashtag">{getCourtHashtag(resolvedCourt)}</span>
            <em>{resolvedCourt.region || "지역 미정"} · {resolvedCourt.type || "유형 미정"}</em>
          </span>
        </span>
        <span className="court-hover-address">
          <b>주소</b>
          <span>{resolvedCourt.addressText || "주소 등록 필요"}</span>
        </span>
        <span className="court-hover-note">
          <b>찾아가는 메모</b>
          <span>{resolvedCourt.locationNote || "현장 접근 메모 없음"}</span>
        </span>
        <span className="court-hover-stats">
          <span><b>{resolvedCourt.courtKind === "official" ? "정식구장" : "골대/길농"}</b><em>유형</em></span>
          <span><b>{resolvedCourt.hoopCount ? `${resolvedCourt.hoopCount}개` : "-"}</b><em>골대</em></span>
          <span><b>{resolvedCourt.paid ? "유료" : "무료/미정"}</b><em>비용</em></span>
          <span><b>{resolvedCourt.reservation ? "예약 가능" : "현장 사용"}</b><em>예약</em></span>
          <span><b>{resolvedCourt.lighting ? "조명 있음" : "확인 필요"}</b><em>야간</em></span>
          <span><b>{resolvedCourt.favorite ? "추천" : "일반"}</b><em><Star size={12} /> 상태</em></span>
        </span>
        <a className="hover-card-action" href={mapUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
          <Navigation size={16} /> 지도로 보기 <ExternalLink size={14} />
        </a>
      </HoverPortal>
    </span>
  );
}
