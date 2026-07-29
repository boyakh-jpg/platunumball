import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";

const globalManifest = "src/styles/globals.css";
const featureCssFiles = [
  "src/styles/recruiting-arena.css",
  "src/styles/matches-arena.css",
  "src/styles/matchroom-arena.css",
];
const globalModuleMaxLines = 4500;

const runtimeRoots = ["src", "public"];
const runtimeFiles = ["index.html", "privacy.html", "terms.html"];
const runtimeExtensions = new Set([".html", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const runtimeClassPrefixes = new Set(["gm-", "leaflet-", "maplibregl-", "naver-"]);

function listFiles(directory, result = []) {
  if (!fs.existsSync(directory)) return result;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) listFiles(entryPath, result);
    else result.push(entryPath);
  }
  return result;
}

function loadRuntimeSource() {
  const files = [
    ...runtimeRoots.flatMap((root) => listFiles(root)),
    ...runtimeFiles.filter((file) => fs.existsSync(file)),
  ].filter((file) => runtimeExtensions.has(path.extname(file)) && !file.endsWith(".test.mjs"));

  return files.map((file) => fs.readFileSync(file, "utf8")).join("\n");
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
    result.push(normalizedFile);
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
const cssStacks = [
  globalCssFiles,
  ...featureCssFiles.map((file) => [file]),
];
const cssFiles = [...new Set(cssStacks.flat())];
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

const runtimeSource = loadRuntimeSource();
for (const match of runtimeSource.matchAll(/([A-Za-z_][A-Za-z0-9_-]*-)\$\{/g)) {
  runtimeClassPrefixes.add(match[1]);
}
for (const match of runtimeSource.matchAll(/([A-Za-z_][A-Za-z0-9_-]*-)\s*["'`]\s*\+/g)) {
  runtimeClassPrefixes.add(match[1]);
}

function isRuntimeClass(className) {
  return runtimeSource.includes(className)
    || [...runtimeClassPrefixes].some((prefix) => className.startsWith(prefix));
}

function collectUnusedSelectors(container, file, line, result) {
  for (const selector of container.nodes) {
    for (const node of selector.nodes) {
      if (node.type === "class" && !isRuntimeClass(node.value)) {
        result.push(`${file}:${line} .${node.value}`);
      }
      if (node.type === "pseudo" && node.nodes?.length && node.value !== ":not") {
        collectUnusedSelectors(node, file, line, result);
      }
    }
  }
}

test("production CSS has no unused selector branches", () => {
  const unusedSelectors = [];

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

  assert.deepEqual(unusedSelectors, []);
});

test("later duplicate selectors do not fully shadow earlier declarations", () => {
  const shadowedDeclarations = [];

  for (const stack of cssStacks) {
    const ruleGroups = new Map();

    for (const file of stack) {
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
        const laterDeclarations = [];
        for (let laterIndex = index + 1; laterIndex < rules.length; laterIndex += 1) {
          rules[laterIndex].rule.walkDecls((declaration) => laterDeclarations.push(declaration));
        }

        rules[index].rule.walkDecls((declaration) => {
          const overridden = laterDeclarations.some((later) => (
            later.prop === declaration.prop
            && (!declaration.important || later.important)
          ));
          if (!overridden) return;
          shadowedDeclarations.push(
            `${rules[index].file}:${declaration.source.start.line} `
              + `${rules[index].rule.selector} ${declaration.prop}`,
          );
        });
      }
    }
  }

  assert.deepEqual(shadowedDeclarations, []);
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

  for (const file of cssFiles) {
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
    /<span className="ui-panel-copy">기록방은 점수와 선수 기록을 먼저 확인합니다\.<\/span>/,
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
