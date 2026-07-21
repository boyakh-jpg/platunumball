import assert from "node:assert/strict";
import test from "node:test";
import {
  getCourtCanonicalName,
  getCourtFacilityBaseName,
  getCourtStandardName,
  normalizeCourtSigungu,
} from "../src/lib/courts.js";

test("주소에서 시군구를 추출한다", () => {
  assert.equal(normalizeCourtSigungu("", "부산광역시 해운대구 명장로 10"), "해운대구");
  assert.equal(normalizeCourtSigungu("", "경기도 안양시 동안구 시민대로 1"), "안양시 동안구");
  assert.equal(normalizeCourtSigungu("", "세종특별자치시 도움6로 42"), "세종시");
});

test("시설명에서 기존 지역·농구장·코트 구분을 제거한다", () => {
  assert.equal(getCourtFacilityBaseName("해운대구 우동공원 농구장 1코트", "해운대구", "1코트"), "우동공원");
  assert.equal(getCourtFacilityBaseName("연북중학교 체육관", "서대문구", ""), "연북중학교 체육관");
});

test("시군구 + 시설명 + 농구장 순서로 생성한다", () => {
  assert.equal(getCourtStandardName({
    sigungu: "해운대구",
    facilityName: "우동공원 농구장",
    courtUnit: "1코트",
  }), "해운대구 우동공원 농구장 1코트");
  assert.equal(getCourtCanonicalName({
    addressText: "경기도 수원시 영통구 광교로 1",
    facilityName: "광교호수공원",
  }), "수원시 영통구 광교호수공원 농구장");
});

test("시군구가 없으면 저장 이름을 만들지 않는다", () => {
  assert.equal(getCourtStandardName({ facilityName: "어딘가 공원" }), "");
});
