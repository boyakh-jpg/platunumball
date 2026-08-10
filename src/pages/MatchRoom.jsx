import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useParams, useSearchParams } from "react-router-dom";
import BasketballLoader from "../components/common/BasketballLoader.jsx";
import useBodyScrollLock from "../hooks/useBodyScrollLock.js";
import { EVIDENCE_OPTIONS, PLAYER_STAT_FIELDS, REPORT_MATCH_WINDOW_MS, normalizeBenchCapacity, normalizeDisputeWindowMinutes } from "../lib/constants.js";
import { DEFAULT_REPORT_REASON } from "../lib/reportReasons.js";
import {
  MATCH_DISPUTE_REASON_OPTIONS,
  canOperateAssignedMatchReferee,
  canUserResolveMatchDispute,
  canRequestVoidMatchRestore,
  getAgreementStatus,
  getMatchHostPlayerId,
  getMatchCancelCopy,
  getOpenMatchDisputes,
  getMatchRecordWindow,
  getMatchManualFinalizationStatus,
  getMatchReferee,
  getMatchRecordPlayerIds,
  getMatchReviewParticipantIds,
  getMatchResultEntryPermission,
  getMatchRoomPhase,
  getMatchPlayerIds,
  getReportableMatchTimeMs,
  getReportableMatchUserIds,
  getSafeMatchSide,
  getPlayerSideName,
  getPlayerStatSubmitted,
  getStatSubmissionStatus,
  isMatchReferee,
  isMatchRecordMatch,
  isPersonalRecordMatch,
} from "../lib/matchUtils.js";
import { getMatchRuleDetailRows, getMeetingPointSummary, normalizeMatchRules } from "../lib/matchRules.js";
import { getLinkedPersonalRecordDisplayUser } from "../lib/personalRecordRoster.js";
import { getRoomCancellationActionLabel, getRoomCancellationConfirmMessage, getRoomCancellationPolicy } from "../lib/roomFlow.js";
import "../styles/matchroom-arena.css";
import {
  statusMeta,
  makeInitialStats,
  getTeamMmr,
  getDisplayScore,
  getPointAudit,
  getCourtReviewDraft,
} from "./matchRoomModel.js";
import MatchRoomView from "./MatchRoomView.jsx";
import { createMatchRoomActions, createMatchRoomCourtReviewSubmit, createMatchRoomHeroRenderers, resetMatchRoomScopedOperations } from "./matchRoomControllerParts.jsx";
export default function MatchRoom({ app }) {
  const { matchId } = useParams();
  const [searchParams] = useSearchParams();
  const match = useMemo(
    () => app.state.matches.find((item) => item?.id === matchId) ?? null,
    [app.state.matches, matchId],
  );
  const requestedMatchIdRef = useRef("");
  const matchDetailRequestSequenceRef = useRef(0);
  const managementActionPendingRef = useRef(false);
  const resultSavePendingRef = useRef(false);
  const currentMatchIdRef = useRef(matchId);
  const matchOperationSequenceRef = useRef(0);
  const resultSaveOperationRef = useRef(null);
  const matchRefreshOperationRef = useRef(null);
  const courtReviewOperationRef = useRef(null);
  currentMatchIdRef.current = matchId;
  const [matchDetailMissing, setMatchDetailMissing] = useState(false);
  const [score, setScore] = useState({
    scoreA: match?.result?.scoreA ?? match?.teamA?.score ?? 21,
    scoreB: match?.result?.scoreB ?? match?.teamB?.score ?? 17,
    playerStats: makeInitialStats(match),
  });
  const matchPlayerKey = match ? getMatchPlayerIds(match).join("|") : "";
  const [disputeReason, setDisputeReason] = useState(MATCH_DISPUTE_REASON_OPTIONS[0]);
  const [disputeCustomReason, setDisputeCustomReason] = useState("");
  const [disputeRequestedStats, setDisputeRequestedStats] = useState({});
  const [disputeRequestedScoreA, setDisputeRequestedScoreA] = useState("");
  const [disputeRequestedScoreB, setDisputeRequestedScoreB] = useState("");
  const [reportReason, setReportReason] = useState(DEFAULT_REPORT_REASON);
  const [statEditorPlayerId, setStatEditorPlayerId] = useState(null);
  const [reviewControlsOpen, setReviewControlsOpen] = useState(false);
  const [resultSaveFeedback, setResultSaveFeedback] = useState("");
  const [resultSavePending, setResultSavePending] = useState(false);
  const [courtReviewSaveFeedback, setCourtReviewSaveFeedback] = useState("");
  const [courtReviewSaving, setCourtReviewSaving] = useState(false);
  const [matchDetailRefreshing, setMatchDetailRefreshing] = useState(false);
  const scopedPending = { resultSave: resultSavePending && resultSaveOperationRef.current?.scopeId === matchId, courtReview: courtReviewSaving && courtReviewOperationRef.current?.scopeId === matchId, refresh: matchDetailRefreshing && matchRefreshOperationRef.current?.scopeId === matchId };
  const [soloRecordDeleteOpen, setSoloRecordDeleteOpen] = useState(false);
  const [voidDialogOpen, setVoidDialogOpen] = useState(false);
  const [voidActionPending, setVoidActionPending] = useState(false);
  const [finalizeDialogOpen, setFinalizeDialogOpen] = useState(false);
  const [finalizeActionPending, setFinalizeActionPending] = useState(false);
  const [finalizeActionError, setFinalizeActionError] = useState("");
  const [managementActionPending, setManagementActionPending] = useState("");
  const [managementActionFeedback, setManagementActionFeedback] = useState("");
  const [, setFinalizationTick] = useState(0);
  const [voidRestoreDetail, setVoidRestoreDetail] = useState("");
  const [voidRestoreStatus, setVoidRestoreStatus] = useState("");
  const existingCourtReview = useMemo(
    () => (match ? (app.state.settings?.courtReviews ?? []).find((review) => review.matchId === match.id && review.reviewerId === app.currentUser.id) ?? null : null),
    [app.currentUser.id, app.state.settings?.courtReviews, match?.id],
  );
  const [courtReviewDraft, setCourtReviewDraft] = useState(() => getCourtReviewDraft(existingCourtReview));
  useBodyScrollLock(Boolean(statEditorPlayerId || soloRecordDeleteOpen || voidDialogOpen || finalizeDialogOpen));
  useEffect(() => {
    matchDetailRequestSequenceRef.current += 1;
    requestedMatchIdRef.current = "";
    resetMatchRoomScopedOperations({ courtReviewOperationRef, matchRefreshOperationRef, resultSaveOperationRef, resultSavePendingRef, setCourtReviewSaveFeedback, setCourtReviewSaving, setMatchDetailRefreshing, setResultSaveFeedback, setResultSavePending });
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
    setDisputeRequestedStats(Object.fromEntries(PLAYER_STAT_FIELDS.map(({ id }) => [
      id,
      String(match.result?.playerStats?.[app.currentUser.id]?.[id] ?? 0),
    ])));
    setDisputeRequestedScoreA(String(match.result?.scoreA ?? match.teamA?.score ?? 0));
    setDisputeRequestedScoreB(String(match.result?.scoreB ?? match.teamB?.score ?? 0));
  }, [app.currentUser.id, match?.id, match?.result?.updatedAt]);
  const linkedProfileIds = useMemo(
    () => [...new Set(Object.values(match?.anonymousPlayers ?? {})
      .map((player) => player?.linkedProfileId)
      .filter(Boolean))],
    [match?.anonymousPlayers],
  );
  useEffect(() => {
    linkedProfileIds.forEach((profileId) => {
      void app.actions.loadDirectory?.({ kind: "players", profileId });
    });
  }, [app.actions.loadDirectory, linkedProfileIds]);
  const attendanceQrToken = String(searchParams.get("attendanceQr") || "").trim();
  if (attendanceQrToken && matchId) {
    return <Navigate to={`/app/matches?match=${encodeURIComponent(matchId)}&attendanceQr=${encodeURIComponent(attendanceQrToken)}`} replace />;
  }
  if (!match) {
    if (matchDetailMissing) return <Navigate to="/app/matches" replace />;
    return <BasketballLoader overlay label="경기방 불러오는 중" />;
  }
  const profileById = Object.fromEntries(app.state.users.map((user) => [user.id, user]));
  const userMap = {
    ...profileById,
    ...Object.fromEntries(Object.values(match.anonymousPlayers ?? {}).map((user) => [
      user.id,
      getLinkedPersonalRecordDisplayUser(user, profileById),
    ])),
  };
  const statEditorPlayer = statEditorPlayerId ? userMap[statEditorPlayerId] : null;
  const isSharedRecord = isMatchRecordMatch(match);
  const status = match.status === "cancelled" && isSharedRecord
    ? { label: "기록 취소됨", tone: "neutral" }
    : match.status === "approval" && isSharedRecord
      ? { label: "참가 확인 대기", tone: "orange" }
      : statusMeta[match.status] ?? { label: "상태 확인 중", tone: "blue" };
  const cancelCopy = getMatchCancelCopy(match);
  const cancellationPolicy = isSharedRecord
    ? { allowed: true, penalty: 0, waived: false, waiverReason: "" }
    : getRoomCancellationPolicy(match);
  const cancelActionLabel = getRoomCancellationActionLabel(cancelCopy.actionLabel, cancellationPolicy);
  const teamAAgreement = getAgreementStatus(match, app.state.teams, "teamA");
  const teamBAgreement = getAgreementStatus(match, app.state.teams, "teamB");
  const currentUserSideName = getPlayerSideName(match, app.currentUser.id);
  const recordWindow = getMatchRecordWindow(match);
  const referee = getMatchReferee(match, app.state.users);
  const hasReferee = Boolean(match.refereeId);
  const isSoloRecord = isPersonalRecordMatch(match);
  const currentUserIsReferee = isMatchReferee(match, app.currentUser.id);
  const currentUserIsEligibleReferee = currentUserIsReferee && canOperateAssignedMatchReferee(
    app.currentUser,
    match,
    app.state.settings?.refereeAppointments,
  );
  const operationSummary = isSoloRecord
    ? "작성자 · 내 기록"
    : referee
      ? `심판 ${referee.name}`
      : match.rules?.gameClockEnabled === false
        ? "방장 · 양쪽 점수"
        : "모바일 전광판 담당자 · 양쪽 점수";
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
  const currentUserCanEndMatch = Boolean(
    matchPhase === "live"
    && currentUserCanOperateStartedMatch
    && !match.endedAt,
  );
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
  const canCancel = ["contract", "agreed"].includes(match.status)
    && (startedAuthorityPhase ? currentUserCanOperateStartedMatch : isMatchHost)
    && cancellationPolicy.allowed;
  const runManagementAction = async (action, failureMessage, operation, onSuccess) => {
    if (managementActionPendingRef.current) return;
    managementActionPendingRef.current = true;
    setManagementActionPending(action);
    setManagementActionFeedback("");
    try {
      const result = await operation();
      if (!result || result?.ok === false) return setManagementActionFeedback(failureMessage);
      onSuccess?.();
    } catch { setManagementActionFeedback(failureMessage); }
    finally {
      managementActionPendingRef.current = false;
      setManagementActionPending("");
    }
  };
  const requestCancelMatch = () => {
    if (!canCancel) return;
    const message = getRoomCancellationConfirmMessage(cancelCopy.actionLabel, cancellationPolicy);
    if (typeof window !== "undefined" && !window.confirm(message)) return;
    void runManagementAction("cancel", "경기를 취소하지 못했습니다. 다시 시도해 주세요.", () => app.actions.cancelMatch(match.id));
  };
  const manualFinalizationStatus = getMatchManualFinalizationStatus(match, Date.now(), app.currentUser.id);
  useEffect(() => {
    if (manualFinalizationStatus.timeReady || manualFinalizationStatus.remainingMs <= 0) return undefined;
    const timerId = window.setTimeout(
      () => setFinalizationTick((current) => current + 1),
      manualFinalizationStatus.remainingMs + 50,
    );
    return () => window.clearTimeout(timerId);
  }, [manualFinalizationStatus.timeReady, manualFinalizationStatus.remainingMs]);
  const canFinalizeMatch = Boolean(!isSharedRecord && match.endedAt && match.result
    && !match.confirmedAt
    && (hasReferee ? currentUserIsEligibleReferee : isMatchHost));
  const finalAuthorityLabel = hasReferee ? "배정 심판" : "방장";
  const openDisputes = getOpenMatchDisputes(match);
  const hasOwnOpenDispute = openDisputes.some((dispute) => dispute.by === app.currentUser.id);
  const hasOwnDispute = (match.disputes ?? []).some((dispute) => dispute.by === app.currentUser.id);
  const matchApprovalOpen = Boolean(match.result && (["approval", "disputed"].includes(match.status) || (match.status === "agreed" && match.endedAt && !recordWindow.disputeExpired)));
  const noDisputeStatus = manualFinalizationStatus.noDispute;
  const showNoDisputeAction = matchApprovalOpen && noDisputeStatus.participantIds.includes(app.currentUser.id);
  const canAcknowledgeNoDispute = showNoDisputeAction && !noDisputeStatus.acknowledged && !hasOwnDispute;
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
      void submitFinalizeMatch({ disputesAcknowledged: true });
      return;
    }
    setFinalizeActionError("");
    setFinalizeDialogOpen(true);
  };
  const submitFinalizeMatch = async (options = {}) => {
    if (finalizeActionPending) return;
    setFinalizeActionPending(true);
    setFinalizeActionError("");
    try {
      const result = await app.actions.finalizeMatch?.(match.id, options);
      if (!result || result?.ok === false) {
        setFinalizeActionError("최종 승인하지 못했습니다. 다시 시도해 주세요.");
        return;
      }
      setFinalizeDialogOpen(false);
    } catch { setFinalizeActionError("최종 승인하지 못했습니다. 다시 시도해 주세요."); }
    finally { setFinalizeActionPending(false); }
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
  const { renderHeroRoster, renderHeroReserves } = createMatchRoomHeroRenderers({ activeEvidenceCount, activeEvidenceIds, app, attendanceQrToken, benchCapacity, canCancel, canDeleteSoloRecord, canDispute, canEditDisputeDraft, canFinalizeMatch, canReport, canRequestMatchDispute, canRequestOwnPointDispute, canRequestScoreDispute, canRequestVoidRestore, canSubmitLiveResult, canSubmitResult, canVoid, cancelActionLabel, cancelCopy, cancellationPolicy, courtReviewDraft, courtReviewSaveFeedback, courtReviewSaving: scopedPending.courtReview, currentUserAgreementDone, currentUserCanEndMatch, currentUserCanFileDispute, currentUserCanOperateStartedMatch, currentUserCanRefreshReview, currentUserCanResolveDispute, currentUserCanSubmit, currentUserCanSubmitMissingPostgameResult, currentUserEditablePlayerIds, currentUserIsAdmin, currentUserIsEligibleReferee, currentUserIsReferee, currentUserSideName, currentUserSubmitted, disputeCustomReason, disputeReason, disputeRequestedScoreA, disputeRequestedScoreB, disputeRequestedStats, draftScoreA, draftScoreB, existingCourtReview, finalAuthorityLabel, finalizeActionPending, finalizeDialogOpen, hasOwnOpenDispute, hasReferee, isContractStage, isMatchHost, isSharedRecord, isSoloRecord, linkedProfileIds, manualFinalizationStatus, match, matchApprovalOpen, matchDetailMissing, matchDetailRefreshing: scopedPending.refresh, matchDetailRequestSequenceRef, matchHostPlayerId, matchId, matchKind, matchPhase, matchPlayerKey, openDisputes, operationSummary, profileById, recordLockReason, recordWindow, referee, reportReason, reportTime, requestCancelMatch, requestFinalizeMatch, requestedMatchIdRef, resultEntryPermission, resultSaveFeedback, reviewControlsOpen, score, scoreA, scoreB, searchParams, setCourtReviewDraft, setCourtReviewSaveFeedback, setCourtReviewSaving, setDisputeCustomReason, setDisputeReason, setDisputeRequestedScoreA, setDisputeRequestedScoreB, setDisputeRequestedStats, setFinalizeActionPending, setFinalizeDialogOpen, setMatchDetailMissing, setMatchDetailRefreshing, setReportReason, setResultSaveFeedback, setReviewControlsOpen, setScore, setSoloRecordDeleteOpen, setStatEditorPlayerId, setVoidActionPending, setVoidDialogOpen, setVoidRestoreDetail, setVoidRestoreStatus, shouldShowResultEntry, shouldShowWaitingPanel, soloRecordDeleteOpen, sourceRecruitingPost, startedAuthorityPhase, statEditorPlayer, statEditorPlayerId, statSubmissionStatus, status, submitFinalizeMatch, teamA, teamAAgreement, teamAMmr, teamASide, teamB, teamBAgreement, teamBMmr, teamBSide, userMap, voidActionPending, voidDialogOpen, voidRestoreDetail, voidRestoreStatus, winnerName });
  const { updatePlayerStat, submitResult, submitDispute, submitVoidMatch, submitVoidRestoreRequest, refreshMatchDetail } = createMatchRoomActions({ currentMatchIdRef, matchOperationSequenceRef, resultSaveOperationRef, matchRefreshOperationRef, activeEvidenceCount, activeEvidenceIds, app, attendanceQrToken, benchCapacity, canCancel, canDeleteSoloRecord, canDispute, canEditDisputeDraft, canFinalizeMatch, canReport, canRequestMatchDispute, canRequestOwnPointDispute, canRequestScoreDispute, canRequestVoidRestore, canSubmitLiveResult, canSubmitResult, canVoid, cancelActionLabel, cancelCopy, cancellationPolicy, courtReviewDraft, courtReviewSaveFeedback, courtReviewSaving, currentUserAgreementDone, currentUserCanEndMatch, currentUserCanFileDispute, currentUserCanOperateStartedMatch, currentUserCanRefreshReview, currentUserCanResolveDispute, currentUserCanSubmit, currentUserCanSubmitMissingPostgameResult, currentUserEditablePlayerIds, currentUserIsAdmin, currentUserIsEligibleReferee, currentUserIsReferee, currentUserSideName, currentUserSubmitted, disputeCustomReason, disputeReason, disputeRequestedScoreA, disputeRequestedScoreB, disputeRequestedStats, draftScoreA, draftScoreB, existingCourtReview, finalAuthorityLabel, finalizeActionPending, finalizeDialogOpen, hasOwnOpenDispute, hasReferee, isContractStage, isMatchHost, isSharedRecord, isSoloRecord, linkedProfileIds, manualFinalizationStatus, match, matchApprovalOpen, matchDetailMissing, matchDetailRefreshing, matchDetailRequestSequenceRef, matchHostPlayerId, matchId, matchKind, matchPhase, matchPlayerKey, openDisputes, operationSummary, profileById, recordLockReason, recordWindow, referee, renderHeroReserves, renderHeroRoster, reportReason, reportTime, requestCancelMatch, requestFinalizeMatch, requestedMatchIdRef, resultEntryPermission, resultSaveFeedback, resultSavePendingRef, reviewControlsOpen, score, scoreA, scoreB, searchParams, setCourtReviewDraft, setCourtReviewSaveFeedback, setCourtReviewSaving, setDisputeCustomReason, setDisputeReason, setDisputeRequestedScoreA, setDisputeRequestedScoreB, setDisputeRequestedStats, setFinalizeActionPending, setFinalizeDialogOpen, setMatchDetailMissing, setMatchDetailRefreshing, setReportReason, setResultSaveFeedback, setResultSavePending, setReviewControlsOpen, setScore, setSoloRecordDeleteOpen, setStatEditorPlayerId, setVoidActionPending, setVoidDialogOpen, setVoidRestoreDetail, setVoidRestoreStatus, shouldShowResultEntry, shouldShowWaitingPanel, soloRecordDeleteOpen, sourceRecruitingPost, startedAuthorityPhase, statEditorPlayer, statEditorPlayerId, statSubmissionStatus, status, submitFinalizeMatch, teamA, teamAAgreement, teamAMmr, teamASide, teamB, teamBAgreement, teamBMmr, teamBSide, userMap, voidActionPending, voidDialogOpen, voidRestoreDetail, voidRestoreStatus, winnerName });
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
        : "모바일 전광판 담당자가 양쪽 팀 점수 입력";
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
  const submitCourtReview = createMatchRoomCourtReviewSubmit({ app, canSubmitCourtReview, courtReviewDraft, courtReviewOperationRef, courtReviewRatingReady, currentMatchIdRef, match, matchOperationSequenceRef, setCourtReviewSaveFeedback, setCourtReviewSaving });
  const deleteSoloRecord = () => {
    if (!canDeleteSoloRecord) return;
    setManagementActionFeedback("");
    setSoloRecordDeleteOpen(true);
  };
  const confirmDeleteSoloRecord = () => {
    if (!canDeleteSoloRecord) return;
    void runManagementAction("delete", "개인 기록을 삭제하지 못했습니다. 다시 시도해 주세요.", () => app.actions.deleteSoloRecord?.(match.id), () => setSoloRecordDeleteOpen(false));
  };
  const agreeCurrentUser = (sideName = currentUserSideName, playerId = app.currentUser.id) => runManagementAction("agree", "경기 동의를 저장하지 못했습니다. 다시 시도해 주세요.", () => app.actions.agreeMatch(match.id, sideName, playerId));
  const normalizedRules = normalizeMatchRules(match.rules, { mode: match.mode });
  const ruleItems = [
    ...getMatchRuleDetailRows(normalizedRules, match.mode).map((row) => [row.label, row.value]),
    ["만남 장소", getMeetingPointSummary(normalizedRules, match.timingType, match.mode)],
    ["공격권", match.rules?.attackRule ?? "득점 후 공격권 교대"],
    ["파울 룰", match.rules?.foulRule ?? "현장 합의"],
    ["운영 권한", operationSummary],
    ["이의제기", `${normalizeDisputeWindowMinutes(match.disputeMinutes)}분`],
    ["티어 반영", isSoloRecord ? "개인 기록 · MMR 미반영" : match.ranked === false ? "친선 · 티어 자유" : "정규 · 서버 정책 적용"],
  ];
  const controller = { app, match, score, disputeReason, setDisputeReason, disputeCustomReason, setDisputeCustomReason, disputeRequestedStats, setDisputeRequestedStats, disputeRequestedScoreA, setDisputeRequestedScoreA, disputeRequestedScoreB, setDisputeRequestedScoreB, reportReason, setReportReason, statEditorPlayerId, setStatEditorPlayerId, reviewControlsOpen, setReviewControlsOpen, resultSaveFeedback, resultSavePending: scopedPending.resultSave, courtReviewSaveFeedback, courtReviewSaving: scopedPending.courtReview, matchDetailRefreshing: scopedPending.refresh, soloRecordDeleteOpen, setSoloRecordDeleteOpen, managementActionPending, managementActionFeedback, voidDialogOpen, setVoidDialogOpen, voidActionPending, finalizeDialogOpen, setFinalizeDialogOpen, finalizeActionPending, finalizeActionError, voidRestoreDetail, setVoidRestoreDetail, voidRestoreStatus, existingCourtReview, courtReviewDraft, userMap, statEditorPlayer, isSharedRecord, status, cancelCopy, cancelActionLabel, teamAAgreement, teamBAgreement, currentUserSideName, recordWindow, referee, hasReferee, isSoloRecord, currentUserIsEligibleReferee, currentUserSubmitted, benchCapacity, isMatchHost, matchPhase, startedAuthorityPhase, currentUserCanEndMatch, currentUserCanResolveDispute, currentUserCanRefreshReview, resultEntryPermission, canEditDisputeDraft, canSubmitLiveResult, canSubmitResult, canCancel, requestCancelMatch, agreeCurrentUser, canFinalizeMatch, finalAuthorityLabel, manualFinalizationStatus, noDisputeStatus, showNoDisputeAction, canAcknowledgeNoDispute, openDisputes, hasOwnOpenDispute, canDispute, canRequestMatchDispute, canRequestOwnPointDispute, canRequestScoreDispute, canVoid, canRequestVoidRestore, canDeleteSoloRecord, requestFinalizeMatch, submitFinalizeMatch, canReport, isContractStage, shouldShowResultEntry, shouldShowWaitingPanel, scoreA, scoreB, draftScoreA, draftScoreB, liveStatScoreA: pointAuditA.statPoints, liveStatScoreB: pointAuditB.statPoints, teamASide, teamBSide, teamA, teamB, teamAMmr, teamBMmr, winnerName, matchKind, recordLockReason, renderHeroRoster, renderHeroReserves, updatePlayerStat, submitResult, submitDispute, submitVoidMatch, submitVoidRestoreRequest, refreshMatchDetail, canEditPlayerStat, editableStatFields, getPlayerStatState, permissionTitle, permissionDetail, nextAction, statTrustSteps, statTrustPercent, canSubmitCourtReview, courtReviewRatingReady, updateCourtReviewDraft, submitCourtReview, deleteSoloRecord, confirmDeleteSoloRecord, normalizedRules, ruleItems };
  return <MatchRoomView controller={controller} />;
}
