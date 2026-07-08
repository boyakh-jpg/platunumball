import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { BadgeCheck, ClipboardCheck, ShieldCheck, Star, Trophy } from "lucide-react";
import HoverPortal from "../common/HoverPortal.jsx";
import useBodyScrollLock from "../../hooks/useBodyScrollLock.js";
import { REFEREE_TRUST_MIN } from "../../lib/constants.js";
import { getUserHashtag } from "../../lib/handles.js";
import { clearPinnedHoverPreview, getPinnedHoverPreviewKey, pinHoverPreview, subscribePinnedHoverPreview } from "../../lib/hoverPreviewPin.js";

const COMPLETED_STATUSES = new Set(["approval", "disputed", "confirmed"]);

function canUseHoverPreview() {
  return typeof window === "undefined" || !window.matchMedia("(hover: none), (pointer: coarse)").matches;
}

function getMatchTime(match = {}) {
  const raw = match.endedAt ?? match.confirmedAt ?? match.scheduledAt ?? match.createdAt;
  const time = new Date(raw).getTime();
  return Number.isFinite(time) ? time : 0;
}

function formatRecentMatch(value) {
  if (!value) return "기록 없음";
  const ms = Date.now() - value;
  if (!Number.isFinite(ms) || ms < 0) return "예정 경기";
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days < 1) return "오늘";
  if (days < 30) return `${days}일 전`;
  return `${Math.floor(days / 30)}개월 전`;
}

function getRefereeStats(user = {}, matches = []) {
  const refereeMatches = matches.filter((match) => match.refereeId === user.id);
  const completedMatches = refereeMatches.filter((match) => COMPLETED_STATUSES.has(match.status) || match.result || match.endedAt);
  const disputedMatches = refereeMatches.filter((match) => match.status === "disputed" || (match.disputes ?? []).length > 0);
  const recentTime = refereeMatches.reduce((latest, match) => Math.max(latest, getMatchTime(match)), 0);

  return {
    total: refereeMatches.length,
    completed: completedMatches.length,
    official: refereeMatches.filter((match) => match.official).length,
    ranked: refereeMatches.filter((match) => match.ranked !== false).length,
    disputed: disputedMatches.length,
    disputeRate: completedMatches.length ? Math.round((disputedMatches.length / completedMatches.length) * 100) : 0,
    recentLabel: formatRecentMatch(recentTime),
  };
}

function getRefereeQualification(user = {}) {
  const profile = user.refereeProfile ?? {};
  if (profile.licenseVerified || user.refereeLicenseVerified) return "정식 라이선스";
  if (profile.examPassedAt || user.refereeExamPassedAt) return "자격시험 통과";
  return "커뮤니티 심판";
}

function getRefereeTier(user = {}, stats = {}, minTrust = REFEREE_TRUST_MIN) {
  const trust = Number(user.trustScore ?? 0);
  const officialVerified = user.refereeProfile?.licenseVerified || user.refereeLicenseVerified;
  if (officialVerified) return { grade: "PRO", label: "공식 심판", tone: "gold" };
  if (trust < minTrust) return { grade: "WAIT", label: "자격 대기", tone: "neutral" };
  if (trust >= 96 && stats.completed >= 20 && stats.disputeRate <= 15) return { grade: "S", label: "엘리트 심판", tone: "gold" };
  if (trust >= 94 && stats.completed >= 10) return { grade: "A", label: "상급 심판", tone: "green" };
  if (trust >= 90 && stats.completed >= 3) return { grade: "B", label: "검증 심판", tone: "blue" };
  return { grade: "C", label: "입문 심판", tone: "neutral" };
}

export default function RefereeHoverCard({ user, matches = [], minTrust = REFEREE_TRUST_MIN, children, className = "", to }) {
  const [hoverOpen, setHoverOpen] = useState(false);
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const [pinnedHoverKey, setPinnedHoverKey] = useState(getPinnedHoverPreviewKey);
  const anchorRef = useRef(null);
  const cardRef = useRef(null);
  const cardKey = user?.id ? `referee:${user.id}` : "";
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

  if (!user) return children ?? null;

  const stats = getRefereeStats(user, matches);
  const tier = getRefereeTier(user, stats, minTrust);
  const qualification = getRefereeQualification(user);
  const profilePath = to ?? `/app/players/${user.id}`;
  const showHover = () => {
    if (canUseHoverPreview() && !pinnedHoverKey) setHoverOpen(true);
  };
  const hideHover = () => setHoverOpen(false);
  const open = pinnedOpen || (!pinnedHoverKey && canUseHoverPreview() && hoverOpen);

  return (
    <span
      ref={anchorRef}
      className={`referee-hover-trigger ${className}`}
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
      {children ?? user.name}
      <HoverPortal
        anchorRef={anchorRef}
        className={`referee-hover-card hover-portal-card ${pinnedOpen ? "touch-open" : ""}`}
        estimatedHeight={330}
        open={open}
        portalRef={cardRef}
      >
        <button type="button" className="hover-card-close" aria-label="닫기" onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          closePinned();
        }}>X</button>
        <span className="referee-hover-head">
          <span className={`referee-hover-grade ${tier.tone}`}>{tier.grade}</span>
          <span>
            <strong>{user.name}</strong>
            <span className="hover-hashtag">{getUserHashtag(user)}</span>
            <em>{user.region} · 신뢰도 {user.trustScore ?? "-"} · 기준 {minTrust}</em>
          </span>
        </span>
        <span className="referee-hover-tier">
          <ShieldCheck size={26} />
          <span>
            <b>{tier.label}</b>
            <em>{qualification}</em>
          </span>
        </span>
        <span className="referee-hover-stats">
          <span><b>{stats.total}</b><em><ClipboardCheck size={12} /> 심판</em></span>
          <span><b>{stats.ranked}</b><em><Trophy size={12} /> 정규전</em></span>
          <span><b>{stats.official}</b><em><BadgeCheck size={12} /> 공식</em></span>
          <span><b>{stats.disputed}</b><em>이의</em></span>
          <span><b>{stats.disputeRate}%</b><em>이의율</em></span>
          <span><b>{stats.recentLabel}</b><em><Star size={12} /> 최근</em></span>
        </span>
        <span className="referee-hover-note">
          심판 티어는 현재 신뢰도, 심판 배정 경기 수, 이의 발생률로 임시 계산합니다. 정식 라이선스와 자격시험은 추후 검증 데이터로 고정합니다.
        </span>
        <Link className="hover-card-action" to={profilePath} onClick={(event) => {
          event.stopPropagation();
          closePinned();
        }}>선수 프로필 보기</Link>
      </HoverPortal>
    </span>
  );
}
