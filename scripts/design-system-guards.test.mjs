import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) => fs.readFileSync(file, "utf8");
const count = (source, value) => source.split(value).length - 1;

const componentSource = read("src/components/match/MatchListCard.jsx");
const matchListStyles = read("src/styles/match-list-card.css");
const primitiveStyles = read("src/styles/ui-primitives.css");
const tokenStyles = read("src/styles/tokens.css");
const visualSystemStyles = read("src/styles/global-visual-system.css");
const courtControlStyles = read("src/styles/global-court-controls.css");
const gettingStartedStyles = read("src/styles/getting-started.css");
const appSource = read("src/App.jsx");
const gettingStartedSource = read("src/pages/GettingStarted.jsx");
const termsSource = read("src/pages/Terms.jsx");
const hoverSurfaceStyles = [
  read("src/styles/global-foundation.css"),
  read("src/styles/global-admin-layout.css"),
  read("src/styles/global-surfaces.css"),
  visualSystemStyles,
  courtControlStyles,
].join("\n");
const pageSources = {
  home: read("src/pages/Home.jsx"),
  matches: read("src/pages/Matches.jsx"),
  recruiting: read("src/pages/Recruiting.jsx"),
  season: read("src/pages/Season.jsx"),
};
const legacyStyleSources = [
  read("src/styles/globals.css"),
  read("src/styles/matches-arena.css"),
  read("src/styles/recruiting-arena.css"),
].join("\n");

function getRuleBody(source, selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`${escapedSelector}\\s*\\{([^{}]*)\\}`));
  assert.ok(match, `${selector} 규칙이 필요합니다.`);
  return match[1];
}

test("공용 CTA는 ui-button-block 하나로 너비만 확장한다", () => {
  assert.equal(count(pageSources.home, 'className="ui-button-block"'), 5);
  assert.equal(count(pageSources.matches, 'className="ui-button-block"'), 2);
  assert.equal(count(pageSources.recruiting, 'className="ui-button-block"'), 2);
  assert.equal(count(pageSources.season, 'className="ui-button-block"'), 1);
  assert.match(primitiveStyles, /\.ui-button-block\s*\{\s*width:\s*100%;\s*\}/);
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
  assert.match(appSource, /path="\/app\/guide" element=\{<GettingStarted \/>\}/);
  assert.equal(count(pageSources.home, 'to="/app/guide"'), 1);
  assert.match(pageSources.home, /처음 사용하시나요\?/);
  assert.match(gettingStartedSource, /농구 기록 웹입니다/);
  assert.match(gettingStartedSource, /필수 웹 기능은 평생 무료/);
  assert.match(gettingStartedSource, /경기시계/);
  assert.match(gettingStartedSource, /심판·기록원/);
  assert.match(gettingStartedSource, /티어 관리/);
  assert.match(gettingStartedSource, /기기별 베타/);
  assert.match(termsSource, /필수 웹 기능은 평생 무료입니다/);
  assert.match(gettingStartedStyles, /@media \(max-width: 720px\)/);
  assert.match(gettingStartedStyles, /@media \(max-width: 480px\)/);
  assert.doesNotMatch(pageSources.home, /onboardingComplete[\s\S]*home-guide-card/);
});
