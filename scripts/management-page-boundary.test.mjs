import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createRoomModalOpeners } from "../src/lib/roomModalNavigation.js";
import {
  requestMatchDetailOnce,
} from "../src/pages/matchesPageModel.js";

const root = path.resolve(new URL("../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const read = (relativePath) => readFile(path.join(root, relativePath), "utf8");

const managementModules = [
  "src/pages/Settings.jsx",
  "src/pages/settingsPageModel.js",
  "src/pages/useSettingsPageController.jsx",
  "src/pages/useSettingsReportController.jsx",
  "src/pages/useSettingsCourtRequestController.js",
  "src/pages/useSettingsFavorites.jsx",
  "src/pages/useSettingsRefereeController.js",
  "src/pages/SettingsPageView.jsx",
  "src/pages/SettingsPrimaryColumn.jsx",
  "src/pages/SettingsSideColumn.jsx",
  "src/pages/SettingsRefereeSection.jsx",
  "src/pages/SettingsReportCard.jsx",
  "src/pages/Admin.jsx",
  "src/pages/adminPageModel.js",
  "src/pages/AdminPageParts.jsx",
  "src/pages/AdminAppointmentSection.jsx",
  "src/pages/AdminDetailPanel.jsx",
  "src/pages/useAdminPageController.jsx",
  "src/pages/AdminPageView.jsx",
  "src/components/admin/CourtDatabasePanel.jsx",
  "src/components/admin/courtDatabaseModel.js",
  "src/components/admin/CourtDatabaseControls.jsx",
  "src/components/admin/CourtDatabaseDuplicateReview.jsx",
  "src/components/admin/useCourtDatabasePanelActions.js",
  "src/components/admin/useCourtDatabasePanelController.js",
  "src/components/admin/CourtDatabasePanelView.jsx",
  "src/pages/Matches.jsx",
  "src/pages/matchesPageSelectors.js",
  "src/pages/matchesPageBaseSelectors.js",
  "src/pages/matchesPageModel.js",
  "src/pages/MatchesPagePanels.jsx",
  "src/pages/useMatchesPageController.jsx",
  "src/pages/useMatchAttendanceQrScan.js",
  "src/pages/MatchesPageView.jsx",
  "src/pages/MatchRoom.jsx",
  "src/pages/matchRoomModel.js",
  "src/pages/matchRoomControllerParts.jsx",
  "src/pages/MatchRoomParts.jsx",
  "src/pages/MatchRoomReviewPanels.jsx",
  "src/pages/MatchRoomStatEditor.jsx",
  "src/pages/MatchRoomView.jsx",
  "src/pages/TournamentDetail.jsx",
  "src/pages/tournamentDetailModel.jsx",
  "src/pages/TournamentCompetitionSection.jsx",
  "src/pages/TournamentDetailView.jsx",
];

function resolveImport(fromPath, specifier) {
  if (!specifier.startsWith(".")) return "";
  const candidate = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), specifier));
  return managementModules.includes(candidate) ? candidate : "";
}

test("대형 관리 화면 진입 파일은 controller와 view 조합만 소유한다", async () => {
  const entries = [
    ["src/pages/Settings.jsx", "useSettingsPageController", "SettingsPageView"],
    ["src/pages/Admin.jsx", "useAdminPageController", "AdminPageView"],
    ["src/components/admin/CourtDatabasePanel.jsx", "useCourtDatabasePanelController", "CourtDatabasePanelView"],
  ];

  for (const [file, controller, view] of entries) {
    const source = await read(file);
    assert.ok(source.split(/\r?\n/).length < 500, `${file}는 500줄 미만이어야 합니다.`);
    assert.match(source, new RegExp(`import ${controller}`));
    assert.match(source, new RegExp(`import ${view}`));
    assert.match(source, new RegExp(`const controller = ${controller}\\(props\\)`));
    assert.doesNotMatch(source, /\buse(?:Effect|Memo|Ref|State)\b|app\.actions\./);
  }
});

test("관리 화면 분리 모듈은 공개 export와 단방향 의존을 유지한다", async () => {
  const sources = Object.fromEntries(await Promise.all(managementModules.map(async (file) => [file, await read(file)])));
  for (const [file, source] of Object.entries(sources)) {
    assert.ok(source.split(/\r?\n/).length <= 500, `${file}는 500줄 이하여야 합니다.`);
  }
  assert.match(sources["src/pages/settingsPageModel.js"], /export const SETTINGS_SECTIONS/);
  assert.match(sources["src/pages/useSettingsPageController.jsx"], /export default function useSettingsPageController/);
  assert.match(sources["src/pages/SettingsPageView.jsx"], /export default function SettingsPageView/);
  assert.match(sources["src/pages/adminPageModel.js"], /export const ADMIN_SECTION_OPTIONS/);
  assert.match(sources["src/pages/AdminPageParts.jsx"], /export function RatingPolicyPanel/);
  assert.match(sources["src/components/admin/courtDatabaseModel.js"], /export const COURT_COLUMNS/);
  assert.match(sources["src/components/admin/CourtDatabaseControls.jsx"], /export function CellEditor/);
  assert.match(sources["src/pages/Matches.jsx"], /export \{ MatchRoomModal \} from "\.\/MatchesPagePanels\.jsx"/);
  assert.match(sources["src/pages/matchesPageSelectors.js"], /export function getMatchRoomPost/);
  assert.match(sources["src/pages/matchesPageModel.js"], /export function requestMatchDetailOnce/);
  assert.match(sources["src/pages/MatchRoom.jsx"], /<MatchRoomView controller=\{controller\}/);
  assert.match(sources["src/pages/TournamentDetail.jsx"], /<TournamentDetailView controller=\{controller\}/);

  const graph = Object.fromEntries(managementModules.map((file) => {
    const dependencies = [...sources[file].matchAll(/from\s+["']([^"']+)["']/g)]
      .map((match) => resolveImport(file, match[1]))
      .filter(Boolean);
    return [file, dependencies];
  }));
  const visiting = new Set();
  const visited = new Set();
  const visit = (file) => {
    assert.ok(!visiting.has(file), `순환 import: ${[...visiting, file].join(" -> ")}`);
    if (visited.has(file)) return;
    visiting.add(file);
    graph[file].forEach(visit);
    visiting.delete(file);
    visited.add(file);
  };
  managementModules.forEach(visit);
});

test("공용 방 모달 이동과 경기 상세 로더는 상태 전환을 한곳에서 처리한다", async () => {
  let selectedMatchId = "old-match";
  let selectedRecruitingPostId = "old-post";
  const loadedPosts = [];
  const openers = createRoomModalOpeners({
    setSelectedMatchId: (value) => { selectedMatchId = value; },
    setSelectedRecruitingPostId: (value) => { selectedRecruitingPostId = value; },
    loadRecruitingPost: (postId) => loadedPosts.push(postId),
  });

  openers.openMatchRoom("match-1");
  assert.equal(selectedMatchId, "match-1");
  assert.equal(selectedRecruitingPostId, "");
  openers.openRecruitingRoom("post-1");
  assert.equal(selectedMatchId, "");
  assert.equal(selectedRecruitingPostId, "post-1");
  assert.deepEqual(loadedPosts, ["post-1"]);

  const requestedMatchDetails = new Set();
  let unavailableCount = 0;
  let settledCount = 0;
  await requestMatchDetailOnce({
    matchId: "missing-match",
    requestedMatchDetails,
    loadMatchDetail: async () => 0,
    onUnavailable: () => { unavailableCount += 1; },
    onSettled: () => { settledCount += 1; },
  });
  assert.equal(requestedMatchDetails.has("missing-match"), false);
  assert.equal(unavailableCount, 1);
  assert.equal(settledCount, 1);
});

test("방 슬롯 위치 아바타 상수는 실제 렌더 모듈이 소유한다", async () => {
  const slotSource = await read("src/components/recruiting/RecruitingRoomSlotCore.jsx");
  const recruitingPageSource = await read("src/pages/Recruiting.jsx");

  assert.match(slotSource, /const ROOM_SLOT_POSITION_AVATARS = \{/);
  assert.match(slotSource, /ROOM_SLOT_POSITION_AVATARS\[normalizedPosition\]/);
  assert.doesNotMatch(recruitingPageSource, /ROOM_SLOT_POSITION_AVATARS/);
});

test("recruiting split view imports its card render dependencies", async () => {
  const recruitingViewSource = await read("src/pages/RecruitingPageView.jsx");
  const recruitingPageSource = await read("src/lib/recruitingPage.js");

  assert.match(recruitingViewSource, /import MatchListCard from "\.\.\/components\/match\/MatchListCard\.jsx"/);
  assert.match(recruitingViewSource, /getRecruitingCardTitle\s*\} from "\.\.\/lib\/recruitingPage\.js"/);
  assert.match(recruitingViewSource, /const roomTitle = getRecruitingCardTitle\(post\)/);
  assert.match(recruitingViewSource, /<MatchListCard/);
  assert.match(recruitingPageSource, /export function getRecruitingCardTitle\(post\)/);
});
