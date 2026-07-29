import { Link } from "react-router-dom";
import { BadgeCheck, ClipboardCheck, ShieldCheck, Star, Trophy } from "lucide-react";
import HoverPortal, { HoverCardCloseButton, HoverCardTrigger } from "../common/HoverPortal.jsx";
import useHoverCardInteraction from "../../hooks/useHoverCardInteraction.js";
import { DAY_MS, REFEREE_TRUST_MIN } from "../../lib/constants.js";
import { getUserHashtag } from "../../lib/handles.js";

const COMPLETED_STATUSES = new Set(["approval", "disputed", "confirmed"]);

function getMatchTime(match = {}) {
  const raw = match.endedAt ?? match.confirmedAt ?? match.scheduledAt ?? match.createdAt;
  const time = new Date(raw).getTime();
  return Number.isFinite(time) ? time : 0;
}

function formatRecentMatch(value) {
  if (!value) return "기록 없음";
  const ms = Date.now() - value;
  if (!Number.isFinite(ms) || ms < 0) return "예정 경기";
  const days = Math.floor(ms / DAY_MS);
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
  const cardKey = user?.id ? `referee:${user.id}` : "";
  const {
    anchorRef,
    cardRef,
    closePinned,
    hideHover,
    open,
    pinnedOpen,
    togglePinned,
    triggerProps,
  } = useHoverCardInteraction({ cardKey });

  if (!user) return children ?? null;

  const stats = getRefereeStats(user, matches);
  const tier = getRefereeTier(user, stats, minTrust);
  const qualification = getRefereeQualification(user);
  const profilePath = to ?? `/app/players/${user.id}`;
  return (
    <HoverCardTrigger
      anchorRef={anchorRef}
      className={`referee-hover-trigger ${className}`}
      onActivate={togglePinned}
      onDismiss={() => {
        hideHover();
        closePinned();
      }}
      triggerProps={triggerProps}
    >
      {children ?? user.name}
      <HoverPortal
        anchorRef={anchorRef}
        className={`referee-hover-card hover-portal-card ${pinnedOpen ? "touch-open" : ""}`}
        estimatedHeight={330}
        open={open}
        portalRef={cardRef}
      >
        <HoverCardCloseButton onClose={closePinned} />
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
    </HoverCardTrigger>
  );
}
