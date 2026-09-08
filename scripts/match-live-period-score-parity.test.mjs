import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { accumulateMatchPeriodScores } from "../shared/lib/matchPeriodScores.js";

// Reuse the read-only database fixtures so JS and SQL share the same examples.
const sql = readFileSync(new URL("./verify-match-live-period-score-deltas.sql", import.meta.url), "utf8");
const pattern = /^\s+\('([^']+)', ('[^']*'::jsonb|null), ('[^']*'::jsonb|null), ('[^']*'::jsonb|null), (\d+), (\d+), (\d+), (\d+), ('[^']*'::jsonb)\),?$/gm;
const parseJson = (value) => value === "null" ? null : JSON.parse(value.slice(1).replace(/'::jsonb$/, ""));
const cases = [...sql.matchAll(pattern)];
assert.equal(cases.length, 26, "all database fixtures must be read");

for (const [, name, source, rules, clock, beforeA, beforeB, afterA, afterB, expected] of cases) {
  test(`SQL parity: ${name}`, () => {
    const actual = accumulateMatchPeriodScores(
      parseJson(source), parseJson(rules), parseJson(clock),
      { scoreA: Number(beforeA), scoreB: Number(beforeB) },
      { scoreA: Number(afterA) - Number(beforeA), scoreB: Number(afterB) - Number(beforeB) },
    );
    assert.deepEqual(actual, parseJson(expected));
  });
}
