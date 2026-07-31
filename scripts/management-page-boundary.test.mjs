import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createRoomModalOpeners } from "../src/lib/roomModalNavigation.js";
import {
  requestMatchDetailOnce,
} from "../src/pages/matchesPageModel.js";
import { isProfileGateReady } from "../src/lib/profileSetup.js";

const root = path.resolve(new URL("../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const read = (relativePath) => readFile(path.join(root, relativePath), "utf8");

test("가입정보 guard는 현재 인증 사용자의 프로필 hydration 뒤에만 판정한다", () => {
  assert.equal(isProfileGateReady({}), true);
  assert.equal(isProfileGateReady({ authUserId: "auth-1", remoteReady: false, serverProfileBound: true }), false);
  assert.equal(isProfileGateReady({ authUserId: "auth-1", profileAuthUserId: "auth-2", remoteReady: true, serverProfileBound: true }), false);
  assert.equal(isProfileGateReady({ authUserId: "auth-1", profileAuthUserId: "auth-1", remoteReady: true, serverProfileBound: true }), true);
  assert.equal(isProfileGateReady({ authUserId: "test-rankball-001", remoteReady: true, serverProfileBound: false }), true);
});

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
  assert.match(sources["src/pages/useSettingsPageController.jsx"], /selectedBlockUserId = blockUserId && blockUserId !== app\.currentUserId && !blockedUserIds\.includes\(blockUserId\)/);
  assert.match(sources["src/pages/SettingsPageView.jsx"], /export default function SettingsPageView/);
  assert.match(sources["src/pages/adminPageModel.js"], /export const ADMIN_SECTION_OPTIONS/);
  assert.match(sources["src/pages/AdminPageParts.jsx"], /export function RatingPolicyPanel/);
  assert.match(sources["src/components/admin/courtDatabaseModel.js"], /export const COURT_COLUMNS/);
  assert.match(sources["src/components/admin/CourtDatabaseControls.jsx"], /export function CellEditor/);
  assert.doesNotMatch(
    sources["src/components/admin/useCourtDatabasePanelController.js"],
    /^\s*modal,\s*$/m,
  );
  assert.match(sources["src/pages/Matches.jsx"], /export \{ MatchRoomModal \} from "\.\/MatchesPagePanels\.jsx"/);
  assert.match(sources["src/pages/MatchesPagePanels.jsx"], /onRetry=\{this\.handleRetry\}/);
  assert.match(sources["src/pages/MatchesPagePanels.jsx"], /onRetry=\{retryMatchDetail\}/);
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

test("로컬 신고 흐름은 원격 경기 조회 실패로 로컬 경기 검색을 막지 않는다", async () => {
  const source = await read("src/pages/useSettingsReportController.jsx");
  assert.match(source, /if \(!isSupabaseConfigured\) return;/);
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

test("recruiting chat polling imports its canonical merge helpers directly", async () => {
  const recruitingActionsSource = await read("src/hooks/appData/actions/recruitingActions.js");

  assert.match(
    recruitingActionsSource,
    /import\s*\{\s*getRecruitingChatLastSeq,\s*mergeRecruitingChatMessageBatch,\s*\}\s*from "\.\.\/remoteMerge\.js"/,
  );
  assert.match(
    recruitingActionsSource,
    /import\s*\{\s*isSyntheticMatchRoomId\s*\}\s*from "\.\.\/\.\.\/\.\.\/lib\/recruiting\.js"/,
  );
  const contextStart = recruitingActionsSource.indexOf("const {");
  const contextEnd = recruitingActionsSource.indexOf("} = context;", contextStart);
  const contextSource = recruitingActionsSource.slice(contextStart, contextEnd);
  assert.doesNotMatch(
    contextSource,
    /getRecruitingChatLastSeq|mergeRecruitingChatMessageBatch|isSyntheticMatchRoomId/,
  );
});

test("remote team invite selection keeps its roster snapshot and one empty state", async () => {
  const [panelSource, primarySource, slotSource] = await Promise.all([
    read("src/components/recruiting/RecruitingRoomInvitePanels.jsx"),
    read("src/components/recruiting/RecruitingRoomPrimarySection.jsx"),
    read("src/components/recruiting/RecruitingRoomSlotRenderers.jsx"),
  ]);

  assert.match(panelSource, /const rosterTeam = teamSummonMode \? allowedTeam : selectedTeam \?\? matchedTeam/);
  assert.match(panelSource, /selectedTeam: team, selectedPlayerIds: \[\]/);
  assert.match(panelSource, /selectedTeam: null, selectedPlayerIds: \[\]/);
  assert.doesNotMatch(panelSource, /arena-invite-empty">검색 결과 없음/);
  assert.match(primarySource, /selectedTeam=\{activeInviteDraft\.selectedTeam \?\? null\}/);
  assert.match(slotSource, /selectedTeam=\{activeSlotDraft\.selectedTeam \?\? null\}/);
});

test("legacy match paths redirect to the shared match modal query", async () => {
  const source = await read("src/App.jsx");

  assert.match(source, /function LegacyMatchRoomRedirect\(\)/);
  assert.match(source, /new URLSearchParams\(location\.search\)/);
  assert.match(source, /searchParams\.set\("match", matchId\)/);
  assert.match(
    source,
    /<Route path="\/app\/matches\/:matchId" element=\{<LegacyMatchRoomRedirect \/>\} \/>/,
  );
  assert.doesNotMatch(source, /const MatchRoom = lazy/);
});

test("계정·설정 변경은 선택 대상과 저장 요청을 안전하게 직렬화한다", async () => {
  const [
    adminController,
    serverActions,
    profileActions,
    profilePage,
    signupPage,
    settingsController,
    courtController,
    notificationsPage,
    authSession,
    loginPage,
    sidebar,
  ] = await Promise.all([
    read("src/pages/useAdminPageController.jsx"),
    read("src/hooks/appData/orchestrator/serverActions.js"),
    read("src/hooks/appData/actions/profileTeamActions.js"),
    read("src/pages/Profile.jsx"),
    read("src/pages/Signup.jsx"),
    read("src/pages/useSettingsPageController.jsx"),
    read("src/pages/useSettingsCourtRequestController.js"),
    read("src/pages/Notifications.jsx"),
    read("src/hooks/useAuthSession.js"),
    read("src/pages/Login.jsx"),
    read("src/components/layout/Sidebar.jsx"),
  ]);

  assert.match(adminController, /const changeAppointmentUserQuery = \(value\) => \{[\s\S]{0,420}setAppointmentUserSnapshot\(null\);[\s\S]{0,100}userId: ""/u);
  assert.match(adminController, /setAppointmentUserQuery: changeAppointmentUserQuery/u);
  assert.match(serverActions, /pendingFavoriteMutationsRef\.current\.get\(mutationKey\)/u);
  assert.match(serverActions, /pendingFavoriteMutationsRef\.current\.delete\(mutationKey\)/u);
  assert.match(profileActions, /if \(!result \|\| result\.ok === false\) \{[\s\S]{0,160}rollbackServerMutation\(rollbackState, "프로필 저장"/u);
  assert.match(profileActions, /deleteTeam: async \(teamId\) => \{[\s\S]{0,1200}const result = await deleteTeamServer\(teamId, syncedNotifications\)/u);
  assert.match(profileActions, /if \(result && result\.ok !== false\) \{[\s\S]{0,180}setState\(\(prev\) => deleteTeam/u);
  assert.match(profileActions, /if \(!deleted\) return \{ ok: false, error: "team_delete_rejected" \}/u);
  assert.match(profilePage, /profileSavePendingRef\.current/u);
  assert.match(signupPage, /if \(!result \|\| result\.ok === false\)/u);
  assert.match(settingsController, /generalSettingsSavePendingRef\.current/u);
  assert.match(settingsController, /if \(!result \|\| result\.ok === false\) throw new Error\(result\?\.error \|\| "discord_profile_save_failed"\)/u);
  assert.match(settingsController, /if \(!settingsResult \|\| settingsResult\.ok === false\)/u);
  assert.match(settingsController, /if \(!profileResult \|\| profileResult\.ok === false\)/u);
  assert.match(courtController, /courtAddressSearchRef\.current !== requestId/u);
  assert.match(courtController, /courtPinPendingRef\.current/u);
  assert.match(courtController, /courtSubmitPendingRef\.current/u);
  assert.match(notificationsPage, /pendingInvitationKeysRef\.current\.has\(key\)/u);
  assert.match(notificationsPage, /setNotificationDeleteError\(\{ id: notificationId/u);
  assert.match(notificationsPage, /directoryLoaded === false && app\.serverProfileBound/u);
  assert.match(authSession, /authActionPendingRef\.current/u);
  assert.match(authSession, /catch \(authError\)[\s\S]{0,180}finally/u);
  assert.match(authSession, /catch \(signOutError\)[\s\S]{0,180}finally/u);
  assert.match(loginPage, /disabled=\{auth\.authActionPending \|\| auth\.testLoginPending\}/u);
  assert.match(sidebar, /disabled=\{auth\.authActionPending\}/u);
});

test("관리자 조치는 현재 선택 대상과 서버 전체 대기 건수를 보존한다", async () => {
  const [controller, pageView, detailPanel, appointmentSection, userOperations, adminLoader] = await Promise.all([
    read("src/pages/useAdminPageController.jsx"),
    read("src/pages/AdminPageView.jsx"),
    read("src/pages/AdminDetailPanel.jsx"),
    read("src/pages/AdminAppointmentSection.jsx"),
    read("src/components/admin/UserOperationsPanel.jsx"),
    read("server/api/directory/loadAdminSection.js"),
  ]);

  assert.match(controller, /activeAppointmentOptions\.some\(\(row\) => row\.id === appointmentDraft\.appointmentId\)/u);
  assert.match(controller, /const appointmentId = [\s\S]{0,180}\? selectedActiveAppointmentId/u);
  assert.match(appointmentSection, /select value=\{selectedActiveAppointmentId\} disabled=\{appointmentActionPending\}/u);
  assert.match(controller, /const requestReportId = selectedReport\.id;[\s\S]{0,180}selectedReportIdRef\.current === requestReportId/u);
  assert.match(controller, /const requestCourtId = selectedCourtRequest\.id;[\s\S]{0,420}selectedCourtRequestIdRef\.current === requestCourtId/u);
  assert.match(controller, /courtApprovalPendingRef\.current = false/u);
  assert.match(pageView, /className=\{selectedRow\?\.id === row\.id[\s\S]{0,140}disabled=\{reviewActionPending\}/u);
  assert.match(detailPanel, /disabled=\{reviewActionPending \|\| !reportOptions\.length\}/u);
  assert.match(userOperations, /const requestTargetUserId = selected\.id;[\s\S]{0,180}selectedUserIdRef\.current === requestTargetUserId/u);
  assert.match(userOperations, /className=\{selected\?\.id === user\.id[\s\S]{0,140}disabled=\{actionPending\}/u);
  assert.equal((adminLoader.match(/select\("id", \{ count: "exact", head: true \}\)\.eq\("status", "pending"\)/g) ?? []).length, 2);
  assert.match(adminLoader, /refereeRequestPage\.total \+ pendingAppointmentCount/u);
});

test("관리자 업무 탭은 임명 처리 상태를 controller에서 받는다", async () => {
  const source = await read("src/pages/AdminPageView.jsx");
  assert.match(source, /reviewActionPending,\s*appointmentActionPending,/);
  assert.match(source, /disabled=\{reviewActionPending \|\| appointmentActionPending\}/);
});

test("구장 상세 저장 실패는 버튼 잠금을 해제하고 재시도를 허용한다", async () => {
  const [source, databaseController] = await Promise.all([
    read("src/pages/CourtDetail.jsx"),
    read("src/components/admin/useCourtDatabasePanelController.js"),
  ]);

  assert.match(source, /const submitReview = async[\s\S]*?try \{[\s\S]*?catch \{[\s\S]*?finally \{\s*setSaving\(false\);/u);
  assert.match(source, /const submitCorrection = async[\s\S]*?try \{[\s\S]*?catch \{[\s\S]*?finally \{\s*setCorrectionSaving\(false\);/u);
  assert.match(databaseController, /catch \{[\s\S]{0,240}필터 적용을 눌러 다시 시도해 주세요\.[\s\S]{0,180}finally \{[\s\S]{0,100}setLoading\(false\)/u);
});

test("계정 데이터 로딩 실패는 같은 화면에서 재시도한다", async () => {
  const [achievements, notifications] = await Promise.all([
    read("src/pages/ProfileAchievements.jsx"),
    read("src/pages/Notifications.jsx"),
  ]);

  assert.match(achievements, /setError\(""\);[\s\S]*setLoadAttempt\(\(current\) => current \+ 1\)[\s\S]*다시 시도/u);
  assert.match(notifications, /const refreshNotifications = useCallback\(async \(\) => \{[\s\S]*setNotificationsLoadError\("알림을 불러오지 못했습니다\."\)/u);
  assert.match(notifications, /onClick=\{refreshNotifications\}>다시 시도/u);
});
