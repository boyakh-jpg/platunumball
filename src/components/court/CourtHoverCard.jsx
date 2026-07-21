import { useEffect, useRef, useState } from "react";
import { ExternalLink, MapPin, MapPinned, Navigation, Star } from "lucide-react";
import { Link } from "react-router-dom";
import HoverPortal from "../common/HoverPortal.jsx";
import useBodyScrollLock from "../../hooks/useBodyScrollLock.js";
import { COURTS } from "../../lib/constants.js";
import { getCourtLayoutLabel, getCourtMapUrl, getCourtSurfaceLabel } from "../../lib/courts.js";
import { getCourtHashtag } from "../../lib/handles.js";
import { canUseHoverPreview, clearPinnedHoverPreview, getPinnedHoverPreviewKey, pinHoverPreview, subscribePinnedHoverPreview } from "../../lib/hoverPreviewPin.js";

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
  const hasDetailPage = Boolean(court?.id || COURTS.some((item) => item.id === resolvedCourt.id));
  const courtPath = hasDetailPage ? `/app/courts/${encodeURIComponent(resolvedCourt.id)}` : "";
  const reviewSummary = resolvedCourt.reviewSummary ?? {};
  const reviewCount = Number(reviewSummary.reviewCount ?? resolvedCourt.reviewCount ?? 0);
  const averageRating = Number(reviewSummary.adjustedRating ?? reviewSummary.averageRating ?? resolvedCourt.adjustedRating ?? resolvedCourt.rating ?? 0);
  const completedMatchCount = Number(resolvedCourt.completedMatchCount ?? 0);
  const recentReviews = reviewSummary.recentReviews ?? resolvedCourt.recentReviews ?? [];
  const ratingLabel = reviewCount && averageRating ? `${averageRating.toFixed(1)} 보정` : "리뷰 없음";
  const address = resolvedCourt.roadAddress || resolvedCourt.addressText || resolvedCourt.jibunAddress;

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
        if (pinnedOpen) closePinned();
        else openPinned();
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
          if (pinnedOpen) closePinned();
          else openPinned();
        }
      }}
      onMouseEnter={showHover}
      onMouseLeave={hideHover}
    >
      {children ?? resolvedCourt.name}
      <HoverPortal
        anchorRef={anchorRef}
        className={`court-hover-card hover-portal-card ${pinnedOpen ? "touch-open" : ""}`}
        estimatedHeight={430}
        open={open}
        portalRef={cardRef}
      >
        <button type="button" className="hover-card-close" aria-label="닫기" onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          closePinned();
        }}>X</button>
        <span className="court-hover-head">
          <span className="court-hover-icon"><MapPinned size={27} strokeWidth={2.2} /></span>
          <span>
            <strong>{resolvedCourt.name}</strong>
            <span className="hover-hashtag">{getCourtHashtag(resolvedCourt)}</span>
            <em>{resolvedCourt.region || "지역 미정"} · {resolvedCourt.type || "유형 미정"}</em>
          </span>
        </span>
        <span className="court-hover-address">
          <b>주소</b>
          <span>{[address, resolvedCourt.detailAddress].filter(Boolean).join(" ") || "주소 등록 필요"}</span>
        </span>
        <span className="court-hover-note">
          <b>찾아가는 메모</b>
          <span>{resolvedCourt.locationNote || "현장 접근 메모 없음"}</span>
        </span>
        <span className="court-hover-stats">
          <span><b>{getCourtSurfaceLabel(resolvedCourt)}</b><em>바닥</em></span>
          <span><b>{getCourtLayoutLabel(resolvedCourt)}</b><em>형태</em></span>
          <span><b>{resolvedCourt.courtKind === "official" ? "정식구장" : "골목/길농"}</b><em>유형</em></span>
          <span><b>{resolvedCourt.paid ? "유료" : "무료/미정"}</b><em>비용</em></span>
          <span><b>{completedMatchCount}경기</b><em>이용 기록</em></span>
          <span><b>{ratingLabel}</b><em><Star size={12} /> 리뷰 {reviewCount}개</em></span>
        </span>
        {recentReviews.length ? (
          <span className="court-hover-reviews">
            <b>최근 리뷰</b>
            {recentReviews.slice(0, 3).map((review) => (
              <span key={review.id}>
                <strong><Star size={12} fill="currentColor" /> 보정 {Number(review.adjustedRating ?? review.rating).toFixed(1)}</strong>
                <em>{review.memo}</em>
              </span>
            ))}
          </span>
        ) : null}
        <span className="court-hover-actions">
          {courtPath ? (
            <Link className="hover-card-action" to={courtPath} onClick={(event) => {
              event.stopPropagation();
              closePinned();
            }}>
              <MapPin size={16} /> 구장 정보 보기
            </Link>
          ) : null}
          <a className="hover-card-action hover-card-action-secondary" href={mapUrl} target="_blank" rel="noreferrer" onClick={(event) => {
            event.stopPropagation();
            closePinned();
          }}>
            <Navigation size={16} /> 지도 보기 <ExternalLink size={14} />
          </a>
        </span>
      </HoverPortal>
    </span>
  );
}
