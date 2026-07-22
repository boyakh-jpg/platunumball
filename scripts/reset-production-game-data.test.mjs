import assert from "node:assert/strict";
import test from "node:test";
import {
  DELETE_TABLES,
  EXPECTED_PUBLIC_TABLES,
  PRESERVE_TABLES,
  PRODUCTION_RESET_CONFIRMATION,
  PRODUCTION_PROJECT_REF,
  REQUIRED_MIGRATIONS,
  RATING_RESET_TABLES,
  assertExecutionConfirmation,
  buildBackupSchemaName,
  buildProductionResetSql,
  parseResetArguments,
  validateRemoteCatalog,
  validateRequiredMigrations,
} from "./reset-production-game-data.mjs";

test("public table policy has no duplicates and keeps all categories separate", () => {
  assert.deepEqual([...DELETE_TABLES], [
    "admin_disciplinary_actions",
    "discord_notification_deliveries",
    "match_agreements",
    "match_approvals",
    "match_disputes",
    "match_player_competitive_snapshots",
    "match_players",
    "match_record_archives",
    "match_record_participants",
    "match_record_refresh_queue",
    "match_record_teams",
    "match_results",
    "matches",
    "notifications",
    "player_match_stats",
    "profile_match_summaries",
    "recruiting_applications",
    "recruiting_posts",
    "reports",
    "room_chat_messages",
    "room_discord_links",
    "room_feed_cards",
    "team_invitations",
    "tournament_teams",
    "tournaments",
    "user_room_feed",
  ]);
  assert.deepEqual([...RATING_RESET_TABLES], [
    "affiliations",
    "approved_courts",
    "courts",
    "profiles",
    "teams",
  ]);
  assert.deepEqual([...PRESERVE_TABLES], [
    "admin_appointments",
    "admin_audit_log",
    "court_facility_info",
    "court_import_batches",
    "court_import_rows",
    "court_name_change_log",
    "court_name_evidence",
    "court_requests",
    "court_reviews",
    "court_source_records",
    "favorites",
    "profile_icon_unlocks",
    "rating_policy",
    "referee_appointments",
    "referee_exam_attempts",
    "referee_requests",
    "seasons",
    "team_members",
  ]);
  const allTables = [...DELETE_TABLES, ...RATING_RESET_TABLES, ...PRESERVE_TABLES];
  assert.equal(allTables.length, 49);
  assert.equal(new Set(allTables).size, allTables.length);
  assert.deepEqual([...EXPECTED_PUBLIC_TABLES], [...allTables].sort());
});

test("dry-run is the default and execute requires both explicit confirmations", () => {
  assert.deepEqual(parseResetArguments([]), { execute: false, projectRef: "", confirmation: "" });
  assert.throws(
    () => assertExecutionConfirmation({ execute: true, projectRef: "", confirmation: "" }, "olzxextphxpniwiiwwda"),
    /--project-ref/,
  );
  assert.throws(
    () => assertExecutionConfirmation({ execute: true, projectRef: "olzxextphxpniwiiwwda", confirmation: "" }, "olzxextphxpniwiiwwda"),
    /--confirm-production-reset/,
  );
  assert.throws(
    () => assertExecutionConfirmation({
      execute: true,
      projectRef: "abcdefghijklmnopqrst",
      confirmation: PRODUCTION_RESET_CONFIRMATION,
    }, "abcdefghijklmnopqrst"),
    /승인된 production project ref/,
  );
  assert.equal(PRODUCTION_PROJECT_REF, "olzxextphxpniwiiwwda");
  assert.doesNotThrow(() => assertExecutionConfirmation({
    execute: true,
    projectRef: "olzxextphxpniwiiwwda",
    confirmation: PRODUCTION_RESET_CONFIRMATION,
  }, "olzxextphxpniwiiwwda"));
});

test("catalog validation blocks unknown tables and preserved inbound references", () => {
  assert.equal(validateRemoteCatalog(EXPECTED_PUBLIC_TABLES, []).ok, true);
  const unknown = validateRemoteCatalog([...EXPECTED_PUBLIC_TABLES, "future_game_events"], []);
  assert.deepEqual(unknown.unexpected, ["future_game_events"]);
  assert.equal(unknown.ok, false);
  const unsafeForeignKey = validateRemoteCatalog(EXPECTED_PUBLIC_TABLES, [{
    source_table: "favorites",
    target_table: "matches",
  }]);
  assert.equal(unsafeForeignKey.unsafeInboundForeignKeys.length, 1);
  assert.equal(unsafeForeignKey.ok, false);
});

test("reset waits for every new match policy migration", () => {
  assert.equal(REQUIRED_MIGRATIONS.length, 4);
  assert.equal(validateRequiredMigrations(REQUIRED_MIGRATIONS).ok, true);
  assert.deepEqual(validateRequiredMigrations(REQUIRED_MIGRATIONS.slice(0, 3)).missing, ["20260722225700"]);
});

test("reset SQL backs up first, resets canonical ratings, and never touches auth or R2", () => {
  const backupSchema = buildBackupSchemaName(new Date("2026-07-22T12:34:56.000Z"));
  const sql = buildProductionResetSql({ backupSchema, projectRef: "olzxextphxpniwiiwwda" });
  assert.equal(backupSchema, "rankball_reset_backup_20260722123456z");
  assert.match(sql, /create schema "rankball_reset_backup_20260722123456z"/i);
  assert.match(sql, /create table "rankball_reset_backup_20260722123456z"\."matches"/i);
  assert.match(sql, /truncate table[\s\S]+public\."matches"[\s\S]+restart identity/i);
  assert.match(sql, /"integrated":1200,"modes":\{"1v1":1200,"2v2":1200,"3v3":1200,"5v5":1200\}/);
  assert.match(sql, /trust_score = 80/);
  assert.match(sql, /set mmr = 1200,[\s\S]+wins = 0,[\s\S]+losses = 0/);
  assert.match(sql, /update public\.affiliations[\s\S]+score = 0,[\s\S]+wins = 0,[\s\S]+losses = 0/);
  assert.match(sql, /update public\.approved_courts[\s\S]+completed_match_count = 0,[\s\S]+recommendation_score = round\(adjusted_rating::numeric, 3\)/);
  assert.match(sql, /update public\.courts[\s\S]+completed_match_count = 0,[\s\S]+recommendation_score = round\(adjusted_rating::numeric, 3\)/);
  assert.match(sql, /update public\.affiliations[\s\S]+where score is distinct from 0/);
  assert.match(sql, /update public\.approved_courts[\s\S]+where completed_match_count is distinct from 0/);
  assert.match(sql, /update public\.courts[\s\S]+where completed_match_count is distinct from 0/);
  assert.match(sql, /affiliations_match_snapshot/);
  assert.match(sql, /approved_courts_match_snapshot/);
  assert.match(sql, /courts_match_snapshot/);
  assert.match(sql, /rankball_reset_preserved_count_changed/);
  assert.match(sql, /rankball_reset_identity_count_changed/);
  assert.doesNotMatch(sql, /auth\.users/i);
  assert.doesNotMatch(sql, /storage\./i);
  assert.doesNotMatch(sql, /r2/i);
  assert.doesNotMatch(sql, /cascade/i);
});
