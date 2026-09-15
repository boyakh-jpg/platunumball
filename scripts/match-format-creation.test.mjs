import assert from "node:assert/strict";
import test from "node:test";
import { getMatchFormatLabel, getMatchModeForFormat, matchesMatchFormatFilter } from "../shared/lib/matchFormats.js";
import { getMatchClockPresetOptions, getMatchFormatChangePatch } from "../src/lib/matchCreationPolicies.js";
import { getMatchRulesPayload, normalizeMatchRules } from "../src/lib/matchRules.js";

test("3x3 선택은 3명 정원과 3x3 기본 규칙을 함께 저장한다", () => {
  const draft = getMatchFormatChangePatch({ mode: "5v5" }, "3x3");
  assert.equal(getMatchModeForFormat("3x3"), "3v3");
  assert.equal(draft.mode, "3v3");
  assert.equal(draft.ruleSet, "fiba_3x3");
  assert.equal(draft.periodMinutes, 10);
  assert.equal(draft.periodCount, 1);
  assert.equal(draft.targetScore, 21);
  assert.equal(draft.ball, "6호 공");
});

test("3x3 시간·점수·쿼터를 조정해도 저장과 필터에서 경기 방식이 유지된다", () => {
  const draft = {
    ...getMatchFormatChangePatch({ mode: "3v3", ruleSet: "standard" }, "3x3"),
    periodCount: 2, periodMinutes: 7, targetScore: 15, ball: "7호 공", winByTwo: false,
  };
  const rules = getMatchRulesPayload(draft, { mode: draft.mode });
  assert.equal(rules.periodCount, 2);
  assert.equal(rules.periodMinutes, 7);
  assert.equal(rules.targetScore, 15);
  assert.equal(rules.ball, "7호 공");
  assert.equal(rules.winByTwo, false);
  assert.equal(getMatchFormatLabel(draft.mode, rules), "3x3");
  assert.equal(matchesMatchFormatFilter({ mode: draft.mode, rules }, "3x3"), true);
  assert.equal(matchesMatchFormatFilter({ mode: draft.mode, rules }, "3v3"), false);
  assert.deepEqual(getMatchFormatChangePatch(draft, "3x3"), { mode: "3v3" });
});

test("시간 프리셋은 3v3과 3x3 구분 및 선택한 공을 바꾸지 않는다", () => {
  for (const ruleSet of ["standard", "fiba_3x3"]) {
    const source = { ruleSet, ball: "코트 공" };
    for (const option of getMatchClockPresetOptions("3v3", source)) {
      const rules = getMatchRulesPayload({ ...source, ...option.patch }, { mode: "3v3" });
      assert.equal(rules.ruleSet, ruleSet, option.id);
      assert.equal(rules.ball, "코트 공", option.id);
    }
  }
});

test("3x3에서 일반 3v3 전환은 명단·비용·운영 메모를 보존한다", () => {
  const source = {
    ...getMatchFormatChangePatch({ mode: "3v3" }, "3x3"),
    homePlayers: ["player-1", "player-2"], awayPlayers: ["player-3"],
    benchCapacity: 4, venueFee: 24000, meetingPoint: "체육관 정문", gameClockEnabled: false,
  };
  const result = { ...source, ...getMatchFormatChangePatch(source, "3v3") };
  assert.equal(result.mode, "3v3");
  assert.equal(getMatchFormatLabel(result.mode, result), "3v3");
  for (const key of ["homePlayers", "awayPlayers", "benchCapacity", "venueFee", "meetingPoint", "gameClockEnabled"]) {
    assert.deepEqual(result[key], source[key], key);
  }
});

test("기존 3x3 규칙은 보존하고 일부 값이나 기본값만으로 3x3을 추정하지 않는다", () => {
  const legacy = { periodCount: 1, periodMinutes: 12, targetScore: 21, endCondition: "target_or_time", winByTwo: true };
  assert.equal(normalizeMatchRules(legacy, { mode: "3v3" }).ruleSet, "fiba_3x3");
  for (const rules of [{}, { targetScore: 21 }, { ...legacy, ruleSet: "standard" }]) {
    assert.equal(normalizeMatchRules(rules, { mode: "3v3" }).ruleSet, "standard");
  }
});
