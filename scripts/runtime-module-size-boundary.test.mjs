import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const RUNTIME_DIRECTORIES = ["src", "server", "shared"];
const MAX_RUNTIME_MODULE_LINES = 550;

async function listRuntimeModules(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return listRuntimeModules(target);
    if (!entry.isFile() || !/\.(?:js|jsx|mjs|cjs)$/u.test(entry.name)) return [];
    return [target];
  }));
  return nested.flat();
}

test("runtime JavaScript modules stay below the large-file boundary", async () => {
  const files = (await Promise.all(
    RUNTIME_DIRECTORIES.map((directory) => listRuntimeModules(path.join(ROOT, directory))),
  )).flat();
  const oversized = [];

  for (const file of files) {
    const source = await readFile(file, "utf8");
    const lineCount = source.split(/\r?\n/u).length;
    if (lineCount > MAX_RUNTIME_MODULE_LINES) {
      oversized.push(`${path.relative(ROOT, file)} (${lineCount})`);
    }
  }

  assert.deepEqual(
    oversized,
    [],
    `${MAX_RUNTIME_MODULE_LINES}줄을 넘는 런타임 모듈:\n${oversized.join("\n")}`,
  );
});
