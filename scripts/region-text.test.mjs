import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getCanonicalRegion, isSameRegion } from "../src/lib/constants.js";
import { getProfileRegionSelection } from "../src/lib/profileSetup.js";
import { normalizeRegionText } from "../src/lib/regionText.js";

test("지역 조회 문자열은 공백과 영문 대소문자를 한 규칙으로 정규화한다", () => {
  assert.equal(normalizeRegionText("  Seoul  마포구 "), "seoul마포구");
  assert.equal(normalizeRegionText(null), "");
});

test("기존 canonical 지역 비교 결과를 유지한다", () => {
  assert.equal(getCanonicalRegion("서울 마포구"), "마포");
  assert.equal(isSameRegion("서울 마포구", "마포"), true);
});

test("사용자 기본 지역 선택은 시도·시군구·통합 지역을 한 우선순위로 읽는다", () => {
  assert.deepEqual(getProfileRegionSelection({
    regionSido: "서울특별시",
    regionDistrict: "강남구",
    region: "부산광역시 해운대구",
  }), {
    sido: "서울특별시",
    district: "강남구",
  });
  assert.deepEqual(getProfileRegionSelection({ region: "부산광역시 해운대구" }), {
    sido: "부산광역시",
    district: "해운대구",
  });
});

test("모집과 팀 화면은 같은 사용자 기본 지역 helper를 사용한다", async () => {
  const [recruitingSource, teamsSource] = await Promise.all([
    readFile(new URL("../src/pages/Recruiting.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/Teams.jsx", import.meta.url), "utf8"),
  ]);
  [recruitingSource, teamsSource].forEach((source) => {
    assert.match(source, /getProfileRegionSelection\(app\.currentUser\)/u);
    assert.doesNotMatch(source, /inferRegionSelection\(\[\s*app\.currentUser\.regionSido/u);
  });
});
