import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getSettingsActivityDetail } from "../src/pages/settingsPageModel.js";

function rowsByLabel(model) {
  return Object.fromEntries(model.rows.map((row) => [row.label, row.value]));
}

test("신고 상세는 접수·처리 시각과 운영진 메시지를 표시한다", () => {
  const model = getSettingsActivityDetail({
    kind: "report",
    item: {
      type: "player",
      targetId: "u1",
      reason: "폭언",
      status: "resolved",
      createdAt: "2026-08-01T00:00:00.000Z",
      resolvedAt: "2026-08-02T00:00:00.000Z",
      resolution: { actionType: "validReport", feedback: "조치가 완료되었습니다." },
    },
  }, { userMap: { u1: { name: "박지후" } } });
  const rows = rowsByLabel(model);

  assert.equal(model.title, "박지후");
  assert.notEqual(rows["접수 시각"], "-");
  assert.notEqual(rows["처리 시각"], "-");
  assert.equal(rows["운영진 메시지"], "조치가 완료되었습니다.");
});

test("구장 신청 상세는 반려 사유와 처리 시각을 표시한다", () => {
  const model = getSettingsActivityDetail({
    kind: "courtRequest",
    item: {
      name: "테스트 구장",
      status: "rejected",
      addressText: "서울시 테스트로 1",
      createdAt: "2026-08-01T00:00:00.000Z",
      rejectedAt: "2026-08-02T00:00:00.000Z",
      rejectionReason: "위치를 확인할 수 없습니다.",
    },
  });
  const rows = rowsByLabel(model);

  assert.equal(model.title, "테스트 구장");
  assert.equal(rows["운영진 메시지"], "위치를 확인할 수 없습니다.");
  assert.notEqual(rows["처리 시각"], "-");
});

test("차단 상세는 저장된 차단 시각을 표시한다", () => {
  const model = getSettingsActivityDetail({ kind: "block", item: { userId: "u1" } }, {
    userMap: { u1: { name: "박지후", hashtag: "#jihoo" } },
    app: { state: { settings: { blockedUserProfiles: { u1: { blockedAt: "2026-08-03T00:00:00.000Z" } } } } },
  });
  assert.notEqual(rowsByLabel(model)["차단 시각"], "-");
});

test("설정 목록은 공용 팝업을 사용하고 운영자 신고 목록은 기본 닫힘이다", async () => {
  const [settingsView, settingsSide, settingsReport, settingsList, adminDetail] = await Promise.all([
    readFile(new URL("../src/pages/SettingsPageView.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/SettingsSideColumn.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/SettingsReportCard.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/SettingsListDialog.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/AdminDetailPanel.jsx", import.meta.url), "utf8"),
  ]);

  assert.match(settingsView, /<SettingsListDialog/u);
  assert.match(settingsSide, /onOpenList\?\.\("blocks"\)[\s\S]*onOpenList\?\.\("courtRequests"\)/u);
  assert.match(settingsReport, /onOpenList\?\.\("reports"\)/u);
  assert.match(settingsList, /kind === "reports"[\s\S]*kind === "blocks"/u);
  assert.match(adminDetail, /<details>[\s\S]*?<summary>신고 목록 열람<\/summary>[\s\S]*?<\/details>/u);
});
