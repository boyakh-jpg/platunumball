import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { asArray, compactArray } from "../shared/lib/arrayValues.js";

test("배열 coercion은 falsy 보존과 제거를 명시적으로 구분한다", () => {
  const source = [0, false, "", null, "player"];
  assert.deepEqual(asArray(source), source);
  assert.deepEqual(compactArray(source), ["player"]);
  assert.deepEqual(asArray(null), []);
  assert.deepEqual(compactArray({}), []);
});

test("서버의 로컬 toArray 복사본이 돌아오지 않는다", async () => {
  const sources = await Promise.all([
    "server/api/records/list.js",
    "server/api/discord/interactions.js",
    "server/api/system/feed-audit.js",
  ].map((file) => readFile(new URL(`../${file}`, import.meta.url), "utf8")));

  sources.forEach((source) => {
    assert.doesNotMatch(source, /function toArray\s*\(/);
  });
});
