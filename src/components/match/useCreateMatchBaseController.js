import { CREATE_MATCH_DEPENDENCIES } from "./CreateMatchDependencies.js";

export function useCreateMatchBaseController({
  app,
  initialDraft = null,
  onRecruitingCreated = null,
  onCancel = null,
  embedded = false,
  practiceMode = false,
  syncStepToUrl = true,
}) {
  const {
    COURT_MAP_SEARCH_LIMIT, COURT_MAP_SEARCH_PURPOSE, DEFAULT_MATCH_MEMO, DEFAULT_TOURNAMENT_MMR_GAP, DIRECTORY_PICKER_PAGE_LIMIT, DISPUTE_WINDOW_MINUTES, MAX_PARTY_RESERVES,
    RECORD_TYPES, REGIONS, ROOM_SCHEDULE_MAX_DAYS, SCHEDULE_MAX_DAYS, addDateDays, getAgeGroupForUser, getAgeRestrictionOption,
    getCanonicalRegion, getCourtPickerResults, getCourtRecommendationScore, getCreateStepFromSearch, getCreateStepSearch, getDefaultCreateMode, getDefaultCreateTitle,
    getDefaultMatchCreationPolicy, getDefaultMmrLimitMode, getDefaultTeamPlayerIds, getLocalDateInputValue, getMatchCreationSteps, getMatchCreationValidation, getMatchCreationWizardType,
    getMatchFormationMode, getMatchModeChangePatch, getMmrSpread, getNextQueueSchedule, getOpponentTeam, getPartyPlayerIds, getPartyReserveIds,
    getPublicRoomMaxDateInput, getRecordComposition, getRecordEntryMode, getRecruitingSideCapacity, getRegisteredCourts, getRepresentativePlayerIds, getRepresentativeTeam,
    getRoomKindFromDraft, getRoomRemakeDraft, getSoloRecordRosterError, getSoloRecordSelectedIdentitySet, getTeamEventEligibility, getTeamHashtag, includesQuery,
    inferRegionSelection, isCourtInRegion, isDefaultCreateTitle, isDefaultTournamentTitle, isHashtagQuery, isSameRegion, makeEmptySoloStats,
    mergeCourtSearchCourts, normalizeRecruitingMmrRangeMode, postServerAction, useCallback, useEffect, useLocation, useMemo,
    useNavigate, useRef, useState,
  } = CREATE_MATCH_DEPENDENCIES;

const navigate = useNavigate();
  const location = useLocation();
  const remakeDraft = useMemo(() => {
    const source = location.state?.remakeDraft;
    return source && typeof source === "object" && !Array.isArray(source)
      ? getRoomRemakeDraft(source)
      : null;
  }, [location.state?.remakeDraft]);
  const remakeSourceId = remakeDraft ? String(location.state?.remakeSourceId ?? "").trim() : "";
  const remakeSourceMatchId = remakeDraft ? String(location.state?.remakeSourceMatchId ?? "").trim() : "";
  const challengeSearchParams = new URLSearchParams(location.search);
  const challengeTeamAId = String(location.state?.challengeTeamAId ?? challengeSearchParams.get("challengeTeamAId") ?? "").trim();
  const challengeTeamBId = String(location.state?.challengeTeamBId ?? challengeSearchParams.get("challengeTeamBId") ?? "").trim();
  const hasTeamChallenge = Boolean(challengeTeamAId && challengeTeamBId && challengeTeamAId !== challengeTeamBId);
  const today = getLocalDateInputValue();
  const minSoloRecordDate = addDateDays(today, -1);
  const nextWeek = addDateDays(today, 7);
  const maxScheduleDate = addDateDays(today, SCHEDULE_MAX_DAYS);
  const maxPrivateScheduleDate = addDateDays(today, ROOM_SCHEDULE_MAX_DAYS);
  const maxPublicScheduleDate = getPublicRoomMaxDateInput();
  const isRecordCreateIntent = useMemo(
    () => !practiceMode && new URLSearchParams(location.search).get("intent") === "record",
    [location.search, practiceMode],
  );
  const loadDirectory = app.actions.loadDirectory;
  const remoteDirectoryEnabled = app.capabilities?.remoteDirectory !== false;
  const requestedTournamentDirectoryRef = useRef(false);
  const modeManuallyChangedRef = useRef(Boolean(remakeDraft || hasTeamChallenge));
  const loadedCourtMapRegionsRef = useRef(new Set());
  const courtMapRequestIdRef = useRef(0);
  useEffect(() => {
    if (requestedTournamentDirectoryRef.current) return;
    requestedTournamentDirectoryRef.current = true;
    loadDirectory?.({ kind: "teams", limit: DIRECTORY_PICKER_PAGE_LIMIT, offset: 0, includeTeamMemberProfiles: true });
  }, [loadDirectory]);
  const myTeams = useMemo(
    () => app.state.teams.filter((team) => team.members.some((member) => member.userId === app.currentUser.id)),
    [app.currentUser.id, app.state.teams],
  );
  const captainTeams = useMemo(
    () => myTeams.filter((team) => team.members.some((member) => member.userId === app.currentUser.id && member.role === "captain")),
    [app.currentUser.id, myTeams],
  );
  const representativeTeamId = app.state.settings?.representativeTeamId ?? app.currentUser.representativeTeamId ?? "";
  const currentRepresentativeTeam = useMemo(
    () => getRepresentativeTeam(app.currentUser.id, app.state.teams, representativeTeamId) ?? null,
    [app.currentUser.id, app.state.teams, representativeTeamId],
  );
  const representativeTournamentTeam = useMemo(
    () => captainTeams.find((team) => team.id === currentRepresentativeTeam?.id) ?? null,
    [captainTeams, currentRepresentativeTeam?.id],
  );
  const canCreateTeamRoom = myTeams.length > 0;
  const defaultTeamA = myTeams[0];
  const defaultTournamentTeamA = representativeTournamentTeam;
  const defaultMode = getDefaultCreateMode(defaultTeamA);
  const defaultHostJoinMode = canCreateTeamRoom && defaultMode !== "1v1" ? "team" : "player";
  const defaultCapacity = getRecruitingSideCapacity({ mode: defaultMode });
  const defaultTournamentCapacity = getRecruitingSideCapacity({ mode: "5v5" });
  const currentRegion = getCanonicalRegion(app.currentUser.regionDistrict || app.currentUser.region);
  const currentCourtRegionSelection = useMemo(
    () => inferRegionSelection([
      app.currentUser.regionSido,
      app.currentUser.regionDistrict,
      app.currentUser.region,
    ].filter(Boolean).join(" ")),
    [app.currentUser.region, app.currentUser.regionDistrict, app.currentUser.regionSido],
  );
  const currentCourtRegion = `${currentCourtRegionSelection.sido} ${currentCourtRegionSelection.district}`;
  const favoriteCourtIds = app.state.settings?.favoriteCourtIds ?? [];
  const defaultTeamAPlayerIds = defaultHostJoinMode === "team" ? getRepresentativePlayerIds(app.currentUser.id) : [];
  const defaultTeamB = defaultHostJoinMode === "team" && defaultTeamA
    ? getOpponentTeam(app.state.teams, defaultTeamA.id, currentRegion, defaultTeamAPlayerIds, 1)
    : undefined;
  const defaultTournamentTeamB = getOpponentTeam(app.state.teams, defaultTournamentTeamA?.id, currentRegion, [], defaultTournamentCapacity);
  const defaultTeamBPlayerIds = defaultHostJoinMode === "team" ? getDefaultTeamPlayerIds(defaultTeamB, 1, defaultTeamAPlayerIds) : [];
  const defaultMmrLimitMode = getDefaultMmrLimitMode(defaultTeamA, defaultTeamB);
  const directoryCourts = useMemo(() => getRegisteredCourts(app.state), [app.state]);
  const [discoveredCourts, setDiscoveredCourts] = useState([]);
  const [courtMapDirectoryStatus, setCourtMapDirectoryStatus] = useState({ loading: false, error: "" });
  const registeredCourts = useMemo(
    () => mergeCourtSearchCourts(directoryCourts, discoveredCourts),
    [directoryCourts, discoveredCourts],
  );
  const defaultCourt = [...registeredCourts]
    .filter((court) => isCourtInRegion(court, currentRegion))
    .sort((a, b) => Number(favoriteCourtIds.includes(b.id)) - Number(favoriteCourtIds.includes(a.id)) || getCourtRecommendationScore(b) - getCourtRecommendationScore(a))[0]
    ?? [...registeredCourts].sort((a, b) => getCourtRecommendationScore(b) - getCourtRecommendationScore(a))[0]
    ?? { name: "미정", region: currentRegion || app.currentUser.region };
  const [teamQuery, setTeamQuery] = useState("");
  const [opponentTeamQuery, setOpponentTeamQuery] = useState("");
  const [courtQuery, setCourtQuery] = useState("");
  const [courtMapOpen, setCourtMapOpen] = useState(false);
  const [courtDetailCourtId, setCourtDetailCourtId] = useState("");
  const [refereeQuery, setRefereeQuery] = useState("");
  const [selectedTournamentTeamProfiles, setSelectedTournamentTeamProfiles] = useState([]);
  const [selectedTournamentRefereeProfiles, setSelectedTournamentRefereeProfiles] = useState([]);
  const [soloTeamAUserQuery, setSoloTeamAUserQuery] = useState("");
  const [soloTeamBUserQuery, setSoloTeamBUserQuery] = useState("");
  const [teamRegion, setTeamRegion] = useState(currentRegion || "전체");
  const [courtRegion, setCourtRegion] = useState(currentCourtRegion);
  const teamSelectableRegions = useMemo(() => ["전체", ...new Set([currentRegion, ...REGIONS].filter(Boolean))], [currentRegion]);
  const courtMapRegion = courtRegion;
  const defaultAgeRestriction = getAgeGroupForUser(app.currentUser);
  const favoriteTeamIds = app.state.settings?.favoriteTeamIds ?? [];
  const favoriteRefereeIds = app.state.settings?.favoriteRefereeIds ?? [];
  const isFavoriteTeam = (team) => favoriteTeamIds.includes(team.id);
  const isFavoriteCourt = (court) => favoriteCourtIds.includes(court.id);
  const defaultSchedule = getNextQueueSchedule(app.state.recruitingPosts ?? []);
  const [draft, setDraft] = useState({
    recordType: RECORD_TYPES.match,
    visibility: "private",
    timingType: "scheduled",
    hostJoinMode: defaultHostJoinMode,
    teamOnly: false,
    mmrLimitMode: defaultMmrLimitMode,
    mmrRangeMode: "narrow",
    ageRestriction: defaultAgeRestriction,
    title: getDefaultCreateTitle(defaultMode),
    mode: defaultMode,
    ...getDefaultMatchCreationPolicy(defaultMode),
    courtId: defaultCourt.id ?? "",
    court: defaultCourt.name,
    tournamentCourtIds: defaultCourt.id ? [defaultCourt.id] : [],
    scheduledDate: defaultSchedule.scheduledDate,
    scheduledTime: defaultSchedule.scheduledTime,
    recordEntryMode: "quick",
    recordComposition: "individual",
    teamAId: undefined,
    teamBId: undefined,
    playerIds: [],
    reservePlayerIds: [],
    opponentPlayerIds: [],
    opponentReservePlayerIds: [],
    opponentLeaderId: "",
    approvalModeA: "leader",
    approvalModeB: "leader",
    courtReserved: false,
    courtFee: "",
    refereeWanted: false,
    refereeId: "",
    ranked: true,
    official: false,
    preRegistered: true,
    objectionWindow: `${DISPUTE_WINDOW_MINUTES}분`,
    evidence: [],
    memo: DEFAULT_MATCH_MEMO,
    stakes: "다음 경기 우선권.",
    soloOpponentName: "",
    soloTeamAName: "우리팀",
    soloTeamBName: "상대팀",
    soloTeamAPlayersText: "",
    soloTeamBPlayersText: "",
    soloTeamAPlayerRefs: [],
    soloTeamBPlayerRefs: [],
    soloScoreFor: "",
    soloScoreAgainst: "",
    soloStats: makeEmptySoloStats(),
    tournamentFormat: "league",
    tournamentTeamIds: [defaultTournamentTeamA?.id, defaultTournamentTeamB?.id].filter(Boolean),
    tournamentRefereeIds: [],
    tournamentEndDate: nextWeek,
    tournamentSchedulePolicy: "weekly",
    tournamentScheduleNote: "초대팀 확정 후 경기별 일정을 배정합니다.",
    tournamentMmrPolicy: "gap_adjusted",
    tournamentMaxMmrGap: DEFAULT_TOURNAMENT_MMR_GAP,
    ...(remakeDraft ?? {}),
    ...(hasTeamChallenge ? {
      visibility: "private",
      hostJoinMode: "team",
      teamOnly: true,
      teamAId: challengeTeamAId,
      teamBId: challengeTeamBId,
    } : {}),
    ...(initialDraft ?? {}),
  });
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [submitFeedback, setSubmitFeedback] = useState("");
  const [wizardStep, setWizardStep] = useState(1);

  useEffect(() => {
    setDraft((current) => {
      const mmrRangeMode = normalizeRecruitingMmrRangeMode(current.mmrRangeMode);
      const mmrLimitMode = current.visibility === "tournament"
        ? current.mmrLimitMode
        : current.ranked ? "block" : "off";
      if (current.mmrRangeMode === mmrRangeMode && current.mmrLimitMode === mmrLimitMode) return current;
      return { ...current, mmrRangeMode, mmrLimitMode };
    });
  }, [draft.mmrLimitMode, draft.mmrRangeMode, draft.ranked, draft.visibility]);

  useEffect(() => {
    if (!canCreateTeamRoom || defaultMode === "1v1" || modeManuallyChangedRef.current) return;
    setDraft((current) => {
      if (current.recordType !== RECORD_TYPES.match || current.mode !== "1v1" || getMatchFormationMode(current) === "pickup") return current;
      const playerIds = [];
      const title = isDefaultTournamentTitle(current.title)
        ? current.title
        : isDefaultCreateTitle(current.title)
          ? getDefaultCreateTitle(defaultMode, current.matchIntent)
          : current.title;
      return {
        ...current,
        ...getMatchModeChangePatch(current, defaultMode),
        hostJoinMode: "team",
        teamOnly: true,
        teamAId: undefined,
        teamBId: undefined,
        playerIds,
        reservePlayerIds: [],
        opponentPlayerIds: [],
        opponentReservePlayerIds: [],
        opponentLeaderId: "",
        mmrLimitMode: current.ranked ? "block" : "off",
        title,
      };
    });
  }, [app.currentUser.id, canCreateTeamRoom, defaultMode, defaultTeamA?.id, defaultTeamB, defaultTeamB?.id]);

  useEffect(() => {
    if (
      (wizardStep !== 4 && !courtMapOpen)
      || !courtMapRegion
      || app.remoteReady === false
      || !remoteDirectoryEnabled
    ) return undefined;
    const loadKey = `${courtMapRegion}:${courtMapOpen ? "map" : "step"}`;
    if (loadedCourtMapRegionsRef.current.has(loadKey)) return undefined;

    const requestId = courtMapRequestIdRef.current + 1;
    courtMapRequestIdRef.current = requestId;
    setCourtMapDirectoryStatus({ loading: true, error: "" });
    postServerAction("/api/search", {
      query: courtMapRegion,
      type: "court",
      limit: COURT_MAP_SEARCH_LIMIT,
      context: { purpose: COURT_MAP_SEARCH_PURPOSE },
      force: true,
    }, { allowWhenDisabled: true }).then((result) => {
      if (courtMapRequestIdRef.current !== requestId) return;
      const courts = (Array.isArray(result?.items) ? result.items : []).filter((court) => court?.kind === "court" && court?.id);
      setDiscoveredCourts((current) => mergeCourtSearchCourts(current, courts));
      loadedCourtMapRegionsRef.current.add(loadKey);
      setCourtMapDirectoryStatus({ loading: false, error: "" });
    }).catch(() => {
      if (courtMapRequestIdRef.current !== requestId) return;
      setCourtMapDirectoryStatus({ loading: false, error: "등록 구장을 불러오지 못했습니다. 다시 열어 주세요." });
    });

    return () => {
      if (courtMapRequestIdRef.current === requestId) courtMapRequestIdRef.current += 1;
    };
  }, [app.remoteReady, courtMapOpen, courtMapRegion, remoteDirectoryEnabled, wizardStep]);

  const sortedTeams = useMemo(() => {
    const hashtagSearch = isHashtagQuery(teamQuery);
    return [...app.state.teams]
      .filter((team) => hashtagSearch || teamRegion === "전체" || isSameRegion(team.region, teamRegion))
      .filter((team) => includesQuery(`${team.name} ${getTeamHashtag(team)} ${team.region} ${team.homeCourt}`, teamQuery))
      .sort((a, b) => Number(isFavoriteTeam(b)) - Number(isFavoriteTeam(a)) || Number(isSameRegion(b.region, currentRegion)) - Number(isSameRegion(a.region, currentRegion)) || b.mmr - a.mmr);
  }, [app.state.teams, currentRegion, favoriteTeamIds, teamQuery, teamRegion]);

  const sortedCourts = useMemo(() => getCourtPickerResults(registeredCourts, {
    query: courtQuery,
    region: courtRegion,
    currentRegion,
    favoriteCourtIds,
  }), [courtQuery, courtRegion, currentRegion, favoriteCourtIds, registeredCourts]);

  const favoriteTeams = useMemo(() => {
    return [...app.state.teams]
      .filter(isFavoriteTeam)
      .sort((a, b) => Number(isSameRegion(b.region, currentRegion)) - Number(isSameRegion(a.region, currentRegion)) || b.mmr - a.mmr)
      .slice(0, 10);
  }, [app.state.teams, currentRegion, favoriteTeamIds]);

  const favoriteCourts = useMemo(() => {
    return [...registeredCourts]
      .filter(isFavoriteCourt)
      .sort((a, b) => Number(isCourtInRegion(b, currentRegion)) - Number(isCourtInRegion(a, currentRegion)) || getCourtRecommendationScore(b) - getCourtRecommendationScore(a) || a.name.localeCompare(b.name))
      .slice(0, 10);
  }, [currentRegion, favoriteCourtIds, registeredCourts]);

  const selectedTeamA = app.state.teams.find((team) => team.id === draft.teamAId);
  const selectedTeamB = app.state.teams.find((team) => team.id === draft.teamBId);
  const isSoloRecord = draft.recordType === RECORD_TYPES.personalRecord;
  const isMatchRecordRoom = draft.recordType === RECORD_TYPES.matchRecord;
  const recordEntryMode = getRecordEntryMode(draft);
  const recordComposition = getRecordComposition(draft);
  const soloRosterError = useMemo(
    () => getSoloRecordRosterError(
      draft.mode,
      draft.soloTeamAPlayersText,
      draft.soloTeamBPlayersText,
      draft.soloTeamAPlayerRefs,
      draft.soloTeamBPlayerRefs,
    ),
    [
      draft.mode,
      draft.soloTeamAPlayerRefs,
      draft.soloTeamAPlayersText,
      draft.soloTeamBPlayerRefs,
      draft.soloTeamBPlayersText,
    ],
  );
  const soloRecordSelectedIdentitySet = useMemo(
    () => getSoloRecordSelectedIdentitySet(
      draft.soloTeamAPlayersText,
      draft.soloTeamBPlayersText,
      draft.soloTeamAPlayerRefs,
      draft.soloTeamBPlayerRefs,
    ),
    [
      draft.soloTeamAPlayerRefs,
      draft.soloTeamAPlayersText,
      draft.soloTeamBPlayerRefs,
      draft.soloTeamBPlayersText,
    ],
  );
  const isPublicRoom = !isSoloRecord && !isMatchRecordRoom && draft.visibility === "public";
  const isTournamentRoom = !isSoloRecord && !isMatchRecordRoom && draft.visibility === "tournament";
  const isPickupMatch = !isSoloRecord && !isMatchRecordRoom && !isTournamentRoom && getMatchFormationMode(draft) === "pickup";
  const isTeamRoom = !isSoloRecord && !isTournamentRoom && !isPickupMatch && (isMatchRecordRoom ? recordComposition === "team" : draft.hostJoinMode === "team");
  const isStandardCreateWizard = !isSoloRecord && !isMatchRecordRoom && !isTournamentRoom;
  const creationWizardType = getMatchCreationWizardType(draft, { recordIntent: isRecordCreateIntent });
  const creationWizardSteps = useMemo(() => getMatchCreationSteps(creationWizardType), [creationWizardType]);
  const finalWizardStep = creationWizardSteps.at(-1)?.id ?? 1;
  const wizardStepIds = useMemo(() => new Set(creationWizardSteps.map((step) => step.id)), [creationWizardSteps]);
  const goToWizardStep = useCallback((nextStep, { replace = false } = {}) => {
    const step = Number(nextStep);
    if (!wizardStepIds.has(step)) return;

    setWizardStep(step);
    if (!syncStepToUrl) return;
    const nextSearch = getCreateStepSearch(location.search, step);
    if (nextSearch === location.search) return;

    navigate({ pathname: location.pathname, search: nextSearch }, { replace });
  }, [location.pathname, location.search, navigate, syncStepToUrl, wizardStepIds]);

  useEffect(() => {
    if (!syncStepToUrl) return;
    const params = new URLSearchParams(location.search);
    const requestedStep = Number(params.get("step"));
    const step = getCreateStepFromSearch(location.search, creationWizardSteps);

    if (params.has("step") && !wizardStepIds.has(requestedStep)) {
      navigate({ pathname: location.pathname, search: getCreateStepSearch(location.search, step) }, { replace: true });
      return;
    }

    if (step !== wizardStep) setWizardStep(step);
  }, [creationWizardSteps, location.pathname, location.search, navigate, syncStepToUrl, wizardStep, wizardStepIds]);

  const matchCreationValidation = useMemo(() => getMatchCreationValidation(draft), [draft]);
  const matchCreationPolicy = matchCreationValidation.policy;
  const currentRoomKind = getRoomKindFromDraft(draft);
  const sideCapacity = getRecruitingSideCapacity(draft);
  const ageRestrictionOption = getAgeRestrictionOption(draft.ageRestriction);
  const getTeamEligibility = (team, targetMmr = team?.mmr) => getTeamEventEligibility(team, app.state.users, {
    capacity: sideCapacity,
    ranked: isMatchRecordRoom ? false : draft.ranked,
    mmrLimitMode: isMatchRecordRoom ? "off" : draft.mmrLimitMode,
    mmrRangeMode: draft.mmrRangeMode,
    targetMmr,
    allowedAgeGroups: isMatchRecordRoom ? [] : ageRestrictionOption.allowedGroups,
    requireCaptainEligible: !isTournamentRoom,
  });
  const selectedTeamAEligibility = getTeamEligibility(selectedTeamA, selectedTeamA?.mmr);
  const selectedTeamBEligibility = getTeamEligibility(selectedTeamB, selectedTeamA?.mmr ?? selectedTeamB?.mmr);
  const publicPartyPlayerIds = getPartyPlayerIds(selectedTeamA, draft.playerIds, sideCapacity);
  const ownerReservePlayerIds = getPartyReserveIds(selectedTeamA, draft.reservePlayerIds, publicPartyPlayerIds);
  const ownerSidePlayerIds = [...publicPartyPlayerIds, ...ownerReservePlayerIds];
  const ownerSidePlayerKey = ownerSidePlayerIds.join("|");
  const opponentPartyPlayerIds = getPartyPlayerIds(selectedTeamB, draft.opponentPlayerIds, sideCapacity, ownerSidePlayerIds);
  const opponentReservePlayerIds = getPartyReserveIds(selectedTeamB, draft.opponentReservePlayerIds, opponentPartyPlayerIds, MAX_PARTY_RESERVES, ownerSidePlayerIds);
  const opponentCaptainId = selectedTeamB?.members?.find((member) => member.role === "captain")?.userId ?? "";
  const opponentInviteTargetIds = !isPublicRoom && isTeamRoom && opponentCaptainId && !ownerSidePlayerIds.includes(opponentCaptainId) ? [opponentCaptainId] : [];
  const opponentLeaderId = opponentInviteTargetIds.includes(draft.opponentLeaderId)
    ? draft.opponentLeaderId
    : opponentInviteTargetIds[0] ?? "";
  const tournamentTeams = useMemo(() => {
    const teamsById = new Map(
      [...selectedTournamentTeamProfiles, ...app.state.teams].map((team) => [team.id, team]),
    );
    return (draft.tournamentTeamIds ?? []).map((teamId) => teamsById.get(teamId)).filter(Boolean);
  }, [app.state.teams, draft.tournamentTeamIds, selectedTournamentTeamProfiles]);
  const getTournamentTeamEligibility = (team) => {
    const eligibility = getTeamEligibility(team, team?.mmr);
    const isMyTeam = myTeams.some((item) => item.id === team?.id);
    if (isMyTeam && representativeTournamentTeam?.id !== team?.id) {
      return { ...eligibility, allowed: false, reason: "내 팀은 대표팀으로 설정된 팀만 참가할 수 있습니다." };
    }
    return eligibility;
  };
  const tournamentMmrSpread = getMmrSpread(tournamentTeams);
  const tournamentEligibilityById = new Map(tournamentTeams.map((team) => [team.id, getTournamentTeamEligibility(team)]));
  const ineligibleTournamentTeams = tournamentTeams.filter((team) => !tournamentEligibilityById.get(team.id)?.allowed);
  const tournamentDirectoryError = app.directoryStatus?.error ?? "";
  const tournamentDirectoryPending = app.remoteReady === false || app.directoryStatus?.loading || (app.directoryStatus?.loaded === false && !tournamentDirectoryError);
  const representativeTournamentTeamSelected = Boolean(
    representativeTournamentTeam?.id && (draft.tournamentTeamIds ?? []).includes(representativeTournamentTeam.id),
  );
  const teamOptions = useMemo(() => {
    const teamMap = new Map();
    [selectedTeamA, selectedTeamB, ...tournamentTeams, ...sortedTeams].filter(Boolean).forEach((team) => teamMap.set(team.id, team));
    return Array.from(teamMap.values());
  }, [selectedTeamA, selectedTeamB, sortedTeams, tournamentTeams]);
  const teamAOptions = myTeams;
  const isInstantRoom = !isTournamentRoom && draft.timingType === "instant";
  const scheduleMaxDate = isSoloRecord || isMatchRecordRoom ? today : isPublicRoom ? maxPublicScheduleDate : isTournamentRoom ? maxScheduleDate : maxPrivateScheduleDate;
  const activePlayerIds = useMemo(() => {
    if (!isTeamRoom) return new Set([app.currentUser.id].filter(Boolean));
    if (isPublicRoom) return new Set([...publicPartyPlayerIds, ...ownerReservePlayerIds]);
    return new Set([
      ...publicPartyPlayerIds,
      ...ownerReservePlayerIds,
      ...opponentPartyPlayerIds,
      ...opponentReservePlayerIds,
      opponentLeaderId,
    ]);
  }, [app.currentUser.id, isPublicRoom, isTeamRoom, opponentLeaderId, opponentPartyPlayerIds, opponentReservePlayerIds, ownerReservePlayerIds, publicPartyPlayerIds]);

  return {
    ...CREATE_MATCH_DEPENDENCIES,
    app, initialDraft, onRecruitingCreated, onCancel, embedded, practiceMode, syncStepToUrl,
    navigate, location, remakeDraft, remakeSourceId, remakeSourceMatchId, challengeTeamAId, challengeTeamBId, hasTeamChallenge, today, minSoloRecordDate,
    nextWeek, maxScheduleDate, maxPrivateScheduleDate, maxPublicScheduleDate, isRecordCreateIntent, loadDirectory, remoteDirectoryEnabled,
    requestedTournamentDirectoryRef, modeManuallyChangedRef, loadedCourtMapRegionsRef, courtMapRequestIdRef, myTeams, captainTeams, representativeTeamId,
    currentRepresentativeTeam, representativeTournamentTeam, canCreateTeamRoom, defaultTeamA, defaultTournamentTeamA, defaultMode, defaultHostJoinMode,
    defaultCapacity, defaultTournamentCapacity, currentRegion, currentCourtRegionSelection, currentCourtRegion, favoriteCourtIds, defaultTeamAPlayerIds,
    defaultTeamB, defaultTournamentTeamB, defaultTeamBPlayerIds, defaultMmrLimitMode, directoryCourts, discoveredCourts, setDiscoveredCourts,
    courtMapDirectoryStatus, setCourtMapDirectoryStatus, registeredCourts, defaultCourt, teamQuery, setTeamQuery, opponentTeamQuery,
    setOpponentTeamQuery, courtQuery, setCourtQuery, courtMapOpen, setCourtMapOpen, courtDetailCourtId, setCourtDetailCourtId,
    refereeQuery, setRefereeQuery, selectedTournamentTeamProfiles, setSelectedTournamentTeamProfiles, selectedTournamentRefereeProfiles, setSelectedTournamentRefereeProfiles, soloTeamAUserQuery, setSoloTeamAUserQuery, soloTeamBUserQuery,
    setSoloTeamBUserQuery, teamRegion, setTeamRegion, courtRegion, setCourtRegion, teamSelectableRegions, courtMapRegion,
    defaultAgeRestriction, favoriteTeamIds, favoriteRefereeIds, isFavoriteTeam, isFavoriteCourt, defaultSchedule, draft,
    setDraft, submitting, setSubmitting, submittingRef, submitFeedback, setSubmitFeedback, wizardStep, setWizardStep,
    sortedTeams, sortedCourts, favoriteTeams, favoriteCourts, selectedTeamA, selectedTeamB, isSoloRecord,
    isMatchRecordRoom, recordEntryMode, recordComposition, soloRosterError, soloRecordSelectedIdentitySet, isPublicRoom, isTournamentRoom,
    isPickupMatch, isTeamRoom, isStandardCreateWizard, creationWizardType, creationWizardSteps, finalWizardStep, wizardStepIds,
    goToWizardStep, matchCreationValidation, matchCreationPolicy, currentRoomKind, sideCapacity, ageRestrictionOption, getTeamEligibility,
    selectedTeamAEligibility, selectedTeamBEligibility, publicPartyPlayerIds, ownerReservePlayerIds, ownerSidePlayerIds, ownerSidePlayerKey, opponentPartyPlayerIds,
    opponentReservePlayerIds, opponentCaptainId, opponentInviteTargetIds, opponentLeaderId, tournamentTeams, getTournamentTeamEligibility, tournamentMmrSpread,
    tournamentEligibilityById, ineligibleTournamentTeams, tournamentDirectoryError, tournamentDirectoryPending, representativeTournamentTeamSelected, teamOptions, teamAOptions,
    isInstantRoom, scheduleMaxDate, activePlayerIds,
  };
}
