import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { clampNumericStepperValue } from "../src/lib/numericStepper.js";
import {
  MATCH_ROOM_SOURCE_PATHS,
  RECRUITING_PAGE_SOURCE_PATHS,
  readSourceGroup,
} from "./management-source-groups.mjs";

test("공용 숫자 스테퍼가 범위와 정수 정책을 적용한다", () => {
  assert.equal(clampNumericStepperValue(-1, 0, 10), 0);
  assert.equal(clampNumericStepperValue(12, 0, 10), 10);
  assert.equal(clampNumericStepperValue(3.8, 0, 10), 3);
  assert.equal(clampNumericStepperValue(3.8, 0, 10, false), 3.8);
});

test("기록 화면은 공용 NumericStepper만 사용한다", async () => {
  const [matchRoomSource, recruitingSource] = await Promise.all([
    readSourceGroup((file) => readFile(new URL(`../${file}`, import.meta.url), "utf8"), MATCH_ROOM_SOURCE_PATHS),
    readSourceGroup(
      (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8"),
      RECRUITING_PAGE_SOURCE_PATHS,
    ),
  ]);

  assert.match(matchRoomSource, /components\/common\/NumericStepper\.jsx/);
  assert.match(
    recruitingSource,
    /(?:components\/common|\.\.\/common)\/NumericStepper\.jsx/,
  );
  assert.doesNotMatch(matchRoomSource, /function NumericStepper\s*\(/);
  assert.doesNotMatch(recruitingSource, /function NumericStepper\s*\(/);
});

test("empty numeric input restores its valid default on blur", async () => {
  const [source, createValidationSource] = await Promise.all([
    readFile(new URL("../src/components/common/NumericStepper.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/match/useCreateMatchValidationController.js", import.meta.url), "utf8"),
  ]);
  assert.match(source, /onBlur=\{\(event\) => \{[\s\S]*?if \(event\.currentTarget\.value === ""\) setNextValue\(numericValue\)/);
  assert.match(createValidationSource, /setDraft\(\(current\) => \(\{[\s\S]*?soloStats: \{ \.\.\.\(current\.soloStats/);
});
