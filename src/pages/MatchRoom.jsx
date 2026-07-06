import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { CalendarDays, Crown, MapPin, Minus, Plus, RotateCcw, ShieldCheck, Star, ThumbsUp, Trophy, UsersRound, X } from "lucide-react";
import AgreementPanel from "../components/match/AgreementPanel.jsx";
import ApprovalPanel from "../components/match/ApprovalPanel.jsx";
import BasketballLoader from "../components/common/BasketballLoader.jsx";
import MatchContract from "../components/match/MatchContract.jsx";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import PlayerHoverCard from "../components/profile/PlayerHoverCard.jsx";
import MmrChange from "../components/rating/MmrChange.jsx";
import RefereeHoverCard from "../components/referee/RefereeHoverCard.jsx";
import ShareCard from "../components/share/ShareCard.jsx";
import TeamHoverCard from "../components/team/TeamHoverCard.jsx";
import useBodyScrollLock from "../hooks/useBodyScrollLock.js";
import { DISPUTE_WINDOW_MINUTES, EVIDENCE_OPTIONS, PLAYER_STAT_FIELDS } from "../lib/constants.js";
import { DEFAULT_REPORT_REASON, REPORT_REASONS } from "../lib/reportReasons.js";
import {
  formatStatLine,
  MATCH_DISPUTE_REASON_OPTIONS,
  OTHER_MATCH_DISPUTE_REASON,
  buildMatchDisputeRequest,
  canOperatorSubmitMissingPostgameResult,
  getAllowedResultStatFields,
  getAgreementStatus,
  getApprovalStatus,
  getMatchHostPlayerId,
  getMatchPlayerDisputePoints,
  getMatchRecordWindow,
  getMatchReferee,
  getMatchRecordPlayerIds,
  getMatchRoomPhase,
  getMatchPlayerIds,
  getMatchReservePlayerIds,
  getMatchSideLeaderId,
  getMatchSidePlayerIds,
  getMatchSideRecordPlayerIds,
  getMatchTrustFeedbackClosesAt,
  getMatchTrustFeedbackLimit,
  getMatchTrustFeedbackParticipantIds,
  getEffectiveStatRecorders,
  getPlayerSideName,
  getPlayerStatSubmitted,
  getResultPointAudit,
  getStatRecorderSides,
  getStatSubmissionStatus,
  isEligibleReferee,
  isMatchReferee,
  isMatchStatRecorder,
  isMatchTrustFeedbackOpen,
} from "../lib/matchUtils.js";
import "../styles/matchroom-arena.css";

const statusMeta = {
  contract: { label: "대기", tone: "blue" },
  agreed: { label: "진행 예정", tone: "green" },
  approval: { label: "결과 승인 대기", tone: "orange" },
  disputed: { label: "이의제기 보류", tone: "orange" },
  confirmed: { label: "확정 완료", tone: "green" },
  void: { label: "무효 처리", tone: "neutral" },
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

function getSafeMatchSide(match, sideName) {
  const fallbackName = sideName === "teamA" ? "A" : "B";
  const side = match?.[sideName] ?? {};
  return {
    ...side,
    name: side.name || fallbackName,
    teamId: side.teamId || "",
    players: Array.isArray(side.players) ? side.players : [],
  };
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

function getAvatarClassName(user = null, size = "") {
  return ["avatar", size, isAnonymousDisplayUser(user) ? "anonymous" : ""].filter(Boolean).join(" ");
}

function getAvatarInitial(user = null, fallback = "P") {
  return isAnonymousDisplayUser(user) ? "?" : (user?.name?.slice(0, 1) ?? fallback);
}

function getPlayerMetaLabel(user = null) {
  const position = user?.position ?? "-";
  return user?.participationLabel ? `${position} · ${user.participationLabel}` : position;
}

function getRecordPlayerEntries(match = {}, includeReserves = false) {
  return ["teamA", "teamB"].flatMap((sideName) => (
    getMatchSideRecordPlayerIds(match, sideName, includeReserves).map((playerId, index) => ({ sideName, playerId, index }))
  ));
}

function getPointAudit(match, score, sideName) {
  const scoreKey = sideName === "teamA" ? "scoreA" : "scoreB";
  const teamScore = Number(score[scoreKey] ?? 0);
  const statPoints = getMatchSideRecordPlayerIds(match, sideName).reduce((sum, playerId) => sum + Number(score.playerStats[playerId]?.points ?? 0), 0);
  return {
    teamScore,
    statPoints,
    matched: teamScore === statPoints,
  };
}

function formatWindowTime(value) {
  if (!value) return "일정 없음";
  return value.toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getTrustFeedbackRole(match, playerId) {
  const roles = [];
  if (match.createdBy === playerId || match.hostPlayerId === playerId || match.createdPlayerId === playerId || match.teamA?.players?.[0] === playerId) roles.push("방장");
  if (match.refereeId === playerId) roles.push("심판");
  const recorders = getEffectiveStatRecorders(match);
  if (Object.values(recorders).includes(playerId)) roles.push("기록자");
  if (getMatchPlayerIds(match).includes(playerId)) roles.push("선수");
  if (["teamA", "teamB"].some((sideName) => getMatchReservePlayerIds(match, sideName).includes(playerId))) roles.push("후보");
  return roles.length ? roles.join(" · ") : "관계자";
}

const COURT_REVIEW_FIELDS = [
  { id: "surfaceRating", label: "바닥" },
  { id: "rimRating", label: "림/골대" },
  { id: "lightingRating", label: "조명" },
  { id: "crowdRating", label: "혼잡도" },
  { id: "locationAccuracy", label: "위치 정확도" },
];

function getCourtReviewDraft(review = {}) {
  return {
    rating: review.rating ?? 0,
    surfaceRating: review.surfaceRating ?? "",
    rimRating: review.rimRating ?? "",
    lightingRating: review.lightingRating ?? "",
    crowdRating: review.crowdRating ?? "",
    locationAccuracy: review.locationAccuracy ?? "",
    memo: review.memo ?? "",
  };
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
  const match = useMemo(
    () => app.state.matches.find((item) => item?.id === matchId) ?? null,
    [app.state.matches, matchId],
  );
  const requestedMatchIdRef = useRef("");
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
  const [reportReason, setReportReason] = useState(DEFAULT_REPORT_REASON);
  const [statEditorPlayerId, setStatEditorPlayerId] = useState(null);
  const [reviewControlsOpen, setReviewControlsOpen] = useState(false);
  const [thumbDraftPlayerIds, setThumbDraftPlayerIds] = useState([]);
  const [resultSaveFeedback, setResultSaveFeedback] = useState("");
  const [matchDetailRefreshing, setMatchDetailRefreshing] = useState(false);
  const [soloRecordDeleteOpen, setSoloRecordDeleteOpen] = useState(false);
  const existingCourtReview = useMemo(
    () => (match ? (app.state.settings?.courtReviews ?? []).find((review) => review.matchId === match.id && review.reviewerId === app.currentUser.id) ?? null : null),
    [app.currentUser.id, app.state.settings?.courtReviews, match?.id],
  );
  const [courtReviewDraft, setCourtReviewDraft] = useState(() => getCourtReviewDraft(existingCourtReview));
  useBodyScrollLock(Boolean(statEditorPlayerId || soloRecordDeleteOpen));

  useEffect(() => {
    if (!matchId || app.remoteReady === false || requestedMatchIdRef.current === matchId) return;
    setMatchDetailMissing(false);
    const request = app.actions.loadMatchDetail?.(matchId);
    if (!request?.then) {
      if (!match && !request) setMatchDetailMissing(true);
      return;
    }
    requestedMatchIdRef.current = matchId;
    request.then((count) => {
      if (!count) {
        requestedMatchIdRef.current = "";
        if (!match) setMatchDetailMissing(true);
      }
    }).catch(() => {
      requestedMatchIdRef.current = "";
      if (!match) setMatchDetailMissing(true);
    });
  }, [app.actions, app.remoteReady, match, matchId]);

  useEffect(() => {
    const participantIds = match ? getMatchTrustFeedbackParticipantIds(match) : [];
    setThumbDraftPlayerIds((match?.trustFeedback?.stars?.[app.currentUser.id] ?? []).filter((playerId) => participantIds.includes(playerId)));
  }, [app.currentUser.id, match?.id, match?.trustFeedback]);

  useEffect(() => {
    setCourtReviewDraft(getCourtReviewDraft(existingCourtReview));
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
  }, [app.currentUser.id, match?.id, match?.result?.updatedAt]);

  if (!match) {
    if (matchDetailMissing) return <Navigate to="/app/matches" replace />;
    return <BasketballLoader overlay label="경기방 불러오는 중" />;
  }

  const userMap = Object.fromEntries([...app.state.users, ...Object.values(match.anonymousPlayers ?? {})].map((user) => [user.id, user]));
  const statEditorPlayer = statEditorPlayerId ? userMap[statEditorPlayerId] : null;
  const status = statusMeta[match.status] ?? { label: match.status, tone: "blue" };
  const teamAAgreement = getAgreementStatus(match, app.state.teams, "teamA");
  const teamBAgreement = getAgreementStatus(match, app.state.teams, "teamB");
  const teamAApproval = getApprovalStatus(match, app.state.teams, "teamA");
  const teamBApproval = getApprovalStatus(match, app.state.teams, "teamB");
  const allPlayerIds = getMatchPlayerIds(match);
  const currentUserSideName = getPlayerSideName(match, app.currentUser.id);
  const recordWindow = getMatchRecordWindow(match);
  const referee = getMatchReferee(match, app.state.users);
  const hasReferee = Boolean(match.refereeId);
  const currentUserIsReferee = isMatchReferee(match, app.currentUser.id);
  const currentUserIsEligibleReferee = currentUserIsReferee && isEligibleReferee(app.currentUser, match.refereeTrustMin, app.state.settings?.refereeAppointments);
  const statRecorders = hasReferee ? {} : getEffectiveStatRecorders(match);
  const recorderSummary = referee
    ? `심판 ${referee.name}`
    : ["teamA", "teamB"]
        .filter((sideName) => statRecorders[sideName])
        .map((sideName) => `${sideName === "teamA" ? "A사이드" : "B사이드"} ${userMap[statRecorders[sideName]]?.name ?? "후보"}`)
        .join(" · ") || "참가자 본인 득점";
  const currentRecorderSides = hasReferee ? [] : getStatRecorderSides(match, app.currentUser.id);
  const hasSideRecorders = !hasReferee && Boolean(statRecorders.teamA || statRecorders.teamB);
  const statSubmissionStatus = getStatSubmissionStatus(match);
  const resultPointAudit = getResultPointAudit(match);
  const activeEvidenceIds = new Set(EVIDENCE_OPTIONS.map((item) => item.id));
  const activeEvidenceCount = (match.evidence ?? []).filter((evidence) => activeEvidenceIds.has(evidence.id ?? evidence.type)).length;
  const approvalAccessReady = Boolean(match.result) && statSubmissionStatus.complete && resultPointAudit.matched;
  const currentUserSubmitted = getPlayerStatSubmitted(match, app.currentUser.id);
  const currentUserAgreementDone = currentUserSideName ? (match.agreements?.[currentUserSideName] ?? []).includes(app.currentUser.id) : false;
  const currentUserApprovalDone = currentUserSideName ? (match.approvals?.[currentUserSideName] ?? []).includes(app.currentUser.id) : false;
  const sourceRecruitingPost = match.recruitingPostId
    ? app.state.recruitingPosts?.find((post) => post.id === match.recruitingPostId)
    : null;
  const matchHostPlayerId = getMatchHostPlayerId(match, sourceRecruitingPost);
  const isMatchHost = matchHostPlayerId === app.currentUser.id;
  const matchPhase = getMatchRoomPhase(match).phase;
  const startedAuthorityPhase = Boolean(match.startedAt || match.endedAt || match.result || ["live", "postgame", "dispute", "record"].includes(matchPhase));
  const currentUserCanOperateStartedMatch = hasReferee ? currentUserIsEligibleReferee : isMatchHost;
  const currentUserCanFileDispute = currentUserCanOperateStartedMatch || getMatchTrustFeedbackParticipantIds(match).includes(app.currentUser.id);
  const canEditDisputeDraft = match.status === "disputed" && currentUserCanOperateStartedMatch && recordWindow.disputeOpen;
  const currentUserCanPostgameScore = currentUserCanOperateStartedMatch && matchPhase === "postgame" && !["confirmed", "disputed"].includes(match.status);
  const currentUserCanSubmitMissingPostgameResult = canOperatorSubmitMissingPostgameResult(match, currentUserCanOperateStartedMatch);
  const currentUserEditablePlayerIds = canEditDisputeDraft
    ? allPlayerIds
    : hasReferee && currentUserIsEligibleReferee
      ? allPlayerIds
      : allPlayerIds.filter((playerId) => getAllowedResultStatFields(match, app.currentUser.id, playerId, currentUserCanPostgameScore).length > 0);
  const currentUserCanSubmit = canEditDisputeDraft || (hasReferee ? currentUserIsEligibleReferee : currentUserEditablePlayerIds.length > 0);
  const canSubmitLiveResult = currentUserCanSubmit && match.status === "agreed" && recordWindow.beforeEnd && !recordWindow.beforeStart;
  const canSubmitResult = canEditDisputeDraft || canSubmitLiveResult || (currentUserCanSubmit && ((["agreed", "approval"].includes(match.status) && recordWindow.statOpen) || currentUserCanSubmitMissingPostgameResult));
  const canCancel = ["contract", "agreed"].includes(match.status) && (startedAuthorityPhase ? currentUserCanOperateStartedMatch : isMatchHost);
  const isSoloRecord = match.rules?.recordType === "solo";
  const matchApprovalOpen = Boolean(match.result && (match.status === "approval" || (match.status === "agreed" && match.endedAt && !recordWindow.disputeExpired)));
  const canDispute = matchApprovalOpen && recordWindow.disputeOpen && currentUserCanFileDispute;
  const canRequestOwnPointDispute = canDispute && getMatchRecordPlayerIds(match).includes(app.currentUser.id);
  const canVoid = match.status === "disputed" && currentUserCanOperateStartedMatch;
  const canDeleteSoloRecord = isSoloRecord && match.createdBy === app.currentUser.id && match.status !== "cancelled";
  const canResumeApproval = match.status === "disputed" && currentUserCanOperateStartedMatch;
  const canReport = !["cancelled", "void"].includes(match.status) && (Boolean(match.endedAt) || Boolean(match.result) || ["approval", "disputed", "confirmed"].includes(match.status));
  const isContractStage = match.status === "contract";
  const shouldShowResultEntry =
    match.status === "approval" || Boolean(match.result) || (match.status === "agreed" && !recordWindow.beforeStart);
  const shouldShowApprovalPanel = match.status === "confirmed" || (matchApprovalOpen && approvalAccessReady);
  const shouldShowWaitingPanel = false;
  const scoreA = getDisplayScore(match, "teamA");
  const scoreB = getDisplayScore(match, "teamB");
  const teamASide = getSafeMatchSide(match, "teamA");
  const teamBSide = getSafeMatchSide(match, "teamB");
  const teamA = app.state.teams.find((team) => team.id === teamASide.teamId);
  const teamB = app.state.teams.find((team) => team.id === teamBSide.teamId);
  const teamAMmr = teamA?.mmr ?? getTeamMmr(app.state.teams, teamASide.teamId);
  const teamBMmr = teamB?.mmr ?? getTeamMmr(app.state.teams, teamBSide.teamId);
  const winnerName = Number(scoreA) === Number(scoreB) ? "" : Number(scoreA) > Number(scoreB) ? teamASide.name : teamBSide.name;
  const currentUserDisputePoints = getMatchPlayerDisputePoints(match, app.currentUser.id);
  const matchKind = isSoloRecord ? "개인 기록" : match.ranked === false ? "친선전" : "정규전";
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
          ? "참가자/후보 기록자만 입력"
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
              <span className={getAvatarClassName(user)} style={{ "--avatar": user?.avatarColor }}>{getAvatarInitial(user)}</span>
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
    const reservePlayerIds = getMatchReservePlayerIds(match, sideName).slice(0, 2);
    const openSlots = Math.max(0, 2 - reservePlayerIds.length);
    const sideLeaderId = getMatchSideLeaderId(match, app.state.teams, sideName);

    return (
      <div className="gm-reserve-line">
        <strong>{sideName === "teamA" ? "A사이드" : "B사이드"} 후보 {reservePlayerIds.length}/2</strong>
        <div className="gm-roster-row gm-reserve-row">
          {reservePlayerIds.map((playerId) => {
            const user = userMap[playerId];
            const recorder = statRecorders[sideName] === playerId;
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
                <span className={getAvatarClassName(user)} style={{ "--avatar": user?.avatarColor }}>{getAvatarInitial(user)}</span>
                <strong>{user?.name ?? "플레이어"}</strong>
                <small>{getPlayerMetaLabel(user)}</small>
                <em>{recorder ? "REC" : "SUB"}</em>
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
  const bumpPlayerStat = (playerId, fieldId, delta) => {
    const currentValue = Number(score.playerStats[playerId]?.[fieldId] ?? 0);
    updatePlayerStat(playerId, fieldId, currentValue + delta);
  };
  const submitResult = (event) => {
    event.preventDefault();
    if (!canSubmitResult) return;
    setResultSaveFeedback(canEditDisputeDraft ? "수정 중" : "저장 중");
    const result = app.actions.submitMatchResult(match.id, score);
    Promise.resolve(result).then((response) => {
      setResultSaveFeedback(response?.ok === false ? "저장 실패" : canEditDisputeDraft ? "수정되었습니다." : "저장되었습니다.");
    }).catch(() => setResultSaveFeedback("저장 실패"));
  };
  const submitDispute = () => {
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
  const refreshMatchDetail = () => {
    if (matchDetailRefreshing) return;
    const loadMatchDetail = app.actions.loadMatchDetail;
    if (!loadMatchDetail) return;
    setMatchDetailRefreshing(true);
    Promise.resolve(loadMatchDetail(match.id)).then((count) => {
      setResultSaveFeedback(count ? "새로고침되었습니다." : "최신 경기 정보를 불러오지 못했습니다.");
    }).catch(() => setResultSaveFeedback("새로고침 실패"))
      .finally(() => setMatchDetailRefreshing(false));
  };
  const getSideLabel = (sideName) => (sideName === "teamA" ? "A사이드" : "B사이드");
  const getRecorderName = (sideName) => hasReferee ? "" : userMap[statRecorders[sideName]]?.name ?? "";
  const canEditPlayerStat = (playerId) => canSubmitResult && (canEditDisputeDraft || getAllowedResultStatFields(match, app.currentUser.id, playerId, currentUserCanPostgameScore).length > 0);
  const editableStatFields = statEditorPlayerId ? (canEditDisputeDraft ? PLAYER_STAT_FIELDS : getAllowedResultStatFields(match, app.currentUser.id, statEditorPlayerId, currentUserCanPostgameScore)) : [];
  const getPlayerStatState = (playerId, submitted) => {
    const sideName = getPlayerSideName(match, playerId);
    const recorderName = sideName ? getRecorderName(sideName) : "";
    if (canEditPlayerStat(playerId)) {
      if (hasReferee) return "심판 입력";
      if (sideName && isMatchStatRecorder(match, app.currentUser.id, sideName)) return "후보 기록";
      return submitted ? "득점 수정" : "내 득점";
    }
    if (submitted) return "제출됨";
    if (recorderName) return `후보 ${recorderName}`;
    return "미제출";
  };
  const permissionTitle = hasReferee
    ? `심판 ${referee?.name ?? "지정됨"}`
    : currentRecorderSides.length
      ? `후보 기록자 ${currentRecorderSides.map(getSideLabel).join(", ")}`
      : hasSideRecorders
        ? "후보 기록자 배정"
        : "참가자 본인 득점";
  const permissionDetail = hasReferee
    ? "심판만 전체 개인 활약 입력"
    : currentRecorderSides.length
      ? "내가 맡은 팀의 득점/리바운드/어시스트/스틸/블록 입력"
      : hasSideRecorders
        ? "후보가 있는 팀은 후보 기록자가 개인 활약 입력"
        : "리바운드/어시스트/스틸/블록은 비활성";
  const nextAction = (() => {
    if (match.status === "contract") {
      if (currentUserSideName && !currentUserAgreementDone) {
        return {
          label: "동의하고 경기 준비",
          detail: "내 동의만 처리하면 된다.",
          button: "동의",
          type: "agree",
        };
      }
      return {
        label: "대기",
        detail: "남은 참가자가 동의하면 예정 경기로 넘어간다.",
      };
    }
    if (match.status === "agreed") {
      if (recordWindow.beforeEnd) {
        return {
          label: "경기 예정",
          detail: "경기 종료 후 결과 입력이 열린다.",
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
    if (match.status === "approval") {
      if (!approvalAccessReady) {
        return {
          label: canSubmitResult && !currentUserSubmitted ? "내 기록 입력" : "기록 확인 대기",
          detail: `개인 기록 ${statSubmissionStatus.submitted}/${statSubmissionStatus.total}명 · 득점 합계 확인 필요`,
          button: canSubmitResult && !currentUserSubmitted ? "입력" : "보기",
          href: "#result-entry",
        };
      }
      if (currentUserSideName && !currentUserApprovalDone) {
        return {
          label: "결과 승인",
          detail: "기록 조건이 맞았다. 내 승인만 처리하면 된다.",
          button: "승인",
          type: "approve",
        };
      }
      return {
        label: "승인 대기",
        detail: "다른 참가자 승인만 남았다.",
      };
    }
    if (match.status === "disputed") {
      return {
        label: "이의 확인",
        detail: "보류 사유 확인 후 승인 재개 또는 무효 처리.",
      };
    }
    if (match.status === "confirmed") {
      return {
        label: "확정 완료",
        detail: "MMR과 전적 반영이 끝났다.",
      };
    }
    return {
      label: status.label,
      detail: "필요한 보조 처리는 접힌 메뉴에서 처리.",
    };
  })();
  const pointAuditA = getPointAudit(match, score, "teamA");
  const pointAuditB = getPointAudit(match, score, "teamB");
  const statTrustSteps = [
    {
      id: "self",
      label: hasSideRecorders ? "후보/본인 제출" : "전원 본인 제출",
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
      id: "approval",
      label: "양팀 승인",
      detail: `A ${teamAApproval.approvals.length}/${teamAApproval.majority} · B ${teamBApproval.approvals.length}/${teamBApproval.majority}`,
      complete: match.status === "confirmed" || (teamAApproval.approved && teamBApproval.approved),
    },
    {
      id: "evidence",
      label: "증거",
      detail: `${activeEvidenceCount}개 첨부`,
      complete: activeEvidenceCount > 0,
    },
  ];
  const statTrustPercent = Math.round((statTrustSteps.filter((step) => step.complete).length / statTrustSteps.length) * 100);
  const trustFeedback = match.trustFeedback ?? {};
  const thumbsByGiver = trustFeedback.stars ?? {};
  const feedbackParticipantIds = getMatchTrustFeedbackParticipantIds(match).filter((playerId) => userMap[playerId]);
  const thumbLimit = getMatchTrustFeedbackLimit(match);
  const trustFeedbackClosesAt = getMatchTrustFeedbackClosesAt(match);
  const canSubmitThumbs = isMatchTrustFeedbackOpen(match) && feedbackParticipantIds.includes(app.currentUser.id);
  const shouldShowThumbReview = match.status === "confirmed" && feedbackParticipantIds.includes(app.currentUser.id);
  const courtReviewMatchFinished = Boolean(match.endedAt || match.result || ["approval", "disputed", "confirmed"].includes(match.status));
  const canSubmitCourtReview = courtReviewMatchFinished && !["void", "cancelled"].includes(match.status) && feedbackParticipantIds.includes(app.currentUser.id);
  const courtReviewRatingReady = Number(courtReviewDraft.rating) > 0;
  const thumbTargets = feedbackParticipantIds.filter((playerId) => playerId !== app.currentUser.id);
  const thumbCountByPlayer = Object.values(thumbsByGiver).reduce((acc, targetIds = []) => {
    targetIds.forEach((targetId) => {
      acc[targetId] = (acc[targetId] ?? 0) + 1;
    });
    return acc;
  }, {});
  const toggleThumbDraft = (targetUserId) => {
    setThumbDraftPlayerIds((current) => {
      const selected = current.includes(targetUserId);
      if (selected) return current.filter((playerId) => playerId !== targetUserId);
      if (current.length >= thumbLimit) return current;
      return [...current, targetUserId];
    });
  };
  const updateCourtReviewDraft = (patch) => setCourtReviewDraft((current) => ({ ...current, ...patch }));
  const submitCourtReview = () => {
    if (!canSubmitCourtReview || !courtReviewRatingReady) return;
    app.actions.submitCourtReview(match.id, courtReviewDraft);
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
  const ruleItems = [
    ["목표 점수", `${match.rules?.targetScore ?? 21}점`],
    ["제한 시간", `${match.rules?.timeLimit ?? 12}분`],
    ["승리 조건", match.rules?.winByTwo ? "2점차" : "선착순"],
    ["사용 공", match.rules?.ball ?? "7호 공"],
    ["공격권", match.rules?.attackRule ?? "득점 후 공격권 교대"],
    ["파울 룰", match.rules?.foulRule ?? "현장 합의"],
    ["기록 권한", recorderSummary],
    ["이의제기", `${Math.min(Number(match.disputeMinutes ?? DISPUTE_WINDOW_MINUTES), DISPUTE_WINDOW_MINUTES)}분`],
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

        <div className="gm-reserve-panel">
          {renderHeroReserves("teamA")}
          {renderHeroReserves("teamB")}
        </div>

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
        {nextAction.type === "agree" ? (
          <Button type="button" onClick={() => app.actions.agreeMatch(match.id, currentUserSideName, app.currentUser.id)}>{nextAction.button}</Button>
        ) : nextAction.type === "approve" ? (
          <Button type="button" onClick={() => app.actions.approveMatch(match.id, currentUserSideName, app.currentUser.id)}>{nextAction.button}</Button>
        ) : nextAction.href ? (
          <a className="button button-primary button-md" href={nextAction.href}>{nextAction.button}</a>
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
          <p className="muted">{canDeleteSoloRecord ? "이 개인 기록은 내 기록에서 삭제할 수 있습니다." : canCancel ? "현재 운영 권한으로 경기 취소가 가능합니다." : "현재 단계에서는 경기 취소가 잠겼습니다."}</p>
          <Button type="button" variant="secondary" disabled={!canCancel} onClick={() => app.actions.cancelMatch(match.id)}>경기 취소</Button>
          {canDeleteSoloRecord ? (
            <Button type="button" variant="secondary" className="danger-button" onClick={deleteSoloRecord}>개인 기록 삭제</Button>
          ) : null}
        </Card>
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
                <div className="empty-state">결과 입력은 경기 종료 후 열린다.</div>
              </Card>
            ) : null}
            {shouldShowResultEntry ? (
            <Card id="result-entry" className="section-card result-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Result entry</p>
                <h2>경기 결과 입력</h2>
              </div>
              <Badge tone={canSubmitResult ? "green" : recordWindow.statExpired ? "orange" : "neutral"}>{recordLockReason}</Badge>
            </div>
            {!canSubmitResult ? (
              <div className="empty-state">{match.status === "contract" ? "동의 필요" : "수정 잠김"}</div>
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
                <em>경기 종료 후 {match.disputeMinutes ?? 120}분</em>
              </div>
            </div>
            <form className="score-form" onSubmit={submitResult}>
              <label>
                {teamASide.name}
                <input type="number" min="0" disabled={!canSubmitResult} value={score.scoreA} onChange={(event) => setScore((current) => ({ ...current, scoreA: event.target.value }))} />
              </label>
              <span>:</span>
              <label>
                {teamBSide.name}
                <input type="number" min="0" disabled={!canSubmitResult} value={score.scoreB} onChange={(event) => setScore((current) => ({ ...current, scoreB: event.target.value }))} />
              </label>
              <div className="match-action-row stat-entry-actions">
                <Button type="button" variant="secondary" disabled={matchDetailRefreshing} onClick={refreshMatchDetail}>
                  <RotateCcw size={16} />
                  새로고침
                </Button>
                <Button type="submit" disabled={!canSubmitResult}>
                  {canEditDisputeDraft ? "이의 수정안 저장" : canSubmitLiveResult ? "실시간 기록 저장" : hasReferee ? "심판 기록 제출" : currentRecorderSides.length ? "후보 기록 제출" : currentUserSubmitted ? "스코어/내 득점 다시 제출" : "스코어/내 득점 제출"}
                </Button>
              </div>
              {resultSaveFeedback ? <div className="stat-save-feedback">{resultSaveFeedback}</div> : null}
              <div className="stat-integrity-note">
                {hasReferee
                  ? "심판이 스코어와 전체 개인 활약을 한 번에 저장합니다. 1시간 안에 입력해야 합니다."
                  : hasSideRecorders
                    ? "후보가 있는 사이드는 후보 기록자가 해당 사이드 개인 활약을 저장합니다. 후보 기록은 심판보다 낮은 MMR 가중치로 반영됩니다."
                    : "심판이 없으면 각 참가자는 본인 득점만 저장합니다. 전원 제출과 득점 합계가 맞아야 결과 승인이 열립니다."}
              </div>
              <div className="stat-trust-panel">
                <div className="stat-trust-head">
                  <div>
                    <strong>개인 기록 신뢰도</strong>
                    <span>후보/본인 제출, 득점 합계, 양팀 승인, 증거 첨부를 같이 봅니다.</span>
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
                {["teamA", "teamB"].map((sideName) => (
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
                            <span className={getAvatarClassName(displayUser, "small")} style={{ "--avatar": displayUser?.avatarColor }}>{getAvatarInitial(displayUser)}</span>
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
            {shouldShowApprovalPanel ? (
              <div id="approval-panel">
                <ApprovalPanel match={match} teams={app.state.teams} users={app.state.users} currentUserId={app.currentUser.id} onApprove={(sideName, playerId) => app.actions.approveMatch(match.id, sideName, playerId)} />
              </div>
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
              <div className="empty-state">승인 대기</div>
            )}
          </Card>
          {shouldShowThumbReview ? (
            <Card className="section-card trust-star-card">
              <div className="section-title-row">
                <div>
                  <p className="eyebrow">Trust review</p>
                  <h2>따봉 평가</h2>
                </div>
                <Badge tone={canSubmitThumbs ? "gold" : "neutral"}>{thumbDraftPlayerIds.length}/{thumbLimit}</Badge>
              </div>
              <p className="muted">기록확정 후 24시간 안에 제출한다. 선수/방장/기록자/심판 따봉이 같은 신뢰 평가로 반영된다.</p>
              <div className="trust-star-grid">
                {thumbTargets.map((playerId) => {
                  const user = userMap[playerId];
                  const selected = thumbDraftPlayerIds.includes(playerId);
                  const limitReached = !selected && thumbDraftPlayerIds.length >= thumbLimit;
                  return (
                    <button
                      key={playerId}
                      type="button"
                      className={selected ? "trust-star-button selected" : "trust-star-button"}
                      disabled={!canSubmitThumbs || limitReached}
                      onClick={() => toggleThumbDraft(playerId)}
                    >
                      <PlayerHoverCard as="span" user={user} teams={app.state.teams}>
                        <span className={getAvatarClassName(user, "small")} style={{ "--avatar": user?.avatarColor }}>{getAvatarInitial(user)}</span>
                        <span>
                          <strong>{user?.name ?? "플레이어"}</strong>
                          <em>{getTrustFeedbackRole(match, playerId)} · {thumbCountByPlayer[playerId] ?? 0}개 받음</em>
                        </span>
                      </PlayerHoverCard>
                      <ThumbsUp size={16} fill={selected ? "currentColor" : "none"} />
                    </button>
                  );
                })}
              </div>
              <Button type="button" disabled={!canSubmitThumbs} onClick={() => app.actions.submitMatchThumbs(match.id, thumbDraftPlayerIds)}>
                <ThumbsUp size={16} /> 따봉 제출하기
              </Button>
              {!canSubmitThumbs ? <p className="muted">제출 가능 시간이 지났거나 아직 기록확정 전이다. 마감: {formatWindowTime(trustFeedbackClosesAt)}</p> : null}
            </Card>
          ) : null}
          {canSubmitCourtReview || existingCourtReview ? (
            <Card className="section-card court-review-card">
              <div className="section-title-row">
                <div>
                  <p className="eyebrow">Court review</p>
                  <h2>구장 리뷰</h2>
                </div>
                <Badge tone={existingCourtReview ? "gold" : canSubmitCourtReview ? "green" : "neutral"}>{existingCourtReview ? "제출됨" : canSubmitCourtReview ? "작성 가능" : "잠김"}</Badge>
              </div>
              <p className="muted">{match.court}에서 경기한 참가자만 남길 수 있다. 별점은 구장 카드 평균에 반영된다.</p>
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
              <Button type="button" disabled={!canSubmitCourtReview || !courtReviewRatingReady} onClick={submitCourtReview}>
                <Star size={16} /> {existingCourtReview ? "리뷰 수정" : "리뷰 제출"}
              </Button>
            </Card>
          ) : null}
          <Card className="section-card">
            <div className="contract-grid single">
              <div>
                <span>Team A 동의</span>
                <strong>{teamAAgreement.approvals.length}/{teamAAgreement.majority}</strong>
              </div>
              <div>
                <span>Team B 동의</span>
                <strong>{teamBAgreement.approvals.length}/{teamBAgreement.majority}</strong>
              </div>
              <div>
                <span>Team A 결과 승인</span>
                <strong>{teamAApproval.approvals.length}/{teamAApproval.majority}</strong>
              </div>
              <div>
                <span>Team B 결과 승인</span>
                <strong>{teamBApproval.approvals.length}/{teamBApproval.majority}</strong>
              </div>
              <div>
                <span>승인 기준</span>
                <strong>과반</strong>
              </div>
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
            {match.disputes?.[0] ? <p className="muted">최근 이의제기: {match.disputes[0].reason}</p> : null}
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
                  <label>
                    내 득점
                    <input
                      type="number"
                      min="0"
                      disabled={!canRequestOwnPointDispute}
                      value={disputeRequestedPoints}
                      onChange={(event) => setDisputeRequestedPoints(event.target.value)}
                    />
                    <em>현재 {currentUserDisputePoints}점</em>
                  </label>
                </div>
                <label className="memo-label">
                  이의제기 사유
                  <select disabled={!canRequestOwnPointDispute} value={disputeReason} onChange={(event) => setDisputeReason(event.target.value)}>
                    {MATCH_DISPUTE_REASON_OPTIONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
                  </select>
                </label>
                {disputeReason === OTHER_MATCH_DISPUTE_REASON ? (
                  <label className="memo-label">
                    기타 사유
                    <textarea disabled={!canRequestOwnPointDispute} value={disputeCustomReason} onChange={(event) => setDisputeCustomReason(event.target.value)} />
                  </label>
                ) : null}
                <label className="memo-label">
                  신고 사유
                  <select disabled={!canReport} value={reportReason} onChange={(event) => setReportReason(event.target.value)}>
                    {REPORT_REASONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
                  </select>
                </label>
                <div className="match-action-row">
                  <Button type="button" variant="secondary" disabled={!canRequestOwnPointDispute} onClick={submitDispute}>이의제기</Button>
                  <Button type="button" variant="secondary" disabled={!canCancel} onClick={() => app.actions.cancelMatch(match.id)}>경기 취소</Button>
                  <Button type="button" variant="secondary" disabled={!canResumeApproval} onClick={() => app.actions.resumeMatchApproval(match.id)}>
                    {match.disputeDraftResult ? "수정안 확정" : "결과 확정"}
                  </Button>
                  <Button type="button" variant="secondary" disabled={!canVoid} onClick={() => app.actions.voidMatch(match.id)}>무효 처리</Button>
                  <Button type="button" variant="secondary" disabled={!canReport} onClick={() => app.actions.reportMatch(match.id, reportReason)}>신고 접수</Button>
                </div>
              </>
            ) : null}
          </Card>
          {match.result ? (
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
          <ShareCard user={app.currentUser} match={match} />
          </aside>
        </div>
      )}
      {statEditorPlayer ? (
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
                  <button type="button" disabled={!canEditPlayerStat(statEditorPlayerId)} onClick={() => bumpPlayerStat(statEditorPlayerId, field.id, -1)}><Minus size={16} /></button>
                  <input
                    type="number"
                    min="0"
                    disabled={!canEditPlayerStat(statEditorPlayerId)}
                    value={score.playerStats[statEditorPlayerId]?.[field.id] ?? 0}
                    onChange={(event) => updatePlayerStat(statEditorPlayerId, field.id, event.target.value)}
                  />
                  <button type="button" disabled={!canEditPlayerStat(statEditorPlayerId)} onClick={() => bumpPlayerStat(statEditorPlayerId, field.id, 1)}><Plus size={16} /></button>
                </div>
              ))}
            </div>
            <Button type="button" onClick={() => setStatEditorPlayerId(null)}>완료</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
