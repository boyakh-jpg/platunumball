import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";
import {
  RECRUITING_PAGE_SOURCE_PATHS,
  readSourceGroupSync,
} from "./management-source-groups.mjs";

const globalManifest = "src/styles/globals.css";
const featureCssManifests = [
  "src/styles/match-clock.css",
  "src/styles/match-attendance.css",
  "src/styles/recruiting-arena.css",
  "src/styles/matches-arena.css",
  "src/styles/match-list-card.css",
  "src/styles/matchroom-arena.css",
];
const globalModuleMaxLines = 4500;
const crossStackSameValueBaseline = 0;

const runtimeRoots = ["src", "public"];
const runtimeFiles = ["index.html", "privacy.html", "terms.html"];
const runtimeExtensions = new Set([".html", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const runtimeClassPrefixes = new Set(["gm-", "leaflet-", "maplibregl-", "naver-"]);
const knownUnusedClassTokens = new Set();
const sharedBranchUnusedClassTokens = new Set([
  "tag",
  "winner",
]);

const crossStackDifferentValueBaseline = new Set();

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
const featureCssFiles = featureCssManifests.flatMap((file) => resolveLocalCssImports(file));
const idlePreloadFeatureCssFiles = featureCssFiles.filter(
  (file) => file !== "src/styles/matchroom-arena.css",
);
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
const styleDirectoryCssFiles = listFiles("src/styles")
  .filter((file) => file.endsWith(".css"))
  .map((file) => file.replaceAll("\\", "/"))
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
  const compactSelector = String(selector || "").replace(/\s+/g, " ").trim();
  try {
    return selectorParser()
      .processSync(compactSelector, { lossless: false })
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return compactSelector;
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

function normalizeDeclarationValue(value) {
  return String(value || "").replace(/\r\n?/g, "\n");
}

function collectLocalCssImportGraph(file, result = new Set(), visiting = new Set()) {
  const normalizedFile = path.normalize(file);
  if (visiting.has(normalizedFile)) {
    throw new Error(`Circular CSS import: ${normalizedFile}`);
  }
  visiting.add(normalizedFile);
  result.add(path.relative(".", normalizedFile).replaceAll("\\", "/"));
  const root = parseCss(normalizedFile);
  for (const importRule of root.nodes.filter(
    (node) => node.type === "atrule" && node.name === "import",
  )) {
    const match = importRule.params.match(/^(?:url\()?["']([^"']+\.css)["']\)?$/);
    if (!match) throw new Error(`Unsupported CSS import in ${normalizedFile}: ${importRule.params}`);
    collectLocalCssImportGraph(
      path.resolve(path.dirname(normalizedFile), match[1]),
      result,
      visiting,
    );
  }
  visiting.delete(normalizedFile);
  return result;
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

test("all production stylesheets are covered by the real load stack", () => {
  const mainSource = fs.readFileSync("src/main.jsx", "utf8");
  const appSource = fs.readFileSync("src/App.jsx", "utf8");
  const mainCssImports = [...mainSource.matchAll(/import\s+["'](\.\/styles\/[^"']+\.css)["'];/g)]
    .map((match) => `src/${match[1].replace("./", "")}`);
  const coveredCssFiles = [...new Set([
    "src/styles/tokens.css",
    "src/styles/ui-primitives.css",
    ...collectLocalCssImportGraph(globalManifest),
    ...featureCssManifests.flatMap((file) => [...collectLocalCssImportGraph(file)]),
  ])].sort();

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
            value: normalizeDeclarationValue(declaration.value),
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

test("the production load order has no redundant same-value declaration", () => {
  const redundantDeclarations = [];
  const seen = new Map();

  for (const file of productionCssLoadStack) {
    const root = parseCss(file);
    root.walkRules((rule) => {
      const selectors = (rule.selectors ?? [rule.selector]).map(normalizeSelector);
      for (const declaration of (rule.nodes ?? []).filter((node) => node.type === "decl")) {
        const value = `${normalizeDeclarationValue(declaration.value)}||important:${declaration.important}`;
        const keys = selectors.map(
          (selector) => `${getAtRuleContext(rule)}||${selector}||${declaration.prop}`,
        );
        if (keys.length && keys.every((key) => seen.get(key) === value)) {
          redundantDeclarations.push(
            `${file}:${declaration.source.start.line} ${rule.selector} ${declaration.prop}`,
          );
        }
        keys.forEach((key) => seen.set(key, value));
      }
    });
  }

  assert.deepEqual(redundantDeclarations, []);
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
          && normalizeDeclarationValue(later.value) !== normalizeDeclarationValue(declaration.value)
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
        const value = `${normalizeDeclarationValue(declaration.value)}||important:${declaration.important}`;
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

test("individual stylesheets have no partial same-value shadowed declaration", () => {
  const shadowedDeclarations = [];

  for (const file of styleDirectoryCssFiles) {
    const rules = [];
    parseCss(file).walkRules((rule) => rules.push(rule));
    const laterDeclarations = new Map();

    for (let ruleIndex = rules.length - 1; ruleIndex >= 0; ruleIndex -= 1) {
      const rule = rules[ruleIndex];
      const selectors = (rule.selectors ?? [rule.selector]).map(normalizeSelector);
      const declarations = (rule.nodes ?? []).filter((node) => node.type === "decl");

      for (let declarationIndex = declarations.length - 1; declarationIndex >= 0; declarationIndex -= 1) {
        const declaration = declarations[declarationIndex];
        const value = `${normalizeDeclarationValue(declaration.value)}||important:${declaration.important}`;
        const keys = selectors.map((selector) => (
          `${getAtRuleContext(rule)}||${selector}||${declaration.prop}`
        ));
        if (keys.length && keys.every((key) => laterDeclarations.get(key) === value)) {
          shadowedDeclarations.push(
            `${file}:${declaration.source.start.line} ${rule.selector} ${declaration.prop}`,
          );
        }
        for (const key of keys) {
          if (!laterDeclarations.has(key)) laterDeclarations.set(key, value);
        }
      }
    }
  }

  assert.deepEqual(shadowedDeclarations, []);
});

test("home team summaries use one shared entity primitive", () => {
  const homeSource = [
    fs.readFileSync("src/pages/Home.jsx", "utf8"),
    fs.readFileSync("src/pages/HomePageView.jsx", "utf8"),
    fs.readFileSync("src/components/home/HomeRightRail.jsx", "utf8"),
  ].join("\n");
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
    "src/pages/HomePageView.jsx",
    "src/pages/Landing.jsx",
    "src/pages/Matches.jsx",
    "src/pages/MatchesPageView.jsx",
    "src/pages/Recruiting.jsx",
    "src/pages/RecruitingPageView.jsx",
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
      files: resolveLocalCssImports("src/styles/recruiting-arena.css"),
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
    resolveLocalCssImports("src/styles/global-visual-system.css")
      .map((file) => fs.readFileSync(file, "utf8"))
      .join("\n"),
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

test("large CSS entrypoints are ordered manifests over responsibility modules", () => {
  const expectedImports = new Map([
    ["src/styles/global-visual-system.css", [
      "./themes/global-sports-visual.css",
      "./primitives/global-interactions.css",
      "./responsive/global-home-responsive.css",
      "./features/global-profile-brand.css",
      "./layout/global-page-layout.css",
    ]],
    ["src/styles/global-search-profile.css", [
      "./features/search-profile.css",
      "./features/admin-profile.css",
      "./features/profile-emblems.css",
    ]],
    ["src/styles/global-workflows.css", [
      "./features/match-create-workflows.css",
      "./themes/landing-team-visual.css",
      "./features/settings-court-workflows.css",
      "./features/referee-report-workflows.css",
    ]],
    ["src/styles/matches-arena.css", [
      "./features/matches-tournament.css",
      "./themes/matches-arena-visual.css",
      "./responsive/matches-arena-responsive.css",
    ]],
    ["src/styles/recruiting-arena.css", [
      "./features/recruiting-room.css",
      "./themes/recruiting-arena-visual.css",
      "./layout/recruiting-arena-layout.css",
      "./responsive/recruiting-arena-responsive.css",
      "./themes/recruiting-slot-theme.css",
    ]],
  ]);

  for (const [manifest, expected] of expectedImports) {
    const root = parseCss(manifest);
    const imports = root.nodes
      .filter((node) => node.type === "atrule" && node.name === "import")
      .map((node) => node.params.replace(/^["']|["']$/g, ""));
    const nonManifestNodes = root.nodes.filter((node) => (
      node.type !== "comment"
      && !(node.type === "atrule" && node.name === "import")
    ));
    assert.deepEqual(imports, expected, manifest);
    assert.deepEqual(nonManifestNodes, [], manifest);
  }

  for (const directory of ["features", "layout", "primitives", "responsive", "themes"]) {
    const files = listFiles(`src/styles/${directory}`).filter((file) => file.endsWith(".css"));
    assert.ok(files.length > 0, `${directory} responsibility directory must own CSS`);
  }

  for (const file of [...globalCssFiles, ...featureCssFiles]) {
    const lineCount = fs.readFileSync(file, "utf8").split(/\r?\n/).length;
    assert.ok(lineCount <= 2800, `${file} exceeds the 2800-line module boundary`);
  }
});

test("tokens.css exclusively owns global custom properties and border widths", () => {
  const violations = [];
  const literalBorders = [];

  for (const file of styleDirectoryCssFiles) {
    const root = parseCss(file);
    if (file !== "src/styles/tokens.css") {
      root.walkRules((rule) => {
        const globalScope = (rule.selectors ?? [rule.selector]).some((selector) => (
          /^(?::root|html(?:\[[^\]]+\])?|body(?:\[[^\]]+\])?)$/.test(normalizeSelector(selector))
        ));
        if (!globalScope) return;
        rule.walkDecls(/^--/, (declaration) => {
          violations.push(`${file}:${declaration.source.start.line} ${declaration.prop}`);
        });
      });
    }

    root.walkDecls(
      /^border(?:-(?:top|right|bottom|left|inline|block))?(?:-(?:width|style|color))?$/,
      (declaration) => {
        if (/(?:^|\s)(?:1px|2px)(?:\s|$)/.test(declaration.value)) {
          literalBorders.push(`${file}:${declaration.source.start.line} ${declaration.toString()}`);
        }
      },
    );
  }

  const tokenSource = fs.readFileSync("src/styles/tokens.css", "utf8");
  assert.match(tokenSource, /--ui-stroke-width:\s*1px;/);
  assert.match(tokenSource, /--ui-stroke-width-strong:\s*2px;/);
  assert.deepEqual(violations, []);
  assert.deepEqual(literalBorders, []);
});

test("important is limited to inline-position and inline-layout overrides", () => {
  const violations = [];
  let declarationCount = 0;

  for (const file of styleDirectoryCssFiles) {
    parseCss(file).walkDecls((declaration) => {
      if (!declaration.important) return;
      declarationCount += 1;
      const rule = declaration.parent;
      const context = getAtRuleContext(rule);
      const selector = normalizeSelector(rule.selector);
      const allowedHoverPosition = (
        file === "src/styles/global-foundation.css"
        && context === "@media (hover: none), (pointer: coarse)"
        && selector.includes("span.player-hover-card.touch-open")
        && ["top", "left", "max-height"].includes(declaration.prop)
      );
      const allowedMobilePortal = (
        file === "src/styles/global-court-controls.css"
        && context === "@media (max-width: 1079px)"
        && selector === ".hover-portal-card.touch-open"
        && ["top", "bottom", "max-height"].includes(declaration.prop)
      );
      const allowedInlineFooter = (
        file === "src/styles/global-court-controls.css"
        && context === "@media (max-width: 520px)"
        && selector === ".naver-pin-picker-footer"
        && declaration.prop === "align-items"
      );
      if (!allowedHoverPosition && !allowedMobilePortal && !allowedInlineFooter) {
        violations.push(
          `${file}:${declaration.source.start.line} ${context} ${selector} ${declaration.prop}`,
        );
      }
    });
  }

  assert.equal(declarationCount, 7);
  assert.deepEqual(violations, []);
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
  const recruitingSource = readSourceGroupSync(
    (file) => fs.readFileSync(file, "utf8"),
    RECRUITING_PAGE_SOURCE_PATHS,
  );
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
  const visualSource = resolveLocalCssImports("src/styles/global-visual-system.css")
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");

  assert.match(indexSource, /viewport-fit=cover/);
  assert.match(indexSource, /id="app-theme-color"/);
  assert.match(indexSource, /<div id="root"><\/div>\s*<noscript>/);
  assert.match(indexSource, /rankball\.auth\.profileCache\.v2/);
  assert.match(appSource, /getElementById\("app-theme-color"\)/);
  assert.match(foundationSource, /#root\s*\{[^}]*min-height:\s*100dvh/s);
  assert.match(visualSource, /env\(safe-area-inset-top,\s*0px\)/);
  assert.match(visualSource, /env\(safe-area-inset-bottom,\s*0px\)/);
});
