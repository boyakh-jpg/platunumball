export function RecruitingRoomManagementSection({ context }) {
  const {
    Badge, Button, MATCH_MODES, MAX_RESERVE_PLAYERS_PER_SIDE, MMR_RANGE_POLICIES, MatchOperationsPolicyFields,
    MatchClockPanel, MatchScoreControls, MeetingPointFields, ProfileEmblem, RefereeHoverCard, RefereeInvitePanel, RoomChat,
    RuleSelector, app, canEndSourceMatch, canInviteRefereeFromRoom, canJoinReferee, canOperateSourceRoomRules,
    canUseChat, chatCooldownUntilByPost, chatErrorByPost, chatMessages, chatSendingPostId, clockClient,
    closeRoomEdit, currentRuleRevision, currentUserCanRespondSchedule, currentUserNeedsRuleAcknowledgement, disabledRefereeIds, favoriteRefereeIds,
    getChatDraft, getCourtLayoutLabel, getCourtSurfaceLabel, getMeetingPointSummary, getRefereeInviteQuery, handleChatVisibleChange,
    matchRoom, maxSideFilled, maxSideReserveFilled, mine, openRoomEdit, pendingRefereeInvitations,
    pickupAssignmentPolicy, pickupResize, pickupRoom, referee, refereeInviteCandidates, remoteDirectoryEnabled,
    roomChatLocked, roomEditAvailability, roomEditAvailable, roomEditBenchCapacityValid, roomEditCapacityValid, roomEditCourt,
    roomEditCourtOptions, roomEditCourtWarning, roomEditDraft, roomEditMeetingValid, roomEditPickupCapacityValid, roomEditRange,
    roomEditRulesValid, roomEditScheduleValid, roomEditStatus, roomPhaseViewModel, ruleAcknowledgedIds, ruleAcknowledgementPending,
    ruleAcknowledgementRequiredIds, saveRoomEdit, scheduleChangePending, scheduleProposalProgress, selectedMatchRuleRows, selectedMatchRules,
    selectedPost, selectedRange, selectedRoomOperationRows, selectedRoomPolicyRows, selectedRoomPolicySource, showRefereeInviteSlot,
    sourceMatch, sourceMatchDraftScore, sourceMatchIsRecordRoom, sourceMatchPhase, sourceMatchResultEntryPermission, sourceRoomReadOnly, submitChat,
    updateChatDraft, updateRefereeInviteQuery, updateRoomEditDraft, userById,
  } = context;

  return (
    <>
{scheduleChangePending && scheduleProposalProgress.proposal ? (
                <section className="ui-panel ui-modal-section">
                  <div className="ui-status-strip">
                    <span>일정 변경 승인</span>
                    <strong>{scheduleProposalProgress.approvedIds.length}/{scheduleProposalProgress.requiredIds.length}</strong>
                  </div>
                  <p>
                    {[scheduleProposalProgress.proposal.scheduledDate, scheduleProposalProgress.proposal.scheduledTime]
                      .filter(Boolean).join(" ") || "즉시"}
                    {" · "}
                    {scheduleProposalProgress.proposal.court || "구장 미정"}
                  </p>
                  <small>경기 6시간 전까지 전원이 승인해야 합니다. 그 전까지 기존 일정과 구장이 유지되며 새 참가·초대 수락은 잠시 중단됩니다.</small>
                  {currentUserCanRespondSchedule ? (
                    <div className="arena-room-edit-actions">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => (sourceMatch
                          ? app.actions.respondMatchScheduleProposal(sourceMatch.id, scheduleProposalProgress.proposal.id, "reject")
                          : app.actions.respondRecruitingScheduleProposal(selectedPost.id, scheduleProposalProgress.proposal.id, "reject"))}
                      >
                        반려
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => (sourceMatch
                          ? app.actions.respondMatchScheduleProposal(sourceMatch.id, scheduleProposalProgress.proposal.id, "approve")
                          : app.actions.respondRecruitingScheduleProposal(selectedPost.id, scheduleProposalProgress.proposal.id, "approve"))}
                      >
                        승인
                      </Button>
                    </div>
                  ) : null}
                </section>
              ) : null}

              {ruleAcknowledgementPending ? (
                <section className="ui-panel ui-modal-section">
                  <div className="ui-status-strip">
                    <span>변경 내용 확인</span>
                    <strong>{ruleAcknowledgedIds.length}/{ruleAcknowledgementRequiredIds.length}</strong>
                  </div>
                  <small>현재 참가자 전원이 최신 규칙을 확인해야 매치 확정 또는 경기 시작이 가능합니다.</small>
                  {currentUserNeedsRuleAcknowledgement ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => (sourceMatch
                        ? app.actions.acknowledgeMatchRoomRules(sourceMatch.id, currentRuleRevision)
                        : app.actions.acknowledgeRecruitingRoomRules(selectedPost.id, currentRuleRevision))}
                    >
                      변경 내용 확인
                    </Button>
                  ) : null}
                </section>
              ) : null}

              {roomPhaseViewModel.showRules ? <div className="arena-room-rule-panel">
                <div className="arena-room-rule-head">
                  <strong>규칙</strong>
                  {canOperateSourceRoomRules ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={!roomEditAvailable}
                      title={roomEditAvailability.reason === "limit"
                        ? "방 수정은 한 번만 가능합니다."
                        : roomEditAvailability.reason
                          ? "방 수정은 경기 시작 12시간 전까지만 가능합니다."
                          : ""}
                      onClick={() => (roomEditDraft ? closeRoomEdit(selectedPost) : openRoomEdit(selectedPost))}
                    >
                      {roomEditAvailability.reason === "limit"
                        ? "수정 1회 사용 완료"
                        : !roomEditAvailable
                          ? "수정 가능 시간 종료"
                          : roomEditDraft ? "수정 닫기" : "방 수정"}
                    </Button>
                  ) : null}
                </div>
                <div className="arena-room-rule-summary">
                  {selectedRoomPolicyRows.map((row) => (
                    <Badge key={row.label} tone="neutral" className="arena-room-rule-badge">{row.value}</Badge>
                  ))}
                  <Badge tone="neutral" className="arena-room-rule-badge">
                    {getMeetingPointSummary(selectedMatchRules, selectedRoomPolicySource.timingType, selectedRoomPolicySource.mode)}
                  </Badge>
                  <Badge tone="neutral" className="arena-room-rule-badge">
                    {selectedPost.ranked !== false ? selectedRange.label : "친선 · 티어 자유"}
                  </Badge>
                  {selectedRoomOperationRows.map((row) => (
                    <Badge key={row.label} tone="neutral" className="arena-room-rule-badge">{row.label} · {row.value}</Badge>
                  ))}
                </div>
                <dl className="arena-room-rule-detail-grid">
                  {selectedMatchRuleRows.map((row) => (
                    <div key={row.label}>
                      <dt>{row.label}</dt>
                      <dd>{row.value}</dd>
                    </div>
                  ))}
                </dl>
                <div className="arena-room-rule-summary detail">
                  <Badge tone="neutral" className="arena-room-rule-badge">공격권: {selectedMatchRules.attackRule}</Badge>
                  <Badge tone="neutral" className="arena-room-rule-badge">파울: {selectedMatchRules.foulRule}</Badge>
                </div>
                <div className="arena-room-referee-line ui-control-surface">
                  <strong>심판</strong>
                  {referee ? (
                    <RefereeHoverCard user={referee} matches={app.state.matches} minTrust={selectedPost.refereeTrustMin} className="arena-room-referee-card">

                      <ProfileEmblem user={referee} className="small" />
                      <span>{referee.name}</span>
                    </RefereeHoverCard>
                  ) : (
                    <span>없음</span>
                  )}
                </div>
                {!sourceRoomReadOnly && showRefereeInviteSlot ? (
                  <RefereeInvitePanel
                    query={getRefereeInviteQuery(selectedPost)}
                    onQueryChange={(query) => updateRefereeInviteQuery(selectedPost, query)}
                    candidates={refereeInviteCandidates}
                    favoriteRefereeIds={favoriteRefereeIds}
                    pendingInvitations={pendingRefereeInvitations}
                    userById={userById}
                    matches={app.state.matches}
                    minTrust={selectedPost.refereeTrustMin}
                    canInvite={canInviteRefereeFromRoom}
                    canJoin={canJoinReferee && !mine && !matchRoom}
                    disabledRefereeIds={[...disabledRefereeIds]}
                    onInviteReferee={(refereeId) => app.actions.inviteRecruitingReferee(selectedPost.id, refereeId)}
                    onJoin={() => app.actions.interestRecruitingPost(selectedPost.id, { joinMode: "referee" })}
                    remoteSearchEnabled={remoteDirectoryEnabled}
                  />
                ) : null}
                {selectedPost.stakes ? (
                  <div className="arena-details-memo">
                    <strong>약속/벌칙</strong>
                    <span>{selectedPost.stakes}</span>
                  </div>
                ) : null}
                {selectedPost.memo ? (
                  <div className="arena-details-memo">
                    <strong>경기 메모</strong>
                    <span>{selectedPost.memo}</span>
                  </div>
                ) : null}
                {!sourceRoomReadOnly && roomEditDraft ? (
                  <div className="arena-room-edit-panel">
                    <div className="arena-field-grid three">
                      <label>
                        팀당 정원
                        <select value={roomEditDraft.sideCapacity} onChange={(event) => updateRoomEditDraft(selectedPost, { sideCapacity: Number(event.target.value) })}>
                          {MATCH_MODES.map(({ id, size }) => <option key={id} value={size}>{size} vs {size}</option>)}
                        </select>
                      </label>
                      <label>
                        {pickupRoom ? "추가 참가 인원" : "후보 정원"}
                        <select value={roomEditDraft.benchCapacity} onChange={(event) => updateRoomEditDraft(selectedPost, { benchCapacity: Number(event.target.value) })}>
                          {Array.from({ length: MAX_RESERVE_PLAYERS_PER_SIDE + 1 }, (_, value) => (
                            <option key={value} value={value}>{value === 0 ? "없음" : `${value}명`}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        구장
                        <select
                          value={roomEditDraft.courtId || roomEditDraft.court}
                          onChange={(event) => {
                            const court = roomEditCourtOptions.find((item) => (
                              (item.id || item.name) === event.target.value
                            ));
                            if (court) updateRoomEditDraft(selectedPost, { courtId: court.id ?? "", court: court.name });
                          }}
                        >
                          {roomEditCourtOptions.map((court) => (
                            <option key={court.id || court.name} value={court.id || court.name}>
                              {court.name} / {getCourtSurfaceLabel(court)} / {getCourtLayoutLabel(court)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        일정 방식
                        <select
                          value={roomEditDraft.timingType}
                          onChange={(event) => updateRoomEditDraft(selectedPost, { timingType: event.target.value })}
                        >
                          <option value="scheduled">날짜·시간 지정</option>
                          <option value="instant">즉시 경기</option>
                        </select>
                      </label>
                      {roomEditDraft.timingType !== "instant" ? (
                        <>
                          <label>
                            경기 날짜
                            <input
                              type="date"
                              value={roomEditDraft.scheduledDate}
                              onChange={(event) => updateRoomEditDraft(selectedPost, { scheduledDate: event.target.value })}
                            />
                          </label>
                          <label>
                            경기 시간
                            <input
                              type="time"
                              value={roomEditDraft.scheduledTime}
                              onChange={(event) => updateRoomEditDraft(selectedPost, { scheduledTime: event.target.value })}
                            />
                          </label>
                        </>
                      ) : null}
                      {matchRoom && sourceMatchPhase?.phase === "checkin" ? (
                        <label>
                          매치 방식
                          <select value={roomEditDraft.matchJoinMode ?? selectedPost.hostJoinMode ?? "player"} onChange={(event) => updateRoomEditDraft(selectedPost, { matchJoinMode: event.target.value })}>
                            <option value="team">팀전 유지</option>
                            <option value="player">개인전 전환</option>
                          </select>
                        </label>
                      ) : null}
                    </div>
                    <RuleSelector
                      draft={{ ...roomEditDraft, mode: selectedPost.mode }}
                      onChange={(patch) => updateRoomEditDraft(selectedPost, patch)}
                    />
                    <MatchOperationsPolicyFields
                      draft={{
                        ...roomEditDraft,
                        mode: `${roomEditDraft.sideCapacity}v${roomEditDraft.sideCapacity}`,
                      }}
                      onChange={(patch) => updateRoomEditDraft(selectedPost, patch)}
                    />
                    <MeetingPointFields
                      draft={roomEditDraft}
                      onChange={(patch) => updateRoomEditDraft(selectedPost, patch)}
                      required
                      timingType={selectedPost.timingType}
                    />
                    {selectedPost.ranked !== false ? (
                      <label>
                        정규전 허용구간
                        <select value={roomEditDraft.mmrRangeMode} onChange={(event) => updateRoomEditDraft(selectedPost, { mmrRangeMode: event.target.value })}>
                          {Object.entries(MMR_RANGE_POLICIES).map(([mode, policy]) => <option key={mode} value={mode}>{policy.label}</option>)}
                        </select>
                      </label>
                    ) : null}
                    {roomEditRange ? <small>{roomEditRange.detail}</small> : null}
                    {roomEditCourt ? (
                      <small className={roomEditCourtWarning ? "room-edit-warning" : ""}>
                        {getCourtSurfaceLabel(roomEditCourt)} / {getCourtLayoutLabel(roomEditCourt)}
                        {roomEditCourtWarning ? ` · ${roomEditCourtWarning}` : " · 선택한 방식과 구장 형태가 충돌하지 않습니다."}
                      </small>
                    ) : null}
                    <div className="arena-field-grid">
                      <label>
                        공격권 룰
                        <input value={roomEditDraft.attackRule} onChange={(event) => updateRoomEditDraft(selectedPost, { attackRule: event.target.value })} />
                      </label>
                      <label>
                        파울 룰
                        <input value={roomEditDraft.foulRule} onChange={(event) => updateRoomEditDraft(selectedPost, { foulRule: event.target.value })} />
                      </label>
                    </div>
                    <label>
                      약속/벌칙
                      <textarea value={roomEditDraft.stakes} onChange={(event) => updateRoomEditDraft(selectedPost, { stakes: event.target.value })} />
                    </label>
                    <label>
                      경기 메모
                      <textarea value={roomEditDraft.memo} onChange={(event) => updateRoomEditDraft(selectedPost, { memo: event.target.value })} />
                    </label>
                    {pickupRoom ? (
                      <small>현재 참가 {pickupResize.participantCount}명 · 변경 후 전체 정원 {pickupResize.participantCapacity}명</small>
                    ) : null}
                    {!roomEditCapacityValid ? <span className="form-warning">현재 출전 인원이 {maxSideFilled}명이라 정원을 그보다 낮출 수 없습니다.</span> : null}
                    {!roomEditBenchCapacityValid ? <span className="form-warning">현재 후보 인원이 {maxSideReserveFilled}명이라 후보 정원을 그보다 낮출 수 없습니다.</span> : null}
                    {!roomEditPickupCapacityValid ? <span className="form-warning">현재 참가자가 {pickupResize.participantCount}명이므로 전체 참가 정원을 {pickupResize.participantCapacity}명으로 줄일 수 없습니다.</span> : null}
                    {!roomEditMeetingValid ? <span className="form-warning">실제로 만날 출입구·층·코트 번호를 2자 이상 적어 주세요.</span> : null}
                    {!roomEditScheduleValid ? <span className="form-warning">변경할 경기 날짜와 시간을 모두 선택해 주세요.</span> : null}
                    {roomEditStatus.error ? <span className="form-warning" role="alert">{roomEditStatus.error}</span> : null}
                    <div className="arena-room-edit-actions">
                      <Button type="button" size="sm" variant="secondary" disabled={roomEditStatus.pending} onClick={() => closeRoomEdit(selectedPost)}>취소</Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={roomEditStatus.pending || !roomEditCapacityValid || !roomEditBenchCapacityValid || !roomEditPickupCapacityValid || !roomEditMeetingValid || !roomEditRulesValid || !roomEditScheduleValid}
                        onClick={() => void saveRoomEdit(selectedPost)}
                      >
                        {roomEditStatus.pending ? "저장 중" : "수정 저장"}
                      </Button>
                    </div>
                    <small>
                      참가자가 있으면 규칙 변경은 각 참가자의 확인이 필요합니다. 일정·구장 변경은 전원이 승인할 때까지 기존 일정이 유지됩니다.
                    </small>
                  </div>
                ) : null}
                {pickupRoom ? (
                  <>
                    <span>{sourceMatch?.ranked === false || selectedPost.ranked === false
                      ? "친선 경기로 MMR을 반영하지 않습니다."
                      : "경쟁 경기로 확정 배치 결과를 서버에서 검증해 MMR 반영 여부를 결정합니다."}</span>
                    <span>{pickupAssignmentPolicy.description} 최종 배치는 방장 또는 배정 심판이 확정합니다.</span>
                  </>
                ) : null}
              </div> : null}

              <RoomChat
                messages={chatMessages}
                userById={userById}
                teams={app.state.teams}
                currentUserId={app.currentUser.id}
                value={getChatDraft(selectedPost)}
                canChat={canUseChat}
                readOnly={sourceRoomReadOnly}
                locked={roomChatLocked}
                sending={chatSendingPostId === selectedPost.id}
                cooldown={Number(chatCooldownUntilByPost[selectedPost.id] ?? 0) > Date.now()}
                error={chatErrorByPost[selectedPost.id] ?? ""}
                onChange={(value) => updateChatDraft(selectedPost, value)}
                onSubmit={(event) => submitChat(event, selectedPost)}
                onVisibleChange={handleChatVisibleChange}
              />

              {matchRoom && sourceMatchPhase?.phase === "live" && !sourceMatchIsRecordRoom && selectedMatchRules.gameClockEnabled ? (
                <MatchClockPanel
                  match={sourceMatch}
                  onMatchEnded={() => void app.actions.loadMatchDetail(sourceMatch.id)}
                  canEndMatch={canEndSourceMatch}
                  onEndMatch={() => app.actions.endMatch(sourceMatch.id)}
                  clockClient={clockClient}
                  onRosterChanged={() => void app.actions.loadMatchDetail(sourceMatch.id)}
                  editableScoreSides={sourceMatch.refereeId ? [] : sourceMatchResultEntryPermission?.editableScoreSides ?? []}
                  displayScoreA={sourceMatch.refereeId ? sourceMatchDraftScore?.scoreA : null}
                  displayScoreB={sourceMatch.refereeId ? sourceMatchDraftScore?.scoreB : null}
                  onIncrementScore={(sideName, delta, revisions) => app.actions.incrementMatchScore?.(
                    sourceMatch.id,
                    sideName === "teamA" ? delta : 0,
                    sideName === "teamB" ? delta : 0,
                    revisions,
                  )}
                />
              ) : null}
              {matchRoom && sourceMatch && sourceMatchResultEntryPermission?.editableScoreSides?.length && (
                (
                  sourceMatchPhase?.phase === "live"
                  && !sourceMatchIsRecordRoom
                  && !selectedMatchRules.gameClockEnabled
                  && !sourceMatch.refereeId
                )
                || (
                  sourceMatch.endedAt
                  && sourceMatch.status !== "disputed"
                  && sourceMatchIsRecordRoom
                )
              ) ? (
                <MatchScoreControls
                  match={sourceMatch}
                  label={sourceMatchIsRecordRoom ? "사후 기록 팀 점수" : sourceMatch.endedAt ? "최종 팀 점수" : "실시간 팀 점수"}
                  editableScoreSides={sourceMatchResultEntryPermission.editableScoreSides}
                  onIncrementScore={sourceMatchIsRecordRoom ? null : (sideName, delta, revisions) => app.actions.incrementMatchScore?.(
                      sourceMatch.id,
                      sideName === "teamA" ? delta : 0,
                      sideName === "teamB" ? delta : 0,
                      revisions,
                    )}
                  onSubmitScore={sourceMatchIsRecordRoom
                    ? (result) => app.actions.submitMatchResult(sourceMatch.id, result)
                    : null}
                />
              ) : null}
    </>
  );
}
