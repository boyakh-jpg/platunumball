import * as repository from "../data/repository.js";
import { createProfileShell } from "../data/profileMappers.js";
import { DEFAULT_SETTINGS, EMPTY_STATE } from "../data/repositoryDefaults.js";
import { normalizeMatchRules } from "./matchRules.js";
import {
  applyOperatorAttendance,
  getMatchReservePlayerIds,
  getMatchRoomPhase,
} from "./matchUtils.js";
import { PRACTICE_ID_PREFIX, isPracticeEntity } from "./practiceMode.js";
import {
  getRecruitingBenchCapacity,
  getRecruitingLobby,
  getRecruitingSideCapacity,
} from "./recruiting.js";
import { getPickupParticipantCapacity, getPickupParticipantIds } from "./roomFlow.js";

export const PRACTICE_SELF_ID = `${PRACTICE_ID_PREFIX}player-self`;

const PRACTICE_DUMMY_PROFILES = Object.freeze([
  ["guard-1", "김서준", "PG", 1210],
  ["guard-2", "이도윤", "SG", 1185],
  ["wing-1", "박지호", "SF", 1240],
  ["wing-2", "최민재", "SF", 1160],
  ["forward-1", "정하준", "PF", 1200],
  ["center-1", "오시우", "C", 1260],
  ["guard-3", "한유진", "PG", 1140],
  ["wing-3", "윤태오", "SG", 1195],
  ["forward-2", "임현우", "PF", 1230],
  ["center-2", "송재민", "C", 1170],
  ["reserve-1", "강도현", "SG", 1150],
  ["reserve-2", "문지환", "PF", 1220],
  ["guard-4", "이준혁", "PG", 1190],
  ["wing-4", "배시온", "SF", 1215],
  ["forward-3", "홍민우", "PF", 1165],
  ["center-3", "조은찬", "C", 1245],
]);

export const PRACTICE_REDUCER_ACTIONS = new Set([
  "acceptRecruitingInvitation",
  "acknowledgeMatchRoomRules",
  "acknowledgeRecruitingRoomRules",
  "addMatchLatePlayer",
  "agreeMatch",
  "approveMatch",
  "cancelMatch",
  "cancelRecruitingParticipation",
  "checkInMatchPlayer",
  "closeRecruitingPost",
  "confirmMatchRefereeAbsence",
  "confirmPickupSideAssignment",
  "declineRecruitingInvitation",
  "deleteSoloRecord",
  "detachRecruitingPartyPlayer",
  "disputeMatch",
  "endMatch",
  "generatePickupSideAssignment",
  "finalizeMatchByAuthority",
  "handoffMatchRecorder",
  "interestRecruitingPost",
  "inviteRecruitingPlayers",
  "inviteRecruitingReferee",
  "joinRecruitingSideParty",
  "kickRecruitingApplicant",
  "removeMatchLatePlayer",
  "removeMatchRoomPlayer",
  "removeRecruitingPartyPlayer",
  "requestMatchRefereeAbsence",
  "resolveMatchDispute",
  "respondMatchScheduleProposal",
  "respondRecruitingScheduleProposal",
  "sendRecruitingChat",
  "setMatchRecordParticipants",
  "setMatchRecordTeamRoster",
  "setMatchRoomPlayerPlacement",
  "setRecruitingApplicantPlacement",
  "setRecruitingPartyPlayerPlacement",
  "setRecruitingPartyPlayerReserve",
  "setRecruitingSlotPosition",
  "setRecruitingTeamPartyRoster",
  "startMatch",
  "submitMatchResult",
  "submitMatchThumbs",
  "substituteMatchPlayer",
  "swapPickupMatchPlayers",
  "updateMatchRoomRules",
  "updateRecruitingRoomRules",
  "voidMatch",
]);

function makePracticeProfile([key, name, position, rating], region) {
  const id = `${PRACTICE_ID_PREFIX}${key}`;
  const profile = createProfileShell(id, "");
  return {
    ...profile,
    id,
    name,
    anonymous: false,
    position,
    region,
    regionSido: region,
    trustScore: 95,
    ratings: {
      integrated: rating,
      modes: Object.fromEntries(
        Object.keys(profile.ratings?.modes ?? {}).map((mode) => [mode, rating]),
      ),
    },
    ...(key === "reserve-2" ? {
      officialReferee: true,
      refereeGrade: "official",
      refereeProfile: {
        grade: "official",
        status: "active",
        licenseVerified: true,
      },
    } : {}),
  };
}

function getPracticeCourt(region = "") {
  return {
    id: `${PRACTICE_ID_PREFIX}court`,
    name: "연습 코트",
    region: region || "서울",
    status: "active",
  };
}

export function createPracticeState(realState = {}, realUser = {}) {
  const region = realUser.region || "서울";
  const baseSelf = createProfileShell(PRACTICE_SELF_ID, "");
  const self = {
    ...baseSelf,
    id: PRACTICE_SELF_ID,
    name: realUser.name || "나",
    anonymous: false,
    position: realUser.position || "PG",
    region,
    regionSido: realUser.regionSido || region,
    regionDistrict: realUser.regionDistrict || "",
    trustScore: 100,
    ratings: { ...baseSelf.ratings, ...(realUser.ratings ?? {}) },
  };
  const activeApprovedCourts = (realState.settings?.approvedCourts ?? []).filter((court) => (
    court?.id && (!court.status || court.status === "active")
  ));
  const approvedCourts = activeApprovedCourts.length
    ? activeApprovedCourts
    : [getPracticeCourt(region)];
  return {
    ...EMPTY_STATE,
    currentUserId: PRACTICE_SELF_ID,
    users: [
      self,
      ...PRACTICE_DUMMY_PROFILES.map((profile) => makePracticeProfile(profile, region)),
    ],
    teams: [],
    matches: [],
    recruitingPosts: [],
    notifications: [],
    settings: {
      ...DEFAULT_SETTINGS,
      theme: realState.settings?.theme === "light" ? "light" : "dark",
      approvedCourts,
      courtMetrics: realState.settings?.courtMetrics ?? [],
      favoriteCourtIds: realState.settings?.favoriteCourtIds ?? [],
    },
  };
}

function markPracticeState(state) {
  return {
    ...state,
    currentUserId: PRACTICE_SELF_ID,
    notifications: [],
    discordNotificationDeliveries: [],
    discordNotificationSeenKeys: [],
    discordNotificationSeenUsers: [],
    recruitingPosts: (state.recruitingPosts ?? []).map((post) => ({
      ...post,
      practiceMode: true,
      ranked: false,
      official: false,
      ratingScale: 0,
      roomState: { ...(post.roomState ?? {}), practiceMode: true },
      rules: { ...(post.rules ?? {}), practiceMode: true, ranked: false, official: false, ratingScale: 0 },
    })),
    matches: (state.matches ?? []).map((match) => ({
      ...match,
      practiceMode: true,
      ranked: false,
      official: false,
      preRegistered: false,
      ratingScale: 0,
      rules: { ...(match.rules ?? {}), practiceMode: true, ranked: false, official: false, ratingScale: 0 },
    })),
  };
}

function withPracticeActor(state, actorId, reducer, ...args) {
  const next = reducer({ ...state, currentUserId: actorId }, ...args);
  return markPracticeState({ ...next, currentUserId: PRACTICE_SELF_ID });
}

export function runPracticeReducer(state, actionName, args = [], actorId = PRACTICE_SELF_ID) {
  if (!PRACTICE_REDUCER_ACTIONS.has(actionName)) {
    return { state, applied: false, error: "practice_action_blocked" };
  }
  const reducer = repository[actionName];
  if (typeof reducer !== "function") {
    return { state, applied: false, error: "practice_action_unavailable" };
  }
  const baseline = markPracticeState({ ...state, currentUserId: PRACTICE_SELF_ID });
  const next = withPracticeActor(state, actorId, reducer, ...args);
  const applied = JSON.stringify(next) !== JSON.stringify(baseline);
  return {
    state: applied ? next : baseline,
    applied,
    error: applied ? "" : "practice_action_not_applied",
  };
}

export function createPracticeRecruitingRoom(state, draft = {}, { inviteTutorial = false } = {}) {
  const roomId = `${PRACTICE_ID_PREFIX}room-${Date.now().toString(36)}`;
  const safeDraft = {
    ...draft,
    id: roomId,
    visibility: "private",
    timingType: "instant",
    scheduledDate: "",
    scheduledTime: "",
    hostJoinMode: "player",
    teamOnly: false,
    teamId: "",
    opponentTeamId: "",
    playerIds: [],
    reservePlayerIds: [],
    opponentPlayerIds: [],
    opponentReservePlayerIds: [],
    invitePlayerIds: [],
    ranked: false,
    official: false,
    preRegistered: false,
    mmrLimitMode: "off",
    refereeWanted: Boolean(draft.refereeWanted || draft.refereeId),
    refereeId: draft.refereeId || "",
    ratingScale: 0,
    rules: {
      ...(draft.rules ?? {}),
      practiceMode: true,
      ranked: false,
      official: false,
      ratingScale: 0,
    },
  };
  let next = withPracticeActor(state, PRACTICE_SELF_ID, repository.createRecruitingPost, safeDraft);
  const post = next.recruitingPosts.find((item) => item.id === roomId);
  if (!post) return { state, postId: "", error: "practice_room_create_failed" };

  const reservedRefereeId = safeDraft.refereeId || (
    safeDraft.refereeWanted
      ? next.users.find((user) => user.officialReferee === true)?.id || ""
      : ""
  );
  const dummyIds = next.users
    .map((user) => user.id)
    .filter((userId) => userId !== PRACTICE_SELF_ID && userId !== reservedRefereeId);
  const sideCapacity = Number(post.sideCapacity || 1);
  const benchCapacity = Math.max(0, Math.floor(Number(post.benchCapacity ?? post.rules?.benchCapacity ?? 0)));
  const teamAIds = dummyIds.slice(0, Math.max(0, sideCapacity - 1));
  const teamBIds = dummyIds.slice(teamAIds.length, teamAIds.length + sideCapacity);
  const activePlayerCount = teamAIds.length + teamBIds.length;
  const teamAReserveIds = dummyIds.slice(activePlayerCount, activePlayerCount + benchCapacity);
  const teamBReserveIds = dummyIds.slice(
    activePlayerCount + teamAReserveIds.length,
    activePlayerCount + teamAReserveIds.length + benchCapacity,
  );
  const invitationPlans = [
    { side: "teamA", reserve: false, playerIds: teamAIds },
    { side: "teamB", reserve: false, playerIds: teamBIds },
    { side: "teamA", reserve: true, playerIds: teamAReserveIds },
    { side: "teamB", reserve: true, playerIds: teamBReserveIds },
  ];
  let tutorialInvite = null;
  if (inviteTutorial) {
    const tutorialPlan = [...invitationPlans].reverse().find((plan) => plan.playerIds.length);
    const targetPlayerId = tutorialPlan?.playerIds[tutorialPlan.playerIds.length - 1] ?? "";
    if (targetPlayerId) {
      tutorialPlan.playerIds = tutorialPlan.playerIds.slice(0, -1);
      tutorialInvite = {
        targetPlayerId,
        side: tutorialPlan.side,
        reserve: tutorialPlan.reserve,
      };
    }
  }
  invitationPlans.forEach((plan) => {
    if (!plan.playerIds.length) return;
    next = withPracticeActor(next, PRACTICE_SELF_ID, repository.inviteRecruitingPlayers, roomId, {
      joinMode: "player",
      side: plan.side,
      reserve: plan.reserve,
      playerIds: plan.playerIds,
    });
  });
  if (tutorialInvite) {
    next = acceptPracticeInvitations(next, roomId);
    next = {
      ...next,
      recruitingPosts: next.recruitingPosts.map((item) => (
        item.id === roomId
          ? {
              ...item,
              roomState: {
                ...(item.roomState ?? {}),
                practiceInviteTutorial: tutorialInvite,
              },
            }
          : item
      )),
    };
  }
  return { state: next, postId: roomId, error: "" };
}

export function acceptPracticeInvitations(state, postId) {
  const invitations = state.recruitingPosts
    .find((post) => post.id === postId)
    ?.roomState?.invitations
    ?.filter((invitation) => invitation.status === "pending") ?? [];
  return invitations.reduce(
    (next, invitation) => withPracticeActor(
      next,
      invitation.targetUserId,
      repository.acceptRecruitingInvitation,
      postId,
      invitation.id,
    ),
    state,
  );
}

export function confirmPracticeRecruitingRoom(state, postId) {
  const matchId = `${PRACTICE_ID_PREFIX}match-${Date.now().toString(36)}`;
  const next = withPracticeActor(
    state,
    PRACTICE_SELF_ID,
    repository.confirmRecruitingMatch,
    postId,
    { matchId },
  );
  return {
    state: next,
    matchId: next.matches.some((match) => match.id === matchId) ? matchId : "",
  };
}

export function completePracticeAttendance(state, matchId) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match) return state;
  const operatorId = match.refereeId || match.createdBy || PRACTICE_SELF_ID;
  let next = {
    ...state,
    matches: state.matches.map((item) => (
      item.id === matchId ? applyOperatorAttendance(item, operatorId) : item
    )),
  };
  ["teamA", "teamB"].forEach((sideName) => {
    const playerIds = [
      ...(match[sideName]?.players ?? []),
      ...getMatchReservePlayerIds(match, sideName),
    ];
    playerIds.forEach((playerId) => {
      next = withPracticeActor(next, operatorId, repository.checkInMatchPlayer, matchId, sideName, playerId);
    });
  });
  return next;
}

function makeSideStats(playerIds, score) {
  const count = Math.max(1, playerIds.length);
  const base = Math.floor(score / count);
  let extra = score % count;
  return Object.fromEntries(playerIds.map((playerId, index) => {
    const points = base + (extra > 0 ? 1 : 0);
    if (extra > 0) extra -= 1;
    return [playerId, {
      points,
      rebounds: 2 + (index % 3),
      assists: 1 + (index % 2),
      steals: index % 2,
      blocks: index % 3 === 0 ? 1 : 0,
      fouls: index % 2,
    }];
  }));
}

export function submitPracticeSampleResult(state, matchId) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match) return state;
  const operatorId = match.refereeId || match.createdBy || PRACTICE_SELF_ID;
  const scoreA = 21;
  const scoreB = 17;
  if (match.refereeId) {
    const endedState = nextMatchEnded(state, matchId);
    return withPracticeActor(endedState, operatorId, repository.submitMatchResult, matchId, {
      scoreA,
      scoreB,
      playerStats: {
        ...makeSideStats(match.teamA?.players ?? [], scoreA),
        ...makeSideStats(match.teamB?.players ?? [], scoreB),
      },
    });
  }

  if (match.endedAt) return state;
  let next = state;
  while (true) {
    const current = next.matches.find((item) => item.id === matchId);
    const currentScoreA = Number(current?.result?.scoreA ?? current?.teamA?.score ?? 0);
    const currentScoreB = Number(current?.result?.scoreB ?? current?.teamB?.score ?? 0);
    const deltaA = Math.min(3, Math.max(0, scoreA - currentScoreA));
    const deltaB = Math.min(3, Math.max(0, scoreB - currentScoreB));
    if (!deltaA && !deltaB) break;
    const updated = withPracticeActor(next, operatorId, repository.incrementMatchScore, matchId, deltaA, deltaB, {
      expectedRevisionA: Number(current?.result?.scoreRevisionA ?? 0),
      expectedRevisionB: Number(current?.result?.scoreRevisionB ?? 0),
    });
    if (updated === next) break;
    next = updated;
  }
  return nextMatchEnded(next, matchId);
}

function nextMatchEnded(state, matchId) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match || match.endedAt) return state;
  const operatorId = match.refereeId || match.createdBy || PRACTICE_SELF_ID;
  return withPracticeActor(state, operatorId, repository.endMatch, matchId);
}

export function approvePracticeDummyPlayers(state, matchId) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match?.endedAt || (match.refereeId && !match.result)) return state;
  const operatorId = match.refereeId || match.createdBy || PRACTICE_SELF_ID;
  return withPracticeActor(state, operatorId, repository.finalizeMatchByAuthority, matchId);
}

function settleClock(clock, nowMs) {
  if (clock.status !== "running") return { ...clock, serverNow: new Date(nowMs).toISOString() };
  const resumedAtMs = Date.parse(clock.lastResumedAt || "") || nowMs;
  const elapsedMs = Math.max(0, nowMs - resumedAtMs);
  const appliedMs = Math.min(elapsedMs, Math.max(0, Number(clock.periodRemainingMs || 0)));
  const periodRemainingMs = Math.max(0, Number(clock.periodRemainingMs || 0) - appliedMs);
  return {
    ...clock,
    status: periodRemainingMs === 0 ? "paused" : clock.status,
    serverNow: new Date(nowMs).toISOString(),
    lastResumedAt: periodRemainingMs === 0 ? null : new Date(nowMs).toISOString(),
    periodRemainingMs,
    shotRemainingMs: Number(clock.shotClockSeconds || 0) > 0
      ? Math.max(0, Number(clock.shotRemainingMs || 0) - appliedMs)
      : 0,
    activeElapsedMs: Number(clock.activeElapsedMs || 0) + appliedMs,
  };
}

export function createPracticeClockClient(
  getState,
  getActorId = () => PRACTICE_SELF_ID,
  onForcedMatchEnd = null,
  getNowMs = () => Date.now(),
) {
  const clocks = new Map();
  const getResponse = (matchId, clock) => {
    const state = getState();
    const match = state.matches.find((item) => item.id === matchId);
    const actorId = getActorId();
    const managerId = match?.refereeId || match?.createdBy || PRACTICE_SELF_ID;
    const canManage = actorId === managerId;
    const canControl = actorId === clock.controllerId;
    const clockUsed = Boolean(
      clock.startedWithinWindow
      && clock.endedExplicitly
      && Number(clock.activeElapsedMs || 0) >= Number(clock.minimumActiveMs || 0),
    );
    const activeIds = [...(match?.teamA?.players ?? []), ...(match?.teamB?.players ?? [])];
    const userById = Object.fromEntries(state.users.map((user) => [user.id, user]));
    return {
      ok: true,
      clock: {
        ...clock,
        matchEndedAt: match?.endedAt ?? null,
        canManage,
        canControl,
        clockUsed,
      },
      score: {
        a: Number(match?.result?.scoreA ?? match?.teamA?.score ?? 0),
        b: Number(match?.result?.scoreB ?? match?.teamB?.score ?? 0),
        updatedAt: match?.result?.submittedAt ?? null,
      },
      activePlayers: activeIds.map((playerId, index) => ({
        id: playerId,
        name: userById[playerId]?.name || "연습 선수",
        side: match?.teamA?.players?.includes(playerId) ? "teamA" : "teamB",
        slotOrder: index,
      })),
      attendanceQr: null,
    };
  };
  const getClock = (matchId) => {
    if (clocks.has(matchId)) return clocks.get(matchId);
    const state = getState();
    const match = state.matches.find((item) => item.id === matchId);
    if (!isPracticeEntity(match)) throw new Error("practice_match_required");
    const rules = normalizeMatchRules(match.rules, { mode: match.mode });
    const now = new Date(getNowMs());
    const periodMs = rules.periodMinutes * 60 * 1000;
    const clock = {
      matchId,
      status: "pending",
      serverNow: now.toISOString(),
      startDeadlineAt: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
      startedWithinWindow: false,
      clockUsed: false,
      currentPeriod: 1,
      expectedPeriodCount: rules.periodCount,
      overtimeCount: 0,
      periodRemainingMs: periodMs,
      shotClockSeconds: 0,
      shotRemainingMs: 0,
      activeElapsedMs: 0,
      minimumActiveMs: rules.periodCount * periodMs * 0.7,
      controllerId: match.teamA?.players?.[0] || PRACTICE_SELF_ID,
      lastResumedAt: null,
      clockEndedAt: null,
      endedExplicitly: false,
      matchEndedAt: null,
      breakStartedAt: null,
    };
    clocks.set(matchId, clock);
    return clock;
  };
  return async (matchId, action = "read", payload = {}) => {
    const nowMs = getNowMs();
    let clock = settleClock(getClock(matchId), nowMs);
    const state = getState();
    const match = state.matches.find((item) => item.id === matchId);
    const forceEndAtMs = clock.clockStartedAt
      ? Date.parse(clock.clockStartedAt) + 90 * 60 * 1000
      : Number.POSITIVE_INFINITY;
    if (!match?.endedAt && nowMs >= forceEndAtMs) {
      const forceEndAt = new Date(forceEndAtMs).toISOString();
      clock = {
        ...clock,
        status: "ended",
        lastResumedAt: null,
        clockEndedAt: clock.clockEndedAt || forceEndAt,
        endedExplicitly: false,
        forcedMatchEnd: true,
        forceEndAt,
        matchEndedAt: forceEndAt,
      };
      clocks.set(matchId, clock);
      await onForcedMatchEnd?.(matchId);
      return getResponse(matchId, clock);
    }
    if (match?.endedAt && clock.status !== "ended") {
      clock = {
        ...clock,
        status: "ended",
        lastResumedAt: null,
        clockEndedAt: clock.clockEndedAt || match.endedAt,
        endedExplicitly: false,
        matchEndedAt: match.endedAt,
      };
    }
    const rules = normalizeMatchRules(match.rules, { mode: match.mode });
    const periodMs = rules.periodMinutes * 60 * 1000;
    const actorId = getActorId();
    const managerId = match.refereeId || match.createdBy || PRACTICE_SELF_ID;
    const isManager = actorId === managerId;
    const isController = actorId === clock.controllerId;
    const actionAllowed = action === "read"
      || (action === "configure" && isManager && !clock.clockStartedAt)
      || (action === "transfer" && (isManager || isController))
      || (!["configure", "transfer"].includes(action) && isController);
    if (!actionAllowed) {
      const errorCode = action === "configure"
        ? "match_clock_configure_forbidden"
        : action === "transfer"
          ? "match_clock_transfer_forbidden"
          : "match_clock_start_forbidden";
      const error = new Error(errorCode);
      error.code = error.message;
      throw error;
    }
    if (["configure", "transfer"].includes(action) && payload.controllerId) {
      const activePlayerIds = [...(match.teamA?.players ?? []), ...(match.teamB?.players ?? [])];
      if (!activePlayerIds.includes(payload.controllerId)) {
        const error = new Error("match_clock_controller_must_be_active");
        error.code = error.message;
        throw error;
      }
    }
    if (action === "configure") {
      clock = {
        ...clock,
        controllerId: payload.controllerId || clock.controllerId,
        shotClockSeconds: Number(payload.shotClockSeconds || 0),
        shotRemainingMs: Number(payload.shotClockSeconds || 0) * 1000,
      };
    } else if (action === "start" || action === "resume") {
      const firstStart = !clock.clockStartedAt;
      clock = {
        ...clock,
        status: "running",
        startedWithinWindow: firstStart
          ? nowMs <= Date.parse(clock.startDeadlineAt || "")
          : clock.startedWithinWindow,
        clockStartedAt: clock.clockStartedAt || new Date(nowMs).toISOString(),
        lastResumedAt: new Date(nowMs).toISOString(),
      };
    } else if (action === "pause") {
      clock = { ...clock, status: "paused", lastResumedAt: null };
    } else if (action === "resetShot") {
      clock = { ...clock, shotRemainingMs: Number(clock.shotClockSeconds || 0) * 1000 };
    } else if (action === "endPeriod") {
      clock = {
        ...clock,
        status: "break",
        periodRemainingMs: 0,
        shotRemainingMs: 0,
        lastResumedAt: null,
        breakStartedAt: new Date(nowMs).toISOString(),
      };
    } else if (action === "startPeriod") {
      clock = {
        ...clock,
        status: "running",
        currentPeriod: Math.min(clock.expectedPeriodCount, clock.currentPeriod + 1),
        periodRemainingMs: periodMs,
        shotRemainingMs: Number(clock.shotClockSeconds || 0) * 1000,
        lastResumedAt: new Date(nowMs).toISOString(),
        breakStartedAt: null,
      };
    } else if (action === "startOvertime") {
      clock = {
        ...clock,
        status: "running",
        overtimeCount: clock.overtimeCount + 1,
        periodRemainingMs: rules.overtimeMinutes * 60 * 1000,
        shotRemainingMs: Number(clock.shotClockSeconds || 0) * 1000,
        lastResumedAt: new Date(nowMs).toISOString(),
        breakStartedAt: null,
      };
    } else if (action === "transfer") {
      clock = { ...clock, controllerId: payload.controllerId || clock.controllerId };
    } else if (action === "endClock") {
      clock = {
        ...clock,
        status: "ended",
        lastResumedAt: null,
        clockEndedAt: new Date(nowMs).toISOString(),
        endedExplicitly: true,
      };
    }
    clocks.set(matchId, clock);
    return getResponse(matchId, clock);
  };
}

export function getPracticeProgress(state, postId = "", matchId = "") {
  if (matchId) {
    const match = state.matches.find((item) => item.id === matchId);
    const phase = getMatchRoomPhase(match).phase;
    if (phase === "checkin") return { step: 3, label: "연습 선수 출석", phase };
    if (phase === "live") return { step: 4, label: "경기 진행", phase };
    if (["postgame", "dispute"].includes(phase)) return { step: 5, label: "기록 확인", phase };
    if (match?.status === "confirmed") return { step: 5, label: "연습 완료", phase: "completed" };
  }
  if (postId) {
    const post = state.recruitingPosts.find((item) => item.id === postId);
    const pendingCount = post?.roomState?.invitations
      ?.filter((invitation) => invitation.status === "pending")
      .length ?? 0;
    const lobby = getRecruitingLobby(post, state);
    const participantCount = getPickupParticipantIds(lobby).length;
    const participantCapacity = getPickupParticipantCapacity({
      sideCapacity: getRecruitingSideCapacity(post),
      benchCapacity: getRecruitingBenchCapacity(post),
    });
    const needsInvite = Boolean(post && participantCount < participantCapacity && pendingCount === 0);
    const tutorialInvite = post?.roomState?.practiceInviteTutorial ?? null;
    const inviteTarget = state.users.find((user) => user.id === tutorialInvite?.targetPlayerId);
    return {
      step: 2,
      label: needsInvite ? "빈 슬롯 초대" : pendingCount ? "초대 응답 대기" : "매치 확정",
      phase: "recruiting",
      pendingCount,
      needsInvite,
      participantCount,
      participantCapacity,
      inviteTargetName: inviteTarget?.name ?? "",
      inviteSide: tutorialInvite?.side ?? "",
      inviteReserve: Boolean(tutorialInvite?.reserve),
    };
  }
  return { step: 1, label: "연습방 만들기", phase: "create" };
}
