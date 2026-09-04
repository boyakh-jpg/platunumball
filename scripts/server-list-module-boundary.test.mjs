import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const SERVER_MODULE_MAX_LINES = 500;
const ENTRY_MAX_LINES = 50;

const domains = [
  {
    directory: "server/api/recruiting",
    entry: "sync-post.js",
    modules: [
      "_syncPostActions.js",
      "_syncPostChat.js",
      "_syncPostCommon.js",
      "_syncPostHandler.js",
      "_syncPostManagementActions.js",
      "_syncPostPersistence.js",
      "_syncPostPickupPolicy.js",
      "_syncPostPolicy.js",
      "_syncPostProjection.js",
      "_syncPostResponse.js",
    ],
    exports: [
      "default",
      "getRecruitingBenchPolicyError",
      "normalizePickupRecruitingOperation",
      "normalizeRecruitingCreationPolicyOperation",
      "persistRecruitingPostSnapshot",
      "queueRecruitingRoomCancelledDeliveries",
      "validatePickupRecruitingShape",
      "validatePickupRecruitingUpdate",
      "validateRecruitingPostShape",
    ],
  },
  {
    directory: "server/api/recruiting",
    entry: "list.js",
    modules: [
      "_listHandler.js",
      "_listLoader.js",
      "_listLoaderHelpers.js",
      "_listProjection.js",
      "_listProjectionCompact.js",
      "_listQueries.js",
    ],
    exports: [
      "default",
      "loadCompactRecruitingList",
      "loadCurrentUserRecruitingFeedList",
    ],
  },
  {
    directory: "server/api/matches",
    entry: "list.js",
    modules: [
      "_listEnrichment.js",
      "_listFeedQueries.js",
      "_listHandler.js",
      "_listLoader.js",
      "_listOperationsQueries.js",
      "_listProjection.js",
      "_listQueries.js",
    ],
    exports: [
      "default",
      "loadCompactMatchList",
      "toClientTeam",
    ],
  },
];

const matchSyncPaths = [
  "server/api/matches/sync-match.js",
  "server/lib/matchSyncDependencies.js",
  "server/lib/matchSyncHandler.js",
  "server/lib/matchSqlActions.js",
  "server/lib/matchSqlCoreActions.js",
  "server/lib/matchSyncPolicy.js",
  "server/lib/matchSyncPolicyData.js",
];

const readSource = (relativePath) => readFile(path.join(ROOT, relativePath), "utf8");
const lineCount = (source) => source.trimEnd().split(/\r?\n/u).length;

async function listRuntimeFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return listRuntimeFiles(target);
    if (!entry.isFile() || !/\.(?:js|jsx|mjs)$/u.test(entry.name)) return [];
    return [target];
  }));
  return nested.flat();
}

function collectRelativeDependencies(relativePath, source, knownPaths) {
  const directory = path.posix.dirname(relativePath);
  return [...source.matchAll(/\bfrom\s+["'](\.[^"']+)["']/gu)]
    .map((match) => path.posix.normalize(path.posix.join(directory, match[1])))
    .filter((target) => knownPaths.has(target));
}

function assertAcyclic(graph) {
  const visiting = new Set();
  const visited = new Set();

  function visit(node, stack = []) {
    if (visiting.has(node)) {
      assert.fail(`server module cycle: ${[...stack, node].join(" -> ")}`);
    }
    if (visited.has(node)) return;
    visiting.add(node);
    for (const dependency of graph.get(node) ?? []) visit(dependency, [...stack, node]);
    visiting.delete(node);
    visited.add(node);
  }

  for (const node of graph.keys()) visit(node);
}

test("server list and recruiting mutation entries preserve their public exports", async () => {
  for (const domain of domains) {
    const moduleUrl = new URL(`../${domain.directory}/${domain.entry}`, import.meta.url);
    const runtimeModule = await import(moduleUrl);
    assert.deepEqual(Object.keys(runtimeModule).sort(), [...domain.exports].sort(), `${domain.directory}/${domain.entry}`);
  }
});

test("server list and recruiting mutation entries stay thin and modules stay bounded", async () => {
  for (const domain of domains) {
    const entryPath = `${domain.directory}/${domain.entry}`;
    const entrySource = await readSource(entryPath);
    assert.ok(lineCount(entrySource) <= ENTRY_MAX_LINES, entryPath);
    assert.doesNotMatch(entrySource, /\b(?:async\s+)?function\b|\b(?:const|let|class)\b/u, entryPath);

    const expected = [...domain.modules].sort();
    const actual = (await readdir(path.join(ROOT, domain.directory)))
      .filter((name) => (
        domain.entry === "sync-post.js"
          ? /^_syncPost.*\.js$/u.test(name)
          : /^_list.*\.js$/u.test(name)
      ))
      .sort();
    assert.deepEqual(actual, expected, domain.directory);

    for (const filename of domain.modules) {
      const modulePath = `${domain.directory}/${filename}`;
      const source = await readSource(modulePath);
      assert.ok(lineCount(source) <= SERVER_MODULE_MAX_LINES, `${modulePath}: ${lineCount(source)} lines`);
    }
  }
});

test("split server modules have no cycle and never cross into browser source", async () => {
  const relativePaths = domains.flatMap((domain) => [
    `${domain.directory}/${domain.entry}`,
    ...domain.modules.map((filename) => `${domain.directory}/${filename}`),
  ]);
  const knownPaths = new Set(relativePaths);
  const sourceRows = await Promise.all(relativePaths.map(async (relativePath) => ({
    relativePath,
    source: await readSource(relativePath),
  })));
  const graph = new Map(sourceRows.map(({ relativePath, source }) => [
    relativePath,
    collectRelativeDependencies(relativePath, source, knownPaths),
  ]));

  assertAcyclic(graph);
  for (const { relativePath, source } of sourceRows) {
    assert.doesNotMatch(source.replaceAll("\\", "/"), /(?:^|["'])[^"']*\/src\//u, relativePath);
  }

  const browserFiles = await listRuntimeFiles(path.join(ROOT, "src"));
  for (const file of browserFiles) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(
      source.replaceAll("\\", "/"),
      /\bfrom\s+["'][^"']*server\/|\bimport\(\s*["'][^"']*server\//u,
      path.relative(ROOT, file),
    );
  }
});

test("match sync facade preserves handler exports and split modules stay bounded", async () => {
  const facade = await import(new URL("../server/api/matches/sync-match.js", import.meta.url));
  const handler = await import(new URL("../server/lib/matchSyncHandler.js", import.meta.url));
  assert.deepEqual(Object.keys(facade).sort(), Object.keys(handler).sort());

  const entrySource = await readSource(matchSyncPaths[0]);
  assert.ok(lineCount(entrySource) <= ENTRY_MAX_LINES, matchSyncPaths[0]);

  const sourceRows = await Promise.all(matchSyncPaths.map(async (relativePath) => ({
    relativePath,
    source: await readSource(relativePath),
  })));
  for (const { relativePath, source } of sourceRows.slice(1)) {
    assert.ok(lineCount(source) <= SERVER_MODULE_MAX_LINES, `${relativePath}: ${lineCount(source)} lines`);
  }

  const knownPaths = new Set(matchSyncPaths);
  const graph = new Map(sourceRows.map(({ relativePath, source }) => [
    relativePath,
    collectRelativeDependencies(relativePath, source, knownPaths),
  ]));
  assertAcyclic(graph);
});
