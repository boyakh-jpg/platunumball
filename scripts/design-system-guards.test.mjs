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
const matchOperationsFieldsSource = matchCreationWizardSource.slice(
  matchCreationWizardSource.indexOf("export function MatchOperationsPolicyFields"),
  matchCreationWizardSource.indexOf("export function MatchCreationFinalSummary"),
);
const ruleSelectorSource = read("src/components/match/RuleSelector.jsx");
const matchListStyles = read("src/styles/match-list-card.css");
const primitiveStyles = read("src/styles/ui-primitives.css");
const tokenStyles = read("src/styles/tokens.css");
const visualSystemStyles = read("src/styles/global-visual-system.css");
const courtControlStyles = read("src/styles/global-court-controls.css");
const globalAdminStyles = read("src/styles/global-admin-layout.css");
const globalWorkflowStyles = read("src/styles/global-workflows.css");
const recruitingStyles = read("src/styles/recruiting-arena.css");
const matchesStyles = read("src/styles/matches-arena.css");
const gettingStartedStyles = read("src/styles/getting-started.css");
const matchRoomStyles = read("src/styles/matchroom-arena.css");
const appSource = read("src/App.jsx");
const gettingStartedSource = read("src/pages/GettingStarted.jsx");
const practiceMatchSource = read("src/pages/PracticeMatch.jsx");
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

test("모든 페이지 본문 굵기는 600 이상을 유지한다", () => {
  const foundationStyles = read("src/styles/global-foundation.css");
  const bodyRule = getRuleBody(foundationStyles, "body");
  const forbiddenWeights = [];

  assert.match(tokenStyles, /--font-weight-body:\s*600;/);
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
});

test("공용 방의 A/B 출전·후보 슬롯은 같은 간격과 반응형 정렬을 사용한다", () => {
  assert.match(
    recruitingStyles,
    /\.arena-lobby-modal \.arena-room-slot-row\s*\{[^}]*grid-auto-columns:\s*minmax\(72px,\s*72px\);[^}]*grid-auto-flow:\s*column;[^}]*grid-template-columns:\s*none;[^}]*justify-content:\s*start;/,
  );
  assert.match(
    recruitingStyles,
    /\.arena-lobby-modal \.arena-lobby-team-panel\.team-b \.arena-room-slot-row\s*\{[^}]*justify-content:\s*safe end;/,
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
    /@media \(max-width:\s*720px\)[\s\S]*?\.arena-lobby-modal \.arena-reserve-panel,\s*html\[data-theme="light"\] \.arena-lobby-modal \.arena-reserve-panel\s*\{[^}]*padding:\s*10px;/,
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
  assert.match(pageSources.home, /6단계 안내/);
  assert.match(pageSources.home, /isHomeGuideCardVisible\(app\.state\.settings\)/);
  assert.match(gettingStartedSource, /useSearchParams/);
  assert.match(gettingStartedSource, /aria-label="사용 설명 목차"/);
  assert.match(gettingStartedSource, /aria-current=\{item\.id === chapter\.id \? "page" : undefined\}/);
  assert.match(gettingStartedSource, /chapterTitleRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(gettingStartedSource, /ref=\{chapterTitleRef\} tabIndex=\{-1\}/);
  for (const chapterId of ["start", "matching", "live", "records", "tier", "practice"]) {
    assert.match(gettingStartedSource, new RegExp(`id: "${chapterId}"`));
  }
  for (const image of [
    "start-home.jpg",
    "matching-create.jpg",
    "live-clock.jpg",
    "records-create.jpg",
    "tier-profile.jpg",
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
  assert.match(gettingStartedSource, /출전·팀 배치를 자동 확정하지 않습니다/);
  assert.match(gettingStartedSource, /양쪽 실제 출전 선수의 과반 승인/);
  assert.match(gettingStartedSource, /경기시계/);
  assert.match(gettingStartedSource, /심판·기록원·경기시계가 역할을 나눕니다/);
  assert.match(gettingStartedSource, /점수판은 심판·기록원이 저장한 점수를 읽기만/);
  assert.match(gettingStartedSource, /A\/B 점수판과 30초 샷클락이 함께 열린/);
  assert.match(gettingStartedSource, /티어는 확정 기록에서 자동 계산됩니다/);
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

test("home and team heroes use one masked clear-glass edge", () => {
  assert.equal(count(tokenStyles, "--ui-liquid-glass-filter: none;"), 2);
  assert.equal(count(tokenStyles, "--ui-liquid-glass-edge-width: 5px;"), 2);
  assert.equal(count(tokenStyles, "--ui-liquid-glass-refraction: saturate("), 2);
  assert.match(tokenStyles, /--ui-liquid-glass-edge:\s*[\s\S]*?radial-gradient\(130% 62% at 8% -12%/);
  assert.match(visualSystemStyles, /html\[data-theme\] \.home-hero-board,\s*html\[data-theme\] \.team-hub-board \{[^}]*border:\s*0;/);
  assert.match(visualSystemStyles, /html\[data-theme\] \.home-hero-board::before,\s*html\[data-theme\] \.team-hub-board::before \{/);
  assert.match(visualSystemStyles, /padding:\s*var\(--ui-liquid-glass-edge-width\);/);
  assert.match(visualSystemStyles, /backdrop-filter:\s*var\(--ui-liquid-glass-refraction\);/);
  assert.equal(count(visualSystemStyles, "-webkit-mask-composite: xor;"), 1);
  assert.equal(count(visualSystemStyles, "mask-composite: exclude;"), 1);
});
