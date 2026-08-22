import assert from "node:assert/strict";
import test from "node:test";
import {
  createThermalRandom,
  getMatchReceiptCommentLines,
  getMatchReceiptFormatPlayerCount,
  getThermalReceiptLayout,
  getThermalReceiptTextWeight,
  getThermalScoreSlotLayout,
  sanitizeThermalReceiptComment,
  THERMAL_PRINT_ROLES,
} from "../shared/lib/thermalReceipt.js";
import { resolveThermalReceiptEmblemSources } from "../src/lib/thermalReceipt.js";
import {
  getReceiptPhotoStyle,
  getReceiptPhotoTransform,
} from "../src/lib/receiptPhotoTransform.js";

test("thermal receipt keeps the canonical Story paper geometry", () => {
  const photo = getThermalReceiptLayout({ hasPhoto: true, hasPeriods: true, hasComment: true });
  const plain = getThermalReceiptLayout({ hasPhoto: false, hasPeriods: true, hasComment: true });

  assert.deepEqual(photo.paper, { x: 142, y: 24, width: 796, height: 1872 });
  assert.deepEqual(plain.paper, { x: 142, y: 168, width: 796, height: 1568 });
  assert.deepEqual(photo.content, { x: 198, width: 684 });
  assert.equal(photo.photo.height, 288);
  assert.equal(photo.brand.y - photo.paper.y, plain.brand.y - plain.paper.y);
  assert.equal(plain.teams.y, 380);
  assert.equal(plain.score.y, 618);
  assert.equal(plain.info.y, 856);
  assert.equal(plain.periods.y, 998);
  assert.equal(plain.result.y, 1184);
  assert.equal(plain.footer.y, 1468);
  for (const region of ["teams", "score", "info", "periods", "footer"]) {
    assert.equal(
      photo[region].y - photo.paper.y - (plain[region].y - plain.paper.y),
      304,
      `${region} accounts for the compact no-photo header`,
    );
  }
  assert.equal(photo.paper.y + photo.paper.height - (photo.footer.y + photo.footer.height), 24);
  assert.equal(plain.paper.y + plain.paper.height - (plain.footer.y + plain.footer.height), 24);
});

test("thermal receipt reuses the shared emblem chain before monogram fallback", () => {
  const sources = resolveThermalReceiptEmblemSources({
    teamEmblemUrls: { home: "canonical-home", away: "canonical-away" },
    neutralTeamMarkUrls: { home: "neutral-home", away: "neutral-away" },
  }, {
    teamLineArtUrls: { home: "selected-home", away: "canonical-away" },
  });

  assert.deepEqual(sources.home, ["selected-home", "canonical-home", "neutral-home"]);
  assert.deepEqual(sources.away, ["canonical-away", "neutral-away"]);
  assert.deepEqual(
    resolveThermalReceiptEmblemSources({ neutralTeamMarkUrls: { home: "neutral-home" } }).home,
    ["neutral-home"],
  );
});

test("optional thermal rows collapse without leaving internal gaps", () => {
  const full = getThermalReceiptLayout({ hasPhoto: false, hasPeriods: true, hasComment: true });
  const noPeriods = getThermalReceiptLayout({ hasPhoto: false, hasPeriods: false, hasComment: true });
  const noComment = getThermalReceiptLayout({ hasPhoto: false, hasPeriods: true, hasComment: false });
  const compact = getThermalReceiptLayout({ hasPhoto: false, hasPeriods: false, hasComment: false });

  assert.equal(noPeriods.periods, null);
  assert.equal(full.result.y - noPeriods.result.y, 186);
  assert.equal(full.footer.y - noPeriods.footer.y, 186);
  assert.equal(full.paper.height - noPeriods.paper.height, 186);
  assert.equal(full.result.height - noComment.result.height, 40);
  assert.equal(full.footer.y - noComment.footer.y, 40);
  assert.equal(full.paper.height - noComment.paper.height, 40);
  assert.ok(full.info.y + full.info.height < full.periods.y);
  assert.ok(full.periods.y + full.periods.height < full.result.y);
  assert.ok(full.result.y + full.result.height < full.footer.y);
  for (const layout of [full, noPeriods, noComment, compact]) {
    assert.equal(layout.paper.y + layout.paper.height - (layout.footer.y + layout.footer.height), 24);
  }
});

test("thermal editor and canvas share one photo transform model", () => {
  const value = { photoX: 36, photoY: -18, photoZoom: 1.4, photoRotation: 12 };
  const aspect = 684 / 288;
  const transform = getReceiptPhotoTransform(value, aspect);
  const style = getReceiptPhotoStyle(value, aspect);

  assert.equal(style["--receipt-photo-position-x"], `${transform.positionX * 100}%`);
  assert.equal(style["--receipt-photo-position-y"], `${transform.positionY * 100}%`);
  assert.equal(style["--receipt-photo-shift-x"], `${transform.shiftXRatio * 100}%`);
  assert.equal(style["--receipt-photo-shift-y"], `${transform.shiftYRatio * 100}%`);
  assert.equal(style["--receipt-photo-scale"], transform.scale);
  assert.equal(style["--receipt-photo-rotation"], "12deg");
});

test("thermal comment removes markup and controls then enforces the shared 22-character limit", () => {
  const sanitized = sanitizeThermalReceiptComment("  <b>4쿼터</b>\n 12점\u0000 차를 뒤집은 역전승  ");
  assert.equal(sanitized, "4쿼터 12점 차를 뒤집은 역전승");
  assert.equal(getThermalReceiptTextWeight(sanitized), 18);

  const limited = sanitizeThermalReceiptComment("가".repeat(40));
  assert.equal(limited, "가".repeat(22));
  assert.equal(getThermalReceiptTextWeight(limited), 22);
  assert.deepEqual(getMatchReceiptCommentLines("가".repeat(22)), ["가".repeat(11), "가".repeat(11)]);
});

test("manual receipt player count is derived from the canonical match format", () => {
  assert.equal(getMatchReceiptFormatPlayerCount("1v1"), 2);
  assert.equal(getMatchReceiptFormatPlayerCount("2v2"), 4);
  assert.equal(getMatchReceiptFormatPlayerCount("3v3"), 6);
  assert.equal(getMatchReceiptFormatPlayerCount("3x3"), 6);
  assert.equal(getMatchReceiptFormatPlayerCount("5v5"), 10);
  assert.equal(getMatchReceiptFormatPlayerCount("unknown"), 0);
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
