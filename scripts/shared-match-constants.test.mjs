import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as shared from "../shared/lib/matchConstants.js";
import * as client from "../src/lib/constants.js";

test("클라이언트 상수 API는 shared 경기 상수를 그대로 재노출한다", () => {
  for (const exportName of [
    "MATCH_MODES",
    "MATCH_MODE_IDS",
    "MODE_SIZES",
    "DEFAULT_RATING",
    "DEFAULT_PLAYER_RATINGS",
    "MINUTE_MS",
    "HOUR_MS",
    "DAY_MS",
  ]) {
    assert.strictEqual(client[exportName], shared[exportName], exportName);
  }
  assert.strictEqual(client.getModeSize, shared.getModeSize);
  assert.strictEqual(client.isSupportedMatchMode, shared.isSupportedMatchMode);
});

test("shared 경기 모드와 기본 MMR 계약을 유지한다", () => {
  assert.deepEqual(shared.MATCH_MODE_IDS, ["1v1", "2v2", "3v3", "5v5"]);
  assert.equal(shared.getModeSize("3v3"), 3);
  assert.equal(shared.getModeSize("4v4"), 4);
  assert.equal(shared.isSupportedMatchMode("4v4"), false);
  assert.equal(shared.DEFAULT_RATING, 1200);
  assert.equal(shared.DEFAULT_PLAYER_RATINGS.modes["5v5"], 1200);
});

test("서버 rating 도메인은 프런트 constants에 의존하지 않는다", async () => {
  const directConsumers = await Promise.all([
    "server/lib/ratingPolicy.js",
    "server/lib/ratingEngine.js",
  ].map((file) => readFile(new URL(`../${file}`, import.meta.url), "utf8")));

  directConsumers.forEach((source) => {
    assert.match(source, /shared\/lib\/matchConstants\.js/);
    assert.doesNotMatch(source, /src\/lib\/constants\.js/);
  });

  const [adminSource, teamProjectionSource] = await Promise.all([
    readFile(new URL("../server/api/_supabaseAdmin.js", import.meta.url), "utf8"),
    readFile(new URL("../shared/lib/teamRowProjection.js", import.meta.url), "utf8"),
  ]);
  assert.match(adminSource, /shared\/lib\/teamRowProjection\.js/);
  assert.doesNotMatch(adminSource, /src\/lib\/constants\.js/);
  assert.match(teamProjectionSource, /\.\/matchConstants\.js/);
});
