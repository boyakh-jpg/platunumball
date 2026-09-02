import { useState } from "react";
import { Link } from "react-router-dom";
import MatchDisputeQueue from "../components/match/MatchDisputeQueue.jsx";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import ShareCard from "../components/share/ShareCard.jsx";
import { PLAYER_STAT_FIELDS } from "../lib/constants.js";
import { REPORT_TARGET_TYPES, VOID_MATCH_RESTORE_REPORT_REASON } from "../lib/reportReasons.js";
import { buildReportEntryPath } from "../lib/reportEntry.js";
import {
  formatMatchWindowTime,
  formatStatLine,
  MATCH_DISPUTE_REASON_OPTIONS,
  OTHER_MATCH_DISPUTE_REASON,
} from "../lib/matchUtils.js";
import {
  getRecordPlayerDisplayName,
  getRecordPlayerEntries,
} from "./matchRoomModel.js";

export function MatchRoomReviewPanels({ controller }) {
  const { app, match, score, disputeReason, setDisputeReason, disputeCustomReason, setDisputeCustomReason, disputeRequestedStats, setDisputeRequestedStats, disputeRequestedScoreA, setDisputeRequestedScoreA, disputeRequestedScoreB, setDisputeRequestedScoreB, statEditorPlayerId, setStatEditorPlayerId, reviewControlsOpen, setReviewControlsOpen, resultSaveFeedback, courtReviewSaveFeedback, courtReviewSaving, matchDetailRefreshing, soloRecordDeleteOpen, setSoloRecordDeleteOpen, managementActionPending, managementActionFeedback, voidDialogOpen, setVoidDialogOpen, voidActionPending, finalizeDialogOpen, setFinalizeDialogOpen, finalizeActionPending, voidRestoreDetail, setVoidRestoreDetail, voidRestoreStatus, existingCourtReview, courtReviewDraft, userMap, statEditorPlayer, isSharedRecord, status, cancelCopy, cancelActionLabel, teamAAgreement, teamBAgreement, currentUserSideName, recordWindow, referee, hasReferee, isSoloRecord, currentUserIsEligibleReferee, currentUserSubmitted, benchCapacity, isMatchHost, matchPhase, startedAuthorityPhase, currentUserCanEndMatch, currentUserCanResolveDispute, currentUserCanRefreshReview, resultEntryPermission, canEditDisputeDraft, canSubmitLiveResult, canSubmitResult, canCancel, requestCancelMatch, canFinalizeMatch, finalAuthorityLabel, openDisputes, hasOwnOpenDispute, canDispute, canRequestMatchDispute, canRequestOwnPointDispute, canRequestScoreDispute, canVoid, canRequestVoidRestore, canDeleteSoloRecord, requestFinalizeMatch, submitFinalizeMatch, canReport, isContractStage, shouldShowResultEntry, shouldShowWaitingPanel, scoreA, scoreB, draftScoreA, draftScoreB, teamASide, teamBSide, teamA, teamB, teamAMmr, teamBMmr, winnerName, matchKind, recordLockReason, renderHeroRoster, renderHeroReserves, updatePlayerStat, submitResult, submitDispute, submitVoidMatch, submitVoidRestoreRequest, refreshMatchDetail, canEditPlayerStat, editableStatFields, getPlayerStatState, permissionTitle, permissionDetail, nextAction, statTrustSteps, statTrustPercent, canSubmitCourtReview, courtReviewRatingReady, updateCourtReviewDraft, submitCourtReview, deleteSoloRecord, confirmDeleteSoloRecord, normalizedRules, ruleItems } = controller;
  const { noDisputeStatus, showNoDisputeAction, canAcknowledgeNoDispute } = controller;
  const [noDisputePending, setNoDisputePending] = useState(false);
  const [noDisputeFeedback, setNoDisputeFeedback] = useState("");
  const [disputePending, setDisputePending] = useState(false);
  const [disputeFeedback, setDisputeFeedback] = useState({ message: "", failed: false });
  const acknowledgeNoDispute = async () => {
    if (!canAcknowledgeNoDispute || noDisputePending) return;
    setNoDisputePending(true);
    setNoDisputeFeedback("");
    try {
      const result = await app.actions.acknowledgeMatchNoDispute(match.id);
      if (!result || result.ok === false) setNoDisputeFeedback("이의 없음 처리에 실패했습니다.");
    } catch {
      setNoDisputeFeedback("이의 없음 처리에 실패했습니다.");
    } finally {
      setNoDisputePending(false);
    }
  };
  const submitMatchDispute = async () => {
    if (!canRequestMatchDispute || disputePending) return;
    setDisputePending(true);
    setDisputeFeedback({ message: "", failed: false });
    try {
      const result = await submitDispute();
      setDisputeFeedback(!result || result?.ok === false
        ? { message: "이의제기를 접수하지 못했습니다. 다시 시도해 주세요.", failed: true }
        : { message: "이의제기를 접수했습니다.", failed: false });
    } catch {
      setDisputeFeedback({ message: "이의제기를 접수하지 못했습니다. 다시 시도해 주세요.", failed: true });
    } finally {
      setDisputePending(false);
    }
  };
  return (
    <>
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
            <p className="muted">이의제기 마감: {formatMatchWindowTime(recordWindow.disputeClosesAt)}</p>
            {showNoDisputeAction ? (
              <div className="match-action-row">
                <span>이의 없음 {noDisputeStatus.count}/{noDisputeStatus.requiredCount}</span>
                <Button type="button" variant="secondary" disabled={!canAcknowledgeNoDispute || noDisputePending} onClick={acknowledgeNoDispute}>
                  {noDisputeStatus.acknowledged ? "확인 완료" : noDisputePending ? "처리 중" : "이의 없음"}
                </Button>
                {noDisputeFeedback ? <small role="status" className="form-warning">{noDisputeFeedback}</small> : null}
              </div>
            ) : null}
            <Button type="button" variant="secondary" aria-pressed={reviewControlsOpen} onClick={() => setReviewControlsOpen((current) => !current)}>
              {reviewControlsOpen ? "보조 메뉴 닫기" : "취소/이의/신고 열기"}
            </Button>
            {reviewControlsOpen ? (
              <>
                <div className="dispute-score-request">
                  <div>
                    <span>점수판</span>
                    <strong>{scoreA} : {scoreB}</strong>
                  </div>
                  {hasReferee ? (
                    <div className="arena-dispute-score-row arena-dispute-stat-grid">
                      {PLAYER_STAT_FIELDS.map((field) => (
                        <label key={field.id}>
                          {field.label} · 현재 {match.result?.playerStats?.[app.currentUser.id]?.[field.id] ?? 0}
                          <input
                            type="number"
                            min="0"
                            max="999"
                            disabled={!canRequestOwnPointDispute}
                            value={disputeRequestedStats[field.id] ?? "0"}
                            onChange={(event) => setDisputeRequestedStats((current) => ({
                              ...current,
                              [field.id]: event.target.value,
                            }))}
                          />
                        </label>
                      ))}
                    </div>
                  ) : (
                    <div className="arena-dispute-score-row arena-dispute-team-score-grid">
                      <label>
                        {teamASide.name} · 현재 {scoreA}
                        <input type="number" min="0" max="999" disabled={!canRequestScoreDispute} value={disputeRequestedScoreA} onChange={(event) => setDisputeRequestedScoreA(event.target.value)} />
                      </label>
                      <label>
                        {teamBSide.name} · 현재 {scoreB}
                        <input type="number" min="0" max="999" disabled={!canRequestScoreDispute} value={disputeRequestedScoreB} onChange={(event) => setDisputeRequestedScoreB(event.target.value)} />
                      </label>
                    </div>
                  )}
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
                <div className="match-action-row">
                  <Button type="button" variant="secondary" disabled={!canRequestMatchDispute || disputePending} onClick={submitMatchDispute}>{disputePending ? "접수 중" : hasOwnOpenDispute ? "처리 대기 중" : "이의제기"}</Button>
                  <Button type="button" variant="danger" disabled={!canCancel || Boolean(managementActionPending)} onClick={requestCancelMatch}>{managementActionPending === "cancel" ? "처리 중" : cancelActionLabel}</Button>
                  <Button type="button" variant="danger" disabled={!canVoid} onClick={() => setVoidDialogOpen(true)}>경기 무효 처리</Button>
                  {canReport ? (
                    <Button as={Link} variant="secondary" to={buildReportEntryPath({ targetType: REPORT_TARGET_TYPES.match, targetId: match.id })}>신고하기</Button>
                  ) : null}
                </div>
                {disputeFeedback.message ? <small role="status" className={disputeFeedback.failed ? "form-warning" : "form-chip"}>{disputeFeedback.message}</small> : null}
                {managementActionFeedback ? <small role="status" className="form-warning">{managementActionFeedback}</small> : null}
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
    </>
  );
}
