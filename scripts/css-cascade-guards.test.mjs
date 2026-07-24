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
