import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sharedLibDir = path.join(root, "shared/lib");
const barrelPath = path.join(sharedLibDir, "matchUtils.js");
const moduleNames = [
  "matchAuthority.js",
  "matchDecisionStatus.js",
  "matchDisputeRequests.js",
  "matchLegacyCompatibility.js",
  "matchListStore.js",
  "matchParticipation.js",
  "matchPlayedDate.js",
  "profileRecordStats.js",
  "matchRecordTypes.js",
  "matchRecordVerification.js",
  "matchResultEntry.js",
  "matchRoster.js",
  "matchRosterSwap.js",
  "matchRoomLifecycle.js",
  "matchScheduleTime.js",
  "matchSummary.js",
  "matchTimeUtils.js",
  "refereeEligibility.js",
  "tournamentMatchSchedule.js",
];

function readSource(fileName) {
  return fs.readFileSync(path.join(sharedLibDir, fileName), "utf8");
}

function getLocalImports(source = "") {
  return [...source.matchAll(/from\s+["']\.\/([^"']+)["']/g)]
    .map((match) => match[1])
    .filter((fileName) => moduleNames.includes(fileName));
}

test("matchUtils stays a small compatibility barrel", async () => {
  const source = fs.readFileSync(barrelPath, "utf8");
  assert.ok(source.split(/\r?\n/).length <= 40);
  assert.doesNotMatch(source, /\bfunction\b|=>/);

  const exports = Object.keys(await import("../shared/lib/matchUtils.js"));
  assert.equal(exports.length, 150);
  for (const name of [
    "canOperateAssignedMatchReferee",
    "getMatchPlayerIds",
    "getMatchRoomPhase",
    "getMatchRecordWindow",
    "getMatchResultEntryPermission",
    "getRecruitingPostTerminalState",
  ]) {
    if (name === "getRecruitingPostTerminalState") {
      assert.equal(exports.includes(name), false);
    } else {
      assert.equal(exports.includes(name), true);
    }
  }
});

test("match domain modules stay bounded and never import the barrel", () => {
  for (const fileName of moduleNames) {
    const source = readSource(fileName);
    assert.ok(
      source.split(/\r?\n/).length <= 350,
      `${fileName} exceeded the 350-line match-domain boundary`,
    );
    assert.doesNotMatch(source, /from\s+["']\.\/matchUtils\.js["']/);
  }
});

test("match domain module graph has no cycle", () => {
  const graph = new Map(
    moduleNames.map((fileName) => [fileName, getLocalImports(readSource(fileName))]),
  );
  const visiting = new Set();
  const visited = new Set();

  function visit(fileName, trail = []) {
    if (visiting.has(fileName)) {
      assert.fail(`match module cycle: ${[...trail, fileName].join(" -> ")}`);
    }
    if (visited.has(fileName)) return;
    visiting.add(fileName);
    for (const dependency of graph.get(fileName) ?? []) {
      visit(dependency, [...trail, fileName]);
    }
    visiting.delete(fileName);
    visited.add(fileName);
  }

  for (const fileName of moduleNames) visit(fileName);
});
