import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateNormalizedImport } from "./import-public-courts.mjs";

const migrationPath = new URL("../supabase/migrations/20260721230000_public_court_import_pipeline.sql", import.meta.url);
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

test("normalizer maps app fields and uses the official reverse-geocode endpoint", async () => {
  const source = await readFile(prepareScriptPath, "utf8");
  assert.match(source, /map_access/);
  assert.match(source, /"accessType": access_type/);
  assert.match(source, /"reservationRequired": reservation_required/);
  assert.match(source, /"lighting": parse_bool/);
  assert.match(source, /https:\/\/maps\.apigw\.ntruss\.com\/map-reversegeocode\/v2\/gc/);
  assert.match(source, /"addressSource": address_source/);
});
