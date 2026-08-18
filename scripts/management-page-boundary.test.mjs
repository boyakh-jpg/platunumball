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
import { createServerMutationRollbackStore } from "../src/hooks/appData/actions.js";
import { hasReservedOperatorIdentity, makeSuggestedHashtagBody, toHashtag } from "../src/lib/handles.js";
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

function createRollbackHarness(stateHarness) {
  const store = createServerMutationRollbackStore();
  const restoreServerMutation = (rollback) => {
    stateHarness.setState((current) => store.restore(current, rollback));
  };
  return {
    captureServerMutation: (before, optimistic) => store.capture(before, optimistic),
    restoreServerMutation,
    rollbackServerMutation: restoreServerMutation,
    rollbackIfServerFailed: async (promise, rollback) => {
      const result = await promise;
      if (!result || result.ok === false) restoreServerMutation(rollback);
      return result;
    },
  };
}

test("공용 rollback은 실패한 변경만 되돌리고 이후 성공 상태를 보존한다", () => {
  const representativeStore = createServerMutationRollbackStore();
  const representativeBefore = {
    settings: { representativeTeamId: "team-a", favoriteTeamIds: [] },
    notifications: [],
  };
  const representativeOptimistic = {
    ...representativeBefore,
    settings: { ...representativeBefore.settings, representativeTeamId: "team-b" },
  };
  const representativeRollback = representativeStore.capture(representativeBefore, representativeOptimistic);
  const favoriteSucceeded = {
    ...representativeOptimistic,
    settings: { ...representativeOptimistic.settings, favoriteTeamIds: ["team-c"] },
  };
  assert.deepEqual(representativeStore.restore(favoriteSucceeded, representativeRollback), {
    settings: { representativeTeamId: "team-a", favoriteTeamIds: ["team-c"] },
    notifications: [],
  });

  const profileStore = createServerMutationRollbackStore();
  const profileBefore = {
    users: [{ id: "u1", name: "이전 이름", mmr: 1200 }],
    settings: { notificationChannels: { discord: false } },
    notifications: [{ id: "n1", readAt: null }],
  };
  const profileOptimistic = {
    ...profileBefore,
    users: [{ ...profileBefore.users[0], name: "새 이름" }],
  };
  const profileRollback = profileStore.capture(profileBefore, profileOptimistic);
  const settingsAndNotificationSucceeded = {
    ...profileOptimistic,
    settings: { notificationChannels: { discord: true } },
    notifications: [...profileOptimistic.notifications, { id: "n2", readAt: null }],
  };
  assert.deepEqual(profileStore.restore(settingsAndNotificationSucceeded, profileRollback), {
    users: [{ id: "u1", name: "이전 이름", mmr: 1200 }],
    settings: { notificationChannels: { discord: true } },
    notifications: [{ id: "n1", readAt: null }, { id: "n2", readAt: null }],
  });

  const courtStore = createServerMutationRollbackStore();
  const courtBefore = { settings: { courtRequests: [] }, notifications: [] };
  const courtOptimistic = {
    ...courtBefore,
    settings: { courtRequests: [{ id: "court-request-1", status: "pending" }] },
  };
  const courtRollback = courtStore.capture(courtBefore, courtOptimistic);
  const notificationReceived = {
    ...courtOptimistic,
    notifications: [{ id: "n-new", title: "새 알림" }],
  };
  assert.deepEqual(courtStore.restore(notificationReceived, courtRollback), {
    settings: { courtRequests: [] },
    notifications: [{ id: "n-new", title: "새 알림" }],
  });
});

test("같은 entity의 늦은 실패는 이후 mutation을 덮지 않는다", () => {
  const store = createServerMutationRollbackStore();
  const before = { users: [{ id: "u1", name: "원본", mmr: 1200 }] };
  const firstOptimistic = { users: [{ id: "u1", name: "A", mmr: 1200 }] };
  const firstRollback = store.capture(before, firstOptimistic);
  const secondOptimistic = { users: [{ id: "u1", name: "B", mmr: 1200 }] };
  store.capture(firstOptimistic, secondOptimistic);

  assert.deepEqual(store.restore(secondOptimistic, firstRollback), secondOptimistic);
});

test("프로필 운영자 예약어는 표기 변형을 막고 빈 추천값은 일반 사용자용이다", async () => {
  assert.equal(hasReservedOperatorIdentity({ name: "MyBOXTIER" }), true);
  assert.equal(hasReservedOperatorIdentity({ name: "우리 박스-티어" }), true);
  assert.equal(hasReservedOperatorIdentity({ hashtag: toHashtag("box tier") }), true);
  assert.equal(hasReservedOperatorIdentity({ name: "농구인" }), false);
  assert.equal(makeSuggestedHashtagBody(""), "player");

  const [signupSource, profileSource, serverSource, migrationSource, expandedTermsSource, noticesSource] = await Promise.all([
    read("src/pages/Signup.jsx"),
    read("src/pages/Profile.jsx"),
    read("server/api/profile/upsert.js"),
    read("supabase/migrations/20260806094951_reserve_operator_identity.sql"),
    read("supabase/migrations/20260806113000_expand_profile_identity_block_terms.sql"),
    read("docs/open-source-notices.md"),
  ]);

  assert.match(signupSource, /hasReservedOperatorIdentity/);
  assert.match(profileSource, /hasReservedOperatorIdentity/);
  assert.match(serverSource, /reserved_operator_identity/);
  assert.match(serverSource, /profile_identity_blocked/);
  assert.match(migrationSource, /profile_identity_block_terms/);
  assert.match(migrationSource, /grade = 'owner'/);
  assert.match(migrationSource, /create trigger rankball_profiles_identity_guard/);
  const importedTermLists = [...expandedTermsSource.matchAll(/\$terms\$(\[[\s\S]*?\])\$terms\$::jsonb/g)]
    .map((match) => JSON.parse(match[1]));
  assert.equal(importedTermLists.length, 5);
  assert.equal(importedTermLists.flat().length, 1050);
  assert.equal(importedTermLists.flat().includes("enby"), false);
  assert.match(expandedTermsSource, /profile_identity_block_sources/);
  assert.match(expandedTermsSource, /'exact'/);
  assert.match(noticesSource, /Copyright \(c\) 2019 hmmhmmhm/);
  assert.match(noticesSource, /Copyright \(c\) 2021 David Sojevic/);
});

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
  const profileRollback = createRollbackHarness(profileHarness);
  const profileActions = buildProfileTeamActions({
    ...profileRollback,
    authUserId: "auth-1",
    currentUserId: "u1",
    getServerActionErrorText: (error) => error?.message ?? "profile_save_failed",
    persistProfileServer: async () => ({ ok: false, error: "offline" }),
    profileLocked: true,
    serverProfileBound: true,
    setState: profileHarness.setState,
    stateRef: profileHarness.stateRef,
    updateProfile,
  });

  const profileResult = await profileActions.updateProfile({ name: "새 이름" });
  assert.equal(profileResult.ok, false);
  assert.equal(profileHarness.stateRef.current.users[0].name, "기존 이름");

  const refereeHarness = createStateHarness(initialState);
  const refereeRollback = createRollbackHarness(refereeHarness);
  let optimisticRequestCount = 0;
  const refereeActions = buildProfileTeamActions({
    ...refereeRollback,
    currentUserId: "u1",
    getNewRefereeNotifications: (previous, next) => next.notifications.filter(
      (notification) => !previous.notifications.some((item) => item.id === notification.id),
    ),
    isSupabaseConfigured: true,
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
  const rollback = createRollbackHarness(harness);
  let refreshCount = 0;
  const actions = buildProfileTeamActions({
    ...rollback,
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
  "src/pages/useSettingsCourtEvidenceController.js",
  "src/pages/useSettingsFavorites.jsx",
  "src/pages/useSettingsRefereeController.js",
  "src/pages/SettingsPageView.jsx",
  "src/pages/SettingsActivityDialog.jsx",
  "src/pages/SettingsListDialog.jsx",
  "src/pages/SettingsPrimaryColumn.jsx",
  "src/pages/SettingsSideColumn.jsx",
  "src/pages/SettingsRefereeSection.jsx",
  "src/pages/SettingsReportCard.jsx",
  "src/pages/Admin.jsx",
  "src/pages/adminPageModel.js",
  "src/pages/AdminPageParts.jsx",
  "src/pages/AdminCourtRequestEvidence.jsx",
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

test("team member invite requires an explicit current search selection", async () => {
  const [controllerSource, viewSource] = await Promise.all([
    read("src/pages/TeamDetail.jsx"),
    read("src/pages/TeamDetailView.jsx"),
  ]);

  assert.match(controllerSource, /useState\(\{ userId: "", role: "regular" \}\)/);
  assert.match(controllerSource, /\? memberDraft\.userId : ""\)/);
  assert.match(controllerSource, /setMemberDraft\(\{ userId: "", role: "regular" \}\)/);
  assert.doesNotMatch(controllerSource, /firstAddableUser/);
  assert.match(viewSource, /setMemberDraft\(\(current\) => \(\{ \.\.\.current, userId: "" \}\)\)/);
  assert.match(viewSource, /setSelectedInviteProfile\(null\)/);
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
  assert.match(authSession, /localSignOutRequired = Boolean\(signOutError\)[\s\S]{0,120}clearSupabaseSessionStorage\(\)/u);
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
  assert.match(userOperations, /const \[riskOnly, setRiskOnly\] = useState\(false\);[\s\S]{0,9000}30일 신규 가입/u);
  assert.match(userOperations, /가입 \{formatDateTime\(user\.createdAt\)\}/u);
  assert.equal((adminLoader.match(/select\("id", \{ count: "exact", head: true \}\)\.eq\("status", "pending"\)/g) ?? []).length, 2);
  assert.match(adminLoader, /refereeRequestPage\.total \+ pendingAppointmentCount/u);
});

test("관리자 업무 탭은 임명 처리 상태를 controller에서 받는다", async () => {
  const source = await read("src/pages/AdminPageView.jsx");
  assert.match(source, /reviewActionPending,\s*appointmentActionPending,/);
  assert.match(source, /disabled=\{reviewActionPending \|\| appointmentActionPending\}/);
});

test("설정 포털은 열린 동안 뒤 화면을 잠그고 포커스를 내부에서 순환한다", async () => {
  const [pageView, listDialog, activityDialog] = await Promise.all([
    read("src/pages/SettingsPageView.jsx"),
    read("src/pages/SettingsListDialog.jsx"),
    read("src/pages/SettingsActivityDialog.jsx"),
  ]);

  assert.match(pageView, /useBodyScrollLock\(withdrawalOpen \|\| Boolean\(activityList\) \|\| Boolean\(activityDetail\)\)/u);
  for (const source of [listDialog, activityDialog]) {
    assert.match(source, /restoreFocusRef = useRef\(null\)/u);
    assert.match(source, /event\.key === "Escape"[\s\S]{0,100}onCloseRef\.current\(\)/u);
    assert.match(source, /event\.key !== "Tab"/u);
    assert.match(source, /data-dialog-initial-focus/u);
    assert.match(source, /restoreTarget instanceof window\.HTMLElement && restoreTarget\.isConnected/u);
  }
});

test("구장 상세 저장 실패는 버튼 잠금을 해제하고 재시도를 허용한다", async () => {
  const [source, databaseController] = await Promise.all([
    read("src/pages/CourtDetail.jsx"),
    read("src/components/admin/useCourtDatabasePanelController.js"),
  ]);

  assert.match(source, /const submitReview = async[\s\S]*?finally \{[\s\S]{0,300}isCurrentScopedOperation\(savingRef\.current, operation, currentCourtIdRef\.current\)[\s\S]{0,160}setSaving\(false\);/u);
  assert.match(source, /const submitCorrection = async[\s\S]*?finally \{[\s\S]{0,300}isCurrentScopedOperation\(correctionSavingRef\.current, operation, currentCourtIdRef\.current\)[\s\S]{0,180}setCorrectionSaving\(false\);/u);
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

test("비로그인 랜딩은 인증 확인 후 안전하게 분기한다", async () => {
  const landing = await read("src/pages/Landing.jsx");
  const app = await read("src/App.jsx");
  const profileSetup = await read("src/lib/profileSetup.js");
  const receipt = await read("src/pages/MatchReceipt.jsx");
  const authGuard = await read("src/components/auth/RequireAuth.jsx");
  const runtime = await read("src/hooks/appData/orchestrator/runtime.js");
  const hydration = await read("src/hooks/appData/orchestrator/runtimeHydration.js");
  assert.match(landing, /if \(auth\?\.loading\) return <LandingLoading \/>;/u);
  assert.match(landing, /if \(auth\?\.user\) return <Navigate to="\/app" replace \/>;/u);
  assert.match(landing, /to=\{getLoginPath\("\/app", "\/"\)\}/u);
  assert.match(app, /path="\/"[\s\S]*?<Landing auth=\{auth\} \/>/u);
  assert.match(app, /path="\/start"[\s\S]*?<Landing auth=\{auth\} \/>/u);
  assert.match(profileSetup, /if \(url\.origin !== "https:\/\/boxtier\.local"\) return safeFallback;/u);
  assert.match(profileSetup, /if \(!redirectPath\.startsWith\("\/app"\)\) return safeFallback;/u);
  assert.match(receipt, /ensurePublicDraft\(draft, \{ forClaim: true \}\)/u);
  assert.match(receipt, /returnTo = `\$\{MATCH_RECEIPT_CREATE_RETURN_TO\}&receiptDraft=\$\{encodeURIComponent\(publicId\)\}`/u);
  assert.match(receipt, /clonePublicId: requestedPublicDraftId/u);
  assert.match(app, /function isGuestPublicAppPath\(pathname = ""\)[\s\S]*GUEST_PUBLIC_APP_PREFIXES\.some[\s\S]*isGuestPublicAppPath\(location\.pathname\)[\s\S]*useAppData\(auth\.user \?\? null, location, \{ demoPreview: guestPreview \}\)/u);
  assert.match(authGuard, /!auth\.session && !allowGuestHome/u);
  assert.doesNotMatch(runtime, /ensureLocalDemoInitialState\(\{ preview: true \}\)/u);
  assert.match(hydration, /setRemoteReady\(demoPreview \|\| !isSupabaseConfigured\)/u);
});

test("게스트 저장 요청은 원래 경로를 보존해 로그인으로 보낸다", async () => {
  const [profileSetup, serverActions, communityPage, community, rankings] = await Promise.all([
    read("src/lib/profileSetup.js"),
    read("src/lib/serverActions.js"),
    read("src/pages/Community.jsx"),
    read("src/pages/useCommunityController.js"),
    read("src/pages/Rankings.jsx"),
  ]);

  assert.match(profileSetup, /export function getLoginPath\(redirect = "\/app", backTo = redirect\)/u);
  assert.match(serverActions, /window\.location\.assign\(getLoginPath\(redirect\)\)/u);
  assert.match(serverActions, /if \(!accessToken && options\.allowAnonymous !== true\) \{[\s\S]*redirectToLogin\(\);[\s\S]*server_action_missing_access_token/u);
  assert.match(community, /const remote = isSupabaseConfigured;/u);
  assert.match(community, /const requireLogin = \(\) => \{[\s\S]*window\.location\.assign\(getLoginPath\(redirect\)\)/u);
  assert.match(communityPage, /controller\.requireLogin\(\) \|\| setComposing\(true\)/u);
  assert.match(rankings, /const readOnly = app\.demoPreview === true/u);
  assert.match(rankings, /const directoryLoading = !promotionView/u);
});

test("게스트는 실제 공개 매칭을 보고 개인 메뉴는 안내 상태로 끝난다", async () => {
  const [app, recruiting, recruitingView, home, matches, bootstrap, guestAccess, bottomNav] = await Promise.all([
    read("src/App.jsx"),
    read("src/pages/Recruiting.jsx"),
    read("src/pages/RecruitingPageView.jsx"),
    read("src/pages/HomePageView.jsx"),
    read("src/pages/Matches.jsx"),
    read("src/hooks/appData/bootstrap.js"),
    read("src/components/auth/GuestAccessNotice.jsx"),
    read("src/components/layout/BottomNav.jsx"),
  ]);

  assert.match(app, /\/app\/recruiting/u);
  assert.match(app, /<Recruiting app=\{app\} readOnly=\{guestPreview\} \/>/u);
  assert.match(recruiting, /const requestParams = new URLSearchParams\(\{ recruitingLimit: String\(REMOTE_CLIENT_RECRUITING_LIMIT\) \}\)/u);
  assert.match(recruiting, /requestParams\.set\("recruitingPostId", targetPostId\)/u);
  assert.match(recruiting, /fetch\(`\/api\/landing\/stats\?\$\{requestParams\.toString\(\)\}`/u);
  assert.match(recruiting, /resolveGuestRecruitingTarget\(feed, targetPostId\)/u);
  assert.match(recruiting, /getGuestRecruitingUnavailableCopy\(target\.status\)/u);
  assert.match(recruiting, /if \(readOnly\) return <GuestRecruiting app=\{app\} \/>/u);
  assert.match(recruiting, /<RecruitingRoomModal app=\{app\} post=\{selectedPost\} readOnly skipInitialDetailLoad/u);
  assert.match(recruiting, /actionLabel="방 보기"[\s\S]*onAction=\{\(\) => openRoom\(post\)\}/u);
  assert.doesNotMatch(recruiting, /actionLabel="참가 기능 안내"/u);
  assert.match(recruiting, /useState\(REGION_FILTER_ALL\)/u);
  assert.match(recruitingView, /<option value="__mine__">\{`내 지역/u);
  assert.match(recruitingView, /<option value="__all__">전체<\/option>/u);
  assert.match(home, /app\?\.demoPreview[\s\S]*<GuestHomePage/u);
  assert.match(home, /<GuestAccessNotice title="일정은 로그인 후 확인할 수 있습니다"[\s\S]*returnTo="\/app\/matches"/u);
  assert.match(matches, /<GuestAccessNotice[\s\S]*일정은 로그인 후 확인할 수 있습니다/u);
  assert.match(app, /"\/app\/profile"[\s\S]*"\/app\/recorder"[\s\S]*"\/app\/settings"/u);
  assert.match(app, /path="\/app\/recorder"[\s\S]*guestPreview \? \([\s\S]*<GuestAccessNotice/u);
  assert.match(app, /path="\/app\/profile"[\s\S]*guestPreview \? \([\s\S]*<GuestAccessNotice/u);
  assert.match(app, /path="\/app\/settings"[\s\S]*guestPreview \? \([\s\S]*<GuestAccessNotice/u);
  assert.match(guestAccess, /getLoginPath\(returnTo \|\| currentPath, currentPath\)/u);
  assert.match(guestAccess, /to="\/app\/recruiting"[\s\S]*공개 매칭 보기/u);
  assert.doesNotMatch(bottomNav, /isGuestProfile|로그인" : item\.label/u);
  assert.match(bootstrap, /regionScope: "all", startFilter: "all"/u);
});

test("비로그인 랜딩은 실제 영수증 한 장과 서비스 기록 흐름만 표시한다", async () => {
  const [landing, publicShell, attribution] = await Promise.all([
    read("src/pages/Landing.jsx"),
    read("src/components/layout/PublicShell.jsx"),
    read("src/components/layout/DataAttribution.jsx"),
  ]);
  assert.match(landing, /농구 기록을[\s\S]*쌓고 연결하세요/u);
  assert.match(landing, /경기 전부터 종료 후까지[\s\S]*하나의 기록으로 이어집니다/u);
  assert.match(landing, /한 경기로 끝내지 않으려면[\s\S]*기록을 이어가세요/u);
  assert.match(landing, /homeTeam: "NEW COURT CREW"[\s\S]*homeScore: 60[\s\S]*awayScore: 46/u);
  assert.equal(landing.match(/<MatchReceiptPreview/gu)?.length, 1);
  assert.match(landing, /경기 준비[\s\S]*경기 기록[\s\S]*기록 연결/u);
  assert.doesNotMatch(landing, /guest-landing-mobile-cta|guest-landing-final-cta/u);
  assert.doesNotMatch(landing, /fetch\(|openRecruiting|completedMatches|landing-stat-grid/u);
  assert.match(publicShell, /compactFooter = location\.pathname === "\/" \|\| location\.pathname === "\/start"/u);
  assert.match(attribution, /compact \? " is-compact" : ""/u);
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
