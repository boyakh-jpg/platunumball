import assert from "node:assert/strict";
import test from "node:test";
import {
  getCompactCourtDisplayName,
  getCourtCanonicalName,
  getCourtFacilityBaseName,
  getCourtStandardName,
  normalizeCourtSigungu,
} from "../src/lib/courts.js";

test("최근 경기용 구장명은 지역과 복합 시설명을 짧게 표시한다", () => {
  assert.equal(
    getCompactCourtDisplayName("마포구 경성중고등학교, 홍익디자인고등학교 농구장 2코트"),
    "마포 홍익디자인고등학교 농구장 2코트",
  );
  assert.equal(
    getCompactCourtDisplayName("서울특별시 마포구 경성중고등학교 / 홍익디자인고등학교 실내 농구장 2코트"),
    "마포 홍익디자인고등학교 실내 농구장…",
  );
  assert.equal(
    getCompactCourtDisplayName("경기도 수원시 영통구 광교호수공원 농구장"),
    "영통 광교호수공원 농구장",
  );
});

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

test("주소 건물명을 직접 입력한 시설명보다 우선한다", () => {
  assert.equal(getCourtStandardName({
    sigungu: "서대문구",
    buildingName: "연북중학교 체육관",
    facilityName: "시설명 확인 필요",
  }), "서대문구 연북중학교 체육관 농구장");
});

test("시군구가 없으면 저장 이름을 만들지 않는다", () => {
  assert.equal(getCourtStandardName({ facilityName: "어딘가 공원" }), "");
});
