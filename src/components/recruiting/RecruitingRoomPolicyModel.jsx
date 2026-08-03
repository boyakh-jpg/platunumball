export function buildRecruitingRoomPolicyModel(context) {
  const {
    DEFAULT_RATING, MATCH_SIDES, RECRUITING_JOIN_MODES, ROOM_BODY_MODES, app, getCourtPlayWarning,
    getDefaultJoinRoster, getJoinActiveCapacity, getJoinDraft, getJoinableSidePartyOptions, getLobbyPrimaryTeamId, getLobbySideMeta,
    getMatchCreationSummary, getMatchRuleDetailRows, getMatchRuleInputValidation, getPartyPlayerIds, getPartyReserveIds, getPickupOpenSlotPlacements,
    getPickupResizeValidation, getPickupTeamAssignmentPolicy, getPlayerMmrAverage, getPublicRoomTimingStatus, getRecruitingBenchCapacity, getRecruitingFit,
    getRecruitingLobby, getRecruitingRoomOwnerId, getRecruitingRuleAcknowledgement, getRecruitingSideCapacity, getRecruitingTargetMmr, getRecruitingTierRange,
    getRoomEditDraftByPost, getRoomPhaseViewModel, getRoomScheduleProposalProgress, getSameSidePartyOptions, getSourceMatchAction, getSourceMatchDecisionSideName,
    getSourceMatchStatus, getTeamCaptainId, getTeamEventEligibility, getTeamHashtag, inviteDraft, isCurrentUserRoomParticipant,
    isEligibleReferee, isIndividualOnlyRecruitingRoom, isPartyEntry, isPickupRecruitingRoom, isRoomScheduleChangePending, isSupabaseConfigured,
    isTeamOnlyRoom, joiningPostId, myTeams, normalizeMatchRules, registeredCourts, roomEditStatusByPost,
    roomTeamSavingSide, selectedPost, setRoomTeamFeedback, setRoomTeamQuery, setRoomTeamSavingSide, slotActionDraft,
    sourceMatch, teamById, userById,
  } = context;

const lobby = getRecruitingLobby(selectedPost, app.state);
        const roomPhaseViewModel = getRoomPhaseViewModel({ post: selectedPost, match: sourceMatch });
        const pickupPoolMode = roomPhaseViewModel.mode === ROOM_BODY_MODES.pickupPool;
        const joinDraft = getJoinDraft(selectedPost);
        const individualOnlyRoom = isIndividualOnlyRecruitingRoom(selectedPost);
        const teamOnlyRoom = isTeamOnlyRoom(selectedPost) && !individualOnlyRoom;
        const selectedRoomTeamAId = getLobbyPrimaryTeamId(lobby, "teamA") ?? selectedPost.teamId ?? "";
        const selectedRoomTeamBId = getLobbyPrimaryTeamId(lobby, "teamB") ?? selectedPost.opponentTeamId ?? selectedPost.targetTeamId ?? "";
        const selectedRoomTeamA = teamById[selectedRoomTeamAId] ?? null;
        const selectedRoomTeamB = teamById[selectedRoomTeamBId] ?? null;
        const roomTargetMmr = getRecruitingTargetMmr(selectedPost, app.state);
        const getJoinTeamEligibility = (team) => getTeamEventEligibility(team, app.state.users, {
          capacity: getRecruitingSideCapacity(selectedPost),
          ranked: selectedPost.ranked,
          mmrLimitMode: selectedPost.mmrLimitMode ?? selectedPost.roomState?.mmrLimitMode,
          mmrRangeMode: selectedPost.mmrRangeMode ?? selectedPost.roomState?.mmrRangeMode,
          targetMmr: roomTargetMmr,
          allowedAgeGroups: selectedPost.allowedAgeGroups ?? selectedPost.rules?.allowedAgeGroups,
          requireCaptainEligible: false,
        });
        const selectedJoinTeam = myTeams.find((team) => team.id === joinDraft.teamId) ?? myTeams[0] ?? null;
        const selectedJoinTeamEligibility = getJoinTeamEligibility(selectedJoinTeam);
        const selectedJoinSideTeamId = getLobbyPrimaryTeamId(lobby, joinDraft.side);
        const selectedJoinSideAvailable = !teamOnlyRoom || !selectedJoinSideTeamId;
        const teamRoomHasJoinableSide = !teamOnlyRoom || MATCH_SIDES.some((sideName) => !getLobbyPrimaryTeamId(lobby, sideName));
        const joinCapacity = getJoinActiveCapacity(selectedPost, lobby, joinDraft.side, joinDraft.reserve);
        const selectedJoinPlayerIds = teamOnlyRoom
          ? (app.currentUser.id ? [app.currentUser.id] : [])
          : getPartyPlayerIds(selectedJoinTeam, joinDraft.playerIds, joinCapacity, app.currentUser.id);
        const benchCapacity = getRecruitingBenchCapacity(sourceMatch ?? selectedPost);
        const pickupOpenSlotPlacements = isPickupRecruitingRoom(selectedPost)
          ? getPickupOpenSlotPlacements(lobby, {
              sideCapacity: getRecruitingSideCapacity(selectedPost),
              benchCapacity,
            })
          : [];
        const selectedJoinReserveIds = joinDraft.reserve
          ? []
          : getPartyReserveIds(selectedJoinTeam, joinDraft.reservePlayerIds, selectedJoinPlayerIds, benchCapacity);
        const candidateMmr = joinDraft.joinMode === "team" && !individualOnlyRoom
          ? getPlayerMmrAverage(selectedJoinPlayerIds, userById, selectedJoinTeam?.mmr ?? app.currentUser.ratings.integrated)
          : app.currentUser.ratings.integrated;
        const fit = getRecruitingFit(selectedPost, candidateMmr || app.currentUser.ratings.integrated, app.state);
        const matchRoom = Boolean(sourceMatch);
        const recruitingRoomConfirmed = Boolean(selectedPost.status === "closed" || selectedPost.confirmedAt);
        const storedRoomPost = app.state.recruitingPosts?.find((item) => item.id === selectedPost.id) ?? null;
        const slotPositions = selectedPost.roomState?.slotPositions ?? {};
        const roomOwnerId = getRecruitingRoomOwnerId(selectedPost);
        const mine = roomOwnerId === app.currentUser.id;
        const myEntry = lobby.entries.find((entry) => (
          entry.players?.includes(app.currentUser.id) ||
          entry.reserves?.includes(app.currentUser.id)
        ));
        const alreadyApplied = Boolean(myEntry && !mine);
        const currentUserIsRoomReferee = selectedPost.refereeId === app.currentUser.id;
        const changeApprovalSource = sourceMatch ?? selectedPost;
        const scheduleProposalProgress = getRoomScheduleProposalProgress(changeApprovalSource);
        const scheduleChangePending = isRoomScheduleChangePending(changeApprovalSource);
        const canInviteFromRoom = !scheduleChangePending && !matchRoom && !recruitingRoomConfirmed && isCurrentUserRoomParticipant(selectedPost, lobby, app.currentUser.id);
        const canChat = Boolean(storedRoomPost) && isCurrentUserRoomParticipant(selectedPost, lobby, app.currentUser.id);
        const selectedRoomState = selectedPost.roomState ?? {};
        const refereeWanted = Boolean(selectedPost.refereeWanted || selectedRoomState.refereeWanted || selectedPost.refereeId);
        const getJoinRosterPatch = (team, sideName = joinDraft.side, reserve = joinDraft.reserve) => (
          getDefaultJoinRoster(selectedPost, lobby, team, app.currentUser, sideName, reserve)
        );
        const teamJoinValid = !individualOnlyRoom && (joinDraft.joinMode !== "team" || (
          Boolean(selectedJoinTeam) &&
          selectedJoinSideAvailable &&
          selectedJoinTeamEligibility.allowed &&
          selectedJoinPlayerIds.includes(app.currentUser.id) &&
          [...selectedJoinPlayerIds, ...selectedJoinReserveIds].every((playerId) => selectedJoinTeamEligibility.eligiblePlayerIds.includes(playerId)) &&
          selectedJoinPlayerIds.length > 0
        ));
        const canJoinReferee = selectedPost.visibility === "public" && refereeWanted && !selectedPost.refereeId && isEligibleReferee(app.currentUser, selectedPost.refereeTrustMin, app.state.settings?.refereeAppointments);
        const joinMmrLimitMode = selectedPost.mmrLimitMode ?? selectedPost.roomState?.mmrLimitMode ?? "block";
        const joinTierAllowed = joinMmrLimitMode !== "block" || fit.allowed;
        const canJoin = !scheduleChangePending
          && selectedPost.visibility === "public"
          && !matchRoom
          && !recruitingRoomConfirmed
          && !mine
          && !alreadyApplied
          && (!teamOnlyRoom || Boolean(selectedRoomTeamAId))
          && (
          joinDraft.joinMode === "referee"
            ? canJoinReferee
            : joinTierAllowed && (!pickupPoolMode || pickupOpenSlotPlacements.length > 0) && (joinDraft.joinMode === "player" || teamJoinValid)
        );
        const roomTeamSelectionOpen = teamOnlyRoom
          && !sourceMatch
          && selectedPost.status === "open"
          && !recruitingRoomConfirmed
          && (!selectedRoomTeamAId || !selectedRoomTeamBId);
        const getRoomTeamSelectionEligibility = (team, sideName) => {
          const eligibility = getTeamEventEligibility(team, app.state.users, {
            capacity: getRecruitingSideCapacity(selectedPost),
            ranked: selectedPost.ranked,
            mmrLimitMode: selectedPost.mmrLimitMode ?? selectedPost.roomState?.mmrLimitMode,
            mmrRangeMode: selectedPost.mmrRangeMode ?? selectedPost.roomState?.mmrRangeMode,
            targetMmr: sideName === "teamA" ? team?.mmr : selectedRoomTeamA?.mmr,
            allowedAgeGroups: selectedPost.allowedAgeGroups ?? selectedPost.rules?.allowedAgeGroups,
            requireCaptainEligible: sideName !== "teamA",
          });
          if (
            sideName === "teamA"
            && eligibility.allowed
            && !eligibility.eligiblePlayerIds.includes(app.currentUser.id)
          ) {
            return {
              ...eligibility,
              allowed: false,
              reason: "방장이 현재 경기의 연령·MMR 조건을 충족하지 않습니다.",
            };
          }
          return eligibility;
        };
        const roomTeamACandidates = myTeams;
        const roomTeamBCandidates = app.state.teams.filter((team) => (
          team.id !== selectedRoomTeamAId && Boolean(getTeamCaptainId(team))
        ));
        const saveRoomTeam = async (sideName, team) => {
          if (!roomTeamSelectionOpen || !mine || !team?.id || roomTeamSavingSide) return;
          const eligibility = getRoomTeamSelectionEligibility(team, sideName);
          if (!eligibility.allowed) {
            setRoomTeamFeedback(`${team.name}: ${eligibility.reason}`);
            return;
          }
          setRoomTeamSavingSide(sideName);
          setRoomTeamFeedback("");
          try {
            const result = await app.actions.setRecruitingRoomTeam?.(selectedPost.id, sideName, team.id);
            if (result === false || result?.ok === false) {
              setRoomTeamFeedback("팀을 선택하지 못했습니다. 소속·팀 조건·방 상태를 확인해 주세요.");
              return;
            }
            setRoomTeamQuery("");
            setRoomTeamFeedback(sideName === "teamA"
              ? "A팀을 선택했습니다."
              : "B팀 현재 주장에게 초대 1건을 보냈습니다.");
          } catch {
            setRoomTeamFeedback("팀을 선택하지 못했습니다. 잠시 후 다시 시도해 주세요.");
          } finally {
            setRoomTeamSavingSide("");
          }
        };
        const renderRoomTeamResult = (team) => {
          const eligibility = getRoomTeamSelectionEligibility(team, "teamB");
          return (
            <div key={team.id} className="search-picker-result-row search-picker-result-row-actionable">
              <button
                type="button"
                className="search-picker-result-main"
                disabled={!eligibility.allowed || Boolean(roomTeamSavingSide)}
                onClick={() => { void saveRoomTeam("teamB", team); }}
              >
                <strong>{team.name}</strong>
                <span>{getTeamHashtag(team)} · {team.region ?? "지역 미정"} · {team.mmr} MMR</span>
                <em>{eligibility.allowed ? "B팀 선택" : eligibility.reason}</em>
              </button>
            </div>
          );
        };
        const joiningThisRoom = joiningPostId === selectedPost.id;
        const joinModeEntries = [
          ...Object.entries(RECRUITING_JOIN_MODES).filter(([mode]) => {
            if (mode === "team" && individualOnlyRoom) return false;
            return !teamOnlyRoom || mode === "team";
          }),
    ...(canJoinReferee ? [["referee", { label: "심판" }]] : []),
        ];
        const selectedRange = getRecruitingTierRange(
          getRecruitingTargetMmr(selectedPost, app.state),
          selectedPost.ranked !== false,
          selectedPost.mmrRangeMode ?? selectedPost.roomState?.mmrRangeMode,
        );
        const roomEditDraft = getRoomEditDraftByPost(selectedPost);
        const roomEditStatus = roomEditStatusByPost[selectedPost.id] ?? { pending: false, error: "" };
        const roomEditCurrentCourt = registeredCourts.find((court) => (
          court.id === (roomEditDraft?.courtId || selectedPost.courtId)
          || court.name === (roomEditDraft?.court || selectedPost.court)
        )) ?? {
          id: roomEditDraft?.courtId || selectedPost.courtId || "",
          name: roomEditDraft?.court || selectedPost.court || "현재 구장",
          region: selectedPost.region ?? "",
        };
        const roomEditCourtOptions = roomEditDraft
          ? [
              roomEditCurrentCourt,
              ...registeredCourts.filter((court) => (
                (court.id || court.name) !== (roomEditCurrentCourt.id || roomEditCurrentCourt.name)
              )),
            ]
          : registeredCourts;
        const roomEditRange = roomEditDraft
          ? getRecruitingTierRange(getRecruitingTargetMmr(selectedPost, app.state), selectedPost.ranked !== false, roomEditDraft.mmrRangeMode)
          : null;
        const roomEditCourt = roomEditDraft
          ? roomEditCourtOptions.find((court) => (
              court.id === roomEditDraft.courtId || court.name === roomEditDraft.court
            )) ?? null
          : null;
        const roomEditCourtWarning = roomEditDraft && roomEditCourt ? getCourtPlayWarning(roomEditCourt, `${roomEditDraft.sideCapacity}v${roomEditDraft.sideCapacity}`) : "";
        const selectedRoomPolicySource = sourceMatch
          ? {
              ...selectedPost,
              ...sourceMatch,
              mode: sourceMatch.mode ?? selectedPost.mode,
              rules: sourceMatch.rules ?? selectedPost.rules,
            }
          : selectedPost;
        const selectedMatchRules = normalizeMatchRules(selectedRoomPolicySource.rules, { mode: selectedRoomPolicySource.mode });
        const selectedMatchRuleRows = getMatchRuleDetailRows(selectedMatchRules, selectedRoomPolicySource.mode);
        const selectedCreationSummary = getMatchCreationSummary(selectedRoomPolicySource);
        const selectedRoomPolicyRows = selectedCreationSummary.rows.filter((row) => (
          row.label === "경기 목적" || row.label === "팀 구성" || row.label === "명단" || row.label === "팀 배치" || row.label === "운영 정책" || row.label === "출전 정책"
        ));
        const selectedRoomOperationRows = selectedCreationSummary.rows.filter((row) => (
          row.label === "공 준비" || row.label === "조끼"
        ));
        const pickupRoom = isPickupRecruitingRoom(selectedPost);
        const pickupAssignmentPolicy = getPickupTeamAssignmentPolicy(sourceMatch ?? selectedPost);
        const recruitingRuleAcknowledgement = sourceMatch ? null : getRecruitingRuleAcknowledgement(selectedPost);
        const matchRuleRequiredIds = sourceMatch?.rules?.ruleAcknowledgementRequiredIds ?? [];
        const matchRuleAcknowledgedIds = sourceMatch?.rules?.ruleAcknowledgedIds ?? [];
        const ruleAcknowledgementRequiredIds = sourceMatch
          ? matchRuleRequiredIds
          : recruitingRuleAcknowledgement.requiredIds;
        const ruleAcknowledgedIds = sourceMatch
          ? matchRuleAcknowledgedIds
          : recruitingRuleAcknowledgement.acknowledgedIds;
        const ruleAcknowledgementPending = ruleAcknowledgementRequiredIds.some((playerId) => !ruleAcknowledgedIds.includes(playerId));
        const currentRuleRevision = Number(sourceMatch?.rules?.ruleRevision ?? selectedPost.roomState?.ruleRevision ?? 0);
        const currentUserNeedsRuleAcknowledgement = sourceMatch
          ? matchRuleRequiredIds.includes(app.currentUser.id) && !matchRuleAcknowledgedIds.includes(app.currentUser.id)
          : recruitingRuleAcknowledgement.requiredIds.includes(app.currentUser.id)
            && !recruitingRuleAcknowledgement.acknowledgedIds.includes(app.currentUser.id);
        const currentUserCanRespondSchedule = scheduleChangePending
          && scheduleProposalProgress.requiredIds.includes(app.currentUser.id)
          && !scheduleProposalProgress.approvedIds.includes(app.currentUser.id);
        const maxSideFilled = Math.max(
          lobby.sides.teamA.projectedPlayers.length,
          lobby.sides.teamB.projectedPlayers.length,
        );
        const maxSideReserveFilled = Math.max(
          lobby.sides.teamA.reserveCandidates.length,
          lobby.sides.teamB.reserveCandidates.length,
        );
        const pickupResize = getPickupResizeValidation(lobby, {
          sideCapacity: roomEditDraft?.sideCapacity,
          benchCapacity: roomEditDraft?.benchCapacity,
        });
        const roomEditPickupCapacityValid = !roomEditDraft || !pickupRoom || pickupResize.valid;
        const roomEditCapacityValid = !roomEditDraft || pickupRoom || Number(roomEditDraft.sideCapacity) >= maxSideFilled;
        const roomEditBenchCapacityValid = !roomEditDraft || pickupRoom || Number(roomEditDraft.benchCapacity) >= maxSideReserveFilled;
        const roomEditMeetingValid = !roomEditDraft || String(roomEditDraft.meetingPoint ?? "").trim().length >= 2;
        const roomEditRulesValid = !roomEditDraft
          || getMatchRuleInputValidation(roomEditDraft, { mode: selectedPost.mode }).valid;
        const roomEditScheduleValid = !roomEditDraft
          || roomEditDraft.timingType === "instant"
          || (Boolean(roomEditDraft.scheduledDate) && Boolean(roomEditDraft.scheduledTime));
        const playingIds = [...lobby.sides.teamA.projectedPlayers, ...lobby.sides.teamB.projectedPlayers];
        const partyJoinOptions = individualOnlyRoom ? [] : getSameSidePartyOptions(lobby, myEntry, myTeams);
        const sidePartyJoinOptions = individualOnlyRoom ? [] : getJoinableSidePartyOptions(lobby, myTeams, app.currentUser.id);
        const roomState = selectedRoomState;
        const chatMessages = roomState.chatMessages ?? [];
        const invitations = roomState.invitations ?? [];
        const pendingInvitations = invitations.filter((invitation) => invitation.status === "pending");
        const pendingRefereeInvitations = pendingInvitations.filter((invitation) => invitation.role === "referee");
        const getEntryPartyLeaderId = (entry) => roomState.partyLeaders?.[entry?.id]
          ?? (entry?.fixed ? selectedPost.playerId : entry?.playerId)
          ?? "";
        const canManageEntry = (entry) => Boolean(
          !individualOnlyRoom &&
          entry?.kind === "team" &&
          getEntryPartyLeaderId(entry) === app.currentUser.id
        );
        const getInviteAllowedTeamId = (sideName) => {
          if (!teamOnlyRoom) return "";
          return getLobbyPrimaryTeamId(lobby, sideName) ?? "";
        };
        const canInviteSideFromRoom = (sideName) => {
          if (!canInviteFromRoom) return false;

          if (!teamOnlyRoom) return true;
          const allowedTeamId = getInviteAllowedTeamId(sideName);
          if (!allowedTeamId) return false;

          const sideEntry = (lobby.sides?.[sideName]?.entries ?? []).find((entry) => (
            entry.kind === "team" &&
            (entry.team?.id ?? entry.teamId) === allowedTeamId
          ));
          return Boolean(sideEntry && getEntryPartyLeaderId(sideEntry) === app.currentUser.id);
        };
        const moveCandidate = (candidate, placement) => {
          const candidateEntry = lobby.entries.find((entry) => entry.id === candidate.entryId);
          if (isPartyEntry(candidateEntry)) {
            app.actions.setRecruitingPartyPlayerPlacement(selectedPost.id, candidate.entryId, candidate.playerId, placement);
            return;
          }
          app.actions.setRecruitingApplicantPlacement(selectedPost.id, candidate.playerId, placement);
        };
        const removeCandidate = (candidate) => {
          const candidateEntry = lobby.entries.find((entry) => entry.id === candidate.entryId);
          if (isPartyEntry(candidateEntry)) {
            app.actions.removeRecruitingPartyPlayer(selectedPost.id, candidate.entryId, candidate.playerId);
            return;
          }
          app.actions.kickRecruitingApplicant(selectedPost.id, candidate.playerId);
        };
        const disabledInvitePlayerIds = [
          app.currentUser.id,
          roomOwnerId,
          selectedPost.playerId,
          ...lobby.entries.flatMap((entry) => [entry.playerId, ...(entry.players ?? []), ...(entry.reserves ?? [])]),
          ...pendingInvitations.map((invitation) => invitation.targetUserId),
        ].filter(Boolean);
        const canInvitePlayerByRoom = (playerId, player = null) => {
          if (!playerId) return false;
          const mmrLimitMode = selectedPost.mmrLimitMode ?? roomState.mmrLimitMode ?? "block";
          if (mmrLimitMode !== "block") return true;
          const targetPlayer = player ?? userById[playerId];
          if (!targetPlayer) return true;
          return getRecruitingFit(selectedPost, targetPlayer.ratings?.integrated ?? DEFAULT_RATING, app.state).allowed;
        };
        const disabledRefereeIds = new Set([
          ...disabledInvitePlayerIds,
          selectedPost.refereeId,
          ...pendingRefereeInvitations.map((invitation) => invitation.targetUserId),
        ].filter(Boolean));
        const refereeInviteCandidates = app.capabilities?.remoteDirectory === false || !isSupabaseConfigured
          ? app.state.users
            .filter((user) => !disabledRefereeIds.has(user.id))
            .filter((user) => isEligibleReferee(user, selectedPost.refereeTrustMin, app.state.settings?.refereeAppointments))
            .sort((a, b) => Number(b.trustScore ?? 0) - Number(a.trustScore ?? 0))
          : [];
        const showRefereeInviteSlot = refereeWanted && !selectedPost.refereeId;
        const canInviteRefereeFromRoom = showRefereeInviteSlot && canInviteFromRoom;
        const activeInviteDraftRaw = inviteDraft?.postId === selectedPost.id ? inviteDraft : null;
        const activeSelfSlotDraftRaw = slotActionDraft?.postId === selectedPost.id ? slotActionDraft : null;
        const favoritePlayerIds = app.state.settings?.favoritePlayerIds ?? [];
        const favoriteTeamIds = app.state.settings?.favoriteTeamIds ?? [];
        const favoriteRefereeIds = app.state.settings?.favoriteRefereeIds ?? [];
        const useSideNameHeader = selectedPost.visibility !== "private" && !teamOnlyRoom;
        const teamAMeta = getLobbySideMeta(lobby, "teamA", userById, { useSideName: useSideNameHeader });
        const teamBMeta = getLobbySideMeta(lobby, "teamB", userById, { useSideName: useSideNameHeader });
        const tournamentRoomOwnerName = selectedPost.tournamentId ? userById[roomOwnerId]?.name ?? "" : "";
        const sourceMatchStatus = getSourceMatchStatus(sourceMatch, lobby, app.currentUser.id);
        const sourceMatchAction = getSourceMatchAction(sourceMatch, app.currentUser.id, app.state.teams, userById);
        const sourceMatchSideName = getSourceMatchDecisionSideName(sourceMatch, app.currentUser.id, app.state.teams);
        const roomTimingStatus = getPublicRoomTimingStatus(selectedPost);

  return {
    lobby, roomPhaseViewModel, pickupPoolMode, joinDraft, individualOnlyRoom, teamOnlyRoom,
    selectedRoomTeamAId, selectedRoomTeamBId, selectedRoomTeamA, selectedRoomTeamB, roomTargetMmr, getJoinTeamEligibility,
    selectedJoinTeam, selectedJoinTeamEligibility, selectedJoinSideTeamId, selectedJoinSideAvailable, teamRoomHasJoinableSide, joinCapacity,
    selectedJoinPlayerIds, benchCapacity, pickupOpenSlotPlacements, selectedJoinReserveIds, candidateMmr, fit,
    matchRoom, recruitingRoomConfirmed, storedRoomPost, slotPositions, roomOwnerId, mine,
    myEntry, alreadyApplied, currentUserIsRoomReferee, changeApprovalSource, scheduleProposalProgress, scheduleChangePending,
    canInviteFromRoom, canChat, selectedRoomState, refereeWanted, getJoinRosterPatch, teamJoinValid,
    canJoinReferee, joinMmrLimitMode, joinTierAllowed, canJoin, roomTeamSelectionOpen, getRoomTeamSelectionEligibility,
    roomTeamACandidates, roomTeamBCandidates, saveRoomTeam, renderRoomTeamResult, joiningThisRoom, joinModeEntries,
    selectedRange, roomEditDraft, roomEditStatus, roomEditCurrentCourt, roomEditCourtOptions, roomEditRange,
    roomEditCourt, roomEditCourtWarning, selectedRoomPolicySource, selectedMatchRules, selectedMatchRuleRows, selectedCreationSummary,
    selectedRoomPolicyRows, selectedRoomOperationRows, pickupRoom, pickupAssignmentPolicy, recruitingRuleAcknowledgement, matchRuleRequiredIds,
    matchRuleAcknowledgedIds, ruleAcknowledgementRequiredIds, ruleAcknowledgedIds, ruleAcknowledgementPending, currentRuleRevision, currentUserNeedsRuleAcknowledgement,
    currentUserCanRespondSchedule, maxSideFilled, maxSideReserveFilled, pickupResize, roomEditPickupCapacityValid, roomEditCapacityValid,
    roomEditBenchCapacityValid, roomEditMeetingValid, roomEditRulesValid, roomEditScheduleValid, playingIds, partyJoinOptions,
    sidePartyJoinOptions, roomState, chatMessages, invitations, pendingInvitations, pendingRefereeInvitations,
    getEntryPartyLeaderId, canManageEntry, getInviteAllowedTeamId, canInviteSideFromRoom, moveCandidate, removeCandidate,
    disabledInvitePlayerIds, canInvitePlayerByRoom, disabledRefereeIds, refereeInviteCandidates, showRefereeInviteSlot, canInviteRefereeFromRoom,
    activeInviteDraftRaw, activeSelfSlotDraftRaw, favoritePlayerIds, favoriteTeamIds, favoriteRefereeIds, useSideNameHeader,
    teamAMeta, teamBMeta, tournamentRoomOwnerName, sourceMatchStatus, sourceMatchAction, sourceMatchSideName,
    roomTimingStatus,
  };
}
