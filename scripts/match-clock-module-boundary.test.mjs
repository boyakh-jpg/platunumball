import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, "$1"));
const MODULE_LIMITS = new Map([
  ["src/components/match/MatchClockPanel.jsx", 500],
  ["src/components/match/MatchClockPanelView.jsx", 500],
  ["src/components/match/MatchScoreControls.jsx", 250],
  ["src/lib/matchClockAudio.js", 250],
]);

test("match clock panel delegates score controls and audio without growing back", async () => {
  const sources = Object.fromEntries(await Promise.all(
    [...MODULE_LIMITS].map(async ([relativePath]) => [
      relativePath,
      await readFile(path.join(ROOT, relativePath), "utf8"),
    ]),
  ));

  for (const [relativePath, maxLines] of MODULE_LIMITS) {
    const lineCount = sources[relativePath].split(/\r?\n/u).length;
    assert.ok(lineCount <= maxLines, `${relativePath}: ${lineCount}/${maxLines} lines`);
  }

  const panel = [
    sources["src/components/match/MatchClockPanel.jsx"],
    sources["src/components/match/MatchClockPanelView.jsx"],
  ].join("\n");
  assert.match(panel, /from "\.\/MatchScoreControls\.jsx"/u);
  assert.match(panel, /from "\.\.\/\.\.\/lib\/matchClockAudio\.js"/u);
  assert.match(panel, /export \{ default as MatchScoreControls \}/u);
  assert.doesNotMatch(panel, /\b(?:AudioContext|webkitAudioContext)\b/u);
  assert.doesNotMatch(
    sources["src/components/match/MatchScoreControls.jsx"],
    /from "\.\/MatchClockPanel\.jsx"/u,
  );
  assert.doesNotMatch(
    sources["src/components/match/MatchClockPanelView.jsx"],
    /from "\.\/MatchClockPanel\.jsx"/u,
  );
  assert.doesNotMatch(
    sources["src/lib/matchClockAudio.js"],
    /from ["'][^"']*MatchClockPanel\.jsx["']/u,
  );
});

test("recruiting room receives the match clock panel through shared dependencies", async () => {
  const [dependencies, managementSection] = await Promise.all([
    readFile(path.join(ROOT, "src/components/recruiting/RecruitingRoomDependencies.js"), "utf8"),
    readFile(path.join(ROOT, "src/components/recruiting/RecruitingRoomManagementSection.jsx"), "utf8"),
  ]);

  assert.match(
    dependencies,
    /import MatchClockPanel, \{\s*MatchScoreControls,\s*\} from "\.\.\/match\/MatchClockPanel\.jsx";/u,
  );
  assert.match(
    dependencies,
    /MatchDisputeQueue, MatchClockPanel, MatchScoreControls,/u,
  );
  assert.match(
    managementSection,
    /MatchClockPanel, MatchScoreControls, MeetingPointFields,/u,
  );
});
