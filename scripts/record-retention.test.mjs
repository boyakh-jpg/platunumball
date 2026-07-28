import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { API_ROUTES } from "../api/index.js";
import { buildRecordPage, canReadProfileRecord, canReadTeamRecord } from "../server/api/records/list.js";
import {
  REMOTE_CLIENT_RECORD_ARCHIVE_LIMIT,
  REMOTE_CLIENT_RECORD_LIST_YEARS,
  REMOTE_CLIENT_RECORD_MONTHS,
} from "../src/lib/constants.js";
import { getReadableMatchStatRows } from "../src/data/matchMappers.js";
import { getMatchPlayedDate, getPlayerRecentRecordMatches, getProfileRecordCategory, hasVerifiedPlayerStats } from "../src/lib/matchUtils.js";
import { getRecordWindowDates, isRecordDetailDate } from "../src/lib/recordRetention.js";

const root = new URL("../", import.meta.url);
const readSource = (path) => readFile(new URL(path, root), "utf8");

test("record windows use KST calendar cutoffs", () => {
  const now = new Date("2026-08-31T14:30:00.000Z");
  assert.deepEqual(getRecordWindowDates(now), {
    detailSince: "2026-02-28",
    listSince: "2021-08-31",
  });
  assert.equal(isRecordDetailDate("2026-02-28", now), true);
  assert.equal(isRecordDetailDate("2026-02-27", now), false);
  assert.equal(REMOTE_CLIENT_RECORD_MONTHS, 6);
  assert.equal(REMOTE_CLIENT_RECORD_LIST_YEARS, 5);
  assert.equal(REMOTE_CLIENT_RECORD_ARCHIVE_LIMIT, 100);
});

test("profile record categories are exclusive and keep personal records out of combined stats", () => {
  assert.equal(getProfileRecordCategory({ rules: { recordType: "solo" } }), "personal");
  assert.equal(getProfileRecordCategory({ tournamentId: "tournament-1", ranked: true }), "tournament");
  assert.equal(getProfileRecordCategory({ ranked: true, rules: { matchPurpose: "competitive" } }), "competitive");
  assert.equal(getProfileRecordCategory({ ranked: false, rules: { matchPurpose: "friendly" } }), "friendly");
});

test("verified tournament player stats remain readable from thin profile rows", () => {
  const playerStats = { player: { points: 12 } };
  assert.equal(hasVerifiedPlayerStats({ refereeId: "referee", result: { playerStats } }, "player"), true);
  assert.equal(hasVerifiedPlayerStats({ tournamentId: "tournament-1", result: { playerStats } }, "player"), true);
  assert.equal(hasVerifiedPlayerStats({ result: { playerStats } }, "player"), false);
});

test("profile preview is the first six rows of the recent record detail list", () => {
  const now = new Date("2026-07-28T09:00:00.000Z");
  const matches = Array.from({ length: 8 }, (_, index) => ({
    id: `recent-${index}`,
    status: "confirmed",
    scheduledDate: `2026-07-${String(20 - index).padStart(2, "0")}`,
    scheduledAt: `2026-07-${String(20 - index).padStart(2, "0")} 19:00`,
    teamA: { players: ["player-1"] },
    teamB: { players: ["opponent-1"] },
  })).concat({
    id: "too-old",
    status: "confirmed",
    scheduledDate: "2026-01-27",
    scheduledAt: "2026-01-27 19:00",
    teamA: { players: ["player-1"] },
    teamB: { players: ["opponent-1"] },
  });
  const detailRecords = getPlayerRecentRecordMatches(matches, "player-1", { now });
  const previewRecords = getPlayerRecentRecordMatches(matches, "player-1", { now, limit: 6 });

  assert.deepEqual(previewRecords.map((match) => match.id), detailRecords.slice(0, 6).map((match) => match.id));
  assert.equal(detailRecords.some((match) => match.id === "too-old"), false);
});

test("instant and rescheduled records use the actual played date", () => {
  assert.equal(getMatchPlayedDate({
    timingType: "instant",
    scheduledAt: "즉시",
    createdAt: "2026-07-27T15:00:00.000Z",
    startedAt: "2026-07-28T16:10:00.000Z",
    confirmedAt: "2026-07-29T01:00:00.000Z",
  }), "2026-07-29");
  assert.equal(getMatchPlayedDate({
    scheduledDate: "2026-07-20",
    scheduledAt: "2026-07-20 19:00",
    startedAt: "2026-07-21T14:50:00.000Z",
    endedAt: "2026-07-21T15:30:00.000Z",
  }), "2026-07-21");
  assert.equal(getMatchPlayedDate({
    rules: { recordType: "match_record" },
    scheduledDate: "2026-07-18",
    createdAt: "2026-07-28T00:00:00.000Z",
  }), "2026-07-18");
});

test("team record visibility keeps public rows readable and private rows scoped", () => {
  assert.equal(canReadTeamRecord({ visibility: "public", team_id: "team-a" }, "viewer", new Set()), true);
  assert.equal(canReadTeamRecord({ visibility: "private", team_id: "team-a", reader_ids: [] }, "viewer", new Set()), false);
  assert.equal(canReadTeamRecord({ visibility: "private", team_id: "team-a", reader_ids: ["viewer"] }, "viewer", new Set()), true);
  assert.equal(canReadTeamRecord({ visibility: "private", team_id: "team-a", reader_ids: [] }, "viewer", new Set(["team-a"])), true);
  assert.equal(canReadTeamRecord({ visibility: "private", team_id: "team-a", opponent_team_id: "team-b", reader_ids: [] }, "viewer", new Set(["team-b"])), true);
  assert.equal(canReadTeamRecord({ visibility: "private", team_id: "team-a", reader_ids: [] }, "viewer", new Set(), true), true);
});

test("profile personal records expose only public owner rows to other users", () => {
  const publicPersonal = { record_type: "solo", visibility: "public", owner_profile_id: "owner" };
  assert.equal(canReadProfileRecord(publicPersonal, "owner", "owner"), true);
  assert.equal(canReadProfileRecord(publicPersonal, "viewer", "owner"), true);
  assert.equal(canReadProfileRecord({ ...publicPersonal, visibility: "private" }, "viewer", "owner"), false);
  assert.equal(canReadProfileRecord({ ...publicPersonal, visibility: "private", owner_profile_id: "other" }, "owner", "owner"), false);
  assert.equal(canReadProfileRecord({ ...publicPersonal, record_type: "match" }, "owner", "owner"), true);
  assert.equal(canReadProfileRecord({ ...publicPersonal, record_type: "match" }, "viewer", "owner"), false);
  assert.equal(canReadProfileRecord({ ...publicPersonal, owner_profile_id: "other" }, "viewer", "owner"), false);
});

test("match stats expose only referee-verified rows or the personal-record owner", () => {
  const rows = [
    { user_id: "owner", record_source: "host_postgame" },
    { user_id: "player", record_source: "player" },
    { user_id: "verified", record_source: "referee" },
    { user_id: "adjusted", record_source: "dispute_operator" },
  ];
  assert.deepEqual(
    getReadableMatchStatRows({ referee_id: "referee", rules: { recordType: "match" } }, rows).map((row) => row.user_id),
    ["verified", "adjusted"],
  );
  assert.deepEqual(
    getReadableMatchStatRows({ created_by: "owner", rules: { recordType: "personal_record" } }, rows).map((row) => row.user_id),
    ["owner"],
  );
  assert.deepEqual(getReadableMatchStatRows({ rules: { recordType: "match" } }, rows), []);
});

test("record pagination preserves the 201st detail row and separates archive paging", () => {
  assert.deepEqual(buildRecordPage({
    includeDetail: true,
    detailHasMore: true,
    detailLimit: 200,
    detailOffset: 0,
    detailCount: 200,
    includeArchive: false,
    archiveHasMore: false,
    archiveLimit: 100,
    archiveOffset: 0,
  }), {
    detailIncluded: true,
    detailNextOffset: 200,
    detailExhausted: false,
    detailLimit: 200,
    detailOffset: 0,
    detailCount: 200,
    archiveIncluded: false,
    archiveLimit: 100,
    archiveOffset: 0,
    archiveNextOffset: null,
    archiveExhausted: null,
  });

  assert.deepEqual(buildRecordPage({
    includeDetail: false,
    detailHasMore: false,
    detailLimit: 200,
    detailOffset: 0,
    detailCount: 0,
    includeArchive: true,
    archiveHasMore: true,
    archiveLimit: 100,
    archiveOffset: 0,
  }), {
    detailIncluded: false,
    detailNextOffset: null,
    detailExhausted: null,
    detailLimit: 200,
    detailOffset: 0,
    detailCount: 0,
    archiveIncluded: true,
    archiveLimit: 100,
    archiveOffset: 0,
    archiveNextOffset: 100,
    archiveExhausted: false,
  });
});

test("profile and team records use the dedicated archive-backed API", async () => {
  const route = API_ROUTES.get("/records/list");
  assert.ok(route);
  assert.deepEqual(route.methods, ["POST"]);
  assert.equal(route.auth, "user");

  const [apiSource, hookSource, profileSource, teamSource, maintenanceSource, schemaHealthSource, migrationSource, simulationGuardSource] = await Promise.all([
    readSource("server/api/records/list.js"),
    readSource("src/hooks/useAppData.js"),
    readSource("src/pages/ProfileRecords.jsx"),
    readSource("src/pages/TeamDetail.jsx"),
    readSource("server/api/system/maintenance.js"),
    readSource("server/api/system/schema-health.js"),
    readSource("supabase/migrations/20260722223000_match_record_archive.sql"),
    readSource("supabase/migrations/20260722223500_match_record_archive_simulation_guard.sql"),
  ]);
  assert.match(apiSource, /scope === RECORD_SCOPE_TEAM/);
  assert.match(apiSource, /match_record_participants/);
  assert.match(apiSource, /match_record_teams/);
  assert.match(apiSource, /match_record_archives/);
  assert.match(apiSource, /\.gte\("record_date", options\.listSince\)/);
  assert.match(apiSource, /\.lt\("record_date", options\.detailSince\)/);
  assert.match(apiSource, /\.order\("occurred_at", \{ ascending: false \}\)/);
  assert.match(apiSource, /const includeDetail = normalizeBoolean\(body\.includeDetail, true\)/);
  assert.match(apiSource, /filterStateForProfile/);
  assert.match(apiSource, /flattenIdValues\(matchRow\.stat_recorders\)/);
  assert.match(apiSource, /resultRow\.submitted_by/);
  assert.match(apiSource, /teams: \[\]/);
  assert.match(hookSource, /"\/api\/records\/list"/);
  assert.match(hookSource, /const loadTeamRecords = useCallback/);
  assert.match(hookSource, /includeDetail: !loadMoreArchive/);
  assert.match(hookSource, /includeArchive: !loadMoreDetail/);
  assert.match(hookSource, /if \(!isRequestCurrent\(\) \|\| error\?\.code === "stale_auth_request"\) return false/);
  assert.match(profileSource, /6개월 초과 · 최근 5년/);
  assert.match(profileSource, /\{ id: "competitive", label: "경쟁전" \}/);
  assert.match(profileSource, /\{ id: "friendly", label: "친선전" \}/);
  assert.match(profileSource, /\{ id: "tournament", label: "대회 경기" \}/);
  assert.match(profileSource, /PERSONAL_VISIBILITY_FILTERS/);
  assert.match(profileSource, /MODE_FILTERS/);
  assert.match(profileSource, /matchesModeFilter/);
  assert.match(profileSource, /getPersonalSummaryByVisibility/);
  assert.doesNotMatch(profileSource, /날짜별 기록 수|const dateRows/);
  assert.match(apiSource, /publicSummary/);
  assert.match(profileSource, /if \(archiveState\.error\) return/);
  assert.match(teamSource, /loadTeamRecords\(team\.id\)/);
  assert.match(teamSource, /teamRecordArchive\.error\) return/);
  assert.match(teamSource, /match\.status === "confirmed" && getTeamSide\(match, team\.id\)/);
  assert.match(maintenanceSource, /rankball_archive_and_cleanup_completed_records/);
  assert.match(schemaHealthSource, /match_record_archives/);
  assert.match(schemaHealthSource, /match_record_participants/);
  assert.match(schemaHealthSource, /match_record_teams/);
  assert.match(schemaHealthSource, /"updated_at"/);
  assert.doesNotMatch(schemaHealthSource, /"refreshed_at"/);
  assert.match(migrationSource, /create table if not exists public\.match_record_archives \(\s*--[\s\S]*?match_id text primary key,/);
  assert.doesNotMatch(migrationSource, /match_record_archives[\s\S]{0,300}match_id text primary key references public\.matches/);
  assert.match(migrationSource, /'deletedCoreRows', 0/);
  assert.match(migrationSource, /\(\(played_ids \? profile_id\) or not \(reserve_ids \? profile_id\)\)/);
  assert.match(migrationSource, /create constraint trigger rankball_match_record_refresh_queue_flush/);
  assert.match(migrationSource, /reader_ids text\[\]/);
  assert.match(simulationGuardSource, /after delete on public\.matches/);
  assert.match(simulationGuardSource, /delete from public\.match_record_archives/);
  assert.doesNotMatch(profileSource, /records\.filter\(\(match\) => !isMatchWithinRecordDetailWindow/);
});
