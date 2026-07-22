import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getCourtFacilityBaseName, getCourtMapUrl } from "../src/lib/courts.js";

const readSource = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("관리자 구장 DB는 전체 DB 서버 필터와 100행 페이지를 사용한다", async () => {
  const server = await readSource("server/api/admin/courts.js");
  assert.match(server, /const PAGE_SIZE = 100;/);
  assert.match(server, /from\("rankball_admin_court_database"\)/);
  assert.match(server, /from\("rankball_admin_court_change_history"\)/);
  assert.match(server, /applyCourtFilters\(query, body\.filters\)/);
  assert.match(server, /\.range\(offset, offset \+ PAGE_SIZE - 1\)/);
  assert.match(server, /rpc\("rankball_admin_update_court"/);
  assert.match(server, /rpc\("rankball_admin_update_courts_batch"/);
  assert.match(server, /TEMPORARY_REASON_OPTIONAL_PROFILE_ID = "p_a6086f1e61b34ebca4"/);
  assert.match(server, /TEMPORARY_COURT_UPDATE_REASON = "한시적 boyakh 구장 DB 정리"/);
  assert.match(server, /name_evidence_decision/);
  assert.match(server, /applyExactFilter\(next, "name_evidence_relation", filters\.nameEvidenceRelation\)/);
});

test("구장 편집은 즉시 셀 편집, 일괄 저장, 셀 복구, dropdown을 제공한다", async () => {
  const [component, styles] = await Promise.all([
    readSource("src/components/admin/CourtDatabasePanel.jsx"),
    readSource("src/styles/globals.css"),
  ]);
  assert.match(component, /createPortal\(modal, document\.body\)/);
  assert.match(component, /role="dialog" aria-modal="true"/);
  assert.match(component, /const MAP_WINDOW_NAME = "rankball-court-map";/);
  assert.match(component, /href=\{getCourtMapUrl\(row, \{ zoom: 18 \}\)\} target=\{MAP_WINDOW_NAME\}/);
  assert.doesNotMatch(component, /getMapPopupUrl/);
  assert.doesNotMatch(component, /\/app\/admin\/court-map\?/);
  assert.match(component, /updateDraftValues\(row, \{ \[patchKey\]: original\[patchKey\] \}\)/);
  assert.match(component, /saveAdminCourtBatch/);
  assert.match(component, /일괄 저장/);
  assert.match(component, /activateCell\(row, column\)/);
  assert.doesNotMatch(component, /수정 버튼을 누르면/);
  assert.match(component, /contactPhone/);
  assert.match(component, /officialUrl/);
  assert.match(component, /reservationUrl/);
  assert.match(component, /editor: "select", type: "status"/);
  assert.match(component, /verificationStatus: "review_required", operationalStatus: "pending", status: "hidden"/);
  assert.match(component, /status: "disabled"/);
  assert.match(component, /nameEvidenceDecision/);
  assert.match(component, /nameEvidenceAppliedFacility/);
  assert.match(component, /rowKey: "name_evidence_decision", patchKey: "nameEvidenceDecision"/);
  assert.match(component, /rowKey: "name_evidence_application_status", patchKey: "nameEvidenceApplicationStatus"/);
  assert.match(component, /rowKey: "name_evidence_proposed_facility", patchKey: "nameEvidenceProposedFacility"/);
  assert.match(component, /rowKey: "name_evidence_applied_facility", patchKey: "nameEvidenceAppliedFacility"/);
  assert.match(component, /function isColumnEditable\(row, column\)/);
  assert.match(component, /!column\.requiresNameEvidence \|\| Boolean\(row\.name_evidence_decision\)/);
  assert.match(component, />OSM 열기</);
  assert.match(styles, /\.court-db-modal \.court-db-table-wrap[\s\S]*?overflow: scroll;/);
  assert.match(styles, /\.court-db-modal \.court-db-table \.court-db-sticky-actions[\s\S]*?position: sticky;[\s\S]*?left: 0;/);
  assert.match(styles, /\.court-db-modal \.court-db-filter-row input,[\s\S]*?height: 18px;/);
  assert.match(styles, /\.court-db-modal \.court-db-sort span[\s\S]*?text-overflow: ellipsis;/);
  assert.match(styles, /\.court-db-table \.court-db-cell-dirty select/);
});

test("OSM 명칭 근거는 30m 자동·80m 검수 경계와 수동 보호를 강제한다", async () => {
  const [migration, identityFix] = await Promise.all([
    readSource("supabase/migrations/20260722231000_osm_court_name_evidence.sql"),
    readSource("supabase/migrations/20260722231200_legacy_court_row_identity_variable_fix.sql"),
  ]);
  assert.match(migration, /distance_m >= 0 and distance_m <= 80/);
  assert.match(migration, /safe_relation = 'nearby' and safe_distance between 0 and 30/);
  assert.match(migration, /safe_distance > 30 and safe_distance <= 80/);
  assert.match(migration, /osm_court_name_review_candidate_not_applicable/);
  assert.match(migration, /application_status = 'skipped_manual'/);
  assert.match(migration, /application_status = 'skipped_duplicate'/);
  assert.match(migration, /name_modified_by = 'system'/);
  assert.doesNotMatch(migration, /\bdelete\s+from\s+public\.approved_courts/i);
  assert.match(identityFix, /approved\.court_unit/);
});

test("괄호가 포함된 시설명은 닫는 괄호를 보존한다", () => {
  assert.equal(getCourtFacilityBaseName("중앙공원 9지구 (광장지구)"), "중앙공원 9지구 (광장지구)");
});

test("관리자 구장 수정 RPC는 관계형 원본과 시설 정보 및 감사 로그를 함께 유지한다", async () => {
  const migration = await readSource("supabase/migrations/20260722224000_admin_court_database_editor.sql");
  assert.match(migration, /create or replace view public\.rankball_admin_court_database/);
  assert.match(migration, /left join public\.court_facility_info/);
  assert.match(migration, /create or replace function public\.rankball_admin_update_court/);
  assert.match(migration, /insert into public\.court_facility_info/);
  assert.match(migration, /insert into public\.admin_audit_log/);
  assert.match(migration, /'court_database_update'/);
  assert.match(migration, /'contactPhone'/);
  assert.match(migration, /'officialUrl'/);
  assert.match(migration, /'status'.*?'active'.*?'hidden'.*?'disabled'/s);
  assert.doesNotMatch(migration, /\bdelete\s+from\s+public\.approved_courts/i);
});

test("구장 일괄 저장 RPC는 최대 100개를 한 transaction에서 처리한다", async () => {
  const migration = await readSource("supabase/migrations/20260722224500_admin_court_batch_update.sql");
  assert.match(migration, /create or replace function public\.rankball_admin_update_courts_batch/);
  assert.match(migration, /jsonb_array_length\(p_updates\) > 100/);
  assert.match(migration, /for update_item in select item from jsonb_array_elements\(p_updates\)/);
  assert.match(migration, /public\.rankball_admin_update_court\(/);
  assert.match(migration, /grant execute on function public\.rankball_admin_update_courts_batch/);
  assert.doesNotMatch(migration, /\bdelete\s+from\s+public\.approved_courts/i);
});

test("관리자 명칭 판정 수정은 파생 근거의 검수 필드만 감사 로그와 함께 저장한다", async () => {
  const migration = await readSource("supabase/migrations/20260722232000_admin_court_name_evidence_editor.sql");
  assert.match(migration, /create or replace function public\.rankball_admin_update_court_name_evidence/);
  assert.match(migration, /'nameEvidenceDecision'/);
  assert.match(migration, /'nameEvidenceApplicationStatus'/);
  assert.match(migration, /'nameEvidenceProposedFacility'/);
  assert.match(migration, /'nameEvidenceAppliedFacility'/);
  assert.match(migration, /update public\.court_name_evidence/);
  assert.match(migration, /insert into public\.admin_audit_log/);
  assert.match(migration, /'court_database_update'/);
  assert.match(migration, /core_patch/);
  assert.match(migration, /evidence_patch/);
  assert.match(migration, /public\.rankball_admin_update_court_name_evidence\(/);
  assert.doesNotMatch(migration, /\bdelete\s+from\s+public\.(?:approved_courts|court_name_evidence)/i);
});

test("네이버 지도 웹 링크와 내부 팝업은 확대 18 지도 URL을 공유한다", async () => {
  const [popup, loader, app] = await Promise.all([
    readSource("src/pages/AdminCourtMapPopup.jsx"),
    readSource("src/lib/naverAddress.js"),
    readSource("src/App.jsx"),
  ]);
  const mapUrl = new URL(getCourtMapUrl({
    name: "테스트 농구장",
    road_address: "서울특별시 중구 세종대로 110",
    lat: 37.5665,
    lng: 126.978,
  }, { zoom: 18 }));
  assert.equal(mapUrl.pathname, "/p");
  assert.equal(mapUrl.searchParams.get("c"), "126.978,37.5665,18,0,0,0,dh");
  assert.match(popup, /const MAP_ZOOM = 18;/);
  assert.match(popup, /new maps\.Panorama/);
  assert.match(popup, /window\.clearTimeout\(panoramaTimer\)/);
  assert.match(loader, /export async function loadNaverPanoramaSdk/);
  assert.match(loader, /maps-panorama\.js/);
  assert.match(app, /path="\/app\/admin\/court-map"/);
});
