import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  APP_DATA_ACTION_SOURCE_PATHS,
  MATCHES_PAGE_SOURCE_PATHS,
  MATCH_CLOCK_PANEL_SOURCE_PATHS,
  MATCH_ROOM_SOURCE_PATHS,
  MATCH_SYNC_SOURCE_PATHS,
  REPOSITORY_RECRUITING_SOURCE_PATHS,
  RECRUITING_PAGE_SOURCE_PATHS,
  RECRUITING_SYNC_SOURCE_PATHS,
  readSourceGroup,
} from "./management-source-groups.mjs";
import { readCssTree } from "./css-source-tree.mjs";
import {
  getStartStatus,
  getRecommendedSideSize,
  isAttendanceCheckinOpen,
  isQrMatchEligible,
} from "../server/api/matches/attendance-qr.js";
import {
  getMatchPregameNotificationPlan,
  getUpsertableDiscordDeliveryRows,
  getMissingMatchAttendanceIds,
  getRequiredMatchAttendanceIds,
  hasScheduledNotificationRevisionChanged,
  toDiscordDeliveryRows,
} from "../server/api/matches/sync-match.js";
import {
  getPregameDeliveryInvalidReason,
  isCurrentDiscordDeliveryTarget,
  isDiscordDeliveryExpired,
} from "../server/api/discord/dm-worker.js";
import {
  checkInMatchPlayer,
  confirmMatchRefereeAbsence,
  endMatch,
  requestMatchRefereeAbsence,
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

function makeRefereeAbsenceState(currentUserId = "host") {
  return {
    currentUserId,
    users: [
      { id: "host", trustScore: 80 },
      { id: "opponent", trustScore: 80 },
      { id: "referee", trustScore: 80, officialReferee: true },
    ],
    teams: [],
    tournaments: [],
    notifications: [],
    settings: {},
    matches: [{
      id: "referee-absence",
      title: "심판 미출석 회귀 검증",
      mode: "1v1",
      status: "agreed",
      createdBy: "host",
      refereeId: "referee",
      timingType: "instant",
      teamA: { players: ["host"] },
      teamB: { players: ["opponent"] },
      reservePlayers: { teamA: [], teamB: [] },
      attendance: { teamA: [], teamB: [] },
      rules: { timingType: "instant", qrAttendanceEnabled: false },
    }],
  };
}

test("심판 미출석은 상대 사이드장 확인 뒤 한 번만 차감한다", () => {
  const initial = makeRefereeAbsenceState();
  const requested = requestMatchRefereeAbsence(initial, "referee-absence");
  const repeated = requestMatchRefereeAbsence(requested, "referee-absence");

  assert.equal(requested.matches[0].refereeAbsenceRequest.status, "pending");
  assert.equal(requested.users.find((user) => user.id === "referee").trustScore, 80);
  assert.strictEqual(repeated, requested);

  const confirmed = confirmMatchRefereeAbsence(
    { ...repeated, currentUserId: "opponent" },
    "referee-absence",
  );
  const repeatedConfirmation = confirmMatchRefereeAbsence(confirmed, "referee-absence");
  assert.equal(confirmed.matches[0].refereeAbsenceRequest.status, "confirmed");
  assert.equal(confirmed.matches[0].formerRefereeId, "referee");
  assert.equal(confirmed.users.find((user) => user.id === "referee").trustScore, 76);
  assert.strictEqual(repeatedConfirmation, confirmed);
});

test("시작하지 않은 경기는 로컬 종료 reducer가 종료하지 않는다", () => {
  const initial = makeRefereeAbsenceState();
  const noReferee = {
    ...initial,
    matches: [{ ...initial.matches[0], refereeId: "" }],
  };
  assert.strictEqual(endMatch(noReferee, "referee-absence"), noReferee);

  const startedAt = new Date(Date.now() - 60_000).toISOString();
  const started = {
    ...noReferee,
    matches: [{ ...noReferee.matches[0], startedAt }],
  };
  const ended = endMatch(started, "referee-absence");
  assert.equal(ended.matches[0].startedAt, startedAt);
  assert.ok(ended.matches[0].endedAt);
});

test("심판 미출석과 경기 종료의 서버·DB 계약이 로컬 경계와 일치한다", async () => {
  const migration = await readSource("supabase/migrations/20260801006000_fix_match_dispute_and_referee_absence_edges.sql");
  const serverAction = await readSource("server/lib/matchSqlCoreActions.js");
  const matchModel = await readSource("src/components/recruiting/RecruitingRoomMatchModel.jsx");
  const endMigration = await readSource("supabase/migrations/20260728145000_unified_match_dispute_overlap_policy.sql");
  const requestBranchStart = migration.indexOf("if p_action = 'requestMatchRefereeAbsence' then");
  const confirmBranchStart = migration.indexOf("\n  else\n    if current_match.referee_absence_request->>'status' <> 'pending'");
  const trustUpdate = migration.indexOf("update public.profiles");

  assert.match(serverAction, /rankball_match_referee_absence_action/);
  assert.match(migration, /match_referee_absence_already_requested/);
  assert.ok(requestBranchStart >= 0 && confirmBranchStart > requestBranchStart);
  assert.doesNotMatch(migration.slice(requestBranchStart, confirmBranchStart), /update public\.profiles/);
  assert.ok(trustUpdate > confirmBranchStart);
  assert.match(matchModel, /refereeAbsenceRequest\?\.status !== "pending"/);
  assert.match(endMigration, /current_match\.started_at is null/);
});

test("QR 출석 기본값은 사후 경기기록을 제외한 경기시계 방에서 켜진다", () => {
  assert.equal(normalizeMatchRules({
    visibility: "public",
    matchPurpose: "competitive",
    formationMode: "prearranged",
  }).qrAttendanceEnabled, true);
  assert.equal(normalizeMatchRules({
    visibility: "tournament",
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
  }).qrAttendanceEnabled, true);
  assert.equal(normalizeMatchRules({
    visibility: "private",
    matchPurpose: "competitive",
  }).qrAttendanceEnabled, true);
  assert.equal(normalizeMatchRules({
    visibility: "private",
    matchPurpose: "competitive",
    recordType: "match_record",
    qrAttendanceEnabled: true,
  }).qrAttendanceEnabled, false);
  assert.equal(normalizeMatchRules({
    visibility: "private",
    recordType: "solo",
    qrAttendanceEnabled: true,
  }).qrAttendanceEnabled, true);
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
  assert.equal(isQrMatchEligible({
    visibility: "private",
    rules: { qrAttendanceEnabled: true },
  }), true);
  assert.equal(isQrMatchEligible({
    visibility: "public",
    rules: { qrAttendanceEnabled: true, recordType: "solo" },
  }), true);
  assert.equal(isQrMatchEligible({
    visibility: "private",
    rules: { qrAttendanceEnabled: true, recordType: "match_record" },
  }), false);
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

test("QR 출석은 경기 20분 전부터 열리고 5분 토큰 회전과 분리된다", () => {
  const match = {
    scheduled_date: "2026-07-24",
    scheduled_time: "20:00:00",
    rules: { timingType: "scheduled" },
  };
  assert.equal(isAttendanceCheckinOpen(match, Date.parse("2026-07-24T19:39:00+09:00")), false);
  assert.equal(isAttendanceCheckinOpen(match, Date.parse("2026-07-24T19:40:00+09:00")), true);
  assert.equal(isAttendanceCheckinOpen(match, Date.parse("2026-07-24T19:45:00+09:00")), true);
  assert.equal(ATTENDANCE_QR_ROTATION_MS, 5 * 60 * 1000);
  assert.equal(isAttendanceCheckinOpen({ ...match, rules: { timingType: "instant" } }, 0), true);
  assert.equal(isAttendanceCheckinOpen({ ...match, started_at: "2026-07-24T11:00:00Z" }, 0), true);
});

test("서버 시작 상태는 예정시간 전 전원 출석만 허용하고 예정시간 뒤 미출석을 허용한다", () => {
  const match = {
    id: "start-status",
    scheduled_date: "2026-07-24",
    scheduled_time: "20:00",
    referee_id: "referee",
    rules: { timingType: "scheduled", qrAttendanceEnabled: true },
  };
  const readyEntries = [
    { player_id: "host-player", status: "on_time" },
    { player_id: "reserve-a", status: "on_time" },
    { player_id: "referee", status: "pending" },
  ];
  const exactlyTwentyMinutesBefore = getStartStatus(
    match,
    readyEntries,
    Date.parse("2026-07-24T19:40:00+09:00"),
  );
  assert.equal(exactlyTwentyMinutesBefore.requiredCount, 2);
  assert.equal(exactlyTwentyMinutesBefore.allCheckedIn, true);
  assert.equal(exactlyTwentyMinutesBefore.canStartEarly, true);

  const missingEntries = readyEntries.map((entry) => (
    entry.player_id === "reserve-a" ? { ...entry, status: "pending" } : entry
  ));
  assert.equal(getStartStatus(
    match,
    missingEntries,
    Date.parse("2026-07-24T19:39:00+09:00"),
  ).blockReason, "attendance_not_open");
  assert.equal(getStartStatus(
    match,
    missingEntries,
    Date.parse("2026-07-24T19:50:00+09:00"),
  ).blockReason, "attendance_pending");
  const scheduledStart = getStartStatus(
    match,
    missingEntries,
    Date.parse("2026-07-24T20:00:00+09:00"),
  );
  assert.equal(scheduledStart.canStart, true);
  assert.equal(scheduledStart.scheduledStartReached, true);
});

test("QR 전원 출석 계산은 선수 방장과 후보를 포함하고 비선수 방장과 심판을 제외한다", () => {
  const match = {
    createdBy: "host-player",
    refereeId: "referee",
    teamA: { players: ["host-player", "a2"] },
    teamB: { players: ["b1", "referee"] },
    reservePlayers: { teamA: ["reserve-a"], teamB: ["reserve-b"] },
    attendance: { teamA: ["a2", "reserve-a"], teamB: ["b1"] },
  };
  assert.deepEqual(
    getRequiredMatchAttendanceIds(match),
    ["host-player", "a2", "b1", "reserve-a", "reserve-b"],
  );
  assert.deepEqual(getMissingMatchAttendanceIds(match), ["host-player", "reserve-b"]);

  const nonPlayerHost = { ...match, createdBy: "host-operator" };
  assert.equal(getRequiredMatchAttendanceIds(nonPlayerHost).includes("host-operator"), false);
});

test("경기 전 Discord 알림은 90초 뒤 만료되고 출석·운영자 변경을 발송 직전에 거른다", () => {
  const sendAt = Date.parse("2026-07-24T10:00:00.000Z");
  const baseDelivery = {
    id: "discord-match-attendance-20m-match-1-player-a",
    target_user_id: "player-a",
    send_at: new Date(sendAt).toISOString(),
    payload: {
      noticePrefix: "match-attendance-20m",
      matchId: "match-1",
      targetUserId: "player-a",
      sendAt: new Date(sendAt).toISOString(),
    },
  };
  assert.equal(isDiscordDeliveryExpired(baseDelivery, sendAt + 89_999), false);
  assert.equal(isDiscordDeliveryExpired(baseDelivery, sendAt + 90_000), true);

  const match = {
    id: "match-1",
    status: "agreed",
    created_by: "host",
    referee_id: "referee",
    rules: { qrAttendanceEnabled: true },
    reserve_players: { teamA: ["reserve-a"], teamB: [] },
    attendance: { teamA: ["player-a"], teamB: [] },
    scheduled_date: "2026-07-24",
    scheduled_time: "20:00:00",
  };
  const playerRows = [{ match_id: "match-1", user_id: "player-a", side: "teamA" }];
  assert.equal(
    getPregameDeliveryInvalidReason(baseDelivery, match, playerRows),
    "discord_notification_attendance_complete",
  );
  assert.equal(
    getPregameDeliveryInvalidReason({
      ...baseDelivery,
      id: "discord-match-manager-attendance-10m-match-1-host",
      target_user_id: "host",
      payload: { ...baseDelivery.payload, noticePrefix: "match-manager-attendance-10m", targetUserId: "host" },
    }, match, playerRows),
    "discord_notification_manager_changed",
  );
  assert.equal(
    getPregameDeliveryInvalidReason(baseDelivery, { ...match, started_at: "2026-07-24T10:00:00Z" }, playerRows),
    "discord_notification_match_inactive",
  );
  assert.equal(
    getPregameDeliveryInvalidReason({
      ...baseDelivery,
      payload: { ...baseDelivery.payload, scheduledAt: "2026-07-24 19:00" },
    }, match, playerRows),
    "discord_notification_schedule_changed",
  );
  assert.equal(isCurrentDiscordDeliveryTarget(
    { discord_user_id: "123456789012345678" },
    { discord_user_id: "123456789012345678" },
  ), true);
  assert.equal(isCurrentDiscordDeliveryTarget(
    { discord_user_id: "123456789012345678" },
    { discord_user_id: null },
  ), false);
});

test("경기 전 알림은 1시간·20분·10분만 만들고 현재 출석·운영자를 반영한다", () => {
  const scheduledAt = "2026-07-24 20:00";
  const match = {
    id: "notification-plan",
    title: "알림 테스트",
    status: "agreed",
    scheduledAt,
    createdBy: "host",
    refereeId: "referee",
    teamA: { players: ["player-a"] },
    teamB: { players: ["player-b"] },
    reservePlayers: { teamA: ["reserve-a"], teamB: [] },
    attendance: { teamA: ["player-a"], teamB: [] },
    rules: { qrAttendanceEnabled: true },
  };
  const plan = getMatchPregameNotificationPlan(
    match,
    Date.parse("2026-07-24T18:00:00+09:00"),
  );
  assert.deepEqual(
    plan.map((notice) => notice.idPrefix),
    [
      "match-reminder-1h",
      "match-attendance-20m",
      "match-attendance-10m",
      "match-manager-attendance-10m",
    ],
  );
  assert.deepEqual(plan[0].targetIds, ["player-a", "player-b", "reserve-a", "referee"]);
  assert.deepEqual(plan[1].targetIds, ["player-b", "reserve-a"]);
  assert.deepEqual(plan[2].targetIds, ["player-b", "reserve-a"]);
  assert.deepEqual(plan[3].targetIds, ["referee"]);
  assert.match(plan[3].intro, /출석 완료 1명 · 미출석 2명/u);

  const insideTwentyMinutes = getMatchPregameNotificationPlan(
    { ...match, refereeId: "" },
    Date.parse("2026-07-24T19:45:00+09:00"),
  );
  assert.deepEqual(
    insideTwentyMinutes.map((notice) => notice.idPrefix),
    ["match-attendance-20m", "match-manager-attendance-10m"],
  );
  assert.deepEqual(insideTwentyMinutes[1].targetIds, ["host"]);

  const scheduledRow = { payload: { scheduledAt: "2026-07-24 20:00" } };
  assert.equal(hasScheduledNotificationRevisionChanged(
    scheduledRow,
    { payload: { scheduledAt: "2026-07-24 20:00" } },
  ), false);
  assert.equal(hasScheduledNotificationRevisionChanged(
    scheduledRow,
    { payload: { scheduledAt: "2026-07-24 21:00" } },
  ), true);

  const [deliveryRow] = toDiscordDeliveryRows(match, [{
    id: "player-a",
    discord_user_id: "123456789012345678",
  }], {
    idPrefix: "match-reminder-1h",
    title: "경기 1시간 전",
    intro: "경기 일정과 구장을 확인해 주세요.",
  });
  assert.equal(deliveryRow.payload.fromUserId, "host");
  assert.deepEqual(getUpsertableDiscordDeliveryRows([deliveryRow], [{
    ...deliveryRow,
    status: "cancelled",
    sent_at: null,
  }]), []);
  assert.equal(getUpsertableDiscordDeliveryRows([{
    ...deliveryRow,
    send_at: "2026-07-24T11:00:00.000Z",
  }], [{
    ...deliveryRow,
    status: "queued",
    attempt_count: 1,
    send_at: "2026-07-24T10:01:00.000Z",
  }])[0].send_at, "2026-07-24T10:01:00.000Z");
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

test("선수 방장의 자기 출석은 UI에서 막지 않고 QR 시작 상태를 즉시 갱신한다", async () => {
  const [roomManagementSource, attendancePanelSource] = await Promise.all([
    readSource("src/components/recruiting/RoomManagementPanels.jsx"),
    readSource("src/components/match/MatchAttendanceQrPanel.jsx"),
  ]);
  assert.doesNotMatch(roomManagementSource, /operatorAttendanceOptional|방장 확인 생략|확인 생략/u);
  assert.match(roomManagementSource, /disabled=\{checkedIn \|\| Boolean\(pendingAction\)\}[\s\S]*?runAction\(`checkin:\$\{playerId\}`,[\s\S]*?onCheckInPlayer\(side, playerId\)/u);
  assert.match(attendancePanelSource, /const attendanceRevision = \["teamA", "teamB"\]/u);
  assert.match(attendancePanelSource, /const loadRequestIdRef = useRef\(0\)/u);
  assert.match(attendancePanelSource, /loadRequestIdRef\.current !== requestId/u);
  assert.match(attendancePanelSource, /loadRequestIdRef\.current \+= 1/u);
  assert.match(attendancePanelSource, /\}, \[attendanceRevision, load\]\);/u);
});

test("QR 경기방은 20분 전, 비QR 경기방은 기존 10분 전부터 체크인 단계로 전환한다", () => {
  const qrMatch = {
    status: "agreed",
    timingType: "scheduled",
    scheduledDate: "2026-07-28",
    scheduledTime: "20:00",
    rules: { qrAttendanceEnabled: true },
  };
  assert.equal(getMatchRoomPhase(qrMatch, new Date("2026-07-28T10:39:59.000Z")).phase, "locked");
  assert.equal(getMatchRoomPhase(qrMatch, new Date("2026-07-28T10:40:00.000Z")).phase, "checkin");
  const nonQrMatch = { ...qrMatch, rules: { qrAttendanceEnabled: false } };
  assert.equal(getMatchRoomPhase(nonQrMatch, new Date("2026-07-28T10:49:59.000Z")).phase, "locked");
  assert.equal(getMatchRoomPhase(nonQrMatch, new Date("2026-07-28T10:50:00.000Z")).phase, "checkin");
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

  const panelSource = await readSourceGroup(readSource, MATCH_CLOCK_PANEL_SOURCE_PATHS);
  const requestSource = await readSource("src/components/match/useMatchClockRequests.js");
  const clockApiSource = await readSource("server/api/matches/clock.js");
  const authoritativeStateSource = await readSource("server/api/_authoritativeState.js");
  const recruitingSource = await readSourceGroup(readSource, RECRUITING_PAGE_SOURCE_PATHS);
  const matchRoomSource = await readSourceGroup(readSource, MATCH_ROOM_SOURCE_PATHS);
  const disputeQueueSource = await readSource("src/components/match/MatchDisputeQueue.jsx");
  assert.match(requestSource, /window\.setInterval\(readLatest, 3000\)/u);
  assert.match(panelSource, /점수 3초 자동 갱신/u);
  assert.match(panelSource, /눌러서 \$\{liveClock\.shotClockSeconds\}초로 초기화/u);
  assert.match(clockApiSource, /\.from\("match_results"\)[\s\S]*\.select\("score_a,score_b,score_revision_a,score_revision_b,submitted_at"\)/u);
  assert.doesNotMatch(authoritativeStateSource, /substituteMatchPlayer/u);
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
    roomManagementSource,
    matchesSource,
    clockStyles,
    qrStyles,
    repositorySource,
    recruitingApiSource,
    teamPartyGuardSql,
    appDataSource,
    liveOperationsSql,
    matchListApiSource,
    authoritativeStateSource,
  ] = await Promise.all([
    readSourceGroup(readSource, MATCH_CLOCK_PANEL_SOURCE_PATHS),
    readSource("server/api/matches/clock.js"),
    readSourceGroup(readSource, MATCH_SYNC_SOURCE_PATHS),
    readSourceGroup(readSource, RECRUITING_PAGE_SOURCE_PATHS),
    readSource("src/components/recruiting/RoomManagementPanels.jsx"),
    readSourceGroup(readSource, MATCHES_PAGE_SOURCE_PATHS),
    readCssTree("src/styles/match-clock.css"),
    readSource("src/styles/primitives/ui-entity-feedback.css"),
    readSourceGroup(readSource, REPOSITORY_RECRUITING_SOURCE_PATHS),
    readSourceGroup(readSource, RECRUITING_SYNC_SOURCE_PATHS),
    readSource("supabase/migrations/20260728123000_block_team_room_party_detach.sql"),
    readSourceGroup(readSource, APP_DATA_ACTION_SOURCE_PATHS),
    readSource("supabase/migrations/20260728124000_simplify_live_match_operations.sql"),
    readSource("server/api/matches/_listProjection.js"),
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
  assert.match(clockStyles, /\.ui-match-clock-display-grid-with-attendance:not\(\.ui-match-clock-display-grid-single\)\s*\{[^}]*grid-template-areas:\s*"score score"\s*"attendance shot";[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/u);
  assert.match(qrStyles, /\.ui-qr-expand-backdrop\s*\{[^}]*z-index:\s*4000;/u);
  assert.match(recruitingSource, /window\.setInterval\(refreshAttendance, 3000\)/u);
  assert.match(roomManagementSource, /setPendingKick\(\{[\s\S]*?playerId,[\s\S]*?playerName/u);
  assert.doesNotMatch(roomManagementSource, /playerId:\s*partyEntry \? playerId : entry\.playerId/u);
  assert.doesNotMatch(roomManagementSource, /operatorAttendanceOptional|방장 확인 생략|확인 생략/u);
  assert.match(roomManagementSource, /disabled=\{checkedIn \|\| Boolean\(pendingAction\)\}[\s\S]*?runAction\(`checkin:\$\{playerId\}`,[\s\S]*?onCheckInPlayer\(side, playerId\)/u);
  assert.match(recruitingSource, /<MatchAttendanceQrPanel[\s\S]*?match=\{sourceMatch\}/u);
  assert.doesNotMatch(recruitingSource, /자동 기록자|기록 후보/u);
  assert.doesNotMatch(recruitingSource, /<Badge[^>]*>본인 교체<\/Badge>/u);
  assert.match(matchesSource, /function AttendanceScanResultView/u);
  assert.match(matchesSource, /!attendanceQrFlow && selectedMatchDetailLoading/u);
  assert.doesNotMatch(syncMatchSource, /RETIRED_RECORDER_MATCH_ACTIONS|match_recorder_flow_retired/u);
  assert.match(syncMatchSource, /unsupported_match_operation/u);
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
  const matchListApi = await readSource("server/api/matches/_listProjection.js");
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
  const tournamentQrSql = await readSource("supabase/migrations/20260729121000_enable_tournament_qr_attendance.sql");
  const tournamentQrDefaultsSql = await readSource("supabase/migrations/20260803010000_force_tournament_qr_defaults.sql");
  const unifiedQrStartSql = await readSource("supabase/migrations/20260729150000_unify_match_qr_start_policy.sql");
  const privateQrSql = await readSource("supabase/migrations/20260730204500_align_match_qr_attendance_eligibility.sql");
  const hostFinalizationSql = await readSource("supabase/migrations/20260728130000_general_match_host_finalization.sql");
  const liveAuthoritySql = await readSource("supabase/migrations/20260728143000_referee_live_match_authority.sql");
  const substituteTeamProvenanceSql = await readSource("supabase/migrations/20260801005000_preserve_substitute_team_provenance.sql");
  const scoreOnlyPostgameRosterSql = await readSource("supabase/migrations/20260727144000_allow_score_only_postgame_roster.sql");
  const enforcedScoreOnlyPostgameRosterSql = await readSource("supabase/migrations/20260727145000_enforce_score_only_postgame_roster.sql");
  const syncMatchSource = await readSourceGroup(readSource, MATCH_SYNC_SOURCE_PATHS);
  const attendanceApiSource = await readSource("server/api/matches/attendance-qr.js");
  const clockApiSource = await readSource("server/api/matches/clock.js");
  const recruitingSource = await readSourceGroup(readSource, RECRUITING_PAGE_SOURCE_PATHS);
  assert.match(unifiedQrStartSql, /interval '20 minutes'/u);
  assert.match(unifiedQrStartSql, /now_at < scheduled_at_kst[\s\S]*missing_count > 0/u);
  assert.match(unifiedQrStartSql, /match_attendance_entries[\s\S]*coalesce\(entry\.status, 'pending'\) not in \('on_time', 'late'\)/u);
  assert.match(unifiedQrStartSql, /pg_advisory_xact_lock/u);
  assert.doesNotMatch(unifiedQrStartSql, /drop\s+table|truncate\s+table|delete\s+from/iu);
  assert.match(sql, /candidate_size <= current_side_size/u);
  assert.match(sql, /'attendanceStatus', 'late'/u);
  assert.match(sql, /'reserveRegistered', true/u);
  assert.match(sql, /'roomEditCountConsumed', false/u);
  assert.match(sql, /greatest\(\s*60,\s*least\(\s*180,/u);
  assert.match(sql, /minimumPlayExcludedPlayerIds/u);
  assert.match(sql, /postgameAddedPlayerIds/u);
  assert.match(sql, /'mmrExcluded', safe_action = 'addMatchLatePlayer'/u);
  assert.match(sql, /grant execute on function public\.rankball_match_attendance_qr_action/u);
  assert.match(tournamentQrSql, /current_match\.tournament_id is null/u);
  assert.doesNotMatch(tournamentQrSql, /delete\s+from|drop\s+table|truncate\s+table/iu);
  assert.match(tournamentQrDefaultsSql, /rankball_enforce_tournament_qr_defaults/u);
  assert.match(tournamentQrDefaultsSql, /before insert or update of tournament_id, rules on public\.matches/u);
  assert.match(tournamentQrDefaultsSql, /'gameClockEnabled', true,[\s\S]*'qrAttendanceEnabled', true/u);
  assert.doesNotMatch(tournamentQrDefaultsSql, /delete\s+from|drop\s+table|truncate\s+table/iu);
  assert.match(attendanceApiSource, /export function isQrMatchEligible/u);
  assert.match(attendanceApiSource, /\["public", "private"\]\.includes\(match\.visibility\) \|\| isTournamentMatch\(match\)/u);
  assert.match(attendanceApiSource, /String\(match\.rules\?\.recordType \|\| ""\) !== "match_record"/u);
  assert.match(attendanceApiSource, /isTournamentMatch\(match\)[\s\S]*?\[match\.referee_id\]/u);
  assert.match(attendanceApiSource, /canResize: !match\.started_at[\s\S]*?!isTournamentMatch\(match\)/u);
  assert.match(attendanceApiSource, /queueMatchDiscordDeliveries\([\s\S]*?notificationMatch,[\s\S]*?"attendanceRefresh"/u);
  assert.match(clockApiSource, /\["public", "private"\]\.includes\(matchRow\?\.visibility\)/u);
  assert.match(clockApiSource, /String\(matchRow\?\.rules\?\.recordType \|\| ""\) !== "match_record"/u);
  assert.match(privateQrSql, /rankball_match_attendance_qr_action\(text,text\)/u);
  assert.match(privateQrSql, /rankball_match_attendance_resize_action\(text,text\)/u);
  assert.match(privateQrSql, /visibility not in \(''public'', ''private''\)/u);
  assert.match(privateQrSql, /old_resize_fragment[\s\S]*visibility <> ''public''/u);
  assert.match(privateQrSql, /function_signature = 'public\.rankball_match_attendance_qr_action\(text,text\)'/u);
  assert.match(privateQrSql, /recordType'', ''''\), ''match''\) = ''match_record''/u);
  assert.doesNotMatch(privateQrSql, /delete\s+from|drop\s+table|truncate\s+table/iu);
  assert.match(recruitingSource, /selectedMatchRules\.qrAttendanceEnabled/u);
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
  assert.match(substituteTeamProvenanceSql, /rankball_match_roster_move_action_pre_substitution_permission/u);
  assert.match(substituteTeamProvenanceSql, /from public\.recruiting_applications application/u);
  assert.match(substituteTeamProvenanceSql, /application\.kind = 'team'/u);
  assert.match(substituteTeamProvenanceSql, /application\.side = safe_side/u);
  assert.match(substituteTeamProvenanceSql, /application\.player_id = active_in_id[\s\S]*application\.player_ids \? active_in_id/u);
  assert.match(substituteTeamProvenanceSql, /from public\.recruiting_posts post/u);
  assert.match(substituteTeamProvenanceSql, /post\.host_join_mode = 'team'/u);
  assert.match(substituteTeamProvenanceSql, /post\.host_side = safe_side/u);
  assert.match(substituteTeamProvenanceSql, /partyReserves,host[\s\S]*pinnedReservePlayers/u);
  assert.match(substituteTeamProvenanceSql, /current_match\.team_a_id[\s\S]*current_match\.team_b_id/u);
  assert.doesNotMatch(substituteTeamProvenanceSql, /rules->'parties'|delete\s+from|drop\s+table|truncate\s+table/iu);
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
  assert.doesNotMatch(syncMatchSource, /RETIRED_RECORDER_MATCH_ACTIONS|match_recorder_flow_retired/u);
  assert.match(syncMatchSource, /unsupported_match_operation/u);
  assert.doesNotMatch(recruitingSource, /function MatchRecorderHandoffPanel/u);
  assert.doesNotMatch(recruitingSource, /<option value="injury">/u);
  assert.doesNotMatch(recruitingSource, /recorderSides=\{sourceMatchRecorderSides\}/u);
});

test("local/demo 경기 방장 권한은 방장 식별자가 비어 있으면 허용하지 않는다", async () => {
  const repositorySource = await readSource("src/data/repository/matchAccess.js");
  const guardStart = repositorySource.indexOf("function currentUserIsMatchHost");
  const guardEnd = repositorySource.indexOf("function currentUserIsEligibleMatchReferee", guardStart);
  const hostGuardSource = repositorySource.slice(guardStart, guardEnd);
  assert.match(hostGuardSource, /return Boolean\(hostPlayerId && hostPlayerId === state\.currentUserId\)/u);
  assert.doesNotMatch(hostGuardSource, /return !hostPlayerId \|\|/u);
});

test("방 참가자 관리 명령은 ref mutex와 실패 상태를 공유한다", async () => {
  const panelSource = await readSource("src/components/recruiting/RoomManagementPanels.jsx");
  assert.match(panelSource, /const pendingRef = useRef\(false\)/u);
  assert.match(panelSource, /if \(pendingRef\.current\) return false/u);
  assert.match(panelSource, /result === false \|\| result\?\.ok === false/u);
  assert.match(panelSource, /runAction\(`checkin:/u);
  assert.match(panelSource, /runAction\(`placement:/u);
  assert.match(panelSource, /runAction\(`swap:/u);
  assert.match(panelSource, /runAction\(`substitute:/u);
  assert.match(panelSource, /role="alert"/u);
});
