import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const operationalHealthSource = readFileSync(
  new URL("../supabase/migrations/20260719122000_operational_data_canonicalization.sql", import.meta.url),
  "utf8",
);
const retentionSource = readFileSync(
  new URL("../supabase/migrations/20260718142500_room_feed_retention_7_days.sql", import.meta.url),
  "utf8",
);
const softQuarantineSource = readFileSync(
  new URL("../supabase/migrations/20260729164000_soft_quarantine_active_simulation_matches.sql", import.meta.url),
  "utf8",
);
const preservedCourtDecisionSource = readFileSync(
  new URL("../supabase/migrations/20260727143000_preserve_approved_court_requests_in_quarantine.sql", import.meta.url),
  "utf8",
);
const productionAuditSource = readFileSync(
  new URL("./audit-production-data.mjs", import.meta.url),
  "utf8",
);

test("active match feed health remains strict for abandoned simulation matches", () => {
  assert.match(
    operationalHealthSource,
    /select 'activeMatchMissingFeed' check_name,[\s\S]*?match_row\.status in \('agreed', 'live', 'approval', 'disputed'\)[\s\S]*?feed\.is_active/,
  );
  assert.doesNotMatch(
    operationalHealthSource,
    /activeMatchMissingFeed[\s\S]*?match_row\.id not like 'sim/,
  );
});

test("simulation quarantine soft-closes sim match sources without deleting data", () => {
  assert.match(
    softQuarantineSource,
    /match_row\.id like 'sim\\_m\\_%' escape '\\'/,
  );
  assert.match(
    softQuarantineSource,
    /match_row\.status in \('agreed', 'live', 'approval', 'disputed'\)/,
  );
  assert.match(
    softQuarantineSource,
    /match_row\.tournament_id is null/,
  );
  assert.match(
    softQuarantineSource,
    /match_row\.updated_at < p_now - interval '24 hours'/,
  );
  assert.match(
    softQuarantineSource,
    /else 'simulation_artifact'/,
  );
  assert.match(
    softQuarantineSource,
    /select public\.rankball_quarantine_simulation_artifacts\(now\(\)\)/,
  );
  assert.doesNotMatch(softQuarantineSource, /\bdelete\s+from\b/i);
  assert.doesNotMatch(softQuarantineSource, /\btruncate\b/i);
  assert.doesNotMatch(softQuarantineSource, /\bdrop\s+table\b/i);
});

test("simulation quarantine refreshes derived profile and court data for sim matches", () => {
  assert.match(
    softQuarantineSource,
    /player\.match_id like 'm\\_seed\\_%' escape '\\'[\s\S]*?player\.match_id like 'sim\\_m\\_%' escape '\\'/,
  );
  assert.match(
    softQuarantineSource,
    /quarantined_match\.rules->>'quarantineReason' = 'simulation_artifact'/,
  );
  assert.match(
    softQuarantineSource,
    /old_court_refresh_filter[\s\S]*?match_row\.id like 'm\\_seed\\_%' escape '\\'[\s\S]*?new_court_refresh_filter[\s\S]*?match_row\.id like 'sim\\_m\\_%' escape '\\'[\s\S]*?match_row\.rules->>'quarantineReason' = 'simulation_artifact'/,
  );
  assert.match(
    softQuarantineSource,
    /rankball_quarantine_simulation_profile_refresh_filter_unexpected/,
  );
  assert.match(
    softQuarantineSource,
    /rankball_quarantine_simulation_court_refresh_filter_unexpected/,
  );
});

test("fresh and confirmed simulation match feeds stay active until the source is quarantined", () => {
  assert.match(
    softQuarantineSource,
    /feed\.entity_type <> 'match'[\s\S]*?quarantined_match\.id = feed\.entity_id[\s\S]*?quarantined_match\.rules->>'quarantineReason' = 'simulation_artifact'/,
  );
  assert.match(
    softQuarantineSource,
    /card\.entity_type <> 'match'[\s\S]*?quarantined_match\.id = card\.entity_id[\s\S]*?quarantined_match\.rules->>'quarantineReason' = 'simulation_artifact'/,
  );
  assert.match(
    softQuarantineSource,
    /rankball_quarantine_simulation_feed_filter_unexpected/,
  );
  assert.match(
    softQuarantineSource,
    /rankball_quarantine_simulation_card_filter_unexpected/,
  );
});

test("simulation quarantine keeps terminal court request decisions protected", () => {
  assert.match(
    preservedCourtDecisionSource,
    /request\.status not in \(''approved'', ''rejected'', ''simulation_closed''\)/,
  );
  assert.match(
    softQuarantineSource,
    /rankball_quarantine_simulation_artifacts_unexpected|rankball_quarantine_simulation_match_filter_unexpected/,
  );
});

test("inactive feed and quarantined cards remain seven-day retention warnings", () => {
  assert.match(
    operationalHealthSource,
    /select 'inactiveFeedSourceMissing' check_name/,
  );
  assert.match(
    operationalHealthSource,
    /select 'quarantinedCardAwaitingRetention', count\(\*\)/,
  );
  assert.match(retentionSource, /interval '7 days'/);
  assert.match(
    retentionSource,
    /delete from public\.user_room_feed feed[\s\S]*?feed\.is_active = false[\s\S]*?feed\.updated_at < retention_cutoff/,
  );
  assert.match(
    retentionSource,
    /delete from public\.room_feed_cards card[\s\S]*?card\.updated_at < retention_cutoff[\s\S]*?feed\.is_active = true/,
  );
});

test("production audit reports failure without terminating active Node handles", () => {
  assert.match(productionAuditSource, /process\.exitCode = 1/);
  assert.doesNotMatch(productionAuditSource, /process\.exit\(1\)/);
});
