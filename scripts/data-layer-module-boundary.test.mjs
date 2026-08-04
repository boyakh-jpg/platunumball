import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const REPOSITORY_DIR = path.join(ROOT, "src/data/repository");
const APP_DATA_DIR = path.join(ROOT, "src/hooks/appData");
const DATA_MODULE_MAX_LINES = 500;

async function readModuleDirectory(directory, relativeDirectory = "") {
  const entries = await readdir(path.join(directory, relativeDirectory), { withFileTypes: true });
  const names = (await Promise.all(entries.map(async (entry) => {
    const relativePath = path.posix.join(relativeDirectory.replaceAll("\\", "/"), entry.name);
    if (entry.isDirectory()) return (await readModuleDirectory(directory, relativePath)).names;
    return entry.isFile() && entry.name.endsWith(".js") ? [relativePath] : [];
  }))).flat().sort();
  const sources = new Map(await Promise.all(names.map(async (name) => [
    name,
    await readFile(path.join(directory, name), "utf8"),
  ])));
  return { names, sources };
}

function getLocalModuleEdges(sources) {
  const edges = new Map([...sources.keys()].map((name) => [name, new Set()]));
  for (const [name, source] of sources) {
    for (const match of source.matchAll(/from\s+["'](\.[^"']+\.js)["']/gu)) {
      const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(name), match[1]));
      if (sources.has(dependency)) edges.get(name).add(dependency);
    }
  }
  return edges;
}

function getCycles(edges) {
  const visiting = new Set();
  const visited = new Set();
  const cycles = [];
  const visit = (name, stack = []) => {
    if (visiting.has(name)) {
      cycles.push([...stack, name]);
      return;
    }
    if (visited.has(name)) return;
    visiting.add(name);
    for (const dependency of edges.get(name) ?? []) visit(dependency, [...stack, name]);
    visiting.delete(name);
    visited.add(name);
  };
  for (const name of edges.keys()) visit(name);
  return cycles;
}

test("repository와 useAppData 호환 배럴은 공개 export만 유지한다", async () => {
  const [repositorySource, appDataSource, repository, appData] = await Promise.all([
    readFile(path.join(ROOT, "src/data/repository.js"), "utf8"),
    readFile(path.join(ROOT, "src/hooks/useAppData.js"), "utf8"),
    import("../src/data/repository.js"),
    import("../src/hooks/useAppData.js"),
  ]);

  assert.ok(repositorySource.split(/\r?\n/u).length <= 220);
  assert.ok(appDataSource.split(/\r?\n/u).length <= 30);
  assert.doesNotMatch(repositorySource, /\b(?:function|class)\s+[A-Za-z_$]/u);
  assert.doesNotMatch(appDataSource, /\b(?:function|class)\s+[A-Za-z_$]/u);
  assert.equal(Object.keys(repository).length, 128);
  assert.equal(typeof repository.rejectCourtRequest, "function");
  assert.equal("loadNormalizedDirectoryStateFromClient" in repository, false);
  assert.equal("loadNormalizedMatchDetailFromClient" in repository, false);
  assert.equal(Object.keys(appData).length, 3);
  for (const name of [
    "createMatch",
    "createRecruitingPost",
    "loadRemoteState",
    "normalizeState",
    "runAutomaticStateMaintenance",
  ]) {
    assert.equal(typeof repository[name], "function", `${name} compatibility export`);
  }
  assert.deepEqual(Object.keys(appData).sort(), [
    "mergeMatchesById",
    "mergeRecruitingPostsById",
    "useAppData",
  ]);
});

test("데이터 계층 책임 모듈은 순환과 브라우저-서버 역참조가 없다", async () => {
  const [repository, appData] = await Promise.all([
    readModuleDirectory(REPOSITORY_DIR),
    readModuleDirectory(APP_DATA_DIR),
  ]);

  assert.deepEqual(repository.names.filter((name) => !name.includes("/")), [
    "account.js",
    "admin.js",
    "courts.js",
    "guards.js",
    "lifecycle.js",
    "localState.js",
    "matchAccess.js",
    "matchCreation.js",
    "matches.js",
    "recruiting.js",
    "remote.js",
    "reports.js",
    "roomRules.js",
    "runtime.js",
    "settings.js",
    "tournaments.js",
  ]);
  assert.deepEqual(appData.names.filter((name) => !name.includes("/")), [
    "actions.js",
    "bootstrap.js",
    "metadata.js",
    "recordArchive.js",
    "remoteMerge.js",
    "serverOperations.js",
    "stateNormalization.js",
    "useAppDataOrchestrator.js",
  ]);
  assert.deepEqual(getCycles(getLocalModuleEdges(repository.sources)), []);
  assert.deepEqual(getCycles(getLocalModuleEdges(appData.sources)), []);
  assert.deepEqual(repository.names.filter((name) => name.startsWith("matches/")), [
    "matches/feedback.js",
    "matches/lifecycle.js",
    "matches/pickup.js",
    "matches/recordParticipants.js",
    "matches/result.js",
    "matches/resultDisputes.js",
    "matches/resultOperations.js",
    "matches/resultSubmission.js",
    "matches/roster.js",
  ]);
  assert.deepEqual(repository.names.filter((name) => name.startsWith("recruiting/")), [
    "recruiting/confirmation.js",
    "recruiting/creation.js",
    "recruiting/invitationPlayers.js",
    "recruiting/invitationReferee.js",
    "recruiting/invitationResponses.js",
    "recruiting/invitations.js",
    "recruiting/participation.js",
    "recruiting/participationInterest.js",
    "recruiting/participationRoster.js",
    "recruiting/participationStatus.js",
    "recruiting/party.js",
    "recruiting/partyJoin.js",
    "recruiting/partyManagement.js",
    "recruiting/partyPlacement.js",
    "recruiting/partyRoster.js",
  ]);
  assert.deepEqual(repository.names.filter((name) => name.startsWith("admin/")), [
    "admin/appointment.js",
    "admin/courtApproval.js",
    "admin/review.js",
  ]);
  assert.deepEqual(repository.names.filter((name) => name.startsWith("lifecycle/")), [
    "lifecycle/automatic.js",
    "lifecycle/matches.js",
  ]);
  assert.deepEqual(repository.names.filter((name) => name.startsWith("roomRules/")), [
    "roomRules/helpers.js",
    "roomRules/match.js",
    "roomRules/proposals.js",
    "roomRules/recruiting.js",
  ]);
  assert.deepEqual(repository.names.filter((name) => name.startsWith("tournaments/")), [
    "tournaments/creation.js",
    "tournaments/governance.js",
    "tournaments/schedule.js",
  ]);
  assert.deepEqual(repository.names.filter((name) => name.startsWith("remote/")), [
    "remote/loaders.js",
    "remote/seed.js",
    "remote/state.js",
    "remote/stateLoader.js",
    "remote/stateScope.js",
  ]);
  assert.deepEqual(appData.names.filter((name) => name.startsWith("actions/")), [
    "actions/dependencies.js",
    "actions/loaderActions.js",
    "actions/matchActions.js",
    "actions/profileTeamActions.js",
    "actions/recruitingActions.js",
    "actions/settingsActions.js",
    "actions/teamMembershipActions.js",
  ]);
  assert.deepEqual(appData.names.filter((name) => name.startsWith("orchestrator/")), [
    "orchestrator/admin.js",
    "orchestrator/dependencySet.js",
    "orchestrator/directoryLoaders.js",
    "orchestrator/loaders.js",
    "orchestrator/matchLoaders.js",
    "orchestrator/recordLoaders.js",
    "orchestrator/runtime.js",
    "orchestrator/runtimeHydration.js",
    "orchestrator/serverActions.js",
  ]);
  assert.deepEqual(appData.names.filter((name) => name.startsWith("remoteMerge/")), [
    "remoteMerge/entities.js",
    "remoteMerge/pages.js",
    "remoteMerge/results.js",
    "remoteMerge/state.js",
  ]);

  for (const [name, source] of [...repository.sources, ...appData.sources]) {
    assert.doesNotMatch(source, /(?:\.\.\/)+server\/|src\/server\//u, `${name} browser-to-server import`);
    const lineCount = source.split(/\r?\n/u).length;
    assert.ok(lineCount <= DATA_MODULE_MAX_LINES, `${name} ${lineCount}/${DATA_MODULE_MAX_LINES} lines`);
  }
});

test("서버 repositoryAdapter는 호환 배럴 없이 소유 모듈만 직접 읽는다", async () => {
  const adapterSource = await readFile(path.join(ROOT, "server/lib/repositoryAdapter.js"), "utf8");
  assert.doesNotMatch(adapterSource, /src\/data\/repository\.js/u);
  assert.match(adapterSource, /src\/data\/repository\/runtime\.js/u);
  assert.match(adapterSource, /src\/data\/repository\/recruiting\/confirmation\.js/u);
  assert.match(adapterSource, /src\/data\/repository\/matchCreation\.js/u);
  assert.match(adapterSource, /src\/data\/repository\/remote\/stateLoader\.js/u);
});
