import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";

const globalManifest = "src/styles/globals.css";
const featureCssFiles = [
  "src/styles/match-clock.css",
  "src/styles/match-attendance.css",
  "src/styles/recruiting-arena.css",
  "src/styles/matches-arena.css",
  "src/styles/match-list-card.css",
  "src/styles/matchroom-arena.css",
];
const idlePreloadFeatureCssFiles = featureCssFiles.filter((file) => file !== "src/styles/matchroom-arena.css");
const globalModuleMaxLines = 4500;
const crossStackSameValueBaseline = 111;

const runtimeRoots = ["src", "public"];
const runtimeFiles = ["index.html", "privacy.html", "terms.html"];
const runtimeExtensions = new Set([".html", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const runtimeClassPrefixes = new Set(["gm-", "leaflet-", "maplibregl-", "naver-"]);
const knownUnusedClassTokens = new Set();
const sharedBranchUnusedClassTokens = new Set([
  "tag",
  "winner",
]);

const crossStackDifferentValueBaseline = new Set([
  [".arena-icon-button", "border-radius", "var(--radius-xs)", "var(--ui-button-radius)"],
  [".arena-icon-button", "background", "rgba(255, 255, 255, 0.06)", "var(--ui-button-bg)"],
  [".om-match-copy h1", "font-family", "var(--sports-display-font)", "var(--hero-title-font)"],
  [".om-match-copy h1", "font-size", "clamp(46px, 5.5vw, 72px)", "var(--hero-title-size)"],
  [".om-match-copy h1", "line-height", "0.92", "var(--hero-title-line-height)"],
  [".om-match-copy h1", "letter-spacing", "0", "var(--hero-title-letter-spacing)"],
  [".arena-hero-copy h1", "font-family", "var(--sports-display-font)", "var(--hero-title-font)"],
  [".arena-hero-copy h1", "font-size", "clamp(46px, 5.5vw, 72px)", "var(--hero-title-size)"],
  [".arena-hero-copy h1", "line-height", "0.92", "var(--hero-title-line-height)"],
  [".arena-hero-copy h1", "letter-spacing", "0", "var(--hero-title-letter-spacing)"],
  [".arena-lobby-title h2", "line-height", "0.92", "0.9"],
  [".arena-icon-button", "color", "var(--rb-text)", "var(--ui-button-color)"],
  [".om-calendar-filter-bar", "border", "var(--ui-card-border-width) solid var(--ui-card-border)", "0"],
  [".om-calendar-filter-bar", "border-radius", "var(--ui-card-radius)", "0"],
  [".om-calendar-filter-bar", "background", "var(--ui-card-bg)", "transparent"],
  [".om-calendar-filter-bar", "box-shadow", "var(--ui-card-shadow)", "none"],
  ['html[data-theme="light"] .om-calendar-filter-bar', "background", "var(--card-bg)", "transparent"],
  ['html[data-theme="light"] .om-calendar-filter-bar', "box-shadow", "var(--card-shadow)", "none"],
  [".arena-filter-bar button", "min-height", "var(--ui-button-height)", "42px"],
  [".arena-start-date-filter button", "min-height", "var(--ui-button-height)", "42px"],
  [".gm-next-action-card", "border", "var(--ui-card-border-width) solid var(--ui-card-border)", "var(--ui-room-panel-border-width) solid var(--card-border)"],
  [".gm-next-action-card", "border-radius", "var(--ui-card-radius)", "var(--card-radius)"],
  [".gm-next-action-card", "background", "var(--ui-card-bg)", "var(--card-bg)"],
  [".gm-next-action-card", "box-shadow", "var(--ui-card-shadow)", "var(--card-shadow)"],
  [".gm-next-action-card .button:not(.button-secondary)", "background", "var(--ui-button-bg-active)", "var(--button-primary-bg)"],
  [".gm-next-action-card .button:not(.button-secondary)", "color", "var(--ui-button-color-active)", "#fff"],
  [".gm-next-action-card .button:not(.button-secondary):hover", "background", "var(--ui-button-bg-hover)", "var(--button-primary-hover-bg)"],
  [".gm-next-action-card .button:not(.button-secondary):hover", "color", "var(--ui-button-color-active)", "#fff"],
  [".arena-filter-bar .segmented-control", "border", "var(--ui-control-group-border-width) solid var(--ui-control-group-border)", "0"],
  [".arena-filter-bar .segmented-control", "border-radius", "var(--ui-control-group-radius)", "0"],
  [".arena-filter-bar .segmented-control", "background", "var(--ui-control-group-bg)", "transparent"],
  [".arena-filter-bar .segmented-control", "padding", "var(--ui-control-group-padding)", "0"],
  [".arena-start-date-filter", "gap", "var(--ui-control-group-gap)", "clamp(5px, 0.8vw, 10px)"],
  [".arena-start-date-filter", "border-radius", "var(--ui-control-group-radius)", "var(--control-group-radius, var(--radius-md))"],
  [".arena-start-date-filter", "padding", "var(--ui-control-group-padding)", "var(--control-group-padding, 6px)"],
  [".arena-modal-close-button", "width", "var(--ui-icon-button-size)", "100%"],
  [".arena-modal-close-button", "min-width", "var(--ui-icon-button-size)", "132px"],
  [".arena-modal-close-button", "height", "var(--ui-icon-button-size)", "auto"],
  [".arena-modal-close-button", "min-height", "var(--ui-icon-button-size)", "var(--ui-button-height)"],
  [".arena-modal-close-button", "display", "inline-grid", "inline-flex"],
  [".arena-filter-select select", "min-height", "var(--ui-button-height)", "42px"],
  [".arena-filter-select select", "font-size", "max(0.9rem, 16px)", "12px"],
  [".om-calendar-filter-bar select", "border", "1px solid var(--ui-control-border)", "var(--ui-button-border-width) solid var(--ui-button-border)"],
  [".om-calendar-filter-bar select", "border-radius", "var(--ui-control-radius)", "var(--ui-button-radius)"],
  [".om-calendar-filter-bar select", "color", "var(--rb-text)", "var(--ui-button-color)"],
  [".om-calendar-filter-bar select", "font-size", "max(0.9rem, 16px)", "var(--ui-button-font-size)"],
].map(([selector, property, globalValue, featureValue]) => (
  `||${selector}||${property}||${globalValue}=>${featureValue}`
)));

function listFiles(directory, result = []) {
  if (!fs.existsSync(directory)) return result;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) listFiles(entryPath, result);
    else result.push(entryPath);
  }
  return result;
}

function loadRuntimeSources() {
  const files = [
    ...runtimeRoots.flatMap((root) => listFiles(root)),
    ...runtimeFiles.filter((file) => fs.existsSync(file)),
  ].filter((file) => runtimeExtensions.has(path.extname(file)) && !file.endsWith(".test.mjs"));

  return files.map((file) => ({
    file,
    source: fs.readFileSync(file, "utf8"),
  }));
}

function collectStringLiteralSegments(source) {
  const result = [];

  function scanQuoted(start, quote) {
    let segment = "";
    let index = start + 1;
    while (index < source.length) {
      const character = source[index];
      if (character === "\\") {
        segment += character + (source[index + 1] ?? "");
        index += 2;
        continue;
      }
      if (character === quote) {
        result.push(segment);
        return index + 1;
      }
      if (quote === "`" && character === "$" && source[index + 1] === "{") {
        result.push(segment);
        segment = "";
        index = scanExpression(index + 2);
        continue;
      }
      segment += character;
      index += 1;
    }
    result.push(segment);
    return index;
  }

  function scanExpression(start) {
    let depth = 1;
    let index = start;
    while (index < source.length && depth > 0) {
      if (source[index] === "/" && source[index + 1] === "/") {
        const nextLine = source.indexOf("\n", index + 2);
        index = nextLine < 0 ? source.length : nextLine + 1;
        continue;
      }
      if (source[index] === "/" && source[index + 1] === "*") {
        const commentEnd = source.indexOf("*/", index + 2);
        index = commentEnd < 0 ? source.length : commentEnd + 2;
        continue;
      }
      if (source[index] === '"' || source[index] === "'" || source[index] === "`") {
        index = scanQuoted(index, source[index]);
        continue;
      }
      if (source[index] === "{") depth += 1;
      if (source[index] === "}") depth -= 1;
      index += 1;
    }
    return index;
  }

  let index = 0;
  while (index < source.length) {
    if (source[index] === "/" && source[index + 1] === "/") {
      const nextLine = source.indexOf("\n", index + 2);
      index = nextLine < 0 ? source.length : nextLine + 1;
      continue;
    }
    if (source[index] === "/" && source[index + 1] === "*") {
      const commentEnd = source.indexOf("*/", index + 2);
      index = commentEnd < 0 ? source.length : commentEnd + 2;
      continue;
    }
    if (source[index] === '"' || source[index] === "'" || source[index] === "`") {
      index = scanQuoted(index, source[index]);
      continue;
    }
    index += 1;
  }
  return result;
}

function parseCss(file) {
  return postcss.parse(fs.readFileSync(file, "utf8"), { from: file });
}

function resolveLocalCssImports(file, result = [], visiting = new Set()) {
  const normalizedFile = path.normalize(file);
  if (visiting.has(normalizedFile)) {
    throw new Error(`Circular CSS import: ${normalizedFile}`);
  }

  visiting.add(normalizedFile);
  const root = parseCss(normalizedFile);
  const imports = root.nodes.filter((node) => node.type === "atrule" && node.name === "import");

  if (!imports.length) {
    result.push(path.relative(".", normalizedFile).replaceAll("\\", "/"));
  } else {
    for (const importRule of imports) {
      const match = importRule.params.match(/^(?:url\()?["']([^"']+\.css)["']\)?$/);
      if (!match) throw new Error(`Unsupported CSS import in ${normalizedFile}: ${importRule.params}`);
      const importedFile = path.resolve(path.dirname(normalizedFile), match[1]);
      resolveLocalCssImports(importedFile, result, visiting);
    }
  }

  visiting.delete(normalizedFile);
  return result;
}

const globalCssFiles = resolveLocalCssImports(globalManifest);
const baseCssLoadStack = [
  "src/styles/tokens.css",
  ...globalCssFiles,
  "src/styles/ui-primitives.css",
];
const productionCssLoadStack = [
  ...baseCssLoadStack,
  ...idlePreloadFeatureCssFiles,
  "src/styles/matchroom-arena.css",
];
const cssFiles = [...new Set(productionCssLoadStack)];
const styleDirectoryCssFiles = fs.readdirSync("src/styles")
  .filter((file) => file.endsWith(".css"))
  .map((file) => `src/styles/${file}`)
  .sort();
const primitiveCssFile = "src/styles/ui-primitives.css";

function getAtRuleContext(rule) {
  const context = [];
  let parent = rule.parent;
  while (parent && parent.type !== "root") {
    if (parent.type === "atrule") context.unshift(`@${parent.name} ${parent.params}`);
    parent = parent.parent;
  }
  return context.join(" > ");
}

function normalizeSelector(selector) {
  try {
    return selectorParser().processSync(selector, { lossless: false });
  } catch {
    return selector.replace(/\s+/g, " ").trim();
  }
}

const runtimeSources = loadRuntimeSources();
const runtimeSource = runtimeSources.map(({ source }) => source).join("\n");
const runtimeClassTokens = new Set();
for (const { source } of runtimeSources) {
  for (const segment of collectStringLiteralSegments(source)) {
    for (const token of segment.split(/\s+/)) {
      if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(token)) runtimeClassTokens.add(token);
    }
  }
}
for (const match of runtimeSource.matchAll(/([A-Za-z_][A-Za-z0-9_-]*-)\$\{/g)) {
  runtimeClassPrefixes.add(match[1]);
}
for (const match of runtimeSource.matchAll(/([A-Za-z_][A-Za-z0-9_-]*-)\s*["'`]\s*\+/g)) {
  runtimeClassPrefixes.add(match[1]);
}

function isRuntimeClass(className) {
  return runtimeClassTokens.has(className)
    || [...runtimeClassPrefixes].some((prefix) => className.startsWith(prefix));
}

function collectUnusedSelectors(container, file, line, result) {
  for (const selector of container.nodes) {
    for (const node of selector.nodes) {
      if (node.type === "class" && !isRuntimeClass(node.value)) {
        if (!result.has(node.value)) result.set(node.value, []);
        result.get(node.value).push(`${file}:${line}`);
      }
      if (node.type === "pseudo" && node.nodes?.length && node.value !== ":not") {
        collectUnusedSelectors(node, file, line, result);
      }
    }
  }
}

test("all 19 production stylesheets are covered by the real load stack", () => {
  const mainSource = fs.readFileSync("src/main.jsx", "utf8");
  const appSource = fs.readFileSync("src/App.jsx", "utf8");
  const mainCssImports = [...mainSource.matchAll(/import\s+["'](\.\/styles\/[^"']+\.css)["'];/g)]
    .map((match) => `src/${match[1].replace("./", "")}`);
  const coveredCssFiles = [...new Set([globalManifest, ...productionCssLoadStack])].sort();

  assert.equal(styleDirectoryCssFiles.length, 19);
  assert.deepEqual(coveredCssFiles, styleDirectoryCssFiles);
  assert.deepEqual(mainCssImports, [
    "src/styles/tokens.css",
    globalManifest,
    "src/styles/ui-primitives.css",
  ]);
  assert.match(
    appSource,
    /preloadCoreAppRoutes\(\)[\s\S]*?import\("\.\/pages\/Matches\.jsx"\)[\s\S]*?import\("\.\/pages\/Recruiting\.jsx"\)[\s\S]*?import\("\.\/pages\/Recorder\.jsx"\)[\s\S]*?import\("\.\/pages\/Settings\.jsx"\)/,
  );
});

test("production CSS class usage is compared as exact runtime tokens", () => {
  const unusedSelectors = new Map();

  for (const file of cssFiles) {
    const root = parseCss(file);
    root.walkRules((rule) => {
      if (!rule.selector.includes(".")) return;
      try {
        selectorParser((selectorRoot) => {
          collectUnusedSelectors(selectorRoot, file, rule.source.start.line, unusedSelectors);
        }).processSync(rule.selector);
      } catch {
        // Future selector syntax remains covered by the CSS parser and production build.
      }
    });
  }

  const characterizedUnused = new Set([
    ...knownUnusedClassTokens,
    ...sharedBranchUnusedClassTokens,
  ]);
  const unusedClassTokens = [...unusedSelectors.keys()].sort();

  assert.deepEqual(unusedClassTokens, [...characterizedUnused].sort());
  assert.deepEqual(
    [...knownUnusedClassTokens].filter((className) => !unusedSelectors.has(className)),
    [],
  );
});

function collectLastDeclarations(files) {
  const declarations = new Map();

  for (const file of files) {
    const root = parseCss(file);
    root.walkRules((rule) => {
      for (const selector of rule.selectors ?? [rule.selector]) {
        const normalizedSelector = normalizeSelector(selector);
        rule.walkDecls((declaration) => {
          const key = `${getAtRuleContext(rule)}||${normalizedSelector}||${declaration.prop}`;
          declarations.set(key, {
            file,
            important: declaration.important,
            line: declaration.source.start.line,
            value: declaration.value,
          });
        });
      }
    });
  }

  return declarations;
}

test("global and feature selector ownership conflicts stay within the characterized baseline", () => {
  const globalDeclarations = collectLastDeclarations(globalCssFiles);
  const featureDeclarations = collectLastDeclarations(featureCssFiles);
  const importanceMismatches = [];
  const sameValueConflicts = [];
  const differentValueConflicts = [];

  for (const [key, globalDeclaration] of globalDeclarations) {
    const featureDeclaration = featureDeclarations.get(key);
    if (!featureDeclaration) continue;
    if (globalDeclaration.important !== featureDeclaration.important) {
      importanceMismatches.push(
        `${key}||important:${globalDeclaration.important}=>${featureDeclaration.important}`,
      );
      continue;
    }
    const signature = `${key}||${globalDeclaration.value}=>${featureDeclaration.value}`;
    if (globalDeclaration.value === featureDeclaration.value) sameValueConflicts.push(signature);
    else differentValueConflicts.push(signature);
  }

  const unexpectedConflicts = differentValueConflicts
    .filter((signature) => !crossStackDifferentValueBaseline.has(signature));

  assert.equal(
    sameValueConflicts.length <= crossStackSameValueBaseline,
    true,
    `same-value global/feature collisions (${sameValueConflicts.length}):\n${sameValueConflicts.join("\n")}`,
  );
  assert.deepEqual(importanceMismatches, []);
  assert.equal(differentValueConflicts.length <= crossStackDifferentValueBaseline.size, true);
  assert.deepEqual(unexpectedConflicts, []);
});

test("the combined production cascade has no behavior-changing fully shadowed rule", () => {
  const shadowedDeclarations = [];
  const ruleGroups = new Map();

  for (const file of productionCssLoadStack) {
    const root = parseCss(file);
    root.walkRules((rule) => {
      const key = `${getAtRuleContext(rule)}||${normalizeSelector(rule.selector)}`;
      if (!ruleGroups.has(key)) ruleGroups.set(key, []);
      ruleGroups.get(key).push({ file, rule });
    });
  }

  for (const rules of ruleGroups.values()) {
    if (rules.length < 2) continue;
    for (let index = 0; index < rules.length - 1; index += 1) {
      const earlierDeclarations = [];
      const laterDeclarations = [];
      rules[index].rule.walkDecls((declaration) => earlierDeclarations.push(declaration));
      for (let laterIndex = index + 1; laterIndex < rules.length; laterIndex += 1) {
        rules[laterIndex].rule.walkDecls((declaration) => laterDeclarations.push(declaration));
      }

      const fullyShadowed = earlierDeclarations.length > 0 && earlierDeclarations.every((declaration) => (
        laterDeclarations.some((later) => (
          later.prop === declaration.prop
          && later.value !== declaration.value
          && (!declaration.important || later.important)
        ))
      ));
      if (!fullyShadowed) continue;
      shadowedDeclarations.push(
        `${rules[index].file}:${rules[index].rule.source.start.line} ${rules[index].rule.selector}`,
      );
    }
  }

  assert.deepEqual(shadowedDeclarations, []);
});

test("individual stylesheets have no fully same-value shadowed rule", () => {
  const shadowedRules = [];

  for (const file of styleDirectoryCssFiles) {
    const rules = [];
    parseCss(file).walkRules((rule) => rules.push(rule));
    const laterDeclarations = new Map();

    for (let ruleIndex = rules.length - 1; ruleIndex >= 0; ruleIndex -= 1) {
      const rule = rules[ruleIndex];
      const selectors = (rule.selectors ?? [rule.selector]).map(normalizeSelector);
      const declarations = (rule.nodes ?? []).filter((node) => node.type === "decl");
      let fullyShadowed = declarations.length > 0;

      for (let declarationIndex = declarations.length - 1; declarationIndex >= 0; declarationIndex -= 1) {
        const declaration = declarations[declarationIndex];
        const value = `${declaration.value}||important:${declaration.important}`;
        const keys = selectors.map((selector) => (
          `${getAtRuleContext(rule)}||${selector}||${declaration.prop}`
        ));

        if (!keys.every((key) => laterDeclarations.get(key) === value)) fullyShadowed = false;
        for (const key of keys) {
          if (!laterDeclarations.has(key)) laterDeclarations.set(key, value);
        }
      }

      if (fullyShadowed) {
        shadowedRules.push(`${file}:${rule.source.start.line} ${rule.selector}`);
      }
    }
  }

  assert.deepEqual(shadowedRules, []);
});

test("home team summaries use one shared entity primitive", () => {
  const homeSource = fs.readFileSync("src/pages/Home.jsx", "utf8");
  const primitiveSource = fs.readFileSync(primitiveCssFile, "utf8");
  const legacySelectors = /(?:rivalry-card|home-my-teams-card|home-team-list|home-team-row|home-team-empty)/;

  assert.match(homeSource, /className="ui-entity-list(?:\s[^"]*)?"/);
  assert.match(homeSource, /className="ui-control ui-entity-row"/);
  assert.match(homeSource, /className="ui-entity-empty"/);
  assert.match(primitiveSource, /\.ui-entity-row\s*\{/);
  assert.match(primitiveSource, /\.ui-entity-empty\s*\{/);
  assert.doesNotMatch(homeSource, legacySelectors);

  for (const file of cssFiles) {
    assert.doesNotMatch(fs.readFileSync(file, "utf8"), legacySelectors, file);
  }
});

test("navigation actions use the shared polymorphic button without nested controls", () => {
  const buttonSource = fs.readFileSync("src/components/common/Button.jsx", "utf8");
  const navigationPages = [
    "src/pages/Home.jsx",
    "src/pages/Landing.jsx",
    "src/pages/Matches.jsx",
    "src/pages/Recruiting.jsx",
    "src/pages/Season.jsx",
  ];

  assert.match(buttonSource, /as:\s*Tag\s*=\s*"button"/);
  assert.match(buttonSource, /if\s*\(Tag\s*!==\s*"button"\)/);

  for (const file of navigationPages) {
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(source, /<Link\b[^>]*>\s*<Button\b/, file);
  }

  const jsxFiles = fs.readdirSync("src", { recursive: true })
    .filter((file) => file.endsWith(".jsx"))
    .map((file) => `src/${file.replaceAll("\\", "/")}`);

  for (const file of jsxFiles) {
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(source, /<(?:Link|a)\b[^>]*className="button\b/, file);
  }
});

test("shared empty-state surfaces have one primitive owner", () => {
  const primitiveSource = fs.readFileSync(primitiveCssFile, "utf8");
  const duplicateOwners = [];
  const protectedBranches = new Set([
    ".ui-empty-state",
    ".ui-empty-state-compact",
  ]);

  assert.match(primitiveSource, /\.ui-empty-state-compact\s*\{/);
  assert.match(primitiveSource, /\.ui-empty-state\s*\{/);

  for (const file of cssFiles.filter((file) => file !== primitiveCssFile)) {
    const root = parseCss(file);
    root.walkRules((rule) => {
      for (const selector of rule.selectors ?? [rule.selector]) {
        const normalized = normalizeSelector(selector);
        if (!protectedBranches.has(normalized)) continue;
        duplicateOwners.push(`${file}:${rule.source.start.line} ${normalized}`);
      }
    });
  }

  assert.deepEqual(duplicateOwners, []);
});

test("critical interactive branches keep a visible focus indicator", () => {
  const checks = [
    {
      files: globalCssFiles,
      selector: ".rank-home .rank-spotlight-card .rank-spotlight-links a:focus-visible",
    },
    {
      files: ["src/styles/recruiting-arena.css"],
      selector: ".arena-room-player-slot.self-action:focus-visible",
    },
  ];

  for (const { files, selector } of checks) {
    let lastRule = null;
    for (const file of files) {
      const root = parseCss(file);
      root.walkRules((rule) => {
        const matchingBranch = (rule.selectors ?? [rule.selector])
          .some((branch) => normalizeSelector(branch) === selector);
        if (matchingBranch) lastRule = rule;
      });
    }

    assert.ok(lastRule, `${selector} focus rule is required`);
    const declarations = new Map();
    lastRule.walkDecls((declaration) => declarations.set(declaration.prop, declaration.value));
    assert.doesNotMatch(declarations.get("outline") ?? "", /^(?:0|none)$/);
    assert.notEqual(declarations.get("box-shadow"), "none");
  }

  for (const file of cssFiles) {
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(source, /outline:\s*var\(--focus-ring\)/, file);
  }
  assert.doesNotMatch(
    fs.readFileSync("src/styles/global-visual-system.css", "utf8"),
    /box-shadow:\s*none\s*!important/,
  );
});

test("globals.css is an import-only manifest with bounded modules", () => {
  const manifestRoot = parseCss(globalManifest);
  const nonImportNodes = manifestRoot.nodes.filter((node) => (
    node.type !== "comment"
    && !(node.type === "atrule" && node.name === "import")
  ));

  assert.deepEqual(nonImportNodes, []);
  assert.ok(globalCssFiles.length >= 2);

  for (const file of globalCssFiles) {
    const lineCount = fs.readFileSync(file, "utf8").split(/\r?\n/).length;
    assert.ok(
      lineCount <= globalModuleMaxLines,
      `${file} exceeds ${globalModuleMaxLines} lines (${lineCount})`,
    );
  }
});

test("global modules use spacing tokens for canonical gaps", () => {
  const rawGaps = [];
  const canonicalGapPattern = /(?<![\w.-])(?:2|4|6|8|10|12|14|16|18|20|22|24|28|32|48)px(?![\w-])/;

  for (const file of globalCssFiles) {
    const root = parseCss(file);
    root.walkDecls(/^(?:gap|row-gap|column-gap)$/, (declaration) => {
      if (!canonicalGapPattern.test(declaration.value)) return;
      rawGaps.push(`${file}:${declaration.source.start.line} ${declaration.toString()}`);
    });
  }

  assert.deepEqual(rawGaps, []);
});

test("default and functional panel typography use shared body tokens", () => {
  const tokenRoot = parseCss("src/styles/tokens.css");
  const foundationRoot = parseCss("src/styles/global-foundation.css");
  const primitiveRoot = parseCss("src/styles/ui-primitives.css");
  const recruitingSource = fs.readFileSync("src/pages/Recruiting.jsx", "utf8");
  const declarations = new Map();

  for (const [name, root] of [
    ["tokens", tokenRoot],
    ["foundation", foundationRoot],
    ["primitives", primitiveRoot],
  ]) {
    root.walkDecls((declaration) => {
      declarations.set(`${name}:${declaration.prop}:${declaration.parent.selector ?? ""}`, declaration.value);
    });
  }

  assert.ok(
    [...declarations.entries()].some(([key]) => key.startsWith("tokens:--font-body::root")),
    "--font-body token is required",
  );
  assert.equal(declarations.get("foundation:font-family:body"), "var(--font-body)");
  const panelTypographyFamily = [...declarations.entries()].find(([key]) => (
    key.startsWith("primitives:font-family:")
    && key.includes(".ui-panel-title")
    && key.includes(".ui-panel-copy")
  ))?.[1];
  assert.equal(panelTypographyFamily, "var(--font-body)");
  assert.match(
    recruitingSource,
    /<strong className="ui-panel-title">경기 기록판<\/strong>/,
  );
  assert.match(
    recruitingSource,
    /<span className="ui-panel-copy">경기 기록에서는 점수와 선수 기록을 먼저 확인합니다\.<\/span>/,
  );
});

test("light theme reserves green for semantic status only", () => {
  const violations = [];
  const semanticGreenSelector = /(?:\.ready\b|\.text-positive\b|\.badge\.green\b|\.tag\.green\b)/;
  const mintValue = /(?:var\(--(?:rb-)?green\)|rgba?\(\s*(?:15\s*,\s*159\s*,\s*126|25\s*,\s*148\s*,\s*119|33\s*,\s*138\s*,\s*95|65\s*,\s*217\s*,\s*159|67\s*,\s*236\s*,\s*214|70\s*,\s*224\s*,\s*182|88\s*,\s*210\s*,\s*192|213\s*,\s*250\s*,\s*241|232\s*,\s*240\s*,\s*236|238\s*,\s*249\s*,\s*244|239\s*,\s*249\s*,\s*245|245\s*,\s*250\s*,\s*247|246\s*,\s*252\s*,\s*249|247\s*,\s*253\s*,\s*250|249\s*,\s*253\s*,\s*251))/i;

  for (const file of cssFiles) {
    const root = parseCss(file);
    root.walkRules((rule) => {
      if (!rule.selector.includes('html[data-theme="light"]')) return;
      const hasNonSemanticBranch = rule.selectors.some((selector) => !semanticGreenSelector.test(selector));
      if (!hasNonSemanticBranch) return;

      rule.walkDecls((declaration) => {
        if (!mintValue.test(declaration.value)) return;
        violations.push(`${file}:${declaration.source.start.line} ${rule.selector} ${declaration.prop}`);
      });
    });
  }

  assert.deepEqual(violations, []);
});

test("mobile Safari first paint uses the app theme and never flashes the static OAuth copy", () => {
  const indexSource = fs.readFileSync("index.html", "utf8");
  const appSource = fs.readFileSync("src/App.jsx", "utf8");
  const foundationSource = fs.readFileSync("src/styles/global-foundation.css", "utf8");
  const visualSource = fs.readFileSync("src/styles/global-visual-system.css", "utf8");

  assert.match(indexSource, /viewport-fit=cover/);
  assert.match(indexSource, /id="app-theme-color"/);
  assert.match(indexSource, /<div id="root"><\/div>\s*<noscript>/);
  assert.match(indexSource, /rankball\.auth\.profileCache\.v2/);
  assert.match(appSource, /getElementById\("app-theme-color"\)/);
  assert.match(foundationSource, /#root\s*\{[^}]*min-height:\s*100dvh/s);
  assert.match(visualSource, /env\(safe-area-inset-top,\s*0px\)/);
  assert.match(visualSource, /env\(safe-area-inset-bottom,\s*0px\)/);
});
