import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";

const cssFiles = [
  "src/styles/globals.css",
  "src/styles/recruiting-arena.css",
  "src/styles/matches-arena.css",
  "src/styles/matchroom-arena.css",
];

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
    const root = postcss.parse(fs.readFileSync(file, "utf8"), { from: file });
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

  for (const file of cssFiles) {
    const root = postcss.parse(fs.readFileSync(file, "utf8"), { from: file });
    const ruleGroups = new Map();

    root.walkRules((rule) => {
      const key = `${getAtRuleContext(rule)}||${normalizeSelector(rule.selector)}`;
      if (!ruleGroups.has(key)) ruleGroups.set(key, []);
      ruleGroups.get(key).push(rule);
    });

    for (const rules of ruleGroups.values()) {
      if (rules.length < 2) continue;
      for (let index = 0; index < rules.length - 1; index += 1) {
        const laterDeclarations = [];
        for (let laterIndex = index + 1; laterIndex < rules.length; laterIndex += 1) {
          rules[laterIndex].walkDecls((declaration) => laterDeclarations.push(declaration));
        }

        rules[index].walkDecls((declaration) => {
          const overridden = laterDeclarations.some((later) => (
            later.prop === declaration.prop
            && (!declaration.important || later.important)
          ));
          if (!overridden) return;
          shadowedDeclarations.push(
            `${file}:${declaration.source.start.line} ${rules[index].selector} ${declaration.prop}`,
          );
        });
      }
    }
  }

  assert.deepEqual(shadowedDeclarations, []);
});
