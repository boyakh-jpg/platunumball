export function useCreateMatchValidationEffects(context, { refereeCandidates }) {
  const {
    RECORD_TYPES,
    app,
    canCreateTeamRoom,
    defaultAgeRestriction,
    defaultHostJoinMode,
    defaultMmrLimitMode,
    defaultMode,
    defaultTournamentTeamB,
    draft,
    getDefaultCreateTitle,
    getMatchConfigurationChangePatch,
    getMatchIntentChangePatch,
    getMatchModeChangePatch,
    getMatchModeOrDefault,
    getMatchRecordMemo,
    getRepresentativePlayerIds,
    getSelectableTeamPlayerIds,
    getSeoulTimeInputValue,
    isDefaultCreateTitle,
    isDefaultTournamentTitle,
    isMatchRecordRoom,
    isPickupMatch,
    isPublicRoom,
    isRecordCreateIntent,
    isSoloRecord,
    isTeamRoom,
    isTournamentRoom,
    myTeams,
    ownerReservePlayerIds,
    ownerSidePlayerKey,
    publicPartyPlayerIds,
    representativeTournamentTeam,
    selectedTournamentTeamProfiles,
    selectedTeamA,
    selectedTeamB,
    setDraft,
    setRefereeQuery,
    today,
    useEffect,
  } = context;

  useEffect(() => {
    if (isRecordCreateIntent) {
      if (isSoloRecord || isMatchRecordRoom) return;
      setDraft((current) => {
        const mode = getMatchModeOrDefault(current.mode, defaultMode);
        return {
          ...current,
          ...getMatchIntentChangePatch(current, "standard_competitive"),
          ...getMatchModeChangePatch(current, mode),
          recordType: RECORD_TYPES.matchRecord,
          recordComposition: "individual",
          visibility: "private",
          timingType: "scheduled",
          hostJoinMode: "player",
          teamOnly: false,
          ranked: false,
          official: false,
          preRegistered: false,
          mmrLimitMode: "off",
          ageRestriction: "any",
          courtReserved: false,
          courtFee: "",
          stakes: "",
          memo: getMatchRecordMemo(current.memo),
          title: isDefaultCreateTitle(current.title) || isDefaultTournamentTitle(current.title) ? "경기 기록" : current.title,
          scheduledDate: today,
          scheduledTime: getSeoulTimeInputValue(),
          courtId: "",
          court: "",
          teamAId: undefined,
          teamBId: undefined,
          playerIds: [app.currentUser.id],
          reservePlayerIds: [],
          opponentPlayerIds: [],
          opponentReservePlayerIds: [],
          opponentLeaderId: "",
        };
      });
      return;
    }
    if (!isSoloRecord && !isMatchRecordRoom) return;
    setDraft((current) => {
      const mode = getMatchModeOrDefault(current.mode, defaultMode);
      const playerIds = [];
      const title = current.title === "개인 기록" || current.title === "경기 기록" || isDefaultCreateTitle(current.title)
        ? getDefaultCreateTitle(mode)
        : current.title;
      return {
        ...current,
        ...getMatchIntentChangePatch(current, "standard_competitive"),
        ...getMatchModeChangePatch(current, mode),
        recordType: RECORD_TYPES.match,
        visibility: "private",
        timingType: "scheduled",
        hostJoinMode: defaultHostJoinMode,
        teamOnly: defaultHostJoinMode === "team",
        ranked: true,
        official: false,
        preRegistered: true,
        mmrLimitMode: "block",
        ageRestriction: defaultAgeRestriction,
        title,
        teamAId: undefined,
        teamBId: undefined,
        playerIds,
        reservePlayerIds: [],
        opponentPlayerIds: [],
        opponentReservePlayerIds: [],
        opponentLeaderId: "",
      };
    });
  }, [app.currentUser.id, defaultAgeRestriction, defaultHostJoinMode, defaultMmrLimitMode, defaultMode, isMatchRecordRoom, isRecordCreateIntent, isSoloRecord]);

  useEffect(() => {
    if (!draft.refereeId) return;
    if (refereeCandidates.some((user) => user.id === draft.refereeId)) return;
    setDraft((current) => ({ ...current, refereeId: "" }));
    setRefereeQuery("");
  }, [draft.refereeId, refereeCandidates]);

  useEffect(() => {
    if (isTeamRoom && !isTournamentRoom) {
      setDraft((current) => {
        const alreadyEmpty = !current.teamAId
          && !current.teamBId
          && !(current.playerIds ?? []).length
          && !(current.reservePlayerIds ?? []).length
          && !(current.opponentPlayerIds ?? []).length
          && !(current.opponentReservePlayerIds ?? []).length
          && !current.opponentLeaderId;
        const mmrLimitMode = current.ranked ? "block" : "off";
        if (alreadyEmpty && current.mmrLimitMode === mmrLimitMode) return current;
        return {
          ...current,
          teamAId: undefined,
          teamBId: undefined,
          playerIds: [],
          reservePlayerIds: [],
          opponentPlayerIds: [],
          opponentReservePlayerIds: [],
          opponentLeaderId: "",
          mmrLimitMode,
        };
      });
      return;
    }
    if (!isTournamentRoom || !app.state.teams.length) return;
    setDraft((current) => {
      const availableTeamIds = new Set(
        [...app.state.teams, ...selectedTournamentTeamProfiles].map((team) => team.id),
      );
      const currentTournamentTeamIds = (current.tournamentTeamIds ?? []).filter((teamId) => availableTeamIds.has(teamId));
      const tournamentTeamIds = currentTournamentTeamIds.filter((teamId) => (
        !myTeams.some((team) => team.id === teamId) || teamId === representativeTournamentTeam?.id
      ));
      if (representativeTournamentTeam?.id && !tournamentTeamIds.includes(representativeTournamentTeam.id)) {
        tournamentTeamIds.unshift(representativeTournamentTeam.id);
      }
      if (!currentTournamentTeamIds.length && defaultTournamentTeamB?.id && !tournamentTeamIds.includes(defaultTournamentTeamB.id)) {
        tournamentTeamIds.push(defaultTournamentTeamB.id);
      }
      if (tournamentTeamIds.length === (current.tournamentTeamIds ?? []).length
        && tournamentTeamIds.every((teamId, index) => teamId === current.tournamentTeamIds[index])) return current;
      return { ...current, tournamentTeamIds };
    });
  }, [app.state.teams, defaultTournamentTeamB?.id, isTeamRoom, isTournamentRoom, myTeams, representativeTournamentTeam?.id, selectedTournamentTeamProfiles]);

  useEffect(() => {
    if (!isPickupMatch) return;
    setDraft((current) => ({
      ...current,
      ...getMatchConfigurationChangePatch(current, { formationMode: "pickup" }),
      teamAId: undefined,
      teamBId: undefined,
      playerIds: [],
      reservePlayerIds: [],
      opponentPlayerIds: [],
      opponentReservePlayerIds: [],
      opponentLeaderId: "",
    }));
  }, [isPickupMatch]);

  useEffect(() => {
    if (canCreateTeamRoom) return;
    setDraft((current) => current.hostJoinMode === "team"
      ? {
        ...current,
        hostJoinMode: "player",
        teamOnly: false,
        playerIds: [],
        reservePlayerIds: [],
        opponentPlayerIds: [],
        opponentReservePlayerIds: [],
        opponentLeaderId: "",
      }
      : current);
  }, [canCreateTeamRoom]);

  useEffect(() => {
    if (!isTeamRoom || !selectedTeamA) return;
    const selectableIds = getSelectableTeamPlayerIds(selectedTeamA);
    const selectedIds = selectableIds.includes(app.currentUser.id) ? getRepresentativePlayerIds(app.currentUser.id) : [];
    const playerIdsNeedSync = !Array.isArray(draft.playerIds)
      || draft.playerIds.length !== selectedIds.length
      || draft.playerIds.some((playerId, index) => playerId !== selectedIds[index]);
    const reserveIdsNeedSync = !Array.isArray(draft.reservePlayerIds)
      || draft.reservePlayerIds.length > 0;
    if (!playerIdsNeedSync && !reserveIdsNeedSync) return;
    setDraft((current) => ({
      ...current,
      playerIds: selectedIds,
      reservePlayerIds: [],
    }));
  }, [app.currentUser.id, draft.hostJoinMode, draft.playerIds, draft.reservePlayerIds, isPublicRoom, isTeamRoom, selectedTeamA]);

  useEffect(() => {
    if (!isTeamRoom || isPublicRoom || !selectedTeamB) return;
    const excludedIds = [...publicPartyPlayerIds, ...ownerReservePlayerIds];
    const captainId = selectedTeamB.members?.find((member) => member.role === "captain")?.userId ?? "";
    const nextLeaderId = captainId && !excludedIds.includes(captainId) ? captainId : "";
    const playerIdsNeedSync = !Array.isArray(draft.opponentPlayerIds)
      || draft.opponentPlayerIds.length > 0;
    const reserveIdsNeedSync = !Array.isArray(draft.opponentReservePlayerIds)
      || draft.opponentReservePlayerIds.length > 0;
    const leaderNeedSync = draft.opponentLeaderId !== nextLeaderId;
    if (!playerIdsNeedSync && !reserveIdsNeedSync && !leaderNeedSync) return;
    setDraft((current) => ({
      ...current,
      opponentPlayerIds: [],
      opponentReservePlayerIds: [],
      opponentLeaderId: nextLeaderId,
    }));
  }, [draft.hostJoinMode, draft.opponentLeaderId, draft.opponentPlayerIds, draft.opponentReservePlayerIds, isPublicRoom, isTeamRoom, ownerSidePlayerKey, selectedTeamB]);
}
