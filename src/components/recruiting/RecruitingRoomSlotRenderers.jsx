export function createRecruitingRoomSlotRenderers(context) {
  const {
    Button, InvitePanel, MATCH_SIDES, MAX_RESERVE_PLAYERS_PER_SIDE, MatchRecordParticipantSetupPanel, MatchRecordRosterPanel,
    PICKUP_TEAM_ASSIGNMENT_MODE_OPTIONS, PickupParticipantPool, PlayerRoomSlot, ROOM_BODY_MODES, SIDE_LABELS, SelfSlotCommandPanel,
    SlotCommandPanel, TeamMemberPicker, activeInviteDraft, activeSelfSlotDraft, app, benchCapacity,
    canInviteFromRoom, canInvitePlayerByRoom, canManageEntry, canManageMatchCheckin, canManageMatchRecordParticipants, canMovePlayerTo,
    canRequestPickupReroll, disabledInvitePlayerIds, favoritePlayerIds, favoriteTeamIds, getEntryMmr, getEntryPartyLeaderId,
    getEntryPlayerReserveState, getInviteAllowedTeamId, getPartyPlayerIds, getPartyReserveIds, getRecruitingSideCapacity, getRoomSlotBadge,
    getRoomSlotDisplayPosition, getSameSidePartyOptions, getTeamEventEligibility, individualOnlyRoom, inviteError, isPartyEntry,
    joinSideParty, lobby, mine, myEntry, myTeams, openInviteSlot,
    pickupAssignmentAttendanceReady, pickupAssignmentPolicy, pickupAssignmentSideCapacity, pickupAssignmentSidesComplete, pickupOpenSlotPlacements, pickupPoolMode,
    pickupRerollState, pickupRerollTrustReady, remoteDirectoryEnabled, roomOwnerId, roomPhaseViewModel, roomQueueStatus,
    roomState, selectedPost, sendInvites, setInviteDraft, setSlotActionDraft, showMatchRecordRosterPanel,
    slotPositions, sourceMatch, sourceMatchCheckedInIds, sourceMatchIsRecordRoom, sourceMatchIsTournamentPregame, sourceMatchPhase,
    sourceMatchRecordTeams, sourceMatchSideLeaderIds, sourceRoomReadOnly, teamById, teamMatchSideLocked, teamOnlyRoom,
    toggleInvitePlayer, updateInviteDraft, userById,
  } = context;

const roomPhaseBadge = sourceMatch ? sourceMatchPhase : roomQueueStatus;
        const referee = selectedPost.refereeId ? userById[selectedPost.refereeId] : null;
        const showCaptainBadge = !individualOnlyRoom && (selectedPost.visibility === "private" || Boolean(sourceMatch));
        const activeSlotDraft = activeInviteDraft?.slotKey ? activeInviteDraft : null;
        const currentUserReserve = getEntryPlayerReserveState(myEntry, app.currentUser.id);
        const currentUserInEntry = Boolean(myEntry && (
          myEntry.playerId === app.currentUser.id ||
          myEntry.players?.includes(app.currentUser.id) ||
          myEntry.reserves?.includes(app.currentUser.id)
        ));
        const currentUserInParty = Boolean(!individualOnlyRoom && currentUserInEntry && isPartyEntry(myEntry));
        const canMoveActiveUserToSlot = (sideName, reserve) => {
          if (!myEntry || !currentUserInEntry) return false;
          if (mine && sideName !== myEntry.side) return false;
          const samePlacement = myEntry.side === sideName && currentUserReserve === reserve;
          if (samePlacement) return false;
          if (teamMatchSideLocked && sideName !== myEntry.side) return false;
          if (!canMovePlayerTo(selectedPost, lobby, app.currentUser.id, sideName, reserve)) return false;
          if (myEntry.kind === "player" && myEntry.playerId === app.currentUser.id) return true;
          if (currentUserInParty && myEntry.side === sideName) return true;
          if (currentUserInParty) return true;
          return false;
        };
        const moveActiveUserToSlot = (sideName, reserve) => {
          if (!myEntry || !currentUserInEntry) return;
          if (sourceMatch) {
            app.actions.setMatchRoomPlayerPlacement(sourceMatch.id, app.currentUser.id, { side: sideName, reserve });
            setInviteDraft(null);
            setSlotActionDraft(null);
            return;
          }
          if (myEntry.kind === "player" && myEntry.playerId === app.currentUser.id) {
            app.actions.setRecruitingApplicantPlacement(selectedPost.id, app.currentUser.id, { side: sideName, reserve });
            setInviteDraft(null);
            setSlotActionDraft(null);
            return;
          }
          if (currentUserInParty && myEntry.side === sideName) {
            app.actions.setRecruitingPartyPlayerPlacement(selectedPost.id, myEntry.id, app.currentUser.id, { side: sideName, reserve });
            setInviteDraft(null);
            setSlotActionDraft(null);
            return;
          }
          if (currentUserInParty) {
            app.actions.detachRecruitingPartyPlayer(selectedPost.id, myEntry.id, app.currentUser.id, { side: sideName, reserve });
            setInviteDraft(null);
            setSlotActionDraft(null);
          }
        };
        const leaveCurrentParty = () => {
          if (!currentUserInParty || !myEntry) return;
          app.actions.detachRecruitingPartyPlayer(selectedPost.id, myEntry.id, app.currentUser.id, { side: myEntry.side, reserve: currentUserReserve });
          setSlotActionDraft(null);
        };
        const renderSlotCommand = () => {
          if (!activeSlotDraft) return null;
          const sideName = activeSlotDraft.sideName;
          const reserve = Boolean(activeSlotDraft.reserve);
          const canMoveHere = Boolean(
            !pickupPoolMode && canMoveActiveUserToSlot(sideName, reserve),
          );
          const targetPartyOptions = pickupPoolMode || individualOnlyRoom ? [] : getSameSidePartyOptions(lobby, myEntry, myTeams, sideName);
          return (
            <SlotCommandPanel
              sideName={sideName}
              reserve={reserve}
              floating
              anchor={activeSlotDraft.anchor}
              canMoveHere={canMoveHere}
              partyJoinOptions={targetPartyOptions}
              poolMode={pickupPoolMode}
              onMoveHere={() => moveActiveUserToSlot(sideName, reserve)}
              onJoinParty={(teamId, entryId) => { void joinSideParty(selectedPost, {
                team: teamById[teamId] ?? { id: teamId },
                sideName,
                entry: entryId ? { id: entryId } : null,
              }); }}
              onClose={() => setInviteDraft(null)}
            >
              <InvitePanel
                sideName={activeSlotDraft.sideName}
                reserve={Boolean(activeSlotDraft.reserve)}
                query={activeSlotDraft.query}
                onQueryChange={(query) => updateInviteDraft({ query })}
                users={app.state.users}
                teams={app.state.teams}
                userById={userById}
                disabledPlayerIds={disabledInvitePlayerIds}
                selectedPlayerIds={activeSlotDraft.selectedPlayerIds ?? []}
                favoritePlayerIds={favoritePlayerIds}
                favoriteTeamIds={favoriteTeamIds}
                allowedTeamId={getInviteAllowedTeamId(activeSlotDraft.sideName)}
                playerOnly={individualOnlyRoom}
                poolMode={pickupPoolMode}
                canInvitePlayer={canInvitePlayerByRoom}
                error={inviteError}
                onTogglePlayer={toggleInvitePlayer}
                onInvitePlayers={(playerIds, teamId, joinMode) => { void sendInvites(selectedPost, playerIds, teamId, joinMode); }}
                onClose={() => setInviteDraft(null)}
                remoteSearchEnabled={remoteDirectoryEnabled}
              />
            </SlotCommandPanel>
          );
        };
        const selfPlacementActions = [
          { side: "teamA", reserve: false, label: "A 출전" },
          { side: "teamB", reserve: false, label: "B 출전" },
          { side: "teamA", reserve: true, label: "A 후보" },
          { side: "teamB", reserve: true, label: "B 후보" },
        ];
        const renderSlotPlacementActions = (targetEntry, targetPlayerId) => {
          if (!targetEntry || !targetPlayerId) return null;
          const targetReserve = getEntryPlayerReserveState(targetEntry, targetPlayerId);
          const targetIsParty = !individualOnlyRoom && isPartyEntry(targetEntry);
          const targetIsCurrentUser = targetPlayerId === app.currentUser.id;
          const actions = targetIsParty
            ? [
                { side: targetEntry.side, reserve: false, label: `${SIDE_LABELS[targetEntry.side]} 출전` },
                { side: targetEntry.side, reserve: true, label: `${SIDE_LABELS[targetEntry.side]} 후보` },
              ]
            : selfPlacementActions;
          return (
            <div className="arena-self-placement-actions">
              {actions.map((action) => {
                const active = targetEntry.side === action.side && targetReserve === action.reserve;
                const movable = targetIsParty
                  ? !active
                  : targetIsCurrentUser && canMoveActiveUserToSlot(action.side, action.reserve);
                return (
                  <Button
                    key={`${action.side}-${action.reserve ? "reserve" : "active"}`}
                    type="button"
                    size="sm"
                    variant={active ? "primary" : "secondary"}
                    aria-pressed={active}
                    disabled={!active && !movable}
                    onClick={() => {
                      if (active) return;
                      if (targetIsParty) {
                        if (sourceMatch) {
                          app.actions.setMatchRoomPlayerPlacement(sourceMatch.id, targetPlayerId, { side: targetEntry.side, reserve: action.reserve });
                        } else {
                          app.actions.setRecruitingPartyPlayerPlacement(selectedPost.id, targetEntry.id, targetPlayerId, { side: targetEntry.side, reserve: action.reserve });
                        }
                        setSlotActionDraft(null);
                        return;
                      }
                      moveActiveUserToSlot(action.side, action.reserve);
                    }}
                  >
                    {action.label}
                  </Button>
                );
              })}
            </div>
          );
        };
        const renderSelfSlotCommand = () => {
          if (!activeSelfSlotDraft) return null;
          if (sourceMatch && !canManageMatchCheckin) return null;
          const targetEntry = lobby.entries.find((entry) => entry.id === activeSelfSlotDraft.entryId);
          const targetPlayerId = activeSelfSlotDraft.playerId;
          const targetUser = userById[targetPlayerId];
          const targetIsCurrentUser = targetPlayerId === app.currentUser.id;
          if (!targetEntry || !targetUser) return null;
          const canManageTarget = targetIsCurrentUser || canManageEntry(targetEntry);
          if (!canManageTarget) return null;
          const sourceTeam = targetIsCurrentUser && myEntry?.sourceTeamId ? teamById[myEntry.sourceTeamId] : null;
          const targetPartyOptions = targetIsCurrentUser && !sourceMatch && !individualOnlyRoom ? getSameSidePartyOptions(lobby, myEntry, myTeams, activeSelfSlotDraft.sideName) : [];
          const currentSlotPosition = getRoomSlotDisplayPosition(targetUser, slotPositions, targetPlayerId, targetEntry);
          const canManageTeamRoster = !sourceMatch && !individualOnlyRoom && targetEntry.kind === "team" && targetEntry.team && getEntryPartyLeaderId(targetEntry) === app.currentUser.id;

          const teamRosterCapacity = getRecruitingSideCapacity(selectedPost);
          const teamRosterActiveIds = canManageTeamRoster
            ? getPartyPlayerIds(targetEntry.team, targetEntry.players ?? [], teamRosterCapacity, app.currentUser.id)
            : [];
          const teamRosterReserveIds = canManageTeamRoster
            ? getPartyReserveIds(targetEntry.team, roomState.partyReserves?.[targetEntry.id] ?? [], teamRosterActiveIds, benchCapacity)
            : [];
          return (
            <SelfSlotCommandPanel
              entry={targetEntry}
              sideName={activeSelfSlotDraft.sideName}
              reserve={Boolean(activeSelfSlotDraft.reserve)}
              sourceTeam={sourceTeam}
              anchor={activeSelfSlotDraft.anchor}
              heading={targetIsCurrentUser ? "내 슬롯 관리" : "파티원 관리"}
              canLeaveParty={targetIsCurrentUser && !sourceMatch && currentUserInParty && !teamOnlyRoom}
              partyJoinOptions={targetPartyOptions}
              currentPosition={currentSlotPosition}
              onPositionChange={targetIsCurrentUser && !sourceMatch ? (position) => app.actions.setRecruitingSlotPosition(selectedPost.id, targetPlayerId, position) : null}
              onLeaveParty={leaveCurrentParty}
              onJoinParty={(teamId, entryId) => {
                void joinSideParty(selectedPost, {
                  team: teamById[teamId] ?? { id: teamId },
                  sideName: activeSelfSlotDraft.sideName,
                  entry: entryId ? { id: entryId } : null,
                });
                setSlotActionDraft(null);
              }}
              onClose={() => setSlotActionDraft(null)}
            >
              {renderSlotPlacementActions(targetEntry, targetPlayerId)}
              {canManageTeamRoster ? (
                <TeamMemberPicker
                  team={targetEntry.team}
                  userById={userById}
                  selectedIds={teamRosterActiveIds}
                  reserveIds={teamRosterReserveIds}
                  capacity={teamRosterCapacity}
                  reserveCapacity={benchCapacity}
                  requiredPlayerId={app.currentUser.id}
                  requiredActive
                  deferCommit
                  onRosterChange={({ selectedIds, reserveIds }) => app.actions.setRecruitingTeamPartyRoster(selectedPost.id, targetEntry.id, {
                    teamId: targetEntry.team.id,
                    playerIds: selectedIds,
                    reservePlayerIds: reserveIds,
                  })}
                />
              ) : null}
            </SelfSlotCommandPanel>
          );
        };
        const renderMatchRecordSetupPanels = () => (
          <>
            {!sourceRoomReadOnly && showMatchRecordRosterPanel ? (
              <div className="arena-record-roster-panels ui-modal-section">
                {MATCH_SIDES.map((sideName) => (
                  <MatchRecordRosterPanel
                    key={sideName}
                    match={sourceMatch}
                    sideName={sideName}
                    team={sourceMatchRecordTeams[sideName]}
                    userById={userById}
                    teams={app.state.teams}
                    currentUserId={app.currentUser.id}
                    sideLeaderId={sourceMatchSideLeaderIds[sideName]}
                    capacity={getRecruitingSideCapacity(sourceMatch)}
                    tournamentRoster={sourceMatchIsTournamentPregame}
                    reserveCapacity={sourceMatchIsRecordRoom ? MAX_RESERVE_PLAYERS_PER_SIDE : benchCapacity}
                    eligiblePlayerIds={sourceMatchIsTournamentPregame ? getTeamEventEligibility(sourceMatchRecordTeams[sideName], app.state.users, {
                      capacity: getRecruitingSideCapacity(sourceMatch),
                      ranked: sourceMatch.ranked,
                      mmrLimitMode: sourceMatch.rules?.mmrLimitMode ?? sourceMatch.mmrLimitMode,
                      mmrRangeMode: sourceMatch.rules?.mmrRangeMode,
                      targetMmr: sourceMatchRecordTeams[sideName]?.mmr,
                      allowedAgeGroups: sourceMatch.rules?.allowedAgeGroups,
                    }).eligiblePlayerIds : null}
                    onChange={(targetSideName, roster) => app.actions.setMatchRecordTeamRoster(sourceMatch.id, targetSideName, roster)}
                  />
                ))}
              </div>
            ) : null}
            {!sourceRoomReadOnly && canManageMatchRecordParticipants ? (
              <MatchRecordParticipantSetupPanel
                match={sourceMatch}
                users={app.state.users}
                teams={app.state.teams}
                currentUserId={app.currentUser.id}
                onSave={(setup) => app.actions.setMatchRecordParticipants(sourceMatch.id, setup)}
              />
            ) : null}
          </>
        );
        const renderPickupParticipantPool = () => (
          <PickupParticipantPool
            lobby={lobby}
            capacity={(getRecruitingSideCapacity(selectedPost) + benchCapacity) * 2}
            assignmentMode={roomPhaseViewModel.mode === ROOM_BODY_MODES.pickupAssignment}
            participantIds={roomPhaseViewModel.mode === ROOM_BODY_MODES.pickupAssignment ? sourceMatchCheckedInIds : null}
            renderParticipant={({ playerId, entry }) => {
              const user = userById[playerId];
              const position = getRoomSlotDisplayPosition(user, slotPositions, playerId, entry);
              return (
                <PlayerRoomSlot
                  user={user}
                  teams={app.state.teams}
                  status={roomPhaseViewModel.mode === ROOM_BODY_MODES.pickupAssignment ? "ready" : entry?.status}
                  title={roomPhaseViewModel.mode === ROOM_BODY_MODES.pickupAssignment ? "출석" : entry?.status === "ready" ? "참가" : "대기"}
                  mmr={user?.ratings?.integrated ?? getEntryMmr(entry)}
                  position={position}
                  badge={getRoomSlotBadge(playerId, entry, roomOwnerId, false, roomState, { showPartyBadge: false })}
                />
              );
            }}
            renderEmptySlot={({ index }) => {
              const canInvite = !sourceRoomReadOnly && canInviteFromRoom;
              const placement = pickupOpenSlotPlacements[index] ?? { side: "teamA", reserve: false };
              return (
                <div className="arena-room-player-slot-wrap">
                  <PlayerRoomSlot
                    empty
                    invite={canInvite}
                    title="빈 슬롯"
                    detail={canInvite ? "초대" : ""}
                    onInvite={(event) => openInviteSlot(selectedPost, placement.side, placement.reserve, `pickup-${index}`, event)}
                  />
                </div>
              );
            }}
          />
        );
        const renderPickupRotation = () => roomPhaseViewModel.rotation ? (
          <section className="ui-panel ui-modal-section pickup-rotation-panel">
            <div className="ui-status-strip">
              <span>팀 나누기</span>
              <strong>{pickupAssignmentPolicy.label}</strong>
            </div>
            <small>{pickupAssignmentPolicy.description}</small>
            <div className="ui-status-strip">
              <span>균등 교대</span>
              <strong>{roomPhaseViewModel.rotation.label}</strong>
            </div>
            {roomPhaseViewModel.mode === ROOM_BODY_MODES.pickupAssignment && !pickupAssignmentPolicy.decided && canManageMatchCheckin ? (
              <div className="arena-room-edit-actions">
                {PICKUP_TEAM_ASSIGNMENT_MODE_OPTIONS.map((option) => (
                  <Button
                    key={option.id}
                    type="button"
                    variant={option.id === "manual" ? "secondary" : "primary"}
                    disabled={!pickupAssignmentAttendanceReady}
                    title={pickupAssignmentAttendanceReady
                      ? option.description
                      : `출석자가 최소 ${pickupAssignmentSideCapacity * 2}명 필요합니다.`}
                    onClick={() => app.actions.generatePickupSideAssignment(sourceMatch.id, option.id)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            ) : null}
            {roomPhaseViewModel.mode === ROOM_BODY_MODES.pickupAssignment && !pickupAssignmentPolicy.decided && !canManageMatchCheckin ? (
              <small>방장 또는 배정 심판이 출석자 기준 팀 배치 방식을 선택합니다.</small>
            ) : null}
            {roomPhaseViewModel.mode === ROOM_BODY_MODES.pickupAssignment && pickupAssignmentPolicy.decided ? (
              <div className="arena-room-edit-actions">
                {canRequestPickupReroll ? (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={pickupRerollState.remaining <= 0 || pickupRerollState.usedByCurrentUser || !pickupRerollTrustReady}
                    title={pickupRerollState.remaining <= 0
                      ? "재배정 기회를 모두 사용했습니다."
                      : pickupRerollState.usedByCurrentUser
                        ? "한 사람은 한 번만 재배정을 요청할 수 있습니다."
                        : !pickupRerollTrustReady
                          ? "재배정에는 신뢰도 1점이 필요합니다."
                          : "신뢰도 1점을 사용하며 방 채팅에 기록됩니다."}
                    onClick={() => app.actions.generatePickupSideAssignment(sourceMatch.id, pickupAssignmentPolicy.mode)}
                  >
                    재배정 {pickupRerollState.count}/{pickupRerollState.limit}
                  </Button>
                ) : null}
                {canManageMatchCheckin ? (
                  <Button
                    type="button"
                    disabled={!pickupAssignmentSidesComplete}
                    title={!pickupAssignmentSidesComplete
                      ? "A/B 출전 정원을 먼저 채워 주세요."
                      : "A/B사이드와 대기 선수 배정을 확정합니다."}
                    onClick={() => app.actions.confirmPickupSideAssignment(sourceMatch.id, {
                      rotationMode: roomPhaseViewModel.rotation.rotationMode,
                      rotationIntervalMinutes: roomPhaseViewModel.rotation.rotationIntervalMinutes,
                    })}
                  >배정 확정</Button>
                ) : null}
              </div>
            ) : null}
            {pickupAssignmentPolicy.decided && sourceMatch?.ranked !== false ? (
              <small>MMR 반영 여부와 결과는 확정된 배치와 서버 정책에 따라 결정됩니다.</small>
            ) : null}
          </section>
        ) : null;

  return {
    roomPhaseBadge, referee, showCaptainBadge, activeSlotDraft, currentUserReserve, currentUserInEntry,
    currentUserInParty, canMoveActiveUserToSlot, moveActiveUserToSlot, leaveCurrentParty, renderSlotCommand, selfPlacementActions,
    renderSlotPlacementActions, renderSelfSlotCommand, renderMatchRecordSetupPanels, renderPickupParticipantPool, renderPickupRotation,
  };
}
