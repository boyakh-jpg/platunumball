import * as repository from "../data/repository.js";
import { createProfileShell } from "../data/profileMappers.js";
import { DEFAULT_SETTINGS, EMPTY_STATE } from "../data/repositoryDefaults.js";
import { getPracticeMatchAttendanceQrResponse } from "./matchAttendance.js";
import {
  applyOperatorAttendance,
  getMatchReservePlayerIds,
} from "./matchUtils.js";
import { PRACTICE_ID_PREFIX } from "./practiceMode.js";
import { makePracticeTeams } from "./practiceMatchTeams.js";

export const PRACTICE_SELF_ID = `${PRACTICE_ID_PREFIX}player-self`;
export { PRACTICE_TEAM_A_ID, PRACTICE_TEAM_B_ID } from "./practiceMatchTeams.js";

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
  "incrementMatchScore",
  "finalizeMatchByAuthority",
  "interestRecruitingPost",
  "inviteRecruitingPlayers",
  "inviteRecruitingReferee",
  "joinRecruitingSideParty",
  "kickRecruitingApplicant",
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
  "setRecruitingRoomTeam",
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
  const users = [
    self,
    ...PRACTICE_DUMMY_PROFILES.map((profile) => makePracticeProfile(profile, region)),
  ];
  return {
    ...EMPTY_STATE,
    currentUserId: PRACTICE_SELF_ID,
    users,
    teams: makePracticeTeams(users),
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
  if (actionName === "startMatch") {
    const match = state.matches.find((item) => item.id === args[0]);
    if (match?.rules?.qrAttendanceEnabled && !getPracticeMatchAttendanceQrResponse(match).startStatus.canStart) {
      return { state, applied: false, error: "attendance_pending" };
    }
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
    hostJoinMode: draft.hostJoinMode === "team" ? "team" : "player",
    teamOnly: draft.hostJoinMode === "team",
    teamId: draft.teamId || "",
    opponentTeamId: draft.opponentTeamId || "",
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
      qrAttendanceEnabled: true,
      ranked: false,
      official: false,
      ratingScale: 0,
    },
  };
  let next = withPracticeActor(state, PRACTICE_SELF_ID, repository.createRecruitingPost, safeDraft);
  const post = next.recruitingPosts.find((item) => item.id === roomId);
  if (!post) return { state, postId: "", error: "practice_room_create_failed" };
  if (post.teamOnly) return { state: next, postId: roomId, error: "" };

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

export function createPracticeMatchRecord(state, draft = {}) {
  const matchId = `${PRACTICE_ID_PREFIX}record-${Date.now().toString(36)}`;
  const safeDraft = {
    ...draft,
    id: matchId,
    recordType: "match_record",
    recordComposition: draft.recordComposition === "team" ? "team" : "individual",
    visibility: "private",
    ranked: false,
    official: false,
    preRegistered: false,
    ratingScale: 0,
    rules: {
      ...(draft.rules ?? {}),
      practiceMode: true,
      ranked: false,
      official: false,
      ratingScale: 0,
    },
  };
  const next = withPracticeActor(state, PRACTICE_SELF_ID, repository.createMatch, safeDraft);
  return {
    state: next,
    matchId: next.matches.some((match) => match.id === matchId) ? matchId : "",
    error: next.matches.some((match) => match.id === matchId) ? "" : "practice_record_create_failed",
  };
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
  const gameClockEnabled = match.rules?.gameClockEnabled !== false
    && match.rules?.gameClockEnabled !== "false";
  const scoreActorId = gameClockEnabled
    ? match.teamA?.players?.[0] || operatorId
    : operatorId;
  let next = state;
  while (true) {
    const current = next.matches.find((item) => item.id === matchId);
    const currentScoreA = Number(current?.result?.scoreA ?? current?.teamA?.score ?? 0);
    const currentScoreB = Number(current?.result?.scoreB ?? current?.teamB?.score ?? 0);
    const deltaA = Math.min(3, Math.max(0, scoreA - currentScoreA));
    const deltaB = Math.min(3, Math.max(0, scoreB - currentScoreB));
    if (!deltaA && !deltaB) break;
    const updated = withPracticeActor(next, scoreActorId, repository.incrementMatchScore, matchId, deltaA, deltaB, {
      expectedRevisionA: Number(current?.result?.scoreRevisionA ?? 0),
      expectedRevisionB: Number(current?.result?.scoreRevisionB ?? 0),
      clockController: gameClockEnabled,
    });
    const updatedMatch = updated.matches.find((item) => item.id === matchId);
    const updatedScoreA = Number(updatedMatch?.result?.scoreA ?? updatedMatch?.teamA?.score ?? 0);
    const updatedScoreB = Number(updatedMatch?.result?.scoreB ?? updatedMatch?.teamB?.score ?? 0);
    if (updatedScoreA === currentScoreA && updatedScoreB === currentScoreB) break;
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
  return withPracticeActor(
    state,
    operatorId,
    repository.finalizeMatchByAuthority,
    matchId,
    { disputesAcknowledged: true, now: Date.now() + 4 * 60 * 1000 },
  );
}

export { createPracticeClockClient } from "./practiceMatchClock.js";

export { getPracticeProgress } from "./practiceMatchProgress.js";
