import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getCourtMapUrl } from "../src/lib/courts.js";

const readSource = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("관리자 구장 DB는 전체 DB 서버 필터와 100행 페이지를 사용한다", async () => {
  const server = await readSource("server/api/admin/courts.js");
  assert.match(server, /const PAGE_SIZE = 100;/);
  assert.match(server, /from\("rankball_admin_court_database"\)/);
  assert.match(server, /from\("rankball_admin_court_change_history"\)/);
  assert.match(server, /applyCourtFilters\(query, body\.filters\)/);
  assert.match(server, /\.range\(offset, offset \+ PAGE_SIZE - 1\)/);
  assert.match(server, /rpc\("rankball_admin_update_court"/);
});

test("구장 편집은 고정 작업 열, 셀 복구, dropdown, 연락처와 URL을 제공한다", async () => {
  const [component, styles] = await Promise.all([
    readSource("src/components/admin/CourtDatabasePanel.jsx"),
    readSource("src/styles/globals.css"),
  ]);
  assert.match(component, /createPortal\(modal, document\.body\)/);
  assert.match(component, /role="dialog" aria-modal="true"/);
  assert.match(component, /const MAP_WINDOW_NAME = "rankball-court-map";/);
  assert.match(component, /values: \{ \.\.\.current\.values, \[patchKey\]: current\.original\[patchKey\] \}/);
  assert.match(component, /contactPhone/);
  assert.match(component, /officialUrl/);
  assert.match(component, /reservationUrl/);
  assert.match(component, /editor: "select", type: "status"/);
  assert.match(component, /verificationStatus: "review_required", operationalStatus: "pending", status: "hidden"/);
  assert.match(component, /status: "disabled"/);
  assert.match(styles, /\.court-db-modal \.court-db-table-wrap[\s\S]*?overflow: scroll;/);
  assert.match(styles, /\.court-db-modal \.court-db-table \.court-db-sticky-actions[\s\S]*?position: sticky;[\s\S]*?left: 0;/);
  assert.match(styles, /\.court-db-table \.court-db-cell-dirty select/);
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

test("지도 링크와 팝업은 확대 18 및 재사용 가능한 거리뷰 화면을 사용한다", async () => {
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
  assert.equal(mapUrl.searchParams.get("lat"), "37.5665");
  assert.equal(mapUrl.searchParams.get("lng"), "126.978");
  assert.equal(mapUrl.searchParams.get("zoom"), "18");
  assert.equal(mapUrl.searchParams.get("title"), "서울특별시 중구 세종대로 110");
  assert.match(popup, /const MAP_ZOOM = 18;/);
  assert.match(popup, /new maps\.Panorama/);
  assert.match(popup, /window\.clearTimeout\(panoramaTimer\)/);
  assert.match(loader, /export async function loadNaverPanoramaSdk/);
  assert.match(loader, /maps-panorama\.js/);
  assert.match(app, /path="\/app\/admin\/court-map"/);
});
