import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  APP_DATA_ORCHESTRATOR_SOURCE_PATHS,
  CREATE_MATCH_PAGE_SOURCE_PATHS,
  HOME_PAGE_SOURCE_PATHS,
  MATCHES_PAGE_SOURCE_PATHS,
  MATCH_CLOCK_PANEL_SOURCE_PATHS,
  MATCH_ROOM_SOURCE_PATHS,
  RECRUITING_PAGE_SOURCE_PATHS,
  SETTINGS_PAGE_SOURCE_PATHS,
  TEAM_DETAIL_SOURCE_PATHS,
  readSourceGroupSync,
} from "./management-source-groups.mjs";

const read = (file) => fs.readFileSync(file, "utf8");
const readCssTree = (file, visiting = new Set()) => {
  const normalizedFile = path.normalize(file);
  if (visiting.has(normalizedFile)) throw new Error(`Circular CSS import: ${normalizedFile}`);
  visiting.add(normalizedFile);
  const source = read(normalizedFile);
  const imports = [...source.matchAll(/@import\s+["']([^"']+\.css)["'];/g)];
  if (!imports.length) {
    visiting.delete(normalizedFile);
    return source;
  }
  const result = imports.map((match) => (
    readCssTree(path.resolve(path.dirname(normalizedFile), match[1]), visiting)
  )).join("\n");
  visiting.delete(normalizedFile);
  return result;
};
const listStyleFiles = (directory, result = []) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) listStyleFiles(entryPath, result);
    else if (entry.name.endsWith(".css")) result.push(entryPath.replaceAll("\\", "/"));
  }
  return result;
};
const count = (source, value) => source.split(value).length - 1;
const countClassToken = (source, token) => [...source.matchAll(/className="([^"]*)"/g)]
  .filter(([, className]) => className.split(/\s+/).includes(token))
  .length;
const styleFiles = listStyleFiles("src/styles");
const sourceFiles = fs.readdirSync("src", { recursive: true })
  .filter((file) => /\.(?:js|jsx|ts|tsx)$/.test(file))
  .map((file) => `src/${file.replaceAll("\\", "/")}`);
const allStyleSources = styleFiles.map((file) => read(file)).join("\n");
const nonTokenStyleSources = styleFiles
  .filter((file) => file !== "src/styles/tokens.css")
  .map((file) => read(file))
  .join("\n");

const componentSource = read("src/components/match/MatchListCard.jsx");
const matchCreationWizardSource = read("src/components/match/MatchCreationWizard.jsx");
const createMatchIntentSectionSource = read("src/components/match/CreateMatchIntentSection.jsx");
const createMatchCourtRosterSectionSource = read("src/components/match/CreateMatchCourtRosterSection.jsx");
const matchRecordMetaSource = read("src/components/match/MatchRecordMeta.jsx");
const recentMatchRowSource = read("src/components/match/RecentMatchRow.jsx");
const mmrRangeSelectorSource = read("src/components/match/MmrRangeSelector.jsx");
const approvalPanelSource = read("src/components/match/ApprovalPanel.jsx");
const profileBasicsFieldsSource = read("src/components/profile/ProfileBasicsFields.jsx");
const refereeTierEmblemSource = read("src/components/rating/RefereeTierEmblem.jsx");
const signupSource = read("src/pages/Signup.jsx");
const matchOperationsFieldsSource = matchCreationWizardSource.slice(
  matchCreationWizardSource.indexOf("export function MatchOperationsPolicyFields"),
  matchCreationWizardSource.indexOf("export function MatchCreationFinalSummary"),
);
const ruleSelectorSource = read("src/components/match/RuleSelector.jsx");
const matchListStyles = read("src/styles/match-list-card.css");
const primitiveStyles = readCssTree("src/styles/ui-primitives.css");
const editorialApplicationStyles = read("src/styles/themes/design-editorial-application.css");
const tokenStyles = read("src/styles/tokens.css");
const modalShellSource = read("src/components/common/ModalShell.jsx");
const foundationStyles = readCssTree("src/styles/global-foundation.css");
const globalSearchStyles = readCssTree("src/styles/global-search-profile.css");
const searchPickerStyles = read("src/styles/features/search-picker-home.css");
const visualSystemStyles = readCssTree("src/styles/global-visual-system.css");
const courtControlStyles = readCssTree("src/styles/global-court-controls.css");
const courtMapPickerSource = read("src/components/court/CourtMapPicker.jsx");
const globalAdminStyles = readCssTree("src/styles/global-admin-layout.css");
const courtDatabaseControlSource = read("src/components/admin/CourtDatabaseControls.jsx");
const courtDatabasePanelSource = read("src/components/admin/CourtDatabasePanelView.jsx");
const courtDatabaseDuplicateSource = read("src/components/admin/CourtDatabaseDuplicateReview.jsx");
const courtDatabaseMapStyles = read("src/styles/features/admin-court-database-map.css");
const courtDatabaseShellStyles = read("src/styles/features/admin-court-database-shell.css");
const matchCreateOperationsStyles = read("src/styles/features/match-create-operations.css");
const globalWorkflowStyles = readCssTree("src/styles/global-workflows.css");
const globalSurfaceStyles = readCssTree("src/styles/global-surfaces.css");
const landingScoreThemeStyles = read("src/styles/themes/landing-score-theme.css");
const landingGuestStyles = read("src/styles/themes/landing-guest.css");
const landingDemoFrameSource = read("src/components/landing/LandingDemoFrame.jsx");
const classicDesignStyles = readCssTree("src/styles/design-classic.css");
const editorialDesignStyles = readCssTree("src/styles/design-editorial.css");
const visualDirectionDemoSource = read("src/pages/VisualDirectionDemo.jsx");
const globalStyleManifest = read("src/styles/globals.css");
const appShellSource = read("src/components/layout/AppShell.jsx");
const cardSource = read("src/components/common/Card.jsx");
const externalNotificationSettingsCardSource = read("src/components/settings/ExternalNotificationSettingsCard.jsx");
const brandLockupSource = read("src/components/common/BrandLockup.jsx");
const sidebarSource = read("src/components/layout/Sidebar.jsx");
const loginSource = read("src/pages/Login.jsx");
const matchReceiptSource = read("src/pages/MatchReceipt.jsx");
const notificationsSource = read("src/pages/Notifications.jsx");
const settingsSource = readSourceGroupSync(read, SETTINGS_PAGE_SOURCE_PATHS);
const settingsStyles = read("src/styles/features/settings-location-preferences.css");
const profileTeamControlStyles = read("src/styles/features/profile-team-controls.css");
const matchesPageSource = readSourceGroupSync(read, MATCHES_PAGE_SOURCE_PATHS);
const matchRoomPageSource = readSourceGroupSync(read, MATCH_ROOM_SOURCE_PATHS);
const homePageSource = readSourceGroupSync(read, HOME_PAGE_SOURCE_PATHS);
const recruitingPageSource = readSourceGroupSync(read, RECRUITING_PAGE_SOURCE_PATHS);
const createMatchPageSource = readSourceGroupSync(read, CREATE_MATCH_PAGE_SOURCE_PATHS);
const teamsSource = read("src/pages/Teams.jsx");
const recruitingListApiSource = read("server/api/recruiting/_listProjection.js");
const useAppDataSource = readSourceGroupSync(read, APP_DATA_ORCHESTRATOR_SOURCE_PATHS);
const recruitingStyles = readCssTree("src/styles/recruiting-arena.css");
const recruitingLobbyResponsiveStyles = read("src/styles/responsive/recruiting-lobby-responsive.css");
const matchesStyles = readCssTree("src/styles/matches-arena.css");
const gettingStartedStyles = readCssTree("src/styles/getting-started.css");
const homeRailStyles = read("src/styles/themes/home-rail-theme.css");
const matchClockStyles = readCssTree("src/styles/match-clock.css");
const matchClockSource = readSourceGroupSync(read, MATCH_CLOCK_PANEL_SOURCE_PATHS);
const matchRoomStyles = readCssTree("src/styles/matchroom-arena.css");
const appSource = read("src/App.jsx");
const gettingStartedSource = [
  read("src/pages/GettingStarted.jsx"),
  read("src/pages/gettingStartedGuidePrimary.jsx"),
  read("src/pages/gettingStartedGuideSecondary.jsx"),
].join("\n");
const practiceMatchSource = read("src/pages/PracticeMatch.jsx");
const termsSource = read("src/pages/Terms.jsx");
const tierEmblemSource = read("src/components/rating/TierEmblem.jsx");
const shareCardSource = read("src/components/share/ShareCard.jsx");
const teamDetailSource = readSourceGroupSync(read, TEAM_DETAIL_SOURCE_PATHS);
const courtDetailSource = read("src/pages/CourtDetail.jsx");
const entityProfileHeroSource = read("src/components/profile/EntityProfileHero.jsx");
const profileRecordSummarySource = read("src/components/profile/ProfileRecordSummaryCard.jsx");
const placementEmblemPath = "public/assets/tier-emblems/tier-placement-v2.webp";
const hoverSurfaceStyles = [
  readCssTree("src/styles/global-foundation.css"),
  readCssTree("src/styles/global-admin-layout.css"),
  readCssTree("src/styles/global-surfaces.css"),
  visualSystemStyles,
  courtControlStyles,
].join("\n");
const pageSources = {
  landing: read("src/pages/Landing.jsx"),
  home: homePageSource,
  profile: read("src/pages/Profile.jsx"),
  profileRecords: read("src/pages/ProfileRecords.jsx"),
  matches: matchesPageSource,
  recruiting: recruitingPageSource,
  season: read("src/pages/Season.jsx"),
  teams: read("src/pages/Teams.jsx"),
  teamDetail: teamDetailSource,
  playerDetail: read("src/pages/PlayerDetail.jsx"),
  refereeDetail: read("src/pages/RefereeDetail.jsx"),
  rankings: read("src/pages/Rankings.jsx"),
  settings: settingsSource,
};
const legacyStyleSources = [
  read("src/styles/globals.css"),
  readCssTree("src/styles/matches-arena.css"),
  readCssTree("src/styles/recruiting-arena.css"),
].join("\n");

test("앱은 분류 박스 없는 표준 디자인을 사용하고 비교 데모만 두 CSS를 전환한다", () => {
  const designLeaks = styleFiles
    .filter((file) => file !== "src/styles/tokens.css")
    .filter((file) => !file.endsWith("design-classic.css") && !file.endsWith("design-editorial.css"))
    .filter((file) => !/\/themes\/design-(?:classic|editorial)-/.test(file))
    .filter((file) => /\[data-design=/.test(read(file)));
  const editorialAppStyles = editorialDesignStyles.split("/* Full application contract.")[1] ?? "";

  assert.match(globalStyleManifest, /@import "\.\/design-classic\.css";\s*@import "\.\/design-editorial\.css";/);
  assert.match(classicDesignStyles, /\[data-design="classic"\] \.ui-design-page/);
  assert.match(editorialDesignStyles, /\[data-design="editorial"\] \.ui-design-page/);
  assert.match(classicDesignStyles, /\[data-design="classic"\] \.ui-design-app/);
  assert.match(editorialDesignStyles, /\[data-design="editorial"\] \.ui-design-app/);
  assert.doesNotMatch(classicDesignStyles, /\[data-design="editorial"\]/);
  assert.doesNotMatch(editorialDesignStyles, /\[data-design="classic"\]/);
  assert.match(visualDirectionDemoSource, /className="ui-design-host" data-design=\{designMode\}/);
  assert.match(visualDirectionDemoSource, /"--ui-design-media"/);
  assert.doesNotMatch(visualDirectionDemoSource, /ui-(?:classic|editorial|poster)/);
  assert.match(appShellSource, /className="app-shell ui-design-host" data-design="editorial"/);
  assert.match(appShellSource, /className="app-main ui-design-app"/);
  assert.match(cardSource, /\["card", "ui-card", "ui-design-surface", "ui-design-info-surface"/);
  assert.match(cardSource, /includes\("section-card"\)[\s\S]*?"ui-design-category-surface"/);
  [
    pageSources.home,
    pageSources.matches,
    pageSources.recruiting,
    read("src/pages/Recorder.jsx"),
    pageSources.teams,
    pageSources.rankings,
    pageSources.profile,
    pageSources.settings,
  ].forEach((source) => assert.match(source, /ui-design-app-hero/));
  assert.doesNotMatch(pageSources.settings, /화면 구성|분류 박스 없음 사용 중|selectDesignMode/);
  assert.match(pageSources.landing, /className="guest-landing"/);
  assert.match(pageSources.landing, /if \(auth\?\.loading\) return <LandingLoading \/>;/);
  assert.match(pageSources.landing, /if \(auth\?\.user\) return <Navigate to="\/app" replace \/>;/);
  assert.match(pageSources.landing, /<h1>농구 끝나면, 기록이 남는다\.<\/h1>/);
  assert.match(pageSources.landing, /출석부터 점수·개인 기록까지 경기 현장에서 남기고,[\s\S]*확정된 결과는 전적과 티어,[\s\S]*공유용 영수증으로 이어집니다\./);
  assert.match(pageSources.landing, /import \{ MATCH_RECEIPT_PATH \} from "\.\.\/lib\/receiptLocale\.js"/);
  assert.match(pageSources.landing, /to=\{MATCH_RECEIPT_PATH\}[\s\S]*영수증 만들어보기/);
  assert.equal(count(pageSources.landing, "<Button as={Link}"), 2);
  assert.match(pageSources.landing, /className="guest-landing-actions"[\s\S]*className="guest-landing-primary-actions"[\s\S]*className="guest-landing-explore-link"/);
  assert.match(pageSources.landing, /to="\/app\/create\?intent=record"[\s\S]*경기 기록 시작하기/);
  assert.match(pageSources.landing, /<LandingDemoFrame \/>/);
  assert.match(pageSources.landing, /경기 전[\s\S]*모인다[\s\S]*경기 중[\s\S]*경기한다[\s\S]*경기 후[\s\S]*기록된다/);
  assert.match(pageSources.landing, /to="\/app\/recruiting"[\s\S]*공개 매칭/);
  assert.doesNotMatch(pageSources.landing, /MatchReceiptPreview|LANDING_RECEIPT_DRAFT|ui-match-clock-scoreboard/);
  assert.match(pageSources.landing, /children = "로그인"/);
  assert.doesNotMatch(pageSources.landing, /별도 가입 없이 로그인/);
  assert.equal(count(pageSources.landing, "<LoginButton"), 1);
  assert.match(pageSources.landing, /to="\/app" className="guest-landing-explore-link"/);
  assert.match(pageSources.landing, /로그인 없이 둘러보기/);
  assert.match(landingGuestStyles, /\.guest-landing-primary-actions\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(landingGuestStyles, /\.guest-landing-primary-actions \.ui-button\s*\{[^}]*width:\s*100%;[^}]*justify-content:\s*center;/);
  assert.match(landingGuestStyles, /@media \(max-width:\s*760px\)[\s\S]*?\.guest-landing-primary-actions\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/);
  assert.match(landingDemoFrameSource, /autoPlay=\{!prefersReducedMotion\}[\s\S]*muted[\s\S]*playsInline/);
  assert.match(landingDemoFrameSource, /poster=\{posterSrc \|\| undefined\}/);
  assert.match(landingDemoFrameSource, /matchMedia\?\.\("\(prefers-reduced-motion: reduce\)"\)/);
  assert.match(landingDemoFrameSource, /경기 전[\s\S]*출석 확인[\s\S]*경기 중[\s\S]*점수 · 개인 기록[\s\S]*경기 후[\s\S]*전적 · 티어 · 영수증/);
  assert.doesNotMatch(pageSources.landing, /guest-landing-text-login|guest-landing-account-login/);
  assert.doesNotMatch(pageSources.landing, /Recent games|지금 열려 있는 경기|Team basketball|Season ranking|ui-design-spotlight|landing-stat-grid/);
  assert.match(editorialDesignStyles, /\.ui-design-spotlight__stats > div\s*\{[^}]*color:\s*var\(--text\);/);
  assert.doesNotMatch(pageSources.landing, /ui-design-preference-list|화면 설정/);
  assert.doesNotMatch(pageSources.landing, /ui-design-main-brand|brand-logo-frame|brand-letter-wrap/);
  assert.match(pageSources.landing, /<BrandLockup\s*\/>/);
  assert.match(brandLockupSource, /BOXTIER_LETTER_DARK_URL/);
  assert.match(brandLockupSource, /BOXTIER_LETTER_LIGHT_URL/);
  assert.match(brandLockupSource, /brand-letter-fallback/);
  for (const source of [sidebarSource, loginSource, visualDirectionDemoSource]) {
    assert.match(source, /<BrandLockup\s*\/>/);
    assert.doesNotMatch(source, /BOXTIER_LETTER_DARK_URL|BOXTIER_LETTER_LIGHT_URL|brand-letter-fallback/);
  }
  assert.doesNotMatch(pageSources.home, /STANDARD_HOME_LAYOUT|ui-design-home-page|ui-design-main-hero/);
  assert.match(
    editorialAppStyles,
    /\.ui-design-category-surface\.ui-design-surface:not\(\.settings-fieldset-card\):not\(\.workflow-fieldset\)\s*\{[\s\S]*?border-width:\s*var\(--ui-stroke-width\) 0 0;[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/,
  );
  assert.match(editorialAppStyles, /\.ui-design-surface:not\(\.settings-fieldset-card\):not\(\.workflow-fieldset\)\s*\{[\s\S]*?border-width:\s*var\(--ui-card-border-width\);/);
  assert.match(tokenStyles, /\[data-design="editorial"\] \.ui-design-app\s*\{[\s\S]*?--ui-card-border-width:\s*0px;[\s\S]*?--ui-button-border-width:\s*0px;[\s\S]*?--ui-control-group-border-width:\s*0px;[\s\S]*?--ui-room-modal-border-width:\s*0px;[\s\S]*?--ui-room-panel-border-width:\s*0px;[\s\S]*?--ui-hero-border-width:\s*0px;[\s\S]*?\}/);
  assert.match(editorialAppStyles, /--ui-design-section-rule-space:\s*calc\(var\(--card-padding\) \* 2\);/);
  assert.match(editorialAppStyles, /--ui-design-soft-surface-bg:\s*color-mix\(in srgb,\s*var\(--rb-bg-2\) 86%,\s*var\(--rb-bg\)\);/);
  assert.match(editorialAppStyles, /\.ui-design-info-surface:not\(\.settings-fieldset-card\):not\(\.workflow-fieldset\),[\s\S]*?html\[data-theme\][\s\S]*?\.ui-design-borderless-list > \*\s*\{[\s\S]*?border-width:\s*var\(--ui-design-surface-border-width\);[\s\S]*?border-radius:\s*var\(--ui-card-radius\);[\s\S]*?background-color:\s*var\(--ui-design-soft-surface-bg\);/);
  assert.match(editorialAppStyles, /\.ui-design-info-surface\.ui-design-info-accent\s*\{[\s\S]*?border-inline-start:\s*4px solid var\(--ui-info-accent, transparent\);/);
  assert.match(editorialAppStyles, /\.ui-design-record-surface\.ui-design-info-surface\s*\{[\s\S]*?border:\s*0;[\s\S]*?border-radius:\s*0;[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/);
  assert.match(editorialAppStyles, /html\[data-theme\][\s\S]*?\.ui-design-soft-surface\s*\{[\s\S]*?border-width:\s*var\(--ui-card-border-width\);[\s\S]*?background:\s*var\(--ui-design-soft-surface-bg\);/);
  assert.match(editorialAppStyles, /\.ui-design-borderless-surface,[\s\S]*?\.ui-design-borderless-list > \*\s*\{[\s\S]*?border-width:\s*var\(--ui-design-surface-border-width\);/);
  assert.match(editorialAppStyles, /\.ui-design-choice-list > \*\s*\{[\s\S]*?border-width:\s*var\(--ui-button-border-width\);[\s\S]*?background:\s*var\(--ui-design-choice-bg\);/);
  assert.doesNotMatch(editorialAppStyles, /:is\(button, \.ui-button\)\s*\{/);
  assert.match(editorialAppStyles, /\.ui-design-app-hero\s*\{[\s\S]*?border:\s*var\(--ui-hero-border-width\) solid var\(--ui-card-border\);[\s\S]*?border-radius:\s*0;/);
  assert.doesNotMatch(editorialAppStyles, /!important/);
  assert.match(editorialAppStyles, /\.profile-rating-primary\.rating-card-pending\s*\{[\s\S]*?min-height:\s*140px;/);
  assert.match(editorialAppStyles, /\.ui-design-filter-tile\s*\{[\s\S]*?min-height:\s*60px;[\s\S]*?padding-block:\s*7px;/);
  assert.match(editorialAppStyles, /\.segmented-control\s*\{[\s\S]*?border-width:\s*var\(--ui-control-group-border-width\);[\s\S]*?padding:\s*0;[\s\S]*?background:\s*transparent;/);
  assert.match(editorialAppStyles, /\.segmented-control button\s*\{[\s\S]*?background:\s*var\(--ui-design-choice-bg\);/);
  assert.match(pageSources.home, /home-upcoming-card ui-design-category-surface/);
  assert.match(pageSources.home, /ui-design-borderless-list/);
  assert.match(pageSources.home, /ui-button-block ui-design-borderless-surface/);
  assert.match(pageSources.matches, /om-view-card ui-design-filter-tile/);
  assert.doesNotMatch(pageSources.matches, /om-view-card ui-design-soft-surface/);
  assert.match(pageSources.matches, /<fieldset className="om-calendar-summary">/);
  assert.match(pageSources.matches, /<legend className="om-calendar-heading">/);
  assert.match(matchesStyles, /\.om-schedule-rail \.om-view-grid\s*\{[^}]*gap:\s*var\(--space-3\);[^}]*border:\s*0;/);
  assert.match(matchesStyles, /\.om-schedule-workspace \.om-schedule-rail \.om-view-card\s*\{[^}]*border:\s*0;[^}]*background:\s*color-mix\(in srgb,\s*var\(--ui-control-bg\) 58%,\s*transparent\);/);
  assert.match(matchesStyles, /\.om-schedule-workspace \.om-schedule-rail \.om-view-card\.active\s*\{[^}]*background:\s*color-mix\(in srgb,\s*var\(--rb-orange-2\) 12%,\s*var\(--ui-control-bg\)\);/);
  assert.match(matchesStyles, /\.om-schedule-workspace \.om-schedule-rail > \.om-calendar-summary\s*\{[^}]*padding:\s*var\(--space-5\) var\(--space-6\) var\(--space-6\) var\(--space-10\);/);
  assert.match(matchesStyles, /\.om-schedule-workspace\.is-calendar\s*\{[^}]*justify-content:\s*space-between;/);
  assert.match(matchesStyles, /\.om-schedule-workspace > \.om-calendar-panel\s*\{[^}]*height:\s*100%;[^}]*align-self:\s*stretch;/);
  assert.match(matchesStyles, /\.om-schedule-workspace \.om-calendar-box\s*\{[^}]*height:\s*100%;[^}]*grid-template-rows:\s*auto auto minmax\(0, 1fr\);/);
  assert.match(pageSources.recruiting, /arena-queue-controls ui-design-soft-surface/);
  assert.match(createMatchPageSource, /create-eligibility-control ui-design-borderless-surface/);
  assert.match(createMatchPageSource, /create-public-note ui-design-borderless-surface/);
  assert.match(matchCreationWizardSource, /match-creation-summary-grid ui-design-borderless-list/);
  assert.match(matchCreationWizardSource, /match-creation-validation-list is-error ui-design-borderless-surface/);
  assert.match(pageSources.settings, /favorite-type-grid ui-design-borderless-list ui-design-borderless-surface/);
  assert.equal(count(settingsSource, "ui-design-choice-list"), 3);
  assert.match(pageSources.teams, /my-team-list ui-design-borderless-list/);
  assert.match(teamsSource, /favorite-search-label ui-field-span-all/);
  assert.match(primitiveStyles, /\.ui-field-span-all\s*\{[^}]*grid-column:\s*1 \/ -1;[^}]*width:\s*100%;/);
  assert.match(pageSources.profile, /contract-grid single ui-design-borderless-list/);
  assert.match(read("src/components/ranking/RankingTable.jsx"), /ranking-table ui-design-borderless-list/);
  assert.equal(count(read("src/components/rating/ProgressionChecklist.jsx"), "progression-list ui-design-borderless-list"), 2);
  assert.match(settingsSource, /referee-rulebook-panel compact ui-design-info-surface/);
  assert.match(settingsSource, /referee-exam-list ui-design-borderless-list/);
  assert.match(gettingStartedSource, /getting-started-chapter-nav ui-panel ui-design-info-surface/);
  assert.match(gettingStartedSource, /getting-started-steps ui-design-borderless-list/);
  assert.match(courtDetailSource, /court-map-link ui-liquid-glass/);
  assert.match(courtDetailSource, /court-detail-hero ui-page-hero ui-design-app-hero/);
  assert.match(courtDetailSource, /court-profile-information ui-design-content-surface/);
  assert.match(primitiveStyles, /\.ui-tier-label\s*\{[^}]*font-family:\s*var\(--sports-display-font\);[^}]*font-style:\s*normal;[^}]*font-weight:\s*(?:950|var\(--font-weight-sports\));/);
  assert.match(read("src/components/rating/RatingCard.jsx"), /className="ui-tier-label"/);
  assert.match(read("src/components/rating/TierEmblem.jsx"), /className="ui-tier-label"/);
  assert.doesNotMatch(
    editorialAppStyles,
    /\.(?:recent-match-row|my-team-row|match-list-card|ranking-row|rank-row|home-action-row|ui-entity-row)\b/,
  );
  assert.match(recentMatchRowSource, /ui-design-record-surface/);
  assert.deepEqual(designLeaks, []);
});

test("court detail hero tags use shared glass badges", () => {
  assert.match(courtDetailSource, /import Badge from "\.\.\/components\/common\/Badge\.jsx";/);
  const courtHeroTags = courtDetailSource.match(/<div className="court-detail-tags">([\s\S]*?)<\/div>/)?.[1] ?? "";
  assert.match(courtHeroTags, /<Badge>/);
  assert.doesNotMatch(courtHeroTags, /<span>/);
  assert.match(visualSystemStyles, /\.court-detail-tags \.ui-badge,/);
  assert.doesNotMatch(globalWorkflowStyles, /\.court-detail-tags span/);
});

test("player and team details share one entity profile hero", () => {
  assert.match(entityProfileHeroSource, /export default function EntityProfileHero/);
  assert.match(pageSources.playerDetail, /<EntityProfileHero/);
  assert.match(teamDetailSource, /<EntityProfileHero/);
  assert.doesNotMatch(pageSources.playerDetail, /<section className="profile-hero/);
  assert.doesNotMatch(teamDetailSource, /<section className="team-detail-hero/);
  assert.match(globalAdminStyles, /\.entity-profile-hero-copy,/);
  assert.doesNotMatch(pageSources.playerDetail, /leading=\{<ProfileEmblem|<TierBadge|rank-tier-statement/);
  assert.match(pageSources.playerDetail, /className="player-tier-hero"/);
  assert.match(pageSources.playerDetail, /className="ui-liquid-glass"/);
  assert.doesNotMatch(pageSources.playerDetail, /getDiscordDmUrl|DM 보내기|Discord에서 DM/);
  assert.match(globalWorkflowStyles, /\.team-tier-hero \.tier-emblem figcaption strong,\s*\.player-tier-hero \.tier-emblem figcaption strong\s*\{[^}]*color:\s*var\(--rb-yellow\);/);
});

test("프로필 공유 action은 엠블럼 열을 침범하지 않는다", () => {
  assert.match(shareCardSource, /className="share-card-action"/);
  assert.match(
    globalWorkflowStyles,
    /\.share-card-action\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;/,
  );
  assert.doesNotMatch(globalWorkflowStyles, /\.share-card-action\s*\{[^}]*width:\s*max-content;/);
  assert.match(
    globalWorkflowStyles,
    /\.share-card-emblem\s*\{[^}]*width:\s*100%;[\s\S]*?\.share-card-emblem \.tier-emblem\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*168px;/,
  );
  assert.doesNotMatch(globalWorkflowStyles, /\.share-card-emblem \.tier-emblem\s*\{[^}]*\d+vw/);
});

test("player detail uses shared record rows and one support rail", () => {
  assert.match(pageSources.playerDetail, /RecentMatchRow/);
  assert.doesNotMatch(pageSources.playerDetail, /history-item|personal-record-open-button|content-grid wide-left/);
  assert.equal(count(pageSources.playerDetail, "<aside"), 1);
  assert.match(pageSources.playerDetail, /className="ui-profile-identity-inline"/);
  assert.doesNotMatch(globalSearchStyles, /\.connection-list a\s*\{[^}]*gap:\s*9px;/);
  assert.match(pageSources.playerDetail, /className="recent-result-strip"/);
  assert.match(pageSources.playerDetail, /getActualMatchPlayerSideName/);
  assert.match(pageSources.playerDetail, /player\.privacy\?\.statSummary !== false/);
  assert.match(pageSources.playerDetail, /to=\{`\/app\/referees\/\$\{player\.id\}`\}/);
  assert.match(pageSources.playerDetail, /<ProfileRecordSummaryCard/);
  assert.match(pageSources.profileRecords, /<ProfileRecordSummaryCard/);
  assert.match(profileRecordSummarySource, /className="ui-folder-tabs profile-record-folder-tabs"/);
  assert.match(pageSources.playerDetail, /match\.visibility \?\? match\.rules\?\.visibility \?\? "private"/);
  assert.doesNotMatch(pageSources.playerDetail, /Career Totals|personal-record-profile-card/);
  assert.doesNotMatch(pageSources.playerDetail, /form-pill/);
  assert.doesNotMatch(globalSearchStyles, /\.form-pill(?:-row)?\s*\{/);
  assert.match(globalSurfaceStyles, /\.profile-detail-page \.profile-hero\s*\{[^}]*--page-hero-bg:\s*var\(--bg-profile\);/);
});

test("일반 프로필은 연락 수단을 노출하지 않고 컨텍스트 hover만 Kakao를 조회한다", () => {
  const playerHoverCard = read("src/components/profile/PlayerHoverCard.jsx");
  const sidebar = read("src/components/layout/Sidebar.jsx");
  const settingsPrimaryColumn = read("src/pages/SettingsPrimaryColumn.jsx");

  assert.doesNotMatch(pageSources.playerDetail, /getDiscordDisplayName|discordDisplayName/);
  assert.doesNotMatch(playerHoverCard, /getDiscordDisplayName|discordDisplayName/);
  assert.doesNotMatch(pageSources.playerDetail, /getDiscordDmUrl|DM 보내기|Discord에서 DM/);
  assert.doesNotMatch(playerHoverCard, /\/api\/discord\/dm-link|Discord에서 DM/);
  assert.doesNotMatch(sidebar, /getDiscordProfileUrl|Discord에서 DM|discord-link-badge/);
  assert.match(playerHoverCard, /contactContext && resolveContact/);
  assert.match(playerHoverCard, /resolveContact\("\/api\/contacts\/resolve"/);
  assert.match(playerHoverCard, /contact\?\.kind === "kakao"/);
  assert.match(settingsPrimaryColumn, /<strong>\{app\.currentUser\.name\}<\/strong>/);
});

test("referee detail uses the player hero structure and dedicated tier emblems", () => {
  assert.ok(fs.statSync("public/assets/rankball-record-create-night.webp").size > 0);
  assert.ok(fs.statSync("public/assets/rankball-record-create-day.webp").size > 0);
  for (const grade of ["candidate", "silver", "gold", "platinum", "official"]) {
    assert.ok(fs.statSync(`public/assets/referee-tier-emblems/referee-${grade}-v2.webp`).size > 0);
  }
  assert.match(pageSources.refereeDetail, /className="profile-hero rank-profile-hero referee-profile-hero"/);
  assert.match(pageSources.refereeDetail, /className="player-tier-hero"/);
  assert.match(pageSources.refereeDetail, /<RefereeTierEmblem grade=\{grade\} meta=\{gradeMeta\} size="hero" showLabel \/>/);
  assert.doesNotMatch(pageSources.refereeDetail, /leading=|referee-profile-grade/);
  assert.match(pageSources.refereeDetail, /className="referee-profile-body"/);
  assert.match(pageSources.refereeDetail, /"--referee-page-hero-bg-night": `url\("\$\{assetUrl\("\/assets\/rankball-record-create-night\.webp"\)\}"\)`/);
  assert.match(pageSources.refereeDetail, /"--referee-page-hero-bg-day": `url\("\$\{assetUrl\("\/assets\/rankball-record-create-day\.webp"\)\}"\)`/);
  assert.match(refereeTierEmblemSource, /<img/);
  assert.match(refereeTierEmblemSource, /referee-tier-emblems\/referee-candidate-v2\.webp/);
  assert.doesNotMatch(refereeTierEmblemSource, /Whistle|referee-tier-mark|referee-[a-z]+-v1/);
  assert.match(globalSearchStyles, /\.referee-profile-body\s*\{[^}]*grid-template-columns:/s);
  assert.match(globalSearchStyles, /\.profile-detail-page \.rank-profile-hero\.referee-profile-hero\s*\{[^}]*--page-hero-bg:\s*var\(--referee-page-hero-bg-night\);/s);
  assert.match(globalSearchStyles, /html\[data-theme="light"\] \.profile-detail-page \.rank-profile-hero\.referee-profile-hero\s*\{[^}]*--page-hero-bg:\s*var\(--referee-page-hero-bg-day\);/s);
  assert.match(pageSources.refereeDetail, /onOpen=\{\(\) => setSelectedMatchId\(match\.id\)\}/);
  assert.match(pageSources.refereeDetail, /<MatchRoomModal[\s\S]*entryPoint="referee-history"/);
});

test("signed-in login redirects and settings exposes logout", () => {
  const authStyles = read("src/styles/layout/app-shell-auth.css");
  assert.match(loginSource, /if \(auth\.session\) return <Navigate to=\{from\} replace \/>;/);
  assert.match(loginSource, /if \(location\.state\?\.authGate\) \{[\s\S]*?navigate\(-1\);[\s\S]*?return;[\s\S]*?\}/);
  assert.match(loginSource, /navigate\(getLoginBackTargetFromLocation\(location\), \{ replace: true \}\);/);
  assert.match(loginSource, /embeddedGoogleOAuthBrowser && showGoogleBrowserFallback/);
  assert.match(loginSource, /providerId === "google" && embeddedGoogleOAuthBrowser[\s\S]*?setShowGoogleBrowserFallback\(true\);[\s\S]*?return;/);
  assert.match(loginSource, /<AuthProviderIcon providerId=\{provider\.id\} \/>/);
  assert.match(authStyles, /\.auth-browser-copy-button\s*\{[^}]*width:\s*fit-content;[^}]*border:\s*0;[^}]*background:\s*transparent;/s);
  assert.match(authStyles, /\.auth-browser-warning\s*\{[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*background:\s*transparent;[^}]*padding:\s*0;/s);
  assert.match(matchReceiptSource, /const backTo = `\$\{location\.pathname\}\$\{location\.search\}\$\{location\.hash\}`;[\s\S]*?navigate\(getLoginPath\(returnTo, backTo\)\);/);
  assert.match(loginSource, /<div className="auth-card-head">[\s\S]*?<Link to="\/" className="brand auth-brand"[\s\S]*?<Button type="button"[^>]*className="auth-back-link" onClick=\{goBack\}/);
  assert.doesNotMatch(loginSource, /auth-card-primary|로그인 가능/);
  assert.match(authStyles, /\.auth-card-head\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\) auto;/s);
  assert.match(authStyles, /\.auth-brand \.brand-letter-wrap\s*\{[^}]*flex: 1 1 0;/s);
  assert.match(authStyles, /\.auth-card-head \.auth-back-link\s*\{[^}]*border-width:\s*0;/s);
  assert.match(settingsSource, /<SettingsPageView controller=\{controller\} auth=\{props\.auth\} \/>/);
  assert.match(settingsSource, /window\.confirm\("로그아웃하시겠습니까\?"\)/);
  assert.match(settingsSource, /<LogOut size=\{16\} \/> 로그아웃/);
  assert.doesNotMatch(settingsSource, /<header[^>]*>[\s\S]*?auth\.signOut[\s\S]*?<\/header>/);
  assert.match(settingsSource, /className=\{`content-grid[\s\S]*?settings-account-card[\s\S]*?settings-signout-row[\s\S]*?<SettingsRefereeSection controller=\{controller\} \/>/);
  assert.match(settingsSource, /settings-signout-row[\s\S]*?variant="danger"/);
  assert.match(settingsSource, /canSwitchTestAccount[\s\S]*?<details className="settings-test-account-switcher"/);
  assert.match(settingsSource, /auth\.switchTestAccount\(testLoginId\)/);
  assert.match(settingsSource, /createOriginalAdminAccount[\s\S]*?ORIGINAL_ADMIN_ACCOUNT_ID[\s\S]*?switchAccounts\.map/);
  assert.match(settingsStyles, /\.settings-signout-row \.button\s*\{[^}]*width:\s*100%;/);
});

test("guest shell replaces the demo identity with login actions", () => {
  const sidebar = read("src/components/layout/Sidebar.jsx");
  const bottomNav = read("src/components/layout/BottomNav.jsx");
  const guestAccessNotice = read("src/components/auth/GuestAccessNotice.jsx");

  assert.match(appShellSource, /<Sidebar[^>]*guestPreview=\{guestPreview\}/);
  assert.match(appShellSource, /<BottomNav guestPreview=\{guestPreview\} unreadNotificationCount=\{unreadNotificationCount\} \/>/);
  assert.doesNotMatch(appShellSource, /guest-preview-bar/);
  assert.match(sidebar, /guestPreview \? \([\s\S]*?<strong>\{shellCopy\.signIn\}<\/strong>/);
  assert.match(bottomNav, /<NavLink key=\{item\.to\} to=\{item\.to\}/);
  assert.match(bottomNav, /<details ref=\{moreRef\} className="bottom-nav-more">/);
  assert.match(bottomNav, /document\.addEventListener\("pointerdown", closeMoreOutside\)/);
  assert.match(bottomNav, /!more\.contains\(event\.target\)[\s\S]*removeAttribute\("open"\)/);
  assert.match(bottomNav, /<Ellipsis size=\{20\} \/>[\s\S]*?<span>\{shellCopy\.more\}<\/span>/);
  assert.match(bottomNav, /to: "\/app\/profile", labelKey: "me"/);
  assert.match(bottomNav, /to: "\/app\/teams", labelKey: "teams"/);
  assert.match(bottomNav, /to: "\/app\/settings", labelKey: "settings"/);
  assert.match(bottomNav, /closest\("details"\)\?\.removeAttribute\("open"\)/);
  assert.doesNotMatch(bottomNav, /isGuestProfile|getLoginPath|LogIn/);
  assert.match(appSource, /"\/app\/community"/);
  assert.match(appSource, /<GuestAccessNotice title="플레이는 로그인 후 확인할 수 있습니다"/);
  assert.match(appSource, /<GuestAccessNotice title="내 정보는 로그인 후 확인할 수 있습니다"/);
  assert.match(appSource, /<GuestAccessNotice title="설정은 로그인 후 확인할 수 있습니다"/);
  assert.match(
    appSource,
    /path="\/app\/operations"[\s\S]*?<GuestAccessNotice[\s\S]*?title="운영은 로그인 후 확인할 수 있습니다"/,
  );
  assert.match(guestAccessNotice, /showActions = true/);
  assert.match(guestAccessNotice, /action=\{showActions \? \(/);
  assert.doesNotMatch(appSource, /showActions=\{false\}/);
  assert.match(homePageSource, /to="\/app\/community"[^>]*>[\s\S]*?커뮤니티/);
  assert.match(homePageSource, /function GuestHomePage[\s\S]*home-search-panel[\s\S]*home-left-rail[\s\S]*home-right-rail/);
  assert.match(homePageSource, /<GuestAccessNotice title="일정은 로그인 후 확인할 수 있습니다"[\s\S]*returnTo="\/app\/matches"/);
  assert.match(homePageSource, /<GuestAccessNotice title="최근 전적은 로그인 후 확인할 수 있습니다"[\s\S]*showPublicMatches=\{false\}/);
  assert.equal((homePageSource.match(/showActions=\{false\}/g) ?? []).length, 2);
  assert.equal((teamsSource.match(/showActions=\{false\}/g) ?? []).length, 1);
  assert.doesNotMatch(teamsSource, /title="팀 생성은 로그인 후 사용할 수 있습니다"/);
  assert.doesNotMatch(homePageSource, /<Badge tone="neutral">로그인<\/Badge>/);
  assert.match(homePageSource, /<h2>공개 랭크보드<\/h2>/);
  assert.doesNotMatch(read("src/styles/layout/app-shell-auth.css"), /\.guest-preview-bar/);
});

test("court request report selection reveals the existing report form", () => {
  assert.match(settingsSource, /selectedReportCourtRequest \? " settings-report-open" : ""/);
  assert.match(settingsStyles, /\.settings-section-courts:not\(\.settings-report-open\) \.settings-report-card/);
  assert.match(settingsStyles, /:not\(\.settings-court-card\):not\(\.settings-report-card\)/);
});

test("regular room referee invitations live only in the room modal", () => {
  const createSections = [
    read("src/components/match/CreateMatchDetailsSection.jsx"),
    read("src/components/match/CreateMatchPolicyReviewSection.jsx"),
  ].join("\n");
  const creationSource = read("src/data/repository/recruiting/creation.js");

  assert.doesNotMatch(createSections, /CreateMatchRefereePicker/);
  assert.doesNotMatch(creationSource, /getTrustedRefereeId|requestedRefereeId/);
  assert.match(creationSource, /const initialRefereeInvitations = \[\];/);
  assert.match(recruitingPageSource, /const showRefereeInviteSlot = !selectedPost\.refereeId;/);
  assert.match(recruitingPageSource, /<RefereeInvitePanel/);
  assert.match(recruitingStyles, /\.arena-referee-invite-panel header strong\s*\{[^}]*font-size:\s*var\(--font-size-title-sm\);/s);
  assert.match(recruitingStyles, /\.arena-referee-invite-panel header span\s*\{[^}]*font-size:\s*var\(--font-size-meta\);/s);
  assert.doesNotMatch(recruitingStyles, /\.arena-referee-invite-panel \.arena-invite-search input\s*\{/);
});

test("shared SearchPicker owns canonical result typography", () => {
  assert.match(searchPickerStyles, /\.search-picker-title\s*\{[^}]*font-size:\s*var\(--font-size-meta\);[^}]*font-weight:\s*var\(--font-weight-title\);/s);
  assert.match(searchPickerStyles, /\.search-picker-result-row\s*\{[^}]*font-family:\s*var\(--font-body\);[^}]*font-size:\s*var\(--font-size-body-sm\);[^}]*font-weight:\s*var\(--font-weight-body\);/s);
  assert.match(searchPickerStyles, /\.search-picker-result-row strong,[\s\S]*?\.search-picker-result-main strong\s*\{[^}]*font-size:\s*var\(--font-size-body-sm\);[^}]*font-weight:\s*var\(--font-weight-title\);/s);
  assert.match(searchPickerStyles, /\.search-picker-result-main > span\s*\{[^}]*font-size:\s*var\(--font-size-meta\);[^}]*font-weight:\s*var\(--font-weight-support\);/s);
  assert.match(searchPickerStyles, /\.search-picker-result-row em,[\s\S]*?\.search-picker-result-main em\s*\{[^}]*font-size:\s*var\(--control-font-size\);[^}]*font-weight:\s*var\(--font-weight-control\);/s);
  assert.match(searchPickerStyles, /\.home-search-results:not\(\.search-picker-results\) em\s*\{/);
  assert.doesNotMatch(recruitingStyles, /\.arena-room-rule-panel (?:strong|span)\s*\{/);
});

test("win loss draw records use shared rounded semantic rails in every theme", () => {
  assert.match(tokenStyles, /--ui-result-win-border:\s*var\(--blue\);/);
  assert.match(tokenStyles, /--ui-result-loss-border:\s*var\(--danger\);/);
  assert.match(tokenStyles, /--ui-result-draw-border:\s*var\(--gold\);/);
  assert.match(tokenStyles, /--ui-status-rail-width:\s*4px;/);
  assert.match(tokenStyles, /--ui-status-rail-inset:\s*10px;/);
  assert.match(tokenStyles, /--ui-status-rail-radius:\s*var\(--ui-badge-radius\);/);
  assert.match(
    primitiveStyles,
    /html\[data-theme\] \.app-main :is\(\.recent-match-row\.result-w, \.rank-match-win\)\s*\{[^}]*--ui-status-rail-color:\s*var\(--ui-result-win-border\);/,
  );
  assert.match(
    primitiveStyles,
    /html\[data-theme\] \.app-main :is\(\.recent-match-row\.result-l, \.rank-match-loss\)\s*\{[^}]*--ui-status-rail-color:\s*var\(--ui-result-loss-border\);/,
  );
  assert.match(
    primitiveStyles,
    /html\[data-theme\] \.app-main :is\(\.recent-match-row\.result-d, \.rank-match-draw\)\s*\{[^}]*--ui-status-rail-color:\s*var\(--ui-result-draw-border\);/,
  );
  assert.match(
    primitiveStyles,
    /html\[data-theme\] \.app-main :is\(\.recent-match-row, \.rank-match-item\)::before(?:,\s*html\[data-theme\] \.app-main \.ui-design-record-surface::before)?\s*\{[^}]*inset:\s*var\(--ui-status-rail-inset\) auto var\(--ui-status-rail-inset\) 0;[^}]*width:\s*var\(--ui-status-rail-width\);[^}]*border-radius:\s*var\(--ui-status-rail-radius\);[^}]*background:\s*var\(--ui-status-rail-color, var\(--rb-soft\)\);/,
  );
});

test("inline profile identities share one icon text gap", () => {
  assert.match(tokenStyles, /--ui-profile-identity-gap:\s*var\(--space-4\);/);
  assert.match(
    primitiveStyles,
    /\.ui-profile-identity-inline\s*\{[^}]*display:\s*inline-flex;[^}]*align-items:\s*center;[^}]*gap:\s*var\(--ui-profile-identity-gap\);/,
  );
  assert.equal(countClassToken(pageSources.teamDetail, "ui-profile-identity-inline"), 2);
});

test("받은 팀 초대와 팀 상세 로스터는 무테두리 목록과 inline 역할 뱃지를 사용한다", () => {
  assert.match(notificationsSource, /className="home-invitation-list ui-design-borderless-list"/);
  assert.match(teamDetailSource, /className="member-list ui-design-borderless-list"/);
  assert.match(
    teamDetailSource,
    /className="member-name-line ui-profile-identity-inline"[\s\S]*?<strong>\{user\.name\}<\/strong>[\s\S]*?<MemberTypeBadge role=\{member\.role\} \/>/,
  );
});

test("팀 목록 카드는 전체가 팀 상세 링크이고 공용 무테두리 폭을 따른다", () => {
  const teamCardSource = read("src/components/team/TeamCard.jsx");

  assert.match(teamCardSource, /import \{ Link \} from "react-router-dom";/);
  assert.match(teamCardSource, /<Card[\s\S]*?as=\{linked \? Link : "section"\}[\s\S]*?to=\{linked \? `\/app\/teams\/\$\{team\.id\}` : undefined\}/);
  assert.doesNotMatch(teamCardSource, /TeamHoverCard/);
  assert.match(tokenStyles, /\[data-design="editorial"\] \.ui-design-app\s*\{[^}]*--ui-card-border-width:\s*0px;/);
});

test("team emblem text controls keep one height at every form factor", () => {
  assert.match(tokenStyles, /--ui-team-emblem-text-control-height:\s*64px;/);
  assert.match(
    globalSearchStyles,
    /\.team-emblem-text-controls label\s*\{[^}]*grid-template-rows:\s*auto var\(--ui-team-emblem-text-control-height\) auto;[^}]*align-content:\s*start;/,
  );
  assert.match(
    globalSearchStyles,
    /\.team-emblem-text-controls select,[\s\S]*?\.team-emblem-text-controls textarea\s*\{[^}]*height:\s*var\(--ui-team-emblem-text-control-height\);[^}]*min-height:\s*var\(--ui-team-emblem-text-control-height\);[^}]*max-height:\s*var\(--ui-team-emblem-text-control-height\);/,
  );
});

test("general UI copy wraps at spaces without splitting words", () => {
  const foundationStyles = readCssTree("src/styles/global-foundation.css");
  const bodyRule = getRuleBody(foundationStyles, "body");

  assert.match(bodyRule, /word-break:\s*keep-all;/);
  assert.match(bodyRule, /overflow-wrap:\s*break-word;/);
  assert.doesNotMatch(allStyleSources, /word-break:\s*break-all;/);
});

test("home favorite search uses the full input width without splitting court names", () => {
  assert.match(
    visualSystemStyles,
    /\.rank-home \.home-search-results\.home-global-search-results\.is-floating\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*none;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/,
  );
  assert.match(
    courtControlStyles,
    /\.rank-home \.home-global-search-results \.rank-result-main > strong\s*\{[^}]*word-break:\s*keep-all;[^}]*overflow-wrap:\s*break-word;/,
  );
  assert.match(
    courtControlStyles,
    /@media \(max-width:\s*759px\)\s*\{[\s\S]*?\.rank-home \.home-global-search-results > \.home-search-entity-trigger\s*\{[^}]*grid-template-columns:\s*auto minmax\(0,\s*1fr\);[\s\S]*?\.rank-home \.home-global-search-results > \.home-search-entity-trigger > small\s*\{[^}]*grid-column:\s*2;/,
  );
});

test("record result cards share matchup and date mode court metadata", () => {
  assert.match(
    recentMatchRowSource,
    /className="recent-match-matchup"[\s\S]*?<MatchTeamName side=\{side\}[\s\S]*?className="recent-match-vs">vs<\/span>[\s\S]*?<MatchTeamName side=\{opponent\}[\s\S]*?<MatchRecordMeta record=\{record\}/,
  );
  assert.match(recentMatchRowSource, /neutral:\s*"neutral"[\s\S]*?neutral:\s*"-"/);
  assert.match(
    matchRecordMetaSource,
    /const prefix = \[date, mode\]\.filter\(Boolean\)\.join\(" · "\)/,
  );
  assert.match(
    matchRecordMetaSource,
    /match-record-meta__court[\s\S]*?\{afterCourt\}/,
  );
  assert.match(
    matchRecordMetaSource,
    /match-record-meta__labels[\s\S]*?match-record-meta__label--personal[\s\S]*?match-record-meta__label--\$\{isPublic \? "public" : "private"\}/,
  );
  assert.doesNotMatch(matchRecordMetaSource, /afterMode|ui-badge/);
  assert.match(
    globalSearchStyles,
    /\.match-record-meta,[\s\S]*?\.recent-match-row \.match-record-meta\s*\{[^}]*display:\s*flex;[^}]*white-space:\s*nowrap;/,
  );
  assert.match(
    globalSearchStyles,
    /\.match-record-meta__labels,[\s\S]*?\.recent-match-row \.match-record-meta__labels\s*\{[^}]*display:\s*inline-flex;[^}]*flex-wrap:\s*nowrap;/,
  );
  assert.match(
    globalSearchStyles,
    /\.match-record-meta__label--personal\s*\{[^}]*color:\s*var\(--gold\);[\s\S]*?\.match-record-meta__label--public\s*\{[^}]*color:\s*var\(--green\);[\s\S]*?\.match-record-meta__label--private\s*\{[^}]*color:\s*var\(--blue\);/,
  );
  for (const page of ["home", "profile", "profileRecords", "teamDetail"]) {
    assert.match(pageSources[page], /RecentMatchRow/);
  }
  assert.match(globalSearchStyles, /\.recent-match-list\s*\{[^}]*--recent-match-list-gap:\s*calc\(var\(--ui-compact-list-gap\) \* 2\);[^}]*gap:\s*var\(--recent-match-list-gap\);/);
  assert.match(
    globalSearchStyles,
    /\.recent-match-matchup\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*flex-start;[^}]*justify-content:\s*flex-start;/,
  );
  assert.match(
    globalSearchStyles,
    /\.recent-match-row > span\s*\{[^}]*gap:\s*var\(--ui-compact-record-content-gap\);/,
  );
  assert.match(
    globalSearchStyles,
    /\.recent-match-copy\s*\{[^}]*gap:\s*var\(--ui-compact-record-content-gap\);/,
  );
  assert.match(tokenStyles, /--ui-compact-list-gap:\s*var\(--space-3\);/);
  assert.match(
    tokenStyles,
    /--ui-compact-record-row-padding:\s*var\(--space-4\) var\(--space-5\);/,
  );
  assert.match(tokenStyles, /--ui-compact-record-content-gap:\s*var\(--space-2\);/);
  const recentMatchupRule = getRuleBody(globalSearchStyles, ".recent-match-matchup");
  assert.doesNotMatch(recentMatchupRule, /min-height:/);
  assert.match(recentMatchupRule, /max-height:\s*var\(--ui-record-team-line-block-size\);/);
  assert.doesNotMatch(courtControlStyles, /\.home-recent-card \.recent-match-(?:copy|matchup|vs)/);
});

test("표면 선 두께는 공통 토큰을 사용하고 방 모달은 뱃지를 건드리지 않는다", () => {
  assert.match(tokenStyles, /--ui-card-border-width:\s*0px;/);
  assert.match(tokenStyles, /--ui-button-border-width:\s*0px;/);
  assert.match(tokenStyles, /--ui-control-group-border-width:\s*0px;/);
  assert.match(tokenStyles, /--ui-room-modal-border-width:\s*1px;/);
  assert.match(primitiveStyles, /\.ui-card\s*\{[\s\S]*?border:\s*var\(--ui-card-border-width\) solid var\(--ui-card-border\);/);
  assert.match(primitiveStyles, /\.ui-button\s*\{[\s\S]*?border:\s*var\(--ui-button-border-width\) solid var\(--ui-button-border\);/);
  assert.match(tokenStyles, /\.ui-room-borderless-scope\s*\{[\s\S]*?--ui-room-modal-border-width:\s*0px;[\s\S]*?--ui-room-panel-border-width:\s*0px;[\s\S]*?\}/);
  assert.doesNotMatch(
    nonTokenStyleSources,
    /--ui-(?:card|button|control-group|hero|room-modal|room-panel)-border-width\s*:/,
  );
  assert.equal(count(pageSources.recruiting, "ui-room-borderless-scope"), 3);
  assert.equal(count(pageSources.matches, "ui-room-borderless-scope"), 3);
});

test("페이지 CSS는 공통 표면 토큰을 다시 1px로 덮지 않는다", () => {
  assert.doesNotMatch(
    allStyleSources,
    /border:\s*1px solid var\(--ui-(?:card|button|control-group|room-modal|room-panel)-border/,
  );
  assert.match(globalSurfaceStyles, /\.page-header\s*\{[\s\S]*?border:\s*var\(--ui-hero-border-width\)/);
  assert.match(globalWorkflowStyles, /\.team-hub-hero\s*\{[\s\S]*?border:\s*var\(--ui-hero-border-width\)/);
  assert.match(globalWorkflowStyles, /\.contract-grid div\s*\{[\s\S]*?border:\s*var\(--ui-card-border-width\)/);
  assert.match(foundationStyles, /\.compact-list a,[\s\S]*?border:\s*var\(--ui-card-border-width\) solid var\(--ui-card-border\);/);
  assert.match(matchRoomStyles, /\.gm-room-hero\s*\{[\s\S]*?border:\s*var\(--ui-hero-border-width\)/);
});

test("설정 보조 정보는 같은 작은 글자 규격을 사용한다", () => {
  assert.equal(count(settingsSource, "contract-grid single ui-support-grid"), 2);
  assert.equal(count(settingsSource, "compact-list ui-support-list"), 2);
  assert.match(settingsSource, /ui-empty-state-compact ui-support-copy/);
  assert.match(
    primitiveStyles,
    /\.ui-support-grid > \* > :is\(strong, em\),[\s\S]*?\.ui-support-copy\s*\{[\s\S]*?font-size:\s*var\(--font-size-body-sm\);/,
  );
});

function getRuleBody(source, selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`${escapedSelector}\\s*\\{([^{}]*)\\}`));
  assert.ok(match, `${selector} 규칙이 필요합니다.`);
  return match[1];
}

test("개인 기록 숫자 입력칸은 별도 테두리를 표시하지 않는다", () => {
  assert.match(
    matchCreateOperationsStyles,
    /\.personal-record-score-field\.stat-stepper-row \.stat-numeric-stepper input,\s*\.personal-record-stat-grid \.stat-stepper-row \.stat-numeric-stepper input\s*\{[^}]*border:\s*0;/,
  );
});

test("모든 페이지는 공용 의미 굵기 위계를 사용하고 명시형 굵기는 500 이상을 유지한다", () => {
  const foundationStyles = readCssTree("src/styles/global-foundation.css");
  const bodyRule = getRuleBody(foundationStyles, "body");
  const forbiddenWeights = [];

  assert.match(tokenStyles, /--font-weight-min:\s*500;/);
  assert.match(tokenStyles, /--font-weight-support:\s*550;/);
  assert.match(tokenStyles, /--font-weight-body:\s*650;/);
  assert.match(tokenStyles, /--font-weight-control:\s*700;/);
  assert.match(tokenStyles, /--font-weight-title:\s*850;/);
  assert.match(bodyRule, /font-weight:\s*var\(--font-weight-body\);/);

  for (const file of styleFiles) {
    const source = read(file);
    for (const match of source.matchAll(/font-weight\s*:\s*([^;}{]+)\s*;/g)) {
      const value = match[1].trim();
      const numericWeight = Number(value);
      if (
        (Number.isFinite(numericWeight) && numericWeight < 500)
        || /^(?:normal|lighter|initial|unset|revert|revert-layer)$/i.test(value)
      ) {
        forbiddenWeights.push(`${file}: ${value}`);
      }
    }
  }

  for (const file of sourceFiles) {
    const source = read(file);
    for (const match of source.matchAll(/fontWeight\s*:\s*["']?([^"',}\s]+)/g)) {
      const value = match[1].trim();
      const numericWeight = Number(value);
      if (
        (Number.isFinite(numericWeight) && numericWeight < 500)
        || /^(?:normal|lighter|initial|unset|revert|revert-layer)$/i.test(value)
      ) {
        forbiddenWeights.push(`${file}: ${value}`);
      }
    }
  }

  assert.deepEqual(forbiddenWeights, []);
});

test("KBL과 Anton은 스포츠 표시, Pretendard는 읽기와 조작 UI에 사용한다", () => {
  assert.match(tokenStyles, /--font-weight-min:\s*500;/);
  assert.match(tokenStyles, /--font-weight-support:\s*550;/);
  assert.match(tokenStyles, /--font-weight-body:\s*650;/);
  assert.match(tokenStyles, /--font-weight-control:\s*700;/);
  assert.match(tokenStyles, /--font-weight-title:\s*850;/);
  assert.match(tokenStyles, /--font-weight-sports:\s*900;/);
  assert.match(tokenStyles, /--sports-display-font:\s*"BoxTier Sports Display", "KBL Jump Condensed", "Anton", sans-serif;/);
  assert.match(tokenStyles, /--sports-display-team-line-height:\s*1\.08;/);
  assert.match(tokenStyles, /src:\s*url\("\/assets\/fonts\/BoxTier-Sports-Latin\.ttf"\) format\("truetype"\);/);
  assert.equal((tokenStyles.match(/ascent-override:\s*80%;/g) || []).length, 2);
  assert.equal((tokenStyles.match(/descent-override:\s*20%;/g) || []).length, 2);
  assert.equal((tokenStyles.match(/line-gap-override:\s*0%;/g) || []).length, 2);
  assert.match(tokenStyles, /font-family:\s*"Anton";[^}]*src:\s*url\("\/assets\/fonts\/Anton-Regular\.ttf"\)/s);
  assert.match(tokenStyles, /--receipt-sports-display-font:\s*"KBO Dia Gothic", "Arial Narrow", "Roboto Condensed", sans-serif;/);
  assert.match(tokenStyles, /--font-size-caption:\s*0\.75rem;/);
  assert.match(tokenStyles, /--font-size-control:\s*0\.78rem;/);
  assert.match(tokenStyles, /--font-size-meta:\s*0\.82rem;/);
  assert.match(tokenStyles, /--font-size-body:\s*0\.9375rem;/);
  assert.match(tokenStyles, /--font-size-section-title:\s*1\.25rem;/);
  assert.match(
    foundationStyles,
    /body\s*\{[^}]*font-family:\s*var\(--font-body\);[^}]*font-size:\s*var\(--font-size-body\);[^}]*font-weight:\s*var\(--font-weight-body\);/,
  );
  assert.match(
    primitiveStyles,
    /\.ui-badge\s*\{[^}]*font-size:\s*var\(--ui-badge-font-size\);[^}]*font-weight:\s*var\(--ui-badge-font-weight\);/,
  );
  assert.match(
    recruitingStyles,
    /\.arena-room-rule-head > strong,[\s\S]*?\.arena-room-chat header span\s*\{[^}]*font-family:\s*var\(--font-body\);[^}]*font-size:\s*var\(--font-size-section-title\);[^}]*font-weight:\s*var\(--font-weight-title\);/,
  );
  assert.doesNotMatch(visualSystemStyles, /\.page-header h1,\s*\.auth-card h1/);
  assert.doesNotMatch(globalSearchStyles, /\.approval-teaser-card \.compact-list a > span\s*\{[^}]*var\(--sports-display-font\)/);
});

test("공용 CTA는 좁은 화면에서도 내용 너비를 유지한다", () => {
  assert.match(
    pageSources.home,
    /className="ui-action-row home-public-actions"><Button as=\{Link\} to="\/app\/teams"[\s\S]*?to="\/app\/community"[\s\S]*?to="\/app\/guide\/practice"/,
  );
  assert.match(
    read("src/styles/responsive/home-dashboard-responsive.css"),
    /\.home-public-actions\s*\{[^}]*flex-wrap:\s*nowrap;/,
  );
  assert.equal(countClassToken(pageSources.matches, "ui-button-block"), 0);
  assert.equal(countClassToken(pageSources.recruiting, "ui-button-block"), 0);
  assert.equal(countClassToken(pageSources.season, "ui-button-block"), 1);
  assert.match(primitiveStyles, /\.ui-button-block\s*\{\s*width:\s*fit-content;\s*max-width:\s*100%;\s*\}/);
  assert.match(tokenStyles, /--ui-action-button-max-inline-size:\s*176px;/);
  assert.match(tokenStyles, /--ui-action-trio-max-inline-size:\s*552px;/);
  assert.match(primitiveStyles, /max-inline-size:\s*min\(100%, var\(--ui-action-button-max-inline-size\)\);/);
  assert.match(
    primitiveStyles,
    /\.form-grid > \.ui-button[^}]*inline-size:\s*min\(100%, var\(--ui-action-button-max-inline-size\)\);[^}]*justify-self:\s*start;/,
  );
  assert.match(
    read("src/styles/responsive/home-dashboard-responsive.css"),
    /\.home-search-actions\s*\{[^}]*width:\s*min\(100%, var\(--ui-action-trio-max-inline-size\)\);/,
  );
  assert.match(
    primitiveStyles,
    /html\[data-theme\] \.guest-landing-primary-actions\s*\{[^}]*width:\s*min\(100%, var\(--ui-action-pair-max-inline-size\)\);[^}]*max-width:\s*var\(--ui-action-pair-max-inline-size\);/,
  );
  assert.doesNotMatch(primitiveStyles, /@media \(max-width:\s*760px\)[\s\S]*?\.ui-button-block\s*\{\s*width:\s*100%;\s*\}/);
  assert.doesNotMatch(allStyleSources, /\.season-play-report > a\s*\{[^}]*display:\s*block/);
  assert.doesNotMatch(allStyleSources, /\.ranking-name span\s*\{/);
  for (const source of [pageSources.home, pageSources.matches, pageSources.recruiting]) {
    assert.match(source, /to="\/app\/create\?intent=record" variant="secondary"/);
  }
});

test("데스크톱 side rail은 공용 중성 표면과 무테 활성 상태를 사용한다", () => {
  const dashboardThemeStyles = read("src/styles/themes/home-dashboard-theme.css");
  const compositionThemeStyles = read("src/styles/themes/home-composition-theme.css");

  assert.equal(count(tokenStyles, "--ui-rail-bg:"), 2);
  assert.equal(count(tokenStyles, "--ui-rail-item-hover-bg:"), 2);
  assert.equal(count(tokenStyles, "--ui-rail-item-active-bg:"), 2);
  assert.match(dashboardThemeStyles, /\.sidebar\s*\{[^}]*border-right:\s*0;[^}]*background:\s*var\(--ui-rail-bg\);[^}]*backdrop-filter:\s*none;/);
  assert.match(dashboardThemeStyles, /\.sidebar-nav a\s*\{[^}]*min-height:\s*var\(--ui-button-height\);[^}]*border:\s*0;/);
  assert.match(dashboardThemeStyles, /\.sidebar-nav a\.active\s*\{[^}]*background:\s*var\(--ui-rail-item-active-bg\);/);
  assert.match(dashboardThemeStyles, /\.sidebar-profile\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;/);
  assert.match(compositionThemeStyles, /html\[data-theme="light"\] \.sidebar\s*\{[^}]*background:\s*var\(--ui-rail-bg\);[^}]*border-right-color:\s*transparent;/);
});

test("공용 버튼과 badge 라벨은 한 줄을 유지한다", () => {
  assert.match(primitiveStyles, /\.ui-button\s*\{[\s\S]*?white-space:\s*nowrap;/);
  assert.match(primitiveStyles, /\.ui-button\s*\{[\s\S]*?height:\s*var\(--ui-button-height\);/);
  assert.match(read("src/styles/primitives/shared-controls.css"), /input:not\([\s\S]*?select,[\s\S]*?height:\s*var\(--ui-button-height\);/);
  assert.match(primitiveStyles, /\.ui-button\.ui-button-sm\s*\{[\s\S]*?height:\s*var\(--ui-button-height-sm\);/);
  assert.match(read("src/styles/features/match-create-operations.css"), /\.create-match-info-grid\.is-standard-room select,[\s\S]*?min-height:\s*var\(--ui-button-height\);/);
  assert.match(primitiveStyles, /\.ui-badge\s*\{[\s\S]*?flex:\s*0 0 auto;[\s\S]*?white-space:\s*nowrap;/);
  assert.match(primitiveStyles, /\.ui-action-row > \*\s*\{\s*flex:\s*0 0 auto;\s*\}/);
  assert.match(tokenStyles, /--ui-button-bg:\s*var\(--button-secondary-bg\);/);
  assert.equal(count(tokenStyles, "--button-secondary-bg: var(--surface-3);"), 2);
  assert.match(tokenStyles, /--ui-button-secondary-bg:\s*var\(--button-secondary-bg\);/);
  assert.match(primitiveStyles, /\.ui-button\.ui-button-secondary\s*\{[^}]*background:\s*var\(--ui-button-secondary-bg\);[^}]*border-color:\s*transparent;/);
  assert.equal(count(read("src/styles/themes/home-dashboard-theme.css"), "background: var(--ui-button-bg);"), 2);
  assert.doesNotMatch(hoverSurfaceStyles, /(?:^|\n)\s*\.button\s*\{[^{}]*white-space:\s*normal;/);
});

test("알림 보기와 읽음은 같은 네모 버튼 규격을 사용한다", () => {
  const notificationSource = read("src/pages/Notifications.jsx");
  assert.match(notificationSource, /notification-action-control notification-terminal-state/);
  assert.match(notificationSource, /notification-action-control notification-row-open/);
  assert.match(notificationSource, /notification-action-control notification-read-button/);
  assert.match(
    foundationStyles,
    /\.notification-actions \.notification-action-control\s*\{[^}]*min-width:\s*calc\(var\(--ui-button-height-sm\) \+ var\(--space-6\)\);[^}]*height:\s*var\(--ui-button-height-sm\);[^}]*min-height:\s*var\(--ui-button-height-sm\);[^}]*border-radius:\s*var\(--ui-button-radius\);/,
  );
  assert.match(
    foundationStyles,
    /\.notification-actions \.notification-read-button\s*\{[^}]*min-width:\s*calc\(var\(--ui-button-height-sm\) \+ var\(--space-6\)\);[^}]*height:\s*var\(--ui-button-height-sm\);/,
  );
  assert.doesNotMatch(
    foundationStyles,
    /\.notification-row-open[^}]*border-radius:\s*999px/,
  );
  assert.doesNotMatch(
    foundationStyles,
    /\.notification-terminal-state\s*\{[^}]*border-radius:\s*999px/,
  );
});

test("guide screenshots ship with the app and the shot clock has one separated outline", () => {
  assert.match(gettingStartedSource, /src=\{assetUrl\(chapter\.image\)\}/);
  assert.match(
    matchClockStyles,
    /\.ui-match-clock-display-grid\s*\{[^}]*--match-clock-display-gap:[^;]+;[^}]*gap:\s*var\(--match-clock-display-gap\);/,
  );
  assert.match(
    matchClockStyles,
    /\.ui-match-shot-clock\s*\{[^}]*background:\s*var\(--scoreboard\);[^}]*border:\s*var\(--ui-stroke-width\) solid var\(--rb-orange\);[^}]*box-shadow:\s*0 8px 18px[^;]+;/,
  );
  assert.doesNotMatch(
    matchClockStyles,
    /\.ui-match-shot-clock(?::[^{]+)?\s*\{[^}]*box-shadow:[^}]*(?:0 5px 0|0 2px 0)/,
  );
  assert.match(matchClockStyles, /\.ui-match-clock-panel-focus:not\(\.ui-match-clock-panel-pending\)\s*\{[^}]*grid-template-columns:\s*minmax\(0, 0\.72fr\)\s*minmax\(280px, 1\.56fr\)\s*minmax\(0, 0\.72fr\);/);
  assert.match(matchClockStyles, /\.ui-match-clock-panel-focus \.ui-match-clock-device-tools\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 0\.72fr\)\) minmax\(0, 2fr\);/);
  assert.match(matchClockStyles, /\.ui-match-clock-panel-focus \.ui-match-clock-volume input\[type="range"\]\s*\{[^}]*min-width:\s*0;/);
  assert.match(matchClockStyles, /\.ui-match-clock-panel-focus \.ui-match-clock-score-actions \.ui-button\s*\{[^}]*min-height:\s*calc\(var\(--ui-button-height\) \+ var\(--space-4\)\);/);
  assert.match(matchClockStyles, /\.ui-match-clock-attendance-qr\s*\{[^}]*border:\s*0;/);
  assert.match(matchClockStyles, /\.ui-match-clock-score-control-side-a \.ui-button\s*\{[^}]*background:\s*var\(--team-home\);/);
  assert.match(matchClockStyles, /\.ui-match-clock-score-control-side-b \.ui-button\s*\{[^}]*background:\s*var\(--team-away\);/);
  assert.match(matchClockSource, /className="ui-match-clock-period">\{periodDisplayLabel\}/);
  assert.match(matchClockSource, /`\$\{liveClock\?\.currentPeriod \|\| 1\}Q`/);
  assert.doesNotMatch(matchClockSource, /<Badge[^>]*>\{getMatchClockPeriodLabel\(liveClock\)\}<\/Badge>/);
});

test("공용 체크박스는 iOS native 외형을 사용하지 않는다", () => {
  const checkboxRule = getRuleBody(primitiveStyles, 'input[type="checkbox"]');
  const checkedRule = getRuleBody(primitiveStyles, 'input[type="checkbox"]:checked');
  const focusRule = getRuleBody(primitiveStyles, 'input[type="checkbox"]:focus-visible');

  assert.match(checkboxRule, /-webkit-appearance:\s*none;/);
  assert.match(checkboxRule, /appearance:\s*none;/);
  assert.match(checkboxRule, /width:\s*18px;/);
  assert.match(checkboxRule, /height:\s*18px;/);
  assert.match(checkboxRule, /min-height:\s*18px;/);
  assert.match(checkboxRule, /border:\s*var\(--ui-stroke-width-strong\) solid var\(--ui-control-border\);/);
  assert.match(checkboxRule, /background-color:\s*var\(--ui-control-bg\);/);
  assert.match(checkedRule, /background-color:\s*var\(--rb-orange\);/);
  assert.match(checkedRule, /background-image:\s*url\(/);
  assert.match(focusRule, /outline:\s*2px solid/);
  assert.doesNotMatch(globalWorkflowStyles, /(?:^|\n)\s*input\[type="checkbox"\]\s*\{/);
  assert.doesNotMatch(allStyleSources, /input\[type="checkbox"\][^{]*\{[^}]*accent-color:/);
  assert.doesNotMatch(globalWorkflowStyles, /\.settings-nearby-confirm input\s*\{/);
});

test("설정 메인은 운영·테스트 카드를 숨기고 표시 설정을 한 카드에 모은다", () => {
  assert.equal(countClassToken(pageSources.settings, "settings-preference-card"), 1);
  assert.match(pageSources.settings, /<h2>표시 설정<\/h2>/);
  assert.match(
    pageSources.settings,
    /checked=\{homeGuideCardDraft\}[\s\S]*?setHomeGuideCardDraft\(event\.target\.checked\)/,
  );
  assert.match(pageSources.settings, /homeGuideCardDirty[\s\S]*saveHomeGuideCardVisibility[\s\S]*saveGeneralSettings/);
  assert.doesNotMatch(pageSources.settings, /선택 즉시 저장됩니다/);
  assert.match(pageSources.settings, /홈 안내 카드[\s\S]*프로필 표시[\s\S]*saveGeneralSettings/);
  assert.match(pageSources.settings, /<aside className="page-stack settings-side-column">[\s\S]*플레이어 숨김[\s\S]*remoteSearchType="player"/);
  assert.match(pageSources.settings, /플레이어 숨김[\s\S]*releaseBlock/);
  assert.doesNotMatch(pageSources.settings, /샘플 데이터 복원|데모 데이터 초기화/);
  assert.doesNotMatch(pageSources.settings, /<h2>(?:온라인 저장|테스트 리그 현황|테스트 계정 로그인)<\/h2>/);
  assert.match(
    globalWorkflowStyles,
    /\.settings-page \.settings-toggle-grid input\[type="checkbox"\]\s*\{[^}]*width:\s*18px;[^}]*min-height:\s*18px;/,
  );
  assert.match(
    globalSurfaceStyles,
    /\.settings-page fieldset\.settings-fieldset-card\s*\{[^}]*margin:\s*0;[^}]*border-width:\s*var\(--ui-stroke-width\);[^}]*border-color:\s*var\(--ui-fieldset-border\);[^}]*border-radius:\s*var\(--ui-fieldset-radius\);[^}]*background:\s*transparent;/,
  );
  assert.doesNotMatch(
    globalSurfaceStyles,
    /\.settings-page fieldset\.settings-fieldset-card > legend\.section-title-row:first-child\s*\{[^}]*(?:position:\s*absolute|transform:|margin-bottom:\s*-)/,
  );
  assert.match(
    globalSurfaceStyles,
    /\.settings-page fieldset\.settings-fieldset-card > legend\.section-title-row:first-child\s*\{[^}]*display:\s*block;/,
  );
  assert.match(
    primitiveStyles,
    /\.section-card\.ui-design-category-surface:not\(\.match-receipt-card\):not\(\.settings-fieldset-card\)/,
  );
  assert.match(
    editorialApplicationStyles,
    /\.ui-design-category-surface\.ui-design-surface:not\(\.settings-fieldset-card\)/,
  );
  assert.match(
    editorialApplicationStyles,
    /\.ui-design-surface:not\(\.settings-fieldset-card\)/,
  );
  assert.match(
    editorialApplicationStyles,
    /\.ui-design-info-surface:not\(\.settings-fieldset-card\)/,
  );
  assert.equal(
    count(pageSources.settings, 'as="fieldset" className="section-card settings-fieldset-card'),
    10,
  );
  assert.match(
    pageSources.settings,
    /as="fieldset"[\s\S]{0,120}className="section-card settings-fieldset-card settings-report-card"/,
  );
  assert.match(
    externalNotificationSettingsCardSource,
    /as="fieldset" className="section-card settings-fieldset-card[^"]*"[\s\S]*?<legend className="section-title-row">/,
  );
  const settingsLegendSources = [pageSources.settings, externalNotificationSettingsCardSource];
  const settingsLegends = settingsLegendSources.flatMap((source) =>
    [...source.matchAll(/<legend className="section-title-row">([\s\S]*?)<\/legend>/g)].map((match) => match[1]),
  );
  assert.equal(settingsLegends.length, 12);
  settingsLegends.forEach((legend) => {
    assert.match(legend, /^\s*<div>\s*<h2(?:\s[^>]*)?>[\s\S]*?<\/h2>\s*<p className="eyebrow">[\s\S]*?<\/p>\s*<\/div>\s*$/);
    assert.doesNotMatch(legend, /<Badge|<button|<a\s|<(?:BellRing|ShieldCheck|Star|ArrowRightLeft|MessageCircle)\b/);
  });
  assert.match(
    globalSurfaceStyles,
    /\.settings-page \.settings-toggle-grid label \+ label\s*\{[^}]*padding-left:\s*0;[^}]*border-top:\s*0;/,
  );
});

test("방 생성과 경기 입력 workflow는 실제 fieldset 흐름을 사용한다", () => {
  const workflowSources = [
    createMatchIntentSectionSource,
    read("src/components/match/CreateMatchDetailsSection.jsx"),
    createMatchCourtRosterSectionSource,
    read("src/components/match/MatchCreationStepPanels.jsx"),
    read("src/components/match/CreateMatchPolicyReviewSection.jsx"),
    read("src/pages/MatchRoomView.jsx"),
  ].join("\n");

  assert.equal(count(workflowSources, 'as="fieldset"'), 8);
  assert.equal(countClassToken(workflowSources, "workflow-fieldset"), 8);
  assert.match(
    primitiveStyles,
    /fieldset\.workflow-fieldset\s*\{[^}]*display:\s*grid;[^}]*margin:\s*0;[^}]*border:\s*var\(--ui-stroke-width\) solid var\(--ui-fieldset-border\);[^}]*border-radius:\s*var\(--ui-fieldset-radius\);[^}]*background:\s*transparent;/,
  );
  assert.doesNotMatch(
    primitiveStyles,
    /fieldset\.workflow-fieldset > legend\.section-title-row:first-child\s*\{[^}]*(?:position:\s*absolute|transform:|margin-bottom:\s*-)/,
  );
  assert.match(
    primitiveStyles,
    /fieldset\.workflow-fieldset > legend\.section-title-row:first-child\s*\{[^}]*display:\s*block;/,
  );
  const workflowLegends = [
    ...workflowSources.matchAll(/<legend className="section-title-row">([\s\S]*?)<\/legend>/g),
  ].map((match) => match[1]);

  assert.equal(workflowLegends.length, 8);
  workflowLegends.forEach((legend) => {
    assert.match(legend, /^\s*<div>\s*<h2(?:\s[^>]*)?>[\s\S]*?<\/h2>\s*<p className="eyebrow">[\s\S]*?<\/p>\s*<\/div>\s*$/);
    assert.doesNotMatch(legend, /<Badge|<button|<a\s/);
  });
  assert.match(
    tokenStyles,
    /--ui-fieldset-border:\s*var\(--rb-line\);[\s\S]*?--ui-fieldset-radius:\s*var\(--radius-md\);[\s\S]*?--ui-fieldset-legend-title-color:\s*var\(--rb-orange\);[\s\S]*?--ui-fieldset-legend-support-color:\s*var\(--rb-text\);/,
  );
  assert.match(
    primitiveStyles,
    /:is\(\s*fieldset\.settings-fieldset-card,\s*fieldset\.workflow-fieldset\s*\) > legend\.section-title-row:first-child > :first-child\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*baseline;[^}]*overflow:\s*hidden;[^}]*white-space:\s*nowrap;/,
  );
  assert.match(
    primitiveStyles,
    /:is\(\s*fieldset\.settings-fieldset-card,\s*fieldset\.workflow-fieldset\s*\) > legend\.section-title-row:first-child h2\s*\{[^}]*flex:\s*0 0 auto;[^}]*color:\s*var\(--ui-fieldset-legend-title-color\);[^}]*overflow:\s*visible;[^}]*text-overflow:\s*clip;[^}]*white-space:\s*nowrap;/,
  );
  assert.match(
    primitiveStyles,
    /:is\(\s*fieldset\.settings-fieldset-card,\s*fieldset\.workflow-fieldset\s*\) > legend\.section-title-row:first-child \.eyebrow\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-inline-size:\s*0;[^}]*overflow:\s*hidden;[^}]*color:\s*var\(--ui-fieldset-legend-support-color\);[^}]*text-overflow:\s*clip;[^}]*white-space:\s*nowrap;/,
  );
});

test("고정 설명은 제목·상태·조작 문구를 반복하지 않는다", () => {
  assert.match(pageSources.settings, /현장에서 직접 촬영하면 자동승인 가능성이 높아집니다/);
  assert.match(pageSources.settings, /!canOpenCourtRequestForm \? \([\s\S]*tier-range-note tier-range-note-warning/);
  assert.doesNotMatch(pageSources.settings, /신청 상태|시설명과 구장 속성을 확인합니다|핀 주소의 시군구와 시설명을 합쳐|시군구·시설\/장소명·코트 구분으로 자동 생성|<span>구장 속성<\/span>/);
  assert.doesNotMatch(pageSources.settings, /홈의 ‘처음 사용하시나요\?’ 카드만 숨깁니다|다른 사용자에게 보여줄 프로필 정보를 선택합니다/);
  assert.doesNotMatch(homePageSource, /QR 출석부터 경기·기록·팀·구장·대회·용어·설정까지 확인하세요|초대, 승인, 기록 입력 같은 작업이 여기에 표시됩니다|경기 안내와 방 변경 알림이 여기에 표시됩니다/);
  assert.doesNotMatch(courtDetailSource, /확인되지 않은 정보는 추정하지 않고/);
  assert.doesNotMatch(allStyleSources, /\.court-profile-information-note|\.home-guide-card__copy span/);
});

test("같은 정책 행은 명시형 선택 필드와 중앙 control 정렬을 사용한다", () => {
  assert.match(matchOperationsFieldsSource, /조끼 준비/);
  assert.match(matchOperationsFieldsSource, /VESTS_PROVIDED_OPTIONS\.map/);
  assert.match(matchOperationsFieldsSource, /vestsProvided:\s*option\.value/);
  assert.doesNotMatch(matchOperationsFieldsSource, /type="checkbox"/);

  assert.match(ruleSelectorSource, /2점 차 승리[\s\S]*?MATCH_WIN_BY_TWO_OPTIONS\.map/);
  assert.match(ruleSelectorSource, /winByTwo:\s*option\.value/);
  assert.doesNotMatch(ruleSelectorSource, /type="checkbox" checked=\{rules\.winByTwo\}/);

  assert.match(pageSources.recruiting, /참가 상태[\s\S]*?value=\{joinDraft\.reserve \? "reserve" : "starter"\}/);
  assert.match(pageSources.recruiting, /const reserve = event\.target\.value === "reserve"/);
  assert.doesNotMatch(pageSources.recruiting, /arena-check-row/);

  assert.match(courtControlStyles, /\.match-operations-policy-fields \.form-grid\.two\s*\{[^}]*align-items:\s*center;/);
  assert.match(recruitingStyles, /\.arena-participation-fields\s*\{[^}]*align-items:\s*center;/);
  assert.match(matchesStyles, /\.tournament-inline-schedule\s*\{[^}]*align-items:\s*center;/);
  assert.match(matchesStyles, /\.tournament-schedule-list form\s*\{[^}]*align-items:\s*center;/);

  assert.match(
    visualSystemStyles,
    /input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\):not\(\[type="color"\]\):focus,\s*select:focus,\s*textarea:focus\s*\{[^}]*border-color:\s*var\(--rb-orange\);[^}]*box-shadow:\s*var\(--focus-ring\);/,
  );
  assert.doesNotMatch(
    visualSystemStyles,
    /input:focus,\s*select:focus,\s*textarea:focus\s*\{[^}]*var\(--green\)/,
  );
});

test("생성 control은 공용 폭과 높이를 사용한다", () => {
  assert.match(tokenStyles, /--ui-segmented-field-height:\s*calc\(/);
  assert.match(
    courtControlStyles,
    /\.create-match-info-grid\.is-standard-room input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\):not\(\[type="color"\]\)\s*\{[^}]*min-height:\s*var\(--ui-button-height\);/,
  );
  assert.match(
    courtControlStyles,
    /\.create-match-info-grid\.is-standard-room select,\s*\.match-roster-policy-fields > label > select\s*\{[^}]*min-height:\s*var\(--ui-button-height\);/,
  );
  assert.match(
    courtControlStyles,
    /@media \(max-width:\s*1100px\)[\s\S]*?\.create-match-info-grid\.is-standard-room > :is\(\.create-capacity-field, \.create-timing-field\)\s*\{[^}]*grid-row:\s*2;/,
  );
  assert.match(
    courtControlStyles,
    /@media \(min-width:\s*900px\)[\s\S]*?\.create-match-page \.create-mode-grid:has\(> button:nth-child\(2\):last-child\)\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/,
  );
  assert.match(
    matchCreationWizardSource,
    /className="ui-action-row match-creation-wizard-secondary-actions"/,
  );
  assert.match(
    courtControlStyles,
    /\.match-creation-wizard-primary-actions\s*\{[^}]*margin-left:\s*auto;/,
  );
  assert.match(
    matchCreationWizardSource,
    /match-creation-wizard-secondary-actions[\s\S]*취소하기[\s\S]*이전[\s\S]*match-creation-wizard-primary-actions[\s\S]*다음[\s\S]*<Button type="button" disabled=\{submitDisabled\} onClick=\{onSubmit\}/,
  );
});

test("생성 footer와 공용 방 모달은 버튼 행 정렬을 공유한다", () => {
  const roomPrimary = read("src/components/recruiting/RecruitingRoomPrimarySection.jsx");
  const roomActions = read("src/components/recruiting/RecruitingRoomActionSection.jsx");
  const roomStyles = read("src/styles/features/recruiting-source-actions.css");
  const roomToolbarStyles = read("src/styles/features/recruiting-party-lobby.css");
  const createResponsive = read("src/styles/features/match-create-responsive.css");
  assert.match(primitiveStyles, /\.ui-action-row-end\s*\{\s*justify-content: flex-end;/);
  assert.match(primitiveStyles, /\.ui-action-row-end:empty\s*\{\s*display: none;/);
  assert.match(matchCreationWizardSource, /className="ui-action-row match-creation-wizard-actions"/);
  assert.match(matchCreationWizardSource, /className="ui-action-row ui-action-row-end match-creation-wizard-primary-actions"/);
  assert.match(matchCreationWizardSource, /create-submit-warning[\s\S]*match-creation-wizard-secondary-actions/);
  assert.doesNotMatch(createResponsive, /\.match-creation-wizard-(?:actions|secondary-actions|primary-actions)/);
  assert.match(roomPrimary, /className="ui-action-row ui-action-row-end arena-room-share-actions"/);
  assert.match(roomStyles, /\.arena-join-panel\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\);/);
  assert.doesNotMatch(roomToolbarStyles, /\.arena-lobby-topline > div:last-child|--ui-button-height-sm:/);
  assert.match(roomActions, /ui-action-row ui-action-row-end">\s*\{!sourceRoomReadOnly && canFinalizeSourceMatch/);
  assert.match(roomActions, /ui-action-row ui-action-row-end">\s*\{!sourceRoomReadOnly && !matchRoom && !recruitingRoomConfirmed && mine/);
  assert.match(roomActions, /ui-action-row ui-action-row-end">\s*<Button type="submit" disabled=\{!canJoin \|\| joiningThisRoom\}/);
});

test("매칭과 기록 생성 선택 영역은 같은 제목과 버튼 타이포그래피를 사용한다", () => {
  assert.match(matchCreationWizardSource, /className=\{purposeValue === option\.id \? "ui-choice-tile active" : "ui-choice-tile"\}/);
  assert.match(matchCreationWizardSource, /className=\{active \? "ui-choice-tile active" : "ui-choice-tile"\}/);
  assert.match(
    courtControlStyles,
    /\.create-match-page \.create-choice-heading\s*\{[^}]*font-size:\s*var\(--create-choice-heading-font-size\);[^}]*font-weight:\s*900;/,
  );
  assert.match(
    courtControlStyles,
    /\.create-match-page :is\(\.create-mode-grid,\s*\.match-intent-preset-grid\) button strong\s*\{[^}]*font-size:\s*var\(--create-choice-option-title-font-size\);[^}]*line-height:\s*1\.35;/,
  );
  assert.doesNotMatch(courtControlStyles, /\.create-match-page\s*\{[^}]*--(?:button-secondary|ui-button)-bg:/);
  assert.doesNotMatch(courtControlStyles, /html\[data-theme\] \.create-match-page \.button-secondary/);
  assert.doesNotMatch(courtControlStyles, /\.match-intent-preset-grid > button(?:\.active)?\s*\{[^}]*(?:background|border(?:-color|-radius)?):/);
  assert.match(
    courtControlStyles,
    /\.create-match-page \.create-mode-grid button em,[\s\S]*?font-size:\s*var\(--create-choice-option-copy-font-size\);[\s\S]*?line-height:\s*1\.45;/,
  );
  assert.match(createMatchIntentSectionSource, /as="fieldset" className="section-card full-span create-visibility-card workflow-fieldset"/);
  assert.match(
    matchCreateOperationsStyles,
    /@media \(min-width:\s*1101px\)[\s\S]*?\.match-intent-axis\s*\{[^}]*grid-template-columns:/,
  );
  assert.match(
    matchCreateOperationsStyles,
    /@media \(min-width:\s*1101px\)[\s\S]*?\.create-match-info-grid\.is-standard-room > :is\([\s\S]*?\.create-title-field,[\s\S]*?\.create-capacity-field[\s\S]*?\)\s*\{[^}]*grid-template-columns:\s*max-content minmax\(0, 1fr\);[^}]*align-items:\s*center;/,
  );
  assert.match(
    matchCreateOperationsStyles,
    /\.create-match-page \.ui-segmented-control\.create-choice-segments\.age-restriction-segments > button\s*\{[^}]*min-inline-size:\s*max-content;[^}]*white-space:\s*nowrap;[^}]*word-break:\s*keep-all;/,
  );
  assert.match(
    createMatchCourtRosterSectionSource,
    /create-choice-segments is-three age-restriction-segments/,
  );
  assert.match(
    createMatchIntentSectionSource,
    /create-mode-grid is-compact-control-grid has-supporting-copy/,
  );
  assert.match(
    matchCreationWizardSource,
    /match-intent-preset-grid is-compact-control-grid has-supporting-copy match-purpose-options/,
  );
  assert.match(
    matchCreateOperationsStyles,
    /\.is-compact-control-grid\.has-supporting-copy > button\s*\{[^}]*min-height:\s*calc\(var\(--ui-button-height\) \+ var\(--space-4\)\);[^}]*height:\s*auto;[^}]*padding-block:\s*var\(--space-2\);/,
  );
});

test("공용 방의 A/B 출전·후보 슬롯은 같은 간격과 반응형 정렬을 사용한다", () => {
  const responsiveReserveRowBlock = recruitingLobbyResponsiveStyles.match(
    /\.arena-lobby-modal \.arena-reserve-line > \.arena-room-reserve-row,\s*html\[data-theme="light"\] \.arena-lobby-modal \.arena-reserve-line > \.arena-room-reserve-row\s*\{([^}]*)\}/,
  )?.[1] ?? "";
  assert.match(
    recruitingStyles,
    /\.arena-record-team-selected \.team-emblem\s*\{[^}]*--team-emblem-size:\s*32px;/,
  );
  assert.match(
    recruitingStyles,
    /\.arena-record-setup-grid em\s*\{[^}]*font-style:\s*normal;[^}]*font-weight:\s*800;/,
  );
  assert.match(
    recruitingStyles,
    /\.arena-lobby-modal \.arena-room-slot-row\s*\{[^}]*grid-auto-columns:\s*minmax\(72px,\s*72px\);[^}]*grid-auto-flow:\s*column;[^}]*grid-template-columns:\s*none;[^}]*justify-content:\s*start;/,
  );
  assert.match(
    recruitingStyles,
    /\.arena-lobby-modal \.arena-lobby-team-panel\.team-b \.arena-room-slot-row\s*\{[^}]*justify-content:\s*start;[^}]*direction:\s*rtl;/,
  );
  assert.match(
    recruitingStyles,
    /\.arena-lobby-modal \.arena-reserve-panel,\s*html\[data-theme="light"\] \.arena-lobby-modal \.arena-reserve-panel\s*\{[^}]*padding:\s*12px;/,
  );
  assert.match(
    recruitingStyles,
    /\.arena-lobby-modal \.arena-reserve-line > \.arena-room-reserve-row,[\s\S]*?\{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(72px,\s*72px\)\);[^}]*column-gap:\s*var\(--room-slot-gap\);[^}]*row-gap:\s*var\(--room-slot-gap\);/,
  );
  assert.match(
    recruitingStyles,
    /\.arena-lobby-modal \.arena-reserve-line\.team-b > \.arena-room-reserve-row,[\s\S]*?\{[^}]*justify-content:\s*start;[^}]*direction:\s*rtl;/,
  );
  assert.match(
    recruitingStyles,
    /\.arena-lobby-modal \.arena-reserve-line\.team-b > \.arena-room-reserve-row \.arena-room-player-slot-wrap,[\s\S]*?\.arena-lobby-modal \.arena-reserve-line\.team-b > \.arena-room-reserve-row \.arena-room-player-slot[\s\S]*?\{[^}]*direction:\s*ltr;/,
  );
  assert.doesNotMatch(
    recruitingStyles,
    /\.arena-lobby-modal \.arena-reserve-line\.team-b > \.arena-room-reserve-row \.arena-room-party-group[\s\S]*?\{[^}]*direction:\s*ltr;/,
  );
  assert.doesNotMatch(
    recruitingStyles,
    /\.arena-lobby-modal \.arena-lobby-team-panel\.team-b \.arena-room-slot-row > \*[\s\S]*?\{[^}]*direction:\s*ltr;/,
  );
  assert.match(
    recruitingStyles,
    /\.arena-lobby-modal \.arena-reserve-line > \.arena-room-reserve-row,[\s\S]*?\{[^}]*padding:\s*18px;[^}]*margin:\s*-18px;[^}]*overflow-x:\s*auto;[^}]*overflow-y:\s*hidden;/,
  );
  assert.match(
    recruitingStyles,
    /\.arena-slot-command-popover \.arena-invite-actions\s*\{[^}]*align-items:\s*center;/,
  );
  assert.doesNotMatch(
    recruitingStyles,
    /\.arena-room-reserve-row \.arena-room-party-group::before/,
    "reserve parties must inherit the exact active-party glow",
  );
  assert.match(
    recruitingStyles,
    /@media \(max-width:\s*720px\)[\s\S]*?\.arena-lobby-modal \.arena-reserve-line > \.arena-room-reserve-row,[\s\S]*?\{[^}]*margin:\s*-18px;[^}]*padding:\s*18px;[^}]*overflow:\s*visible;/,
    "mobile reserve rows must preserve the active-party glow space",
  );
  assert.match(responsiveReserveRowBlock, /grid-template-columns:\s*repeat\(auto-fit,/);
  assert.doesNotMatch(responsiveReserveRowBlock, /overflow:\s*visible;/);
  assert.match(
    recruitingStyles,
    /@media \(max-width:\s*1100px\)[\s\S]*?\.arena-lobby-modal \.arena-reserve-panel\s*\{[^}]*display:\s*none;[\s\S]*?\.arena-lobby-modal \.arena-side-inline-reserve\s*\{[^}]*display:\s*block;/,
  );
  assert.match(
    recruitingStyles,
    /\.arena-lobby-modal \.arena-lobby-team-panel\.team-b \.arena-side-inline-reserve \.arena-room-reserve-row,[\s\S]*?\{[^}]*justify-content:\s*start;/,
  );
  assert.match(
    recruitingStyles,
    /@media \(max-width:\s*720px\)[\s\S]*?\.arena-lobby-modal \.arena-side-inline-reserve \.arena-room-reserve-row,[\s\S]*?grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(var\(--room-slot-width\),\s*var\(--room-slot-width\)\)\);/,
  );
  assert.match(
    matchRoomStyles,
    /\.gm-roster-row\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;[^}]*justify-content:\s*flex-start;[^}]*gap:\s*6px;/,
  );
  assert.match(
    matchRoomStyles,
    /\.gm-player-slot\s*\{[^}]*max-width:\s*108px;[^}]*flex:\s*1 1 56px;/,
  );
  assert.match(
    matchRoomStyles,
    /\.gm-team-panel\.team-b \.gm-roster-row,\s*\.gm-reserve-line:nth-child\(2\) \.gm-reserve-row\s*\{[^}]*justify-content:\s*flex-end;/,
  );
  assert.doesNotMatch(matchRoomStyles, /\.gm-reserve-row\s*\{[^}]*repeat\(2,/);
});

test("공용 방모달은 배경 페이지와 섞이지 않는 전용 표면을 사용한다", () => {
  assert.match(
    tokenStyles,
    /--ui-room-modal-bg:\s*color-mix\(in srgb,\s*var\(--rb-bg-2\) 92%,\s*transparent\);/,
  );
  assert.match(
    tokenStyles,
    /html\[data-theme="light"\][\s\S]*--ui-room-modal-bg:\s*var\(--card-bg-strong\);/,
  );
  assert.match(
    recruitingStyles,
    /\.arena-lobby-modal\s*\{[^}]*background:\s*var\(--ui-room-modal-bg\);/,
  );
});

test("공용 빈 상태와 일정 filter 높이는 canonical control token을 유지한다", () => {
  assert.doesNotMatch(globalWorkflowStyles, /(?:^|\n)\s*\.empty-state\s*\{/);
  assert.doesNotMatch(globalWorkflowStyles, /(?:^|\n)\s*\.ui-empty-state\s*\{/);
  assert.match(primitiveStyles, /\.ui-empty-state-compact\s*\{/);
  assert.match(recruitingStyles, /\.arena-modal-close-button\s*\{\s*min-height:\s*var\(--ui-button-height\);/);
  assert.match(
    matchesStyles,
    /@media \(max-width:\s*480px\)[\s\S]*?\.om-calendar-filter-row \.segmented-control button\s*\{[\s\S]*?min-height:\s*var\(--ui-button-height\);[\s\S]*?height:\s*var\(--ui-button-height\);/,
  );
  assert.match(
    matchesStyles,
    /\.om-calendar-filter-label\s*\{[^}]*font-size:\s*var\(--font-size-meta\);/,
  );
  const filterButtonRules = [
    ...matchesStyles.matchAll(/\.om-calendar-filter-row \.segmented-control button\s*\{([^}]*)\}/g),
  ];
  assert.ok(filterButtonRules.length >= 1);
  assert.ok(
    filterButtonRules.every(([, body]) => !/font-size:\s*(?:clamp\(|0\.62rem)/.test(body)),
  );
  assert.match(
    filterButtonRules[0][1],
    /font-size:\s*var\(--font-size-meta\);/,
  );
});

test("화면별 점수 입력 layout은 feature CSS만 소유한다", () => {
  assert.doesNotMatch(
    globalAdminStyles,
    /@media \(max-width:\s*640px\)\s*\{[^{}]*\.arena-dispute-score-row\s*\{/,
  );
  assert.doesNotMatch(
    globalAdminStyles,
    /@media \(max-width:\s*640px\)\s*\{[^{}]*\.match-room \.score-form\s*\{/,
  );
  assert.match(recruitingStyles, /\.arena-dispute-score-row \.arena-derived-score/);
  assert.match(readCssTree("src/styles/matchroom-arena.css"), /\.match-room \.match-derived-score/);
});

test("목록 카드는 Card, Button, ui-panel primitive를 사용한다", () => {
  assert.match(componentSource, /import Button from "\.\.\/common\/Button\.jsx";/);
  assert.match(componentSource, /import Card from "\.\.\/common\/Card\.jsx";/);
  assert.match(componentSource, /<Card\s+as="article"/);
  assert.match(componentSource, /<Button\s+className="match-list-card__action ui-button-card-action"/);
  assert.match(componentSource, /className="match-list-summary ui-panel ui-match-list-summary"/);
  assert.match(componentSource, /\["match-list-card", "ui-match-list-surface", className\]/);
});

test("목록 정보면, 결과색, 카드 action은 공용 토큰과 primitive를 사용한다", () => {
  assert.match(tokenStyles, /--ui-information-surface-bg:\s*var\(--ui-data-cell-bg\);/);
  assert.match(tokenStyles, /--ui-result-win-bg:\s*color-mix\(/);
  assert.match(tokenStyles, /--ui-result-loss-bg:\s*color-mix\(/);
  assert.match(tokenStyles, /--ui-result-draw-bg:\s*color-mix\(/);
  assert.match(primitiveStyles, /\.ui-card\.ui-match-list-surface\s*\{[^}]*background:\s*var\(--ui-information-surface-bg\);/);
  assert.match(primitiveStyles, /:not\(\.ui-match-list-surface\)/);
  assert.match(primitiveStyles, /\.ui-button\.ui-button-card-action\s*\{[^}]*min-height:\s*var\(--ui-card-action-min-height, 100%\);[^}]*align-self:\s*stretch;/);
  const fullHeightActionLayouts = matchListStyles.match(/"main action"\s*"summary action"/g) ?? [];
  assert.equal(fullHeightActionLayouts.length, 3);
  assert.doesNotMatch(matchListStyles, /\.match-list-card__action\.ui-button-card-action\s*\{/);
  assert.match(tokenStyles, /--ui-match-card-min-height:\s*88px;/);
  assert.match(matchListStyles, /\.match-list-card\s*\{[^}]*min-height:\s*var\(--ui-match-card-min-height\);/);
  assert.match(matchListStyles, /\.match-list-summary\s*\{[^}]*min-height:\s*var\(--ui-match-summary-min-height\);/);
});

test("목록 카드 feature CSS는 primitive 표면을 다시 정의하지 않는다", () => {
  const surfaceProperties = /(?:^|\n)\s*(?:background(?:-color)?|border(?:-color|-radius)?|box-shadow|padding)\s*:/m;
  const buttonProperties = /(?:^|\n)\s*(?:background(?:-color)?|border(?:-color|-radius)?|box-shadow|color|min-height|padding)\s*:/m;

  assert.doesNotMatch(getRuleBody(matchListStyles, ".match-list-card"), surfaceProperties);
  assert.doesNotMatch(getRuleBody(matchListStyles, ".match-list-summary"), surfaceProperties);
  assert.doesNotMatch(getRuleBody(matchListStyles, ".match-list-card__action"), buttonProperties);
  assert.match(matchListStyles, /--ui-card-padding:/);
  assert.match(matchListStyles, /--ui-panel-padding:/);
});

test("경기 목록 상태선과 팀명 줄바꿈은 공용 규칙을 사용한다", () => {
  assert.match(
    matchListStyles,
    /\.match-list-card::before\s*\{[^}]*inset:\s*var\(--ui-status-rail-inset\) auto var\(--ui-status-rail-inset\) 0;[^}]*width:\s*var\(--ui-status-rail-width\);[^}]*border-radius:\s*var\(--ui-status-rail-radius\);/,
  );
  assert.match(
    matchListStyles,
    /\.match-list-summary__side\s*\{[^}]*display:\s*grid;[^}]*max-width:\s*100%;[^}]*overflow-wrap:\s*anywhere;[^}]*white-space:\s*normal;[^}]*word-break:\s*keep-all;/,
  );
  assert.match(
    matchListStyles,
    /\.match-list-summary__side > :is\(\.team-hover-trigger, a, span\)\s*\{[^}]*display:\s*block;[^}]*max-width:\s*100%;[^}]*overflow-wrap:\s*inherit;[^}]*white-space:\s*inherit;[^}]*word-break:\s*inherit;/,
  );
  assert.doesNotMatch(
    getRuleBody(matchListStyles, ".match-list-summary__side"),
    /(?:block-size|max-height|overflow:\s*hidden)/,
  );
});

test("경기 목록 제목과 요약은 데스크톱 여백과 모바일 밀도를 분리한다", () => {
  const titleBody = getRuleBody(matchListStyles, ".match-list-card__title");
  const mainBody = getRuleBody(matchListStyles, ".match-list-card__main");

  assert.match(titleBody, /min-block-size:\s*0\.98em;/);
  assert.match(titleBody, /max-block-size:\s*1\.96em;/);
  assert.match(titleBody, /font-size:\s*var\(--ui-match-list-title-size\);/);
  assert.doesNotMatch(titleBody, /(?:^|\n)\s*block-size:\s*1\.96em;/m);
  assert.match(mainBody, /padding:\s*var\(--space-5\) var\(--space-7\) var\(--space-5\) var\(--space-8\);/);
  assert.match(matchListStyles, /\.match-list-badge\s*\{[^}]*min-height:\s*var\(--ui-match-badge-min-height\);/);
  assert.match(tokenStyles, /--ui-match-badge-min-height:\s*18px;/);
  assert.match(tokenStyles, /--ui-match-summary-min-height:\s*0px;/);
  assert.match(tokenStyles, /--ui-match-summary-min-height-mobile:\s*0px;/);
  assert.match(tokenStyles, /--ui-match-list-title-size:\s*clamp\(16px, 1\.1vw, 19px\);/);
  assert.match(tokenStyles, /--ui-match-list-team-size:\s*clamp\(14px, 1\.15vw, 18px\);/);
  assert.match(tokenStyles, /--ui-match-list-score-size:\s*clamp\(20px, 1\.8vw, 28px\);/);
  assert.match(componentSource, /className="match-list-summary__support"/);
  assert.match(
    matchListStyles,
    /\.match-list-summary__support\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;[^}]*justify-content:\s*center;/,
  );
  assert.match(
    matchListStyles,
    /@container \(max-width: 760px\)[\s\S]*?\.match-list-card__main\s*\{[^}]*gap:\s*var\(--space-2\);[^}]*padding:\s*var\(--space-3\) var\(--space-4\) var\(--space-3\) var\(--space-6\);/,
  );
  assert.match(
    matchListStyles,
    /@container \(max-width: 760px\)[\s\S]*?\.match-list-summary\s*\{[^}]*--ui-panel-padding:\s*var\(--space-2\) var\(--space-4\);/,
  );
  assert.doesNotMatch(
    matchListStyles,
    /\.match-list-summary__meta,\s*\.match-list-summary__detail\s*\{[^}]*font-size:\s*10px;/,
  );
});

test("홈 검색 카드가 공용 card padding을 덮지 않는다", () => {
  assert.doesNotMatch(
    legacyStyleSources,
    /\.home-search-panel(?:\.rank-search-card)?\s*\{[^{}]*\bpadding(?:-[a-z]+)?\s*:/,
  );
});

test("프로필 호버 카드는 하나의 반투명 표면 토큰을 사용한다", () => {
  const hoverCardBody = getRuleBody(visualSystemStyles, ".hover-portal-card");
  const touchCardBody = getRuleBody(courtControlStyles, ".hover-portal-card.touch-open");
  const typeSpecificBackgrounds = [];

  for (const match of hoverSurfaceStyles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(",").map((selector) => selector.trim());
    const isCardRoot = selectors.some((selector) => (
      /(?:player|team|court|referee)-hover-card(?:\.touch-open)?$/.test(selector)
    ));
    if (isCardRoot && /\bbackground(?:-color|-image)?\s*:/.test(match[2])) {
      typeSpecificBackgrounds.push(match[1].trim());
    }
  }

  assert.match(tokenStyles, /--ui-profile-popup-bg:\s*color-mix\(/);
  assert.match(tokenStyles, /--ui-profile-popup-backdrop-filter:\s*blur\(/);
  assert.match(hoverCardBody, /background:\s*var\(--ui-profile-popup-bg\)/);
  assert.match(hoverCardBody, /backdrop-filter:\s*var\(--ui-profile-popup-backdrop-filter\)/);
  assert.doesNotMatch(touchCardBody, /\bbackground(?:-color|-image)?\s*:/);
  assert.deepEqual(typeSpecificBackgrounds, []);
});

test("폐기한 목록 카드와 CTA override 선택자는 돌아오지 않는다", () => {
  const allSources = [
    componentSource,
    matchListStyles,
    legacyStyleSources,
    ...Object.values(pageSources),
  ].join("\n");

  for (const legacyClass of [
    "arena-hero-cta",
    "home-search-create-button",
    "om-match-card",
    "om-match-create",
    "wide-button",
  ]) {
    assert.equal(allSources.includes(legacyClass), false, `${legacyClass} 사용 금지`);
  }
});

test("알파 온보딩은 기록 중심 무료 핵심 흐름을 안내한다", () => {
  assert.match(appSource, /const GettingStarted = lazy\(\(\) => import\("\.\/pages\/GettingStarted\.jsx"\)\);/);
  assert.match(appSource, /const PracticeMatch = lazy\(\(\) => import\("\.\/pages\/PracticeMatch\.jsx"\)\);/);
  assert.match(appSource, /path="\/app\/guide" element=\{<GettingStarted app=\{app\} \/>\}/);
  assert.match(appSource, /path="\/app\/guide\/practice" element=\{<PracticeMatch app=\{app\} \/>\}/);
  assert.equal(count(pageSources.home, 'to="/app/guide"'), 2);
  assert.match(pageSources.home, /처음 사용하시나요\?/);
  assert.match(pageSources.home, /13단계 안내/);
  assert.match(pageSources.home, /to="\/app\/guide\/practice"[\s\S]*연습경기 해보기/);
  assert.match(pageSources.home, /isHomeGuideCardVisible\(app\.state\.settings\)/);
  assert.match(gettingStartedSource, /useSearchParams/);
  assert.match(gettingStartedSource, /aria-label="사용 설명 목차"/);
  assert.match(gettingStartedSource, /aria-expanded=\{chapterMenuOpen\}/);
  assert.match(gettingStartedSource, /현재 단계|chapter\.navLabel/);
  assert.match(gettingStartedStyles, /\.getting-started-chapter-nav__links\s*\{\s*display: none;/);
  assert.match(gettingStartedStyles, /\.getting-started-chapter-nav\.is-open \.getting-started-chapter-nav__links\s*\{\s*display: grid;/);
  assert.match(gettingStartedSource, /aria-current=\{item\.id === chapter\.id \? "page" : undefined\}/);
  assert.match(gettingStartedSource, /chapterTitleRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(gettingStartedSource, /ref=\{chapterTitleRef\} tabIndex=\{-1\}/);
  for (const chapterId of ["start", "matching", "attendance", "live", "records", "tier", "teams", "courts", "tournaments", "profile", "settings", "terms", "practice"]) {
    assert.match(gettingStartedSource, new RegExp(`id: "${chapterId}"`));
  }
  for (const image of [
    "start-home.jpg",
    "matching-create.jpg",
    "attendance-qr.png",
    "live-clock.jpg",
    "records-create.jpg",
    "tier-profile.jpg",
    "teams.jpg",
    "courts.jpg",
    "tournaments.jpg",
    "profile.jpg",
    "settings.jpg",
    "terms.jpg",
  ]) {
    assert.match(gettingStartedSource, new RegExp(`/assets/guide/${image.replace(".", "\\.")}`));
  }
  assert.match(gettingStartedSource, /<img[\s\S]*?alt=\{chapter\.imageAlt\}[\s\S]*?loading="eager"[\s\S]*?decoding="async"/);
  assert.match(gettingStartedSource, /<figcaption>\{chapter\.caption\}<\/figcaption>/);
  assert.match(gettingStartedSource, /농구 기록 웹입니다/);
  assert.match(gettingStartedSource, /필수 웹 기능은 평생 무료/);
  assert.match(gettingStartedSource, /선수·팀 초대/);
  assert.match(gettingStartedSource, /초대 수락은 출석이 아닙니다/);
  assert.match(gettingStartedSource, /QR 출석은 경기시계를 사용하는 일반 공개 매칭과 대회 경기에서 사용/);
  assert.match(gettingStartedSource, /QR 토큰은 5분마다 바뀌며 경기 20분 전부터 로그인한 사전 등록 선수/);
  assert.match(gettingStartedSource, /출전·후보 선수가 모두 출석하면 예정시간 전에도 시작/);
  assert.match(gettingStartedSource, /QR 출석과 실제 출전은 다릅니다/);
  assert.match(gettingStartedSource, /출석판과 QR 상태는 자동으로 갱신/);
  assert.match(gettingStartedSource, /만료된 QR, 다른 경기의 QR, 서명이 잘못된 QR, 미등록 사용자 스캔은 거부/);
  assert.match(gettingStartedSource, /출전·팀 배치를 자동 확정하지 않습니다/);
  assert.doesNotMatch(gettingStartedSource, /양쪽 실제 출전 선수의 과반 승인/);
  assert.match(gettingStartedSource, /열린 이의를 처리하고 별도 최종 승인/);
  assert.match(gettingStartedSource, /경기시계/);
  assert.match(gettingStartedSource, /심판·모바일 전광판 담당자·선수가 역할을 나눕니다/);
  assert.match(gettingStartedSource, /양쪽 점수는 심판 경기에서는 배정 심판, 무심판 경기에서는 전광판 담당자가 조작/);
  assert.match(gettingStartedSource, /A\/B 점수판과 30초 샷클락이 함께 열린/);
  assert.match(gettingStartedSource, /블루투스 설정에서 워치 또는 비오디오 미디어 리모컨을 먼저 연결/);
  assert.match(gettingStartedSource, /재생 또는 일시정지를 누르면 설정한 샷클락 시간으로 초기화/);
  assert.match(gettingStartedSource, /이어폰·헤드셋은 부저 소리를 가져갈 수 있어 지원 기기로 안내하지 않습니다/);
  assert.match(gettingStartedSource, /MMR은 실력이 비슷한 상대를 찾고 순위를 계산하는 경기력 점수/);
  assert.match(gettingStartedSource, /팀 파티는 그 팀 선수들이 한 경기에 같이 신청한 임시 묶음/);
  assert.match(gettingStartedSource, /팀장은 팀 자체를 관리합니다\. 주장은 이번 경기에서 자기 편의 명단을 관리/);
  assert.match(gettingStartedSource, /모바일 전광판 담당자는 현장에서 경기시계·샷클락을 맡으며 무심판 경기에서는 양쪽 점수도 조작/);
  assert.match(gettingStartedSource, /개인전은 선수가 개인으로 참가하고, 팀전은 등록팀이 A팀·B팀을 이룹니다\. 픽업은 개인 참가자를 현장에서 두 편으로 나누는 방식/);
  assert.match(gettingStartedSource, /경기 후 함께 확인하는 기록은 끝난 경기를 참가자들이 함께 등록하는 방식/);
  assert.doesNotMatch(gettingStartedSource, /일반 live 경기|`match_record`|`personal_record`|결과 revision|교체 transaction/);
  assert.match(gettingStartedSource, /티어는 확정 기록에서 자동 계산됩니다/);
  assert.match(gettingStartedSource, /팀전은 팀장만 만드는 기능이 아닙니다/);
  assert.match(gettingStartedSource, /주변 팀, 비슷한 연령대·MMR의 라이벌 팀, 같은 소속 팀/);
  assert.match(gettingStartedSource, /구장 정보와 경기 예약은 다릅니다/);
  assert.match(gettingStartedSource, /대회는 무심판 경기로 전환하지 않습니다/);
  assert.match(gettingStartedSource, /통합·개인전·팀전·내 기록/);
  assert.match(gettingStartedSource, /지각 QR만 찍고 후보에서 실제 교체하지 않은 선수/);
  assert.match(gettingStartedSource, /기기별 베타/);
  assert.match(gettingStartedSource, /to: "\/app\/guide\/practice"/);
  assert.match(gettingStartedSource, /isHomeGuideCardVisible\(app\.state\.settings\)/);
  assert.match(gettingStartedSource, /updateSettings\(\{\s*showHomeGuideCard: !homeGuideCardVisible,/);
  assert.match(gettingStartedSource, /홈에서 사용 설명 안 보기/);
  assert.doesNotMatch(gettingStartedSource, /숨겨도 사용 설명과 연습 경기는 계속 이용할 수 있습니다/);
  assert.match(practiceMatchSource, /aria-current=\{index \+ 1 === progress\.step \? "step" : undefined\}/);
  assert.match(practiceMatchSource, /className="practice-match-banner__actions ui-action-row"/);
  assert.doesNotMatch(practiceMatchSource, /practice-room-guide ui-panel|practice-room-guide ui-modal-section/);
  assert.equal(count(practiceMatchSource, "<h1>"), 1);
  assert.equal(count(gettingStartedStyles, ".practice-match-safety {"), 1);
  assert.match(gettingStartedSource, /className="ui-action-row"/);
  assert.match(termsSource, /필수 웹 기능은 평생 무료입니다/);
  assert.match(gettingStartedStyles, /@media \(max-width: 720px\)/);
  assert.match(gettingStartedStyles, /@media \(max-width: 480px\)/);
  assert.match(gettingStartedStyles, /@media \(max-width: 720px\)[\s\S]*?\.practice-role-switch\s*\{[^}]*flex:\s*none;/);
  assert.doesNotMatch(pageSources.home, /onboardingComplete[\s\S]*home-guide-card/);
});

test("home omits Season Zero banner and preserves guide and profile icon entry", () => {
  assert.doesNotMatch(pageSources.home, /home-season-zero-card|FOUNDING PLAYER|foundingPlayer|341-founding-player-s0/);
  assert.match(pageSources.home, /isHomeGuideCardVisible\(app\.state\.settings\)/);
  assert.match(read("src/lib/assets.js"), /normalizedPath\.startsWith\("\/assets\/profile-icons\/"\)/);
  assert.match(gettingStartedStyles, /\.home-guide-card\s*\{[^}]*--ui-card-bg:\s*transparent;/s);
  assert.match(gettingStartedStyles, /\.home-guide-card::before\s*\{[^}]*var\(--ui-status-rail-width\)/s);
  assert.doesNotMatch(gettingStartedStyles, /\.home-guide-card::after/);
  assert.match(pageSources.profile, /useState\(\(\) => location\.hash === "#icons"\)/);
  assert.match(pageSources.profile, /setIconDialogOpen\(location\.hash === "#icons"\)/);
  assert.doesNotMatch(pageSources.playerDetail, /foundingPlayer|FOUNDING PLAYER/);
});

test("hero inner boards share one restrained solid surface system", () => {
  const homeDashboardResponsiveStyles = read("src/styles/responsive/home-dashboard-responsive.css");

  assert.equal(count(tokenStyles, "--hero-copy-color: var(--rb-cream);"), 1);
  assert.match(
    tokenStyles,
    /html\[data-theme="light"\]\s*\{[\s\S]*?--hero-title-color:\s*var\(--rb-text\);[\s\S]*?--hero-copy-color:\s*var\(--rb-muted\);/,
  );
  assert.equal(count(tokenStyles, "--hero-title-shadow: none;"), 2);
  assert.equal(count(tokenStyles, "--hero-copy-shadow: none;"), 2);
  assert.equal(count(tokenStyles, "--ui-image-hero-title-color:"), 2);
  assert.equal(count(tokenStyles, "--ui-image-hero-copy-color:"), 2);
  assert.equal(count(tokenStyles, "--ui-image-hero-title-shadow:"), 2);
  assert.equal(count(tokenStyles, "--ui-image-hero-copy-shadow:"), 2);
  assert.doesNotMatch(tokenStyles, /--ui-image-hero-(?:title|copy)-shadow:[\s\S]{0,100}?14px 34px/);
  assert.equal(count(tokenStyles, "--ui-liquid-glass-filter: none;"), 2);
  assert.equal(count(tokenStyles, "--ui-liquid-glass-color:"), 2);
  assert.equal(count(tokenStyles, "--ui-liquid-glass-muted-color:"), 2);
  assert.equal(count(tokenStyles, "--ui-liquid-glass-edge-width: 0px;"), 2);
  assert.equal(count(tokenStyles, "--ui-liquid-glass-refraction: none;"), 2);
  assert.equal(count(tokenStyles, "--ui-liquid-glass-shadow: none;"), 2);
  assert.equal(count(tokenStyles, "--ui-liquid-glass-edge: none;"), 2);
  assert.match(tokenStyles, /--ui-hero-status-width:\s*428px;/);
  assert.match(tokenStyles, /--ui-hero-metric-min-height:\s*72px;/);
  assert.doesNotMatch(tokenStyles, /--ui-liquid-glass-(?:caustic|edge-inset|refraction-inner)/);
  assert.match(tokenStyles, /--ui-liquid-glass-divider:\s*rgba\(255,\s*255,\s*255,\s*0\.11\);/);
  assert.match(tokenStyles, /--ui-liquid-glass-divider:\s*rgba\(35,\s*50,\s*59,\s*0\.12\);/);
  assert.match(primitiveStyles, /html\[data-theme\] \.app-main :is\(\.ui-liquid-glass,\s*\.page-header > \.ui-button\)\s*\{[^}]*border:\s*0;[^}]*background:\s*var\(--ui-liquid-glass-surface-bg,\s*var\(--ui-liquid-glass-bg\)\);[^}]*box-shadow:\s*none;[^}]*backdrop-filter:\s*none;/);
  assert.match(primitiveStyles, /html\[data-theme\] \.app-main :is\(\.ui-liquid-glass,\s*\.page-header > \.ui-button\)\s*\{[^}]*text-shadow:\s*none;/);
  assert.match(primitiveStyles, /html\[data-theme\] \.app-main \.ui-liquid-glass :where\(\*\)\s*\{[^}]*text-shadow:\s*none;/);
  assert.doesNotMatch(primitiveStyles, /html\[data-theme\] \.app-main \.ui-page-hero :where\(\*\),[\s\S]*?\.guest-landing-hero :where\(\*\)\s*\{[^}]*text-shadow:\s*none;/);
  assert.match(primitiveStyles, /html\[data-theme\] \.app-main :is\(\.ui-liquid-glass,\s*\.page-header > \.ui-button\)::before\s*\{\s*content:\s*none;/);
  assert.match(primitiveStyles, /\.app-main \.ui-liquid-glass-segments\s*\{[^}]*border:\s*0;[^}]*border-bottom:\s*var\(--ui-stroke-width\) solid var\(--rb-line\);[^}]*border-radius:\s*0;[^}]*background:\s*transparent;/);
  assert.match(primitiveStyles, /\.app-main \.ui-liquid-glass-segments > \*\s*\{[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/);
  assert.match(primitiveStyles, /\.app-main \.ui-liquid-glass-segments > \* \+ \*\s*\{[^}]*border-left:\s*0;/);
  assert.match(pageSources.home, /home-hero-board ui-liquid-glass/);
  assert.match(pageSources.teams, /team-hub-board ui-liquid-glass/);
  assert.match(pageSources.matches, /om-match-panel ui-liquid-glass[\s\S]*om-match-stats ui-liquid-glass-segments/);
  assert.match(pageSources.recruiting, /arena-hero-panel ui-liquid-glass[\s\S]*arena-hero-stats ui-liquid-glass-segments/);
  assert.match(pageSources.season, /<header className="page-header ui-page-hero ui-design-app-hero">/);
  assert.match(pageSources.season, /section-card season-overview-card/);
  assert.match(pageSources.season, /className="rank-stat-grid season-summary-grid"/);
  assert.match(pageSources.season, /className="card-grid season-board-grid"/);
  assert.doesNotMatch(pageSources.season, /season-(?:hero|rule-board|summary-item|content-grid|side-rail|metric-card)|ui-liquid-glass/);
  assert.match(pageSources.playerDetail, /className="player-tier-hero"/);
  assert.doesNotMatch(pageSources.playerDetail, /rank-tier-statement ui-liquid-glass/);
  assert.match(visualSystemStyles, /\.om-match-hero,\s*\.arena-recruit-hero[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\) minmax\(0,\s*var\(--ui-hero-status-width\)\);/);
  assert.match(visualSystemStyles, /\.om-match-panel,\s*\.arena-hero-panel[\s\S]*?width:\s*min\(100%,\s*var\(--ui-hero-status-width\)\);/);
  assert.match(visualSystemStyles, /\.om-match-actions,\s*\.arena-hero-actions[\s\S]*?height:\s*var\(--ui-button-height\);/);
  assert.match(visualSystemStyles, /\.eyebrow\s*\{[^}]*color:\s*var\(--hero-eyebrow-color\);/);
  assert.match(visualSystemStyles, /html\[data-theme\] \.app-main \.ui-page-hero\s*\{[^}]*--hero-title-color:\s*var\(--ui-image-hero-title-color\);[^}]*--hero-copy-color:\s*var\(--ui-image-hero-copy-color\);[^}]*--hero-title-shadow:\s*var\(--ui-image-hero-title-shadow\);[^}]*--hero-copy-shadow:\s*var\(--ui-image-hero-copy-shadow\);/);
  assert.doesNotMatch(visualSystemStyles, /html\[data-theme="light"\] \.app-main \.rank-home \.ui-page-hero\s*\{/);
  assert.match(visualSystemStyles, /html\[data-theme\] \.app-main \.ui-page-hero \.ui-liquid-glass :where\(\*\)\s*\{[^}]*color:\s*inherit;/);
  assert.match(visualSystemStyles, /\.ui-page-hero \.ui-liquid-glass :is\([\s\S]*?\.home-hero-stats em[\s\S]*?\)\s*\{[^}]*color:\s*var\(--ui-liquid-glass-muted-color\);/);
  assert.match(visualSystemStyles, /\.home-hero-next > strong,[\s\S]*?\.arena-hero-stats strong[\s\S]*?color:\s*var\(--hero-title-color\);/);
  assert.match(primitiveStyles, /html\[data-theme\] \.app-main \.ui-page-hero :is\(h1, h2\)\s*\{[^}]*font-size:\s*var\(--hero-title-size\);/);
  const sharedHeroHeadingBlock = primitiveStyles.match(
    /html\[data-theme\] \.app-main \.ui-page-hero :is\(h1, h2\),\s*\.guest-landing-hero h1\s*\{([^}]*)\}/,
  );
  assert.ok(sharedHeroHeadingBlock);
  assert.doesNotMatch(sharedHeroHeadingBlock[1], /font-size:/);
  assert.match(landingGuestStyles, /\.guest-landing-header\s*\{[^}]*position:\s*sticky;[^}]*height:\s*64px;/);
  assert.match(landingGuestStyles, /@media \(max-width:\s*760px\)[\s\S]*?\.guest-landing-hero\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/);
  assert.match(landingGuestStyles, /\.guest-landing-record-flow\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/);
  assert.match(landingGuestStyles, /\.guest-landing-demo-viewport\s*\{[^}]*aspect-ratio:\s*9 \/ 16;/);
  assert.match(landingGuestStyles, /\.guest-landing-demo-frame\s*\{[^}]*width:\s*min\(100%, 24rem\);/);
  assert.doesNotMatch(landingGuestStyles, /\.guest-landing-demo-(?:frame|viewport)\s*\{[^}]*(?:border|background|box-shadow):/);
  assert.doesNotMatch(landingDemoFrameSource, /guest-landing-demo-caption|guest-landing-demo-note/);
  assert.match(landingGuestStyles, /\.guest-landing-demo-poster-flow\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/);
  assert.match(landingGuestStyles, /@media \(max-width:\s*760px\)[\s\S]*?\.guest-landing-record-flow,[\s\S]*?width:\s*calc\(100% - 24px\);/);
  assert.match(landingGuestStyles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.guest-landing-demo-video\s*\{[^}]*animation:\s*none;/);
  assert.match(tokenStyles, /--ui-landing-title-size:\s*clamp\(/);
  assert.match(tokenStyles, /--ui-landing-title-size-mobile:\s*clamp\(/);
  assert.match(primitiveStyles, /html\[data-theme\] \.guest-landing-hero h1\s*\{[^}]*font-size:\s*var\(--ui-landing-title-size\);/);
  assert.match(primitiveStyles, /@media \(max-width:\s*760px\)[\s\S]*?html\[data-theme\] \.guest-landing-hero h1\s*\{[^}]*font-size:\s*var\(--ui-landing-title-size-mobile\);/);
  assert.doesNotMatch(landingGuestStyles, /\.guest-landing-mobile-cta|position:\s*fixed;/);
  assert.equal(count(primitiveStyles, "-webkit-mask-composite: xor;"), 0);
  assert.equal(count(primitiveStyles, "mask-composite: exclude;"), 0);
  assert.match(
    primitiveStyles,
    /html\[data-theme\] \.app-main \.ui-page-hero:not\(\.rank-summary-grid\)\s*\{[^}]*background:\s*var\(--ui-page-hero-image,[^}]*box-shadow:\s*none;[^}]*backdrop-filter:\s*none;/,
  );
  assert.match(
    primitiveStyles,
    /\.ui-page-hero:not\(\.rank-summary-grid\)::before,[\s\S]*?\.auth-shell\)::after\s*\{[^}]*content:\s*none;[^}]*display:\s*none;/,
  );
  assert.match(
    homeDashboardResponsiveStyles,
    /\.rank-home \.rank-summary-grid,[\s\S]*?background:\s*var\(--bg-home-court\)/,
  );
  assert.doesNotMatch(homeDashboardResponsiveStyles, /var\(--ui-schedule-hero-mask\)/);
});

test("page heroes keep shared eyebrows without implementation copy", () => {
  const heroSources = [
    ...Object.values(pageSources),
    matchRoomPageSource,
    courtDetailSource,
    entityProfileHeroSource,
    gettingStartedSource,
    practiceMatchSource,
    read("src/pages/AdminPageView.jsx"),
    read("src/pages/Recorder.jsx"),
    read("src/pages/RefereeRulebook.jsx"),
    read("src/pages/TournamentDetailView.jsx"),
  ].join("\n");

  assert.doesNotMatch(heroSources, /kicker/);
  assert.doesNotMatch(allStyleSources, /kicker/);
  assert.match(heroSources, /className="eyebrow">MATCH QUEUE</);
  assert.match(heroSources, /className="eyebrow">Team Hub</);
  assert.match(heroSources, /className="eyebrow">Study guide</);
  assert.doesNotMatch(heroSources, /공용 방 모달|저장 통로|같은 값|현재 알파 테스트|서버 원본|내부 보정값|실제 공용 방 모달|현재 서비스 화면/);

  const standardizedHeroSources = [
    pageSources.home,
    pageSources.profile,
    pageSources.profileRecords,
    pageSources.matches,
    pageSources.recruiting,
    pageSources.season,
    pageSources.teams,
    pageSources.rankings,
    pageSources.settings,
    matchRoomPageSource,
    courtDetailSource,
    entityProfileHeroSource,
    read("src/components/match/CreateMatchLayout.jsx"),
    read("src/pages/AdminPageView.jsx"),
    read("src/pages/Affiliations.jsx"),
    read("src/pages/Notifications.jsx"),
    read("src/pages/ProfileAchievements.jsx"),
    read("src/pages/Recorder.jsx"),
    read("src/pages/RefereeRulebook.jsx"),
    read("src/pages/Signup.jsx"),
    read("src/pages/TournamentDetailView.jsx"),
  ];
  standardizedHeroSources.forEach((source) => {
    assert.match(source, /ui-page-hero/);
    assert.match(source, /ui-page-hero__copy/);
  });
  assert.match(visualSystemStyles, /\.ui-page-hero__copy h1\s*\{[^}]*text-shadow:\s*var\(--hero-title-shadow\);[^}]*font-family:\s*var\(--hero-title-font\);/);
  assert.match(visualSystemStyles, /\.ui-page-hero__copy p:not\(\.eyebrow\)\s*\{[^}]*color:\s*var\(--hero-copy-color\);[^}]*text-shadow:\s*var\(--hero-copy-shadow\);/);
  assert.match(visualSystemStyles, /\.ui-page-hero__copy \.eyebrow\s*\{[^}]*text-shadow:\s*var\(--hero-copy-shadow\);/);
  assert.doesNotMatch(visualSystemStyles, /html\[data-theme="light"\] \.ui-page-hero,[\s\S]*?html\[data-theme="light"\] \.ui-page-hero :where\(\*\)\s*\{[^}]*text-shadow:\s*none;/);
  assert.match(visualSystemStyles, /\.rank-home \.rank-summary-grid \.home-rank-board-head p:not\(\.eyebrow\),[\s\S]*?\{[^}]*text-shadow:\s*var\(--hero-copy-shadow\);/);
  assert.doesNotMatch(
    readCssTree("src/styles/responsive/global-home-responsive.css"),
    /\.home-rank-board-head h1,[\s\S]{0,700}?\.home-rank-board-head \.eyebrow\s*\{[^}]*color:\s*var\(--rb-orange\);/,
  );
  assert.doesNotMatch(
    [matchesStyles, recruitingStyles, matchRoomStyles].join("\n"),
    /\.(?:om-match-copy|arena-hero-copy|tournament-hero|gm-room-title)[^{]*\{[^}]*var\(--hero-title-/,
  );

  const allComponentSources = sourceFiles.map((file) => read(file)).join("\n");
  assert.doesNotMatch(
    allComponentSources,
    /className="(?:om-list-head|arena-queue-controls-head|getting-started-section__head|referee-rulebook-head|settings-nearby-courts-head|league-panel-head|court-db-review-section-head|ui-design-section-heading)/,
  );
});

test("shared primitives own application-wide density, surfaces, and modals", () => {
  assert.doesNotMatch(read("src/styles/ui-primitives.css"), /app-consistency\.css/);
  assert.equal(fs.existsSync("src/styles/primitives/app-consistency.css"), false);
  assert.match(
    primitiveStyles,
    /\.section-card\.ui-design-category-surface:not\(\.match-receipt-card\):not\(\.settings-fieldset-card\):not\(\.workflow-fieldset\)\s*\{[^}]*border-width:\s*var\(--ui-stroke-width\) 0 0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/,
  );
  assert.match(
    primitiveStyles,
    /\.ui-folder-tabs\s*\{[^}]*width:\s*100%;/,
  );
  assert.match(
    primitiveStyles,
    /\.ui-segmented-control:not\(\.create-choice-segments\):not\(\[role="radiogroup"\]\):not\(\.ui-filter-row\)\s*\{[^}]*width:\s*100%;/,
  );
  assert.match(
    primitiveStyles,
    /\.app-main \.page-header\s*\{[^}]*min-height:\s*var\(--ui-page-hero-min-height\);[^}]*box-shadow:\s*var\(--ui-page-hero-shadow\);/,
  );
  assert.match(tokenStyles, /--ui-information-row-min-height:\s*44px;/);
  assert.match(tokenStyles, /--font-size-title-xl:\s*clamp\(1\.9rem, 3\.4vw, 2\.4rem\);/);
  assert.match(tokenStyles, /--ui-content-title-size:\s*clamp\(1\.45rem, 2\.2vw, 1\.8rem\);/);
  assert.match(tokenStyles, /--hero-title-size:\s*clamp\(1\.55rem, 2\.2vw, 1\.95rem\);/);
  assert.match(
    primitiveStyles,
    /\.ui-content-title\.ui-content-title\s*\{[^}]*font-size:\s*var\(--ui-content-title-size\);/,
  );
  for (const file of [
    "src/pages/GettingStarted.jsx",
    "src/components/legal/LegalDocumentPage.jsx",
    "src/pages/DataSources.jsx",
    "src/pages/Login.jsx",
    "src/pages/RefereeRulebook.jsx",
  ]) {
    assert.match(read(file), /className="ui-content-title"/);
  }
  assert.match(primitiveStyles, /:not\(\.match-receipt-card \*\)/);
  assert.match(modalShellSource, /className=\{\["ui-modal-shell", className\]/);
  assert.match(
    primitiveStyles,
    /\.ui-modal-shell\.ui-modal-shell\s*\{[^}]*background:\s*var\(--ui-modal-bg\);[^}]*border-radius:\s*var\(--ui-modal-radius\);[^}]*box-shadow:\s*var\(--ui-modal-shadow\);/,
  );
  assert.match(
    primitiveStyles,
    /\.ui-modal-shell\.ui-room-modal\s*\{[^}]*background:\s*var\(--ui-room-modal-bg\);[^}]*border-radius:\s*var\(--ui-room-modal-radius\);/,
  );
  for (const file of [
    "src/pages/AdminPageParts.jsx",
    "src/pages/CommunityPostDialog.jsx",
    "src/pages/MatchesPagePanels.jsx",
    "src/components/court/CourtDetailModal.jsx",
    "src/components/recruiting/RecruitingRoomLayout.jsx",
  ]) {
    assert.match(read(file), /<ModalShell\b/);
  }
});

test("팀 허브 대표팀 보드는 팀 전용 너비와 테마 대응 고대비 팀명을 사용한다", () => {
  assert.match(
    read("src/styles/tokens.css"),
    /--rb-yellow:\s*#ffd36c;/,
  );
  assert.match(visualSystemStyles, /\.ui-page-hero \.ui-liquid-glass :where\(\*\)\s*\{[^}]*color:\s*inherit;/);
  assert.match(visualSystemStyles, /\.ui-page-hero \.team-hub-board \.team-hub-board-identity em\s*\{[^}]*color:\s*var\(--rb-yellow\);/);
  assert.match(
    readCssTree("src/styles/global-surfaces.css"),
    /\.team-hub-board\s*\{[^}]*width:\s*min\(100%,\s*720px\);[^}]*max-width:\s*none;/,
  );
  assert.doesNotMatch(pageSources.teams, /team-hub-board-emblem/);
  assert.doesNotMatch(readCssTree("src/styles/global-surfaces.css"), /\.team-hub-board-emblem/);
  assert.match(
    readCssTree("src/styles/global-surfaces.css"),
    /\.team-hub-board\s*\{[^}]*gap:\s*var\(--space-8\);[^}]*padding:\s*clamp\(24px,\s*3vw,\s*32px\);/,
  );
  assert.doesNotMatch(
    visualSystemStyles,
    /\.team-hub-board strong[^}]*background(?:-image)?:\s*(?:linear|radial)-gradient/,
  );
});

test("home information rows use transparent surfaces and subtle separators", () => {
  assert.match(homeRailStyles, /\.home-action-list > \.home-action-row/);
  assert.match(homeRailStyles, /\.rank-leaderboard-card \.rank-list > \.rank-row/);
  assert.match(homeRailStyles, /background:\s*transparent/);
  assert.match(homeRailStyles, /border-block-end:\s*var\(--ui-stroke-width\) solid var\(--rb-line\);/);
  assert.match(homeRailStyles, /::before\s*\{\s*content:\s*none;/);
  assert.match(homeRailStyles, /\.home-action-icon\s*\{[^}]*background:\s*transparent/s);
});

test("게스트 팀 hero는 개인 상태를 추정하지 않고 공개 방은 명단만 표시한다", () => {
  const matchModelSource = read("src/components/recruiting/RecruitingRoomMatchModel.jsx");
  const primarySectionSource = read("src/components/recruiting/RecruitingRoomPrimarySection.jsx");
  const managementSectionSource = read("src/components/recruiting/RecruitingRoomManagementSection.jsx");
  const rosterPanelsSource = read("src/components/recruiting/RecruitingRoomRosterPanels.jsx");

  assert.match(teamsSource, /const heroTeam = readOnly \? rankingTeams\[0\] : representativeTeam;/);
  assert.match(teamsSource, /<span>\{readOnly \? "1위 팀" : "대표팀"\}<\/span>/);
  assert.match(matchModelSource, /const publicPreview = Boolean\(readOnly && app\.demoPreview\);/);
  assert.match(primarySectionSource, /participantPool: renderPickupParticipantPool/);
  assert.match(primarySectionSource, /\{roomPhaseViewModel\.showVersusStage \? <div className="arena-lobby-versus-stage">/);
  assert.doesNotMatch(primarySectionSource, /참가 현황은 로그인 후 확인할 수 있습니다/);
  assert.match(managementSectionSource, /publicPreview=\{publicPreview\}/);
  assert.match(managementSectionSource, /onVisibleChange=\{publicPreview \? null : handleChatVisibleChange\}/);
  assert.match(rosterPanelsSource, /publicPreview \? "로그인 필요"/);
  assert.match(rosterPanelsSource, /채팅은 로그인 후 확인할 수 있습니다/);
});

test("team heroes keep one tier emblem and use the shared liquid-glass primitive", () => {
  assert.doesNotMatch(
    teamDetailSource,
    /<TeamEmblem team=\{team\} size="lg" className="hero-emblem" \/>/,
  );
  assert.match(teamDetailSource, /<TierEmblem mmr=\{team\.mmr\} size="hero" showLabel \/>/);
  assert.equal(count(teamDetailSource, "<TierBadge mmr={team.mmr}"), 0);
  assert.match(
    teamDetailSource,
    /favorite-toggle-button ui-liquid-glass/,
  );
  assert.match(entityProfileHeroSource, /className="entity-profile-hero-action"/);
  assert.match(teamDetailSource, /aria-label=\{favoritePending \? "즐겨찾기 저장 중" : isFavoriteTeam \? "즐겨찾기 해제" : "즐겨찾기 추가"\}/);
  assert.match(globalAdminStyles, /\.entity-profile-hero-action\s*\{[^}]*position:\s*absolute;[^}]*top:\s*var\(--space-8\);[^}]*right:\s*var\(--space-8\);/);
  assert.match(readCssTree("src/styles/global-court-controls.css"), /\.entity-profile-hero-action \.favorite-toggle-button\s*\{[^}]*width:\s*var\(--ui-icon-button-size\);[^}]*font-size:\s*0;/);
  assert.equal(count(teamDetailSource, 'className="ui-liquid-glass"'), 2);
  assert.doesNotMatch(
    visualSystemStyles,
    /\.rank-team-hero \.favorite-toggle-button|\.team-detail-hero \.badge-row \.ui-badge/,
  );
});

test("mobile detail heroes center tier emblems and placement copy is not repeated", () => {
  assert.match(
    globalAdminStyles,
    /@media \(max-width:\s*720px\)\s*\{[\s\S]*?\.entity-profile-hero-visual\s*\{[^}]*width:\s*100%;[^}]*justify-content:\s*center;/,
  );
  assert.match(
    globalAdminStyles,
    /\.rank-profile-page \.player-tier-hero,\s*\.rank-team-page \.team-tier-hero\s*\{[^}]*margin-inline:\s*auto;/,
  );
  assert.match(pageSources.playerDetail, /<TierEmblem mmr=\{player\.ratings\.integrated\} ratings=\{player\.ratings\} size="hero" showLabel \/>/);
  assert.doesNotMatch(pageSources.playerDetail, /rank-tier-statement|tier-score-line/);
  assert.doesNotMatch(
    pageSources.playerDetail,
    /placementLabel\.replace\("배정 전 · ", ""\)/,
  );
});

test("팀 메뉴는 추천 팀만 기본 노출하고 반복 설명을 만들지 않는다", () => {
  const ratingCardSource = read("src/components/rating/RatingCard.jsx");

  assert.match(pageSources.teams, /const TEAM_DISCOVERY_VIEW = "추천";/);
  assert.match(pageSources.teams, /getTeamDiscoveryGroups\(\{/);
  assert.match(pageSources.teams, /includeTeamMemberProfiles:\s*true/);
  assert.match(pageSources.teams, /title:\s*"라이벌 팀"/);
  assert.match(pageSources.teams, /title:\s*"같은 소속 팀"/);
  assert.doesNotMatch(pageSources.teams, /랭킹 기준|team-ranking-note/);
  assert.doesNotMatch(ratingCardSource, /getTierQuote|tier-quote|subtitle/);
  assert.match(pageSources.teams, /inferRegionSelection,\s*REGION_TREE/);
  assert.match(pageSources.teams, /aria-label="팀 지역 시도"/);
  assert.match(pageSources.teams, /aria-label="팀 지역 시군구"/);
  assert.doesNotMatch(pageSources.teams, /\bREGIONS\b/);
});

test("지역 랭크보드는 지역 선수와 팀만 표시하고 소속은 별도 탭에 둔다", () => {
  assert.match(pageSources.rankings, /\{ id: "affiliations", label: "소속" \}/);
  assert.match(pageSources.rankings, /<RankingTable rows=\{regionalTeams\} type="teams"/);
  assert.doesNotMatch(pageSources.rankings, /regionalAffiliations|주변 소속/);
});

test("tier emblem halo stays inside the shared emblem paint box", () => {
  const foundationStyles = readCssTree("src/styles/global-foundation.css");

  assert.match(foundationStyles, /\.tier-emblem::before\s*\{[\s\S]*?aspect-ratio:\s*1;[\s\S]*?radial-gradient\([\s\S]*?at 50% 50%,[\s\S]*?transparent 82%/);
  assert.match(foundationStyles, /\.tier-emblem img,\s*\.tier-emblem svg\s*\{[\s\S]*?filter:\s*none;/);
  assert.doesNotMatch(foundationStyles, /\.tier-emblem img,\s*\.tier-emblem svg\s*\{[\s\S]*?drop-shadow/);
});

test("배정 전 엠블럼은 공용 자산이며 방 슬롯 아바타 뒤에도 표시된다", () => {
  assert.match(tierEmblemSource, /getTierEmblemSrc\(mmr,\s*ratings = null\)/);
  assert.match(tierEmblemSource, /tier-placement-v2\.webp/);
  assert.doesNotMatch(tierEmblemSource, /tier-placement-v1\.svg/);
  assert.ok(fs.existsSync(placementEmblemPath));
  assert.ok(fs.statSync(placementEmblemPath).size > 10_000);
  assert.match(
    pageSources.recruiting,
    /className="arena-position-avatar-tier"[\s\S]*?getTierEmblemSrc\(user\?\.ratings\?\.integrated \?\? mmr,\s*user\?\.ratings\)/,
  );
});

test("팀 경기 히스토리는 공용 최근 경기 행을 사용한다", () => {
  assert.match(teamDetailSource, /import \{ getSideResult, getTeamSide \} from "\.\.\/lib\/season\.js"/);
  assert.match(teamDetailSource, /detailHistory\.map[\s\S]*?<RecentMatchRow/);
  assert.match(teamDetailSource, /archivedHistory\.filter\(\(record\) => !historyIds\.has\(record\.matchId\)\)\.map[\s\S]*?<RecentMatchRow/);
  assert.doesNotMatch(teamDetailSource, /history-item rank-match-item|outcomeLabel|compact-roster/);
  assert.doesNotMatch(teamDetailSource, /\(side\?\.players \?\? \[\]\)\.map/);
});

test("일반 경기 최종 승인은 공용 확인창을 거친다", () => {
  const dialogSource = read("src/components/match/MatchVoidDialog.jsx");
  const matchRoomSource = matchRoomPageSource;
  const recruitingSource = recruitingPageSource;

  assert.match(dialogSource, /더 이상 이의가 없음을 확인하셨나요\?/);
  assert.match(dialogSource, /열린 이의신청 \$\{openDisputeCount\}건을 먼저 처리/);
  assert.match(dialogSource, /disabled=\{blocked \|\| pending\}/);
  assert.match(matchRoomSource, /setFinalizeDialogOpen\(true\)/);
  assert.match(recruitingSource, /setFinalizeMatchTarget\(\{/);
  assert.doesNotMatch(matchRoomSource, /onClick=\{\(\) => app\.actions\.finalizeMatch/);
  assert.doesNotMatch(recruitingSource, /onClick=\{\(\) => app\.actions\.finalizeMatch/);
});

test("구장 등록 주소와 중복 후보는 폼 흐름 안에서 세로로 쌓인다", () => {
  assert.match(
    globalWorkflowStyles,
    /\.settings-address-results\s*\{[^}]*max-height:\s*none;[^}]*overflow:\s*visible;/,
  );
  assert.match(
    globalWorkflowStyles,
    /\.settings-address-results button\s*\{[^}]*height:\s*auto;[^}]*min-height:\s*70px;/,
  );
  assert.match(
    globalWorkflowStyles,
    /\.arena-mini-note\.settings-nearby-courts\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/,
  );
  assert.doesNotMatch(globalSurfaceStyles, /\.settings-page \.settings-address-results/);
});

test("구장 프로필 hero는 공용 구장 배경과 항목명이 있는 정보 뱃지를 사용한다", () => {
  assert.match(
    visualSystemStyles,
    /\.card\.court-detail-hero::before\s*\{[\s\S]*?var\(--bg-court\) var\(--hero-bg-position-court\)/,
  );
  assert.match(courtDetailSource, /실내외 · \{court\.type/);
  assert.match(courtDetailSource, /바닥 · \{getCourtSurfaceLabel\(court\)\}/);
  assert.match(courtDetailSource, /코트 형태 · \{getCourtLayoutLabel\(court\)\}/);
});

test("구장 팝업 프로필은 공용 표면과 정자체를 사용한다", () => {
  assert.match(visualSystemStyles, /\.court-hover-card :is\(em, i\)\s*\{[^}]*font-style:\s*normal;/);
  assert.match(
    visualSystemStyles,
    /\.court-hover-card :is\(\.court-hover-address, \.court-hover-note\)\s*\{[^}]*background:\s*transparent;/,
  );
  assert.match(visualSystemStyles, /\.court-hover-card \.court-hover-stats > span\s*\{[^}]*background:\s*var\(--ui-control-bg\);/);
});

test("모바일 방모달 손잡이와 핵심 정보 grid는 표준 위치를 유지한다", () => {
  const mobileHandleRule = recruitingStyles.match(
    /@media \(max-width:\s*720px\)[\s\S]*?\.arena-lobby-drag-handle\s*\{([^}]*)\}/,
  )?.[1] ?? "";
  assert.match(mobileHandleRule, /height:\s*56px;/);
  assert.match(mobileHandleRule, /min-height:\s*56px;/);
  assert.match(mobileHandleRule, /flex:\s*0 0 56px;/);
  assert.match(mobileHandleRule, /margin:\s*0 auto;/);
  assert.match(
    pageSources.recruiting,
    /className="arena-room-rule-detail-grid"[\s\S]*?selectedRoomOperationRows\.map/,
  );
  assert.doesNotMatch(pageSources.recruiting, /selectedRoomPolicyRows/);
  assert.doesNotMatch(pageSources.recruiting, /arena-room-equipment-summary/);
  assert.doesNotMatch(
    pageSources.recruiting,
    /\[\.\.\.selectedMatchRuleRows,\s*\.\.\.selectedRoomOperationRows\]/,
  );
});

test("방모달 뱃지와 메모 및 팀명은 공용 타이포그래피를 사용한다", () => {
  assert.match(
    primitiveStyles,
    /\.ui-badge\s*\{[^}]*align-items:\s*center;[^}]*justify-content:\s*center;[^}]*min-height:\s*calc\(var\(--ui-badge-font-size\) \+ 12px\);[^}]*font-size:\s*var\(--ui-badge-font-size\);[^}]*line-height:\s*1;/,
  );
  assert.equal(count(pageSources.recruiting, 'className="arena-room-rule-badge"'), 2);
  assert.match(
    recruitingStyles,
    /\.arena-room-rule-panel \.arena-room-rule-badge\s*\{[^}]*border-radius:\s*var\(--ui-control-radius\);[^}]*font-size:\s*var\(--ui-badge-font-size\);[^}]*font-weight:\s*var\(--ui-badge-font-weight\);[^}]*line-height:\s*1;/,
  );
  assert.doesNotMatch(
    pageSources.recruiting,
    /팀 MMR은 실제 참가 명단|후보는 경기 중 본인 교체|참여 확정 후 불참/,
  );
  assert.match(
    recruitingStyles,
    /\.arena-room-rule-panel \.arena-details-memo\s*\{[^}]*background:\s*var\(--ui-card-bg\);/,
  );
  assert.match(
    recruitingStyles,
    /\.arena-room-support-notes\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,/s,
  );
  assert.doesNotMatch(
    pageSources.recruiting,
    /심판 초대 슬롯|심판 자격이 있고 이 방에 참여하지 않은|심판 초대 권한 없음|MMR 반영 여부와 결과는 확정된 배치|방장이 경기 중 기록된 팀 점수를 확인하고 최종 승인합니다/,
  );
  assert.match(
    recruitingStyles,
    /\.arena-lobby-team-head strong\s*\{[^}]*font-family:\s*var\(--sports-display-font\);[^}]*line-height:\s*var\(--sports-display-team-line-height\);/,
  );
  assert.match(
    matchRoomStyles,
    /\.gm-team-head a\s*\{[^}]*line-height:\s*var\(--sports-display-team-line-height\);/,
  );
});

test("경기 기록 팀명은 공용 스포츠 타이포그래피를 사용하고 픽업 정보는 중복하지 않는다", () => {
  assert.match(
    matchClockStyles,
    /\.ui-match-score-control-side > span\s*\{[^}]*font-family:\s*var\(--sports-display-font\);[^}]*font-size:\s*clamp\(1\.15rem,\s*2\.4vw,\s*1\.5rem\);[^}]*font-weight:\s*950;/,
  );
  assert.match(
    recruitingStyles,
    /\.arena-source-record-score span\s*\{[^}]*font-family:\s*var\(--sports-display-font\);[^}]*font-size:\s*clamp\(1\.15rem,\s*2\.4vw,\s*1\.5rem\);[^}]*font-weight:\s*950;/,
  );
  assert.match(
    recruitingStyles,
    /\.arena-record-team-selected > strong\s*\{[^}]*font-family:\s*var\(--sports-display-font\);[^}]*font-size:\s*1\.15rem;[^}]*font-weight:\s*950;/,
  );
  assert.doesNotMatch(recruitingStyles, /\.pickup-operation-(?:grid|item)/);
  assert.doesNotMatch(pageSources.recruiting, /경기 기록에서는 점수와 선수 기록을 먼저 확인합니다/);
  assert.doesNotMatch(pageSources.recruiting, />기록방</);
});

test("경기 기록 참가 확인은 공용 surface token과 모달 밀도를 사용한다", () => {
  assert.match(approvalPanelSource, /className="approval-panel record-approval-panel"/);
  assert.match(
    globalWorkflowStyles,
    /\.approval-panel \.approval-grid > div\s*\{[^}]*border:\s*var\(--ui-card-border-width\) solid var\(--ui-card-border\);[^}]*background:\s*var\(--ui-card-bg\);/,
  );
  assert.match(
    globalAdminStyles,
    /\.approval-panel \.approval-voter-list button\s*\{[^}]*border:\s*var\(--ui-button-border-width\) solid var\(--ui-button-border\);[^}]*background:\s*var\(--ui-button-bg\);/,
  );
  assert.match(
    globalAdminStyles,
    /\.approval-panel \.approval-guard-note\s*\{[^}]*border:\s*var\(--ui-control-group-border-width\) solid var\(--ui-control-group-border\);[^}]*background:\s*var\(--ui-control-group-bg\);/,
  );
  assert.match(
    globalWorkflowStyles,
    /\.record-approval-panel\.approval-panel\s*\{[^}]*display:\s*grid;[^}]*gap:\s*var\(--space-6\);/,
  );
  assert.match(
    globalWorkflowStyles,
    /\.arena-match-source-record-board > \.record-approval-panel\.approval-panel\s*\{[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;[^}]*padding:\s*0;/,
  );
  assert.match(
    globalWorkflowStyles,
    /\.arena-lobby-modal \.record-approval-panel\.approval-panel > \.section-title-row h2\s*\{[^}]*font-size:\s*var\(--font-size-title-md\);/,
  );
  assert.match(
    landingScoreThemeStyles,
    /@media \(max-width:\s*640px\)[\s\S]*?\.approval-panel \.approval-grid\s*\{[^}]*grid-template-columns:\s*1fr;/,
  );
  assert.doesNotMatch(globalAdminStyles, /\.approval-panel \.approval-(?:voter-list|guard-note)[^}]*rgba\(/);
  assert.doesNotMatch(globalAdminStyles, /html\[data-theme="light"\] \.approval-(?:grid|voter-list)/);
});

test("referee stat editor packs fields by available width without stretching rows", () => {
  assert.match(
    recruitingStyles,
    /@media \(max-width:\s*720px\)[\s\S]*?\.arena-lobby-modal \.arena-dispute-player\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);[^}]*gap:\s*var\(--space-1\);[^}]*padding:\s*2px 0 4px;/,
  );
  assert.match(
    globalAdminStyles,
    /\.arena-dispute-player > div\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(88px,\s*1fr\)\);[^}]*grid-auto-rows:\s*max-content;[^}]*align-content:\s*start;[^}]*gap:\s*var\(--space-1\);/,
  );
  assert.match(
    globalAdminStyles,
    /\.ui-numeric-stepper\.arena-stat-stepper\s*\{[^}]*grid-template-columns:\s*30px minmax\(28px,\s*1fr\) 30px;[^}]*grid-template-rows:\s*44px;[^}]*gap:\s*0;/,
  );
  assert.match(
    globalAdminStyles,
    /\.arena-dispute-player \.ui-numeric-stepper\.arena-stat-stepper > input\[type="number"\]\s*\{[^}]*padding:\s*6px 2px;[^}]*font-size:\s*0\.75rem;/,
  );
});

test("방모달 참가자 상태와 관리 action은 선수 오른쪽 열과 공용 구분선을 사용한다", () => {
  assert.match(
    recruitingStyles,
    /\.arena-lobby-modal \.arena-invitation-list > div\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) max-content;[^}]*gap:\s*var\(--room-participant-row-gap\);/,
  );
  assert.match(
    recruitingStyles,
    /\.arena-lobby-modal \.arena-host-kick-row \+ \.arena-host-kick-row,[\s\S]*?border-top:\s*var\(--ui-stroke-width\) solid var\(--room-participant-row-divider\);/,
  );
  assert.match(
    recruitingStyles,
    /@media \(max-width:\s*560px\)[\s\S]*?\.arena-lobby-modal \.arena-host-kick-row,[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\) minmax\(96px,\s*38%\);/,
  );
  assert.match(
    recruitingStyles,
    /--room-participant-row-divider:\s*var\(--ui-liquid-glass-divider\);/,
  );
});

test("팀원 초대는 해시태그와 공용 선수 hover 및 네모 상태 표면을 사용한다", () => {
  const teamDetailSource = readSourceGroupSync(read, TEAM_DETAIL_SOURCE_PATHS);
  assert.match(teamDetailSource, /getUserHashtag/);
  assert.match(teamDetailSource, /search-picker-player-identity/);
  assert.match(teamDetailSource, /member-invite-selection/);
  assert.match(teamDetailSource, /member-control-identity/);
  assert.match(teamDetailSource, /member-control-state">\{joinRequest \? "가입 신청" : "초대 대기"\}<\/span>/);
  assert.doesNotMatch(teamDetailSource, /<Badge tone="orange">pending<\/Badge>/);
  assert.match(
    globalSearchStyles,
    /\.member-control-state,[\s\S]*?\.member-control-row button\s*\{[^}]*min-height:\s*38px;[^}]*border-radius:\s*var\(--ui-button-radius\);[^}]*font-size:\s*var\(--ui-button-font-size\);/,
  );
});

test("업적 프로필 아이콘은 공용 투명 배경 규칙을 사용한다", () => {
  const profileEmblemSource = read("src/components/profile/ProfileEmblem.jsx");
  const profileIconDialogSource = read("src/components/profile/ProfileIconDialog.jsx");
  assert.match(profileEmblemSource, /hasTransparentIcon[\s\S]*?"icon-avatar"/);
  assert.match(
    foundationStyles,
    /\.avatar\.image-avatar\.icon-avatar\s*\{[^}]*background:\s*transparent;/,
  );
  assert.match(
    profileIconDialogSource,
    /draft\.avatarSource === "initial"[\s\S]*?avatarBackgroundEnabled[\s\S]*?배경색 사용/,
  );
});

test("방 채팅은 아이콘 안전 여백과 말풍선 stream을 사용한다", () => {
  assert.match(pageSources.recruiting, /className=\{`arena-chat-message\$\{message\.userId === currentUserId \? " is-mine" : ""\}`\}/);
  assert.match(recruitingStyles, /\.arena-chat-list\s*\{[\s\S]*?padding:\s*10px 12px;/);
  assert.match(recruitingStyles, /\.arena-chat-message\s*\{[\s\S]*?grid-template-columns:\s*34px minmax\(0, 1fr\);/);
  assert.match(recruitingStyles, /\.arena-chat-message\.is-mine > span:last-child\s*\{[\s\S]*?var\(--rb-orange\)/);
  assert.match(recruitingStyles, /\.arena-lobby-modal \.arena-room-chat,[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/);
  assert.match(recruitingStyles, /\.arena-chat-form input,[\s\S]*?min-height:\s*36px;[\s\S]*?height:\s*36px;/);
  assert.doesNotMatch(useAppDataSource, /supabase\s*\.\s*channel\s*\(/);
});

test("MMR 허용구간과 프로필 기본 입력은 공용 컴포넌트를 사용한다", () => {
  assert.match(mmrRangeSelectorSource, /Object\.entries\(MMR_RANGE_POLICIES\)\.map/);
  assert.match(mmrRangeSelectorSource, /role="radiogroup"/);
  assert.match(createMatchPageSource, /<MmrRangeSelector value=\{draft\.mmrRangeMode\}/);
  assert.match(createMatchPageSource, /ratings\?\.modes\?\.\[draft\.mode\] \?\? app\.currentUser\.ratings\?\.integrated/);
  assert.doesNotMatch(
    createMatchPageSource,
    /Object\.entries\(MMR_RANGE_POLICIES\)\.map\(\(\[mode, policy\]\) => \(\s*<button/,
  );

  assert.match(profileBasicsFieldsSource, /BASKETBALL_POSITIONS\.map/);
  assert.match(profileBasicsFieldsSource, /REGION_TREE\.map/);
  assert.match(profileBasicsFieldsSource, /getRegionDistrictOptions\(nextSido\)/);
  assert.match(pageSources.profile, /<ProfileBasicsFields/);
  assert.match(signupSource, /<ProfileBasicsFields/);
  for (const source of [pageSources.profile, signupSource]) {
    assert.doesNotMatch(source, /POSITION_OPTIONS\.map|REGION_TREE\.map/);
  }
});

test("구장 등록요청은 위치 입력 방법을 구분하고 제출 조건을 중앙 계산한다", () => {
  assert.match(settingsSource, /disabled=\{!canSubmitCourtRequest \|\| courtSubmitPending \|\| courtPinPending \|\| courtPhotoPending\}/);
  assert.match(settingsSource, /현재 위치 사용/);
  assert.match(settingsSource, /주소로 찾기/);
  assert.match(courtMapPickerSource, /markersRef\.current\.forEach\(detachMapMarker\)/);
});

test("shared visual roles stay on canonical primitives", () => {
  const rolePairs = [
    ["button", "ui-button"],
    ["card", "ui-card"],
    ["badge", "ui-badge"],
  ];
  const actionRoles = [
    "admin-row-actions",
    "app-confirm-actions",
    "court-correction-actions",
    "court-detail-actions",
    "court-detail-state-actions",
    "home-alert-heading-actions",
    "home-invitation-actions",
    "my-team-actions",
    "notification-actions",
    "profile-icon-card-actions",
    "profile-icon-dialog-actions",
    "referee-exam-actions",
    "season-section-actions",
    "settings-address-actions",
    "settings-place-name-actions",
    "tournament-referee-actions",
    "tournament-sanction-actions",
    "ui-design-actions",
  ];
  const sourceEntries = sourceFiles.map((file) => [file, read(file)]);

  for (const [file, source] of sourceEntries) {
    const classValues = [...source.matchAll(/(?:className\s*=\s*|\.className\s*=\s*)["'`]([^"'`]+)["'`]/g)]
      .map((match) => match[1]);
    for (const classValue of classValues) {
      const tokens = classValue.split(/\s+/);
      for (const [legacyRole, canonicalRole] of rolePairs) {
        if (tokens.includes(legacyRole)) {
          assert.ok(tokens.includes(canonicalRole), `${file}: ${legacyRole} must include ${canonicalRole}`);
        }
      }
    }
  }

  for (const role of actionRoles) {
    const occurrences = sourceEntries.flatMap(([file, source]) => (
      [...source.matchAll(new RegExp(`className="([^"]*\\b${role}\\b[^"]*)"`, "g"))]
        .map((match) => ({ file, className: match[1] }))
    ));
    assert.ok(occurrences.length > 0, `${role}: source occurrence required`);
    for (const occurrence of occurrences) {
      assert.match(occurrence.className, /(?:^|\s)ui-action-row(?:\s|$)/, `${occurrence.file}: ${role} must compose ui-action-row`);
    }
  }

  assert.doesNotMatch(allStyleSources, /^\s*\.(?:card|button|badge)\s*(?:,|\{)/m);
  assert.match(primitiveStyles, /\.ui-button\s*\{[^}]*padding-block:\s*0;/);
  assert.match(primitiveStyles, /\.ui-card\s*\{[^}]*backdrop-filter:\s*none;/);
  assert.match(primitiveStyles, /\.ui-empty-state-compact\s*\{[^}]*font-size:\s*var\(--font-size-meta\);/);
  assert.equal(count(read("src/pages/SettingsPrimaryColumn.jsx"), "onPointerUp={(event) => event.currentTarget.blur()}"), 2);
});

test("프로필 아이콘 action은 자기 카드 안에서 줄바꿈한다", () => {
  assert.match(
    profileTeamControlStyles,
    /\.profile-icon-card-tools \.profile-icon-card-actions\s*\{[^}]*flex-wrap:\s*wrap;/,
  );
});

test("admin court controls use canonical primitives without feature-owned skins", () => {
  assert.match(courtDatabaseControlSource, /className="ui-control ui-control-xs"/);
  assert.match(courtDatabaseControlSource, /<Button[\s\S]*?className=\{selected \? "selected" : ""\}/);
  assert.match(courtDatabasePanelSource, /className="ui-control"/);
  assert.match(courtDatabaseDuplicateSource, /className="ui-control"/);
  assert.doesNotMatch(
    courtDatabaseMapStyles,
    /\.court-db-review-scenarios button\s*\{[^}]*(?:border-radius|background\s*:|color\s*:|cursor\s*:)/,
  );
  assert.doesNotMatch(
    courtDatabaseMapStyles,
    /\.court-db-review-unit-chips button,\s*\.court-db-review-chip-group button\s*\{[^}]*(?:border-radius|background\s*:|color\s*:|cursor\s*:)/,
  );
  assert.doesNotMatch(
    courtDatabaseShellStyles,
    /\.court-db-quick-status button\s*\{[^}]*(?:border-radius|background:|color:|cursor:)/,
  );
});

test("basketball loader has one global presentation", () => {
  const loaderSource = read("src/components/common/BasketballLoader.jsx");
  assert.match(loaderSource, /randomLabel = true/);
  assert.doesNotMatch(loaderSource, /basketball-loader-inline/);
  assert.doesNotMatch(allStyleSources, /\.basketball-loader-inline/);
});

test("control-like surfaces use one primitive visual owner", () => {
  const controlSurfaceRule = getRuleBody(primitiveStyles, ".ui-control-surface");
  assert.match(controlSurfaceRule, /border:\s*var\(--ui-card-border-width\) solid var\(--ui-control-border\);/);
  assert.match(controlSurfaceRule, /border-radius:\s*var\(--ui-control-radius\);/);
  assert.match(controlSurfaceRule, /background:\s*var\(--ui-control-bg\);/);

  for (const file of [
    "src/components/admin/UserOperationsPanel.jsx",
    "src/components/match/MatchDisputeQueue.jsx",
    "src/components/recruiting/RecruitingRoomManagementSection.jsx",
    "src/pages/AdminAppointmentSection.jsx",
    "src/pages/AdminDetailPanel.jsx",
    "src/pages/Affiliations.jsx",
    "src/pages/CourtDetail.jsx",
    "src/pages/TeamDetailView.jsx",
  ]) {
    assert.match(read(file), /ui-control-surface/, `${file}: ui-control-surface required`);
  }

  const progressionSource = read("src/components/rating/ProgressionChecklist.jsx");
  assert.doesNotMatch(progressionSource, /section-title-row[\s\S]{0,120}ui-control-surface/);
  assert.doesNotMatch(progressionSource, /progression-list[\s\S]{0,240}ui-control-surface/);
});

test("page tabs and selection groups use the shared Button owner", () => {
  for (const [file, className] of [
    ["src/pages/PlayerDetail.jsx", "rank-profile-tabs"],
    ["src/pages/RefereeDetail.jsx", "rank-profile-tabs"],
    ["src/pages/TeamDetailView.jsx", "rank-profile-tabs"],
    ["src/components/home/HomeRightRail.jsx", "rank-profile-tabs"],
    ["src/pages/AdminPageView.jsx", "admin-section-tabs"],
    ["src/components/profile/ProfileIconDialog.jsx", "profile-icon-group-tabs"],
  ]) {
    const source = read(file);
    const branch = source.slice(source.indexOf(`className="${className}`), source.indexOf(`className="${className}`) + 1400);
    assert.match(branch, /<Button\b/, `${file}: ${className} must use Button`);
  }
  const folderTabsSource = read("src/components/profile/ProfileRecordSummaryCard.jsx");
  const folderTabsBranch = folderTabsSource.slice(folderTabsSource.indexOf('className="ui-folder-tabs'), folderTabsSource.indexOf('className="ui-folder-tabs') + 900);
  assert.match(folderTabsBranch, /<button\b/);
  assert.doesNotMatch(folderTabsBranch, /<Button\b/);
});

test("shared control families and fixed labels keep canonical ownership", () => {
  const sourceEntries = sourceFiles.map((file) => [file, read(file)]);
  const sharedControlStyles = `${read("src/styles/primitives/shared-controls.css")}\n${read("src/styles/primitives/hover-disclosure.css")}`;
  const uiControlsStyles = read("src/styles/primitives/ui-controls.css");
  const profileRecordStyles = read("src/styles/features/profile-affiliation-ranges.css");
  const segmentedOccurrences = sourceEntries.flatMap(([file, source]) => (
    [...source.matchAll(/className="([^"]*\bsegmented-control\b[^"]*)"/g)]
      .map((match) => ({ file, className: match[1] }))
  ));

  assert.ok(segmentedOccurrences.length > 0, "segmented-control source occurrence required");
  for (const occurrence of segmentedOccurrences) {
    assert.match(occurrence.className, /(?:^|\s)ui-segmented-control(?:\s|$)/, `${occurrence.file}: segmented-control must compose ui-segmented-control`);
  }

  assert.match(sharedControlStyles, /\.ui-segmented-control button/);
  assert.match(uiControlsStyles, /\.ui-folder-tabs button/);
  assert.match(uiControlsStyles, /\.ui-folder-tabs\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*border-bottom:\s*0;/);
  assert.match(uiControlsStyles, /\.ui-folder-tabs button\s*\{[^}]*flex:\s*1 1 0;/);
  assert.match(uiControlsStyles, /\.ui-folder-tabs button:is\(\[aria-selected="true"\], \[aria-checked="true"\]\)\s*\{[^}]*background:\s*transparent;[^}]*font-weight:\s*var\(--font-weight-title\);[^}]*box-shadow:\s*none;[^}]*transform:\s*none;/);
  assert.match(uiControlsStyles, /\.ui-segmented-control:not\(\.create-choice-segments\):not\(\[role="radiogroup"\]\):not\(\.ui-filter-row\)\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/);
  assert.match(uiControlsStyles, /\.ui-segmented-control:not\(\.create-choice-segments\):not\(\[role="radiogroup"\]\) > button:is\(\.active, \[aria-current="page"\], \[aria-selected="true"\]\)\s*\{[^}]*background:\s*transparent;[^}]*font-weight:\s*var\(--font-weight-title\);[^}]*box-shadow:\s*none;/);
  assert.match(tokenStyles, /--ui-mobile-filter-control-height:\s*40px;/);
  assert.match(
    uiControlsStyles,
    /@media \(max-width:\s*720px\)\s*\{[\s\S]*?\.ui-folder-tabs button,[\s\S]*?\.ui-filter-row > button\s*\{[^}]*min-height:\s*var\(--ui-mobile-filter-control-height\);/,
  );
  assert.match(
    profileTeamControlStyles,
    /@media \(max-width:\s*520px\)[\s\S]*?\.ranking-filter-card \.segmented-control button\s*\{[^}]*font-size:\s*var\(--font-size-caption\);/,
  );
  assert.doesNotMatch(
    gettingStartedStyles,
    /font-size:\s*0\.(?:62|66|68|7|70|72|74)rem;/,
  );
  assert.match(profileRecordStyles, /\.profile-record-section-filter,[\s\S]*?\.profile-record-visibility-filter\s*\{[^}]*display:\s*flex;[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*overflow-x:\s*auto;/);
  assert.match(profileRecordStyles, /\.profile-record-section-filter button,[\s\S]*?\.profile-record-visibility-filter button\s*\{[^}]*flex:\s*1 1 0;[^}]*min-width:\s*0;[^}]*white-space:\s*nowrap;/);
  assert.doesNotMatch(profileRecordStyles, /\.profile-record-(?:section|mode|visibility)-filter\s*\{[^}]*grid-template-columns:/);
  assert.match(sharedControlStyles, /button\.ui-choice-tile/);
  assert.match(sharedControlStyles, /\.ui-compact-action/);
  assert.doesNotMatch(sharedControlStyles, /\.(?:create-mode-grid|favorite-type-grid|referee-exam-choice-grid) button/);

  const matchesSource = read("src/pages/MatchesPageView.jsx");
  const matchSelectors = read("src/pages/matchesPageBaseSelectors.js");
  const recentMatchStyles = read("src/styles/features/rank-profile-records.css");
  const fixedSlotLabels = [
    read("src/pages/matchRoomControllerParts.jsx"),
    read("src/components/recruiting/RecruitingRoomCommandPanels.jsx"),
    read("src/components/recruiting/RecruitingRoomRosterPanels.jsx"),
  ].join("\n");
  assert.doesNotMatch(`${matchesSource}\n${matchSelectors}`, /취소 후 7일 보관|소속 팀 진행·예정|내 대회·팀 초대 대회/);
  assert.match(`${matchesSource}\n${matchSelectors}`, /7일 보관/);
  assert.match(matchesSource, /진행·예정/);
  assert.match(matchesSource, /내 대회·초대/);
  assert.doesNotMatch(fixedSlotLabels, /후보 슬롯/);
  assert.doesNotMatch(read("src/components/recruiting/RecruitingRoomPrimarySection.jsx"), /arena-lobby-actions|getMatchPeriodLabel/);
  assert.match(recentMatchStyles, /\.recent-match-matchup \.team-hover-trigger > strong\s*\{[^}]*text-overflow:\s*clip;[^}]*white-space:\s*normal;/);
});
