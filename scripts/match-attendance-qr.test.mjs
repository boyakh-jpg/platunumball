import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  getRecommendedSideSize,
  isAttendanceCheckinOpen,
} from "../server/api/matches/attendance-qr.js";
import {
  addMatchLatePlayer,
  checkInMatchPlayer,
  endMatch,
  substituteMatchPlayer,
} from "../src/data/repository.js";
import { mergeMatchesById } from "../src/hooks/useAppData.js";
import { deriveMatchClock } from "../src/lib/matchClock.js";
import {
  getMatchSubstitutionAccess,
  getMatchRoomPhase,
  isMatchLateAttendancePlayer,
} from "../src/lib/matchUtils.js";
import { normalizeMatchRules } from "../src/lib/matchRules.js";
import { createQrMatrix, createQrPath } from "../src/lib/qrCode.js";

process.env.MATCH_ATTENDANCE_QR_SECRET = "rankball-attendance-test-secret";
process.env.PUBLIC_APP_URL = "https://rankball.example";

const {
  ATTENDANCE_QR_ROTATION_MS,
  createMatchAttendanceQr,
  verifyMatchAttendanceQr,
} = await import("../server/api/matches/_attendanceQr.js");

const root = new URL("../", import.meta.url);
const readSource = (path) => readFile(new URL(path, root), "utf8");

test("QR 출석 기본값은 공개 경쟁전만 켜진다", () => {
  assert.equal(normalizeMatchRules({
    visibility: "public",
    matchPurpose: "competitive",
    formationMode: "prearranged",
  }).qrAttendanceEnabled, true);
  assert.equal(normalizeMatchRules({
    visibility: "public",
    matchPurpose: "friendly",
    formationMode: "prearranged",
  }).qrAttendanceEnabled, false);
  assert.equal(normalizeMatchRules({
    visibility: "public",
    matchPurpose: "competitive",
    formationMode: "pickup",
  }).qrAttendanceEnabled, true);
  assert.equal(normalizeMatchRules({
    visibility: "private",
    matchPurpose: "competitive",
    qrAttendanceEnabled: true,
  }).qrAttendanceEnabled, false);
  assert.equal(normalizeMatchRules({
    visibility: "public",
    matchPurpose: "friendly",
    qrAttendanceEnabled: true,
  }).qrAttendanceEnabled, true);
  assert.equal(normalizeMatchRules({
    visibility: "public",
    matchPurpose: "competitive",
    gameClockEnabled: false,
    qrAttendanceEnabled: true,
  }).qrAttendanceEnabled, false);
});

test("출석 QR은 5분 단위로 교체되고 경기와 서명에 묶인다", () => {
  const matchId = "match-attendance-test";
  const nowMs = Date.UTC(2026, 6, 24, 12, 1, 30);
  const current = createMatchAttendanceQr(matchId, null, nowMs);
  const sameBucket = createMatchAttendanceQr(matchId, null, nowMs + 60_000);
  const nextBucket = createMatchAttendanceQr(matchId, null, nowMs + ATTENDANCE_QR_ROTATION_MS);

  assert.equal(current.token, sameBucket.token);
  assert.notEqual(current.token, nextBucket.token);
  assert.match(current.token, /^2\.[0-9a-z]+\.[A-Za-z0-9_-]{22}$/u);
  assert.ok(current.value.includes(encodeURIComponent(current.token)));
  const currentUrl = new URL(current.value);
  assert.equal(currentUrl.pathname, "/app/matches");
  assert.equal(currentUrl.searchParams.get("match"), matchId);
  assert.equal(currentUrl.searchParams.get("attendanceQr"), current.token);
  assert.equal(verifyMatchAttendanceQr(current.token, matchId, nowMs).matchId, matchId);
  assert.throws(
    () => verifyMatchAttendanceQr(current.token, "another-match", nowMs),
    /match_attendance_qr_invalid/u,
  );
  assert.throws(
    () => verifyMatchAttendanceQr(`${current.token.slice(0, -1)}x`, matchId, nowMs),
    /match_attendance_qr_invalid/u,
  );

  const expiresAtMs = Date.parse(current.expiresAt);
  assert.throws(
    () => verifyMatchAttendanceQr(current.token, matchId, expiresAtMs + 15_001),
    /match_attendance_qr_expired/u,
  );
});

test("QR 행렬은 실제 출석 URL을 담고 quiet zone을 유지한다", () => {
  const payload = createMatchAttendanceQr("match-attendance-test", null, Date.UTC(2026, 6, 24, 12, 1)).value;
  const matrix = createQrMatrix(payload);
  const path = createQrPath(payload);

  assert.ok(matrix.length >= 21 && matrix.length <= 57);
  assert.ok(matrix.every((row) => row.length === matrix.length));
  assert.equal(path.size, matrix.length + 8);
  assert.match(path.path, /^M/u);
  assert.deepEqual(createQrMatrix(payload), matrix);
});

test("출석 기준 경기 방식은 현재 크기보다 커지지 않는다", () => {
  const entries = [
    ...Array.from({ length: 5 }, (_, index) => ({ player_id: `a${index}`, side: "teamA", status: "on_time" })),
    ...Array.from({ length: 5 }, (_, index) => ({ player_id: `b${index}`, side: "teamB", status: "on_time" })),
  ];
  assert.equal(getRecommendedSideSize(entries, "5v5").recommendedMode, "5v5");
  assert.equal(getRecommendedSideSize(entries, "3v3").recommendedMode, "3v3");
  assert.equal(getRecommendedSideSize(entries.slice(0, 3).concat(entries.slice(5, 8)), "5v5").recommendedMode, "3v3");
});

test("출석 정리는 경기 10분 전부터 열린다", () => {
  const match = {
    scheduled_date: "2026-07-24",
    scheduled_time: "20:00:00",
    rules: { timingType: "scheduled" },
  };
  assert.equal(isAttendanceCheckinOpen(match, Date.parse("2026-07-24T19:49:59+09:00")), false);
  assert.equal(isAttendanceCheckinOpen(match, Date.parse("2026-07-24T19:50:00+09:00")), true);
  assert.equal(isAttendanceCheckinOpen({ ...match, rules: { timingType: "instant" } }, 0), true);
  assert.equal(isAttendanceCheckinOpen({ ...match, started_at: "2026-07-24T11:00:00Z" }, 0), true);
});

test("배정 심판과 후보 본인만 출전·후보를 교체할 수 있다", () => {
  const match = {
    id: "candidate-substitution",
    status: "agreed",
    startedAt: new Date().toISOString(),
    teamA: { name: "A", players: ["active-a"] },
    teamB: { name: "B", players: ["active-b"] },
    reservePlayers: { teamA: ["reserve-a", "reserve-a2"], teamB: [] },
    playedPlayerIds: { teamA: ["active-a"], teamB: ["active-b"] },
    refereeId: "referee",
    rules: { lateAttendancePlayerIds: ["reserve-a"] },
  };
  const reserveAccess = getMatchSubstitutionAccess(match, "reserve-a2", "teamA");
  assert.equal(reserveAccess.canManage, false);
  assert.equal(reserveAccess.canSelfSubstitute, true);
  assert.deepEqual(reserveAccess.allowedReservePlayerIds, ["reserve-a2"]);
  const refereeAccess = getMatchSubstitutionAccess(match, "referee", "teamA", { canOperate: true });
  assert.equal(refereeAccess.canManage, true);
  assert.deepEqual(refereeAccess.allowedReservePlayerIds, ["reserve-a", "reserve-a2"]);
  assert.equal(isMatchLateAttendancePlayer(match, "reserve-a"), true);
  assert.equal(isMatchLateAttendancePlayer(match, "reserve-a2"), false);
  const state = {
    currentUserId: "reserve-a2",
    matches: [match],
    users: [
      { id: "active-a", name: "출전 A" },
      { id: "active-b", name: "출전 B" },
      { id: "reserve-a", name: "후보 A1" },
      { id: "reserve-a2", name: "후보 A2" },
      { id: "referee", name: "심판", trustScore: 100, refereeGrade: "official" },
    ],
    notifications: [],
  };
  const reserveSubstituted = substituteMatchPlayer(
    state,
    match.id,
    "teamA",
    "active-a",
    "reserve-a2",
    "self",
  );
  assert.equal(reserveSubstituted.matches[0].teamA.players[0], "reserve-a2");
  assert.equal(reserveSubstituted.matches[0].substitutionEvents[0].reason, "self");
  const injurySubstituted = substituteMatchPlayer(
    { ...state, currentUserId: "referee" },
    match.id,
    "teamA",
    "active-a",
    "reserve-a",
    "injury",
  );
  assert.equal(injurySubstituted.matches[0].teamA.players[0], "active-a");
  const refereeSubstituted = substituteMatchPlayer(
    { ...state, currentUserId: "referee" },
    match.id,
    "teamA",
    "active-a",
    "reserve-a",
    "operator",
  );
  assert.deepEqual(refereeSubstituted.matches[0].teamA.players, ["reserve-a"]);
  assert.equal(refereeSubstituted.matches[0].substitutionEvents[0].reason, "operator");
  const noRefereeMatch = {
    ...match,
    createdBy: "host",
    refereeId: "",
    statRecorders: { teamA: "reserve-a", teamB: "reserve-b" },
    reservePlayers: { teamA: ["reserve-a", "reserve-a2"], teamB: ["reserve-b"] },
    rules: {
      lateAttendancePlayerIds: ["reserve-a"],
      statRecorders: { teamA: "reserve-a", teamB: "reserve-b" },
    },
  };
  const noRefereeState = {
    ...state,
    matches: [noRefereeMatch],
    users: [
      ...state.users,
      { id: "host", name: "방장" },
      { id: "party-leader", name: "파티장" },
      { id: "reserve-b", name: "후보 B" },
    ],
  };
  for (const actorId of ["host", "party-leader", "active-a"]) {
    const blocked = substituteMatchPlayer(
      { ...noRefereeState, currentUserId: actorId },
      match.id,
      "teamA",
      "active-a",
      "reserve-a2",
      "operator",
    );
    assert.equal(blocked.matches[0].teamA.players[0], "active-a");
  }
  const regularReserveSubstituted = substituteMatchPlayer(
    { ...noRefereeState, currentUserId: "reserve-a2" },
    match.id,
    "teamA",
    "active-a",
    "reserve-a2",
    "self",
  );
  assert.equal(regularReserveSubstituted.matches[0].teamA.players[0], "reserve-a2");
  assert.equal(regularReserveSubstituted.matches[0].statRecorders.teamA, "reserve-a");
  const recorderSubstituted = substituteMatchPlayer(
    { ...noRefereeState, currentUserId: "reserve-a" },
    match.id,
    "teamA",
    "active-a",
    "reserve-a",
    "self",
  );
  assert.equal(recorderSubstituted.matches[0].teamA.players[0], "reserve-a");
  assert.deepEqual(recorderSubstituted.matches[0].reservePlayers.teamA, ["reserve-a2", "active-a"]);
  assert.equal(recorderSubstituted.matches[0].statRecorders.teamA, "reserve-a");
  assert.equal(recorderSubstituted.matches[0].rules.statRecorders.teamA, "reserve-a");
  const crossSideRecorderBlocked = substituteMatchPlayer(
    { ...noRefereeState, currentUserId: "reserve-b" },
    match.id,
    "teamA",
    "active-a",
    "reserve-a2",
    "operator",
  );
  assert.equal(crossSideRecorderBlocked.matches[0].teamA.players[0], "active-a");
});

test("폐기된 기록자 실행 경로는 repository export에서 제거된다", async () => {
  const repositorySource = await readSource("src/data/repository.js");
  assert.doesNotMatch(repositorySource, /export function setRecruitingStatRecorder/u);
  assert.doesNotMatch(repositorySource, /export function setMatchDualScoreRecorderSide/u);
  assert.doesNotMatch(repositorySource, /export function requestMatchRecorderTakeover/u);
  assert.doesNotMatch(repositorySource, /export function resolveMatchRecorderTakeover/u);
});
test("출석 운영자는 자기 출석도 같은 중앙 action으로 저장한다", () => {
  const match = {
    id: "host-self-checkin",
    createdBy: "host",
    status: "agreed",
    timingType: "instant",
    teamA: { players: ["host"] },
    teamB: { players: ["guest"] },
    reservePlayers: { teamA: [], teamB: [] },
    attendance: { teamA: [], teamB: [] },
    rules: {},
  };
  const state = {
    currentUserId: "host",
    users: [{ id: "host", name: "방장" }, { id: "guest", name: "참가자" }],
    matches: [match],
    recruitingPosts: [],
    notifications: [],
    settings: {},
  };
  const checkedIn = checkInMatchPlayer(state, match.id, "teamA", "host");
  assert.deepEqual(checkedIn.matches[0].attendance.teamA, ["host"]);
});

test("예정 경기방도 시작 10분 전부터 체크인 단계와 QR 운영을 연다", () => {
  const match = {
    status: "agreed",
    timingType: "scheduled",
    scheduledDate: "2026-07-28",
    scheduledTime: "20:00",
  };
  assert.equal(getMatchRoomPhase(match, new Date("2026-07-28T10:49:59.000Z")).phase, "locked");
  assert.equal(getMatchRoomPhase(match, new Date("2026-07-28T10:50:00.000Z")).phase, "checkin");
});

test("일반 live 경기는 종료 후 누락 출전자를 추가할 수 없다", () => {
  const match = {
    id: "score-only-postgame-roster",
    createdBy: "host",
    refereeId: "",
    status: "agreed",
    startedAt: new Date().toISOString(),
    teamA: { players: ["host"] },
    teamB: { players: ["guest"] },
    reservePlayers: { teamA: [], teamB: [] },
    playedPlayerIds: { teamA: ["host"], teamB: ["guest"] },
    result: { scoreA: 3, scoreB: 2, playerStats: {} },
    rules: {},
  };
  const state = {
    currentUserId: "host",
    matches: [match],
    users: [{ id: "host", name: "방장" }, { id: "guest", name: "상대" }],
    notifications: [],
  };

  const ended = endMatch(state, match.id);
  assert.equal(ended.matches[0].status, "agreed");
  assert.ok(ended.matches[0].endedAt);

  const corrected = addMatchLatePlayer(ended, match.id, { sideName: "teamA", name: "현장 참가자" });
  assert.equal(Object.keys(corrected.matches[0].anonymousPlayers ?? {}).length, 0);
  assert.equal(corrected.notifications[0]?.title, "명단 변경 불가");
});

test("경기시계는 샷클락과 점수를 화면에서 자동 갱신한다", async () => {
  const runningClock = {
    status: "running",
    serverNow: "2026-07-25T10:00:00.000Z",
    lastResumedAt: "2026-07-25T10:00:00.000Z",
    clientReceivedAtMs: Date.parse("2026-07-25T10:00:00.000Z"),
    periodRemainingMs: 60_000,
    shotClockSeconds: 30,
    shotRemainingMs: 30_000,
    activeElapsedMs: 0,
  };
  const afterFiveSeconds = deriveMatchClock(
    runningClock,
    Date.parse("2026-07-25T10:00:05.000Z"),
  );
  assert.equal(afterFiveSeconds.periodRemainingMs, 55_000);
  assert.equal(afterFiveSeconds.shotRemainingMs, 25_000);
  const afterExpiry = deriveMatchClock(
    runningClock,
    Date.parse("2026-07-25T10:00:35.000Z"),
  );
  assert.equal(afterExpiry.shotRemainingMs, 0);

  const panelSource = await readSource("src/components/match/MatchClockPanel.jsx");
  const clockApiSource = await readSource("server/api/matches/clock.js");
  const authoritativeStateSource = await readSource("server/api/_authoritativeState.js");
  const recruitingSource = await readSource("src/pages/Recruiting.jsx");
  const matchRoomSource = await readSource("src/pages/MatchRoom.jsx");
  const disputeQueueSource = await readSource("src/components/match/MatchDisputeQueue.jsx");
  assert.match(panelSource, /window\.setInterval\(load, 3000\)/u);
  assert.match(panelSource, /점수 3초 자동 갱신/u);
  assert.match(panelSource, /눌러서 \$\{liveClock\.shotClockSeconds\}초로 초기화/u);
  assert.match(clockApiSource, /\.from\("match_results"\)[\s\S]*\.select\("score_a,score_b,score_revision_a,score_revision_b,submitted_at"\)/u);
  assert.match(authoritativeStateSource, /substituteMatchPlayer\(state,[\s\S]*operation\.reason\)/u);
  assert.match(recruitingSource, /finalizeMatch/u);
  assert.match(recruitingSource, /canFinalizeSourceMatch/u);
  assert.match(recruitingSource, /mine \|\| currentUserIsSourceReferee \|\| currentUserIsAdmin/u);
  assert.match(recruitingSource, /sourceMatchPhase\?\.phase === "live"[\s\S]*sourceMatchRecordWindow\?\.beforeEnd/u);
  assert.match(matchRoomSource, /finalizeMatch/u);
  assert.match(matchRoomSource, /canFinalizeMatch/u);
  assert.match(matchRoomSource, /currentUserCanRefreshReview = isMatchHost \|\| currentUserIsEligibleReferee \|\| currentUserIsAdmin/u);
  assert.match(matchRoomSource, /onRefresh=\{currentUserCanRefreshReview \? refreshMatchDetail : null\}/u);
  assert.match(disputeQueueSource, /refreshing \? "갱신 중" : "새로고침"/u);
});

test("경기시계 담당·출석·QR·교체 UI는 단순화 정책을 따른다", async () => {
  const [
    panelSource,
    clockApiSource,
    syncMatchSource,
    recruitingSource,
    matchesSource,
    clockStyles,
    repositorySource,
    recruitingApiSource,
    teamPartyGuardSql,
    appDataSource,
    liveOperationsSql,
    matchListApiSource,
    authoritativeStateSource,
  ] = await Promise.all([
    readSource("src/components/match/MatchClockPanel.jsx"),
    readSource("server/api/matches/clock.js"),
    readSource("server/api/matches/sync-match.js"),
    readSource("src/pages/Recruiting.jsx"),
    readSource("src/pages/Matches.jsx"),
    readSource("src/styles/match-clock.css"),
    readSource("src/data/repository.js"),
    readSource("server/api/recruiting/sync-post.js"),
    readSource("supabase/migrations/20260728123000_block_team_room_party_detach.sql"),
    readSource("src/hooks/useAppData.js"),
    readSource("supabase/migrations/20260728124000_simplify_live_match_operations.sql"),
    readSource("server/api/matches/list.js"),
    readSource("server/api/_authoritativeState.js"),
  ]);

  assert.match(clockApiSource, /reserve_players,referee_id/u);
  assert.match(clockApiSource, /role:\s*"reserve"/u);
  assert.match(clockApiSource, /role:\s*"referee"/u);
  assert.match(clockApiSource, /attendanceQr:\s*\(\s*clock\?\.canControl/u);
  assert.doesNotMatch(clockApiSource, /clock\?\.canControl \|\| clock\?\.canManage/u);
  assert.match(panelSource, /controllerCanEditScores = Boolean\(snapshot\?\.canControl && !match\.refereeId\)/u);
  assert.match(panelSource, /liveControllerCanEditScores = Boolean\(liveClock\?\.canControl && !match\.refereeId\)/u);
  assert.match(panelSource, /clockEditableScoreSides = liveControllerCanEditScores \? MATCH_SIDES : editableScoreSides/u);
  assert.match(panelSource, /showAttendanceQr = Boolean\(attendanceQr\?\.value && liveClock\?\.canControl\)/u);
  assert.match(panelSource, /getClockControllerLabel/u);
  assert.match(clockStyles, /\.ui-match-clock-display-grid-with-attendance\s*\{[^}]*grid-template-columns:\s*minmax\(144px, 0\.28fr\) minmax\(0, 1\.44fr\) minmax\(144px, 0\.28fr\);/u);
  assert.match(recruitingSource, /window\.setInterval\(refreshAttendance, 3000\)/u);
  assert.match(recruitingSource, /setPendingKick\(\{[\s\S]*?playerId,[\s\S]*?playerName/u);
  assert.doesNotMatch(recruitingSource, /playerId:\s*partyEntry \? playerId : entry\.playerId/u);
  assert.doesNotMatch(recruitingSource, /자동 기록자|기록 후보/u);
  assert.doesNotMatch(recruitingSource, /<Badge[^>]*>본인 교체<\/Badge>/u);
  assert.match(matchesSource, /function AttendanceScanResultView/u);
  assert.match(matchesSource, /!attendanceQrFlow && selectedMatchDetailLoading/u);
  assert.match(syncMatchSource, /match_recorder_flow_retired/u);
  assert.doesNotMatch(appDataSource, /requestMatchRecorderTakeover|approveMatchRecorderTakeover|handoffMatchRecorder/u);
  assert.doesNotMatch(appDataSource, /setRecruitingStatRecorder/u);
  assert.doesNotMatch(recruitingApiSource, /setRecruitingStatRecorder|rankball_recruiting_stat_recorder_action/u);
  assert.doesNotMatch(matchListApiSource, /match_recorder_takeover_requests|recorderTakeoverRequests/u);
  assert.doesNotMatch(authoritativeStateSource, /handoffMatchRecorder|setRecruitingStatRecorder/u);
  assert.match(liveOperationsSql, /elsif game_clock_enabled[\s\S]*authority_a := 'clock_controller'/u);
  assert.match(repositorySource, /if \(isTeamOnlyRecruitingRoom\(post\)\) return state;/u);
  assert.match(recruitingApiSource, /team_room_party_detach_forbidden/u);
  assert.match(teamPartyGuardSql, /team_room_party_detach_forbidden/u);
});

test("일정 목록 카드는 이미 연 경기방의 출석 규칙과 상세 명단을 덮지 않는다", () => {
  const detailed = {
    id: "match-detail-preserved",
    title: "상세 경기방",
    updatedAt: "2026-07-25T00:00:00.000Z",
    teamA: { name: "A", players: ["player-a"] },
    teamB: { name: "B", players: ["player-b"] },
    rules: { qrAttendanceEnabled: true, visibility: "public", targetScore: 21 },
    attendance: { teamA: ["player-a"], teamB: [] },
    agreements: { teamA: ["player-a"], teamB: ["player-b"] },
  };
  const listCard = {
    id: detailed.id,
    title: "목록에서 갱신된 제목",
    matchListOnly: true,
    updatedAt: "2026-07-25T00:01:00.000Z",
    teamA: { name: "A", players: [], count: 1 },
    teamB: { name: "B", players: [], count: 1 },
    rules: { targetScore: 21 },
    attendance: { teamA: [], teamB: [] },
    agreements: { teamA: [], teamB: [] },
  };

  const [merged] = mergeMatchesById([detailed], [listCard]);
  assert.equal(merged.title, listCard.title);
  assert.equal(merged.matchListOnly, undefined);
  assert.equal(merged.rules.qrAttendanceEnabled, true);
  assert.deepEqual(merged.teamA.players, detailed.teamA.players);
  assert.deepEqual(merged.teamB.players, detailed.teamB.players);
  assert.deepEqual(merged.attendance, detailed.attendance);
  assert.deepEqual(merged.agreements, detailed.agreements);

  const [hydrated] = mergeMatchesById([listCard], [detailed]);
  assert.equal(hydrated.matchListOnly, undefined);
  assert.equal(hydrated.rules.qrAttendanceEnabled, true);
});

test("공용 API 디스패처가 QR 출석 핸들러를 노출한다", async () => {
  const apiIndex = await readSource("api/index.js");
  const matchListApi = await readSource("server/api/matches/list.js");
  assert.match(apiIndex, /import matchAttendanceQr from "\.\.\/server\/api\/matches\/attendance-qr\.js";/u);
  assert.match(apiIndex, /\["\/matches\/attendance-qr", route\(matchAttendanceQr, \["POST"\], "user"\)\]/u);
  assert.match(matchListApi, /matchListOnly: true/u);
});

test("DB 마이그레이션은 지각 후보, 무수정 정리, 최소 출전, 사후 MMR 제외를 강제한다", async () => {
  const sql = await readSource("supabase/migrations/20260724234800_match_qr_attendance_and_substitution.sql");
  const clockAccuracySql = await readSource("supabase/migrations/20260725001000_match_play_time_clock_accuracy.sql");
  const roomEquipmentSql = await readSource("supabase/migrations/20260725001500_room_equipment_edit.sql");
  const candidateSubstitutionSql = await readSource("supabase/migrations/20260725018000_candidate_self_substitution_and_late_guard.sql");
  const attendanceStartOrderSql = await readSource("supabase/migrations/20260727090000_fix_match_start_attendance_trigger_order.sql");
  const substitutionPermissionSql = await readSource("supabase/migrations/20260725025000_match_substitution_permission_hardening.sql");
  const consistencySql = await readSource("supabase/migrations/20260726090000_match_policy_consistency.sql");
  const placementAndTeamMmrSql = await readSource("supabase/migrations/20260728110000_player_placement_and_roster_team_mmr.sql");
  const unifiedRosterSql = await readSource("supabase/migrations/20260727110000_unified_match_roster_transition.sql");
  const simplifiedLiveMatchSql = await readSource("supabase/migrations/20260728124000_simplify_live_match_operations.sql");
  const hostFinalizationSql = await readSource("supabase/migrations/20260728130000_general_match_host_finalization.sql");
  const liveAuthoritySql = await readSource("supabase/migrations/20260728143000_referee_live_match_authority.sql");
  const scoreOnlyPostgameRosterSql = await readSource("supabase/migrations/20260727144000_allow_score_only_postgame_roster.sql");
  const enforcedScoreOnlyPostgameRosterSql = await readSource("supabase/migrations/20260727145000_enforce_score_only_postgame_roster.sql");
  const syncMatchSource = await readSource("server/api/matches/sync-match.js");
  const recruitingSource = await readSource("src/pages/Recruiting.jsx");
  assert.match(sql, /interval '10 minutes'/u);
  assert.match(sql, /candidate_size <= current_side_size/u);
  assert.match(sql, /'attendanceStatus', 'late'/u);
  assert.match(sql, /'reserveRegistered', true/u);
  assert.match(sql, /'roomEditCountConsumed', false/u);
  assert.match(sql, /greatest\(\s*60,\s*least\(\s*180,/u);
  assert.match(sql, /minimumPlayExcludedPlayerIds/u);
  assert.match(sql, /postgameAddedPlayerIds/u);
  assert.match(sql, /'mmrExcluded', safe_action = 'addMatchLatePlayer'/u);
  assert.match(sql, /grant execute on function public\.rankball_match_attendance_qr_action/u);
  assert.match(clockAccuracySql, /rankball_match_clock_effective_elapsed_ms/u);
  assert.match(clockAccuracySql, /started_active_elapsed_ms/u);
  assert.match(clockAccuracySql, /ended_active_elapsed_ms/u);
  assert.match(clockAccuracySql, /play_interval\.ended_active_elapsed_ms/u);
  assert.match(consistencySql, /when play_interval\.started_active_elapsed_ms is not null/u);
  assert.match(placementAndTeamMmrSql, /gameClockEnabled/u);
  assert.match(placementAndTeamMmrSql, /extract\(epoch\s+from/u);
  assert.match(
    placementAndTeamMmrSql,
    /coalesce\(\(new\.rules\s*->>\s*'gameClockEnabled'\)::boolean,\s*false\)\s*=\s*false/u,
  );
  assert.match(placementAndTeamMmrSql, /else 0/u);
  assert.match(roomEquipmentSql, /'ballProvider', ball_provider/u);
  assert.match(roomEquipmentSql, /when p_mode = '1v1' then false/u);
  assert.match(roomEquipmentSql, /'vestsProvided', vests_provided/u);
  assert.match(candidateSubstitutionSql, /old\.status not in \('no_show', 'late'\)/u);
  assert.match(candidateSubstitutionSql, /old\.status = 'no_show'[\s\S]*match\.started_at is not null[\s\S]*match\.ended_at is null/u);
  assert.match(candidateSubstitutionSql, /old\.started_at is null and new\.started_at is not null[\s\S]*status = 'no_show'/u);
  assert.match(candidateSubstitutionSql, /entry\.first_registered_at <= match\.started_at/u);
  assert.match(attendanceStartOrderSql, /drop trigger if exists zz_mark_pending_attendance_no_show_at_start/u);
  assert.match(attendanceStartOrderSql, /create trigger aa_mark_pending_attendance_no_show_at_start/u);
  assert.match(attendanceStartOrderSql, /execute function public\.rankball_mark_pending_attendance_no_show_at_start\(\)/u);
  assert.match(candidateSubstitutionSql, /safe_actor_id = safe_reserve_player_id/u);
  assert.match(candidateSubstitutionSql, /match_late_substitution_not_eligible/u);
  assert.match(candidateSubstitutionSql, /'actorProfileId', safe_actor_id/u);
  assert.match(substitutionPermissionSql, /pg_get_functiondef\([\s\S]*rankball_match_roster_move_action_pre_substitution_permission/u);
  assert.doesNotMatch(substitutionPermissionSql, /alter function public\.rankball_match_roster_move_action/u);
  assert.doesNotMatch(substitutionPermissionSql, /safe_actor_id = coalesce\(current_match\.created_by/u);
  assert.match(unifiedRosterSql, /create or replace function public\.rankball_match_roster_transition_action/u);
  assert.match(unifiedRosterSql, /update public\.match_play_intervals[\s\S]*insert into public\.match_play_intervals/u);
  assert.match(unifiedRosterSql, /return public\.rankball_match_roster_transition_action/u);
  assert.match(simplifiedLiveMatchSql, /safe_action <> 'substituteMatchPlayer'/u);
  assert.match(simplifiedLiveMatchSql, /actor_is_side_reserve := \([\s\S]*safe_actor_id = safe_reserve_player_id/u);
  assert.match(simplifiedLiveMatchSql, /internal_actor_id := coalesce\([\s\S]*assigned_referee_id,[\s\S]*current_match\.created_by/u);
  assert.match(simplifiedLiveMatchSql, /rankball_match_roster_move_action_pre_substitution_permission/u);
  assert.match(simplifiedLiveMatchSql, /rankball_match_roster_move_action_pre_substitution_permission/u);
  assert.match(simplifiedLiveMatchSql, /function public\.rankball_match_clock_controller_eligible/u);
  assert.match(simplifiedLiveMatchSql, /match_row\.reserve_players->'teamA'/u);
  assert.match(simplifiedLiveMatchSql, /authority_a := 'clock_controller'/u);
  assert.match(simplifiedLiveMatchSql, /not game_clock_enabled[\s\S]*current_match\.created_by/u);
  assert.match(hostFinalizationSql, /match_finalize_host_required/u);
  assert.match(hostFinalizationSql, /match_dispute_host_required/u);
  assert.match(hostFinalizationSql, /check \(reason in \('self', 'late', 'ejection', 'operator'\)\) not valid/u);
  assert.match(hostFinalizationSql, /revoke all on function public\.rankball_match_recorder_takeover_action/u);
  assert.match(liveAuthoritySql, /if assigned_referee_id is not null[\s\S]*match_score_referee_required/u);
  assert.match(liveAuthoritySql, /elsif game_clock_enabled[\s\S]*rankball_match_clock_controller_eligible/u);
  assert.match(liveAuthoritySql, /match_score_clock_controller_required/u);
  assert.match(liveAuthoritySql, /match_score_host_required/u);
  assert.match(liveAuthoritySql, /rankball_match_live_finalize_action/u);
  assert.match(liveAuthoritySql, /match_finalize_referee_required/u);
  assert.match(liveAuthoritySql, /match_finalize_host_required/u);
  assert.match(liveAuthoritySql, /match_live_finalize_record_type_invalid/u);
  assert.match(liveAuthoritySql, /match_record_approval_actor_mismatch/u);
  assert.match(liveAuthoritySql, /match_record_approval_player_not_actual/u);
  assert.match(liveAuthoritySql, /participantAcceptedIds/u);
  assert.match(liveAuthoritySql, /participationAccepted/u);
  assert.match(liveAuthoritySql, /match_record_participant_approval_required/u);
  assert.match(liveAuthoritySql, /rankball_match_record_finalize_after_approvals/u);
  assert.match(liveAuthoritySql, /approved_count <> required_count/u);
  assert.match(liveAuthoritySql, /safe_action <> 'substituteMatchPlayer' or safe_next_recorder_id is not null[\s\S]*match_recorder_flow_retired/u);
  assert.match(liveAuthoritySql, /match_substitution_injury_retired/u);
  assert.doesNotMatch(liveAuthoritySql, /safe_reason := 'operator'/u);
  assert.match(liveAuthoritySql, /create or replace function public\.rankball_match_substitute_action/u);
  assert.match(scoreOnlyPostgameRosterSql, /rankball_match_postgame_roster_action/u);
  assert.match(scoreOnlyPostgameRosterSql, /score_row_lock constant text/u);
  assert.doesNotMatch(scoreOnlyPostgameRosterSql, /drop\s+table|truncate\s+table|delete\s+from/iu);
  assert.match(enforcedScoreOnlyPostgameRosterSql, /create or replace function public\.rankball_match_end_action/u);
  assert.match(enforcedScoreOnlyPostgameRosterSql, /set status = current_match\.status/u);
  assert.doesNotMatch(enforcedScoreOnlyPostgameRosterSql, /has_result|case when has_result/u);
  assert.doesNotMatch(enforcedScoreOnlyPostgameRosterSql, /drop\s+table|truncate\s+table|delete\s+from/iu);
  assert.match(syncMatchSource, /rpc\("rankball_match_substitute_action"/u);
  assert.match(syncMatchSource, /match_recorder_flow_retired/u);
  assert.doesNotMatch(recruitingSource, /function MatchRecorderHandoffPanel/u);
  assert.doesNotMatch(recruitingSource, /<option value="injury">/u);
  assert.doesNotMatch(recruitingSource, /recorderSides=\{sourceMatchRecorderSides\}/u);
});

test("local/demo 경기 방장 권한은 방장 식별자가 비어 있으면 허용하지 않는다", async () => {
  const repositorySource = await readSource("src/data/repository.js");
  const guardStart = repositorySource.indexOf("function currentUserIsMatchHost");
  const guardEnd = repositorySource.indexOf("function currentUserIsEligibleMatchReferee", guardStart);
  const hostGuardSource = repositorySource.slice(guardStart, guardEnd);
  assert.match(hostGuardSource, /return Boolean\(hostPlayerId && hostPlayerId === state\.currentUserId\)/u);
  assert.doesNotMatch(hostGuardSource, /return !hostPlayerId \|\|/u);
});
