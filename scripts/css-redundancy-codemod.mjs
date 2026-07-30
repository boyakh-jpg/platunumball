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
    else if (entry.name.endsWith(".css")) result.push(path.normalize(entryPath));
  }
  return result;
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

function resolveImports(file, roots, result = [], visiting = new Set()) {
  const normalizedFile = path.normalize(file);
  if (visiting.has(normalizedFile)) throw new Error(`Circular CSS import: ${normalizedFile}`);
  visiting.add(normalizedFile);
  const root = roots.get(normalizedFile) ?? postcss.parse(
    fs.readFileSync(normalizedFile, "utf8"),
    { from: normalizedFile },
  );
  const imports = root.nodes.filter(
    (node) => node.type === "atrule" && node.name === "import",
  );
  if (!imports.length) {
    result.push(path.relative(".", normalizedFile).replaceAll("\\", "/"));
  } else {
    for (const importRule of imports) {
      const match = importRule.params.match(/^(?:url\()?["']([^"']+\.css)["']\)?$/);
      if (!match) throw new Error(`Unsupported CSS import: ${importRule.params}`);
      resolveImports(path.resolve(path.dirname(normalizedFile), match[1]), roots, result, visiting);
    }
  }
  visiting.delete(normalizedFile);
  return result;
}

function declarationKeys(rule, declaration) {
  return (rule.selectors ?? [rule.selector]).map(
    (selector) => (
      `${getAtRuleContext(rule)}||${normalizeSelector(selector)}||${declaration.prop}`
    ),
  );
}

function cleanEmptyRules(root) {
  root.walkRules((rule) => {
    if ((rule.nodes ?? []).some((node) => node.type !== "comment")) return;
    rule.remove();
  });
}

const files = listCssFiles(styleDirectory);
const roots = new Map(
  files.map((file) => [
    file,
    postcss.parse(fs.readFileSync(file, "utf8"), { from: file }),
  ]),
);
const changedFiles = new Set();
const removals = {
  sameFile: [],
  loadOrderFeature: [],
  globalFeatureOwnership: [],
  literalBorderTokens: [],
};

for (const file of files) {
  const root = roots.get(file);
  const rules = [];
  root.walkRules((rule) => rules.push(rule));
  const seenLater = new Map();

  for (let ruleIndex = rules.length - 1; ruleIndex >= 0; ruleIndex -= 1) {
    const rule = rules[ruleIndex];
    const declarations = (rule.nodes ?? []).filter((node) => node.type === "decl");
    for (let index = declarations.length - 1; index >= 0; index -= 1) {
      const declaration = declarations[index];
      const value = `${declaration.value}||important:${declaration.important}`;
      const keys = declarationKeys(rule, declaration);
      if (keys.length && keys.every((key) => seenLater.get(key) === value)) {
        removals.sameFile.push(
          `${file}:${declaration.source.start.line} ${rule.selector} ${declaration.prop}`,
        );
        declaration.remove();
        changedFiles.add(file);
        continue;
      }
      for (const key of keys) {
        if (!seenLater.has(key)) seenLater.set(key, value);
      }
    }
  }
}

const globalFiles = resolveImports(globalManifest, roots);
const featureFiles = featureManifests.flatMap((file) => resolveImports(file, roots));
const primitiveFiles = resolveImports(`${styleDirectory}/ui-primitives.css`, roots);
const loadOrder = [
  `${styleDirectory}/tokens.css`,
  ...globalFiles,
  ...primitiveFiles,
  ...featureFiles,
].map(path.normalize);
const featureFileSet = new Set(featureFiles.map(path.normalize));
const seen = new Map();

for (const file of loadOrder) {
  const root = roots.get(file);
  if (!root) throw new Error(`Missing parsed stylesheet: ${file}`);
  root.walkRules((rule) => {
    for (const declaration of [...(rule.nodes ?? [])]) {
      if (declaration.type !== "decl") continue;
      const value = `${declaration.value}||important:${declaration.important}`;
      const keys = declarationKeys(rule, declaration);
      if (
        featureFileSet.has(file)
        && keys.length
        && keys.every((key) => seen.get(key) === value)
      ) {
        removals.loadOrderFeature.push(
          `${file}:${declaration.source.start.line} ${rule.selector} ${declaration.prop}`,
        );
        declaration.remove();
        changedFiles.add(file);
        continue;
      }
      for (const key of keys) seen.set(key, value);
    }
  });
}

const featureOwnedKeys = new Set();
for (const file of featureFileSet) {
  roots.get(file).walkRules((rule) => {
    for (const declaration of rule.nodes ?? []) {
      if (declaration.type !== "decl") continue;
      for (const key of declarationKeys(rule, declaration)) featureOwnedKeys.add(key);
    }
  });
}

const featureSelectorPattern = /\.(?:arena|om|gm|tournament)-/;
for (const file of globalFiles.map(path.normalize)) {
  const root = roots.get(file);
  root.walkRules((rule) => {
    const selectors = rule.selectors ?? [rule.selector];
    const normalizedSelectors = selectors.map(normalizeSelector);
    const extractedGroups = new Map();

    for (const declaration of [...(rule.nodes ?? [])]) {
      if (declaration.type !== "decl") continue;
      const context = getAtRuleContext(rule);
      const featureOwned = normalizedSelectors.map((selector) => (
        featureSelectorPattern.test(selector)
        && featureOwnedKeys.has(`${context}||${selector}||${declaration.prop}`)
      ));
      if (!featureOwned.some(Boolean)) continue;

      const keptSelectors = selectors.filter((_, index) => !featureOwned[index]);
      removals.globalFeatureOwnership.push(
        `${file}:${declaration.source.start.line} ${declaration.prop} -> `
        + normalizedSelectors.filter((_, index) => featureOwned[index]).join(", "),
      );
      declaration.remove();
      changedFiles.add(file);

      if (!keptSelectors.length) continue;
      const groupKey = keptSelectors.map(normalizeSelector).join(",");
      if (!extractedGroups.has(groupKey)) {
        extractedGroups.set(groupKey, {
          selectors: keptSelectors,
          declarations: [],
        });
      }
      extractedGroups.get(groupKey).declarations.push(declaration.clone());
    }

    let anchor = rule;
    for (const { selectors: keptSelectors, declarations } of extractedGroups.values()) {
      const extractedRule = rule.clone({
        selector: keptSelectors.join(",\n"),
        nodes: declarations,
      });
      anchor.after(extractedRule);
      anchor = extractedRule;
    }
  });
}

if (process.argv.includes("--normalize-borders")) {
  const borderProperty = /^border(?:-(?:top|right|bottom|left|inline|block))?(?:-(?:width|style|color))?$/;
  for (const [file, root] of roots) {
    root.walkDecls((declaration) => {
      if (!borderProperty.test(declaration.prop)) return;
      const value = declaration.value.replace(
        /(^|\s)(1px|2px)(?=\s|$)/g,
        (_, prefix, width) => (
          `${prefix}var(${width === "1px" ? "--ui-stroke-width" : "--ui-stroke-width-strong"})`
        ),
      );
      if (value === declaration.value) return;
      removals.literalBorderTokens.push(
        `${file}:${declaration.source.start.line} ${declaration.prop}`,
      );
      declaration.value = value;
      changedFiles.add(file);
    });
  }
}

for (const file of changedFiles) cleanEmptyRules(roots.get(file));

console.log(JSON.stringify({
  changedFiles: [...changedFiles].map((file) => file.replaceAll("\\", "/")),
  sameFileDeclarations: removals.sameFile.length,
  loadOrderFeatureDeclarations: removals.loadOrderFeature.length,
  globalFeatureOwnershipDeclarations: removals.globalFeatureOwnership.length,
  literalBorderTokenDeclarations: removals.literalBorderTokens.length,
}, null, 2));

if (process.argv.includes("--details")) {
  console.log(JSON.stringify(removals, null, 2));
}

if (process.argv.includes("--write")) {
  for (const file of changedFiles) {
    const original = fs.readFileSync(file, "utf8");
    const newline = original.includes("\r\n") ? "\r\n" : "\n";
    const output = roots.get(file).toString().replace(/\r?\n/g, newline);
    fs.writeFileSync(file, output);
  }
}
