export function useCreateMatchValidationController(context) {
  const {
    DEFAULT_RATING, DEFAULT_TOURNAMENT_MMR_GAP, MATCH_MODE_IDS, MMR_RANGE_POLICIES, PLAYER_STAT_FIELDS, RECORD_TYPES, REFEREE_TRUST_MIN,
    activePlayerIds, ageRestrictionOption, app, canCreateTeamRoom, currentRegion, defaultAgeRestriction, defaultCourt,
    defaultHostJoinMode, defaultMmrLimitMode, defaultMode, defaultTournamentTeamB, draft, favoriteRefereeIds, favoriteTeamIds,
    getAgeGroupForUser, getAvailableTeamPlayerIds, getCourtPlayWarning, getDefaultCreateTitle, getHostTrustRequirement, getMatchConfigurationChangePatch, getMatchIntentChangePatch,
    getMatchModeChangePatch, getMatchModeOrDefault, getMatchRecordMemo, getModeSize, getPublicRoomTimingStatus, getRecordCreationWindowStatus, getRecruitingTierRange,
    getRepresentativePlayerIds, getRequiredTournamentRefereeCount, getSelectableTeamPlayerIds, getSeoulTimeInputValue, getSoloRecordPlayerRef, getSoloRecordRosterLines, getSoloRecordUserIdentity,
    getSoloRecordUserLine, getTeamEligibility, getTeamHashtag, getTournamentRefereePoolValidation, getUserHashtag, includesQuery, ineligibleTournamentTeams,
    isDefaultCreateTitle, isDefaultTournamentTitle, isEligibleReferee, isInstantRoom, isMatchRecordRoom, isMmrInRecruitingRange, isPickupMatch,
    isPublicRoom, isRecordCreateIntent, isSameRegion, isSoloRecord, isStandardCreateWizard, isTeamRoom, isTournamentRoom,
    matchCreationValidation, maxScheduleDate, minSoloRecordDate, myTeams, normalizeSoloRecordRosterInput, opponentTeamQuery, ownerReservePlayerIds,
    ownerSidePlayerIds, ownerSidePlayerKey, publicPartyPlayerIds, recordComposition, recordEntryMode, refereeQuery, registeredCourts,
    representativeTournamentTeam, representativeTournamentTeamSelected, scheduleMaxDate, selectedTeamA, selectedTeamB, selectedTournamentRefereeProfiles, setCourtQuery,
    setCourtRegion, setDiscoveredCourts, setDraft, setRefereeQuery, setSoloTeamAUserQuery, setSoloTeamBUserQuery, setSubmitFeedback,
    soloRecordSelectedIdentitySet, soloRosterError, today, tournamentDirectoryError, tournamentDirectoryPending, tournamentEligibilityById, tournamentMmrSpread,
    tournamentTeams, useEffect, useMemo,
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

  const opponentTeamResults = useMemo(() => {
    if (!isTeamRoom || isPublicRoom || !selectedTeamA) return [];
    const query = opponentTeamQuery.trim();
    const recentOpponentScores = new Map();
    app.state.matches.forEach((match) => {
      const teamAId = match.teamA?.teamId ?? match.teamAId;
      const teamBId = match.teamB?.teamId ?? match.teamBId;
      const opponentId = teamAId === selectedTeamA.id ? teamBId : teamBId === selectedTeamA.id ? teamAId : "";
      if (!opponentId || opponentId === selectedTeamA.id) return;
      const dateValue = Date.parse(match.confirmedAt ?? match.endedAt ?? match.startedAt ?? match.scheduledAt ?? match.createdAt ?? "");
      const score = Number.isFinite(dateValue) ? dateValue : 1;
      recentOpponentScores.set(opponentId, Math.max(recentOpponentScores.get(opponentId) ?? 0, score));
    });
    return app.state.teams
      .filter((team) => team.id !== selectedTeamA.id)
      .filter((team) => getAvailableTeamPlayerIds(team, ownerSidePlayerIds).length >= 1)
      .filter((team) => !query || includesQuery(`${team.name} ${getTeamHashtag(team)} ${team.region} ${team.homeCourt}`, query))
      .filter((team) => getTeamEligibility(team, selectedTeamA.mmr).allowed || query)
      .sort((a, b) => (
        Number(favoriteTeamIds.includes(b.id)) - Number(favoriteTeamIds.includes(a.id)) ||
        Number(Boolean(recentOpponentScores.get(b.id))) - Number(Boolean(recentOpponentScores.get(a.id))) ||
        (recentOpponentScores.get(b.id) ?? 0) - (recentOpponentScores.get(a.id) ?? 0) ||
        Number(isSameRegion(b.region, currentRegion)) - Number(isSameRegion(a.region, currentRegion)) ||
        Math.abs(Number(a.mmr ?? DEFAULT_RATING) - Number(selectedTeamA.mmr ?? DEFAULT_RATING)) - Math.abs(Number(b.mmr ?? DEFAULT_RATING) - Number(selectedTeamA.mmr ?? DEFAULT_RATING)) ||
        String(a.name ?? "").localeCompare(String(b.name ?? ""))
      ))
      .slice(0, query ? 8 : 5);
  }, [app.state.matches, app.state.teams, currentRegion, draft.ageRestriction, draft.mmrRangeMode, favoriteTeamIds, isPublicRoom, isTeamRoom, opponentTeamQuery, ownerSidePlayerIds, selectedTeamA]);
  const favoriteOpponentTeams = useMemo(() => {
    if (!isTeamRoom || isPublicRoom || !selectedTeamA) return [];
    return app.state.teams
      .filter((team) => favoriteTeamIds.includes(team.id))
      .filter((team) => team.id !== selectedTeamA.id)
      .filter((team) => getAvailableTeamPlayerIds(team, ownerSidePlayerIds).length >= 1)
      .filter((team) => getTeamEligibility(team, selectedTeamA.mmr).allowed)
      .sort((a, b) => (
        Number(isSameRegion(b.region, currentRegion)) - Number(isSameRegion(a.region, currentRegion)) ||
        Math.abs(Number(a.mmr ?? DEFAULT_RATING) - Number(selectedTeamA.mmr ?? DEFAULT_RATING)) - Math.abs(Number(b.mmr ?? DEFAULT_RATING) - Number(selectedTeamA.mmr ?? DEFAULT_RATING)) ||
        String(a.name ?? "").localeCompare(String(b.name ?? ""))
      ))
      .slice(0, 10);
  }, [app.state.teams, currentRegion, draft.ageRestriction, draft.mmrRangeMode, favoriteTeamIds, isPublicRoom, isTeamRoom, ownerSidePlayerIds, selectedTeamA]);
  const refereeCandidates = useMemo(
    () => [...new Map([...app.state.users, ...selectedTournamentRefereeProfiles].map((user) => [user.id, user])).values()]
      .filter((user) => isEligibleReferee(user, REFEREE_TRUST_MIN, app.state.settings?.refereeAppointments))
      .filter((user) => !activePlayerIds.has(user.id))
      .sort((a, b) => Number(b.trustScore ?? 0) - Number(a.trustScore ?? 0)),
    [activePlayerIds, app.state.settings?.refereeAppointments, app.state.users, selectedTournamentRefereeProfiles],
  );
  const tournamentRefereeCandidates = useMemo(
    () => [...new Map([...app.state.users, ...selectedTournamentRefereeProfiles].map((user) => [user.id, user])).values()]
      .filter((user) => isEligibleReferee(
        user,
        REFEREE_TRUST_MIN,
        app.state.settings?.refereeAppointments,
        draft.tournamentEndDate,
      ))
      .sort((a, b) => Number(b.trustScore ?? 0) - Number(a.trustScore ?? 0)),
    [app.state.settings?.refereeAppointments, app.state.users, draft.tournamentEndDate, selectedTournamentRefereeProfiles],
  );
  const activeRefereeCandidates = isTournamentRoom ? tournamentRefereeCandidates : refereeCandidates;
  const selectedReferee = refereeCandidates.find((user) => user.id === draft.refereeId) ?? null;
  const selectedTournamentReferees = (draft.tournamentRefereeIds ?? [])
    .map((refereeId) => tournamentRefereeCandidates.find((user) => user.id === refereeId))
    .filter(Boolean);
  const favoriteReferees = useMemo(
    () => favoriteRefereeIds
      .map((userId) => activeRefereeCandidates.find((user) => user.id === userId))
      .filter(Boolean),
    [activeRefereeCandidates, favoriteRefereeIds],
  );
  const refereeSearchResults = useMemo(() => {
    const query = refereeQuery.trim();
    return activeRefereeCandidates.filter((user) => (
      !query ||
      includesQuery(`${user.name} ${getUserHashtag(user)} ${user.position} ${user.region} 신뢰도 ${user.trustScore}`, query)
    ));
  }, [activeRefereeCandidates, refereeQuery]);
  const soloRecordUserCandidates = useMemo(
    () => app.state.users
      .filter((user) => user.id !== app.currentUser.id && !user.anonymous)
      .filter((user) => !soloRecordSelectedIdentitySet.has(getSoloRecordUserIdentity(user)))
      .sort((a, b) => (
        Number(isSameRegion(b.region, currentRegion)) - Number(isSameRegion(a.region, currentRegion)) ||
        Number(b.trustScore ?? 0) - Number(a.trustScore ?? 0) ||
        String(a.name ?? "").localeCompare(String(b.name ?? ""))
      )),
    [app.currentUser.id, app.state.users, currentRegion, soloRecordSelectedIdentitySet],
  );
  const teamTierRange = getRecruitingTierRange(selectedTeamA?.mmr ?? DEFAULT_RATING, draft.ranked, draft.mmrRangeMode);
  const personalTierRange = getRecruitingTierRange(app.currentUser.ratings?.integrated ?? DEFAULT_RATING, draft.ranked, draft.mmrRangeMode);
  const roomTierRange = isTeamRoom ? teamTierRange : personalTierRange;
  const mmrRangePolicy = MMR_RANGE_POLICIES[draft.mmrRangeMode] ?? MMR_RANGE_POLICIES.narrow;
  const currentUserAgeGroup = getAgeGroupForUser(app.currentUser);
  const ageRestrictionBlocked = !isSoloRecord && !isMatchRecordRoom && !isTournamentRoom && !ageRestrictionOption.allowedGroups.includes(currentUserAgeGroup);
  const hostTrustRequired = !isSoloRecord && !isMatchRecordRoom && !isTournamentRoom
    ? getHostTrustRequirement({ ranked: draft.ranked, visibility: isPublicRoom ? "public" : "private", official: draft.official })
    : 0;
  const hostTrustScore = Number(app.currentUser.trustScore ?? 0);
  const hostTrustBlocked = hostTrustRequired > 0 && hostTrustScore < hostTrustRequired;
  const teamTierBlocked = Boolean(
    isTeamRoom &&
      !isPublicRoom &&
      !isMatchRecordRoom &&
      !isTournamentRoom &&
      draft.mmrLimitMode === "block" &&
      draft.ranked &&
      selectedTeamA &&
      selectedTeamB &&
      !isMmrInRecruitingRange(selectedTeamB.mmr, selectedTeamA.mmr, true, draft.mmrRangeMode),
  );
  const teamTierWarned = Boolean(
    isTeamRoom &&
      !isPublicRoom &&
      !isMatchRecordRoom &&
      !isTournamentRoom &&
      draft.mmrLimitMode === "warn" &&
      draft.ranked &&
      selectedTeamA &&
      selectedTeamB &&
      !isMmrInRecruitingRange(selectedTeamB.mmr, selectedTeamA.mmr, true, draft.mmrRangeMode),
  );
  const scheduledTimingStatus = getPublicRoomTimingStatus({
    ...draft,
    visibility: isPublicRoom ? "public" : "private",
  });
  const scheduledTimingAllowed = isInstantRoom || scheduledTimingStatus.canCreate;
  const recordCreationWindow = getRecordCreationWindowStatus(draft.scheduledDate, draft.scheduledTime);
  const scheduleAllowed = isSoloRecord || isMatchRecordRoom
    ? recordCreationWindow.valid
    : isInstantRoom || (draft.scheduledDate >= today && draft.scheduledDate <= scheduleMaxDate && scheduledTimingAllowed);
  const tournamentEndAllowed = !isTournamentRoom || (draft.tournamentEndDate >= today && draft.tournamentEndDate <= maxScheduleDate);
  const selectedCourt = useMemo(
    () => registeredCourts.find((court) => court.id === draft.courtId || court.name === draft.court) ?? null,
    [draft.court, draft.courtId, registeredCourts],
  );
  const selectedTournamentCourts = useMemo(() => {
    const selectedIds = new Set(draft.tournamentCourtIds ?? []);
    return registeredCourts.filter((court) => selectedIds.has(court.id));
  }, [draft.tournamentCourtIds, registeredCourts]);
  const courtRequiredBlocked = !isSoloRecord && !isMatchRecordRoom && !selectedCourt?.id;
  const privateTeamInvalid = !isPublicRoom && isTeamRoom && !canCreateTeamRoom;
  const matchRecordInvalid = isMatchRecordRoom && (
    !draft.title.trim() ||
    !draft.scheduledDate ||
    !draft.scheduledTime ||
    draft.scheduledDate < minSoloRecordDate ||
    draft.scheduledDate > today ||
    !recordCreationWindow.valid ||
    !MATCH_MODE_IDS.has(draft.mode) ||
    !["individual", "team"].includes(recordComposition)
  );
  const publicTeamInvalid = isPublicRoom && isTeamRoom && !canCreateTeamRoom;
  const tournamentMmrBlocked = Boolean(
    isTournamentRoom &&
      draft.ranked &&
      draft.mmrLimitMode === "block" &&
      tournamentMmrSpread > Number(draft.tournamentMaxMmrGap ?? DEFAULT_TOURNAMENT_MMR_GAP),
  );
  const tournamentOrganizerEligible = isEligibleReferee(
    app.currentUser,
    REFEREE_TRUST_MIN,
    app.state.settings?.refereeAppointments,
    draft.tournamentEndDate,
  );
  const requiredTournamentRefereeCount = getRequiredTournamentRefereeCount(tournamentTeams.length);
  const tournamentRefereePoolValidation = getTournamentRefereePoolValidation({
    tournament: {
      teamIds: draft.tournamentTeamIds ?? [],
      refereeIds: draft.tournamentRefereeIds ?? [],
      endDate: draft.tournamentEndDate,
    },
    teams: tournamentTeams,
    users: [...app.state.users, ...selectedTournamentRefereeProfiles],
    refereeAppointments: app.state.settings?.refereeAppointments,
  });
  const tournamentInvalid = !draft.title.trim()
    || tournamentDirectoryPending
    || Boolean(tournamentDirectoryError)
    || !representativeTournamentTeamSelected
    || tournamentTeams.length < 2
    || !tournamentOrganizerEligible
    || !tournamentRefereePoolValidation.allowed
    || tournamentMmrBlocked
    || ineligibleTournamentTeams.length > 0;
  const publicTeamInvalidReason = publicTeamInvalid ? "팀전을 만들려면 먼저 팀에 가입해야 합니다." : "";
  const privateTeamInvalidReason = privateTeamInvalid ? "팀전을 만들려면 먼저 팀에 가입해야 합니다." : "";
  const matchRecordInvalidReason = !draft.title.trim()
    ? "경기 기록 제목을 입력해 주세요."
    : !recordCreationWindow.valid
      ? recordCreationWindow.reason === "future"
        ? "경기가 끝난 뒤의 시각만 선택할 수 있습니다."
        : "경기 종료 후 24시간 이내의 시각을 선택해 주세요."
      : !MATCH_MODE_IDS.has(draft.mode)
        ? "지원하는 경기 인원을 선택해 주세요."
        : !["individual", "team"].includes(recordComposition)
          ? "개인 구성 또는 팀 구성을 선택해 주세요."
          : "";
  const tournamentInvalidReason = !draft.title.trim()
    ? "대회 이름을 입력해야 생성할 수 있습니다."
    : tournamentDirectoryPending
      ? "팀원 정보를 불러오는 중입니다."
    : tournamentDirectoryError
      ? "팀원 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."
    : !representativeTournamentTeam
      ? "대회에 참가할 대표팀의 팀장이어야 합니다."
    : !representativeTournamentTeamSelected
      ? "내 대표팀을 참가팀에 포함해야 합니다."
    : tournamentTeams.length < 2
      ? "대회는 최소 2개 팀을 선택해야 생성할 수 있습니다."
    : !tournamentOrganizerEligible
      ? `대회 주최자는 신뢰도 ${REFEREE_TRUST_MIN} 이상인 자격심판이어야 합니다.`
    : tournamentRefereePoolValidation.refereeIds.length < requiredTournamentRefereeCount
      ? `${tournamentTeams.length}팀 대회는 자격심판 ${requiredTournamentRefereeCount}명 이상을 섭외해야 합니다.`
    : tournamentRefereePoolValidation.ineligibleRefereeId
      ? "자격 또는 신뢰도 조건을 충족하지 못한 심판이 포함되어 있습니다."
    : tournamentRefereePoolValidation.uncoveredPairs.length
      ? "모든 가능한 대진에 양 팀과 무관한 중립 심판을 배정할 수 있도록 심판을 추가해 주세요."
      : tournamentMmrBlocked
        ? "대회 팀 MMR 차이가 허용값을 넘었습니다. MMR 제한을 경고만 또는 제한 없음으로 바꾸면 생성할 수 있습니다."
        : ineligibleTournamentTeams.length
          ? `${ineligibleTournamentTeams[0].name}: ${tournamentEligibilityById.get(ineligibleTournamentTeams[0].id)?.reason}`
        : "";
  const soloStatsInvalid = PLAYER_STAT_FIELDS.some((field) => {
    const value = Number((draft.soloStats ?? {})[field.id] ?? 0);
    return !Number.isFinite(value) || value < 0 || value > 999;
  });
  const soloScoreForNumber = Number(draft.soloScoreFor);
  const soloScoreAgainstNumber = Number(draft.soloScoreAgainst);
  const soloRecordInvalid = isSoloRecord && (
    !draft.title.trim() ||
    !draft.scheduledDate ||
    !draft.scheduledTime ||
    draft.scheduledDate < minSoloRecordDate ||
    draft.scheduledDate > today ||
    !recordCreationWindow.valid ||
    !Number.isFinite(soloScoreForNumber) ||
    !Number.isFinite(soloScoreAgainstNumber) ||
    soloScoreForNumber < 0 ||
    soloScoreAgainstNumber < 0 ||
    soloScoreForNumber > 999 ||
    soloScoreAgainstNumber > 999 ||
    (recordEntryMode === "named" && Boolean(soloRosterError)) ||
    soloStatsInvalid
  );
  const meetingPointInvalid = !isSoloRecord && !isMatchRecordRoom && draft.meetingPoint.trim().length < 2;
  const matchRuleInvalid = !isSoloRecord && !matchCreationValidation.ruleValidation.valid;
  const matchCreationPolicyInvalid = isStandardCreateWizard && matchCreationValidation.policyErrors.length > 0;
  const submitDisabled = courtRequiredBlocked || meetingPointInvalid || matchRuleInvalid || matchCreationPolicyInvalid || (isSoloRecord ? soloRecordInvalid : !scheduleAllowed || !tournamentEndAllowed || ageRestrictionBlocked || hostTrustBlocked || (isMatchRecordRoom
    ? matchRecordInvalid
    : isTournamentRoom
    ? tournamentInvalid
    : isPublicRoom
      ? publicTeamInvalid
      : teamTierBlocked || privateTeamInvalid));
  const submitDisabledReason = courtRequiredBlocked
    ? "등록된 구장을 선택해야 생성할 수 있습니다."
    : meetingPointInvalid
      ? "실제로 만날 출입구·층·코트 번호를 2자 이상 적어 주세요."
    : matchRuleInvalid
      ? matchCreationValidation.ruleErrors[0]
    : matchCreationPolicyInvalid
      ? matchCreationValidation.policyErrors[0]
    : isSoloRecord && soloRecordInvalid
    ? (recordEntryMode === "named" ? soloRosterError : "") || "제목, 종료 시각, 점수를 확인해 주세요. 내 기록은 경기 종료 후 24시간 이내에만 저장할 수 있습니다."
    : isMatchRecordRoom && matchRecordInvalid
      ? (matchRecordInvalidReason || "경기 기록 정보를 확인해 주세요.")
    : !scheduleAllowed
    ? isMatchRecordRoom ? "경기 기록은 경기 종료 후 24시간 이내에만 만들 수 있으며 미래 시각은 선택할 수 없습니다." : "일정 조건이 맞지 않습니다. 즉시는 바로 생성 가능하고, 예약 일정은 허용 기간 안에서만 가능합니다."
    : !tournamentEndAllowed
      ? "대회 종료일이 허용 기간을 벗어났습니다."
      : teamTierBlocked
        ? "상대팀 MMR이 현재 허용구간 밖입니다. MMR 제한을 경고만 또는 제한 없음으로 바꾸면 생성할 수 있습니다."
        : ageRestrictionBlocked
          ? "생성자가 선택한 연령 제한 밖입니다. 연령 제한을 바꾸면 생성할 수 있습니다."
          : hostTrustBlocked
            ? `방장 신뢰도 ${hostTrustRequired}점 이상 필요합니다. 현재 ${hostTrustScore}점입니다.`
            : privateTeamInvalid
              ? privateTeamInvalidReason || "팀전을 만들려면 먼저 팀에 가입해야 합니다."
              : isTournamentRoom && tournamentInvalidReason
                ? tournamentInvalidReason
                : isPublicRoom && publicTeamInvalid && publicTeamInvalidReason
                  ? publicTeamInvalidReason
                  : "";
  const courtSummary = selectedCourt ?? defaultCourt;
  const courtPlayWarning = selectedCourt ? getCourtPlayWarning(selectedCourt, draft.mode) : "";
  const selectCourt = (court) => {
    setSubmitFeedback("");
    if (court?.id && !registeredCourts.some((item) => item.id === court.id)) {
      setDiscoveredCourts((current) => [...current.filter((item) => item.id !== court.id), court]);
    }
    setDraft((current) => ({
      ...current,
      courtId: court.id ?? "",
      court: court.name,
      ...(isTournamentRoom && court.id
        ? { tournamentCourtIds: Array.from(new Set([...(current.tournamentCourtIds ?? []), court.id])) }
        : {}),
    }));
    setCourtQuery(court.name);
    if (court.region) setCourtRegion(court.region);
  };
  const clearSelectedCourt = () => {
    setSubmitFeedback("");
    setDraft((current) => ({
      ...current,
      courtId: "",
      court: "",
      ...(isTournamentRoom ? { tournamentCourtIds: [] } : {}),
    }));
    setCourtQuery("");
  };
  const removeTournamentCourt = (courtId) => {
    setSubmitFeedback("");
    setDraft((current) => {
      const nextIds = (current.tournamentCourtIds ?? []).filter((id) => id !== courtId);
      if (!nextIds.length) return current;
      if (current.courtId !== courtId) return { ...current, tournamentCourtIds: nextIds };
      const nextCourt = registeredCourts.find((court) => court.id === nextIds[0]);
      return {
        ...current,
        tournamentCourtIds: nextIds,
        courtId: nextCourt?.id ?? "",
        court: nextCourt?.name ?? "",
      };
    });
  };

  const update = (patch) => {
    setSubmitFeedback("");
    setDraft((current) => {
      const next = { ...current, ...patch };
      if (patch.ranked === false) next.official = false;
      return next;
    });
  };
  const updateSoloStat = (fieldId, value) => {
    const nextValue = value === "" ? "" : Math.max(0, Math.min(999, Number(value) || 0));
    update({ soloStats: { ...(draft.soloStats ?? {}), [fieldId]: nextValue } });
  };
  const normalizeSoloRosterSide = (sideName) => {
    const fieldId = sideName === "teamA" ? "soloTeamAPlayersText" : "soloTeamBPlayersText";
    const refFieldId = sideName === "teamA" ? "soloTeamAPlayerRefs" : "soloTeamBPlayerRefs";
    setDraft((current) => {
      const normalized = normalizeSoloRecordRosterInput(
        current[fieldId],
        current[refFieldId],
        app.state.users,
      );
      return {
        ...current,
        [fieldId]: normalized.text,
        [refFieldId]: normalized.refs,
      };
    });
  };
  const appendSoloRecordUser = (sideName, user) => {
    const fieldId = sideName === "teamA" ? "soloTeamAPlayersText" : "soloTeamBPlayersText";
    const refFieldId = sideName === "teamA" ? "soloTeamAPlayerRefs" : "soloTeamBPlayerRefs";
    const line = getSoloRecordUserLine(user);
    const playerRef = getSoloRecordPlayerRef(user);
    if (!line || !playerRef) return;
    const sideSize = getModeSize(draft.mode, 1);
    const targetLimit = sideName === "teamA" ? Math.max(0, sideSize - 1) : sideSize;
    const targetLines = getSoloRecordRosterLines(draft[fieldId]);
    const identity = getSoloRecordUserIdentity(user);
    if (targetLines.length >= targetLimit) {
      setSubmitFeedback(sideName === "teamA" ? `우리 사이드는 본인 제외 ${targetLimit}명까지만 추가할 수 있습니다.` : `상대 사이드는 ${targetLimit}명까지만 추가할 수 있습니다.`);
      return;
    }
    if (identity && soloRecordSelectedIdentitySet.has(identity)) {
      setSubmitFeedback("같은 선수를 우리/상대 또는 같은 사이드에 중복으로 넣을 수 없습니다.");
      return;
    }
    setSubmitFeedback("");
    setDraft((current) => {
      const lines = String(current[fieldId] ?? "").split("\n").map((item) => item.trim()).filter(Boolean);
      if (lines.includes(line)) return current;
      return {
        ...current,
        [fieldId]: [...lines, line].join("\n"),
        [refFieldId]: [...(current[refFieldId] ?? []), playerRef],
      };
    });
    if (sideName === "teamA") setSoloTeamAUserQuery("");
    else setSoloTeamBUserQuery("");
  };
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
      const currentTournamentTeamIds = (current.tournamentTeamIds ?? []).filter((teamId) => app.state.teams.some((team) => team.id === teamId));
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
  }, [app.state.teams, defaultTournamentTeamB?.id, isTeamRoom, isTournamentRoom, myTeams, representativeTournamentTeam?.id]);
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

  return {
    opponentTeamResults, favoriteOpponentTeams, refereeCandidates, tournamentRefereeCandidates, activeRefereeCandidates, selectedReferee, selectedTournamentReferees,
    favoriteReferees, refereeSearchResults, soloRecordUserCandidates, teamTierRange, personalTierRange, roomTierRange, mmrRangePolicy,
    currentUserAgeGroup, ageRestrictionBlocked, hostTrustRequired, hostTrustScore, hostTrustBlocked, teamTierBlocked, teamTierWarned,
    scheduledTimingStatus, scheduledTimingAllowed, recordCreationWindow, scheduleAllowed, tournamentEndAllowed, selectedCourt, selectedTournamentCourts,
    courtRequiredBlocked, privateTeamInvalid, matchRecordInvalid, publicTeamInvalid, tournamentMmrBlocked, tournamentOrganizerEligible, requiredTournamentRefereeCount,
    tournamentRefereePoolValidation, tournamentInvalid, publicTeamInvalidReason, privateTeamInvalidReason, matchRecordInvalidReason, tournamentInvalidReason, soloStatsInvalid,
    soloScoreForNumber, soloScoreAgainstNumber, soloRecordInvalid, meetingPointInvalid, matchRuleInvalid, matchCreationPolicyInvalid, submitDisabled,
    submitDisabledReason, courtSummary, courtPlayWarning, selectCourt, clearSelectedCourt, removeTournamentCourt, update,
    updateSoloStat, normalizeSoloRosterSide, appendSoloRecordUser,
  };
}
