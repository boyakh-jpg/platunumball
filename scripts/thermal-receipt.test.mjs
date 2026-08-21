import assert from "node:assert/strict";
import test from "node:test";
import {
  createThermalRandom,
  getThermalReceiptLayout,
  getThermalReceiptTextWeight,
  getThermalScoreSlotLayout,
  sanitizeThermalReceiptComment,
  THERMAL_PRINT_ROLES,
} from "../shared/lib/thermalReceipt.js";

test("thermal receipt keeps the canonical Story paper geometry", () => {
  const photo = getThermalReceiptLayout({ hasPhoto: true, hasPeriods: true, hasComment: true });
  const plain = getThermalReceiptLayout({ hasPhoto: false, hasPeriods: true, hasComment: true });

  assert.deepEqual(photo.paper, { x: 142, y: 24, width: 796, height: 1872 });
  assert.deepEqual(plain.paper, { x: 142, y: 168, width: 796, height: 1584 });
  assert.deepEqual(photo.content, { x: 198, width: 684 });
  assert.equal(photo.photo.height, 288);
  assert.equal(photo.teams.y - plain.teams.y, 288);
  assert.equal(photo.score.y - plain.score.y, 288);
  assert.equal(photo.footer.y - plain.footer.y, 288);
});

test("optional thermal rows reduce positions and paper height instead of leaving gaps", () => {
  const full = getThermalReceiptLayout({ hasPhoto: false, hasPeriods: true, hasComment: true });
  const noPeriods = getThermalReceiptLayout({ hasPhoto: false, hasPeriods: false, hasComment: true });
  const noComment = getThermalReceiptLayout({ hasPhoto: false, hasPeriods: true, hasComment: false });

  assert.equal(noPeriods.periods, null);
  assert.equal(full.result.y - noPeriods.result.y, 186);
  assert.equal(full.footer.y - noPeriods.footer.y, 186);
  assert.equal(full.paper.height - noPeriods.paper.height, 186);
  assert.equal(full.result.height - noComment.result.height, 32);
  assert.equal(full.footer.y - noComment.footer.y, 32);
  assert.equal(full.paper.height - noComment.paper.height, 32);
});

test("thermal comment removes markup and controls then enforces weighted length", () => {
  const sanitized = sanitizeThermalReceiptComment("  <b>4쿼터</b>\n 12점\u0000 차를 뒤집은 역전승  ");
  assert.equal(sanitized, "4쿼터 12점 차를 뒤집은 역전승");
  assert.equal(getThermalReceiptTextWeight(sanitized), 29);

  const limited = sanitizeThermalReceiptComment("가".repeat(40));
  assert.equal(limited, "가".repeat(28));
  assert.equal(getThermalReceiptTextWeight(limited), 56);
});

test("thermal score slots center every supported score inside 284 pixels", () => {
  for (const score of [0, 7, 46, 60, 113, 120, 999]) {
    const slot = getThermalScoreSlotLayout(score);
    assert.ok(slot.x >= 0, `${score} starts inside the slot`);
    assert.ok(slot.x + slot.totalWidth <= 284.000001, `${score} ends inside the slot`);
    assert.ok(Math.abs(slot.x * 2 + slot.totalWidth - 284) < 0.000001, `${score} stays centered`);
  }
  assert.equal(getThermalScoreSlotLayout(-1).score, "0");
  assert.equal(getThermalScoreSlotLayout(1000).score, "999");
});

test("thermal print noise is deterministic for the receipt seed", () => {
  const first = createThermalRandom("BX-260821-051");
  const second = createThermalRandom("BX-260821-051");
  const other = createThermalRandom("BX-260821-052");
  const firstSequence = Array.from({ length: 8 }, () => first());

  assert.deepEqual(firstSequence, Array.from({ length: 8 }, () => second()));
  assert.notDeepEqual(firstSequence, Array.from({ length: 8 }, () => other()));
});

test("thermal print roles keep supplied masks separate and QR untouched", () => {
  assert.deepEqual(THERMAL_PRINT_ROLES, {
    body: { mask: "body", opacity: 0.84 },
    team: { mask: "team", opacity: 0.9 },
    heavy: { mask: "heavy", opacity: 0.92 },
    photo: { mask: "photo", opacity: 0.88 },
    qr: { mask: null, opacity: 1 },
  });
});
