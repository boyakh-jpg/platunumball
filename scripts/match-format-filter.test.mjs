import test from "node:test";
import assert from "node:assert/strict";

import {
  MATCH_FORMAT_FILTERS,
  getMatchFormatLabel,
  matchesMatchFormatFilter,
} from "../shared/lib/matchFormats.js";

test("경기 방식 필터는 일반 3v3 뒤에 3x3을 제공한다", () => {
  assert.deepEqual(
    MATCH_FORMAT_FILTERS.map(({ id }) => id),
    ["1v1", "2v2", "3v3", "3x3", "5v5"],
  );
});

test("일반 3v3과 FIBA 3x3을 실제 규칙값으로 분리한다", () => {
  const standard = { mode: "3v3", rules: { ruleSet: "standard" } };
  const fiba = { mode: "3v3", rules: { ruleSet: "fiba_3x3" } };

  assert.equal(matchesMatchFormatFilter(standard, "3v3"), true);
  assert.equal(matchesMatchFormatFilter(standard, "3x3"), false);
  assert.equal(matchesMatchFormatFilter(fiba, "3v3"), false);
  assert.equal(matchesMatchFormatFilter(fiba, "3x3"), true);
  assert.equal(getMatchFormatLabel(fiba.mode, fiba.rules), "3x3");
});

test("이전 데이터의 FIBA 규칙 조합도 3x3으로 판별한다", () => {
  const legacyFiba = {
    mode: "3v3",
    rules: {
      targetScore: 21,
      periodCount: 1,
      periodMinutes: 12,
      endCondition: "target_or_time",
      winByTwo: true,
    },
  };

  assert.equal(matchesMatchFormatFilter(legacyFiba, "3x3"), true);
  assert.equal(matchesMatchFormatFilter(legacyFiba, "all"), true);
});
