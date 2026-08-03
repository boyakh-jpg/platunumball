import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createRoomModalOpeners } from "../src/lib/roomModalNavigation.js";
import {
  requestMatchDetailOnce,
} from "../src/pages/matchesPageModel.js";
import { deleteNotification, updateProfile } from "../src/data/repository/account.js";
import { commitAdminAppointmentAction } from "../src/data/repository/admin/appointment.js";
import { submitRefereeRequest } from "../src/data/repository/courts.js";
import { updateSettings } from "../src/data/repository/settings.js";
import { buildProfileTeamActions } from "../src/hooks/appData/actions/profileTeamActions.js";
import { buildSettingsActions } from "../src/hooks/appData/actions/settingsActions.js";
import { isProfileGateReady, normalizeProfileName, PROFILE_NAME_MAX_LENGTH, shouldSetupProfile } from "../src/lib/profileSetup.js";

const root = path.resolve(new URL("../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const read = (relativePath) => readFile(path.join(root, relativePath), "utf8");

function createStateHarness(initialState) {
  const stateRef = { current: structuredClone(initialState) };
  const setState = (update) => {
    stateRef.current = typeof update === "function" ? update(stateRef.current) : update;
  };
  return { stateRef, setState };
}

test("가입정보 guard는 현재 인증 사용자의 프로필 hydration 뒤에만 판정한다", () => {
  assert.equal(isProfileGateReady({}), true);
  assert.equal(isProfileGateReady({ authUserId: "auth-1", remoteReady: false, serverProfileBound: true }), false);
  assert.equal(isProfileGateReady({ authUserId: "auth-1", profileAuthUserId: "auth-2", remoteReady: true, serverProfileBound: true }), false);
  assert.equal(isProfileGateReady({ authUserId: "auth-1", profileAuthUserId: "auth-2", remoteReady: true, serverProfileBound: false }), false);
  assert.equal(isProfileGateReady({ authUserId: "auth-1", profileAuthUserId: "auth-1", remoteReady: true, serverProfileBound: true }), true);
  assert.equal(isProfileGateReady({ authUserId: "test-rankball-001", remoteReady: true, serverProfileBound: false }), true);
  assert.equal(shouldSetupProfile({ onboardingComplete: true }), false);
  assert.equal(shouldSetupProfile({ onboardingComplete: false, handleLockedAt: "2026-01-01", birthYearLockedAt: "2026-01-01" }), true);
});

test("계정 전환 첫 렌더는 이전 계정의 원격 준비 상태를 재사용하지 않는다", async () => {
  const runtimeSource = await read("src/hooks/appData/orchestrator/runtime.js");
  assert.match(runtimeSource, /const authIdentityChanged = authIdentityRef\.current !== authUserId/);
  assert.match(runtimeSource, /remoteReadyRef\.current = !isSupabaseConfigured/);
  assert.match(runtimeSource, /remoteReady: remoteReady && !authIdentityChanged/);
});

test("인증 저장소 예외와 빈 프로필 이름은 화면·로컬·서버 경계에서 막는다", async () => {
  const [authSource, profileSource, actionSource, serverSource, affiliationSource, shareSource] = await Promise.all([
    read("src/hooks/useAuthSession.js"),
    read("src/pages/Profile.jsx"),
    read("src/hooks/appData/actions/profileTeamActions.js"),
    read("server/api/profile/upsert.js"),
    read("src/components/profile/AffiliationEditor.jsx"),
    read("src/components/share/ShareCard.jsx"),
  ]);
  const state = { currentUserId: "u1", users: [{ id: "u1", name: "기존 이름" }] };

  assert.equal(normalizeProfileName("   "), "");
  assert.equal(normalizeProfileName(` ${"가".repeat(30)} `).length, PROFILE_NAME_MAX_LENGTH);
  assert.strictEqual(updateProfile(state, { name: "   " }), state);
  assert.equal(updateProfile(state, { name: "  새 이름  " }).users[0].name, "새 이름");
  assert.match(authSource, /catch \{[\s\S]{0,120}try \{[\s\S]{0,120}localStorage\.removeItem/);
  assert.match(profileSource, /const name = normalizeProfileName\(draft\.name\)/);
  assert.match(profileSource, /<input required maxLength=\{PROFILE_NAME_MAX_LENGTH\}/);
  assert.match(actionSource, /invalid_profile_name/);
  assert.match(serverSource, /if \(!requestedName\)[\s\S]{0,100}invalid_profile_name/);
  assert.match(profileSource, /경기 기록을 불러오지 못했습니다/);
  assert.match(profileSource, /loadProfileRecords\(\{ force: true \}\)/);
  assert.match(affiliationSource, /finally \{\s*setPending\(false\)/);
  assert.match(shareSource, /setCopyStatus\("복사 실패"\)/);
});

test("프로필과 심판 등록의 서버 실패는 낙관 상태를 원래 값으로 되돌린다", async () => {
  const initialState = {
    currentUserId: "u1",
    users: [{ id: "u1", authUserId: "auth-1", name: "기존 이름", trustScore: 95 }],
    notifications: [],
    settings: {
      refereeExamAttempts: [{
        id: "attempt-1",
        userId: "u1",
        examVersion: "exam-v1",
        passed: true,
      }],
      refereeRequests: [],
    },
  };
  const profileHarness = createStateHarness(initialState);
  const rollbackServerMutation = (snapshot) => profileHarness.setState(snapshot);
  const profileActions = buildProfileTeamActions({
    authUserId: "auth-1",
    currentUserId: "u1",
    getServerActionErrorText: (error) => error?.message ?? "profile_save_failed",
    persistProfileServer: async () => ({ ok: false, error: "offline" }),
    profileLocked: true,
    rollbackServerMutation,
    serverProfileBound: true,
    setState: profileHarness.setState,
    stateRef: profileHarness.stateRef,
    updateProfile,
  });

  const profileResult = await profileActions.updateProfile({ name: "새 이름" });
  assert.equal(profileResult.ok, false);
  assert.equal(profileHarness.stateRef.current.users[0].name, "기존 이름");

  const refereeHarness = createStateHarness(initialState);
  let optimisticRequestCount = 0;
  const refereeActions = buildProfileTeamActions({
    currentUserId: "u1",
    getNewRefereeNotifications: (previous, next) => next.notifications.filter(
      (notification) => !previous.notifications.some((item) => item.id === notification.id),
    ),
    isSupabaseConfigured: true,
    rollbackIfServerFailed: async (promise, snapshot) => {
      const result = await promise;
      if (!result || result.ok === false) refereeHarness.setState(snapshot);
      return result;
    },
    setState: refereeHarness.setState,
    stateRef: refereeHarness.stateRef,
    submitRefereeRequest,
    syncRefereeServer: async () => {
      optimisticRequestCount = refereeHarness.stateRef.current.settings.refereeRequests.length;
      return { ok: false, error: "offline" };
    },
  });
  const refereeResult = await refereeActions.submitRefereeRequest({
    qualification: "community_exam",
    examAttemptId: "attempt-1",
    examVersion: "exam-v1",
  });
  assert.equal(optimisticRequestCount, 1);
  assert.equal(refereeResult.ok, false);
  assert.equal(refereeHarness.stateRef.current.settings.refereeRequests.length, 0);
  assert.equal(refereeHarness.stateRef.current.notifications.length, 0);
});

test("기존 심판 등록요청 응답은 임시 요청과 자기 알림을 제거한 뒤 canonical 상태를 갱신한다", async () => {
  const harness = createStateHarness({
    currentUserId: "u1",
    users: [{ id: "u1", name: "심판 신청자", trustScore: 95 }],
    notifications: [{ id: "existing-notification", title: "기존 알림" }],
    settings: {
      refereeExamAttempts: [{
        id: "attempt-1",
        userId: "u1",
        examVersion: "exam-v1",
        passed: true,
      }],
      refereeRequests: [],
    },
  });
  let refreshCount = 0;
  const actions = buildProfileTeamActions({
    currentUserId: "u1",
    getNewRefereeNotifications: (previous, next) => next.notifications.filter(
      (notification) => !previous.notifications.some((item) => item.id === notification.id),
    ),
    isSupabaseConfigured: true,
    refreshCurrentProfile: async () => {
      refreshCount += 1;
      assert.equal(harness.stateRef.current.settings.refereeRequests.length, 0);
      assert.deepEqual(harness.stateRef.current.notifications.map((notification) => notification.id), ["existing-notification"]);
      harness.setState((current) => ({
        ...current,
        settings: {
          ...current.settings,
          refereeRequests: [{ id: "existing-request", status: "pending", requestedBy: "u1" }],
        },
      }));
      return true;
    },
    rollbackIfServerFailed: async (promise) => promise,
    setState: harness.setState,
    stateRef: harness.stateRef,
    submitRefereeRequest,
    syncRefereeServer: async () => ({
      ok: true,
      duplicate: true,
      requestId: "existing-request",
      notificationCount: 0,
    }),
  });

  const result = await actions.submitRefereeRequest({
    qualification: "community_exam",
    examAttemptId: "attempt-1",
    examVersion: "exam-v1",
  });
  assert.equal(result.duplicate, true);
  assert.equal(refreshCount, 1);
  assert.deepEqual(harness.stateRef.current.settings.refereeRequests.map((request) => request.id), ["existing-request"]);
  assert.deepEqual(harness.stateRef.current.notifications.map((notification) => notification.id), ["existing-notification"]);
});

test("이전 계정의 늦은 설정 실패와 알림 삭제 실패는 현재 상태를 덮지 않는다", async () => {
  const themeHarness = createStateHarness({
    currentUserId: "u1",
    settings: { theme: "dark" },
    notifications: [],
  });
  const settingsAuthUserIdRef = { current: "auth-1" };
  const themeMutationVersionRef = { current: 0 };
  const themeCommittedValueRef = { current: "dark" };
  let resolveThemeSave;
  const themeActions = buildSettingsActions({
    authUserId: "auth-1",
    currentUserId: "u1",
    ensureRemoteReady: () => true,
    isSupabaseConfigured: true,
    setState: themeHarness.setState,
    settingsAuthUserIdRef,
    stateRef: themeHarness.stateRef,
    syncSettingsServer: () => new Promise((resolve) => { resolveThemeSave = resolve; }),
    themeCommittedValueRef,
    themeMutationVersionRef,
    updateSettings,
  });
  const pendingThemeSave = themeActions.saveTheme("light");
  assert.equal(themeHarness.stateRef.current.settings.theme, "light");
  settingsAuthUserIdRef.current = "auth-2";
  themeHarness.setState({ currentUserId: "u2", settings: { theme: "dark" }, notifications: [] });
  resolveThemeSave({ ok: false, error: "offline" });
  assert.equal(await pendingThemeSave, false);
  assert.equal(themeHarness.stateRef.current.currentUserId, "u2");
  assert.equal(themeHarness.stateRef.current.settings.theme, "dark");

  const notificationHarness = createStateHarness({
    currentUserId: "u1",
    settings: {},
    notifications: [{ id: "notification-1", title: "보존" }],
  });
  const notificationActions = buildSettingsActions({
    currentUserId: "u1",
    deleteNotification,
    ensureRemoteReady: () => true,
    ensureServerActionAvailable: async () => true,
    isSupabaseConfigured: true,
    runServerAction: async () => ({ ok: false, error: "offline" }),
    setState: notificationHarness.setState,
  });
  const deleteResult = await notificationActions.deleteNotification("notification-1");
  assert.equal(deleteResult.ok, false);
  assert.deepEqual(notificationHarness.stateRef.current.notifications.map((item) => item.id), ["notification-1"]);
});

test("관리자 임명 연장은 유효한 종료 시각을 직접 계산한다", () => {
  const now = Date.now();
  const authority = {
    id: "authority",
    source: "server_context",
    userId: "admin",
    role: "admin",
    grade: "owner",
    status: "active",
    startsAt: new Date(now - 1_000).toISOString(),
    endsAt: new Date(now + 86_400_000).toISOString(),
  };
  const target = {
    id: "target",
    source: "server_context",
    userId: "referee",
    role: "referee",
    grade: "candidate",
    status: "active",
    startsAt: authority.startsAt,
    endsAt: authority.endsAt,
  };
  const next = commitAdminAppointmentAction({
    currentUserId: "admin",
    users: [{ id: "admin" }, { id: "referee" }],
    settings: { adminAppointments: [authority], refereeAppointments: [target] },
    notifications: [],
  }, { actionType: "extendAppointment", appointmentId: target.id, termDays: 30 });

  const extended = next.settings.refereeAppointments.find((item) => item.id === target.id);
  assert.ok(new Date(extended.endsAt).getTime() > new Date(target.endsAt).getTime());
});

test("네이버 지도 실패와 취소는 오버레이와 제출 상태를 복구한다", async () => {
  const [naverSource, courtController] = await Promise.all([
    read("src/lib/naverAddress.js"),
    read("src/pages/useSettingsCourtRequestController.js"),
  ]);

  assert.match(naverSource, /script\.addEventListener\("error", \(\) => \{\s*script\.remove\(\)/u);
  assert.match(naverSource, /catch \(error\) \{\s*settled = true;\s*cleanup\(\);\s*reject\(error\);\s*return;/u);
  assert.match(naverSource, /error\.code = "naver_pin_picker_cancelled"/u);
  assert.match(courtController, /&& !courtNearbyLookupFailed/u);
  assert.match(courtController, /error\?\.code === "naver_pin_picker_cancelled"/u);
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
  assert.match(sources["src/pages/useSettingsPageController.jsx"], /selectedBlockUserId = selectedBlockUser\.id && selectedBlockUser\.id !== app\.currentUserId && !blockedUserIds\.includes\(selectedBlockUser\.id\)/);
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
  assert.match(settingsController, /discordOAuthResult\.error === "discord_oauth_cancelled"[\s\S]{0,120}Discord 연동을 취소했습니다\./u);
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
  assert.ok(authSession.indexOf("await supabase.auth.signOut()") < authSession.indexOf("writeTestSession(null)", authSession.indexOf("signOut: async")));
  assert.match(loginPage, /disabled=\{auth\.authActionPending \|\| auth\.testLoginPending\}/u);
  assert.match(loginPage, /if \(auth\.session\) return <Navigate to=\{from\} replace \/>/u);
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

  assert.match(source, /const submitReview = async[\s\S]*?try \{[\s\S]*?catch \{[\s\S]*?finally \{[\s\S]{0,100}setSaving\(false\);/u);
  assert.match(source, /const submitCorrection = async[\s\S]*?try \{[\s\S]*?catch \{[\s\S]*?finally \{[\s\S]{0,120}setCorrectionSaving\(false\);/u);
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

test("인증 저장소와 링크 복사 실패는 로그인 화면을 멈추지 않는다", async () => {
  const [authSession, login] = await Promise.all([
    read("src/hooks/useAuthSession.js"),
    read("src/pages/Login.jsx"),
  ]);

  assert.match(authSession, /function writeTestSession[\s\S]{0,280}try \{[\s\S]{0,220}catch \{/u);
  assert.match(login, /navigator\.clipboard\.writeText\(browserOpenUrl\)[\s\S]{0,220}catch \{[\s\S]{0,180}링크를 복사하지 못했습니다/u);
});

test("랜딩의 모집방·대표팀·최근 경기는 선택 대상을 유지한다", async () => {
  const landing = await read("src/pages/Landing.jsx");
  assert.match(landing, /`\/app\/recruiting\?post=\$\{encodeURIComponent\(post\.id\)\}`/u);
  assert.match(landing, /`\/app\/teams\/\$\{encodeURIComponent\(featuredTeam\.id\)\}`/u);
  assert.match(landing, /`\/app\/matches\?match=\$\{encodeURIComponent\(match\.id\)\}`/u);
});

test("랜딩의 통계와 최근 경기 점수는 표시 목록이 아닌 전체 확정 데이터로 계산한다", async () => {
  const landing = await read("src/pages/Landing.jsx");
  assert.match(landing, /const openRecruiting = openRecruitingPosts\.slice\(0, 3\)/u);
  assert.match(landing, /openRecruiting: openRecruitingPosts\.length/u);
  assert.match(landing, /completedMatches: confirmedMatches\.length/u);
  assert.match(landing, /match\.result\?\.scoreA \?\? match\.teamA\?\.score \?\? 0/u);
  assert.match(landing, /match\.result\?\.scoreB \?\? match\.teamB\?\.score \?\? 0/u);
});

test("경로 없는 검색과 방 팝업은 키보드 이동과 조회 실패 복구를 제공한다", async () => {
  const [picker, navigation, home, notifications, courtMap] = await Promise.all([
    read("src/components/common/SearchPicker.jsx"),
    read("src/lib/roomModalNavigation.js"),
    read("src/pages/Home.jsx"),
    read("src/pages/Notifications.jsx"),
    read("src/components/court/CourtMapPicker.jsx"),
  ]);
  assert.match(picker, /ArrowDown/);
  assert.match(picker, /inputRef\.current\?\.focus\(\)/);
  assert.match(picker, /search-picker-retry/);
  assert.match(picker, /remoteError && !remoteLoading/);
  assert.match(courtMap, /mapRetrySequence[\s\S]*다시 시도/u);
  assert.match(navigation, /recruitingRoomLoadState/);
  assert.match(navigation, /retryRecruitingRoom/);
  assert.match(home, /RecruitingRoomLoadFailedView/);
  assert.match(notifications, /RecruitingRoomLoadingView/);
});

test("팀 링크와 기록 목록은 부분 hydration과 중복 archive를 안전하게 처리한다", async () => {
  const [hover, detail, season, ranking, affiliations] = await Promise.all([
    read("src/components/team/TeamHoverCard.jsx"),
    read("src/pages/TeamDetailView.jsx"),
    read("src/lib/season.js"),
    read("src/components/ranking/RankingTable.jsx"),
    read("src/pages/Affiliations.jsx"),
  ]);
  assert.match(hover, /return to \? <Link/);
  assert.match(detail, /archivedHistory\.filter\(\(record\) => !historyIds\.has\(record\.matchId\)\)/);
  assert.match(season, /if \(!isConfirmed\(match\)\) return false/);
  assert.match(ranking, /표시할 순위가 없습니다/);
  assert.match(ranking, /<TeamHoverCard team=\{row\} className="ranking-name" directNavigation>/);
  assert.match(affiliations, /소속 순위 불러오는 중/);
  assert.match(affiliations, /directoryLoadState === "idle" \|\| directoryLoadState === "loading"/);
  assert.match(affiliations, /setDirectoryLoadState\(result === true \? "loaded" : "error"\)/);
  assert.match(affiliations, /\{rankedAffiliations\.length \? <>/);
  assert.match(affiliations, /directoryLoadState === "loaded" && !rankedAffiliations\.length/);
});
