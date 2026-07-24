import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) => fs.readFileSync(file, "utf8");
const count = (source, value) => source.split(value).length - 1;

const componentSource = read("src/components/match/MatchListCard.jsx");
const matchListStyles = read("src/styles/match-list-card.css");
const primitiveStyles = read("src/styles/ui-primitives.css");
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
