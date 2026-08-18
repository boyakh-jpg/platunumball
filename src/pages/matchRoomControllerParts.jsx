import { Crown, UsersRound } from "lucide-react";
import PlayerHoverCard from "../components/profile/PlayerHoverCard.jsx";
import ProfileEmblem from "../components/profile/ProfileEmblem.jsx";
import { PLAYER_STAT_FIELDS } from "../lib/constants.js";
import { VOID_MATCH_RESTORE_REPORT_REASON } from "../lib/reportReasons.js";
import {
  buildMatchResultSubmission,
  buildMatchDisputeRequest,
  getMatchResultRevision,
  getVoidMatchRestoreTargetUserId,
  getMatchReservePlayerIds,
  getSafeMatchSide,
  getMatchSideLeaderId,
} from "../lib/matchUtils.js";
import { isCurrentScopedOperation } from "../lib/asyncState.js";
import "../styles/matchroom-arena.css";
import {
  isAnonymousDisplayUser,
  getAvatarInitial,
  getPlayerMetaLabel,
} from "./matchRoomModel.js";

export function resetMatchRoomScopedOperations(context) {
  const { courtReviewOperationRef, matchRefreshOperationRef, resultSaveOperationRef, resultSavePendingRef, setCourtReviewSaveFeedback, setCourtReviewSaving, setMatchDetailRefreshing, setResultSaveFeedback, setResultSavePending } = context;
  resultSaveOperationRef.current = null;
  matchRefreshOperationRef.current = null;
  courtReviewOperationRef.current = null;
  resultSavePendingRef.current = false;
  setResultSavePending(false);
  setMatchDetailRefreshing(false);
  setCourtReviewSaving(false);
  setResultSaveFeedback("");
  setCourtReviewSaveFeedback("");
}

export function createMatchRoomHeroRenderers(context) {
  const { activeEvidenceCount, activeEvidenceIds, app, attendanceQrToken, benchCapacity, canCancel, canDeleteSoloRecord, canDispute, canEditDisputeDraft, canFinalizeMatch, canReport, canRequestMatchDispute, canRequestOwnPointDispute, canRequestScoreDispute, canRequestVoidRestore, canSubmitLiveResult, canSubmitResult, canVoid, cancelActionLabel, cancelCopy, cancellationPolicy, courtReviewDraft, courtReviewSaveFeedback, courtReviewSaving, currentUserAgreementDone, currentUserCanEndMatch, currentUserCanFileDispute, currentUserCanOperateStartedMatch, currentUserCanRefreshReview, currentUserCanResolveDispute, currentUserCanSubmit, currentUserCanSubmitMissingPostgameResult, currentUserEditablePlayerIds, currentUserIsAdmin, currentUserIsEligibleReferee, currentUserIsReferee, currentUserSideName, currentUserSubmitted, disputeCustomReason, disputeReason, disputeRequestedScoreA, disputeRequestedScoreB, disputeRequestedStats, draftScoreA, draftScoreB, existingCourtReview, finalAuthorityLabel, finalizeActionPending, finalizeDialogOpen, hasOwnOpenDispute, hasReferee, isContractStage, isMatchHost, isSharedRecord, isSoloRecord, linkedProfileIds, manualFinalizationStatus, match, matchApprovalOpen, matchDetailMissing, matchDetailRefreshing, matchDetailRequestSequenceRef, matchHostPlayerId, matchId, matchKind, matchPhase, matchPlayerKey, openDisputes, operationSummary, profileById, recordLockReason, recordWindow, referee, reportReason, reportTime, requestCancelMatch, requestFinalizeMatch, requestedMatchIdRef, resultEntryPermission, resultSaveFeedback, reviewControlsOpen, score, scoreA, scoreB, searchParams, setCourtReviewDraft, setCourtReviewSaveFeedback, setCourtReviewSaving, setDisputeCustomReason, setDisputeReason, setDisputeRequestedScoreA, setDisputeRequestedScoreB, setDisputeRequestedStats, setFinalizeActionPending, setFinalizeDialogOpen, setMatchDetailMissing, setMatchDetailRefreshing, setReportReason, setResultSaveFeedback, setReviewControlsOpen, setScore, setSoloRecordDeleteOpen, setStatEditorPlayerId, setVoidActionPending, setVoidDialogOpen, setVoidRestoreDetail, setVoidRestoreStatus, shouldShowResultEntry, shouldShowWaitingPanel, soloRecordDeleteOpen, sourceRecruitingPost, startedAuthorityPhase, statEditorPlayer, statEditorPlayerId, statSubmissionStatus, status, submitFinalizeMatch, teamA, teamAAgreement, teamAMmr, teamASide, teamB, teamBAgreement, teamBMmr, teamBSide, userMap, voidActionPending, voidDialogOpen, voidRestoreDetail, voidRestoreStatus, winnerName } = context;
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
              ? { tone: "captain", label: "주장" }
              : null;
          const slotLabel = match.status === "contract"
            ? ready ? "동의" : "대기"
            : sideLeader ? "리더" : "참가";

          return (
            <PlayerHoverCard key={playerId} user={user} teams={app.state.teams} className={ready ? "gm-player-slot ready" : "gm-player-slot"} contactContext={{ kind: "match", id: match.id }} resolveContact={app.actions.runServerAction}>
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
                ? { tone: "captain", label: "주장" }
                : null;
            return (
              <PlayerHoverCard key={`${sideName}-reserve-${playerId}`} user={user} teams={app.state.teams} className="gm-player-slot reserve ready" contactContext={{ kind: "match", id: match.id }} resolveContact={app.actions.runServerAction}>
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
              <strong>후보</strong>
              <em>SUB</em>
            </div>
          ))}
        </div>
      </div>
    );
  };
  return { renderHeroRoster, renderHeroReserves };
}

export function createMatchRoomActions(context) {
  const { currentMatchIdRef, matchOperationSequenceRef, resultSaveOperationRef, matchRefreshOperationRef, activeEvidenceCount, activeEvidenceIds, app, attendanceQrToken, benchCapacity, canCancel, canDeleteSoloRecord, canDispute, canEditDisputeDraft, canFinalizeMatch, canReport, canRequestMatchDispute, canRequestOwnPointDispute, canRequestScoreDispute, canRequestVoidRestore, canSubmitLiveResult, canSubmitResult, canVoid, cancelActionLabel, cancelCopy, cancellationPolicy, courtReviewDraft, courtReviewSaveFeedback, courtReviewSaving, currentUserAgreementDone, currentUserCanEndMatch, currentUserCanFileDispute, currentUserCanOperateStartedMatch, currentUserCanRefreshReview, currentUserCanResolveDispute, currentUserCanSubmit, currentUserCanSubmitMissingPostgameResult, currentUserEditablePlayerIds, currentUserIsAdmin, currentUserIsEligibleReferee, currentUserIsReferee, currentUserSideName, currentUserSubmitted, disputeCustomReason, disputeReason, disputeRequestedScoreA, disputeRequestedScoreB, disputeRequestedStats, draftScoreA, draftScoreB, existingCourtReview, finalAuthorityLabel, finalizeActionPending, finalizeDialogOpen, hasOwnOpenDispute, hasReferee, isContractStage, isMatchHost, isSharedRecord, isSoloRecord, linkedProfileIds, manualFinalizationStatus, match, matchApprovalOpen, matchDetailMissing, matchDetailRefreshing, matchDetailRequestSequenceRef, matchHostPlayerId, matchId, matchKind, matchPhase, matchPlayerKey, openDisputes, operationSummary, profileById, recordLockReason, recordWindow, referee, renderHeroReserves, renderHeroRoster, reportReason, reportTime, requestCancelMatch, requestFinalizeMatch, requestedMatchIdRef, resultEntryPermission, resultSaveFeedback, resultSavePendingRef, reviewControlsOpen, score, scoreA, scoreB, searchParams, setCourtReviewDraft, setCourtReviewSaveFeedback, setCourtReviewSaving, setDisputeCustomReason, setDisputeReason, setDisputeRequestedScoreA, setDisputeRequestedScoreB, setDisputeRequestedStats, setFinalizeActionPending, setFinalizeDialogOpen, setMatchDetailMissing, setMatchDetailRefreshing, setReportReason, setResultSaveFeedback, setResultSavePending, setReviewControlsOpen, setScore, setSoloRecordDeleteOpen, setStatEditorPlayerId, setVoidActionPending, setVoidDialogOpen, setVoidRestoreDetail, setVoidRestoreStatus, shouldShowResultEntry, shouldShowWaitingPanel, soloRecordDeleteOpen, sourceRecruitingPost, startedAuthorityPhase, statEditorPlayer, statEditorPlayerId, statSubmissionStatus, status, submitFinalizeMatch, teamA, teamAAgreement, teamAMmr, teamASide, teamB, teamBAgreement, teamBMmr, teamBSide, userMap, voidActionPending, voidDialogOpen, voidRestoreDetail, voidRestoreStatus, winnerName } = context;
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
  const submitResult = async (event) => {
    event.preventDefault();
    if (!canSubmitResult || resultSaveOperationRef.current?.scopeId === match.id) return;
    const operation = { scopeId: match.id, operationId: ++matchOperationSequenceRef.current };
    resultSaveOperationRef.current = operation;
    resultSavePendingRef.current = true;
    setResultSavePending(true);
    setResultSaveFeedback(canEditDisputeDraft ? "수정 중" : "저장 중");
    try {
      const response = await app.actions.submitMatchResult(
        match.id,
        buildMatchResultSubmission(match, score, resultEntryPermission.getEditableStatFields, { editableScoreSides: resultEntryPermission.editableScoreSides }),
      );
      if (!isCurrentScopedOperation(resultSaveOperationRef.current, operation, currentMatchIdRef.current)) return;
      setResultSaveFeedback(!response || response?.ok === false ? "경기 결과를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." : canEditDisputeDraft ? "수정되었습니다." : "저장되었습니다.");
    } catch {
      if (isCurrentScopedOperation(resultSaveOperationRef.current, operation, currentMatchIdRef.current)) setResultSaveFeedback("경기 결과를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      if (isCurrentScopedOperation(resultSaveOperationRef.current, operation, currentMatchIdRef.current)) {
        resultSaveOperationRef.current = null;
        resultSavePendingRef.current = false;
        setResultSavePending(false);
      }
    }
  };
  const submitDispute = async () => {
    if (canRequestScoreDispute) {
      return app.actions.disputeMatch(match.id, {
        kind: "team_scores",
        requestedScoreA: Number(disputeRequestedScoreA),
        requestedScoreB: Number(disputeRequestedScoreB),
        baseRevision: getMatchResultRevision(match),
        reason: disputeCustomReason.trim() || disputeReason,
      });
    }
    if (!canRequestOwnPointDispute) return false;
    return app.actions.disputeMatch(match.id, buildMatchDisputeRequest({
      match,
      playerId: app.currentUser.id,
      requestedStats: Object.fromEntries(PLAYER_STAT_FIELDS.map(({ id }) => [
        id,
        Number(disputeRequestedStats[id]),
      ])),
      reason: disputeReason,
      customReason: disputeCustomReason,
    }));
  };
  const submitVoidMatch = async (reason) => {
    if (!canVoid || voidActionPending) return;
    setVoidActionPending(true);
    try {
      const result = await app.actions.voidMatch(match.id, reason);
      if (!result || result?.ok === false) return;
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
    try {
      const result = await app.actions.reportMatch(
        match.id,
        `${VOID_MATCH_RESTORE_REPORT_REASON}: ${detail}`,
        [targetUserId],
      );
      if (!result || result.ok === false) {
        setVoidRestoreStatus("복구 심사 요청을 접수하지 못했습니다.");
        return;
      }
      setVoidRestoreStatus(result.duplicate ? "이미 접수된 요청이 있습니다." : "복구 심사 요청이 접수됐습니다.");
      if (!result.duplicate) setVoidRestoreDetail("");
    } catch {
      setVoidRestoreStatus("복구 심사 요청을 접수하지 못했습니다.");
    }
  };
  const refreshMatchDetail = async () => {
    if (matchRefreshOperationRef.current?.scopeId === match.id) return;
    const loadMatchDetail = app.actions.loadMatchDetail;
    if (!loadMatchDetail) return;
    const operation = { scopeId: match.id, operationId: ++matchOperationSequenceRef.current };
    matchRefreshOperationRef.current = operation;
    setMatchDetailRefreshing(true);
    try {
      const count = await loadMatchDetail(match.id);
      if (!isCurrentScopedOperation(matchRefreshOperationRef.current, operation, currentMatchIdRef.current)) return;
      setResultSaveFeedback(count ? "최신 경기 정보를 불러왔습니다." : "최신 경기 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } catch {
      if (isCurrentScopedOperation(matchRefreshOperationRef.current, operation, currentMatchIdRef.current)) setResultSaveFeedback("최신 경기 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      if (isCurrentScopedOperation(matchRefreshOperationRef.current, operation, currentMatchIdRef.current)) {
        matchRefreshOperationRef.current = null;
        setMatchDetailRefreshing(false);
      }
    }
  };
  return { updatePlayerStat, submitResult, submitDispute, submitVoidMatch, submitVoidRestoreRequest, refreshMatchDetail };
}

export function createMatchRoomCourtReviewSubmit(context) {
  const { app, canSubmitCourtReview, courtReviewDraft, courtReviewOperationRef, courtReviewRatingReady, currentMatchIdRef, match, matchOperationSequenceRef, setCourtReviewSaveFeedback, setCourtReviewSaving } = context;
  return async () => {
    if (!canSubmitCourtReview || !courtReviewRatingReady || courtReviewOperationRef.current?.scopeId === match.id) return;
    const operation = { scopeId: match.id, operationId: ++matchOperationSequenceRef.current };
    courtReviewOperationRef.current = operation;
    setCourtReviewSaving(true);
    setCourtReviewSaveFeedback("저장 중");
    try {
      const savedReview = await app.actions.submitCourtReview(match.id, courtReviewDraft);
      if (!isCurrentScopedOperation(courtReviewOperationRef.current, operation, currentMatchIdRef.current)) return;
      setCourtReviewSaveFeedback(savedReview ? "저장되었습니다." : "구장 후기를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } catch {
      if (isCurrentScopedOperation(courtReviewOperationRef.current, operation, currentMatchIdRef.current)) setCourtReviewSaveFeedback("구장 후기를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      if (isCurrentScopedOperation(courtReviewOperationRef.current, operation, currentMatchIdRef.current)) {
        courtReviewOperationRef.current = null;
        setCourtReviewSaving(false);
      }
    }
  };
}
