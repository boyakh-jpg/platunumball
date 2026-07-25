import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getRemoteAppSettings } from "../src/data/profileMappers.js";
import { DEFAULT_SETTINGS } from "../src/data/repositoryDefaults.js";
import { isHomeGuideCardVisible } from "../src/data/settingsMappers.js";
import {
  PRACTICE_SELF_ID,
  acceptPracticeInvitations,
  approvePracticeDummyPlayers,
  completePracticeAttendance,
  confirmPracticeRecruitingRoom,
  createPracticeClockClient,
  createPracticeRecruitingRoom,
  createPracticeState,
  runPracticeReducer,
  submitPracticeSampleResult,
} from "../src/lib/practiceMatch.js";
import { getMatchReservePlayerIds } from "../src/lib/matchUtils.js";
import { getRegisteredCourts } from "../src/lib/courts.js";
import {
  PRACTICE_LOCAL_ONLY_ERROR,
  hasPracticeMutationPayload,
  isPracticeEntity,
} from "../src/lib/practiceMode.js";

function createStartedPracticeMatch(rules = {}, options = {}) {
  let state = createPracticeState({}, { name: "테스터" });
  const referee = options.referee
    ? state.users.find((user) => user.officialReferee === true)
    : null;
  const created = createPracticeRecruitingRoom(state, {
    title: "시계 연습",
    mode: "3v3",
    sideCapacity: 3,
    refereeWanted: Boolean(referee),
    refereeId: referee?.id || "",
    rules: {
      gameClockEnabled: true,
      periodCount: 1,
      periodMinutes: 3,
      ...rules,
    },
  });
  state = acceptPracticeInvitations(created.state, created.postId);
  const confirmed = confirmPracticeRecruitingRoom(state, created.postId);
  state = completePracticeAttendance(confirmed.state, confirmed.matchId);
  const managerId = referee?.id || PRACTICE_SELF_ID;
  state = runPracticeReducer(state, "startMatch", [confirmed.matchId], managerId).state;
  return { state, matchId: confirmed.matchId, referee };
}

test("홈 사용 설명 카드는 기본 표시이며 false 설정을 서버 mapper가 보존한다", () => {
  assert.equal(DEFAULT_SETTINGS.showHomeGuideCard, true);
  assert.equal(isHomeGuideCardVisible({}), true);
  assert.equal(isHomeGuideCardVisible({ showHomeGuideCard: false }), false);
  assert.deepEqual(
    getRemoteAppSettings({ app_settings: { showHomeGuideCard: false } }),
    { showHomeGuideCard: false },
  );
});

test("practice payload는 실서버 mutation 대상으로 사용할 수 없다", () => {
  assert.equal(hasPracticeMutationPayload({ matchId: "practice-match-1" }), true);
  assert.equal(hasPracticeMutationPayload({ operation: { draft: { practiceMode: true } } }), true);
  assert.equal(hasPracticeMutationPayload({ matchId: "match-1", title: "practice game" }), false);
  assert.equal(isPracticeEntity({ id: "practice-room-1" }), true);
  assert.equal(PRACTICE_LOCAL_ONLY_ERROR, "practice_mode_is_local_only");
});

test("연습 경기 전체 흐름은 더미 state 안에서만 진행되고 rating과 신뢰를 바꾸지 않는다", async () => {
  const realState = {
    settings: {
      theme: "light",
      approvedCourts: [{ id: "court-1", name: "실제 구장", region: "서울", status: "approved" }],
    },
  };
  const realStateSnapshot = JSON.stringify(realState);
  let state = createPracticeState(realState, {
    id: "real-user",
    name: "테스터",
    region: "서울",
    position: "PG",
    ratings: { integrated: 1234 },
  });
  const playerSnapshot = JSON.stringify(
    state.users.map(({ id, ratings, trustScore }) => ({ id, ratings, trustScore })),
  );

  assert.ok(state.users.every((user) => user.id.startsWith("practice-")));
  assert.equal(state.users.some((user) => user.id === "real-user"), false);
  assert.equal(typeof state.users[1].ratings.modes["3v3"], "number");
  assert.equal(getRegisteredCourts(state).length, 1);

  const created = createPracticeRecruitingRoom(state, {
    title: "연습 3v3",
    mode: "3v3",
    sideCapacity: 3,
    benchCapacity: 0,
    matchPurpose: "friendly",
    formationMode: "prearranged",
    rules: {
      matchPurpose: "friendly",
      formationMode: "prearranged",
      gameClockEnabled: true,
      periodCount: 1,
      periodMinutes: 3,
    },
  });
  state = created.state;
  const post = state.recruitingPosts.find((item) => item.id === created.postId);
  assert.ok(created.postId.startsWith("practice-"));
  assert.equal(post.roomState.invitations.length, 5);
  assert.equal(post.ranked, false);
  assert.equal(post.practiceMode, true);

  state = acceptPracticeInvitations(state, created.postId);
  const confirmed = confirmPracticeRecruitingRoom(state, created.postId);
  state = confirmed.state;
  assert.ok(confirmed.matchId.startsWith("practice-"));
  assert.equal(state.matches[0].practiceMode, true);
  assert.equal(state.matches[0].ranked, false);

  state = completePracticeAttendance(state, confirmed.matchId);
  const readyMatch = state.matches[0];
  assert.ok(
    [...readyMatch.teamA.players, ...readyMatch.teamB.players].every((playerId) => (
      readyMatch.attendance.teamA.includes(playerId) || readyMatch.attendance.teamB.includes(playerId)
    )),
  );
  state = runPracticeReducer(state, "startMatch", [confirmed.matchId]).state;
  assert.ok(state.matches[0].startedAt);

  const stateRef = { current: state };
  const clockActorRef = { current: PRACTICE_SELF_ID };
  const clockClient = createPracticeClockClient(
    () => stateRef.current,
    () => clockActorRef.current,
  );
  const initialClock = await clockClient(confirmed.matchId, "read");
  assert.equal(initialClock.clock.status, "pending");
  assert.equal(initialClock.clock.canControl, true);
  await clockClient(confirmed.matchId, "configure", {
    controllerId: PRACTICE_SELF_ID,
    shotClockSeconds: 30,
  });
  const runningClock = await clockClient(confirmed.matchId, "start");
  assert.equal(runningClock.clock.status, "running");
  assert.equal(runningClock.clock.shotClockSeconds, 30);
  assert.equal(runningClock.clock.clockUsed, false);
  const nextControllerId = runningClock.activePlayers.find((player) => player.id !== PRACTICE_SELF_ID)?.id;
  const transferredClock = await clockClient(confirmed.matchId, "transfer", { controllerId: nextControllerId });
  assert.equal(transferredClock.clock.canControl, false);
  await assert.rejects(
    clockClient(confirmed.matchId, "pause"),
    /match_clock_start_forbidden/,
  );
  clockActorRef.current = nextControllerId;
  assert.equal((await clockClient(confirmed.matchId, "read")).clock.canControl, true);
  const endedClock = await clockClient(confirmed.matchId, "endClock");
  assert.equal(endedClock.clock.status, "ended");
  assert.equal(endedClock.clock.clockUsed, false);
  assert.equal(Boolean(stateRef.current.matches[0].endedAt), false);
  state = runPracticeReducer(stateRef.current, "endMatch", [confirmed.matchId]).state;
  assert.ok(state.matches[0].endedAt);

  state = submitPracticeSampleResult(state, confirmed.matchId);
  assert.equal(state.matches[0].status, "approval");
  state = approvePracticeDummyPlayers(state, confirmed.matchId);
  assert.equal(state.matches[0].status, "approval");
  const selfSide = state.matches[0].teamA.players.includes(PRACTICE_SELF_ID) ? "teamA" : "teamB";
  state = runPracticeReducer(
    state,
    "approveMatch",
    [confirmed.matchId, selfSide, PRACTICE_SELF_ID],
  ).state;
  assert.equal(state.matches[0].status, "confirmed");
  assert.deepEqual(state.notifications, []);
  assert.deepEqual(state.discordNotificationDeliveries, []);
  assert.equal(
    JSON.stringify(state.users.map(({ id, ratings, trustScore }) => ({ id, ratings, trustScore }))),
    playerSnapshot,
  );
  assert.equal(JSON.stringify(realState), realStateSnapshot);
});

test("운영 구장 목록이 비어 있어도 연습용 등록 구장으로 생성을 막지 않는다", () => {
  const state = createPracticeState({ settings: { approvedCourts: [] } }, { name: "테스터" });
  const [court] = getRegisteredCourts(state);
  assert.equal(court?.id, "practice-court");
  assert.equal(court?.status, "active");
});

test("연습방은 자격 심판 경로도 연습용 참가자로만 구성한다", () => {
  let state = createPracticeState({}, { name: "테스터" });
  const referee = state.users.find((user) => user.officialReferee === true);
  assert.ok(referee?.id.startsWith("practice-"));
  const created = createPracticeRecruitingRoom(state, {
    title: "심판 있는 연습",
    mode: "3v3",
    sideCapacity: 3,
    refereeWanted: true,
    refereeId: referee.id,
    rules: { gameClockEnabled: true, periodCount: 1, periodMinutes: 3 },
  });
  state = acceptPracticeInvitations(created.state, created.postId);
  const confirmed = confirmPracticeRecruitingRoom(state, created.postId);
  const match = confirmed.state.matches.find((item) => item.id === confirmed.matchId);
  assert.equal(match.refereeId, referee.id);
  assert.equal(match.teamA.players.includes(referee.id), false);
  assert.equal(match.teamB.players.includes(referee.id), false);
});

test("연습방은 설정한 후보를 초대하고 공용 교체 흐름으로 출전시킨다", () => {
  let state = createPracticeState({}, { name: "테스터" });
  const created = createPracticeRecruitingRoom(state, {
    title: "후보 교체 연습",
    mode: "3v3",
    sideCapacity: 3,
    benchCapacity: 1,
    rules: { gameClockEnabled: true, periodCount: 1, periodMinutes: 3 },
  });
  const invitations = created.state.recruitingPosts
    .find((post) => post.id === created.postId)
    ?.roomState?.invitations ?? [];
  assert.equal(invitations.length, 7);
  assert.equal(invitations.filter((invitation) => invitation.reserve).length, 2);

  state = acceptPracticeInvitations(created.state, created.postId);
  const confirmed = confirmPracticeRecruitingRoom(state, created.postId);
  state = completePracticeAttendance(confirmed.state, confirmed.matchId);
  const readyMatch = state.matches.find((match) => match.id === confirmed.matchId);
  const teamAReserveId = getMatchReservePlayerIds(readyMatch, "teamA")[0];
  const teamAActiveId = readyMatch.teamA.players.find((playerId) => playerId !== PRACTICE_SELF_ID);
  assert.ok(teamAReserveId?.startsWith("practice-"));
  assert.ok(readyMatch.attendance.teamA.includes(teamAReserveId));

  state = runPracticeReducer(state, "startMatch", [confirmed.matchId]).state;
  state = runPracticeReducer(
    state,
    "substituteMatchPlayer",
    [confirmed.matchId, "teamA", teamAActiveId, teamAReserveId, "operator"],
  ).state;
  const liveMatch = state.matches.find((match) => match.id === confirmed.matchId);
  assert.ok(liveMatch.teamA.players.includes(teamAReserveId));
  assert.ok(getMatchReservePlayerIds(liveMatch, "teamA").includes(teamAActiveId));
});

test("심판과 시계 담당 화면을 바꾸면 실제 권한처럼 시작과 이전을 체험한다", async () => {
  const ready = createStartedPracticeMatch({}, { referee: true });
  assert.ok(ready.state.matches[0].startedAt);
  let actorId = ready.referee.id;
  const stateRef = { current: ready.state };
  const clockClient = createPracticeClockClient(
    () => stateRef.current,
    () => actorId,
  );
  const managerClock = await clockClient(ready.matchId, "read");
  assert.equal(managerClock.clock.canManage, true);
  assert.equal(managerClock.clock.canControl, false);
  const controllerId = managerClock.clock.controllerId;
  await clockClient(ready.matchId, "configure", { controllerId, shotClockSeconds: 30 });
  actorId = controllerId;
  assert.equal((await clockClient(ready.matchId, "read")).clock.canControl, true);
  await clockClient(ready.matchId, "start");
  const nextControllerId = managerClock.activePlayers.find((player) => player.id !== controllerId).id;
  assert.equal((await clockClient(ready.matchId, "transfer", { controllerId: nextControllerId })).clock.canControl, false);
  await assert.rejects(clockClient(ready.matchId, "pause"), /match_clock_start_forbidden/);
  actorId = nextControllerId;
  assert.equal((await clockClient(ready.matchId, "pause")).clock.status, "paused");
});

test("연습 시계는 구간 잔여시간만 합산하고 90분 강제종료를 정상 사용으로 인정하지 않는다", async () => {
  let nowMs = Date.parse("2026-07-25T00:00:00.000Z");
  const capped = createStartedPracticeMatch({ periodCount: 4, periodMinutes: 1 });
  let cappedState = capped.state;
  const cappedClient = createPracticeClockClient(
    () => cappedState,
    () => PRACTICE_SELF_ID,
    null,
    () => nowMs,
  );
  await cappedClient(capped.matchId, "read");
  await cappedClient(capped.matchId, "start");
  nowMs += 3 * 60 * 1000;
  const cappedEnd = await cappedClient(capped.matchId, "endClock");
  assert.equal(cappedEnd.clock.activeElapsedMs, 60 * 1000);
  assert.equal(cappedEnd.clock.clockUsed, false);

  nowMs = Date.parse("2026-07-25T01:00:00.000Z");
  const forced = createStartedPracticeMatch({ periodCount: 1, periodMinutes: 3 });
  const forcedStateRef = { current: forced.state };
  const forcedClient = createPracticeClockClient(
    () => forcedStateRef.current,
    () => PRACTICE_SELF_ID,
    async (matchId) => {
      forcedStateRef.current = runPracticeReducer(
        forcedStateRef.current,
        "endMatch",
        [matchId],
        PRACTICE_SELF_ID,
      ).state;
    },
    () => nowMs,
  );
  await forcedClient(forced.matchId, "read");
  await forcedClient(forced.matchId, "start");
  nowMs += 91 * 60 * 1000;
  const forcedEnd = await forcedClient(forced.matchId, "read");
  assert.equal(forcedEnd.clock.forcedMatchEnd, true);
  assert.equal(forcedEnd.clock.clockUsed, false);
  assert.ok(forcedStateRef.current.matches[0].endedAt);
});

test("연습 adapter와 화면은 브라우저 저장소나 실서버 호출을 포함하지 않는다", async () => {
  const [
    practiceSource,
    pageSource,
    createSource,
    recruitingSource,
    matchClockPanelSource,
    postgameRosterSource,
    settingsSyncSource,
    recruitingSyncSource,
    matchSyncSource,
    clockSource,
    clockPolicyMigrationSource,
  ] = await Promise.all([
    readFile(new URL("../src/lib/practiceMatch.js", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/PracticeMatch.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/CreateMatch.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/Recruiting.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/match/MatchClockPanel.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/match/MatchPostgameRosterPanel.jsx", import.meta.url), "utf8"),
    readFile(new URL("../server/api/settings/sync.js", import.meta.url), "utf8"),
    readFile(new URL("../server/api/recruiting/sync-post.js", import.meta.url), "utf8"),
    readFile(new URL("../server/api/matches/sync-match.js", import.meta.url), "utf8"),
    readFile(new URL("../server/api/matches/clock.js", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260725024000_match_clock_explicit_end_and_scoreless_overtime.sql", import.meta.url), "utf8"),
  ]);
  const source = `${practiceSource}\n${pageSource}`;
  assert.doesNotMatch(source, /\blocalStorage\b|\bsessionStorage\b/);
  assert.doesNotMatch(source, /\bfetch\s*\(|postServerAction|runServerAction/);
  assert.match(pageSource, /<CreateMatch/);
  assert.match(pageSource, /<RecruitingRoomModal/);
  assert.match(pageSource, /<MatchRoomModal/);
  assert.match(pageSource, /remoteReady: true/);
  assert.match(pageSource, /roomShare: false/);
  assert.match(pageSource, /meetingPoint: "연습 코트 입구"/);
  assert.match(pageSource, /\s+embedded\s+practiceMode/);
  assert.match(pageSource, /key=\{practiceSession\}/);
  assert.match(pageSource, /syncStepToUrl=\{false\}/);
  assert.match(createSource, /app\.capabilities\?\.remoteDirectory !== false/);
  assert.match(createSource, /practiceMode && \(/);
  assert.match(createSource, /\(\) => !practiceMode && new URLSearchParams/);
  assert.match(createSource, /if \(!syncStepToUrl\) return/);
  assert.match(createSource, /\|\| !remoteDirectoryEnabled/);
  assert.match(recruitingSource, /remoteSearchEnabled=\{remoteDirectoryEnabled\}/);
  assert.match(recruitingSource, /roomShareEnabled \?/);
  assert.match(recruitingSource, /if \(onRemake\) \{/);
  assert.match(pageSource, /onRemake=\{resetPractice\}/);
  assert.match(pageSource, /window\.setInterval\(pollClock, 15_000\)/);
  assert.match(pageSource, /!match\?\.startedAt/);
  assert.match(pageSource, /getMatchReservePlayerIds\(match, "teamA"\)/);
  assert.match(pageSource, /actorId === clockControllerId \? "시계 담당"/);
  assert.match(pageSource, /key=\{`\$\{matchId\}:\$\{practiceActorId\}`\}/);
  assert.match(postgameRosterSource, /remoteSearchType=\{remoteSearchEnabled \? "profile" : ""\}/);
  assert.match(matchClockPanelSource, /regulationEnded && \(!scoreboardEnabled \|\| tied\)/);
  assert.match(matchClockPanelSource, /regulationEnded && \(!scoreboardEnabled \|\| !tied\)/);
  assert.match(settingsSyncSource, /typeof source\.showHomeGuideCard === "boolean"/);
  assert.ok(recruitingSyncSource.indexOf("hasPracticeMutationPayload(body)") < recruitingSyncSource.indexOf("getAuthenticatedContext(request)"));
  assert.ok(matchSyncSource.indexOf("hasPracticeMutationPayload(body)") < matchSyncSource.indexOf("getAuthenticatedContext(request)"));
  assert.ok(clockSource.indexOf("isPracticeId(matchId)") < clockSource.indexOf("getAuthenticatedContext(request)"));
  assert.match(clockPolicyMigrationSource, /event\.action = 'endClock'/);
  assert.match(clockPolicyMigrationSource, /current_match\.stat_recorders->>'teamA'/);
  assert.match(clockPolicyMigrationSource, /'clockUsed',[\s\S]*explicit_end_recorded/);
});
