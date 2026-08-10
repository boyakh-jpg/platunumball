import { getRecruitingRoomRosterProps } from "./RecruitingRoomRosterProps.js";

function RecruitingRoomVersusSide({ context, sideName, meta }) {
  const {
    Crown,
    SideRoster,
    app,
    autoBalancedIndividualRoom,
    benchCapacity,
    canInviteSideFromRoom,
    canManageEntry,
    lobby,
    mine,
    moveCandidate,
    openInviteSlot,
    openSelfSlotAction,
    renderRoomReserveLine,
    roomOwnerId,
    roomPhaseViewModel,
    roomState,
    selectedPost,
    showCaptainBadge,
    slotPositions,
    sourceMatch,
    sourceMatchSideLeaderIds,
    sourceMatchSlotManagementOpen,
    sourceRoomReadOnly,
    teamOnlyRoom,
    tournamentRoomOwnerName,
    userById,
  } = context;
  const pendingSideLeaderInvitation = !sourceMatch && selectedPost.visibility === "private"
    ? (roomState.invitations ?? []).find((invitation) => (
        invitation.status === "pending"
        && invitation.role !== "referee"
        && invitation.joinMode === "team"
        && invitation.side === sideName
      ))
    : null;
  const pendingSideLeader = pendingSideLeaderInvitation
    ? {
        playerId: pendingSideLeaderInvitation.targetUserId,
        user: userById[pendingSideLeaderInvitation.targetUserId],
        teamName: app.state.teams.find((team) => team.id === pendingSideLeaderInvitation.teamId)?.name ?? "",
      }
    : null;

  return (
    <div className={`arena-lobby-team-panel ${sideName === "teamA" ? "team-a" : "team-b"}`}>
      <div className="arena-lobby-team-head">
        <div className="arena-lobby-team-meta">
          <span>{meta.label}</span>
          {selectedPost.tournamentId && selectedPost.hostSide === sideName ? (
            <small className="arena-lobby-host-team">
              <Crown size={11} strokeWidth={3} />
              방장{tournamentRoomOwnerName ? ` ${tournamentRoomOwnerName}` : ""}
            </small>
          ) : null}
        </div>
        <strong>{meta.name}</strong>
        <em>{autoBalancedIndividualRoom ? `평균 ${meta.mmr || "-"} MMR · 폭 ${meta.spread}` : `${meta.mmr || "-"} MMR`}</em>
      </div>
      <SideRoster
        sideName={sideName}
        side={lobby.sides[sideName]}
        pendingLeader={pendingSideLeader}
        {...getRecruitingRoomRosterProps(context, sideName)}
        onSetPlacement={(playerId, placement) => app.actions.setRecruitingApplicantPlacement(selectedPost.id, playerId, placement)}
        onSetMemberReserve={(entryId, playerId, reserve) => app.actions.setRecruitingPartyPlayerReserve(selectedPost.id, entryId, playerId, reserve)}
        onDetachMember={(entryId, playerId) => app.actions.detachRecruitingPartyPlayer(selectedPost.id, entryId, playerId)}
      />
      {roomPhaseViewModel.showSideReserves && benchCapacity > 0 ? (
        <div className="arena-side-inline-reserve">
          {renderRoomReserveLine(sideName)}
        </div>
      ) : null}
    </div>
  );
}

export function RecruitingRoomPrimarySection({ context }) {
  const {
    Badge, Button, CircleHelp, CourtHoverCard, Crown,
    InvitationPanel, InvitePanel, MapPin, MatchAttendanceQrPanel, ROOM_BODY_MODES, RoomKickPanel,
    RoomPhaseRenderer, SearchPicker, Share2, SideRoster,
    TeamEmblem, X, acceptRoomInvitation, activeInviteDraft, alreadyApplied,
    app, attendanceScanState, autoBalancedIndividualRoom, benchCapacity, canInspectMatchAttendance, canInvitePlayerByRoom, canInviteSideFromRoom,
    canManageEntry, canManageMatchCheckin, canMoveMatchSides, closeModal, contextPanel,
    courtByName, disabledInvitePlayerIds, entryPoint, favoritePlayerIds, favoriteTeamIds, getInviteAllowedTeamId,
    getRecruitingSideCapacity, getRoomRefereeLabel, getRoomScheduleLabel,
    getRoomTeamSelectionEligibility, getTeamCaptainId, getTeamHashtag, individualOnlyRoom, invitations, inviteError,
    lobby, matchRoom, mine, moveCandidate, openInviteSlot, openSelfSlotAction,
    pickupAssignmentPolicy, pickupPoolMode, referee, remoteDirectoryEnabled, renderMatchRecordSetupPanels,
    renderMatchSubstitutionPanel, renderPickupParticipantPool, renderPickupRotation, renderRoomReserveLine, renderRoomTeamResult, renderSelfSlotCommand,
    renderSlotCommand, renderSourceMatchRecordBoard, requiresPaidCourtNotice, roomCompetitionLabel, roomDisplayTitle, roomMatchTypeLabel,
    roomOwnerId, roomPhaseBadge, roomPhaseSectionsAfterVersus, roomPhaseSectionsBeforeVersus, roomPhaseViewModel, roomReadyLabel,
    roomShareEnabled, roomShareStatus, roomState, roomTeamACandidates, roomTeamBCandidates, roomTeamFeedback,
    roomTeamQuery, roomTeamSavingSide, roomTeamSelectionOpen, roomTitleSizeClass, roomVisibilityLabel, roomVisibilityTone,
    saveRoomTeam, selectedMatchRules, selectedPost, selectedRoomTeamAId,
    selectedRoomTeamBId, sendInvites, setAttendanceStartStatus, setInviteDraft, setRoomTeamQuery, setSlotActionDraft,
    shareRoom, showCaptainBadge, slotPositions, sourceMatch, sourceMatchAttendance, sourceMatchCheckedInIds,
    setRoomHelpOpen, sideMmrBalance, sourceMatchPlacementByPlayerId, sourceMatchSideLeaderIds, sourceMatchSlotManagementOpen, sourceRoomReadOnly, teamAMeta,
    teamBMeta, teamOnlyRoom, toggleInvitePlayer, tournamentRoomOwnerName, updateInviteDraft, userById,
  } = context;

  return (
    <>
<div
                className="arena-lobby-arena"
                style={{ "--room-side-slot-count": Math.max(1, getRecruitingSideCapacity(selectedPost)) }}
              >
                <div className="arena-lobby-topline">
                  <div className="badge-row">
                    <Badge tone={roomPhaseBadge?.tone ?? "neutral"}>{roomPhaseBadge?.label ?? "대기방"}</Badge>
                    <Badge tone="neutral">{selectedPost.mode}</Badge>
                    <Badge tone={roomVisibilityTone}>{roomVisibilityLabel}</Badge>
                    <Badge tone="neutral">{roomMatchTypeLabel}</Badge>
                    <Badge tone={selectedPost.ranked === false ? "neutral" : "gold"}>{roomCompetitionLabel}</Badge>
                    <Badge tone={referee ? "blue" : "neutral"}>{getRoomRefereeLabel(selectedPost)}</Badge>
                    {requiresPaidCourtNotice(selectedPost) ? <Badge tone="orange">유료 구장</Badge> : null}
                  </div>
                  <div className="arena-room-share-actions" aria-label={roomShareEnabled ? "방 공유" : "방 작업"}>
                    <Button type="button" size="sm" variant="secondary" onClick={() => setRoomHelpOpen(true)}>
                      <CircleHelp size={15} /> 진행 도움말
                    </Button>
                    {roomShareEnabled ? (
                      <Button type="button" size="sm" variant="secondary" onClick={shareRoom}>
                        <Share2 size={15} /> 공유하기
                      </Button>
                    ) : null}
                    <Button type="button" size="sm" variant="secondary" onClick={() => { setInviteDraft(null); setSlotActionDraft(null); closeModal(); }}>
                      <X size={15} /> 방 닫기
                    </Button>
                    {roomShareStatus ? <span className="arena-room-share-message">{roomShareStatus}</span> : null}
                  </div>
                </div>

                <div className="arena-lobby-title">
                  <h2 className={roomTitleSizeClass}>{roomDisplayTitle}</h2>
                  <p><MapPin size={16} /><CourtHoverCard court={courtByName[selectedPost.court]} courtId={selectedPost.courtId} courtName={selectedPost.court}>{selectedPost.court}</CourtHoverCard> · {getRoomScheduleLabel(selectedPost)}</p>
                </div>

                {contextPanel}

                {attendanceScanState ? (
                  <div className="ui-status-strip" role="status" aria-live="polite">
                    <Badge tone={attendanceScanState.tone}>{attendanceScanState.pending ? "출석 처리 중" : "출석 처리 결과"}</Badge>
                    <strong>{attendanceScanState.message}</strong>
                  </div>
                ) : null}

                <RoomPhaseRenderer
                  viewModel={{ ...roomPhaseViewModel, sectionOrder: roomPhaseSectionsBeforeVersus }}
                  sections={{
                    recordBoard: renderSourceMatchRecordBoard,
                    recordSetup: renderMatchRecordSetupPanels,
                    participantPool: renderPickupParticipantPool,
                    rotation: renderPickupRotation,
                  }}
                />

                {roomTeamSelectionOpen ? (
                  <section className="arena-record-setup-panel ui-modal-section">
                    <header>
                      <strong>팀 선택</strong>
                    </header>
                    <div className="arena-record-setup-grid">
                      {!selectedRoomTeamAId ? <section>
                        <strong>A사이드</strong>
                        {mine ? (
                          roomTeamACandidates.length ? (
                            <div className="arena-team-choice-grid">
                              {roomTeamACandidates.map((team) => {
                                const eligibility = getRoomTeamSelectionEligibility(team, "teamA");
                                return (
                                  <button
                                    key={team.id}
                                    type="button"
                                    className={!eligibility.allowed ? "is-disabled" : ""}
                                    disabled={!eligibility.allowed || Boolean(roomTeamSavingSide)}
                                    onClick={() => { void saveRoomTeam("teamA", team); }}
                                  >
                                    <TeamEmblem team={team} size="xs" />
                                    <strong>{team.name}</strong>
                                    <em>{eligibility.allowed ? "A팀 선택" : eligibility.reason}</em>
                                  </button>
                                );
                              })}
                            </div>
                          ) : <em>현재 소속된 팀이 없습니다.</em>
                        ) : <em>방장이 A팀을 선택하는 중입니다.</em>}
                      </section> : null}
                      {selectedPost.visibility === "private" && selectedRoomTeamAId && !selectedRoomTeamBId ? <section>
                        <strong>B사이드</strong>
                        {mine ? (
                          <SearchPicker
                            value={roomTeamQuery}
                            onChange={setRoomTeamQuery}
                            placeholder="B팀 이름, #해시태그 검색"
                            items={roomTeamBCandidates}
                            getSearchText={(team) => `${team.name} ${getTeamHashtag(team)} ${team.region ?? ""}`}
                            remoteSearchType={remoteDirectoryEnabled ? "team" : ""}
                            mapRemoteItem={(team) => team?.id !== selectedRoomTeamAId && getTeamCaptainId(team) ? team : null}
                            idleItems={roomTeamBCandidates.slice(0, 8)}
                            title="B팀 선택"
                            emptyText="선택 가능한 팀 없음"
                            showIdleOnFocus

                            floating
                            closeOnResultClick
                            renderItem={renderRoomTeamResult}
                          />
                        ) : <em>방장이 B팀을 선택하고 있습니다.</em>}
                      </section> : null}
                    </div>
                    {roomTeamFeedback ? (
                      <div className="ui-status-strip" role="status" aria-live="polite">
                        <strong>{roomTeamFeedback}</strong>
                      </div>
                    ) : null}
                  </section>
                ) : null}

                {entryPoint === "recorder" ? renderMatchSubstitutionPanel() : null}

                {roomPhaseViewModel.showVersusStage ? <div className="arena-lobby-versus-stage">
                  <RecruitingRoomVersusSide context={context} sideName="teamA" meta={teamAMeta} />

                  <div className="arena-lobby-score-core">
                    <strong>{lobby.sides.teamA.filled}/{lobby.sides.teamA.capacity}</strong>
                    <i>VS</i>
                    <strong>{lobby.sides.teamB.filled}/{lobby.sides.teamB.capacity}</strong>
                    <span>{roomReadyLabel}</span>
                    {autoBalancedIndividualRoom ? (
                      <small className={sideMmrBalance.allowed ? "" : "is-over"}>평균 차 {sideMmrBalance.averageGap} · 허용 {sideMmrBalance.limit}</small>
                    ) : null}
                  </div>

                  <RecruitingRoomVersusSide context={context} sideName="teamB" meta={teamBMeta} />
                </div> : null}

                <RoomPhaseRenderer
                  viewModel={{ ...roomPhaseViewModel, sectionOrder: roomPhaseSectionsAfterVersus }}
                  sections={{
                    recordBoard: renderSourceMatchRecordBoard,
                    recordSetup: renderMatchRecordSetupPanels,
                    participantPool: renderPickupParticipantPool,
                    rotation: renderPickupRotation,
                  }}
                />

                {roomPhaseViewModel.showSideReserves && benchCapacity > 0 ? <div className="arena-reserve-panel">
                  {renderRoomReserveLine("teamA")}
                  {renderRoomReserveLine("teamB")}
                </div> : null}

              </div>
              {renderSlotCommand()}
              {renderSelfSlotCommand()}

              {activeInviteDraft && !activeInviteDraft.slotKey ? (
                <InvitePanel
                  sideName={activeInviteDraft.sideName}
                  reserve={Boolean(activeInviteDraft.reserve)}
                  query={activeInviteDraft.query}
                  onQueryChange={(query, patch = {}) => updateInviteDraft({ query, ...patch })}
                  users={app.state.users}
                  teams={app.state.teams}
                  userById={userById}
                  disabledPlayerIds={disabledInvitePlayerIds}
                  selectedPlayerIds={activeInviteDraft.selectedPlayerIds ?? []}
                  favoritePlayerIds={favoritePlayerIds}
                  favoriteTeamIds={favoriteTeamIds}
                  selectedTeam={activeInviteDraft.selectedTeam ?? null}
                  allowedTeamId={getInviteAllowedTeamId(activeInviteDraft.sideName)}
                  playerOnly={individualOnlyRoom}
                  poolMode={roomPhaseViewModel.mode === ROOM_BODY_MODES.pickupPool}
                  canInvitePlayer={canInvitePlayerByRoom}
                  error={inviteError}
                  onTogglePlayer={toggleInvitePlayer}
                  onInvitePlayers={(playerIds, teamId, joinMode) => sendInvites(selectedPost, playerIds, teamId, joinMode)}
                  onClose={() => setInviteDraft(null)}
                  remoteSearchEnabled={remoteDirectoryEnabled}
                />
              ) : null}

              {!sourceRoomReadOnly ? (
                <InvitationPanel
                  invitations={invitations}
                  userById={userById}
                  teams={app.state.teams}
                  currentUserId={app.currentUser.id}
                  alreadyApplied={alreadyApplied}
                  poolMode={pickupPoolMode}
                  error={inviteError}
                  onAccept={(invitation) => acceptRoomInvitation(selectedPost, invitation)}
                  onDecline={(invitationId) => app.actions.declineRecruitingInvitation(selectedPost.id, invitationId)}
                />
              ) : null}

              {!sourceRoomReadOnly && ((!matchRoom && mine) || (matchRoom && canManageMatchCheckin)) ? (
                <RoomKickPanel
                  lobby={lobby}
                  userById={userById}
                  teams={app.state.teams}
                  onKickApplicant={(playerId, reason) => (
                    matchRoom ? app.actions.removeMatchRoomPlayer(sourceMatch.id, playerId, reason) : app.actions.kickRecruitingApplicant(selectedPost.id, playerId, reason)
                  )}
                  onRemovePartyPlayer={(entryId, playerId, reason) => (
                    matchRoom ? app.actions.removeMatchRoomPlayer(sourceMatch.id, playerId, reason) : app.actions.removeRecruitingPartyPlayer(selectedPost.id, entryId, playerId, reason)
                  )}
                  onCheckInPlayer={matchRoom ? ((sideName, playerId) => app.actions.checkInMatchPlayer(sourceMatch.id, sideName, playerId)) : null}
                  onSetReserve={!matchRoom && autoBalancedIndividualRoom
                    ? ((entry, playerId, reserve) => app.actions.setRecruitingApplicantPlacement(selectedPost.id, playerId, { side: entry.side, reserve }))
                    : matchRoom && (
                    roomPhaseViewModel.mode !== ROOM_BODY_MODES.pickupAssignment
                    || pickupAssignmentPolicy.mode === "manual"
                  )
                    ? ((entry, playerId, reserve) => app.actions.setMatchRoomPlayerPlacement(sourceMatch.id, playerId, { side: entry.side, reserve }))
                    : null}
                  onSetPlacement={!matchRoom && autoBalancedIndividualRoom
                    ? ((playerId, placement) => app.actions.setRecruitingApplicantPlacement(selectedPost.id, playerId, placement))
                    : matchRoom && (
                    roomPhaseViewModel.mode !== ROOM_BODY_MODES.pickupAssignment
                    || pickupAssignmentPolicy.mode === "manual"
                  )
                    ? ((playerId, placement) => app.actions.setMatchRoomPlayerPlacement(sourceMatch.id, playerId, placement))
                    : null}
                  onSwapPlacement={matchRoom
                    && roomPhaseViewModel.mode === ROOM_BODY_MODES.pickupAssignment
                    && pickupAssignmentPolicy.automatic
                    ? ((firstPlayerId, secondPlayerId) => app.actions.swapPickupMatchPlayers(sourceMatch.id, firstPlayerId, secondPlayerId))
                    : null}
                  allowSideMove={autoBalancedIndividualRoom && !matchRoom || canMoveMatchSides && (
                    roomPhaseViewModel.mode !== ROOM_BODY_MODES.pickupAssignment
                    || pickupAssignmentPolicy.mode === "manual"
                  )}
                  canSetPlacement={!matchRoom && autoBalancedIndividualRoom
                    ? ((playerId, placement) => context.canMovePlayerTo(selectedPost, lobby, playerId, placement.side, placement.reserve, userById))
                    : null}
                  hostPlayerId={roomPhaseViewModel.mode === ROOM_BODY_MODES.pickupAssignment ? "" : roomOwnerId}
                  attendanceBySide={matchRoom ? sourceMatchAttendance : null}
                  requireMissingAttendance={canManageMatchCheckin}
                  currentUserId={app.currentUser.id}
                  poolMode={pickupPoolMode}
                  placementByPlayerId={sourceMatchPlacementByPlayerId}
                  placementPlayerIds={roomPhaseViewModel.mode === ROOM_BODY_MODES.pickupAssignment ? sourceMatchCheckedInIds : null}
                  onRefresh={matchRoom ? (() => app.actions.loadMatchDetail?.(sourceMatch.id)) : null}
                />
              ) : null}

              {!sourceRoomReadOnly
                && matchRoom
                && canInspectMatchAttendance
                && selectedMatchRules.qrAttendanceEnabled ? (
                  <MatchAttendanceQrPanel
                    match={sourceMatch}
                    onChanged={() => app.actions.loadMatchDetail?.(sourceMatch.id)}
                    onStatusChange={setAttendanceStartStatus}
                  />
                ) : null}

              {entryPoint === "recorder" ? null : renderMatchSubstitutionPanel()}
    </>
  );
}
