import { Link } from "react-router-dom";
import { CalendarDays, MapPin, RotateCcw, ShieldCheck, Star, Trophy, UsersRound } from "lucide-react";
import AgreementPanel from "../components/match/AgreementPanel.jsx";
import ApprovalPanel from "../components/match/ApprovalPanel.jsx";
import MatchClockPanel, { MatchScoreControls } from "../components/match/MatchClockPanel.jsx";
import MatchContract from "../components/match/MatchContract.jsx";
import MatchRecommendationPanel from "../components/match/MatchRecommendationPanel.jsx";
import MatchVoidDialog, { MatchFinalizeDialog } from "../components/match/MatchVoidDialog.jsx";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import PlayerHoverCard from "../components/profile/PlayerHoverCard.jsx";
import ProfileEmblem from "../components/profile/ProfileEmblem.jsx";
import MmrChange from "../components/rating/MmrChange.jsx";
import RefereeHoverCard from "../components/referee/RefereeHoverCard.jsx";
import TeamHoverCard from "../components/team/TeamHoverCard.jsx";
import { MATCH_SIDE_FALLBACK_NAMES, MATCH_SIDES, normalizeDisputeWindowMinutes } from "../lib/constants.js";
import { formatMatchWindowTime, formatStatLine, getMatchSideRecordPlayerIds, getPlayerStatSubmitted } from "../lib/matchUtils.js";
import {
  getRecordPlayerDisplayName,
  isAnonymousDisplayUser,
  getAvatarInitial,
  getPlayerMetaLabel,
  COURT_REVIEW_FIELDS,
} from "./matchRoomModel.js";
import {
  CourtReviewRating,
} from "./MatchRoomParts.jsx";
import { MatchRoomReviewPanels } from "./MatchRoomReviewPanels.jsx";
import { MatchRoomStatEditor } from "./MatchRoomStatEditor.jsx";
export default function MatchRoomView({ controller }) {
  const { app, match, score, setScore, disputeReason, setDisputeReason, disputeCustomReason, setDisputeCustomReason, disputeRequestedStats, setDisputeRequestedStats, disputeRequestedScoreA, setDisputeRequestedScoreA, disputeRequestedScoreB, setDisputeRequestedScoreB, reportReason, setReportReason, statEditorPlayerId, setStatEditorPlayerId, reviewControlsOpen, setReviewControlsOpen, resultSaveFeedback, courtReviewSaveFeedback, courtReviewSaving, matchDetailRefreshing, soloRecordDeleteOpen, setSoloRecordDeleteOpen, managementActionPending, managementActionFeedback, voidDialogOpen, setVoidDialogOpen, voidActionPending, finalizeDialogOpen, setFinalizeDialogOpen, finalizeActionPending, finalizeActionError, voidRestoreDetail, setVoidRestoreDetail, voidRestoreStatus, existingCourtReview, courtReviewDraft, userMap, statEditorPlayer, isSharedRecord, status, cancelCopy, cancelActionLabel, teamAAgreement, teamBAgreement, currentUserSideName, recordWindow, referee, hasReferee, isSoloRecord, currentUserIsEligibleReferee, currentUserSubmitted, benchCapacity, isMatchHost, matchPhase, startedAuthorityPhase, currentUserCanEndMatch, currentUserCanResolveDispute, currentUserCanRefreshReview, resultEntryPermission, canEditDisputeDraft, canSubmitLiveResult, canSubmitResult, canCancel, requestCancelMatch, agreeCurrentUser, canFinalizeMatch, finalAuthorityLabel, openDisputes, hasOwnOpenDispute, canDispute, canRequestMatchDispute, canRequestOwnPointDispute, canRequestScoreDispute, canVoid, canRequestVoidRestore, canDeleteSoloRecord, requestFinalizeMatch, submitFinalizeMatch, canReport, isContractStage, shouldShowResultEntry, shouldShowWaitingPanel, scoreA, scoreB, draftScoreA, draftScoreB, teamASide, teamBSide, teamA, teamB, teamAMmr, teamBMmr, winnerName, matchKind, recordLockReason, renderHeroRoster, renderHeroReserves, updatePlayerStat, submitResult, submitDispute, submitVoidMatch, submitVoidRestoreRequest, refreshMatchDetail, canEditPlayerStat, editableStatFields, getPlayerStatState, permissionTitle, permissionDetail, nextAction, statTrustSteps, statTrustPercent, canSubmitCourtReview, courtReviewRatingReady, updateCourtReviewDraft, submitCourtReview, deleteSoloRecord, confirmDeleteSoloRecord, normalizedRules, ruleItems } = controller;
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
        <div className="app-confirm-backdrop" role="presentation" onMouseDown={() => !managementActionPending && setSoloRecordDeleteOpen(false)}>
          <div className="app-confirm-dialog" role="dialog" aria-modal="true" aria-label="개인 기록 삭제 확인" onMouseDown={(event) => event.stopPropagation()}>
            <strong>개인 기록 삭제</strong>
            <p>삭제하면 내 기록 목록에서 사라집니다. MMR은 변하지 않습니다.</p>
            {managementActionFeedback ? <small role="status" className="form-warning">{managementActionFeedback}</small> : null}
            <div className="app-confirm-actions">
              <Button type="button" variant="secondary" disabled={Boolean(managementActionPending)} onClick={() => setSoloRecordDeleteOpen(false)}>취소</Button>
              <Button type="button" variant="danger" disabled={Boolean(managementActionPending)} onClick={confirmDeleteSoloRecord}>{managementActionPending === "delete" ? "삭제 중" : "삭제하기"}</Button>
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
          <Button type="button" disabled={Boolean(managementActionPending)} onClick={() => void agreeCurrentUser()}>{nextAction.button}</Button>
        ) : nextAction.href ? (
          <Button as="a" href={nextAction.href}>{nextAction.button}</Button>
        ) : (
          <Badge tone={status.tone}>{status.label}</Badge>
        )}
        {managementActionFeedback ? <small role="status" className="form-warning">{managementActionFeedback}</small> : null}
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
          <Button type="button" variant="danger" disabled={!canCancel || Boolean(managementActionPending)} onClick={requestCancelMatch}>{managementActionPending === "cancel" ? "처리 중" : cancelActionLabel}</Button>
          {canDeleteSoloRecord ? (
            <Button type="button" variant="danger" disabled={Boolean(managementActionPending)} onClick={deleteSoloRecord}>개인 기록 삭제</Button>
          ) : null}
          {managementActionFeedback ? <small role="status" className="form-warning">{managementActionFeedback}</small> : null}
        </Card>
      ) : null}

      {matchPhase === "live" && match.rules?.gameClockEnabled !== false ? (
        <MatchClockPanel
          match={match}
          onMatchEnded={() => void refreshMatchDetail()}
          canEndMatch={currentUserCanEndMatch}
          onEndMatch={() => app.actions.endMatch(match.id)}
          onRosterChanged={() => void refreshMatchDetail()}
          editableScoreSides={hasReferee ? [] : resultEntryPermission.editableScoreSides}
          onIncrementScore={(sideName, delta, revisions) => app.actions.incrementMatchScore?.(
            match.id,
            sideName === "teamA" ? delta : 0,
            sideName === "teamB" ? delta : 0,
            revisions,
          )}
        />
      ) : null}
      {matchPhase === "live" && normalizedRules.gameClockEnabled === false && !hasReferee && resultEntryPermission.editableScoreSides.length ? (
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
              onAgree={(sideName, playerId) => agreeCurrentUser(sideName, playerId)}
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
                <strong>{formatMatchWindowTime(recordWindow.statClosesAt)}</strong>
                <em>경기 종료 후 {match.statEntryMinutes ?? 60}분</em>
              </div>
              <div>
                <span>이의제기 마감</span>
                <strong>{formatMatchWindowTime(recordWindow.disputeClosesAt)}</strong>
                <em>경기 종료 후 {normalizeDisputeWindowMinutes(match.disputeMinutes)}분</em>
              </div>
            </div>
            {match.endedAt && !hasReferee && resultEntryPermission.editableScoreSides.length ? (
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
                <input
                  type="number" min="0" max="999"
                  aria-label={`${teamASide.name} 팀 점수`}
                  disabled={!resultEntryPermission.editableScoreSides.includes("teamA")}
                  value={draftScoreA} onChange={(event) => setScore((current) => ({ ...current, scoreA: event.target.value }))}
                />
              </label>
              <span>:</span>
              <label>
                {teamBSide.name}
                <input
                  type="number" min="0" max="999"
                  aria-label={`${teamBSide.name} 팀 점수`}
                  disabled={!resultEntryPermission.editableScoreSides.includes("teamB")}
                  value={draftScoreB} onChange={(event) => setScore((current) => ({ ...current, scoreB: event.target.value }))}
                />
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
                {canFinalizeMatch ? <Button type="button" disabled={finalizeActionPending} onClick={requestFinalizeMatch}>{finalizeActionPending ? "승인 중" : "최종 승인"}</Button> : null}
                {isSoloRecord && finalizeActionError ? <small role="status" className="form-warning">{finalizeActionError}</small> : null}
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
          <MatchRoomReviewPanels controller={controller} />
          </aside>
        </div>
      )}
      <MatchRoomStatEditor controller={controller} />
      <MatchVoidDialog
        open={voidDialogOpen}
        pending={voidActionPending}
        onClose={() => setVoidDialogOpen(false)}
        onConfirm={submitVoidMatch}
      />
      <MatchFinalizeDialog
        open={finalizeDialogOpen}
        pending={finalizeActionPending}
        error={finalizeActionError}
        openDisputeCount={openDisputes.length}
        authorityLabel={finalAuthorityLabel}
        onClose={() => setFinalizeDialogOpen(false)}
        onConfirm={submitFinalizeMatch}
      />
    </div>
  );
}
