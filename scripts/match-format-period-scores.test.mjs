import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { getModeClockPreset } from "../src/lib/matchCreationPolicies.js";
import { getMatchFormatLabel } from "../src/lib/matchRules.js";
import {
  getMatchPeriodScoreLabels,
  validateMatchPeriodScores,
} from "../shared/lib/matchPeriodScores.js";
import { getMatchReceiptDraftFromMatch } from "../src/lib/matchReceipt.js";

test("FIBA 21-point preset distinguishes 3x3 from ordinary 3v3", () => {
  const fibaRules = getModeClockPreset("3v3", "score21");
  const ordinaryRules = getModeClockPreset("3v3", "community");
  const twoOnTwoRules = getModeClockPreset("2v2", "score21");

  assert.equal(fibaRules.ruleSet, "fiba_3x3");
  assert.equal(fibaRules.periodMinutes, 10);
  assert.equal(fibaRules.timeLimit, 10);
  assert.equal(fibaRules.ball, "6호 공");
  assert.equal(getMatchFormatLabel("3v3", fibaRules), "3x3");
  assert.equal(getMatchFormatLabel("3v3", ordinaryRules), "3v3");
  assert.equal(twoOnTwoRules.ruleSet, "standard");
  assert.equal(getMatchFormatLabel("2v2", twoOnTwoRules), "2v2");
});

test("legacy exact FIBA rules remain display-compatible", () => {
  assert.equal(getMatchFormatLabel("3v3", {
    periodCount: 1,
    periodMinutes: 12,
    targetScore: 21,
    endCondition: "target_or_time",
    winByTwo: true,
  }), "3x3");
});

test("period labels and totals follow the canonical match rules", () => {
  assert.deepEqual(getMatchPeriodScoreLabels({ periodCount: 4 }), ["1Q", "2Q", "3Q", "4Q", "OT"]);
  assert.deepEqual(getMatchPeriodScoreLabels({ periodCount: 2 }), ["1H", "2H", "OT"]);
  assert.deepEqual(getMatchPeriodScoreLabels({ periodCount: 1 }), ["REG", "OT"]);

  const valid = validateMatchPeriodScores([
    { label: "1Q", scoreA: 12, scoreB: 8 },
    { label: "2Q", scoreA: 10, scoreB: 11 },
    { label: "3Q", scoreA: 9, scoreB: 13 },
    { label: "4Q", scoreA: 11, scoreB: 10 },
    { label: "OT", scoreA: "", scoreB: "" },
  ], { periodCount: 4 }, { scoreA: 42, scoreB: 42 });
  assert.equal(valid.valid, true);
  assert.equal(valid.periodScores.length, 4);

  assert.equal(validateMatchPeriodScores([
    { label: "REG", scoreA: 21, scoreB: 18 },
  ], { periodCount: 1 }, { scoreA: 21, scoreB: 19 }).valid, false);
  assert.equal(validateMatchPeriodScores([
    { label: "REG", scoreA: 21, scoreB: "" },
  ], { periodCount: 1 }, { scoreA: 21, scoreB: 18 }).valid, false);
  assert.deepEqual(validateMatchPeriodScores([], { periodCount: 1 }, { scoreA: 21, scoreB: 18 }).periodScores, []);
  assert.equal(validateMatchPeriodScores([
    { label: "REG", scoreA: "abc", scoreB: 18 },
  ], { periodCount: 1 }, { scoreA: 21, scoreB: 18 }).valid, false);
  assert.equal(validateMatchPeriodScores([
    { label: "OT", scoreA: 21, scoreB: 18 },
  ], { periodCount: 1 }, { scoreA: 21, scoreB: 18 }).valid, false);
});

test("receipt reads canonical format and period scores from the match result", () => {
  const periodScores = [{ label: "REG", scoreA: 21, scoreB: 18 }];
  const receipt = getMatchReceiptDraftFromMatch({
    mode: "3v3",
    rules: { ...getModeClockPreset("3v3", "score21"), recordSummary: {} },
    status: "confirmed",
    scheduledDate: "2026-08-14",
    teamA: { name: "TEAM A", score: 21 },
    teamB: { name: "TEAM B", score: 18 },
    result: { scoreA: 21, scoreB: 18, periodScores },
  });

  assert.equal(receipt.format, "3x3");
  assert.deepEqual(receipt.periodScores, periodScores);
});

test("schema and migration persist and validate canonical period scores", () => {
  const schema = fs.readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
  const migration = fs.readFileSync(
    new URL("../supabase/migrations/20260814150000_match_period_scores_and_fiba_3x3.sql", import.meta.url),
    "utf8",
  );

  for (const source of [schema, migration]) {
    assert.match(source, /period_scores jsonb/u);
    assert.match(source, /invalid_match_period_scores/u);
    assert.match(source, /period_score_total_mismatch/u);
  }
  assert.match(migration, /update public\.match_results[\s\S]*period_scores = '\[\]'::jsonb/u);
});
