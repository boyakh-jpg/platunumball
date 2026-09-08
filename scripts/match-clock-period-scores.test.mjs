import assert from "node:assert/strict";
import { mock, test } from "node:test";

let resultRow;
const selected = new Map();
const clock = { status: "running", currentPeriod: 1, overtimeCount: 0, canControl: false };
const supabase = {
  async rpc(name) {
    assert.equal(name, "rankball_match_clock_action");
    return { data: clock, error: null };
  },
  from(table) {
    const data = () => ({
      data: table === "match_results" ? resultRow
        : table === "matches" ? { rules: { periodCount: 4 }, reserve_players: {} }
          : [],
      error: null,
    });
    return {
      select(columns) { selected.set(table, columns); return this; },
      eq() { return this; },
      order() { return this; },
      maybeSingle() { return Promise.resolve(data()); },
      then(resolve) { return Promise.resolve(data()).then(resolve); },
    };
  },
};

mock.module(new URL("../server/api/_supabaseAdmin.js", import.meta.url), {
  namedExports: {
    allowRequestMethod: () => true,
    getAuthenticatedContext: async () => ({ profileId: "fixture-reader", supabase }),
    readJsonBody: async (request) => request.body,
    sendJson: (response, status, payload) => Object.assign(response, { status, payload }),
  },
});
const { default: handler } = await import("../server/api/matches/clock.js");

for (const [name, scoreA, periodScores, expectedReview] of [
  ["canonical current period", 2, [{ label: "1Q", scoreA: 2, scoreB: 0 }], false],
  ["legacy unallocated total", 7, [], true],
  ["unstarted zero scores", 0, [], false],
]) {
  test(`clock response: ${name}`, async () => {
    resultRow = { score_a: scoreA, score_b: 0, score_revision_a: 2, score_revision_b: 0, period_scores: periodScores };
    const response = {};
    await handler({ body: { matchId: "fixture-match", action: "read" } }, response);
    assert.equal(response.status, 200);
    assert.equal(response.payload.score.a, scoreA);
    assert.deepEqual(response.payload.score.periodScores, periodScores);
    assert.equal(response.payload.score.periodScoresNeedReview, expectedReview);
    assert.ok(selected.get("match_results").split(",").includes("period_scores"));
  });
}
