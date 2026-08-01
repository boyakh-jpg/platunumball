import RecruitingRoomActionFeedback from "./RecruitingRoomActionFeedback.jsx";
export function RecruitingRoomActionSection({ context }) {
  const {
    ApprovalPanel, Button, MATCH_DISPUTE_REASON_OPTIONS, MatchRecommendationPanel, OTHER_MATCH_DISPUTE_REASON, PLAYER_POSITIONS,
    PLAYER_STAT_FIELDS, RefreshCw, RotateCcw, SIDE_LABELS, ShieldCheck, SourceMatchDisputeReviewPanel,
    SourceMatchDisputeEditor, SourceMatchRecordSummary, Swords, TeamMemberPicker, TierBadge, UserRound,
    UsersRound, XCircle, alreadyApplied, app, benchCapacity, canCancelSourceMatch,
    canConfirmRefereeAbsence, canDeleteSourceSoloRecord, canEndSourceMatch, canFinalizeSourceMatch, canJoin, canRefreshSourceMatchReview,
    canRemakeRoom, canRequestRefereeAbsence, canRequestSourceMatchPointDispute, canResolveSourceMatchDispute, canShowStartSourceMatch, canStartSourceMatch,
    canSubmitSourceMatchLiveResult, canSubmitSourceMatchPostgameResult, cancellationReasonText, candidateMmr, confirmPaidCourtJoin, confirmQueueRoom,
    confirmingMatchId, createPortal, currentUserIsRoomReferee, deleteSourceSoloRecord, fit, getDefaultApplyTeamId,
    getEditableSourceMatchStatFields, getJoinRosterPatch, getJoinTeamEligibility, getLobbyPrimaryTeamId, getPartyOptionKey, getPartyOptionLabel,
    getRoomCancellationActionLabel, individualOnlyRoom, joinCapacity, joinDraft, joinModeEntries, joinSideParty,
    joiningPartyKey, joiningThisRoom, lobby, matchRoom, mine, myTeams,
    paidCourtJoinPrompt, pickupPoolMode, recruitingRoomConfirmed, recruitingRoomTerminalStatus, refreshSourceMatchReview, remakeRoom,
    requestRecruitingCancellation, requestSourceMatchCancellation, requestSourceMatchFinalization, roomCancellationPolicy, roomQueueStatus, roomTimingStatus,
    ruleAcknowledgementPending, scheduleChangePending, selectedJoinPlayerIds, selectedJoinReserveIds, selectedJoinTeam, selectedJoinTeamEligibility,
    selectedMatchRules, selectedPost, setPaidCourtJoinPrompt, setSourceDisputeDraft, showSourceMatchRecordSummary, sidePartyJoinOptions,
    sourceDisputeDraft, sourceDisputePending, sourceDisputeStatus, sourceFinalAuthorityLabel, sourceHasOwnOpenDispute, sourceMatch, sourceMatchAction, sourceMatchActionPending, sourceMatchApprovalOpen,
    sourceMatchCancelActionLabel, sourceMatchIsRecordRoom, sourceMatchRecordBoardFirst, sourceMatchResultSubmitLabel, sourceMatchReviewRefreshing, sourceMatchSideName,
    sourceMatchResultEntryPermission, sourceMatchStartButtonLabel, sourceMatchStartButtonTitle, sourceOpenDisputes, sourceRoomReadOnly, submitJoin, submitSourceDispute,
    teamOnlyRoom, teamRoomHasJoinableSide, updateJoinDraft, userById, runSourceMatchAction,
  } = context;
  return (
    <>
<div className="arena-join-panel">
                {matchRoom ? (
                  <div className="arena-owner-panel">
                    <strong>{sourceMatchAction.label}</strong>
                    <span>{sourceMatchAction.detail}</span>
                    {cancellationReasonText ? (
                      <span className="arena-cancellation-reason"><b>취소 사유</b>{cancellationReasonText}</span>
                    ) : null}
                    {canRemakeRoom ? (
                      <Button type="button" variant="secondary" onClick={remakeRoom}>
                        <RotateCcw size={17} /> 같은 설정으로 다시 만들기
                      </Button>
                    ) : null}
                    {!sourceMatchRecordBoardFirst && !sourceMatchIsRecordRoom && showSourceMatchRecordSummary ? (
                      <SourceMatchRecordSummary match={sourceMatch} userById={userById} />
                    ) : null}
                    {!sourceMatchRecordBoardFirst && sourceMatchIsRecordRoom && sourceMatch.rules?.recordSetupReady === true ? (
                      <ApprovalPanel
                        match={sourceMatch}
                        teams={app.state.teams}
                        users={app.state.users}
                        currentUserId={app.currentUser.id}
                        onApprove={(sideName, playerId) => app.actions.approveMatch(sourceMatch.id, sideName, playerId)}
                      />
                    ) : null}
                    {sourceMatchApprovalOpen && !sourceMatchAction.disputed && canRefreshSourceMatchReview ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={sourceMatchReviewRefreshing}
                        onClick={() => void refreshSourceMatchReview()}
                      >
                        <RefreshCw size={15} />
                        {sourceMatchReviewRefreshing ? "갱신 중" : "결과·이의 새로고침"}
                      </Button>
                    ) : null}
                    {sourceMatchApprovalOpen && sourceMatch.refereeId ? (
                      <form className="arena-dispute-editor" onSubmit={submitSourceDispute}>
                        <strong>{app.currentUser.name} · 내 기록 수정 요청</strong>
                        <div className="arena-dispute-score-row arena-dispute-stat-grid">
                          {PLAYER_STAT_FIELDS.map((field) => (
                            <label key={field.id}>
                              {field.label} · 현재 {sourceMatch.result?.playerStats?.[app.currentUser.id]?.[field.id] ?? 0}
                              <input
                                type="number"
                                min="0"
                                max="999"
                                disabled={!canRequestSourceMatchPointDispute}
                                value={sourceDisputeDraft.requestedStats?.[field.id] ?? "0"}
                                onChange={(event) => setSourceDisputeDraft((current) => ({
                                  ...current,
                                  requestedStats: { ...(current.requestedStats ?? {}), [field.id]: event.target.value },
                                }))}
                              />
                            </label>
                          ))}
                        </div>
                        <label className="memo-label">
                          이의제기 사유
                          <select
                            disabled={!canRequestSourceMatchPointDispute}
                            value={sourceDisputeDraft.matchId === sourceMatch.id ? sourceDisputeDraft.reason : MATCH_DISPUTE_REASON_OPTIONS[0]}
                            onChange={(event) => setSourceDisputeDraft((current) => ({ ...current, matchId: sourceMatch.id, resultKey: sourceMatch.result?.updatedAt ?? sourceMatch.result?.submittedAt ?? "", reason: event.target.value }))}
                          >
                            {MATCH_DISPUTE_REASON_OPTIONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
                          </select>
                        </label>
                        {sourceDisputeDraft.reason === OTHER_MATCH_DISPUTE_REASON ? (
                          <label className="memo-label">
                            기타 사유
                            <textarea
                              disabled={!canRequestSourceMatchPointDispute}
                              value={sourceDisputeDraft.matchId === sourceMatch.id ? sourceDisputeDraft.customReason : ""}
                              onChange={(event) => setSourceDisputeDraft((current) => ({ ...current, matchId: sourceMatch.id, resultKey: sourceMatch.result?.updatedAt ?? sourceMatch.result?.submittedAt ?? "", customReason: event.target.value }))}
                            />
                          </label>
                        ) : null}
                        <div className="match-action-row">
                          <Button type="submit" variant="secondary" disabled={!canRequestSourceMatchPointDispute || sourceDisputePending}>{sourceDisputePending ? "접수 중" : sourceHasOwnOpenDispute ? "처리 대기 중" : "이의제기"}</Button>
                        </div>
                        {sourceDisputeStatus ? <span className="form-warning" role="status">{sourceDisputeStatus}</span> : null}
                      </form>
                    ) : null}
                    {sourceMatchApprovalOpen && !sourceMatch.refereeId ? (
                      <form className="arena-dispute-editor" onSubmit={submitSourceDispute}>

                        <div className="arena-dispute-score-row arena-dispute-team-score-grid">
                          <label>
                            {sourceMatch.teamA?.name ?? "A"} · 현재 {sourceMatch.result?.scoreA ?? sourceMatch.teamA?.score ?? 0}
                            <input type="number" min="0" max="999" disabled={!canRequestSourceMatchPointDispute} value={sourceDisputeDraft.requestedScoreA} onChange={(event) => setSourceDisputeDraft((current) => ({ ...current, requestedScoreA: event.target.value }))} />
                          </label>
                          <label>
                            {sourceMatch.teamB?.name ?? "B"} · 현재 {sourceMatch.result?.scoreB ?? sourceMatch.teamB?.score ?? 0}
                            <input type="number" min="0" max="999" disabled={!canRequestSourceMatchPointDispute} value={sourceDisputeDraft.requestedScoreB} onChange={(event) => setSourceDisputeDraft((current) => ({ ...current, requestedScoreB: event.target.value }))} />
                          </label>
                        </div>
                        <label className="memo-label">
                          점수 정정 사유
                          <textarea disabled={!canRequestSourceMatchPointDispute} value={sourceDisputeDraft.customReason} onChange={(event) => setSourceDisputeDraft((current) => ({ ...current, customReason: event.target.value }))} />
                        </label>
                        <div className="match-action-row">
                          <Button type="submit" variant="secondary" disabled={sourceDisputePending || !canRequestSourceMatchPointDispute || !sourceDisputeDraft.customReason.trim()}>{sourceDisputePending ? "접수 중" : "이의제기"}</Button>
                        </div>
                        {sourceDisputeStatus ? <span className="form-warning" role="status">{sourceDisputeStatus}</span> : null}
                      </form>
                    ) : null}
                    {!sourceMatchRecordBoardFirst && !sourceMatchIsRecordRoom && sourceMatchAction.disputed ? (
                      <SourceMatchDisputeReviewPanel
                        match={sourceMatch}
                        userById={userById}
                        canResolve={canResolveSourceMatchDispute}
                        actions={app.actions}
                        onRefresh={canRefreshSourceMatchReview ? refreshSourceMatchReview : null}
                        refreshing={sourceMatchReviewRefreshing}
                      />
                    ) : null}
                    {!sourceMatchRecordBoardFirst && !sourceMatchIsRecordRoom && Boolean(sourceMatch.refereeId) && !sourceMatchAction.disputed && (canSubmitSourceMatchLiveResult || canSubmitSourceMatchPostgameResult) ? (
                      <SourceMatchDisputeEditor
                        match={sourceMatch}
                        userById={userById}
                        canReview={false}
                        getEditableStatFields={getEditableSourceMatchStatFields}
                        editableScoreSides={sourceMatchResultEntryPermission?.editableScoreSides ?? []}
                        submitLabel={sourceMatchResultSubmitLabel}
                        onSave={(draft) => app.actions.submitMatchResult(sourceMatch.id, draft)}
                      />
                    ) : null}
                    {!sourceRoomReadOnly && canFinalizeSourceMatch ? (
                      <Button
                        type="button"
                        onClick={() => requestSourceMatchFinalization(
                          sourceMatch.id,
                          sourceOpenDisputes.length,
                          sourceFinalAuthorityLabel,
                        )}
                      >
                        기록완료
                      </Button>
                    ) : null}
                    {!sourceRoomReadOnly && sourceMatchAction.action === "agree" && sourceMatchSideName ? (
                      <Button type="button" disabled={Boolean(sourceMatchActionPending)} onClick={() => { void runSourceMatchAction("agree", () => app.actions.agreeMatch(sourceMatch.id, sourceMatchSideName, app.currentUser.id)); }}>
                        {sourceMatchActionPending === "agree" ? "처리 중" : sourceMatchAction.button}
                      </Button>
                    ) : null}
                    {!sourceRoomReadOnly && canRequestRefereeAbsence ? (
                      <Button type="button" variant="secondary" disabled={Boolean(sourceMatchActionPending)} onClick={() => { void runSourceMatchAction("absence-request", () => app.actions.requestMatchRefereeAbsence(sourceMatch.id)); }}>
                        {sourceMatchActionPending === "absence-request" ? "처리 중" : "심판 미출석"}
                      </Button>
                    ) : null}
                    {!sourceRoomReadOnly && canConfirmRefereeAbsence ? (
                      <Button type="button" variant="secondary" disabled={Boolean(sourceMatchActionPending)} onClick={() => { void runSourceMatchAction("absence-confirm", () => app.actions.confirmMatchRefereeAbsence(sourceMatch.id)); }}>
                        {sourceMatchActionPending === "absence-confirm" ? "처리 중" : "심판 미출석 인정"}
                      </Button>
                    ) : null}
                    {!sourceRoomReadOnly && canShowStartSourceMatch ? (
                      <Button type="button" disabled={!canStartSourceMatch || Boolean(sourceMatchActionPending)} title={sourceMatchStartButtonTitle} onClick={() => { void runSourceMatchAction("start", () => app.actions.startMatch(sourceMatch.id)); }}>
                        {sourceMatchActionPending === "start" ? "처리 중" : sourceMatchStartButtonLabel}
                      </Button>
                    ) : null}
                    {!sourceRoomReadOnly && canEndSourceMatch && !selectedMatchRules.gameClockEnabled ? (
                      <Button type="button" variant="secondary" disabled={Boolean(sourceMatchActionPending)} onClick={() => { void runSourceMatchAction("end", () => app.actions.endMatch(sourceMatch.id)); }}>
                        {sourceMatchActionPending === "end" ? "처리 중" : "경기 종료"}
                      </Button>
                    ) : null}
                    {!sourceRoomReadOnly && canCancelSourceMatch ? (
                      <Button
                        type="button"
                        variant="secondary"
                        className="danger-button"
                        disabled={!roomCancellationPolicy.allowed}
                        title={!roomCancellationPolicy.allowed ? "경기 시작 2시간 전부터는 취소할 수 없습니다." : ""}
                        onClick={requestSourceMatchCancellation}
                      >
                        {sourceMatchCancelActionLabel}
                      </Button>
                    ) : null}
                    {canDeleteSourceSoloRecord ? (
                      <Button type="button" variant="secondary" className="danger-button" onClick={() => deleteSourceSoloRecord(sourceMatch)}>
                        개인 기록 삭제
                      </Button>
                    ) : null}
                  </div>
                ) : recruitingRoomTerminalStatus ? (
                  <div className="arena-owner-panel">
                    <strong>{recruitingRoomTerminalStatus.label}</strong>
                    <span>{recruitingRoomTerminalStatus.detail}</span>
                    {cancellationReasonText ? (
                      <span className="arena-cancellation-reason"><b>취소 사유</b>{cancellationReasonText}</span>
                    ) : null}
                    {canRemakeRoom ? (
                      <Button type="button" variant="secondary" onClick={remakeRoom}>
                        <RotateCcw size={17} /> 같은 설정으로 다시 만들기
                      </Button>
                    ) : null}
                  </div>
                ) : mine ? (
                  <div className="arena-owner-panel">
                    <strong>방장 권한</strong>
                    <span>{roomQueueStatus.detail}</span>
                  </div>
                ) : currentUserIsRoomReferee ? (
                  <div className="arena-owner-panel">
                    <strong>심판 참여 중</strong>
                    <span>슬롯 없이 심판으로 배정된 상태입니다.</span>
                  </div>
                ) : alreadyApplied ? (
                  <div className="arena-owner-panel">
                    <strong>참여 중</strong>
                    <span>
                      {pickupPoolMode
                        ? "통합 참가자 풀에 등록됐습니다. 팀은 경기 시작 전 출석 확인 후 정합니다."
                        : individualOnlyRoom
                          ? "내 슬롯을 누르면 A/B 출전과 후보 위치를 변경할 수 있습니다."
                        : "내 슬롯을 누르면 위치 변경, 후보 이동, 파티 조작을 할 수 있습니다."}
                    </span>
                  </div>
                ) : selectedPost.visibility === "private" ? (
                  <div className="arena-owner-panel">
                    <strong>비공개방</strong>
                    <span>초대 수락으로만 참여할 수 있습니다.</span>
                  </div>
                ) : teamOnlyRoom && !teamRoomHasJoinableSide ? (
                  <div className="arena-owner-panel">
                    <strong>팀 참가 마감</strong>
                    <span>A/B사이드 팀이 모두 확정됐습니다.</span>
                  </div>
                ) : (
                  <form className="arena-join-form" onSubmit={(event) => { event.preventDefault(); void submitJoin(selectedPost); }}>
                    {sidePartyJoinOptions.length ? (
                      <div className="arena-party-quick-join-list">
                        {sidePartyJoinOptions.map((option) => (
                          <div className="arena-party-quick-join" key={getPartyOptionKey(option)}>
                            <div>
                              <span>{SIDE_LABELS[option.sideName]} 팀 파티</span>
                              <strong>{option.team.name}</strong>
                              <em>{getPartyOptionLabel(option)} 파티에 바로 합류</em>
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              disabled={Boolean(joiningPartyKey)}
                              onClick={() => { void joinSideParty(selectedPost, option); }}
                            >
                              <UsersRound size={17} />
                              {joiningPartyKey === `${selectedPost.id}:${getPartyOptionKey(option)}` ? "합류 중" : "합류"}
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : (
                    <>
                    <div className="segmented-control compact-segments">
                      {joinModeEntries.map(([mode, meta]) => (
                        <button
                          key={mode}
                          type="button"
                          className={joinDraft.joinMode === mode ? "active" : ""}
                          onClick={() => {
                            const teamId = mode === "team" ? getDefaultApplyTeamId(selectedPost, myTeams) : "";
                            const team = myTeams.find((item) => item.id === teamId) ?? null;
                            const rosterPatch = mode === "team"
                              ? getJoinRosterPatch(team)
                              : { playerIds: [], reservePlayerIds: [] };
                            updateJoinDraft(selectedPost, {
                              joinMode: mode,
                              teamId,
                              reserve: false,
                              ...rosterPatch,
                            });
                          }}
                        >
                          {meta.label}
                        </button>
                      ))}
                    </div>
                    {joinDraft.joinMode === "team" ? (
                      <>
                        <div className="arena-team-choice-field">
                          <span>참여 팀</span>
                          {myTeams.length ? (
                            <div className="arena-team-choice-grid">
                              {myTeams.map((team) => {
                                const eligibility = getJoinTeamEligibility(team);
                                return (
                                  <button
                                    key={team.id}
                                    type="button"
                                    className={[joinDraft.teamId === team.id ? "selected" : "", !eligibility.allowed ? "is-disabled" : ""].filter(Boolean).join(" ")}
                                    disabled={!eligibility.allowed}
                                    onClick={() => {
                                      updateJoinDraft(selectedPost, {
                                        teamId: team.id,
                                        ...getJoinRosterPatch(team),
                                      });
                                    }}
                                  >
                                    <strong>{team.name}</strong>
                                    <em>{eligibility.allowed ? `${team.mmr} MMR · 가능 ${eligibility.eligibleCount}/${eligibility.capacity}` : eligibility.reason}</em>
                                  </button>
                                );
                              })}
                            </div>
                          ) : (
                            <em>내 팀 없음</em>
                          )}
                        </div>
                        {teamOnlyRoom ? (
                          <div className="arena-mini-note">
                            <div>
                              <span>대표 1명 참가</span>
                              <strong>{app.currentUser.name}</strong>
                              <em>참가 후 방 안에서 사이드장이 출전·후보 명단을 확정합니다.</em>
                            </div>
                            <ShieldCheck size={18} />
                          </div>
                        ) : (
                          <TeamMemberPicker
                            team={selectedJoinTeam}
                            userById={userById}
                            selectedIds={selectedJoinPlayerIds}
                            reserveIds={selectedJoinReserveIds}
                            capacity={joinCapacity}
                            reserveCapacity={benchCapacity}
                            onRosterChange={({ selectedIds: playerIds, reserveIds: reservePlayerIds }) => updateJoinDraft(selectedPost, { playerIds, reservePlayerIds })}
                            requiredPlayerId={app.currentUser.id}
                            eligiblePlayerIds={selectedJoinTeamEligibility.eligiblePlayerIds}
                          />
                        )}
                      </>
                    ) : joinDraft.joinMode === "referee" ? (
                      <div className="arena-mini-note">
                        <div>
                          <span>심판 참여</span>
                          <strong>슬롯 사용 안 함</strong>
                          <em>경기 시작 이후 운영 권한</em>
                        </div>
                        <ShieldCheck size={18} />
                      </div>
                    ) : (
                      <label>
                        포지션
                        <select value={joinDraft.position} onChange={(event) => updateJoinDraft(selectedPost, { position: event.target.value })}>
                          {PLAYER_POSITIONS.map((position) => <option key={position}>{position}</option>)}
                        </select>
                      </label>
                    )}
                    {joinDraft.joinMode !== "referee" && !pickupPoolMode ? (
                    <div className="arena-field-grid arena-participation-fields">
                      <label>
                        진영
                        <select
                          value={joinDraft.side}
                          onChange={(event) => {
                            const side = event.target.value;
                            if (joinDraft.joinMode !== "team") {
                              updateJoinDraft(selectedPost, { side });
                              return;
                            }
                            updateJoinDraft(selectedPost, {
                              side,
                              ...getJoinRosterPatch(selectedJoinTeam, side, joinDraft.reserve),
                            });
                          }}
                        >
                          <option value="teamA" disabled={teamOnlyRoom && Boolean(getLobbyPrimaryTeamId(lobby, "teamA"))}>A사이드</option>
                          <option value="teamB" disabled={teamOnlyRoom && Boolean(getLobbyPrimaryTeamId(lobby, "teamB"))}>B사이드</option>
                        </select>
                      </label>
                      <label className="arena-participation-field">
                        참가 상태
                        <select
                          value={joinDraft.reserve ? "reserve" : "starter"}
                          onChange={(event) => {
                            const reserve = event.target.value === "reserve";
                            if (joinDraft.joinMode !== "team") {
                              updateJoinDraft(selectedPost, { reserve });
                              return;
                            }
                            updateJoinDraft(selectedPost, {
                              reserve,
                              ...getJoinRosterPatch(selectedJoinTeam, joinDraft.side, reserve),
                            });
                          }}
                        >
                          <option value="starter">출전</option>
                          <option value="reserve">후보</option>
                        </select>
                        <small>출전 인원이 부족하면 후보가 자동으로 출전됩니다.</small>
                      </label>
                    </div>
                    ) : pickupPoolMode ? (
                      <div className="arena-mini-note">
                        <div>
                          <span>통합 참가자 풀</span>
                          <strong>개인 참가</strong>
                          <em>팀은 경기 시작 전 출석 확인 후 정합니다.</em>
                        </div>
                        <UsersRound size={18} />
                      </div>
                    ) : null}
                    <div className="arena-mini-note">
                      <div>
                        <span>{joinDraft.joinMode === "team" ? `팀 파티 ${selectedJoinPlayerIds.length}+${selectedJoinReserveIds.length}` : joinDraft.joinMode === "referee" ? "심판 참여" : "개인 참여"}</span>
                        <strong>{joinDraft.joinMode === "referee" ? "심판 가능" : joinDraft.joinMode === "team" && !selectedJoinTeamEligibility.allowed ? "참가 불가" : fit.label}</strong>
                        <em>{joinDraft.joinMode === "referee" ? "슬롯 사용 안 함" : joinDraft.joinMode === "team" && !selectedJoinTeamEligibility.allowed ? selectedJoinTeamEligibility.reason : fit.range.label}</em>
                      </div>
                      {joinDraft.joinMode === "referee" ? <ShieldCheck size={18} /> : (
                        <TierBadge
                          mmr={candidateMmr || app.currentUser.ratings.integrated}
                          ratings={joinDraft.joinMode === "player" ? app.currentUser.ratings : null}
                          compact
                        />
                      )}
                    </div>
                    <Button type="submit" disabled={!canJoin || joiningThisRoom}>
                      {joinDraft.joinMode === "team" ? <UsersRound size={18} /> : joinDraft.joinMode === "referee" ? <ShieldCheck size={18} /> : <UserRound size={18} />}
                      {joiningThisRoom ? "참여 중" : "참여하기"}
                    </Button>
                    </>
                    )}
                  </form>
                )}

                {!sourceRoomReadOnly && !matchRoom && !recruitingRoomConfirmed && mine ? (
                  <Button
                    type="button"
                    variant="primary"
                    disabled={
                      !lobby.canConfirm
                      || !roomTimingStatus.canConfirm
                      || scheduleChangePending
                      || ruleAcknowledgementPending
                      || confirmingMatchId === selectedPost.id
                    }
                    title={scheduleChangePending
                      ? "일정 또는 구장 변경안을 전원이 승인해야 합니다."
                      : ruleAcknowledgementPending

                        ? "현재 참가자 전원이 최신 규칙을 확인해야 합니다."
                        : ""}
                    onClick={() => confirmQueueRoom(selectedPost)}
                  >
                    <Swords size={18} />
                    {confirmingMatchId === selectedPost.id ? "확정 중" : "경기 확정"}
                  </Button>
                ) : null}
                {!sourceRoomReadOnly && !matchRoom && alreadyApplied ? (
                  <Button
                    type="button"
                    variant="secondary"
                    className="danger-button"
                    onClick={() => app.actions.cancelRecruitingParticipation(selectedPost.id)}
                  >
                    <XCircle size={18} /> 참여 취소
                  </Button>
                ) : null}
                {!sourceRoomReadOnly && !matchRoom && mine ? (
                  <Button
                    type="button"
                    variant="secondary"
                    className="danger-button"
                    disabled={!roomCancellationPolicy.allowed}
                    title={!roomCancellationPolicy.allowed ? "경기 시작 2시간 전부터는 취소할 수 없습니다." : ""}
                    onClick={requestRecruitingCancellation}
                  >
                    {getRoomCancellationActionLabel("경기 취소", roomCancellationPolicy)}
                  </Button>
                ) : null}
              </div>
              <RecruitingRoomActionFeedback context={context} />
    </>
  );
}
