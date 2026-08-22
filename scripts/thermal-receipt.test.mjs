import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createThermalRandom,
  getMatchReceiptCommentLines,
  getMatchReceiptFormatPlayerCount,
  getThermalReceiptLayout,
  getThermalReceiptTextWeight,
  getThermalScoreSlotLayout,
  sanitizeMatchReceiptCommentInput,
  sanitizeThermalReceiptComment,
  THERMAL_PRINT_ROLES,
} from "../shared/lib/thermalReceipt.js";
import { resolveThermalReceiptEmblemSources } from "../src/lib/thermalReceipt.js";
import {
  getReceiptPhotoStyle,
  getReceiptPhotoTransform,
} from "../src/lib/receiptPhotoTransform.js";

test("thermal Story exports paper only while Feed keeps its backdrop", async () => {
  const renderer = await readFile(new URL("../src/lib/thermalReceipt.js", import.meta.url), "utf8");

  assert.match(renderer, /if \(preset === "story"\)[\s\S]*createCanvas\(layout\.paper\.width, layout\.paper\.height\)/u);
  assert.match(renderer, /layout\.paper\.x,[\s\S]*layout\.paper\.y,[\s\S]*layout\.paper\.width,[\s\S]*layout\.paper\.height/u);
  assert.match(renderer, /preset === "feed" \? \{ width: 1080, height: 1350 \}/u);
  assert.match(renderer, /drawBackdrop\(outputCtx, background\)/u);
});

test("thermal receipt keeps the canonical Story paper geometry", () => {
  const photo = getThermalReceiptLayout({ hasPhoto: true, hasPeriods: true, hasComment: true });
  const plain = getThermalReceiptLayout({ hasPhoto: false, hasPeriods: true, hasComment: true });

  assert.deepEqual(photo.paper, { x: 142, y: 24, width: 796, height: 1872 });
  assert.deepEqual(plain.paper, { x: 142, y: 24, width: 796, height: 1618 });
  assert.deepEqual(photo.content, { x: 198, width: 684 });
  assert.equal(photo.photo.height, 288);
  assert.equal(photo.brand.y, plain.brand.y);
  assert.equal(plain.teams.y, 246);
  assert.equal(plain.score.y, 484);
  assert.equal(plain.info.y, 722);
  assert.equal(plain.periods.y, 864);
  assert.equal(plain.result.y, 1050);
  assert.equal(plain.footer.y, 1334);
  for (const region of ["teams", "score", "info", "periods", "footer"]) {
    assert.equal(
      photo[region].y - plain[region].y,
      294,
      `${region} accounts for the compact no-photo header`,
    );
  }
  assert.equal(photo.paper.y + photo.paper.height - (photo.footer.y + photo.footer.height), 24);
  assert.equal(plain.paper.y + plain.paper.height - (plain.footer.y + plain.footer.height), 64);
});

test("thermal paper uses the authored edge alpha as its only torn silhouette", async () => {
  const renderer = await readFile(new URL("../src/lib/thermalReceipt.js", import.meta.url), "utf8");
  const edge = await readFile(new URL("../public/assets/thermal-receipt/serration-edge-796x16.svg", import.meta.url), "utf8");

  assert.match(renderer, /globalCompositeOperation = "destination-in"/u);
  assert.doesNotMatch(renderer, /function paperPath|const tooth =/u);
  assert.doesNotMatch(edge, /<pattern|id="tooth"/u);
});

test("thermal emblems preserve grayscale detail and QR ink gets its own dense mask", async () => {
  const renderer = await readFile(new URL("../src/lib/thermalReceipt.js", import.meta.url), "utf8");

  assert.match(renderer, /const errors = new Float32Array\(168 \* 168\)/u);
  assert.match(renderer, /luminance \* alpha \+ 255 \* \(1 - alpha\) \+ errors\[pixelIndex\]/u);
  assert.match(renderer, /error \* 7 \/ 16/u);
  assert.match(renderer, /applyPrintMask\(inkLayer, ctx\.__thermalMasks\?\.heavy,[\s\S]*"qr"\)/u);
});

test("thermal receipt always ends the shared emblem chain with a fixed neutral mark", () => {
  const sources = resolveThermalReceiptEmblemSources({
    teamEmblemUrls: { home: "canonical-home", away: "canonical-away" },
    neutralTeamMarkUrls: { home: "neutral-home", away: "neutral-away" },
  }, {
    teamLineArtUrls: { home: "selected-home", away: "canonical-away" },
  });

  assert.deepEqual(sources.home, ["selected-home", "canonical-home", "neutral-home", "/assets/tier-emblems/tier-neutral-home-outline-v5.png"]);
  assert.deepEqual(sources.away, ["canonical-away", "neutral-away", "/assets/tier-emblems/tier-neutral-away-outline-v5.png"]);
  assert.deepEqual(
    resolveThermalReceiptEmblemSources({ neutralTeamMarkUrls: { home: "neutral-home" } }).home,
    ["neutral-home", "/assets/tier-emblems/tier-neutral-home-outline-v5.png"],
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
    assert.equal(layout.paper.y + layout.paper.height - (layout.footer.y + layout.footer.height), 64);
  }
});

test("photo layouts preserve the paper bottom while optional rows collapse", () => {
  for (const options of [
    { hasPhoto: true, hasPeriods: true, hasComment: true },
    { hasPhoto: true, hasPeriods: false, hasComment: true },
    { hasPhoto: true, hasPeriods: true, hasComment: false },
    { hasPhoto: true, hasPeriods: false, hasComment: false },
  ]) {
    const layout = getThermalReceiptLayout(options);
    assert.equal(layout.brand.y, 72);
    assert.equal(layout.footer.y, 1628);
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
  assert.equal(sanitizeMatchReceiptCommentInput("역전승 "), "역전승 ");
  assert.equal(sanitizeMatchReceiptCommentInput("역전승 명경기"), "역전승 명경기");

  const sanitized = sanitizeThermalReceiptComment("  <b>4쿼터</b>\n 12점\u0000 차를 뒤집은 역전승  ");
  assert.equal(sanitized, "4쿼터 12점 차를 뒤집은 역전승");
  assert.equal(getThermalReceiptTextWeight(sanitized), 18);

  const limited = sanitizeThermalReceiptComment("가".repeat(40));
  assert.equal(limited, "가".repeat(22));
  assert.equal(getThermalReceiptTextWeight(limited), 22);
  assert.deepEqual(getMatchReceiptCommentLines("가".repeat(22)), ["가".repeat(11), "가".repeat(11)]);
});

test("thermal result comment renders once without forced line splitting", async () => {
  const renderer = await readFile(new URL("../src/lib/thermalReceipt.js", import.meta.url), "utf8");

  assert.match(renderer, /drawThermalText\(ctx, sanitizeMatchReceiptComment\(model\.comment\), box\.x \+ 22, box\.y \+ 226/u);
  assert.doesNotMatch(renderer, /getMatchReceiptCommentLines\(model\.comment\)|lines\.forEach/u);
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

test("thermal print roles keep supplied masks separate and preserve dense QR ink", () => {
  assert.deepEqual(THERMAL_PRINT_ROLES, {
    body: { mask: "body", opacity: 0.84 },
    team: { mask: "team", opacity: 0.9 },
    heavy: { mask: "heavy", opacity: 0.92 },
    photo: { mask: "photo", opacity: 0.88 },
    qr: { mask: "heavy", opacity: 0.97 },
  });
});
