import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) => fs.readFileSync(file, "utf8");
const count = (source, value) => source.split(value).length - 1;
const countClassToken = (source, token) => [...source.matchAll(/className="([^"]*)"/g)]
  .filter(([, className]) => className.split(/\s+/).includes(token))
  .length;
const styleFiles = fs.readdirSync("src/styles")
  .filter((file) => file.endsWith(".css"))
  .map((file) => `src/styles/${file}`);
const sourceFiles = fs.readdirSync("src", { recursive: true })
  .filter((file) => /\.(?:js|jsx|ts|tsx)$/.test(file))
  .map((file) => `src/${file.replaceAll("\\", "/")}`);
const allStyleSources = styleFiles.map((file) => read(file)).join("\n");

const componentSource = read("src/components/match/MatchListCard.jsx");
const matchCreationWizardSource = read("src/components/match/MatchCreationWizard.jsx");
const matchRecordMetaSource = read("src/components/match/MatchRecordMeta.jsx");
const recentMatchRowSource = read("src/components/match/RecentMatchRow.jsx");
const matchOperationsFieldsSource = matchCreationWizardSource.slice(
  matchCreationWizardSource.indexOf("export function MatchOperationsPolicyFields"),
  matchCreationWizardSource.indexOf("export function MatchCreationFinalSummary"),
);
const ruleSelectorSource = read("src/components/match/RuleSelector.jsx");
const matchListStyles = read("src/styles/match-list-card.css");
const primitiveStyles = read("src/styles/ui-primitives.css");
const tokenStyles = read("src/styles/tokens.css");
const foundationStyles = read("src/styles/global-foundation.css");
const globalSearchStyles = read("src/styles/global-search-profile.css");
const visualSystemStyles = read("src/styles/global-visual-system.css");
const courtControlStyles = read("src/styles/global-court-controls.css");
const globalAdminStyles = read("src/styles/global-admin-layout.css");
const globalWorkflowStyles = read("src/styles/global-workflows.css");
const globalSurfaceStyles = read("src/styles/global-surfaces.css");
const classicDesignStyles = read("src/styles/design-classic.css");
const editorialDesignStyles = read("src/styles/design-editorial.css");
const visualDirectionDemoSource = read("src/pages/VisualDirectionDemo.jsx");
const globalStyleManifest = read("src/styles/globals.css");
const appShellSource = read("src/components/layout/AppShell.jsx");
const cardSource = read("src/components/common/Card.jsx");
const sidebarSource = read("src/components/layout/Sidebar.jsx");
const loginSource = read("src/pages/Login.jsx");
const settingsSource = read("src/pages/Settings.jsx");
const teamsSource = read("src/pages/Teams.jsx");
const recruitingListApiSource = read("server/api/recruiting/list.js");
const useAppDataSource = read("src/hooks/useAppData.js");
const recruitingStyles = read("src/styles/recruiting-arena.css");
const matchesStyles = read("src/styles/matches-arena.css");
const gettingStartedStyles = read("src/styles/getting-started.css");
const matchClockStyles = read("src/styles/match-clock.css");
const matchClockSource = read("src/components/match/MatchClockPanel.jsx");
const matchRoomStyles = read("src/styles/matchroom-arena.css");
const appSource = read("src/App.jsx");
const gettingStartedSource = read("src/pages/GettingStarted.jsx");
const practiceMatchSource = read("src/pages/PracticeMatch.jsx");
const termsSource = read("src/pages/Terms.jsx");
const tierEmblemSource = read("src/components/rating/TierEmblem.jsx");
const shareCardSource = read("src/components/share/ShareCard.jsx");
const teamDetailSource = read("src/pages/TeamDetail.jsx");
const courtDetailSource = read("src/pages/CourtDetail.jsx");
const entityProfileHeroSource = read("src/components/profile/EntityProfileHero.jsx");
const placementEmblemPath = "public/assets/tier-emblems/tier-placement-v2.webp";
const hoverSurfaceStyles = [
  read("src/styles/global-foundation.css"),
  read("src/styles/global-admin-layout.css"),
  read("src/styles/global-surfaces.css"),
  visualSystemStyles,
  courtControlStyles,
].join("\n");
const pageSources = {
  landing: read("src/pages/Landing.jsx"),
  home: read("src/pages/Home.jsx"),
  profile: read("src/pages/Profile.jsx"),
  profileRecords: read("src/pages/ProfileRecords.jsx"),
  matches: read("src/pages/Matches.jsx"),
  recruiting: read("src/pages/Recruiting.jsx"),
  season: read("src/pages/Season.jsx"),
  teams: read("src/pages/Teams.jsx"),
  teamDetail: read("src/pages/TeamDetail.jsx"),
  playerDetail: read("src/pages/PlayerDetail.jsx"),
  rankings: read("src/pages/Rankings.jsx"),
  settings: read("src/pages/Settings.jsx"),
};
const legacyStyleSources = [
  read("src/styles/globals.css"),
  read("src/styles/matches-arena.css"),
  read("src/styles/recruiting-arena.css"),
].join("\n");

test("앱은 분류 박스 없는 표준 디자인을 사용하고 비교 데모만 두 CSS를 전환한다", () => {
  const designLeaks = styleFiles
    .filter((file) => !file.endsWith("design-classic.css") && !file.endsWith("design-editorial.css"))
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
  assert.match(pageSources.landing, /className="ui-design-host ui-design-public-main" data-design="editorial"/);
  assert.match(pageSources.landing, /className="ui-design-hero ui-design-main-hero"/);
  assert.match(pageSources.landing, /지금 열려 있는 경기/);
  assert.match(pageSources.landing, /Team basketball/);
  assert.match(pageSources.landing, /Season ranking/);
  assert.match(pageSources.landing, /Recent games/);
  assert.doesNotMatch(pageSources.landing, /ui-design-preference-list|화면 설정/);
  assert.doesNotMatch(pageSources.landing, /ui-design-main-brand|brand-logo-frame|brand-letter-wrap/);
  assert.match(pageSources.landing, /to="\/app"[\s\S]*?>\s*홈\s*</);
  for (const source of [sidebarSource, loginSource, visualDirectionDemoSource]) {
    assert.match(source, /BOXTIER_LETTER_DARK_URL/);
    assert.match(source, /BOXTIER_LETTER_LIGHT_URL/);
    assert.match(source, /brand-letter-fallback/);
  }
  assert.doesNotMatch(pageSources.home, /STANDARD_HOME_LAYOUT|ui-design-home-page|ui-design-main-hero/);
  assert.match(
    editorialAppStyles,
    /\.ui-design-category-surface\.ui-design-surface\s*\{[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/,
  );
  assert.match(editorialAppStyles, /\.ui-design-surface\s*\{[\s\S]*?border:\s*0;/);
  assert.match(editorialAppStyles, /--card-border:\s*transparent;[\s\S]*?--ui-card-border:\s*transparent;/);
  assert.match(editorialAppStyles, /--ui-design-soft-surface-bg:\s*color-mix\(in srgb,\s*var\(--rb-bg-2\) 86%,\s*var\(--rb-bg\)\);/);
  assert.match(editorialAppStyles, /--ui-design-record-surface-bg:\s*color-mix/);
  assert.match(editorialAppStyles, /\.ui-design-info-surface,[\s\S]*?html\[data-theme\][\s\S]*?\.ui-design-borderless-list > \*\s*\{[\s\S]*?border:\s*0;[\s\S]*?background-color:\s*var\(--ui-design-soft-surface-bg\);/);
  assert.match(editorialAppStyles, /\.ui-design-info-surface\.ui-design-info-accent\s*\{[\s\S]*?border-inline-start:\s*4px solid var\(--ui-info-accent, transparent\);/);
  assert.match(editorialAppStyles, /\.ui-design-record-surface\.ui-design-info-surface\s*\{[\s\S]*?background:\s*color-mix/);
  assert.match(editorialAppStyles, /html\[data-theme\][\s\S]*?\.ui-design-soft-surface\s*\{[\s\S]*?border:\s*0;[\s\S]*?background:\s*var\(--ui-design-soft-surface-bg\);/);
  assert.match(editorialAppStyles, /\.ui-design-borderless-surface:not\(\.tier-range-note-warning\),[\s\S]*?\.ui-design-borderless-list > \*\s*\{[\s\S]*?border:\s*0;/);
  assert.match(editorialAppStyles, /\.ui-design-choice-list > \*\s*\{[\s\S]*?border:\s*0;[\s\S]*?background:\s*var\(--ui-design-choice-bg\);/);
  assert.match(editorialAppStyles, /:is\(button, \.ui-button\)\s*\{[\s\S]*?border:\s*0;/);
  assert.match(editorialAppStyles, /\.ui-design-app-hero\s*\{[\s\S]*?border:\s*0;[\s\S]*?border-radius:\s*0;/);
  assert.match(editorialAppStyles, /\.profile-rating-primary\.rating-card-pending\s*\{[\s\S]*?min-height:\s*140px;/);
  assert.match(editorialAppStyles, /\.ui-design-filter-tile\s*\{[\s\S]*?min-height:\s*60px;[\s\S]*?padding-block:\s*7px;/);
  assert.match(editorialAppStyles, /\.segmented-control\s*\{[\s\S]*?border:\s*0;[\s\S]*?padding:\s*0;[\s\S]*?background:\s*transparent;/);
  assert.match(editorialAppStyles, /\.segmented-control button\s*\{[\s\S]*?background:\s*var\(--ui-design-choice-bg\);/);
  assert.match(pageSources.home, /home-upcoming-card ui-design-category-surface/);
  assert.match(pageSources.home, /ui-design-borderless-list/);
  assert.match(pageSources.home, /ui-button-block ui-design-borderless-surface/);
  assert.match(pageSources.matches, /om-view-card ui-design-soft-surface/);
  assert.match(pageSources.matches, /ui-design-filter-tile/);
  assert.match(pageSources.matches, /om-calendar-summary ui-design-soft-surface/);
  assert.match(pageSources.recruiting, /arena-queue-controls ui-design-soft-surface/);
  assert.match(read("src/pages/CreateMatch.jsx"), /create-eligibility-control ui-design-borderless-surface/);
  assert.match(read("src/pages/CreateMatch.jsx"), /create-public-note ui-design-borderless-surface/);
  assert.match(pageSources.settings, /favorite-type-grid ui-design-borderless-list ui-design-borderless-surface/);
  assert.equal(count(settingsSource, "ui-design-choice-list"), 4);
  assert.match(pageSources.teams, /my-team-list ui-design-borderless-list/);
  assert.match(teamsSource, /favorite-search-label ui-field-span-all/);
  assert.match(primitiveStyles, /\.ui-field-span-all\s*\{[^}]*grid-column:\s*1 \/ -1;[^}]*width:\s*100%;/);
  assert.match(pageSources.profile, /contract-grid single ui-design-borderless-list/);
  assert.match(courtDetailSource, /court-map-link ui-liquid-glass/);
  assert.match(courtDetailSource, /court-detail-hero ui-design-app-hero/);
  assert.match(courtDetailSource, /court-profile-information ui-design-content-surface/);
  assert.match(primitiveStyles, /\.ui-tier-label\s*\{[^}]*font-family:\s*var\(--sports-display-font\);[^}]*font-style:\s*normal;[^}]*font-weight:\s*950;/);
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
  assert.match(pageSources.playerDetail, /<MessageCircle size=\{14\} aria-hidden="true" \/>/);
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
  assert.doesNotMatch(pageSources.playerDetail, /form-pill/);
  assert.doesNotMatch(globalSearchStyles, /\.form-pill(?:-row)?\s*\{/);
  assert.match(globalSurfaceStyles, /\.profile-detail-page \.profile-hero\s*\{[^}]*--page-hero-bg:\s*var\(--bg-profile\);/);
});

test("win loss draw record borders keep semantic colors in every theme", () => {
  assert.match(tokenStyles, /--ui-result-win-border:\s*var\(--blue\);/);
  assert.match(tokenStyles, /--ui-result-loss-border:\s*var\(--danger\);/);
  assert.match(tokenStyles, /--ui-result-draw-border:\s*var\(--gold\);/);
  assert.match(
    primitiveStyles,
    /html\[data-theme\] \.app-main :is\(\.recent-match-row\.result-w, \.rank-match-win\)\s*\{[^}]*border-left-color:\s*var\(--ui-result-win-border\);/,
  );
  assert.match(
    primitiveStyles,
    /html\[data-theme\] \.app-main :is\(\.recent-match-row\.result-l, \.rank-match-loss\)\s*\{[^}]*border-left-color:\s*var\(--ui-result-loss-border\);/,
  );
  assert.match(
    primitiveStyles,
    /html\[data-theme\] \.app-main :is\(\.recent-match-row\.result-d, \.rank-match-draw\)\s*\{[^}]*border-left-color:\s*var\(--ui-result-draw-border\);/,
  );
});

test("inline profile identities share one icon text gap", () => {
  assert.match(tokenStyles, /--ui-profile-identity-gap:\s*var\(--space-4\);/);
  assert.match(
    primitiveStyles,
    /\.ui-profile-identity-inline\s*\{[^}]*display:\s*inline-flex;[^}]*align-items:\s*center;[^}]*gap:\s*var\(--ui-profile-identity-gap\);/,
  );
  assert.equal(countClassToken(pageSources.teamDetail, "ui-profile-identity-inline"), 1);
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
  const foundationStyles = read("src/styles/global-foundation.css");
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
  assert.match(globalSearchStyles, /\.recent-match-list\s*\{[^}]*--recent-match-list-gap:\s*var\(--space-6\);[^}]*gap:\s*var\(--recent-match-list-gap\);/);
  assert.doesNotMatch(courtControlStyles, /\.home-recent-card \.recent-match-(?:copy|matchup|vs)/);
});

function getRuleBody(source, selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`${escapedSelector}\\s*\\{([^{}]*)\\}`));
  assert.ok(match, `${selector} 규칙이 필요합니다.`);
  return match[1];
}

test("모든 페이지 기본 본문은 800이며 명시형 굵기는 600 이상을 유지한다", () => {
  const foundationStyles = read("src/styles/global-foundation.css");
  const bodyRule = getRuleBody(foundationStyles, "body");
  const forbiddenWeights = [];

  assert.match(tokenStyles, /--font-weight-body:\s*800;/);
  assert.match(bodyRule, /font-weight:\s*var\(--font-weight-body\);/);

  for (const file of styleFiles) {
    const source = read(file);
    for (const match of source.matchAll(/font-weight\s*:\s*([^;}{]+)\s*;/g)) {
      const value = match[1].trim();
      const numericWeight = Number(value);
      if (
        (Number.isFinite(numericWeight) && numericWeight < 600)
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
        (Number.isFinite(numericWeight) && numericWeight < 600)
        || /^(?:normal|lighter|initial|unset|revert|revert-layer)$/i.test(value)
      ) {
        forbiddenWeights.push(`${file}: ${value}`);
      }
    }
  }

  assert.deepEqual(forbiddenWeights, []);
});

test("공용 CTA는 ui-button-block 하나로 너비만 확장한다", () => {
  assert.equal(countClassToken(pageSources.home, "ui-button-block"), 5);
  assert.equal(countClassToken(pageSources.matches, "ui-button-block"), 2);
  assert.equal(countClassToken(pageSources.recruiting, "ui-button-block"), 2);
  assert.equal(countClassToken(pageSources.season, "ui-button-block"), 1);
  assert.match(primitiveStyles, /\.ui-button-block\s*\{\s*width:\s*100%;\s*\}/);
});

test("공용 버튼과 badge 라벨은 한 줄을 유지한다", () => {
  assert.match(primitiveStyles, /\.ui-button\s*\{[\s\S]*?white-space:\s*nowrap;/);
  assert.match(primitiveStyles, /\.ui-badge\s*\{[\s\S]*?flex:\s*0 0 auto;[\s\S]*?white-space:\s*nowrap;/);
  assert.match(primitiveStyles, /\.ui-action-row > \*\s*\{\s*flex:\s*0 0 auto;\s*\}/);
  assert.doesNotMatch(hoverSurfaceStyles, /(?:^|\n)\s*\.button\s*\{[^{}]*white-space:\s*normal;/);
});

test("알림 보기와 읽음은 같은 네모 버튼 규격을 사용한다", () => {
  const notificationSource = read("src/pages/Notifications.jsx");
  assert.match(notificationSource, /notification-action-control notification-terminal-state/);
  assert.match(notificationSource, /notification-action-control notification-row-open/);
  assert.match(notificationSource, /notification-action-control notification-read-button/);
  assert.match(
    foundationStyles,
    /\.notification-actions \.notification-action-control\s*\{[^}]*min-width:\s*calc\(var\(--ui-button-height\) \+ var\(--space-6\)\);[^}]*height:\s*var\(--ui-button-height\);[^}]*min-height:\s*var\(--ui-button-height\);[^}]*border-radius:\s*var\(--ui-button-radius\);/,
  );
  assert.match(
    foundationStyles,
    /\.notification-actions \.notification-read-button\s*\{[^}]*min-width:\s*calc\(var\(--ui-button-height\) \+ var\(--space-6\)\);[^}]*height:\s*var\(--ui-button-height\);/,
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
    /\.ui-match-shot-clock\s*\{[^}]*border:\s*1px solid[^;]+;[^}]*box-shadow:\s*0 12px 24px[^;]+;/,
  );
  assert.doesNotMatch(
    matchClockStyles,
    /\.ui-match-shot-clock(?::[^{]+)?\s*\{[^}]*box-shadow:[^}]*(?:0 5px 0|0 2px 0)/,
  );
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
  assert.match(checkboxRule, /border:\s*2px solid var\(--ui-control-border\);/);
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
});

test("같은 정책 행은 명시형 선택 필드와 중앙 control 정렬을 사용한다", () => {
  assert.match(matchOperationsFieldsSource, /조끼 준비/);
  assert.match(matchOperationsFieldsSource, /value=\{policy\.vestsProvided \? "provided" : "not_provided"\}/);
  assert.match(matchOperationsFieldsSource, /vestsProvided:\s*event\.target\.value === "provided"/);
  assert.doesNotMatch(matchOperationsFieldsSource, /type="checkbox"/);

  assert.match(ruleSelectorSource, /2점 차 승리[\s\S]*?value=\{rules\.winByTwo \? "enabled" : "disabled"\}/);
  assert.match(ruleSelectorSource, /winByTwo:\s*event\.target\.value === "enabled"/);
  assert.doesNotMatch(ruleSelectorSource, /type="checkbox" checked=\{rules\.winByTwo\}/);

  assert.match(pageSources.recruiting, /참가 상태[\s\S]*?value=\{joinDraft\.reserve \? "reserve" : "starter"\}/);
  assert.match(pageSources.recruiting, /const reserve = event\.target\.value === "reserve"/);
  assert.doesNotMatch(pageSources.recruiting, /arena-check-row/);

  assert.match(courtControlStyles, /\.match-operations-policy-fields \.form-grid\.two\s*\{[^}]*align-items:\s*center;/);
  assert.match(recruitingStyles, /\.arena-participation-fields\s*\{[^}]*align-items:\s*center;/);
  assert.match(matchesStyles, /\.tournament-inline-schedule\s*\{[^}]*align-items:\s*center;/);
  assert.match(matchesStyles, /\.tournament-schedule-list form\s*\{[^}]*align-items:\s*center;/);

  assert.match(
    globalWorkflowStyles,
    /input:focus,\s*select:focus,\s*textarea:focus\s*\{[^}]*border-color:\s*var\(--rb-orange\);[^}]*box-shadow:\s*var\(--focus-ring\);/,
  );
  assert.doesNotMatch(
    globalWorkflowStyles,
    /input:focus,\s*select:focus,\s*textarea:focus\s*\{[^}]*var\(--green\)/,
  );
});

test("같은 행의 랜딩 칸과 생성 control은 같은 폭과 높이를 사용한다", () => {
  const landingStats = getRuleBody(globalWorkflowStyles, ".landing-stat-grid");

  assert.match(tokenStyles, /--ui-segmented-field-height:\s*calc\(/);
  assert.match(globalWorkflowStyles, /\.landing-actions > \.button\s*\{[^}]*flex:\s*1 1 0;[^}]*min-width:\s*0;/);
  assert.match(landingStats, /width:\s*100%;/);
  assert.match(landingStats, /max-width:\s*none;/);
  assert.match(
    courtControlStyles,
    /\.create-match-info-grid\.is-standard-room input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\):not\(\[type="color"\]\),\s*\.create-match-info-grid\.is-standard-room select,\s*\.match-roster-policy-fields > label > select\s*\{[^}]*min-height:\s*var\(--ui-segmented-field-height\);/,
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
    courtControlStyles,
    /\.match-creation-wizard-secondary-actions,[\s\S]*?\.match-creation-wizard-primary-actions\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;/,
  );
  assert.match(
    courtControlStyles,
    /\.match-creation-wizard-primary-actions\s*\{[^}]*margin-left:\s*auto;/,
  );
  assert.match(
    matchCreationWizardSource,
    /match-creation-wizard-secondary-actions[\s\S]*취소하기[\s\S]*이전[\s\S]*match-creation-wizard-primary-actions[\s\S]*다음[\s\S]*type="submit"/,
  );
});

test("매칭과 기록 생성 선택 영역은 같은 제목과 버튼 타이포그래피를 사용한다", () => {
  assert.match(
    courtControlStyles,
    /\.match-intent-preset-grid > button\s*\{[^}]*font:\s*inherit;/,
  );
  assert.match(
    courtControlStyles,
    /\.create-match-page \.create-choice-heading\s*\{[^}]*font-size:\s*var\(--create-choice-heading-font-size\);[^}]*font-weight:\s*900;/,
  );
  assert.match(
    courtControlStyles,
    /\.create-match-page :is\(\.create-mode-grid,\s*\.match-intent-preset-grid\) button strong\s*\{[^}]*font-size:\s*var\(--create-choice-option-title-font-size\);[^}]*line-height:\s*1\.35;/,
  );
  assert.match(
    courtControlStyles,
    /\.create-match-page \.create-mode-grid button em,[\s\S]*?font-size:\s*var\(--create-choice-option-copy-font-size\);[\s\S]*?line-height:\s*1\.45;/,
  );
});

test("공용 방의 A/B 출전·후보 슬롯은 같은 간격과 반응형 정렬을 사용한다", () => {
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
    /\.arena-lobby-modal \.arena-reserve-panel > \.arena-reserve-line:nth-child\(2\) > \.arena-room-reserve-row\s*\{[^}]*justify-content:\s*end;/,
  );
  assert.match(
    recruitingStyles,
    /@media \(max-width:\s*1100px\)[\s\S]*?\.arena-lobby-modal \.arena-reserve-panel\s*\{[^}]*display:\s*none;[\s\S]*?\.arena-lobby-modal \.arena-side-inline-reserve\s*\{[^}]*display:\s*block;/,
  );
  assert.match(
    recruitingStyles,
    /\.arena-lobby-modal \.arena-lobby-team-panel\.team-b \.arena-side-inline-reserve \.arena-room-reserve-row,[\s\S]*?\{[^}]*justify-content:\s*end;/,
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

test("공용 빈 상태와 control 높이는 페이지 override 없이 유지된다", () => {
  assert.doesNotMatch(globalWorkflowStyles, /(?:^|\n)\s*\.empty-state\s*\{/);
  assert.doesNotMatch(globalWorkflowStyles, /(?:^|\n)\s*\.ui-empty-state\s*\{/);
  assert.match(primitiveStyles, /\.ui-empty-state-compact\s*\{/);
  assert.match(recruitingStyles, /\.arena-modal-close-button\s*\{\s*min-height:\s*var\(--ui-button-height\);/);
  assert.match(
    matchesStyles,
    /@media \(max-width:\s*480px\)[\s\S]*?\.om-calendar-filter-row \.segmented-control button\s*\{[\s\S]*?min-height:\s*var\(--ui-button-height\);[\s\S]*?height:\s*var\(--ui-button-height\);/,
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
  assert.match(read("src/styles/matchroom-arena.css"), /\.match-room \.match-derived-score/);
});

test("목록 카드는 Card, Button, ui-panel primitive를 사용한다", () => {
  assert.match(componentSource, /import Button from "\.\.\/common\/Button\.jsx";/);
  assert.match(componentSource, /import Card from "\.\.\/common\/Card\.jsx";/);
  assert.match(componentSource, /<Card\s+as="article"/);
  assert.match(componentSource, /<Button\s+className="match-list-card__action"/);
  assert.match(componentSource, /className="match-list-summary ui-panel"/);
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
  assert.equal(count(pageSources.home, 'to="/app/guide"'), 1);
  assert.match(pageSources.home, /처음 사용하시나요\?/);
  assert.match(pageSources.home, /13단계 안내/);
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
  assert.match(gettingStartedSource, /QR 출석은 경기시계를 사용하는 일반 공개 매칭방에서만 선택/);
  assert.match(gettingStartedSource, /QR 토큰은 5분마다 바뀌며 경기 10분 전부터 로그인한 사전 등록 선수/);
  assert.match(gettingStartedSource, /QR 출석과 실제 출전은 다릅니다/);
  assert.match(gettingStartedSource, /체크인 참가자 표는 3초, 경기 전 QR 패널은 15초, 경기시계와 지각 QR은 3초/);
  assert.match(gettingStartedSource, /만료된 QR, 다른 경기의 QR, 서명이 잘못된 QR, 미등록 사용자 스캔은 거부/);
  assert.match(gettingStartedSource, /출전·팀 배치를 자동 확정하지 않습니다/);
  assert.doesNotMatch(gettingStartedSource, /양쪽 실제 출전 선수의 과반 승인/);
  assert.match(gettingStartedSource, /열린 이의를 처리하고 별도 최종 승인/);
  assert.match(gettingStartedSource, /경기시계/);
  assert.match(gettingStartedSource, /심판·경기시계 담당자·선수가 역할을 나눕니다/);
  assert.match(gettingStartedSource, /양쪽 점수는 심판 경기에서는 배정 심판, 무심판 경기에서는 시계 담당자가 조작/);
  assert.match(gettingStartedSource, /A\/B 점수판과 30초 샷클락이 함께 열린/);
  assert.match(gettingStartedSource, /블루투스 설정에서 워치 또는 비오디오 미디어 리모컨을 먼저 연결/);
  assert.match(gettingStartedSource, /재생 또는 일시정지를 누르면 설정한 샷클락 시간으로 초기화/);
  assert.match(gettingStartedSource, /이어폰·헤드셋은 부저 소리를 가져갈 수 있어 지원 기기로 안내하지 않습니다/);
  assert.match(gettingStartedSource, /MMR은 실력이 비슷한 상대를 찾고 순위를 계산하는 경기력 점수/);
  assert.match(gettingStartedSource, /팀 파티는 그 팀 선수들이 한 경기에 같이 신청한 임시 묶음/);
  assert.match(gettingStartedSource, /팀장은 팀 자체를 관리합니다\. 사이드장은 이번 경기에서 자기 편의 명단을 관리/);
  assert.match(gettingStartedSource, /경기시계 담당자는 현장에서 시계·샷클락을 맡으며 무심판 시계 경기에서는 양쪽 점수도 조작/);
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
  assert.match(gettingStartedSource, /숨겨도 사용 설명과 연습 경기는 계속 이용할 수 있습니다/);
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

test("hero inner boards share one readable liquid-glass system", () => {
  assert.equal(count(tokenStyles, "--hero-copy-color: var(--rb-cream);"), 2);
  assert.equal(count(tokenStyles, "0 4px 12px"), 2);
  assert.equal(count(tokenStyles, "0 3px 8px"), 2);
  assert.doesNotMatch(tokenStyles, /--hero-title-shadow:[\s\S]{0,100}?14px 34px/);
  assert.doesNotMatch(tokenStyles, /--hero-copy-shadow:[\s\S]{0,100}?8px 20px/);
  assert.equal(count(tokenStyles, "--ui-liquid-glass-filter: blur(0.75px) saturate(1.02);"), 2);
  assert.equal(count(tokenStyles, "--ui-liquid-glass-edge-width: 1px;"), 2);
  assert.equal(count(tokenStyles, "--ui-liquid-glass-refraction: url(\"#ui-liquid-glass-refraction\");"), 2);
  assert.match(tokenStyles, /--ui-hero-status-width:\s*428px;/);
  assert.match(tokenStyles, /--ui-hero-metric-min-height:\s*72px;/);
  assert.doesNotMatch(tokenStyles, /--ui-liquid-glass-(?:caustic|edge-inset|refraction-inner)/);
  assert.match(tokenStyles, /--ui-liquid-glass-edge:\s*[\s\S]*?linear-gradient\(135deg/);
  assert.match(appSource, /id="ui-liquid-glass-refraction"/);
  assert.match(appSource, /<feTurbulence[^>]*type="fractalNoise"[^>]*baseFrequency="0\.008 0\.018"/);
  assert.match(appSource, /<feDisplacementMap[^>]*in="SourceGraphic"[^>]*scale="1\.25"/);
  assert.match(tokenStyles, /--ui-liquid-glass-divider:\s*rgba\(255,\s*255,\s*255,\s*0\.11\);/);
  assert.match(tokenStyles, /--ui-liquid-glass-divider:\s*rgba\(35,\s*50,\s*59,\s*0\.12\);/);
  assert.match(primitiveStyles, /html\[data-theme\] \.app-main :is\(\.ui-liquid-glass,\s*\.page-header > \.ui-button\)\s*\{[^}]*border:\s*0;[^}]*backdrop-filter:\s*var\(--ui-liquid-glass-filter\);/);
  assert.match(primitiveStyles, /html\[data-theme\] \.app-main :is\(\.ui-liquid-glass,\s*\.page-header > \.ui-button\)\s*\{[^}]*text-shadow:\s*none;/);
  assert.match(primitiveStyles, /html\[data-theme\] \.app-main \.ui-liquid-glass :where\(\*\)\s*\{[^}]*text-shadow:\s*none;/);
  assert.match(primitiveStyles, /html\[data-theme\] \.app-main :is\(\.ui-liquid-glass,\s*\.page-header > \.ui-button\)::before\s*\{/);
  assert.match(primitiveStyles, /padding:\s*var\(--ui-liquid-glass-edge-width\);/);
  assert.match(primitiveStyles, /backdrop-filter:\s*var\(--ui-liquid-glass-refraction\);/);
  assert.match(primitiveStyles, /\.app-main \.ui-liquid-glass-segments\s*\{[^}]*border:\s*1px solid var\(--ui-liquid-glass-divider\);/);
  assert.match(primitiveStyles, /\.app-main \.ui-liquid-glass-segments > \* \+ \*\s*\{[^}]*border-left:\s*1px solid var\(--ui-liquid-glass-divider\);/);
  assert.match(pageSources.home, /home-hero-board ui-liquid-glass/);
  assert.match(pageSources.teams, /team-hub-board ui-liquid-glass/);
  assert.match(pageSources.matches, /om-match-panel ui-liquid-glass[\s\S]*om-match-stats ui-liquid-glass-segments/);
  assert.match(pageSources.recruiting, /arena-hero-panel ui-liquid-glass[\s\S]*arena-hero-stats ui-liquid-glass-segments/);
  assert.match(pageSources.season, /<header className="page-header">/);
  assert.match(pageSources.season, /section-card season-overview-card/);
  assert.match(pageSources.season, /className="rank-stat-grid season-summary-grid"/);
  assert.match(pageSources.season, /className="card-grid season-board-grid"/);
  assert.doesNotMatch(pageSources.season, /season-(?:hero|rule-board|summary-item|content-grid|side-rail|metric-card)|ui-liquid-glass/);
  assert.match(pageSources.playerDetail, /className="player-tier-hero"/);
  assert.doesNotMatch(pageSources.playerDetail, /rank-tier-statement ui-liquid-glass/);
  assert.match(visualSystemStyles, /\.om-match-hero,\s*\.arena-recruit-hero[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\) minmax\(0,\s*var\(--ui-hero-status-width\)\);/);
  assert.match(visualSystemStyles, /\.om-match-panel,\s*\.arena-hero-panel[\s\S]*?width:\s*min\(100%,\s*var\(--ui-hero-status-width\)\);/);
  assert.match(visualSystemStyles, /\.om-match-actions,\s*\.arena-hero-actions[\s\S]*?height:\s*var\(--ui-button-height\);/);
  assert.match(visualSystemStyles, /\.home-rank-board-head[\s\S]*?\)\s*\.eyebrow,[\s\S]*?color:\s*var\(--rb-orange-2\);/);
  assert.match(visualSystemStyles, /\.home-hero-next > strong,[\s\S]*?\.arena-hero-stats strong[\s\S]*?color:\s*var\(--hero-title-color\);/);
  assert.doesNotMatch(pageSources.landing, /landing-compact-summary/);
  assert.match(
    visualSystemStyles,
    /@media \(max-width:\s*720px\)[\s\S]*?--landing-hero-size:\s*auto min\(58svh,\s*620px\);[\s\S]*?--landing-hero-position:\s*54% 8%;/,
  );
  assert.equal(count(primitiveStyles, "-webkit-mask-composite: xor;"), 1);
  assert.equal(count(primitiveStyles, "mask-composite: exclude;"), 1);
});

test("팀 허브 대표팀 보드는 팀 전용 너비와 고정 노랑 팀명을 사용한다", () => {
  assert.match(
    read("src/styles/tokens.css"),
    /--rb-yellow:\s*#ffd36c;/,
  );
  assert.match(
    visualSystemStyles,
    /\.team-hub-board strong\s*\{[^}]*color:\s*var\(--rb-yellow\);/,
  );
  assert.match(
    read("src/styles/global-surfaces.css"),
    /\.team-hub-board\s*\{[^}]*width:\s*min\(100%,\s*720px\);[^}]*max-width:\s*none;/,
  );
  assert.doesNotMatch(pageSources.teams, /team-hub-board-emblem/);
  assert.doesNotMatch(read("src/styles/global-surfaces.css"), /\.team-hub-board-emblem/);
  assert.match(
    read("src/styles/global-surfaces.css"),
    /\.team-hub-board\s*\{[^}]*gap:\s*var\(--space-8\);[^}]*padding:\s*clamp\(24px,\s*3vw,\s*32px\);/,
  );
  assert.doesNotMatch(
    visualSystemStyles,
    /\.team-hub-board strong[^}]*background(?:-image)?:\s*(?:linear|radial)-gradient/,
  );
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
  const foundationStyles = read("src/styles/global-foundation.css");

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
  assert.match(teamDetailSource, /detailHistory\.map[\s\S]*?<RecentMatchRow/);
  assert.match(teamDetailSource, /archivedHistory\.map[\s\S]*?<RecentMatchRow/);
  assert.doesNotMatch(teamDetailSource, /history-item rank-match-item|outcomeLabel|compact-roster/);
  assert.doesNotMatch(teamDetailSource, /\(side\?\.players \?\? \[\]\)\.map/);
});

test("일반 경기 최종 승인은 공용 확인창을 거친다", () => {
  const dialogSource = read("src/components/match/MatchVoidDialog.jsx");
  const matchRoomSource = read("src/pages/MatchRoom.jsx");
  const recruitingSource = read("src/pages/Recruiting.jsx");

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

test("모바일 방모달 손잡이와 규칙 준비물 뱃지는 표준 위치를 유지한다", () => {
  const mobileHandleRule = recruitingStyles.match(
    /@media \(max-width:\s*720px\)[\s\S]*?\.arena-lobby-drag-handle\s*\{([^}]*)\}/,
  )?.[1] ?? "";
  assert.match(mobileHandleRule, /height:\s*56px;/);
  assert.match(mobileHandleRule, /min-height:\s*56px;/);
  assert.match(mobileHandleRule, /flex:\s*0 0 56px;/);
  assert.match(mobileHandleRule, /margin:\s*0 auto;/);
  assert.match(
    pageSources.recruiting,
    /className="arena-room-rule-summary"[\s\S]*?selectedRoomOperationRows\.map/,
  );
  assert.doesNotMatch(pageSources.recruiting, /arena-room-equipment-summary/);
  assert.doesNotMatch(
    pageSources.recruiting,
    /\[\.\.\.selectedMatchRuleRows,\s*\.\.\.selectedRoomOperationRows\]/,
  );
});
