import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, "$1"));
const MODULE_PATHS = [
  "src/lib/mockData.js",
  "src/lib/mockData/baseState.js",
  "src/lib/mockData/baseStateHelpers.js",
  "src/lib/mockData/baseDirectoryFixtures.js",
  "src/lib/mockData/baseActivityFixtures.js",
  "src/lib/mockData/matchGenerators.js",
  "src/lib/mockData/recruitingGenerators.js",
  "src/lib/mockData/stateFinalizers.js",
];

const readSource = (relativePath) => readFile(path.join(ROOT, relativePath), "utf8");

test("demo state keeps seed, generator, and finalizer modules bounded", async () => {
  const sources = Object.fromEntries(await Promise.all(
    MODULE_PATHS.map(async (relativePath) => [relativePath, await readSource(relativePath)]),
  ));

  for (const [relativePath, source] of Object.entries(sources)) {
    const lineCount = source.split(/\r?\n/u).length;
    assert.ok(lineCount <= 500, `${relativePath}: ${lineCount}/500 lines`);
  }
  assert.doesNotMatch(
    sources["src/lib/mockData/baseState.js"],
    /from\s+["']\.\.\/mockData\.js["']/u,
  );
  assert.doesNotMatch(
    sources["src/lib/mockData/stateFinalizers.js"],
    /from\s+["']\.\.\/mockData\.js["']/u,
  );
});

test("demo state public exports and deleted synthetic court guard stay intact", async () => {
  const demoState = await import("../src/lib/mockData.js");
  assert.deepEqual(Object.keys(demoState).sort(), ["initialState", "sourceDemoState"]);

  const deletedCourtPattern = /^c(?:[1-9]|1[0-2])$/u;
  for (const state of [demoState.sourceDemoState, demoState.initialState]) {
    const courtRows = [
      ...(state.matches ?? []),
      ...(state.recruitingPosts ?? []),
      ...(state.tournaments ?? []),
    ];
    assert.equal(
      courtRows.some((row) => deletedCourtPattern.test(String(row.courtId ?? ""))),
      false,
    );
    assert.equal(
      (state.settings?.approvedCourts ?? [])
        .some((court) => deletedCourtPattern.test(String(court?.id ?? ""))),
      false,
    );
  }
});
