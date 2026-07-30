import { Link } from "react-router-dom";
import { CalendarDays, MapPin, RotateCcw, ShieldCheck, Star, Trophy, UsersRound, X } from "lucide-react";
import AgreementPanel from "../components/match/AgreementPanel.jsx";
import ApprovalPanel from "../components/match/ApprovalPanel.jsx";
import MatchClockPanel, { MatchScoreControls } from "../components/match/MatchClockPanel.jsx";
import MatchContract from "../components/match/MatchContract.jsx";
import MatchDisputeQueue from "../components/match/MatchDisputeQueue.jsx";
import MatchRecommendationPanel from "../components/match/MatchRecommendationPanel.jsx";
import MatchVoidDialog, { MatchFinalizeDialog } from "../components/match/MatchVoidDialog.jsx";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import NumericStepper from "../components/common/NumericStepper.jsx";
import PlayerHoverCard from "../components/profile/PlayerHoverCard.jsx";
import ProfileEmblem from "../components/profile/ProfileEmblem.jsx";
import MmrChange from "../components/rating/MmrChange.jsx";
import RefereeHoverCard from "../components/referee/RefereeHoverCard.jsx";
import ShareCard from "../components/share/ShareCard.jsx";
import TeamHoverCard from "../components/team/TeamHoverCard.jsx";
import { MATCH_SIDE_FALLBACK_NAMES, MATCH_SIDES, PLAYER_STAT_FIELDS, normalizeDisputeWindowMinutes } from "../lib/constants.js";
import { REPORT_REASONS, REPORT_TARGET_TYPES, VOID_MATCH_RESTORE_REPORT_REASON, getReportTargetType } from "../lib/reportReasons.js";
import { formatMatchWindowTime, formatStatLine, MATCH_DISPUTE_REASON_OPTIONS, OTHER_MATCH_DISPUTE_REASON, getMatchSideRecordPlayerIds, getPlayerStatSubmitted } from "../lib/matchUtils.js";
import {
  getRecordPlayerDisplayName,
  isAnonymousDisplayUser,
  getAvatarInitial,
  getPlayerMetaLabel,
  getRecordPlayerEntries,
  COURT_REVIEW_FIELDS,
} from "./matchRoomModel.js";
import {
  CourtReviewRating,
} from "./MatchRoomParts.jsx";

export function MatchRoomStatEditor({ controller }) {
  const { app, match, score, disputeReason, setDisputeReason, disputeCustomReason, setDisputeCustomReason, disputeRequestedStats, setDisputeRequestedStats, disputeRequestedScoreA, setDisputeRequestedScoreA, disputeRequestedScoreB, setDisputeRequestedScoreB, reportReason, setReportReason, statEditorPlayerId, setStatEditorPlayerId, reviewControlsOpen, setReviewControlsOpen, resultSaveFeedback, courtReviewSaveFeedback, courtReviewSaving, matchDetailRefreshing, soloRecordDeleteOpen, setSoloRecordDeleteOpen, voidDialogOpen, setVoidDialogOpen, voidActionPending, finalizeDialogOpen, setFinalizeDialogOpen, finalizeActionPending, voidRestoreDetail, setVoidRestoreDetail, voidRestoreStatus, existingCourtReview, courtReviewDraft, userMap, statEditorPlayer, isSharedRecord, status, cancelCopy, cancelActionLabel, teamAAgreement, teamBAgreement, currentUserSideName, recordWindow, referee, hasReferee, isSoloRecord, currentUserIsEligibleReferee, currentUserSubmitted, benchCapacity, isMatchHost, matchPhase, startedAuthorityPhase, currentUserCanEndMatch, currentUserCanResolveDispute, currentUserCanRefreshReview, resultEntryPermission, canEditDisputeDraft, canSubmitLiveResult, canSubmitResult, canCancel, requestCancelMatch, canFinalizeMatch, finalAuthorityLabel, openDisputes, hasOwnOpenDispute, canDispute, canRequestMatchDispute, canRequestOwnPointDispute, canRequestScoreDispute, canVoid, canRequestVoidRestore, canDeleteSoloRecord, requestFinalizeMatch, submitFinalizeMatch, canReport, isContractStage, shouldShowResultEntry, shouldShowWaitingPanel, scoreA, scoreB, draftScoreA, draftScoreB, teamASide, teamBSide, teamA, teamB, teamAMmr, teamBMmr, winnerName, matchKind, recordLockReason, renderHeroRoster, renderHeroReserves, updatePlayerStat, submitResult, submitDispute, submitVoidMatch, submitVoidRestoreRequest, refreshMatchDetail, canEditPlayerStat, editableStatFields, getPlayerStatState, permissionTitle, permissionDetail, nextAction, statTrustSteps, statTrustPercent, canSubmitCourtReview, courtReviewRatingReady, updateCourtReviewDraft, submitCourtReview, deleteSoloRecord, confirmDeleteSoloRecord, normalizedRules, ruleItems } = controller;
  return (statEditorPlayer && (hasReferee || isSoloRecord) ? (
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
          </div>
        </div>
      ) : null);
}
