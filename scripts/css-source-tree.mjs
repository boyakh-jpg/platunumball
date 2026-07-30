import fs from "node:fs";
import path from "node:path";

const IMPORT_PATTERN = /@import\s+["']([^"']+\.css)["'];/g;

export function readCssTreeSync(file, visiting = new Set()) {
  const normalizedFile = path.resolve(file);
  if (visiting.has(normalizedFile)) throw new Error(`Circular CSS import: ${normalizedFile}`);
  visiting.add(normalizedFile);
  const source = fs.readFileSync(normalizedFile, "utf8");
  const imports = [...source.matchAll(IMPORT_PATTERN)];
  const result = imports.length
    ? imports.map((match) => (
      readCssTreeSync(path.resolve(path.dirname(normalizedFile), match[1]), visiting)
    )).join("\n")
    : source;
  visiting.delete(normalizedFile);
  return result;
}

export async function readCssTree(file, visiting = new Set()) {
  const normalizedFile = path.resolve(file);
  if (visiting.has(normalizedFile)) throw new Error(`Circular CSS import: ${normalizedFile}`);
  visiting.add(normalizedFile);
  const source = await fs.promises.readFile(normalizedFile, "utf8");
  const imports = [...source.matchAll(IMPORT_PATTERN)];
  const result = imports.length
    ? (await Promise.all(imports.map((match) => (
      readCssTree(path.resolve(path.dirname(normalizedFile), match[1]), new Set(visiting))
    )))).join("\n")
    : source;
  visiting.delete(normalizedFile);
  return result;
}
