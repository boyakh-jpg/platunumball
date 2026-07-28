import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { CalendarDays, ChevronDown, ChevronUp, Crown, MapPin, RotateCcw, ShieldCheck, Star, Trophy, UsersRound, X } from "lucide-react";
import AgreementPanel from "../components/match/AgreementPanel.jsx";
import ApprovalPanel from "../components/match/ApprovalPanel.jsx";
import MatchClockPanel, { MatchScoreControls } from "../components/match/MatchClockPanel.jsx";
import BasketballLoader from "../components/common/BasketballLoader.jsx";
import MatchContract from "../components/match/MatchContract.jsx";
import MatchDisputeQueue from "../components/match/MatchDisputeQueue.jsx";
import MatchRecommendationPanel from "../components/match/MatchRecommendationPanel.jsx";
import MatchVoidDialog, { MatchFinalizeDialog } from "../components/match/MatchVoidDialog.jsx";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import PlayerHoverCard from "../components/profile/PlayerHoverCard.jsx";
import ProfileEmblem from "../components/profile/ProfileEmblem.jsx";
import MmrChange from "../components/rating/MmrChange.jsx";
import RefereeHoverCard from "../components/referee/RefereeHoverCard.jsx";
import ShareCard from "../components/share/ShareCard.jsx";
import TeamHoverCard from "../components/team/TeamHoverCard.jsx";
import useBodyScrollLock from "../hooks/useBodyScrollLock.js";
import { EVIDENCE_OPTIONS, MATCH_SIDE_FALLBACK_NAMES, MATCH_SIDES, PLAYER_STAT_FIELDS, REPORT_MATCH_WINDOW_MS, normalizeBenchCapacity, normalizeDisputeWindowMinutes } from "../lib/constants.js";
import { DEFAULT_REPORT_REASON, REPORT_REASONS, REPORT_TARGET_TYPES, VOID_MATCH_RESTORE_REPORT_REASON, getReportTargetType } from "../lib/reportReasons.js";
import {
  formatKoreanDateTime,
  formatStatLine,
  MATCH_DISPUTE_REASON_OPTIONS,
  OTHER_MATCH_DISPUTE_REASON,
  buildMatchResultSubmission,
  buildMatchDisputeRequest,
  canUserResolveMatchDispute,
  canRequestVoidMatchRestore,
  getAgreementStatus,
  getMatchHostPlayerId,
  getMatchCancelCopy,
  getMatchPlayerDisputePoints,
  getOpenMatchDisputes,
  getMatchRecordWindow,
  getMatchReferee,
  getMatchRecordPlayerIds,
  getMatchReviewParticipantIds,
  getMatchResultEntryPermission,
  getMatchRoomPhase,
  getMatchPlayerIds,
  getReportableMatchTimeMs,
  getReportableMatchUserIds,
  getVoidMatchRestoreTargetUserId,
  getMatchReservePlayerIds,
  getSafeMatchSide,
  getMatchSideLeaderId,
  getMatchSideRecordPlayerIds,
  getMergedResultScore,
  getPlayerSideName,
  getPlayerStatSubmitted,
  getStatSubmissionStatus,
  isEligibleReferee,
  isMatchReferee,
  isMatchRecordMatch,
  isPersonalRecordMatch,
} from "../lib/matchUtils.js";
import { getMatchRuleDetailRows, getMeetingPointSummary, normalizeMatchRules } from "../lib/matchRules.js";
import "../styles/matchroom-arena.css";

const statusMeta = {
  contract: { label: "대기", tone: "blue" },
  agreed: { label: "진행 예정", tone: "green" },
  approval: { label: "결과 승인 대기", tone: "orange" },
  disputed: { label: "이의제기 보류", tone: "orange" },
  confirmed: { label: "확정 완료", tone: "green" },
  void: { label: "경기 무효", tone: "neutral" },
  cancelled: { label: "취소됨", tone: "neutral" },
};

function makeInitialStats(match) {
  if (!match) return {};
  const sourceResult = match?.disputeDraftResult ?? match?.result;
  const playerIds = getMatchRecordPlayerIds(match);
  return Object.fromEntries(
    playerIds.map((playerId) => [
      playerId,
      Object.fromEntries(PLAYER_STAT_FIELDS.map((field) => [field.id, sourceResult?.playerStats?.[playerId]?.[field.id] ?? 0])),
    ]),
  );
}

function getTeamMmr(teams, teamId) {
  return teams.find((team) => team.id === teamId)?.mmr ?? 0;
}

function getDisplayScore(match, sideName) {
  if (!match) return 0;
  const sourceResult = match.disputeDraftResult ?? match.result;
  const resultKey = sideName === "teamA" ? "scoreA" : "scoreB";
  return sourceResult?.[resultKey] ?? match[sideName]?.score ?? 0;
}

function getRecordSummaryNames(match = {}, sideName = "teamA") {
  const names = sideName === "teamA"
    ? match.rules?.recordSummary?.teamAPlayers
    : match.rules?.recordSummary?.teamBPlayers;
  return Array.isArray(names) ? names.map((name) => String(name ?? "").trim()) : [];
}

function getRecordPlayerDisplayName(match = {}, sideName = "teamA", playerId = "", index = 0, user = null) {
  return user?.name
    || match.anonymousPlayers?.[playerId]?.name
    || getRecordSummaryNames(match, sideName)[index]
    || "플레이어";
}

function isAnonymousDisplayUser(user = null) {
  return Boolean(user?.anonymous || user?.participationLabel === "개인참여");
}

function getAvatarInitial(user = null, fallback = "P") {
  return isAnonymousDisplayUser(user) ? "?" : (user?.name?.slice(0, 1) ?? fallback);
}

function getPlayerMetaLabel(user = null) {
  const position = user?.position ?? "-";
  return user?.participationLabel ? `${position} · ${user.participationLabel}` : position;
}

function getRecordPlayerEntries(match = {}, includeReserves = false) {
  return MATCH_SIDES.flatMap((sideName) => (
    getMatchSideRecordPlayerIds(match, sideName, includeReserves).map((playerId, index) => ({ sideName, playerId, index }))
  ));
}

function getPointAudit(match, score, sideName) {
  const teamScore = getMergedResultScore(match, score.playerStats, sideName, 0);
  const statPoints = getMatchSideRecordPlayerIds(match, sideName).reduce((sum, playerId) => sum + Number(score.playerStats[playerId]?.points ?? 0), 0);
  return {
    teamScore,
    statPoints,
    matched: teamScore === statPoints,
  };
}

function formatWindowTime(value) {
  if (!value) return "일정 없음";
  return formatKoreanDateTime(value, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const COURT_REVIEW_FIELDS = [
  { id: "surfaceRating", label: "바닥" },
  { id: "rimRating", label: "림/골대" },
  { id: "lightingRating", label: "조명" },
  { id: "crowdRating", label: "혼잡도" },
  { id: "locationAccuracy", label: "위치 정확도" },
];

function getCourtReviewDraft(review = {}) {
  const source = review ?? {};
  return {
    rating: source.rating ?? 0,
    surfaceRating: source.surfaceRating ?? "",
    rimRating: source.rimRating ?? "",
    lightingRating: source.lightingRating ?? "",
    crowdRating: source.crowdRating ?? "",
    locationAccuracy: source.locationAccuracy ?? "",
    memo: source.memo ?? "",
  };
}

function getNonNegativeNumber(value) {
  const numericValue = Number(value ?? 0);
  return Number.isFinite(numericValue) ? Math.max(0, numericValue) : 0;
}

function NumericStepper({ value, disabled = false, onChange, label, className = "" }) {
  const numericValue = getNonNegativeNumber(value);
  const setNextValue = (nextValue) => onChange(getNonNegativeNumber(nextValue));
  return (
    <div className={["numeric-stepper", className].filter(Boolean).join(" ")}>
      <button type="button" disabled={disabled} onClick={() => setNextValue(numericValue + 1)} aria-label={`${label} 1 증가`} title="1 증가">
        <ChevronUp size={18} strokeWidth={3} />
      </button>
      <input
        type="number"
        min="0"
        inputMode="numeric"
        pattern="[0-9]*"
        disabled={disabled}
        value={numericValue}
        onChange={(event) => setNextValue(event.target.value)}
        aria-label={label}
      />
      <button type="button" disabled={disabled} onClick={() => setNextValue(numericValue - 1)} aria-label={`${label} 1 감소`} title="1 감소">
        <ChevronDown size={18} strokeWidth={3} />
      </button>
    </div>
  );
}

function CourtReviewRating({ label, value, onChange, disabled = false }) {
  const numericValue = Number(value ?? 0);
  return (
    <div className="court-review-rating-row">
      <span>{label}</span>
      <div className="court-review-stars">
        {[1, 2, 3, 4, 5].map((rating) => (
          <button
            key={rating}
            type="button"
            className={numericValue >= rating ? "court-review-star-button selected" : "court-review-star-button"}
            disabled={disabled}
            onClick={() => onChange(rating)}
            aria-label={`${label} ${rating}점`}
          >
            <Star size={15} fill={numericValue >= rating ? "currentColor" : "none"} />
          </button>
        ))}
      </div>
    </div>
  );
}

export default function MatchRoom({ app }) {
  const { matchId } = useParams();
  const [searchParams] = useSearchParams();
  const match = useMemo(
    () => app.state.matches.find((item) => item?.id === matchId) ?? null,
    [app.state.matches, matchId],
  );
  const requestedMatchIdRef = useRef("");
  const matchDetailRequestSequenceRef = useRef(0);
  const [matchDetailMissing, setMatchDetailMissing] = useState(false);
  const [score, setScore] = useState({
    scoreA: match?.result?.scoreA ?? match?.teamA?.score ?? 21,
    scoreB: match?.result?.scoreB ?? match?.teamB?.score ?? 17,
    playerStats: makeInitialStats(match),
  });
  const matchPlayerKey = match ? getMatchPlayerIds(match).join("|") : "";
  const [disputeReason, setDisputeReason] = useState(MATCH_DISPUTE_REASON_OPTIONS[0]);
  const [disputeCustomReason, setDisputeCustomReason] = useState("");
  const [disputeRequestedPoints, setDisputeRequestedPoints] = useState("");
  const [disputeRequestedSide, setDisputeRequestedSide] = useState("teamA");
  const [disputeRequestedScore, setDisputeRequestedScore] = useState("");
  const [reportReason, setReportReason] = useState(DEFAULT_REPORT_REASON);
  const [statEditorPlayerId, setStatEditorPlayerId] = useState(null);
  const [reviewControlsOpen, setReviewControlsOpen] = useState(false);
  const [resultSaveFeedback, setResultSaveFeedback] = useState("");
  const [courtReviewSaveFeedback, setCourtReviewSaveFeedback] = useState("");
  const [courtReviewSaving, setCourtReviewSaving] = useState(false);
  const [matchDetailRefreshing, setMatchDetailRefreshing] = useState(false);
  const [soloRecordDeleteOpen, setSoloRecordDeleteOpen] = useState(false);
  const [voidDialogOpen, setVoidDialogOpen] = useState(false);
  const [voidActionPending, setVoidActionPending] = useState(false);
  const [finalizeDialogOpen, setFinalizeDialogOpen] = useState(false);
  const [finalizeActionPending, setFinalizeActionPending] = useState(false);
  const [voidRestoreDetail, setVoidRestoreDetail] = useState("");
  const [voidRestoreStatus, setVoidRestoreStatus] = useState("");
  const existingCourtReview = useMemo(
    () => (match ? (app.state.settings?.courtReviews ?? []).find((review) => review.matchId === match.id && review.reviewerId === app.currentUser.id) ?? null : null),
    [app.currentUser.id, app.state.settings?.courtReviews, match?.id],
  );
  const [courtReviewDraft, setCourtReviewDraft] = useState(() => getCourtReviewDraft(existingCourtReview));
  useBodyScrollLock(Boolean((match?.refereeId && statEditorPlayerId) || soloRecordDeleteOpen || voidDialogOpen || finalizeDialogOpen));

  useEffect(() => {
    matchDetailRequestSequenceRef.current += 1;
    requestedMatchIdRef.current = "";
    setMatchDetailMissing(false);
  }, [app.currentUser.id, matchId]);

  useEffect(() => {
    if (!matchId || app.remoteReady === false || requestedMatchIdRef.current === matchId) return;
    setMatchDetailMissing(false);
    requestedMatchIdRef.current = matchId;
    const requestSequence = matchDetailRequestSequenceRef.current;
    const request = app.actions.loadMatchDetail?.(matchId);
    if (!request?.then) {
      if (!match && !request) {
        requestedMatchIdRef.current = "";
        setMatchDetailMissing(true);
      }
      return;
    }
    request.then((count) => {
      if (matchDetailRequestSequenceRef.current !== requestSequence || requestedMatchIdRef.current !== matchId) return;
      if (!count) {
        requestedMatchIdRef.current = "";
        if (!match) setMatchDetailMissing(true);
      }
    }).catch(() => {
      if (matchDetailRequestSequenceRef.current !== requestSequence || requestedMatchIdRef.current !== matchId) return;
      requestedMatchIdRef.current = "";
      if (!match) setMatchDetailMissing(true);
    });
  }, [app.actions, app.remoteReady, match, matchId]);

  useEffect(() => {
    setCourtReviewDraft(getCourtReviewDraft(existingCourtReview));
    setCourtReviewSaveFeedback("");
  }, [existingCourtReview?.id, existingCourtReview?.updatedAt, match?.id]);

  useEffect(() => {
    if (!match) return;
    const sourceResult = match.disputeDraftResult ?? match.result;
    setScore({
      scoreA: sourceResult?.scoreA ?? match.teamA?.score ?? 21,
      scoreB: sourceResult?.scoreB ?? match.teamB?.score ?? 17,
      playerStats: makeInitialStats(match),
    });
    setResultSaveFeedback("");
  }, [match?.id, match?.result?.updatedAt, match?.result?.submittedAt, match?.disputeDraftResult?.updatedAt, matchPlayerKey]);

  useEffect(() => {
    if (!match) return;
    setDisputeReason(MATCH_DISPUTE_REASON_OPTIONS[0]);
    setDisputeCustomReason("");
    setDisputeRequestedPoints(String(getMatchPlayerDisputePoints(match, app.currentUser.id)));
    setDisputeRequestedSide("teamA");
    setDisputeRequestedScore(String(match.result?.scoreA ?? match.teamA?.score ?? 0));
  }, [app.currentUser.id, match?.id, match?.result?.updatedAt]);

  const attendanceQrToken = String(searchParams.get("attendanceQr") || "").trim();
  if (attendanceQrToken && matchId) {
    return <Navigate to={`/app/matches?match=${encodeURIComponent(matchId)}&attendanceQr=${encodeURIComponent(attendanceQrToken)}`} replace />;
  }

  if (!match) {
    if (matchDetailMissing) return <Navigate to="/app/matches" replace />;
    return <BasketballLoader overlay label="경기방 불러오는 중" />;
  }

  const userMap = Object.fromEntries([...app.state.users, ...Object.values(match.anonymousPlayers ?? {})].map((user) => [user.id, user]));
  const statEditorPlayer = statEditorPlayerId ? userMap[statEditorPlayerId] : null;
  const isSharedRecord = isMatchRecordMatch(match);
  const status = match.status === "cancelled" && isSharedRecord
    ? { label: "기록 취소됨", tone: "neutral" }
    : match.status === "approval" && isSharedRecord
      ? { label: "참가 확인 대기", tone: "orange" }
      : statusMeta[match.status] ?? { label: "상태 확인 중", tone: "blue" };
  const cancelCopy = getMatchCancelCopy(match);
  const teamAAgreement = getAgreementStatus(match, app.state.teams, "teamA");
  const teamBAgreement = getAgreementStatus(match, app.state.teams, "teamB");
  const currentUserSideName = getPlayerSideName(match, app.currentUser.id);
  const recordWindow = getMatchRecordWindow(match);
  const referee = getMatchReferee(match, app.state.users);
  const hasReferee = Boolean(match.refereeId);
  const isSoloRecord = isPersonalRecordMatch(match);
  const currentUserIsReferee = isMatchReferee(match, app.currentUser.id);
  const currentUserIsEligibleReferee = currentUserIsReferee && isEligibleReferee(app.currentUser, match.refereeTrustMin, app.state.settings?.refereeAppointments);
  const operationSummary = isSoloRecord
    ? "작성자 · 내 기록"
    : referee
      ? `심판 ${referee.name}`
      : match.rules?.gameClockEnabled === false
        ? "방장 · 양쪽 점수"
        : "경기시계 담당자 · 양쪽 점수";
  const statSubmissionStatus = getStatSubmissionStatus(match);
  const activeEvidenceIds = new Set(EVIDENCE_OPTIONS.map((item) => item.id));
  const activeEvidenceCount = (match.evidence ?? []).filter((evidence) => activeEvidenceIds.has(evidence.id ?? evidence.type)).length;
  const currentUserSubmitted = getPlayerStatSubmitted(match, app.currentUser.id);
  const currentUserAgreementDone = currentUserSideName ? (match.agreements?.[currentUserSideName] ?? []).includes(app.currentUser.id) : false;
  const sourceRecruitingPost = match.recruitingPostId
    ? app.state.recruitingPosts?.find((post) => post.id === match.recruitingPostId)
    : null;
  const benchCapacity = normalizeBenchCapacity(match.benchCapacity ?? match.rules?.benchCapacity ?? sourceRecruitingPost?.benchCapacity);
  const matchHostPlayerId = getMatchHostPlayerId(match, sourceRecruitingPost);
  const isMatchHost = matchHostPlayerId === app.currentUser.id;
  const currentUserIsAdmin = Number(app.adminContext?.level ?? 0) >= 30;
  const matchPhase = getMatchRoomPhase(match).phase;
  const startedAuthorityPhase = Boolean(match.startedAt || match.endedAt || match.result || ["live", "postgame", "dispute", "record"].includes(matchPhase));
  const currentUserCanOperateStartedMatch = hasReferee ? currentUserIsEligibleReferee : isMatchHost;
  const currentUserCanResolveDispute = canUserResolveMatchDispute(match, app.currentUser.id, sourceRecruitingPost)
    && (hasReferee ? currentUserIsEligibleReferee : isMatchHost);
  const currentUserCanRefreshReview = isMatchHost || currentUserIsEligibleReferee || currentUserIsAdmin;
  const currentUserCanFileDispute = getMatchRecordPlayerIds(match).includes(app.currentUser.id);
  const resultEntryPermission = getMatchResultEntryPermission(match, app.currentUser.id, {
    canOperatePostStart: currentUserCanOperateStartedMatch,
    refereeEligible: currentUserIsEligibleReferee,
  });
  const canEditDisputeDraft = resultEntryPermission.canEditDisputeDraft;
  const currentUserCanSubmitMissingPostgameResult = resultEntryPermission.canSubmitMissingPostgameResult;
  const currentUserEditablePlayerIds = resultEntryPermission.editablePlayerIds;
  const currentUserCanSubmit = canEditDisputeDraft || currentUserEditablePlayerIds.length > 0;
  const canSubmitLiveResult = resultEntryPermission.canSubmitLive;
  const canSubmitResult = resultEntryPermission.canSubmit;
  const canCancel = ["contract", "agreed"].includes(match.status) && (startedAuthorityPhase ? currentUserCanOperateStartedMatch : isMatchHost);
  const canFinalizeMatch = Boolean(
    !isSharedRecord &&
    match.endedAt &&
    (hasReferee ? match.result : true) &&
    !match.confirmedAt &&
    match.status !== "disputed" &&
    (hasReferee ? currentUserIsEligibleReferee : isMatchHost),
  );
  const finalAuthorityLabel = hasReferee ? "배정 심판" : "방장";
  const openDisputes = getOpenMatchDisputes(match);
  const hasOwnOpenDispute = openDisputes.some((dispute) => dispute.by === app.currentUser.id);
  const matchApprovalOpen = Boolean(match.result && (["approval", "disputed"].includes(match.status) || (match.status === "agreed" && match.endedAt && !recordWindow.disputeExpired)));
  const canDispute = matchApprovalOpen && recordWindow.disputeOpen && currentUserCanFileDispute;
  const canRequestMatchDispute = canDispute && !hasOwnOpenDispute && getMatchRecordPlayerIds(match).includes(app.currentUser.id);
  const canRequestOwnPointDispute = hasReferee && canRequestMatchDispute;
  const canRequestScoreDispute = !hasReferee && canRequestMatchDispute;
  const canVoid = match.status === "disputed" && currentUserCanResolveDispute;
  const canRequestVoidRestore = canRequestVoidMatchRestore(match, app.currentUser.id);
  const canDeleteSoloRecord = isSoloRecord && match.createdBy === app.currentUser.id && match.status !== "cancelled";
  const requestFinalizeMatch = () => {
    if (isSharedRecord) return;
    if (isSoloRecord) {
      void app.actions.finalizeMatch?.(match.id);
      return;
    }
    setFinalizeDialogOpen(true);
  };
  const submitFinalizeMatch = async () => {
    if (finalizeActionPending) return;
    setFinalizeActionPending(true);
    try {
      const result = await app.actions.finalizeMatch?.(match.id);
      if (result?.ok !== false) setFinalizeDialogOpen(false);
    } finally {
      setFinalizeActionPending(false);
    }
  };
  const reportTime = getReportableMatchTimeMs(match);
  const canReport = !["cancelled", "void"].includes(match.status)
    && getReportableMatchUserIds(match).includes(app.currentUser.id)
    && reportTime >= Date.now() - REPORT_MATCH_WINDOW_MS
    && reportTime <= Date.now();
  const isContractStage = match.status === "contract";
  const shouldShowResultEntry =
    match.status === "approval" || Boolean(match.result) || (match.status === "agreed" && !recordWindow.beforeStart);
  const shouldShowWaitingPanel = false;
  const scoreA = getDisplayScore(match, "teamA");
  const scoreB = getDisplayScore(match, "teamB");
  const draftScoreA = Number(score.scoreA ?? scoreA);
  const draftScoreB = Number(score.scoreB ?? scoreB);
  const teamASide = getSafeMatchSide(match, "teamA");
  const teamBSide = getSafeMatchSide(match, "teamB");
  const teamA = app.state.teams.find((team) => team.id === teamASide.teamId);
  const teamB = app.state.teams.find((team) => team.id === teamBSide.teamId);
  const teamAMmr = teamA?.mmr ?? getTeamMmr(app.state.teams, teamASide.teamId);
  const teamBMmr = teamB?.mmr ?? getTeamMmr(app.state.teams, teamBSide.teamId);
  const winnerName = Number(scoreA) === Number(scoreB) ? "" : Number(scoreA) > Number(scoreB) ? teamASide.name : teamBSide.name;
  const currentUserDisputePoints = getMatchPlayerDisputePoints(match, app.currentUser.id);
  const matchKind = isSoloRecord ? "개인 기록" : isSharedRecord ? "경기 기록" : match.ranked === false ? "친선전" : "정규전";
  const recordLockReason = recordWindow.beforeStart
    ? "경기 시작 전"
    : recordWindow.beforeEnd
      ? canSubmitLiveResult ? "실시간 기록 가능" : "경기 종료 후 입력 가능"
    : currentUserCanSubmitMissingPostgameResult
      ? "결과 입력 필요"
    : recordWindow.statExpired
      ? "기록 입력 마감"
      : canEditDisputeDraft
        ? "이의 수정 가능"
      : match.status === "disputed"
        ? "이의 확인 중"
      : hasReferee && !currentUserIsReferee
        ? "심판만 입력"
        : !currentUserCanSubmit
          ? isSoloRecord ? "작성자만 입력" : "개인 스탯 미기록"
        : "입력 가능";
  const renderHeroRoster = (sideName) => {
    const team = getSafeMatchSide(match, sideName);
    const agreement = sideName === "teamA" ? teamAAgreement : teamBAgreement;
    const sideLeaderId = getMatchSideLeaderId(match, app.state.teams, sideName);

    return (
      <div className="gm-roster-row">
        {team.players.map((playerId) => {
          const user = userMap[playerId];
          const ready = agreement.approvals.includes(playerId) || match.status !== "contract";
          const sideLeader = sideLeaderId === playerId;
          const roleBadge = playerId === matchHostPlayerId
            ? { tone: "host", label: "방장" }
            : sideLeader
              ? { tone: "captain", label: "사이드장" }
              : null;
          const slotLabel = match.status === "contract"
            ? ready ? "동의" : "대기"
            : sideLeader ? "리더" : "참가";

          return (
            <PlayerHoverCard key={playerId} user={user} teams={app.state.teams} className={ready ? "gm-player-slot ready" : "gm-player-slot"}>
              {roleBadge ? (
                <span className={`gm-room-slot-crown ${roleBadge.tone}`} title={roleBadge.label} aria-label={roleBadge.label}>
                  <Crown size={12} strokeWidth={3} />
                </span>
              ) : null}
              <ProfileEmblem user={user} anonymous={isAnonymousDisplayUser(user)} initial={getAvatarInitial(user)} />
              <strong>{user?.name ?? "플레이어"}</strong>
              <small>{getPlayerMetaLabel(user)}</small>
              <em>{slotLabel}</em>
            </PlayerHoverCard>
          );
        })}
      </div>
    );
  };
  const renderHeroReserves = (sideName) => {
    if (benchCapacity <= 0) return null;
    const reservePlayerIds = getMatchReservePlayerIds(match, sideName).slice(0, benchCapacity);
    const openSlots = Math.max(0, benchCapacity - reservePlayerIds.length);
    const sideLeaderId = getMatchSideLeaderId(match, app.state.teams, sideName);

    return (
      <div className="gm-reserve-line">
        <strong>{sideName === "teamA" ? "A사이드" : "B사이드"} 후보 {reservePlayerIds.length}/{benchCapacity}</strong>
        <div className="gm-roster-row gm-reserve-row">
          {reservePlayerIds.map((playerId) => {
            const user = userMap[playerId];
            const roleBadge = playerId === matchHostPlayerId
              ? { tone: "host", label: "방장" }
              : sideLeaderId === playerId
                ? { tone: "captain", label: "사이드장" }
                : null;
            return (
              <PlayerHoverCard key={`${sideName}-reserve-${playerId}`} user={user} teams={app.state.teams} className="gm-player-slot reserve ready">
                {roleBadge ? (
                  <span className={`gm-room-slot-crown ${roleBadge.tone}`} title={roleBadge.label} aria-label={roleBadge.label}>
                    <Crown size={12} strokeWidth={3} />
                  </span>
                ) : null}
                <ProfileEmblem user={user} anonymous={isAnonymousDisplayUser(user)} initial={getAvatarInitial(user)} />
                <strong>{user?.name ?? "플레이어"}</strong>
                <small>{getPlayerMetaLabel(user)}</small>
                <em>SUB</em>
              </PlayerHoverCard>
            );
          })}
          {Array.from({ length: openSlots }).map((_item, index) => (
            <div key={`${sideName}-reserve-empty-${index}`} className="gm-player-slot reserve empty">
              <UsersRound size={18} />
              <strong>후보 슬롯</strong>
              <em>SUB</em>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const updatePlayerStat = (playerId, fieldId, value) => {
    const nextValue = Math.max(0, Number(value ?? 0));
    setScore((current) => ({
      ...current,
      playerStats: {
        ...current.playerStats,
        [playerId]: {
          ...(current.playerStats[playerId] ?? {}),
          [fieldId]: nextValue,
        },
      },
    }));
  };
  const submitResult = (event) => {
    event.preventDefault();
    if (!canSubmitResult) return;
    setResultSaveFeedback(canEditDisputeDraft ? "수정 중" : "저장 중");
    const result = app.actions.submitMatchResult(
      match.id,
      buildMatchResultSubmission(match, score, resultEntryPermission.getEditableStatFields, { editableScoreSides: resultEntryPermission.editableScoreSides }),
    );
    Promise.resolve(result).then((response) => {
      setResultSaveFeedback(response?.ok === false ? "경기 결과를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." : canEditDisputeDraft ? "수정되었습니다." : "저장되었습니다.");
    }).catch(() => setResultSaveFeedback("경기 결과를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요."));
  };
  const submitDispute = () => {
    if (canRequestScoreDispute) {
      app.actions.disputeMatch(match.id, {
        kind: "team_score",
        side: disputeRequestedSide,
        requestedScore: Number(disputeRequestedScore),
        reason: disputeCustomReason.trim() || disputeReason,
      });
      return;
    }
    if (!canRequestOwnPointDispute) return;
    app.actions.disputeMatch(match.id, buildMatchDisputeRequest({
      match,
      playerId: app.currentUser.id,
      playerName: app.currentUser.name,
      requestedPoints: disputeRequestedPoints,
      reason: disputeReason,
      customReason: disputeCustomReason,
    }));
  };
  const submitVoidMatch = async (reason) => {
    if (!canVoid || voidActionPending) return;
    setVoidActionPending(true);
    try {
      const result = await app.actions.voidMatch(match.id, reason);
      if (result?.ok === false) return;
      setVoidDialogOpen(false);
    } finally {
      setVoidActionPending(false);
    }
  };
  const submitVoidRestoreRequest = async () => {
    const detail = voidRestoreDetail.trim();
    if (!canRequestVoidRestore || detail.length < 10) return;
    setVoidRestoreStatus("접수 중");
    const targetUserId = getVoidMatchRestoreTargetUserId(match);
    const result = await app.actions.reportMatch(
      match.id,
      `${VOID_MATCH_RESTORE_REPORT_REASON}: ${detail}`,
      [targetUserId],
    );
    if (result && result.ok !== false) {
      setVoidRestoreStatus(result.duplicate ? "이미 접수된 요청이 있습니다." : "복구 심사 요청이 접수됐습니다.");
      if (!result.duplicate) setVoidRestoreDetail("");
    } else {
      setVoidRestoreStatus("복구 심사 요청을 접수하지 못했습니다.");
    }
  };
  const refreshMatchDetail = () => {
    if (matchDetailRefreshing) return;
    const loadMatchDetail = app.actions.loadMatchDetail;
    if (!loadMatchDetail) return;
    setMatchDetailRefreshing(true);
    Promise.resolve(loadMatchDetail(match.id)).then((count) => {
      setResultSaveFeedback(count ? "최신 경기 정보를 불러왔습니다." : "최신 경기 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }).catch(() => setResultSaveFeedback("최신 경기 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."))
      .finally(() => setMatchDetailRefreshing(false));
  };
  const canEditPlayerStat = (playerId) => canSubmitResult && resultEntryPermission.getEditableStatFields(playerId).length > 0;
  const editableStatFields = statEditorPlayerId ? resultEntryPermission.getEditableStatFields(statEditorPlayerId) : [];
  const getPlayerStatState = (playerId, submitted) => {
    if (canEditPlayerStat(playerId)) {
      if (hasReferee) return "심판 입력";
      return submitted ? "내 기록 수정" : "내 기록";
    }
    if (submitted) return "제출됨";
    return "미제출";
  };
  const permissionTitle = hasReferee
    ? `심판 ${referee?.name ?? "지정됨"}`
    : isSoloRecord
      ? "내 기록"
      : "팀 점수만 기록";
  const permissionDetail = hasReferee
    ? "심판만 전체 개인 활약 입력"
    : isSoloRecord
      ? "작성자 본인의 개인 스탯 입력"
      : match.rules?.gameClockEnabled === false
        ? "방장이 양쪽 팀 점수 입력"
        : "경기시계 담당자가 양쪽 팀 점수 입력";
  const nextAction = (() => {
    if (match.status === "contract") {
      if (currentUserSideName && !currentUserAgreementDone) {
        return {
          label: "동의하고 경기 준비",
          detail: "내 동의만 완료하면 됩니다.",
          button: "동의",
          type: "agree",
        };
      }
      return {
        label: "대기",
        detail: "남은 참가자가 모두 동의하면 예정 경기로 전환됩니다.",
      };
    }
    if (match.status === "agreed") {
      if (recordWindow.beforeEnd) {
        return {
          label: "경기 예정",
          detail: "경기가 종료되면 결과를 입력할 수 있습니다.",
        };
      }
      if (canSubmitResult) {
        return {
          label: "결과 입력",
          detail: permissionTitle,
          button: "입력",
          href: "#result-entry",
        };
      }
      return {
        label: recordLockReason,
        detail: permissionDetail,
      };
    }
    if (match.status === "approval") return {
      label: "최종 승인 대기",
      detail: isSharedRecord
        ? "각 참가자가 본인의 참가 사실을 확인합니다."
        : `${finalAuthorityLabel}이 최종 점수를 확인한 뒤 확정합니다.`,
    };
    if (match.status === "disputed") {
      return {
        label: "이의 확인",
        detail: openDisputes.length
          ? `${finalAuthorityLabel}이 이의제기 ${openDisputes.length}건을 사유와 함께 가결 또는 부결합니다.`
          : `이의 처리가 끝나면 ${finalAuthorityLabel}이 별도로 최종 승인합니다.`,
      };
    }
    if (match.status === "confirmed") {
      return {
        label: "확정 완료",
        detail: "MMR과 전적 반영이 완료되었습니다.",
      };
    }
    return {
      label: status.label,
      detail: "필요한 추가 작업은 접힌 메뉴에서 처리할 수 있습니다.",
    };
  })();
  const pointAuditA = getPointAudit(match, score, "teamA");
  const pointAuditB = getPointAudit(match, score, "teamB");
  const statTrustSteps = [
    {
      id: "self",
      label: hasReferee ? "심판 제출" : "본인 제출",
      detail: `${statSubmissionStatus.submitted}/${statSubmissionStatus.total}명 제출`,
      complete: statSubmissionStatus.complete,
    },
    {
      id: "points",
      label: "득점 합계",
      detail: `A ${pointAuditA.statPoints}/${pointAuditA.teamScore} · B ${pointAuditB.statPoints}/${pointAuditB.teamScore}`,
      complete: pointAuditA.matched && pointAuditB.matched,
    },
    {
      id: "evidence",
      label: "증거",
      detail: `${activeEvidenceCount}개 첨부`,
      complete: activeEvidenceCount > 0,
    },
  ];
  const statTrustPercent = Math.round((statTrustSteps.filter((step) => step.complete).length / statTrustSteps.length) * 100);
  const courtReviewParticipantIds = getMatchReviewParticipantIds(match);
  const courtReviewMatchFinished = Boolean(match.endedAt || match.result || ["approval", "disputed", "confirmed"].includes(match.status));
  const canSubmitCourtReview = courtReviewMatchFinished && !["void", "cancelled"].includes(match.status) && courtReviewParticipantIds.includes(app.currentUser.id);
  const courtReviewRatingReady = Number(courtReviewDraft.rating) > 0;
  const updateCourtReviewDraft = (patch) => setCourtReviewDraft((current) => ({ ...current, ...patch }));
  const submitCourtReview = async () => {
    if (!canSubmitCourtReview || !courtReviewRatingReady || courtReviewSaving) return;
    setCourtReviewSaving(true);
    setCourtReviewSaveFeedback("저장 중");
    try {
      const savedReview = await app.actions.submitCourtReview(match.id, courtReviewDraft);
      setCourtReviewSaveFeedback(savedReview ? "저장되었습니다." : "구장 후기를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } catch {
      setCourtReviewSaveFeedback("구장 후기를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setCourtReviewSaving(false);
    }
  };
  const deleteSoloRecord = () => {
    if (!canDeleteSoloRecord) return;
    setSoloRecordDeleteOpen(true);
  };
  const confirmDeleteSoloRecord = () => {
    if (!canDeleteSoloRecord) return;
    setSoloRecordDeleteOpen(false);
    app.actions.deleteSoloRecord?.(match.id);
  };
  const normalizedRules = normalizeMatchRules(match.rules, { mode: match.mode });
  const ruleItems = [
    ...getMatchRuleDetailRows(normalizedRules, match.mode).map((row) => [row.label, row.value]),
    ["만남 장소", getMeetingPointSummary(normalizedRules, match.timingType, match.mode)],
    ["공격권", match.rules?.attackRule ?? "득점 후 공격권 교대"],
    ["파울 룰", match.rules?.foulRule ?? "현장 합의"],
    ["운영 권한", operationSummary],
    ["이의제기", `${normalizeDisputeWindowMinutes(match.disputeMinutes)}분`],
    ["티어 반영", isSoloRecord ? "개인 기록 · MMR 미반영" : match.ranked === false ? "친선 · 티어 자유" : `정규 · MMR ${Math.round((match.ratingScale ?? match.rules?.ratingScale ?? 1) * 100)}%`],
  ];

  return (
    <div className="page-stack match-room">
      <section className={match.ranked === false ? "gm-room-hero gm-friendly" : "gm-room-hero gm-ranked"}>
        <div className="gm-room-topline">
          <div className="badge-row">
            <Badge tone={isSoloRecord ? "green" : match.ranked === false ? "neutral" : "gold"}>{matchKind}</Badge>
            <Badge tone={status.tone}>{status.label}</Badge>
            {match.preRegistered ? <Badge tone="green">사전등록</Badge> : null}
          </div>
          <span>{match.mode}</span>
        </div>

        <div className="gm-room-title">
          <span>{match.official ? "OFFICIAL ROOM" : "CUSTOM ROOM"}</span>
          <h1>{matchKind}</h1>
          <p><MapPin size={16} />{match.court} · {match.scheduledAt}</p>
        </div>

        <div className="gm-versus-stage">
          <div className="gm-team-panel team-a">
            <div className="gm-team-head">
              <span>HOME TEAM</span>
              <TeamHoverCard team={teamA} to={teamASide.teamId ? `/app/teams/${teamASide.teamId}` : undefined}>{teamASide.name}</TeamHoverCard>
              <em>{teamAMmr || "-"} MMR</em>
            </div>
            {renderHeroRoster("teamA")}
          </div>

          <div className="gm-score-core">
            <strong>{scoreA}</strong>
            <i>VS</i>
            <strong>{scoreB}</strong>
            <span>{winnerName ? `${winnerName} 우세` : "전투 준비"}</span>
          </div>

          <div className="gm-team-panel team-b">
            <div className="gm-team-head">
              <span>OPPONENT</span>
              <TeamHoverCard team={teamB} to={teamBSide.teamId ? `/app/teams/${teamBSide.teamId}` : undefined}>{teamBSide.name}</TeamHoverCard>
              <em>{teamBMmr || "-"} MMR</em>
            </div>
            {renderHeroRoster("teamB")}
          </div>
        </div>

        {benchCapacity > 0 ? <div className="gm-reserve-panel">
          {renderHeroReserves("teamA")}
          {renderHeroReserves("teamB")}
        </div> : null}

        <div className="gm-room-actions">
          <div><CalendarDays size={17} /><span>{match.scheduledDate ?? "일정"} {match.scheduledTime ?? ""}</span></div>
          <div><UsersRound size={17} /><span>{teamASide.players.length} vs {teamBSide.players.length}</span></div>
          <div><ShieldCheck size={17} /><span>{match.ranked === false ? "티어 자유" : "MMR 반영"}</span></div>
          <div><Trophy size={17} /><span>{match.rules?.targetScore ?? 21}점 · {match.rules?.timeLimit ?? 12}분</span></div>
        </div>
      </section>

      {soloRecordDeleteOpen ? (
        <div className="app-confirm-backdrop" role="presentation" onMouseDown={() => setSoloRecordDeleteOpen(false)}>
          <div className="app-confirm-dialog" role="dialog" aria-modal="true" aria-label="개인 기록 삭제 확인" onMouseDown={(event) => event.stopPropagation()}>
            <strong>개인 기록 삭제</strong>
            <p>삭제하면 내 기록 목록에서 사라집니다. MMR은 변하지 않습니다.</p>
            <div className="app-confirm-actions">
              <Button type="button" variant="secondary" onClick={() => setSoloRecordDeleteOpen(false)}>취소</Button>
              <Button type="button" variant="primary" className="danger-button" onClick={confirmDeleteSoloRecord}>삭제하기</Button>
            </div>
          </div>
        </div>
      ) : null}

      <Card className="gm-next-action-card">
        <div>
          <span>NEXT</span>
          <strong>{nextAction.label}</strong>
          <em>{nextAction.detail}</em>
        </div>
        {canFinalizeMatch ? (
          <Button type="button" onClick={requestFinalizeMatch}>최종 승인</Button>
        ) : nextAction.type === "agree" ? (
          <Button type="button" onClick={() => app.actions.agreeMatch(match.id, currentUserSideName, app.currentUser.id)}>{nextAction.button}</Button>
        ) : nextAction.href ? (
          <Button as="a" href={nextAction.href}>{nextAction.button}</Button>
        ) : (
          <Badge tone={status.tone}>{status.label}</Badge>
        )}
      </Card>

      <Card className="section-card gm-rule-summary-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Match rules</p>
              <h2>경기 룰</h2>
            </div>
            <Badge tone={isSoloRecord ? "green" : match.ranked === false ? "neutral" : "gold"}>{matchKind}</Badge>
          </div>
          <div className="contract-grid">
            {ruleItems.map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        </Card>

      {isMatchHost || (startedAuthorityPhase && currentUserIsEligibleReferee) ? (
        <Card className="section-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">{hasReferee && startedAuthorityPhase ? "Referee controls" : "Host controls"}</p>
              <h2>{hasReferee && startedAuthorityPhase ? "심판 권한" : "방장 권한"}</h2>
            </div>
            <Badge tone={canCancel || canDeleteSoloRecord ? "orange" : "neutral"}>{canDeleteSoloRecord ? "삭제 가능" : canCancel ? "취소 가능" : "잠김"}</Badge>
          </div>
          <p className="muted">{canDeleteSoloRecord ? "이 개인 기록은 내 기록에서 삭제할 수 있습니다." : canCancel ? `현재 운영 권한으로 ${cancelCopy.actionLabel}가 가능합니다.` : `현재 단계에서는 ${cancelCopy.actionLabel}가 잠겼습니다.`}</p>
          <Button type="button" variant="secondary" className="danger-button" disabled={!canCancel} onClick={() => app.actions.cancelMatch(match.id)}>{cancelCopy.actionLabel}</Button>
          {canDeleteSoloRecord ? (
            <Button type="button" variant="secondary" className="danger-button" onClick={deleteSoloRecord}>개인 기록 삭제</Button>
          ) : null}
        </Card>
      ) : null}

      {matchPhase === "live" && match.rules?.gameClockEnabled !== false ? (
        <MatchClockPanel
          match={match}
          onMatchEnded={() => void refreshMatchDetail()}
          onRosterChanged={() => void refreshMatchDetail()}
          editableScoreSides={resultEntryPermission.editableScoreSides}
          onIncrementScore={(sideName, delta, revisions) => app.actions.incrementMatchScore?.(
            match.id,
            sideName === "teamA" ? delta : 0,
            sideName === "teamB" ? delta : 0,
            revisions,
          )}
        />
      ) : null}
      {matchPhase === "live" && normalizedRules.gameClockEnabled === false && resultEntryPermission.editableScoreSides.length ? (
        <MatchScoreControls
          match={match}
          editableScoreSides={resultEntryPermission.editableScoreSides}
          onIncrementScore={(sideName, delta, revisions) => app.actions.incrementMatchScore?.(
            match.id,
            sideName === "teamA" ? delta : 0,
            sideName === "teamB" ? delta : 0,
            revisions,
          )}
        />
      ) : null}
      {isContractStage ? (
        <div className="content-grid match-stage-contract">
          <div className="page-stack">
            <MatchContract match={match} users={app.state.users} teams={app.state.teams} matches={app.state.matches} />
            <AgreementPanel
              match={match}
              teams={app.state.teams}
              users={app.state.users}
              currentUserId={app.currentUser.id}
              onAgree={(sideName, playerId) => app.actions.agreeMatch(match.id, sideName, playerId)}
            />
          </div>
        </div>
      ) : (
        <div className="content-grid wide-left">
          <div className="page-stack">
            {shouldShowWaitingPanel ? (
              <Card className="section-card match-waiting-card">
                <div className="section-title-row">
                  <div>
                    <p className="eyebrow">Match state</p>
                    <h2>경기 시작 대기</h2>
                  </div>
                  <Badge tone={status.tone}>{status.label}</Badge>
                </div>
                <div className="ui-empty-state-compact">경기가 종료되면 결과를 입력할 수 있습니다.</div>
              </Card>
            ) : null}
            {(hasReferee || isSoloRecord) && shouldShowResultEntry ? (
            <Card id="result-entry" className="section-card result-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Result entry</p>
                <h2>경기 결과 입력</h2>
              </div>
              <Badge tone={canSubmitResult ? "green" : recordWindow.statExpired ? "orange" : "neutral"}>{recordLockReason}</Badge>
            </div>
            {!canSubmitResult ? (
              <div className="ui-empty-state-compact">{match.status === "contract" ? "동의 필요" : "수정 잠김"}</div>
            ) : null}
            <div className="stat-referee-panel">
              <div>
                <span>기록 권한</span>
                <strong>
                  {hasReferee && referee ? (
                    <RefereeHoverCard user={referee} matches={app.state.matches} minTrust={match.refereeTrustMin} className="stat-referee-trigger">
                      심판 {referee.name}
                    </RefereeHoverCard>
                  ) : permissionTitle}
                </strong>
                <em>{permissionDetail}</em>
              </div>
              <div>
                <span>개인 기록 마감</span>
                <strong>{formatWindowTime(recordWindow.statClosesAt)}</strong>
                <em>경기 종료 후 {match.statEntryMinutes ?? 60}분</em>
              </div>
              <div>
                <span>이의제기 마감</span>
                <strong>{formatWindowTime(recordWindow.disputeClosesAt)}</strong>
                <em>경기 종료 후 {normalizeDisputeWindowMinutes(match.disputeMinutes)}분</em>
              </div>
            </div>
            {match.endedAt && resultEntryPermission.editableScoreSides.length ? (
              <MatchScoreControls
                match={match}
                label="최종 팀 점수"
                editableScoreSides={resultEntryPermission.editableScoreSides}
                onIncrementScore={(sideName, delta, revisions) => app.actions.incrementMatchScore?.(
                  match.id,
                  sideName === "teamA" ? delta : 0,
                  sideName === "teamB" ? delta : 0,
                  revisions,
                )}
              />
            ) : null}
            <form className="score-form" onSubmit={submitResult}>
              <label>
                {teamASide.name}
                <input type="number" min="0" max="999" aria-label={`${teamASide.name} 팀 점수`} disabled value={draftScoreA} readOnly />
              </label>
              <span>:</span>
              <label>
                {teamBSide.name}
                <input type="number" min="0" max="999" aria-label={`${teamBSide.name} 팀 점수`} disabled value={draftScoreB} readOnly />
              </label>
              <div className="match-action-row stat-entry-actions">
                <Button type="button" variant="secondary" disabled={matchDetailRefreshing} onClick={refreshMatchDetail}>
                  <RotateCcw size={16} />
                  새로고침
                </Button>
                <Button type="submit" disabled={!canSubmitResult}>
                  {canEditDisputeDraft ? "이의 수정안 저장" : canSubmitLiveResult ? "실시간 기록 저장" : hasReferee ? "심판 기록 제출" : currentUserSubmitted ? "내 기록 다시 제출" : "내 기록 제출"}
                </Button>
              </div>
              {resultSaveFeedback ? <div className="stat-save-feedback">{resultSaveFeedback}</div> : null}
              <div className="stat-integrity-note">
                팀 점수와 개인 PTS 합계는 별도로 저장합니다. 값이 다르면 최종 확정 전에 경고만 표시합니다.
              </div>
              <div className="stat-trust-panel">
                <div className="stat-trust-head">
                  <div>
                    <strong>개인 기록 신뢰도</strong>
                    <span>{hasReferee ? "심판 제출 상태, 득점 합계, 증거 첨부를 함께 확인합니다." : "본인 제출 상태와 득점 합계, 증거 첨부를 함께 확인합니다."}</span>
                  </div>
                  <Badge tone={statTrustPercent >= 75 ? "green" : statTrustPercent >= 50 ? "orange" : "neutral"}>{statTrustPercent}%</Badge>
                </div>
                <div className="stat-trust-grid">
                  {statTrustSteps.map((step) => (
                    <div key={step.id} className={step.complete ? "complete" : ""}>
                      <strong>{step.label}</strong>
                      <span>{step.detail}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="stat-entry-grid compact-stat-entry">
                {MATCH_SIDES.map((sideName) => (
                  <div key={sideName} className="stat-entry-side">
                    <h3>{(sideName === "teamA" ? teamASide : teamBSide).name} 개인 기록</h3>
                    {getMatchSideRecordPlayerIds(match, sideName).map((playerId, index) => {
                      const user = userMap[playerId];
                      const displayName = getRecordPlayerDisplayName(match, sideName, playerId, index, user);
                      const displayUser = user ?? { id: playerId, name: displayName, position: "-" };
                      const canEdit = canEditPlayerStat(playerId);
                      const submitted = getPlayerStatSubmitted(match, playerId);
                      return (
                        <button key={playerId} type="button" className={`${canEdit ? "stat-player-button editable" : "stat-player-button locked"} ${submitted ? "submitted" : ""}`} disabled={!canEdit} onClick={() => setStatEditorPlayerId(playerId)}>
                          <PlayerHoverCard as="span" user={displayUser} teams={app.state.teams}>
                            <ProfileEmblem user={displayUser} anonymous={isAnonymousDisplayUser(displayUser)} className="small" initial={getAvatarInitial(displayUser)} />
                            <span>
                              <strong>{displayName}</strong>
                              <em>{canEdit ? formatStatLine(score.playerStats[playerId]) : `${getPlayerMetaLabel(displayUser)} · ${getPlayerStatState(playerId, submitted)}`}</em>
                            </span>
                          </PlayerHoverCard>
                          <strong>{getPlayerStatState(playerId, submitted)}</strong>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </form>
            </Card>
            ) : null}
            {!hasReferee && !isSoloRecord && match.endedAt && shouldShowResultEntry ? (
              <Card id="result-entry" className="section-card result-card">
                <div className="section-title-row">
                  <div>
                    <p className="eyebrow">Score only</p>
                    <h2>팀 점수</h2>
                  </div>
                  <Badge tone={canFinalizeMatch ? "green" : "neutral"}>개인 스탯 미기록</Badge>
                </div>
                {isSharedRecord && match.rules?.recordSetupReady === true && resultEntryPermission.editableScoreSides.length ? (
                  <MatchScoreControls
                    match={match}
                    label="사후 기록 팀 점수"
                    editableScoreSides={resultEntryPermission.editableScoreSides}
                    onIncrementScore={(sideName, delta, revisions) => app.actions.incrementMatchScore?.(
                      match.id,
                      sideName === "teamA" ? delta : 0,
                      sideName === "teamB" ? delta : 0,
                      revisions,
                    )}
                  />
                ) : (
                  <div className="arena-dispute-score-row">
                    {MATCH_SIDES.map((sideName) => {
                      const side = sideName === "teamA" ? teamASide : teamBSide;
                      const sideScore = sideName === "teamA" ? scoreA : scoreB;
                      return (
                        <div key={sideName}>
                          <span>{side.name}</span>
                          <strong>{sideScore}</strong>
                        </div>
                      );
                    })}
                  </div>
                )}
                {canFinalizeMatch ? <Button type="button" onClick={requestFinalizeMatch}>최종 승인</Button> : null}
              </Card>
            ) : null}
            {isSharedRecord && match.rules?.recordSetupReady === true ? (
              <ApprovalPanel
                match={match}
                teams={app.state.teams}
                users={app.state.users}
                currentUserId={app.currentUser.id}
                onApprove={(sideName, playerId) => app.actions.approveMatch(match.id, sideName, playerId)}
              />
            ) : null}
          </div>
          <aside className="page-stack">
          <Card className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">티어 반영</p>
                <h2>MMR 변동</h2>
              </div>
            </div>
            {match.ratingResult ? (
              <div className="delta-list">
                {match.ratingResult.map((change) => {
                  const user = app.state.users.find((item) => item.id === change.playerId);
                  return (
                    <div key={`${change.playerId}-${change.side}`} className="delta-row">
                      <Link to={`/app/players/${change.playerId}`}>{user?.name ?? "플레이어"}</Link>
                      <MmrChange value={change.integratedDelta} label="통합" />
                      <MmrChange value={change.modeDelta} label={match.mode} />
                      {change.statBoost ? <MmrChange value={change.statBoost} label="스탯" /> : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="ui-empty-state-compact">승인 대기</div>
            )}
          </Card>
          <MatchRecommendationPanel
            match={match}
            currentUserId={app.currentUser.id}
            users={app.state.users}
            teams={app.state.teams}
            onSubmit={app.actions.submitMatchThumbs}
          />
          {canSubmitCourtReview || existingCourtReview ? (
            <Card className="section-card court-review-card">
              <div className="section-title-row">
                <div>
                  <p className="eyebrow">Court review</p>
                  <h2>구장 리뷰</h2>
                </div>
                <Badge tone={existingCourtReview ? "gold" : canSubmitCourtReview ? "green" : "neutral"}>{existingCourtReview ? "제출됨" : canSubmitCourtReview ? "작성 가능" : "잠김"}</Badge>
              </div>
              <p className="muted">{match.court}에서 경기한 참가자만 남길 수 있습니다. 별점은 구장 카드 평균에 반영됩니다.</p>
              <CourtReviewRating label="종합 별점" value={courtReviewDraft.rating} disabled={!canSubmitCourtReview} onChange={(rating) => updateCourtReviewDraft({ rating })} />
              <div className="court-review-detail-grid">
                {COURT_REVIEW_FIELDS.map((field) => (
                  <CourtReviewRating
                    key={field.id}
                    label={field.label}
                    value={courtReviewDraft[field.id]}
                    disabled={!canSubmitCourtReview}
                    onChange={(rating) => updateCourtReviewDraft({ [field.id]: rating })}
                  />
                ))}
              </div>
              <label className="memo-label">
                짧은 메모
                <textarea
                  disabled={!canSubmitCourtReview}
                  value={courtReviewDraft.memo}
                  onChange={(event) => updateCourtReviewDraft({ memo: event.target.value })}
                  placeholder="바닥, 림, 조명, 위치 특이사항"
                />
              </label>
              <Button type="button" disabled={!canSubmitCourtReview || !courtReviewRatingReady || courtReviewSaving} onClick={submitCourtReview}>
                <Star size={16} /> {existingCourtReview ? "리뷰 수정" : "리뷰 제출"}
              </Button>
              {courtReviewSaveFeedback ? <p className="muted">{courtReviewSaveFeedback}</p> : null}
            </Card>
          ) : null}
          <Card className="section-card">
            <div className="contract-grid single">
              {!isSharedRecord ? (
                <>
                  <div>
                    <span>{MATCH_SIDE_FALLBACK_NAMES.teamA} 동의</span>
                    <strong>{teamAAgreement.approvals.length}/{teamAAgreement.majority}</strong>
                  </div>
                  <div>
                    <span>{MATCH_SIDE_FALLBACK_NAMES.teamB} 동의</span>
                    <strong>{teamBAgreement.approvals.length}/{teamBAgreement.majority}</strong>
                  </div>
                </>
              ) : null}
              <div>
                <span>현재 상태</span>
                <strong>{status.label}</strong>
              </div>
            </div>
          </Card>
          <Card className="section-card review-controls-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Review controls</p>
                <h2>보류와 취소</h2>
              </div>
              <Badge tone={canDispute || canCancel || canVoid ? "orange" : "neutral"}>{recordWindow.disputeExpired ? "이의 마감" : canDispute || canCancel || canVoid ? "처리 가능" : "닫힘"}</Badge>
            </div>
            <MatchDisputeQueue
              match={match}
              userById={userMap}
              canResolve={currentUserCanResolveDispute}
              onResolve={(disputeId, decision, resolutionReason) => app.actions.resolveMatchDispute(match.id, disputeId, decision, resolutionReason)}
              onRefresh={currentUserCanRefreshReview ? refreshMatchDetail : null}
              refreshing={matchDetailRefreshing}
            />
            {match.status === "void" ? (
              <div className="match-void-summary">
                <strong>경기 무효 사유</strong>
                <p>{match.voidReason || "사유를 불러오지 못했습니다."}</p>
                {canRequestVoidRestore ? (
                  <label className="memo-label">
                    관리자 복구 심사 요청
                    <textarea
                      value={voidRestoreDetail}
                      maxLength={500 - VOID_MATCH_RESTORE_REPORT_REASON.length - 2}
                      placeholder="복구가 필요한 이유와 확인할 내용을 10자 이상 작성"
                      onChange={(event) => setVoidRestoreDetail(event.target.value)}
                    />
                    <Button type="button" variant="secondary" disabled={voidRestoreDetail.trim().length < 10 || voidRestoreStatus === "접수 중"} onClick={submitVoidRestoreRequest}>
                      무효 경기 복구 요청
                    </Button>
                    {voidRestoreStatus ? <small role="status">{voidRestoreStatus}</small> : null}
                  </label>
                ) : null}
              </div>
            ) : null}
            <p className="muted">이의제기 마감: {formatWindowTime(recordWindow.disputeClosesAt)}</p>
            <Button type="button" variant="secondary" onClick={() => setReviewControlsOpen((current) => !current)}>
              {reviewControlsOpen ? "보조 메뉴 닫기" : "취소/이의/신고 열기"}
            </Button>
            {reviewControlsOpen ? (
              <>
                <div className="dispute-score-request">
                  <div>
                    <span>점수판</span>
                    <strong>{scoreA} : {scoreB}</strong>
                  </div>
                  {hasReferee ? <label>
                    내 득점
                    <input
                      type="number"
                      min="0"
                      disabled={!canRequestOwnPointDispute}
                      value={disputeRequestedPoints}
                      onChange={(event) => setDisputeRequestedPoints(event.target.value)}
                    />
                    <em>현재 {currentUserDisputePoints}점</em>
                  </label> : <>
                    <label>
                      이의 대상
                      <select
                        disabled={!canRequestScoreDispute}
                        value={disputeRequestedSide}
                        onChange={(event) => {
                          const nextSide = event.target.value;
                          setDisputeRequestedSide(nextSide);
                          setDisputeRequestedScore(String(nextSide === "teamA" ? scoreA : scoreB));
                        }}
                      >
                        <option value="teamA">{teamASide.name}</option>
                        <option value="teamB">{teamBSide.name}</option>
                      </select>
                    </label>
                    <label>
                      요청 점수
                      <input type="number" min="0" max="999" disabled={!canRequestScoreDispute} value={disputeRequestedScore} onChange={(event) => setDisputeRequestedScore(event.target.value)} />
                    </label>
                  </>}
                </div>
                <label className="memo-label">
                  이의제기 사유
                  <select disabled={!canRequestMatchDispute} value={disputeReason} onChange={(event) => setDisputeReason(event.target.value)}>
                    {MATCH_DISPUTE_REASON_OPTIONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
                  </select>
                </label>
                {disputeReason === OTHER_MATCH_DISPUTE_REASON ? (
                  <label className="memo-label">
                    기타 사유
                    <textarea disabled={!canRequestMatchDispute} value={disputeCustomReason} onChange={(event) => setDisputeCustomReason(event.target.value)} />
                  </label>
                ) : null}
                <label className="memo-label">
                  신고 사유
                  <select disabled={!canReport} value={reportReason} onChange={(event) => setReportReason(event.target.value)}>
                    {REPORT_REASONS.filter((reason) => (
                      reason !== VOID_MATCH_RESTORE_REPORT_REASON
                      && [REPORT_TARGET_TYPES.player, REPORT_TARGET_TYPES.match, REPORT_TARGET_TYPES.mixed].includes(getReportTargetType(reason))
                    )).map((reason) => <option key={reason} value={reason}>{reason}</option>)}
                  </select>
                </label>
                <div className="match-action-row">
                  <Button type="button" variant="secondary" disabled={!canRequestMatchDispute} onClick={submitDispute}>{hasOwnOpenDispute ? "처리 대기 중" : "이의제기"}</Button>
                  <Button type="button" variant="secondary" className="danger-button" disabled={!canCancel} onClick={() => app.actions.cancelMatch(match.id)}>{cancelCopy.actionLabel}</Button>
                  <Button type="button" variant="secondary" className="danger-button" disabled={!canVoid} onClick={() => setVoidDialogOpen(true)}>경기 무효 처리</Button>
                  <Button type="button" variant="secondary" disabled={!canReport} onClick={() => app.actions.reportMatch(match.id, reportReason)}>신고 접수</Button>
                </div>
              </>
            ) : null}
          </Card>
          {match.result && (hasReferee || isSoloRecord) ? (
            <Card className="section-card">
              <div className="section-title-row">
                <div>
                  <p className="eyebrow">개인 기록</p>
                  <h2>개인 스탯 요약</h2>
                </div>
              </div>
              <div className="compact-list">
                {getRecordPlayerEntries(match).map(({ sideName, playerId, index }) => {
                  const user = userMap[playerId];
                  const displayName = getRecordPlayerDisplayName(match, sideName, playerId, index, user);
                  return (
                    <div key={`${sideName}-${playerId}`}>
                      <span>{displayName}</span>
                      <strong>{formatStatLine(score.playerStats[playerId])}</strong>
                    </div>
                  );
                })}
              </div>
            </Card>
          ) : null}
          <ShareCard user={app.currentUser} />
          </aside>
        </div>
      )}
      {statEditorPlayer && (hasReferee || isSoloRecord) ? (
        <div className="modal-backdrop stat-editor-backdrop" onClick={() => setStatEditorPlayerId(null)}>
          <div className="modal stat-editor-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">개인 기록</p>
                <h2>{statEditorPlayer.name}</h2>
                <span>{formatStatLine(score.playerStats[statEditorPlayerId])}</span>
              </div>
              <button type="button" className="button button-secondary button-icon" onClick={() => setStatEditorPlayerId(null)} aria-label="닫기">
                <X size={18} />
              </button>
            </div>
            <div className="stat-stepper-list">
              {editableStatFields.map((field) => (
                <div key={field.id} className="stat-stepper-row">
                  <div>
                    <strong>{field.label}</strong>
                    <span>{field.shortLabel}</span>
                  </div>
                  <NumericStepper
                    className="stat-numeric-stepper"
                    disabled={!canEditPlayerStat(statEditorPlayerId)}
                    label={field.label}
                    value={score.playerStats[statEditorPlayerId]?.[field.id] ?? 0}
                    onChange={(value) => updatePlayerStat(statEditorPlayerId, field.id, value)}
                  />
                </div>
              ))}
            </div>
            <Button type="button" onClick={() => setStatEditorPlayerId(null)}>완료</Button>
          </div>
        </div>
      ) : null}
      <MatchVoidDialog
        open={voidDialogOpen}
        pending={voidActionPending}
        onClose={() => setVoidDialogOpen(false)}
        onConfirm={submitVoidMatch}
      />
      <MatchFinalizeDialog
        open={finalizeDialogOpen}
        pending={finalizeActionPending}
        openDisputeCount={openDisputes.length}
        authorityLabel={finalAuthorityLabel}
        onClose={() => setFinalizeDialogOpen(false)}
        onConfirm={submitFinalizeMatch}
      />
    </div>
  );
}
