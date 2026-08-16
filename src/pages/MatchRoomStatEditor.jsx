import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import Button from "../components/common/Button.jsx";
import NumericStepper from "../components/common/NumericStepper.jsx";
import ModalShell from "../components/common/ModalShell.jsx";
import { formatStatLine } from "../lib/matchUtils.js";

export function MatchRoomStatEditor({ controller }) {
  const { app, match, score, disputeReason, setDisputeReason, disputeCustomReason, setDisputeCustomReason, disputeRequestedStats, setDisputeRequestedStats, disputeRequestedScoreA, setDisputeRequestedScoreA, disputeRequestedScoreB, setDisputeRequestedScoreB, reportReason, setReportReason, statEditorPlayerId, setStatEditorPlayerId, reviewControlsOpen, setReviewControlsOpen, resultSaveFeedback, courtReviewSaveFeedback, courtReviewSaving, matchDetailRefreshing, soloRecordDeleteOpen, setSoloRecordDeleteOpen, voidDialogOpen, setVoidDialogOpen, voidActionPending, finalizeDialogOpen, setFinalizeDialogOpen, finalizeActionPending, voidRestoreDetail, setVoidRestoreDetail, voidRestoreStatus, existingCourtReview, courtReviewDraft, userMap, statEditorPlayer, isSharedRecord, status, cancelCopy, cancelActionLabel, teamAAgreement, teamBAgreement, currentUserSideName, recordWindow, referee, hasReferee, isSoloRecord, currentUserIsEligibleReferee, currentUserSubmitted, benchCapacity, isMatchHost, matchPhase, startedAuthorityPhase, currentUserCanEndMatch, currentUserCanResolveDispute, currentUserCanRefreshReview, resultEntryPermission, canEditDisputeDraft, canSubmitLiveResult, canSubmitResult, canCancel, requestCancelMatch, canFinalizeMatch, finalAuthorityLabel, openDisputes, hasOwnOpenDispute, canDispute, canRequestMatchDispute, canRequestOwnPointDispute, canRequestScoreDispute, canVoid, canRequestVoidRestore, canDeleteSoloRecord, requestFinalizeMatch, submitFinalizeMatch, canReport, isContractStage, shouldShowResultEntry, shouldShowWaitingPanel, scoreA, scoreB, draftScoreA, draftScoreB, teamASide, teamBSide, teamA, teamB, teamAMmr, teamBMmr, winnerName, matchKind, recordLockReason, renderHeroRoster, renderHeroReserves, updatePlayerStat, submitResult, submitDispute, submitVoidMatch, submitVoidRestoreRequest, refreshMatchDetail, canEditPlayerStat, editableStatFields, getPlayerStatState, permissionTitle, permissionDetail, nextAction, statTrustSteps, statTrustPercent, canSubmitCourtReview, courtReviewRatingReady, updateCourtReviewDraft, submitCourtReview, deleteSoloRecord, confirmDeleteSoloRecord, normalizedRules, ruleItems } = controller;
  const dialogRef = useRef(null);
  const restoreFocusRef = useRef(null);
  const open = Boolean(statEditorPlayer && (hasReferee || isSoloRecord));

  useEffect(() => {
    if (!open) return undefined;
    restoreFocusRef.current = document.activeElement;
    const focusFrame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector("[data-dialog-initial-focus]")?.focus();
    });
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setStatEditorPlayerId(null);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      ) ?? [])];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
        dialogRef.current?.focus();
      } else if (!dialogRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown);
      const target = restoreFocusRef.current;
      if (target instanceof window.HTMLElement && target.isConnected) target.focus();
    };
  }, [open, setStatEditorPlayerId]);

  return (open ? (
        <div className="modal-backdrop stat-editor-backdrop" onClick={() => setStatEditorPlayerId(null)}>
          <ModalShell as="div" ref={dialogRef} className="modal stat-editor-modal" role="dialog" aria-modal="true" aria-labelledby="match-stat-editor-title" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">개인 기록</p>
                <h2 id="match-stat-editor-title">{statEditorPlayer.name}</h2>
                <span>{formatStatLine(score.playerStats[statEditorPlayerId])}</span>
              </div>
              <button type="button" className="button ui-button button-secondary ui-button-secondary button-icon" data-dialog-initial-focus onClick={() => setStatEditorPlayerId(null)} aria-label="닫기">
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
                    integer={false}
                    label={field.label}
                    max={Number.MAX_SAFE_INTEGER}
                    value={score.playerStats[statEditorPlayerId]?.[field.id] ?? 0}
                    onChange={(value) => updatePlayerStat(statEditorPlayerId, field.id, value)}
                  />
                </div>
              ))}
            </div>
            <Button type="button" onClick={() => setStatEditorPlayerId(null)}>완료</Button>
          </ModalShell>
        </div>
      ) : null);
}
