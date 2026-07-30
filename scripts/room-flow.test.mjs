import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  APP_DATA_ORCHESTRATOR_SOURCE_PATHS,
  HOME_PAGE_SOURCE_PATHS,
  MATCHES_PAGE_SOURCE_PATHS,
  RECRUITING_PAGE_SOURCE_PATHS,
  RECRUITING_SYNC_SOURCE_PATHS,
  RECRUITING_STYLE_SOURCE_PATHS,
  readSourceGroupSync,
} from "./management-source-groups.mjs";
import { readCssTreeSync } from "./css-source-tree.mjs";
import {
  acceptRecruitingInvitation,
  confirmPickupSideAssignment,
  configureServerRatingAuthority,
  generatePickupSideAssignment,
  inviteRecruitingPlayers,
  startMatch,
  swapPickupMatchPlayers,
} from "../src/data/repository.js";
import { SERVER_RATING_AUTHORITY } from "../server/lib/ratingAuthority.js";
import {
  buildPickupTeamAssignment,
  getPickupOpenSlotPlacements,
  getPickupParticipantIds,
  getPickupParticipants,
  getPickupRerollState,
  getPickupTeamAssignmentPolicy,
  getPostgameRecordVerification,
  getRoomPhaseViewModel,
  isMatchPregameSlotManagementOpen,
  isMatchRecordParticipantSetupOpen,
} from "../src/lib/roomFlow.js";

const readPageSourceGroup = (paths) => readSourceGroupSync(
  (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8"),
  paths,
);
const readStyleSourceGroup = (paths) => paths
  .map((file) => readCssTreeSync(file))
  .join("\n");
import {
  createMatchListStore,
  getMatchEntityMap,
  getMatchListScope,
  getMatchSideLeaderId,
  isMatchListInitialLoading,
  MATCH_LIST_SCOPES,
  MATCH_LIST_STATUSES,
  selectMatchListMatches,
  updateMatchListScope,
} from "../src/lib/matchUtils.js";
import { getMatchConfigurationChangePatch, getMatchCreationPolicyPayload } from "../src/lib/matchCreationPolicies.js";
import { getRecruitingInvitationSenderName, getRecruitingLobby } from "../src/lib/recruiting.js";

configureServerRatingAuthority(SERVER_RATING_AUTHORITY);

test("match list scopes replace server result IDs without leaking other feeds", () => {
  const matches = [
    { id: "current-team-match" },
    { id: "stale-match-from-another-screen" },
  ];
  const entities = getMatchEntityMap(matches);
  const initialStore = createMatchListStore();
  const loadingStore = updateMatchListScope(initialStore, MATCH_LIST_SCOPES.TEAM, {
    status: MATCH_LIST_STATUSES.LOADING,
  });
  const readyStore = updateMatchListScope(loadingStore, MATCH_LIST_SCOPES.TEAM, {
    ids: ["current-team-match", "current-team-match"],
    status: MATCH_LIST_STATUSES.READY,
  });
  const refreshingStore = updateMatchListScope(readyStore, MATCH_LIST_SCOPES.TEAM, {
    status: MATCH_LIST_STATUSES.LOADING,
  });
  const failedStore = updateMatchListScope(refreshingStore, MATCH_LIST_SCOPES.TEAM, {
    status: MATCH_LIST_STATUSES.ERROR,
    error: "network_failed",
  });
  const emptyStore = updateMatchListScope(failedStore, MATCH_LIST_SCOPES.TEAM, {
    ids: [],
    status: MATCH_LIST_STATUSES.READY,
    error: "",
  });

  assert.deepEqual(
    selectMatchListMatches(entities, readyStore, MATCH_LIST_SCOPES.TEAM).map((match) => match.id),
    ["current-team-match"],
  );
  assert.equal(getMatchListScope(readyStore, MATCH_LIST_SCOPES.TEAM).status, MATCH_LIST_STATUSES.READY);
  assert.equal(isMatchListInitialLoading(getMatchListScope(loadingStore, MATCH_LIST_SCOPES.TEAM)), true);
  assert.equal(isMatchListInitialLoading(getMatchListScope(refreshingStore, MATCH_LIST_SCOPES.TEAM)), false);
  assert.deepEqual(selectMatchListMatches(entities, failedStore, MATCH_LIST_SCOPES.TEAM).map((match) => match.id), ["current-team-match"]);
  assert.deepEqual(selectMatchListMatches(entities, emptyStore, MATCH_LIST_SCOPES.TEAM), []);
  assert.deepEqual(selectMatchListMatches(entities, initialStore, MATCH_LIST_SCOPES.TEAM), []);
  assert.deepEqual(selectMatchListMatches({}, readyStore, MATCH_LIST_SCOPES.TEAM), []);
});

test("cancelled instant rooms stay visible for their calendar date", async () => {
  const { createServer } = await import("vite");
  const vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });

  try {
    const { matchesRecruitingScheduleDate, matchesScheduleRelation } = await vite.ssrLoadModule("/src/pages/Matches.jsx");
    const cancelledInstant = {
      status: "cancelled",
      timingType: "instant",
      scheduledAt: "즉시",
      createdAt: "2026-07-28T09:00:00.000Z",
    };
    const openInstant = { ...cancelledInstant, status: "open" };

    assert.equal(matchesRecruitingScheduleDate(cancelledInstant, "2026-07-28"), true);
    assert.equal(matchesRecruitingScheduleDate(cancelledInstant, "2026-07-27"), false);
    assert.equal(matchesRecruitingScheduleDate(openInstant, "2026-07-28"), false);
    assert.equal(matchesRecruitingScheduleDate(openInstant, ""), true);
    assert.equal(matchesScheduleRelation("invited", "all"), true);
    assert.equal(matchesScheduleRelation("invited", "invited"), true);
    assert.equal(matchesScheduleRelation("invited", "joined"), false);
  } finally {
    await vite.close();
  }
});

test("schedule, recruiting, and play lists refresh server data on entry and browser foreground", () => {
  const matchesSource = MATCHES_PAGE_SOURCE_PATHS
    .map((file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8"))
    .join("\n");
  const recruitingSource = readPageSourceGroup(RECRUITING_PAGE_SOURCE_PATHS);
  const recorderSource = readFileSync(new URL("../src/pages/Recorder.jsx", import.meta.url), "utf8");
  const appDataSource = readSourceGroupSync(
    (relativePath) => readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8"),
    APP_DATA_ORCHESTRATOR_SOURCE_PATHS,
  );

  assert.match(matchesSource, /loadMatchRecruitingSchedule\(\{ force: true \}\)/);
  assert.match(matchesSource, /window\.addEventListener\("focus", refreshWhenVisible\)/);
  assert.match(matchesSource, /document\.addEventListener\("visibilitychange", refreshWhenVisible\)/);
  assert.match(recruitingSource, /refreshRecruitingFromServer\(\{ force: true \}\)/);
  assert.match(recruitingSource, /window\.addEventListener\("focus", refreshWhenVisible\)/);
  assert.match(recruitingSource, /document\.addEventListener\("visibilitychange", refreshWhenVisible\)/);
  assert.match(recorderSource, /refreshPlayMatchesFromServer\(\{ force: true \}\)/);
  assert.match(recorderSource, /window\.addEventListener\("focus", refreshWhenVisible\)/);
  assert.match(recorderSource, /document\.addEventListener\("visibilitychange", refreshWhenVisible\)/);
  assert.doesNotMatch(recorderSource, /app\.playMatchesLoaded/);
  assert.match(appDataSource, /if \(matchRecruitingSchedulePromiseRef\.current\) return matchRecruitingSchedulePromiseRef\.current;/);
  assert.match(appDataSource, /if \(matchTeamSchedulePromiseRef\.current\) return matchTeamSchedulePromiseRef\.current;/);
  assert.match(appDataSource, /if \(playMatchesPromiseRef\.current\) return playMatchesPromiseRef\.current;/);
  assert.match(matchesSource, /panelMode:\s*"team",[\s\S]*?branchFilter:\s*"all",[\s\S]*?relationFilter:\s*"all",[\s\S]*?dateFilter:\s*""/);
  assert.match(appDataSource, /updateMatchListScope\(prev,\s*MATCH_LIST_SCOPES\.PERSONAL/);
  assert.match(appDataSource, /updateMatchListScope\(prev,\s*MATCH_LIST_SCOPES\.TEAM/);
  assert.match(appDataSource, /updateMatchListScope\(prev,\s*MATCH_LIST_SCOPES\.PLAY/);
  assert.match(matchesSource, /selectMatchListMatches\(matchesById,\s*app\.matchLists,\s*MATCH_LIST_SCOPES\.PERSONAL\)/);
  assert.match(matchesSource, /selectMatchListMatches\(matchesById,\s*app\.matchLists,\s*MATCH_LIST_SCOPES\.TEAM\)/);
  assert.match(recorderSource, /selectMatchListMatches\(app\.matchEntities,\s*app\.matchLists,\s*MATCH_LIST_SCOPES\.PLAY\)/);
  assert.doesNotMatch(matchesSource, /matchPagination\.(scheduleMatchIds|teamScheduleMatchIds|teamScheduleLoading)/);
  assert.doesNotMatch(recorderSource, /app\.state\.matches\s*\.filter/);
  assert.doesNotMatch(matchesSource, /if \(!success\) scheduleLoadRequestedRef\.current\.delete\(requestKey\)/);
});

test("team room hides completed selection and labels active and reserve slots once", () => {
  const recruitingSource = readPageSourceGroup(RECRUITING_PAGE_SOURCE_PATHS);
  const recruitingStyles = readStyleSourceGroup(RECRUITING_STYLE_SOURCE_PATHS);

  assert.match(recruitingSource, /&& \(!selectedRoomTeamAId \|\| !selectedRoomTeamBId\)/);
  assert.doesNotMatch(recruitingSource, /ROOM ONLY/);
  assert.doesNotMatch(recruitingSource, /팀 선택과 명단 관리는 이 공용 방 모달에서만 진행합니다/);
  assert.match(recruitingSource, /title=\{entry\.status === "ready" \? "출전" : "대기"\}/);
  assert.match(recruitingSource, /title="후보"\s+detail=\{getRoomSlotTeamName\(entry, teams\)\}/);
  assert.match(recruitingStyles, /\.arena-room-player-slot > span\.arena-room-slot-detail\s*\{[^}]*overflow-wrap:\s*anywhere;[^}]*white-space:\s*normal;/s);
});

test("경기 목적과 팀 구성은 독립 필드이고 레거시 matchIntent만 호환용으로 만든다", () => {
  const competitive = getMatchConfigurationChangePatch({}, { matchPurpose: "competitive", formationMode: "prearranged" });
  assert.equal(competitive.matchPurpose, "competitive");
  assert.equal(competitive.formationMode, "prearranged");
  assert.equal(competitive.matchIntent, "standard_competitive");
  const pickup = getMatchCreationPolicyPayload({ ...competitive, formationMode: "pickup" });
  assert.equal(pickup.matchPurpose, "competitive");
  assert.equal(pickup.formationMode, "pickup");
  assert.equal(pickup.ranked, true);
});

test("픽업 모집은 A/B 대신 통합 참가자 풀을 표시한다", () => {
  const view = getRoomPhaseViewModel({ post: { formationMode: "pickup" } });
  assert.equal(view.showParticipantPool, true);
  assert.equal(view.showVersusStage, false);
  assert.deepEqual(view.sectionOrder, ["participantPool"]);
  const lobby = { entries: [
    { id: "first", status: "ready", players: ["a"], reserves: ["b"] },
    { id: "second", status: "waiting", players: ["a", "c"] },
  ] };
  assert.deepEqual(getPickupParticipantIds(lobby), ["a", "b", "c"]);
  assert.deepEqual(getPickupParticipants(lobby).map(({ playerId, entry, reserve }) => ({
    playerId,
    entryId: entry.id,
    reserve,
  })), [
    { playerId: "a", entryId: "first", reserve: false },
    { playerId: "b", entryId: "first", reserve: true },
    { playerId: "c", entryId: "second", reserve: false },
  ]);
  assert.deepEqual(getPickupOpenSlotPlacements({
    entries: [
      { side: "teamA", players: ["host"], reserves: [] },
    ],
  }, { sideCapacity: 3, benchCapacity: 3 }), [
    { side: "teamB", reserve: false },
    { side: "teamA", reserve: false },
    { side: "teamB", reserve: false },
    { side: "teamA", reserve: false },
    { side: "teamB", reserve: false },
    { side: "teamA", reserve: true },
    { side: "teamB", reserve: true },
    { side: "teamA", reserve: true },
    { side: "teamB", reserve: true },
    { side: "teamA", reserve: true },
    { side: "teamB", reserve: true },
  ]);
});

test("5v5 픽업 초대는 수락 시 양쪽 임시 정원을 균형 사용하고 총 16명에서 마감한다", () => {
  const invitedPlayerIds = Array.from({ length: 18 }, (_, index) => `player-${index + 1}`);
  let state = {
    currentUserId: "host",
    users: ["host", ...invitedPlayerIds].map((id) => ({
      id,
      name: id,
      position: "G",
      ratings: { integrated: 1200 },
    })),
    teams: [],
    matches: [],
    notifications: [],
    settings: {},
    recruitingPosts: [{
      id: "pickup-invite-room",
      title: "5v5 픽업",
      status: "open",
      visibility: "private",
      playerId: "host",
      hostJoinMode: "player",
      hostSide: "teamA",
      formationMode: "pickup",
      matchIntent: "pickup",
      mode: "5v5",
      sideCapacity: 5,
      benchCapacity: 3,
      applicants: [],
      roomState: {
        ownerId: "host",
        invitations: [],
        partyReserves: {},
        pinnedReservePlayers: {},
        mmrLimitMode: "off",
      },
      rules: {
        formationMode: "pickup",
        matchIntent: "pickup",
        sideCapacity: 5,
        benchCapacity: 3,
      },
    }],
  };

  state = inviteRecruitingPlayers(state, "pickup-invite-room", {
    playerIds: invitedPlayerIds,
    side: "teamB",
    reserve: true,
  });
  const createdInvitations = state.recruitingPosts[0].roomState.invitations;
  assert.equal(createdInvitations.length, 18);
  assert.equal(createdInvitations.every((invitation) => invitation.side === null && invitation.reserve === false), true);

  state = {
    ...state,
    recruitingPosts: [{
      ...state.recruitingPosts[0],
      roomState: {
        ...state.recruitingPosts[0].roomState,
        invitations: createdInvitations.map((invitation) => ({ ...invitation, side: "teamB" })),
      },
    }],
  };
  for (const playerId of invitedPlayerIds.slice(0, 15)) {
    const invitation = state.recruitingPosts[0].roomState.invitations.find((item) => (
      item.targetUserId === playerId && item.status === "pending"
    ));
    state = acceptRecruitingInvitation({ ...state, currentUserId: playerId }, "pickup-invite-room", invitation.id);
  }

  const filledPost = state.recruitingPosts[0];
  const lobby = getRecruitingLobby(filledPost, state);
  const occupied = (side) => lobby.sides[side].filled + lobby.sides[side].reserveCandidates.length;
  assert.equal(occupied("teamA"), 8);
  assert.equal(occupied("teamB"), 8);
  assert.equal(
    filledPost.roomState.invitations.filter((invitation) => invitation.status === "expired").length,
    3,
  );
  assert.ok(filledPost.roomState.playerCapacityFilledAt);
});

test("운영 API의 공용 management RPC도 픽업 초대와 수락에서 저장된 사이드를 무시한다", () => {
  const migrationSource = readFileSync(
    new URL("../supabase/migrations/20260729103000_balance_pickup_management_acceptance.sql", import.meta.url),
    "utf8",
  );
  assert.match(migrationSource, /rankball_recruiting_management_action_unguarded\(text,jsonb\)/);
  assert.match(migrationSource, /safe_side := null;[\s\S]*?reserve := false;/);
  assert.match(migrationSource, /rankball_recruiting_pickup_best_side\(safe_post_id\)/);
  assert.match(migrationSource, /formationMode[\s\S]*?matchIntent[\s\S]*?pickup/);
});

test("정원 마감은 남은 선수 초대를 원자적으로 만료하고 즉시 안내한다", () => {
  const migrationSource = readFileSync(
    new URL("../supabase/migrations/20260729110000_close_full_recruiting_invitations.sql", import.meta.url),
    "utf8",
  );
  const appDataSource = readSourceGroupSync(
    (relativePath) => readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8"),
    APP_DATA_ORCHESTRATOR_SOURCE_PATHS,
  );
  const serverSource = readSourceGroupSync(
    (relativePath) => readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8"),
    RECRUITING_SYNC_SOURCE_PATHS,
  );

  assert.match(migrationSource, /rankball_recruiting_expire_player_invitations_if_full/);
  assert.match(migrationSource, /\(invitation\.value::jsonb\)->>'role' <> 'referee'/);
  assert.match(migrationSource, /'status', 'expired'/);
  assert.match(migrationSource, /recruiting_player_capacity_full/);
  assert.match(migrationSource, /'ok', false/);
  assert.match(appDataSource, /result\?\.invitationExpired[\s\S]*?방이 마감됐습니다/);
  assert.match(serverSource, /invitationExpired \? false : true/);
});

test("초대 처리 항목은 초대한 참가자 이름을 표시한다", () => {
  const state = { users: [{ id: "inviter", name: "초대한 사람" }] };
  assert.equal(getRecruitingInvitationSenderName(state, { fromUserId: "inviter" }), "초대한 사람");
  assert.equal(getRecruitingInvitationSenderName(state, { fromUserId: "missing" }), "방 참가자");

  const homeSource = readPageSourceGroup(HOME_PAGE_SOURCE_PATHS);
  const notificationSource = readFileSync(new URL("../src/pages/Notifications.jsx", import.meta.url), "utf8");
  assert.match(homeSource, /senderName}님이 초대/);
  assert.match(notificationSource, /senderName}님이 초대/);
});

test("픽업 체크인은 배정 확정 전 A/B 작업대를 표시한다", () => {
  const match = { status: "agreed", timingType: "instant", formationMode: "pickup", rules: {} };
  const view = getRoomPhaseViewModel({ match });
  assert.equal(view.mode, "pickup_assignment");
  assert.equal(view.showVersusStage, true);
  assert.equal(view.assignmentConfirmed, false);
});

test("슬롯 관리는 경기 시작 전까지만 열린다", () => {
  const pregame = { status: "agreed", timingType: "instant" };
  assert.equal(isMatchPregameSlotManagementOpen(pregame), true);
  assert.equal(isMatchPregameSlotManagementOpen({ ...pregame, startedAt: "2026-07-25T10:00:00.000Z" }), false);
  assert.equal(isMatchPregameSlotManagementOpen({
    ...pregame,
    startedAt: "2026-07-25T10:00:00.000Z",
    endedAt: "2026-07-25T11:00:00.000Z",
  }), false);
  assert.equal(isMatchPregameSlotManagementOpen({
    ...pregame,
    rules: { recordType: "match_record" },
    startedAt: "2026-07-25T10:00:00.000Z",
    endedAt: "2026-07-25T11:00:00.000Z",
  }), false);
});

test("사후 경기기록방 출전자 확인은 명단 확정 전까지만 열린다", () => {
  const recordRoom = {
    status: "agreed",
    rules: { recordType: "match_record", recordSetupReady: false },
    startedAt: "2026-07-25T10:00:00.000Z",
    endedAt: "2026-07-25T11:00:00.000Z",
  };
  assert.equal(isMatchRecordParticipantSetupOpen(recordRoom), true);
  assert.equal(isMatchRecordParticipantSetupOpen({
    ...recordRoom,
    rules: { ...recordRoom.rules, recordSetupReady: true },
  }), false);
  assert.equal(isMatchRecordParticipantSetupOpen({ ...recordRoom, result: { scoreA: 21, scoreB: 18 } }), false);
});

test("pickup random and MMR modes create complete deterministic drafts", () => {
  const playerIds = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"];
  const users = playerIds.map((id, index) => ({
    id,
    ratings: { integrated: 900 + index * 100 },
  }));
  const randomFirst = buildPickupTeamAssignment({
    playerIds,
    users,
    sideCapacity: 3,
    benchCapacity: 1,
    mode: "random",
    seed: "room:1",
  });
  const randomSecond = buildPickupTeamAssignment({
    playerIds,
    users,
    sideCapacity: 3,
    benchCapacity: 1,
    mode: "random",
    seed: "room:1",
  });
  assert.deepEqual(randomFirst, randomSecond);
  assert.equal(randomFirst.teamA.active.length, 3);
  assert.equal(randomFirst.teamB.active.length, 3);
  assert.equal(randomFirst.teamA.reserve.length, 1);
  assert.equal(randomFirst.teamB.reserve.length, 1);

  const hostAnchored = buildPickupTeamAssignment({
    playerIds: ["host", "p2", "p3", "p4"],
    users: [
      { id: "host", ratings: { integrated: 1000 } },
      { id: "p2", ratings: { integrated: 1050 } },
      { id: "p3", ratings: { integrated: 1100 } },
      { id: "p4", ratings: { integrated: 1150 } },
    ],
    sideCapacity: 2,
    benchCapacity: 0,
    mode: "random",
    seed: "seed:0",
    hostPlayerId: "host",
  });
  assert.deepEqual(hostAnchored.teamA.active, ["p2", "host"]);
  assert.deepEqual(hostAnchored.teamB.active, ["p4", "p3"]);

  const mmrHostAnchored = buildPickupTeamAssignment({
    playerIds: ["host", "p2", "p3", "p4", "p5", "p6"],
    users: ["host", "p2", "p3", "p4", "p5", "p6"].map((id, index) => ({
      id,
      ratings: { integrated: 800 + index * 170 },
    })),
    sideCapacity: 3,
    benchCapacity: 0,
    mode: "mmr_balanced",
    hostPlayerId: "host",
  });
  assert.equal(mmrHostAnchored.teamA.active.includes("host"), true);
  assert.equal(mmrHostAnchored.teamB.active.includes("host"), false);

  const balanced = buildPickupTeamAssignment({
    playerIds: playerIds.slice(0, 6),
    users,
    sideCapacity: 3,
    benchCapacity: 0,
    mode: "mmr_balanced",
    seed: "room:2",
  });
  const teamATotal = [...balanced.teamA.active, ...balanced.teamA.reserve]
    .reduce((sum, id) => sum + users.find((user) => user.id === id).ratings.integrated, 0);
  const teamBTotal = [...balanced.teamB.active, ...balanced.teamB.reserve]
    .reduce((sum, id) => sum + users.find((user) => user.id === id).ratings.integrated, 0);
  assert.equal(balanced.teamA.active.length, 3);
  assert.equal(balanced.teamB.active.length, 3);
  assert.ok(Math.abs(teamATotal - teamBTotal) <= 100);
});

test("pickup assignment uses checked-in players and limits paid rerolls to two distinct users", () => {
  const users = ["host", "p2", "p3", "p4", "absent1", "absent2"].map((id, index) => ({
    id,
    name: id,
    trustScore: 10,
    ratings: { integrated: 1000 + index * 50 },
  }));
  const match = {
    id: "pickup-attendance",
    title: "2v2 경쟁 픽업",
    createdBy: "host",
    mode: "2v2",
    status: "agreed",
    timingType: "instant",
    ranked: true,
    formationMode: "pickup",
    matchIntent: "pickup",
    teamA: { players: ["host", "p2"], teamId: "old-a", playerTeams: {} },
    teamB: { players: ["p3", "p4"], teamId: "old-b", playerTeams: {} },
    reservePlayers: { teamA: ["absent1"], teamB: ["absent2"] },
    attendance: { teamA: ["host", "p2"], teamB: ["p3", "p4"] },
    agreements: { teamA: ["host", "p2"], teamB: ["p3", "p4"] },
    rules: {
      formationMode: "pickup",
      matchIntent: "pickup",
      sideCapacity: 2,
      benchCapacity: 1,
      recruitingPostId: "pickup-post",
    },
  };
  const initialState = {
    currentUserId: "host",
    users,
    teams: [],
    matches: [match],
    recruitingPosts: [{ id: "pickup-post", roomState: { chatMessages: [] } }],
    notifications: [],
    settings: {},
  };

  const generated = generatePickupSideAssignment(initialState, match.id, "random");
  const generatedMatch = generated.matches[0];
  assert.equal(getPickupTeamAssignmentPolicy(generatedMatch).label, "완전 랜덤 배치");
  assert.equal(generatedMatch.rules.ratingScale, 1);
  assert.deepEqual(
    [...generatedMatch.teamA.players, ...generatedMatch.teamB.players].sort(),
    ["host", "p2", "p3", "p4"],
  );
  assert.equal(generatedMatch.teamA.players.includes("host"), true);
  assert.deepEqual(generatedMatch.reservePlayers, { teamA: [], teamB: [] });
  assert.equal(generated.users.find((user) => user.id === "host").trustScore, 10);

  const firstReroll = generatePickupSideAssignment({ ...generated, currentUserId: "p2" }, match.id, "random");
  assert.equal(getPickupRerollState(firstReroll.matches[0], "p2").count, 1);
  assert.equal(getPickupRerollState(firstReroll.matches[0], "p2").usedByCurrentUser, true);
  assert.equal(firstReroll.users.find((user) => user.id === "p2").trustScore, 9);
  assert.match(firstReroll.recruitingPosts[0].roomState.chatMessages[0].body, /신뢰도 1점/);

  const duplicateReroll = generatePickupSideAssignment(firstReroll, match.id, "random");
  assert.equal(duplicateReroll.matches[0].rules.pickupRerollCount, 1);

  const secondReroll = generatePickupSideAssignment({ ...firstReroll, currentUserId: "p3" }, match.id, "random");
  assert.equal(getPickupRerollState(secondReroll.matches[0], "p3").count, 2);
  assert.equal(secondReroll.users.find((user) => user.id === "p3").trustScore, 9);
  const blockedThird = generatePickupSideAssignment({ ...secondReroll, currentUserId: "p4" }, match.id, "random");
  assert.equal(blockedThird.matches[0].rules.pickupRerollCount, 2);
});

test("픽업 방장 또는 심판은 출석 후 두 참가자의 A/B·출전·대기 자리를 교환하고 확정한다", () => {
  const users = ["host", "a2", "b1", "b2", "ra", "rb", "ref"].map((id) => ({
    id,
    name: id,
    trustScore: id === "ref" ? 100 : 90,
    officialReferee: id === "ref",
  }));
  const match = {
    id: "pickup-match",
    title: "2v2 픽업",
    createdBy: "host",
    mode: "2v2",
    status: "agreed",
    timingType: "instant",
    formationMode: "pickup",
    matchIntent: "pickup",
    teamA: { name: "이전 팀 A", teamId: "legacy-a", playerTeams: { host: "legacy-a" }, players: ["host", "a2"] },
    teamB: { name: "이전 팀 B", teamId: "legacy-b", playerTeams: { b1: "legacy-b" }, players: ["b1", "b2"] },
    reservePlayers: { teamA: ["ra"], teamB: ["rb"] },
    attendance: { teamA: ["host", "a2", "ra"], teamB: ["b1", "b2", "rb"] },
    agreements: { teamA: ["host", "a2", "ra"], teamB: ["b1", "b2", "rb"] },
    approvals: { teamA: [], teamB: [] },
    parties: [{ teamId: "legacy-a", players: ["host", "a2"] }],
    rules: {
      formationMode: "pickup",
      matchIntent: "pickup",
      sideCapacity: 2,
      sideAssignmentStatus: "pending",
    },
  };
  const state = { currentUserId: "host", users, teams: [], matches: [match], notifications: [], settings: {} };
  const pendingConfirm = confirmPickupSideAssignment(state, match.id, { rotationMode: "manual" });
  assert.equal(pendingConfirm.matches[0].rules.sideAssignmentStatus, "pending");
  const draftMatch = {
    ...match,
    rules: {
      ...match.rules,
      pickupTeamAssignmentMode: "manual",
      sideAssignmentStatus: "draft",
      sideAssignmentRevision: 1,
    },
  };
  const draftState = { ...state, matches: [draftMatch] };

  assert.equal(startMatch(draftState, match.id).matches[0].startedAt, undefined);
  const deniedSwap = swapPickupMatchPlayers({ ...draftState, currentUserId: "a2" }, match.id, "host", "b1");
  assert.equal(deniedSwap.matches[0], draftMatch);
  const deniedReserveSwap = swapPickupMatchPlayers({ ...draftState, currentUserId: "ra" }, match.id, "host", "b1");
  assert.equal(deniedReserveSwap.matches[0], draftMatch);
  const refereeMatch = { ...draftMatch, refereeId: "ref", refereeTrustMin: 90 };
  const refereeSwap = swapPickupMatchPlayers({
    ...draftState,
    currentUserId: "ref",
    matches: [refereeMatch],
  }, match.id, "host", "b1");
  assert.deepEqual(refereeSwap.matches[0].teamA.players, ["b1", "a2"]);

  const activeSwap = swapPickupMatchPlayers(draftState, match.id, "host", "b1");
  assert.deepEqual(activeSwap.matches[0].teamA.players, ["b1", "a2"]);
  assert.deepEqual(activeSwap.matches[0].teamB.players, ["host", "b2"]);
  assert.deepEqual(activeSwap.matches[0].attendance, {
    teamA: ["a2", "ra", "b1"],
    teamB: ["b2", "rb", "host"],
  });
  assert.equal(activeSwap.matches[0].teamA.teamId, null);
  assert.equal(activeSwap.matches[0].teamB.teamId, null);
  assert.deepEqual(activeSwap.matches[0].parties, []);

  const reserveSwap = swapPickupMatchPlayers(activeSwap, match.id, "a2", "rb");
  assert.deepEqual(reserveSwap.matches[0].teamA.players, ["b1", "rb"]);
  assert.deepEqual(reserveSwap.matches[0].reservePlayers, { teamA: ["ra"], teamB: ["a2"] });

  const confirmed = confirmPickupSideAssignment(reserveSwap, match.id, { rotationMode: "manual" });
  assert.equal(confirmed.matches[0].rules.sideAssignmentStatus, "confirmed");
  const started = startMatch(confirmed, match.id);
  assert.ok(started.matches[0].startedAt);
});

test("사후 기록은 2/3 확인 전에는 부분 상태이고 24시간 뒤 미달이면 확인 부족이다", () => {
  const record = {
    teamA: { players: ["a", "b"] },
    teamB: { players: ["c", "d"] },
    result: { submittedAt: "2026-07-26T00:00:00.000Z" },
    rules: { participantAcceptedIds: ["a", "b"] },
    approvals: { teamA: ["a", "b"], teamB: [] },
  };
  const status = getPostgameRecordVerification(record, { now: "2026-07-26T00:10:00.000Z" });
  assert.equal(status.verificationStatus, "partial");
  assert.equal(status.canConfirmFully, false);
  assert.deepEqual(status.unconfirmedIds, ["c", "d"]);
  const expired = getPostgameRecordVerification(record, { now: "2026-07-27T00:00:00.000Z" });
  assert.equal(expired.verificationStatus, "insufficient");
  assert.equal(expired.canAutoFinalize, false);
  assert.deepEqual(expired.unconfirmedIds, ["c", "d"]);
});

test("경기방은 축약 목록 캐시를 버리고 상세 경기와 정확한 정원 명단을 사용한다", () => {
  const controllerSource = readFileSync(new URL("../src/components/recruiting/useRecruitingRoomController.js", import.meta.url), "utf8");
  const roomManagementSource = readFileSync(new URL("../src/components/recruiting/RoomManagementPanels.jsx", import.meta.url), "utf8");

  assert.match(controllerSource, /loadDirectory\?\.\(\{ force: true, kind: "teams", teamId, includeTeamMemberProfiles: true \}\)/);
  assert.match(controllerSource, /loadMatchDetailRef\.current\?\.\(sourceMatch\.id\)/);
  assert.match(roomManagementSource, /disabled=\{saving \|\| !rosterChanged \|\| activeIds\.length !== capacity\}/);
});

test("픽업 팀 나누기 작업판은 공용 모달 안에서 전용 반응형 grid를 사용한다", () => {
  const recruitingSource = readPageSourceGroup(RECRUITING_PAGE_SOURCE_PATHS);
  const roomManagementSource = readFileSync(new URL("../src/components/recruiting/RoomManagementPanels.jsx", import.meta.url), "utf8");
  const recruitingStyles = readStyleSourceGroup(RECRUITING_STYLE_SOURCE_PATHS);

  assert.match(roomManagementSource, /arena-host-kick-panel\$\{pickupAssignmentMode \? " is-pickup-assignment" : ""\}/);
  assert.match(recruitingStyles, /\.arena-host-kick-panel\.is-pickup-assignment \.arena-host-kick-list\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,/s);
  assert.match(recruitingStyles, /\.pickup-rotation-panel \.ui-status-strip\s*\{[^}]*min-height:\s*var\(--ui-button-height\);/s);
  assert.match(recruitingStyles, /\.pickup-rotation-panel \.arena-room-edit-actions > \.button\s*\{[^}]*min-height:\s*var\(--ui-button-height\);/s);
  assert.match(recruitingStyles, /\.arena-lobby-modal \.arena-lobby-actions > div\s*\{[^}]*min-height:\s*var\(--ui-button-height\);/s);
  assert.match(recruitingStyles, /\.arena-host-kick-panel\.is-pickup-assignment \.arena-host-kick-actions\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s);
  assert.match(recruitingStyles, /\.pickup-rotation-panel \.arena-room-edit-actions\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,/s);
  assert.match(recruitingSource, /sideLeader:\s*\{\s*tone:\s*"captain",\s*label:\s*"사이드장"\s*\}/);
  assert.match(recruitingSource, /const slotTrackCount = Math\.max\(1,\s*Number\(side\.capacity\) \|\| activeSlots\.length \|\| 1\)/);
  assert.match(recruitingSource, /displayedSideLeaderId = \([\s\S]*playerId === hostPlayerId[\s\S]*\) \? "" : sideLeaderId/);
  assert.match(recruitingSource, /showCaptainBadge:\s*!sourceMatch && showCaptainBadge/);
  assert.equal(getMatchSideLeaderId({
    createdBy: "host",
    teamA: { players: ["other", "host"] },
    reservePlayers: { teamA: [] },
    parties: [],
  }, [], "teamA"), "host");
  assert.doesNotMatch(recruitingSource, /selfRow \? <span className="form-chip">본인<\/span>/);
});

test("확정 픽업 방모달은 실제 A/B 출전·후보 명단을 그대로 표시한다", async () => {
  const { createServer } = await import("vite");
  const vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });

  try {
    const { getMatchRoomPost } = await vite.ssrLoadModule("/src/pages/Matches.jsx");
    const userIds = ["host", "a1", "a2", "a3", "b1", "b2", "b3", "ra", "rb"];
    const users = userIds.map((id) => ({ id, name: id }));
    const sourcePost = {
      id: "pickup-room-post",
      title: "3v3 픽업",
      playerId: "host",
      ownerId: "host",
      hostSide: "teamA",
      hostJoinMode: "player",
      sideCapacity: 3,
      benchCapacity: 1,
      formationMode: "pickup",
      matchIntent: "pickup",
      applicants: [],
      roomState: { ownerId: "host", hostReserve: false },
    };
    const match = {
      id: "pickup-room-match",
      recruitingPostId: sourcePost.id,
      title: sourcePost.title,
      createdBy: "host",
      mode: "3v3",
      status: "agreed",
      formationMode: "pickup",
      matchIntent: "pickup",
      teamA: { players: ["a1", "a2", "a3"], teamId: null },
      teamB: { players: ["b1", "host", "b2"], teamId: null },
      reservePlayers: { teamA: ["ra"], teamB: ["rb"] },
      parties: [{ side: "teamA", players: ["host", "a1"] }],
      rules: {
        formationMode: "pickup",
        matchIntent: "pickup",
        sideCapacity: 3,
        benchCapacity: 1,
        sideAssignmentStatus: "confirmed",
        sideAssignmentRevision: 1,
      },
      createdAt: "2026-07-25T00:00:00.000Z",
    };
    const state = {
      currentUserId: "host",
      users,
      teams: [],
      matches: [match],
      recruitingPosts: [sourcePost],
      settings: {},
    };

    const roomPost = getMatchRoomPost(match, state);
    const lobby = getRecruitingLobby(roomPost, state);
    assert.equal(roomPost.hostSide, "teamB");
    assert.equal(roomPost.roomState.hostReserve, false);
    assert.deepEqual([...lobby.sides.teamA.projectedPlayers].sort(), ["a1", "a2", "a3"]);
    assert.deepEqual([...lobby.sides.teamB.projectedPlayers].sort(), ["b1", "b2", "host"]);
    assert.equal(lobby.sides.teamA.projectedPlayers.includes("host"), false);

    const reserveMatch = {
      ...match,
      teamB: { players: ["b1", "b2", "b3"], teamId: null },
      reservePlayers: { teamA: ["ra"], teamB: ["host"] },
    };
    const reserveState = { ...state, matches: [reserveMatch] };
    const reserveRoomPost = getMatchRoomPost(reserveMatch, reserveState);
    const reserveLobby = getRecruitingLobby(reserveRoomPost, reserveState);
    assert.equal(reserveRoomPost.hostSide, "teamB");
    assert.equal(reserveRoomPost.roomState.hostReserve, true);
    assert.deepEqual([...reserveLobby.sides.teamB.projectedPlayers].sort(), ["b1", "b2", "b3"]);
    assert.equal(
      reserveLobby.sides.teamB.reserveCandidates.some((candidate) => candidate.playerId === "host"),
      true,
    );

    const teamHostMatch = {
      ...match,
      formationMode: "prearranged",
      matchIntent: "standard_competitive",
      teamA: { players: ["a1", "a2", "a3"], teamId: "team-a" },
      teamB: { players: ["b1", "b2", "b3"], teamId: "team-b" },
      reservePlayers: { teamA: ["host"], teamB: ["rb"] },
      parties: [],
      rules: {
        ...match.rules,
        formationMode: "prearranged",
        matchIntent: "standard_competitive",
        sideAssignmentStatus: "confirmed",
      },
    };
    const teamHostState = {
      ...state,
      matches: [teamHostMatch],
      teams: [
        { id: "team-a", members: ["a1", "a2", "a3"].map((userId) => ({ userId, role: "member" })) },
        { id: "team-b", members: ["b1", "b2", "b3", "rb"].map((userId) => ({ userId, role: "member" })) },
      ],
    };
    const teamHostRoomPost = getMatchRoomPost(teamHostMatch, teamHostState);
    const teamHostLobby = getRecruitingLobby(teamHostRoomPost, teamHostState);
    assert.equal(teamHostRoomPost.roomState.matchRosterProjection, true);
    assert.equal(teamHostRoomPost.roomState.hostReserve, true);
    assert.deepEqual([...teamHostLobby.sides.teamA.projectedPlayers].sort(), ["a1", "a2", "a3"]);
    assert.equal(
      teamHostLobby.sides.teamA.reserveCandidates.some((candidate) => candidate.playerId === "host"),
      true,
    );
  } finally {
    await vite.close();
  }
});
