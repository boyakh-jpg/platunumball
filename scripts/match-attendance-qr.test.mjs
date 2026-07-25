import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  getRecommendedSideSize,
  isAttendanceCheckinOpen,
} from "../server/api/matches/attendance-qr.js";
import { mergeMatchesById } from "../src/hooks/useAppData.js";
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
  }).qrAttendanceEnabled, false);
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
  assert.match(roomEquipmentSql, /'ballProvider', ball_provider/u);
  assert.match(roomEquipmentSql, /when p_mode = '1v1' then false/u);
  assert.match(roomEquipmentSql, /'vestsProvided', vests_provided/u);
});
