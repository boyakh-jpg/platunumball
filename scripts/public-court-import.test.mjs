import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateNormalizedImport } from "./import-public-courts.mjs";
import { approveCourtRequest, submitCourtRequest } from "../src/data/repository.js";

const migrationPath = new URL("../supabase/migrations/20260721230000_public_court_import_pipeline.sql", import.meta.url);
const nameNormalizationMigrationPath = new URL("../supabase/migrations/20260721233100_court_facility_name_normalization.sql", import.meta.url);
const publicAccessMigrationPath = new URL("../supabase/migrations/20260721234000_court_public_access.sql", import.meta.url);
const importRowCountFixMigrationPath = new URL("../supabase/migrations/20260722005203_public_court_import_row_count_fix.sql", import.meta.url);
const importStatementTimeoutMigrationPath = new URL("../supabase/migrations/20260722021500_public_court_import_statement_timeout.sql", import.meta.url);
const importFeedFastPathMigrationPath = new URL("../supabase/migrations/20260722022500_public_court_import_feed_trigger_fast_path.sql", import.meta.url);
const importFeedRecordFixMigrationPath = new URL("../supabase/migrations/20260722023000_public_court_import_feed_trigger_record_fix.sql", import.meta.url);
const importValidatedTriggerFastPathMigrationPath = new URL("../supabase/migrations/20260722024000_public_court_import_validated_trigger_fast_path.sql", import.meta.url);
const approvedPayloadNormalizationMigrationPath = new URL("../supabase/migrations/20260722220000_approved_court_payload_normalization.sql", import.meta.url);
const prepareScriptPath = new URL("./prepare-public-court-import.py", import.meta.url);

function readyRow(overrides = {}) {
  const courtId = overrides.id ?? "court_test_a";
  return {
    rowNumber: overrides.rowNumber ?? 2,
    disposition: "ready",
    issues: [],
    importKey: overrides.importKey ?? "a".repeat(64),
    court: {
      id: courtId,
      name: overrides.name ?? "테스트공원 농구장",
      hashtag: overrides.hashtag ?? "#12345",
      addressText: overrides.addressText ?? "서울특별시 마포구 테스트로 1",
      roadAddress: overrides.roadAddress ?? "서울특별시 마포구 테스트로 1",
      jibunAddress: null,
      lat: overrides.lat ?? 37.55,
      lng: overrides.lng ?? 126.91,
      sido: "서울특별시",
      sigungu: "마포구",
      courtUnit: overrides.courtUnit ?? null,
      multipleCourtsVerified: overrides.multipleCourtsVerified ?? false,
      publicAccess: overrides.publicAccess ?? "unknown",
      addressSource: "naver_reverse_geocode",
      geocodeVerified: true,
      verificationStatus: "source_verified",
      verifiedAt: "2026-07-21T00:00:00Z",
    },
    facilityInfo: {},
    sources: [{ id: `source_${courtId}`, provider: "openstreetmap", sourceRecordId: `osm:${courtId}` }],
  };
}

function documentWith(rows) {
  return {
    schemaVersion: 1,
    batchId: "public-courts-0123456789abcdef",
    source: { sha256: "b".repeat(64) },
    rows,
  };
}

test("local validator accepts distinct ready courts", () => {
  const first = readyRow();
  const second = readyRow({
    id: "court_test_b",
    rowNumber: 3,
    importKey: "c".repeat(64),
    hashtag: "#54321",
    name: "다른공원 농구장",
    addressText: "부산광역시 해운대구 테스트로 2",
    roadAddress: "부산광역시 해운대구 테스트로 2",
    lat: 35.16,
    lng: 129.16,
  });
  const result = validateNormalizedImport(documentWith([first, second]));
  assert.deepEqual(result.fatalErrors, []);
  assert.deepEqual(result.rowErrors, []);
  assert.equal(result.readyRows.length, 2);
});

test("local validator blocks same-location duplicates within one input", () => {
  const first = readyRow();
  const second = readyRow({
    id: "court_test_b",
    rowNumber: 3,
    importKey: "c".repeat(64),
    hashtag: "#54321",
    lat: 37.55001,
    lng: 126.91001,
  });
  const result = validateNormalizedImport(documentWith([first, second]));
  assert.ok(result.rowErrors.some((error) => error.code === "duplicate_ready_court"));
  assert.equal(result.readyRows.length, 1);
});

test("local validator permits explicitly verified court units at one facility", () => {
  const first = readyRow({ name: "테스트공원 A코트", courtUnit: "A코트", multipleCourtsVerified: true });
  const second = readyRow({
    id: "court_test_b",
    rowNumber: 3,
    importKey: "c".repeat(64),
    hashtag: "#54321",
    name: "테스트공원 B코트",
    courtUnit: "B코트",
    multipleCourtsVerified: true,
  });
  const result = validateNormalizedImport(documentWith([first, second]));
  assert.deepEqual(result.rowErrors, []);
  assert.equal(result.readyRows.length, 2);
});

test("local validator rejects invalid public access values", () => {
  const result = validateNormalizedImport(documentWith([readyRow({ publicAccess: "guessed" })]));
  assert.ok(result.rowErrors.some((error) => error.code === "invalid_public_access"));
  assert.equal(result.readyRows.length, 0);
});

test("migration keeps public import separate from user request side effects", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /create table if not exists public\.court_facility_info/i);
  assert.match(sql, /create table if not exists public\.court_source_records/i);
  assert.match(sql, /create table if not exists public\.court_import_batches/i);
  assert.match(sql, /create or replace function public\.rankball_import_public_courts/i);
  assert.match(sql, /insert into public\.approved_courts/i);
  assert.match(sql, /insert into public\.courts/i);
  assert.match(sql, /grant execute on function public\.rankball_import_public_courts[\s\S]*to service_role/i);
  assert.doesNotMatch(sql, /insert into public\.court_requests/i);
  assert.doesNotMatch(sql, /insert into public\.notifications/i);
  assert.doesNotMatch(sql, /insert into public\.admin_audit/i);
  assert.ok(sql.indexOf("if not p_apply then") < sql.indexOf("insert into public.court_import_batches"));
});

test("public import follow-up removes the row count variable collision", async () => {
  const sql = await readFile(importRowCountFixMigrationPath, "utf8");
  assert.match(sql, /input_row_count integer/i);
  assert.match(sql, /'''requestedRows'', input_row_count/i);
  assert.match(sql, /'''readyCount'', input_row_count/i);
  assert.match(sql, /rankball_import_public_courts_row_count_signature_changed/i);
  assert.match(sql, /rankball_import_public_courts_row_count_rewrite_incomplete/i);
  assert.doesNotMatch(sql, /drop table|truncate table|delete from/i);
});

test("public import RPC has a service-only bulk import timeout", async () => {
  const sql = await readFile(importStatementTimeoutMigrationPath, "utf8");
  assert.match(sql, /alter function public\.rankball_import_public_courts\(text, text, text, jsonb, boolean\)/i);
  assert.match(sql, /set statement_timeout = '60s'/i);
  assert.doesNotMatch(sql, /alter role|alter database|drop table|truncate table|delete from/i);
});

test("new public imports skip only the empty court feed refresh", async () => {
  const [sql, recordFixSql] = await Promise.all([
    readFile(importFeedFastPathMigrationPath, "utf8"),
    readFile(importFeedRecordFixMigrationPath, "utf8"),
  ]);
  assert.match(sql, /tg_op = 'INSERT'/i);
  assert.match(sql, /tg_table_name = 'approved_courts'/i);
  assert.match(sql, /registration_origin[\s\S]*public_import/i);
  assert.match(sql, /publicImportKey/i);
  assert.match(sql, /if tg_op = 'UPDATE'[\s\S]*rankball_refresh_court_feed_dependency/i);
  assert.doesNotMatch(sql, /drop trigger|disable trigger|drop table|truncate table|delete from/i);
  assert.match(recordFixSql, /to_jsonb\(new\)->>'registration_origin'/i);
  assert.match(recordFixSql, /to_jsonb\(new\)->'payload'->>'publicImportKey'/i);
  assert.doesNotMatch(recordFixSql, /drop trigger|disable trigger|drop table|truncate table|delete from/i);
});

test("service-only import wrapper skips only duplicate trigger rechecks", async () => {
  const sql = await readFile(importValidatedTriggerFastPathMigrationPath, "utf8");
  assert.match(sql, /create or replace function public\.rankball_import_public_courts_fast/i);
  assert.match(sql, /set_config\('rankball\.public_import_validated', 'on', true\)/i);
  assert.match(sql, /return public\.rankball_import_public_courts/i);
  assert.match(sql, /approved_courts_identity_guard[\s\S]*current_setting\('rankball\.public_import_validated', true\)/i);
  assert.match(sql, /courts_identity_guard[\s\S]*current_setting\('rankball\.public_import_validated', true\)/i);
  assert.match(sql, /grant execute on function public\.rankball_import_public_courts_fast[\s\S]*to service_role/i);
  assert.match(sql, /revoke all on function public\.rankball_import_public_courts_fast[\s\S]*from authenticated/i);
  assert.doesNotMatch(sql, /disable trigger|drop table|truncate table|delete from/i);
});

test("normalizer maps app fields and uses the official reverse-geocode endpoint", async () => {
  const source = await readFile(prepareScriptPath, "utf8");
  assert.match(source, /map_access/);
  assert.match(source, /"accessType": access_type/);
  assert.match(source, /"publicAccess": public_access/);
  assert.match(source, /def map_public_access/);
  assert.match(source, /reviewed_public_access in \{"public", "private"\}/);
  assert.match(source, /--name-reviews/);
  assert.match(source, /visual_map_review/);
  assert.match(source, /"reservationRequired": reservation_required/);
  assert.match(source, /"lighting": parse_bool/);
  assert.match(source, /https:\/\/maps\.apigw\.ntruss\.com\/map-reversegeocode\/v2\/gc/);
  assert.match(source, /"addressSource": address_source/);
  assert.match(source, /external_name_correction_ignored/);
  assert.doesNotMatch(source, /name_source = "naver_place"/);
});

test("court request and approved court rows keep public access as a separate enum", async () => {
  const sql = await readFile(publicAccessMigrationPath, "utf8");
  assert.match(sql, /alter table public\.court_requests[\s\S]*add column if not exists public_access text/i);
  assert.match(sql, /alter table public\.approved_courts[\s\S]*add column if not exists public_access text/i);
  assert.match(sql, /public_access in \('public', 'private', 'unknown'\)/i);
  assert.match(sql, /jsonb_build_object\('publicAccess', safe_public_access\)/i);
  assert.match(sql, /new\.public_access is distinct from old\.public_access/i);
  assert.match(sql, /rankball_sync_court_public_access\(\)[\s\S]*security definer/i);
  assert.doesNotMatch(sql, /drop table|truncate table|delete from/i);
});

test("court request public access survives approval", () => {
  const baseState = {
    currentUserId: "requester",
    users: [
      { id: "requester", name: "신청자", trustScore: 80 },
      { id: "admin", name: "관리자", trustScore: 100 },
    ],
    teams: [],
    affiliations: [],
    matches: [],
    reports: [],
    notifications: [],
    settings: {
      approvedCourts: [],
      courtRequests: [],
      courtReviews: [],
      adminAppointments: [{
        id: "admin-appointment",
        userId: "admin",
        role: "admin",
        grade: "owner",
        status: "active",
      }],
      adminDisciplinaryActions: [],
    },
  };
  const submitted = submitCourtRequest(baseState, {
    name: "한빛공원",
    addressText: "서울특별시 마포구 한빛로 1",
    lat: 37.55,
    lng: 126.92,
    publicAccess: "비공개",
  });
  const request = submitted.settings.courtRequests[0];

  assert.equal(request.publicAccess, "private");

  const approved = approveCourtRequest(
    { ...submitted, currentUserId: "admin" },
    request.id,
    { addressVerified: true, multipleCourtsVerified: true },
  );
  assert.equal(approved.settings.approvedCourts[0].publicAccess, "private");
});

test("approved courts keep relational data and only a minimal compatibility payload", async () => {
  const sql = await readFile(approvedPayloadNormalizationMigrationPath, "utf8");
  assert.match(sql, /create or replace function public\.rankball_slim_approved_court_payload/i);
  assert.match(sql, /new\.payload := public\.rankball_slim_approved_court_payload\(safe_payload\)/i);
  assert.match(sql, /new\.facility_name := safe_facility/i);
  assert.match(sql, /new\.paid := \(safe_payload->>'paid'\)::boolean/i);
  assert.match(sql, /create trigger approved_courts_sync_facility_info/i);
  assert.match(sql, /create trigger "00_courts_mirror_payload"/i);
  assert.match(sql, /court_row\.sigungu, court_row\.sido, court_row\.emd/i);
  assert.doesNotMatch(sql, /drop table|truncate table|delete from/i);
});

test("database court names use the same conservative normalization scope", async () => {
  const sql = await readFile(nameNormalizationMigrationPath, "utf8");
  assert.match(sql, /normalize\(coalesce\(raw_name, ''\), NFKC\)/);
  assert.match(sql, /농구\[\[:space:\]\]\*코트/);
  assert.match(sql, /\(\[0-9A-Za-z가-힣\]\)농구장/);
  assert.match(sql, /농구장\[\[:space:\]\]\*\(\[0-9\]\+\)/);
  assert.doesNotMatch(sql, /drop table|truncate table|delete from/i);
});
