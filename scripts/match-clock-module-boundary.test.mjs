import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { getMatchClockRecognition } from "../src/lib/matchClock.js";

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

test("24초 샷클락 옵션은 UI와 DB constraint 및 RPC에서 동일하게 허용한다", async () => {
  const [clockSource, viewSource, audioSource, migrationSource, schemaSource] = await Promise.all([
    readFile(path.join(ROOT, "src/lib/matchClock.js"), "utf8"),
    readFile(path.join(ROOT, "src/components/match/MatchClockPanelView.jsx"), "utf8"),
    readFile(path.join(ROOT, "src/lib/matchClockAudio.js"), "utf8"),
    readFile(path.join(ROOT, "supabase/migrations/20260730224000_align_match_clock_24_second_option.sql"), "utf8"),
    readFile(path.join(ROOT, "supabase/schema.sql"), "utf8"),
  ]);

  assert.match(clockSource, /value:\s*24,\s*label:\s*"24/u);
  assert.match(migrationSource, /where shot_clock_seconds = 35/u);
  assert.match(migrationSource, /check \(shot_clock_seconds in \(0, 24, 30, 60\)\)/u);
  assert.match(migrationSource, /next_shot_seconds not in \(0, 24, 30, 60\)/u);
  assert.match(schemaSource, /align the live match clock with the 24-second UI option/u);
  assert.match(viewSource, /disabled=\{Boolean\(pendingAction\) \|\| !selectedControllerId\}/u);
  assert.match(audioSource, /invalid_shot_clock_seconds:[^\n]*24초/u);
});

test("경기시계 인정 진행률은 전체 시간이 아니라 최소 인정시간을 기준으로 계산한다", async () => {
  assert.deepEqual(
    getMatchClockRecognition({
      activeElapsedMs: 210000,
      minimumActiveMs: 420000,
      clockUsed: false,
      startedWithinWindow: true,
    }),
    { ratio: 0.5, recognized: false, startedInWindow: true },
  );

  const viewSource = await readFile(
    path.join(ROOT, "src/components/match/MatchClockPanelView.jsx"),
    "utf8",
  );
  assert.match(viewSource, /인정 기준 진행/u);
  assert.match(viewSource, /단일 경기에는 다음 쿼터가 없습니다/u);
  assert.match(viewSource, /시계 종료 · 인정 판정/u);
  assert.match(viewSource, /경기 종료 · 기록으로/u);
});
