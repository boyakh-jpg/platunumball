import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";

const styleDirectory = "src/styles";
const globalManifest = `${styleDirectory}/globals.css`;
const featureManifests = [
  `${styleDirectory}/match-clock.css`,
  `${styleDirectory}/match-attendance.css`,
  `${styleDirectory}/recruiting-arena.css`,
  `${styleDirectory}/matches-arena.css`,
  `${styleDirectory}/match-list-card.css`,
  `${styleDirectory}/matchroom-arena.css`,
];

function listCssFiles(directory, result = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) listCssFiles(entryPath, result);
    else if (entry.name.endsWith(".css")) {
      result.push(path.relative(".", entryPath).replaceAll("\\", "/"));
    }
  }
  return result;
}

function parseCss(file) {
  return postcss.parse(fs.readFileSync(file, "utf8"), { from: file });
}

function normalizeSelector(selector) {
  try {
    return selectorParser().processSync(selector, { lossless: false });
  } catch {
    return selector.replace(/\s+/g, " ").trim();
  }
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

function resolveImports(file, result = [], visiting = new Set()) {
  const normalizedFile = path.normalize(file);
  if (visiting.has(normalizedFile)) throw new Error(`Circular CSS import: ${normalizedFile}`);
  visiting.add(normalizedFile);
  const imports = parseCss(normalizedFile).nodes.filter(
    (node) => node.type === "atrule" && node.name === "import",
  );
  if (!imports.length) {
    result.push(path.relative(".", normalizedFile).replaceAll("\\", "/"));
  } else {
    for (const importRule of imports) {
      const match = importRule.params.match(/^(?:url\()?["']([^"']+\.css)["']\)?$/);
      if (!match) throw new Error(`Unsupported CSS import: ${importRule.params}`);
      resolveImports(path.resolve(path.dirname(normalizedFile), match[1]), result, visiting);
    }
  }
  visiting.delete(normalizedFile);
  return result;
}

function collectLastDeclarations(files) {
  const declarations = new Map();
  for (const file of files) {
    parseCss(file).walkRules((rule) => {
      for (const selector of rule.selectors ?? [rule.selector]) {
        const normalizedSelector = normalizeSelector(selector);
        for (const declaration of rule.nodes ?? []) {
          if (declaration.type !== "decl") continue;
          const key = `${getAtRuleContext(rule)}||${normalizedSelector}||${declaration.prop}`;
          declarations.set(key, {
            file,
            line: declaration.source.start.line,
            value: declaration.value,
            important: declaration.important,
          });
        }
      }
    });
  }
  return declarations;
}

function collectSameFilePartialDuplicates(files) {
  const duplicates = [];
  for (const file of files) {
    const seenLater = new Map();
    const rules = [];
    parseCss(file).walkRules((rule) => rules.push(rule));
    for (let ruleIndex = rules.length - 1; ruleIndex >= 0; ruleIndex -= 1) {
      const rule = rules[ruleIndex];
      const selectors = (rule.selectors ?? [rule.selector]).map(normalizeSelector);
      const declarations = (rule.nodes ?? []).filter((node) => node.type === "decl");
      const redundant = [];
      for (let index = declarations.length - 1; index >= 0; index -= 1) {
        const declaration = declarations[index];
        const value = `${declaration.value}||important:${declaration.important}`;
        const keys = selectors.map(
          (selector) => `${getAtRuleContext(rule)}||${selector}||${declaration.prop}`,
        );
        if (keys.every((key) => seenLater.get(key)?.value === value)) {
          redundant.push({
            prop: declaration.prop,
            value: declaration.value,
            later: [...new Set(keys.map((key) => seenLater.get(key).location))],
          });
        }
        for (const key of keys) {
          if (!seenLater.has(key)) {
            seenLater.set(key, {
              location: `${file}:${declaration.source.start.line}`,
              value,
            });
          }
        }
      }
      if (redundant.length && redundant.length < declarations.length) {
        duplicates.push({
          file,
          line: rule.source.start.line,
          selector: rule.selector,
          redundant,
        });
      }
    }
  }
  return duplicates;
}

function countLiteralBorders(files) {
  const matches = [];
  const borderProperty = /^border(?:-(?:top|right|bottom|left|inline|block))?(?:-(?:width|style|color))?$/;
  for (const file of files) {
    parseCss(file).walkDecls((declaration) => {
      if (!borderProperty.test(declaration.prop)) return;
      if (!/(?:^|\s)(?:1px|2px)(?:\s|$)/.test(declaration.value)) return;
      matches.push(`${file}:${declaration.source.start.line} ${declaration.toString()}`);
    });
  }
  return matches;
}

function collectRedundantDeclarationsInLoadOrder(files, allowedFiles) {
  const redundant = [];
  const seen = new Map();
  for (const file of files) {
    parseCss(file).walkRules((rule) => {
      const selectors = (rule.selectors ?? [rule.selector]).map(normalizeSelector);
      for (const declaration of rule.nodes ?? []) {
        if (declaration.type !== "decl") continue;
        const value = `${declaration.value}||important:${declaration.important}`;
        const keys = selectors.map(
          (selector) => `${getAtRuleContext(rule)}||${selector}||${declaration.prop}`,
        );
        if (
          allowedFiles.has(file)
          && keys.length
          && keys.every((key) => seen.get(key)?.value === value)
        ) {
          redundant.push({
            file,
            line: declaration.source.start.line,
            selector: rule.selector,
            prop: declaration.prop,
            value: declaration.value,
            previous: [...new Set(keys.map((key) => seen.get(key).location))],
          });
        }
        for (const key of keys) {
          seen.set(key, {
            location: `${file}:${declaration.source.start.line}`,
            value,
          });
        }
      }
    });
  }
  return redundant;
}

const allFiles = listCssFiles(styleDirectory).sort();
const globalFiles = resolveImports(globalManifest);
const featureFiles = featureManifests.flatMap((file) => resolveImports(file));
const globalLast = collectLastDeclarations(globalFiles);
const featureLast = collectLastDeclarations(featureFiles);
const sameValueCrossStack = [];
const differentValueCrossStack = [];
const importanceCrossStack = [];

for (const [key, globalDeclaration] of globalLast) {
  const featureDeclaration = featureLast.get(key);
  if (!featureDeclaration) continue;
  const detail = {
    key,
    global: globalDeclaration,
    feature: featureDeclaration,
  };
  if (globalDeclaration.important !== featureDeclaration.important) {
    importanceCrossStack.push(detail);
  } else if (globalDeclaration.value === featureDeclaration.value) {
    sameValueCrossStack.push(detail);
  } else {
    differentValueCrossStack.push(detail);
  }
}

const sameFilePartial = collectSameFilePartialDuplicates(allFiles);
const important = [];
const globalTokenDeclarationsOutsideTokens = [];
for (const file of allFiles) {
  const root = parseCss(file);
  root.walkDecls((declaration) => {
    if (declaration.important) {
      important.push(`${file}:${declaration.source.start.line} ${declaration.toString()}`);
    }
  });
  if (file === `${styleDirectory}/tokens.css`) continue;
  root.walkRules((rule) => {
    const ownsGlobalScope = (rule.selectors ?? [rule.selector]).some((selector) => (
      /^(?::root|html(?:\[[^\]]+\])?|body(?:\[[^\]]+\])?)$/.test(normalizeSelector(selector))
    ));
    if (!ownsGlobalScope) return;
    rule.walkDecls(/^--/, (declaration) => {
      globalTokenDeclarationsOutsideTokens.push(
        `${file}:${declaration.source.start.line} ${rule.selector} ${declaration.prop}`,
      );
    });
  });
}
const literalBorders = countLiteralBorders(allFiles);
const productionLoadOrder = [
  `${styleDirectory}/tokens.css`,
  ...globalFiles,
  `${styleDirectory}/ui-primitives.css`,
  ...featureFiles,
];
const loadOrderFeatureDuplicates = collectRedundantDeclarationsInLoadOrder(
  productionLoadOrder,
  new Set(featureFiles),
);
const loadOrderSameValueDuplicates = collectRedundantDeclarationsInLoadOrder(
  productionLoadOrder,
  new Set(productionLoadOrder),
);
const metrics = {
  cssFiles: allFiles.length,
  cssBytes: allFiles.reduce((total, file) => total + fs.statSync(file).size, 0),
  cssLines: allFiles.reduce(
    (total, file) => total + fs.readFileSync(file, "utf8").split(/\r?\n/).length,
    0,
  ),
  sameFilePartialRules: sameFilePartial.length,
  sameFilePartialDeclarations: sameFilePartial.reduce(
    (total, duplicate) => total + duplicate.redundant.length,
    0,
  ),
  crossStackSameValue: sameValueCrossStack.length,
  crossStackDifferentValue: differentValueCrossStack.length,
  crossStackImportanceMismatch: importanceCrossStack.length,
  importantDeclarations: important.length,
  literalBorderDeclarations: literalBorders.length,
  loadOrderFeatureSameValueDeclarations: loadOrderFeatureDuplicates.length,
  globalTokenDeclarationsOutsideTokens: globalTokenDeclarationsOutsideTokens.length,
  loadOrderSameValueDeclarations: loadOrderSameValueDuplicates.length,
};

const details = process.argv.includes("--details");
const bins = process.argv.includes("--bins");
if (bins) {
  const targetFiles = process.argv
    .filter((argument) => argument.endsWith(".css"))
    .map((argument) => argument.replaceAll("\\", "/"));
  const files = targetFiles.length ? targetFiles : allFiles;
  for (const file of files) {
    const sourceLines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    const binSize = 250;
    console.log(`\n# ${file}`);
    for (let start = 1; start <= sourceLines.length; start += binSize) {
      const end = Math.min(start + binSize - 1, sourceLines.length);
      const classCounts = new Map();
      const atRules = new Set();
      parseCss(file).walkRules((rule) => {
        const line = rule.source.start.line;
        if (line < start || line > end) return;
        for (const selector of rule.selectors ?? [rule.selector]) {
          for (const match of selector.matchAll(/\.([a-z][a-z0-9_-]*)/gi)) {
            const className = match[1];
            const prefix = className.split("-").slice(0, 2).join("-");
            classCounts.set(prefix, (classCounts.get(prefix) ?? 0) + 1);
          }
        }
        const context = getAtRuleContext(rule);
        if (context) atRules.add(context);
      });
      const topClasses = [...classCounts.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 8)
        .map(([name, count]) => `${name}:${count}`)
        .join(", ");
      console.log(`${start}-${end} | ${topClasses || "(no classes)"} | ${[...atRules].join(" ; ")}`);
    }
  }
} else if (details) {
  console.log(JSON.stringify({
    metrics,
    loadOrder: [
      ...productionLoadOrder,
    ],
    sameFilePartial,
    sameValueCrossStack,
    differentValueCrossStack,
    importanceCrossStack,
    important,
    literalBorders,
    loadOrderFeatureDuplicates,
    globalTokenDeclarationsOutsideTokens,
    loadOrderSameValueDuplicates,
  }, null, 2));
} else {
  console.log(JSON.stringify(metrics, null, 2));
}
