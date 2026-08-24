import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import sharp from "sharp";
import { createEdgeConnectedBackdropMask } from "../shared/lib/receiptEmblemBackdrop.js";
import {
  canCreatePublicMatchReceiptSnapshot,
  createDefaultMatchReceiptDraft,
  createMatchReceiptViewModel,
  formatMatchReceiptScoreboardScore,
  getMatchReceiptDraftFromMatch,
  getMatchReceiptFormatLabel,
  getMatchReceiptPhotoStyle,
  getRecordedMatchReceiptPlayerCount,
  getMatchReceiptSideTeamId,
  getMatchReceiptTeamNameScale,
  MATCH_RECEIPT_LIMITS,
  MATCH_RECEIPT_DRAFT_TTL_MS,
  MATCH_RECEIPT_PHOTO_ASPECT,
  normalizeMatchReceiptDraft,
  renewMatchReceiptDraft,
  resolveMatchReceiptTeamEmblems,
} from "../src/lib/matchReceipt.js";
import {
  applyReceiptLocaleToUrl,
  getReceiptLocale,
  getReceiptSearchWithLocale,
  RECEIPT_SHELL_COPY,
} from "../src/lib/receiptLocale.js";
import {
  EMBLEM_GRAYSCALE_LEVELS,
  getThermalEmblemForegroundPlacement,
  grayscaleThermalPixels,
  quantizeThermalEmblemPixels,
} from "../src/lib/thermalReceipt.js";
import { getThermalReceiptLayout } from "../shared/lib/thermalReceipt.js";

async function assertGrayscalePng(png) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let opaquePixels = 0;
  assert.equal(info.channels, 4);
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] !== 255) continue;
    opaquePixels += 1;
    assert.equal(data[index], data[index + 1]);
    assert.equal(data[index], data[index + 2]);
  }
  assert.ok(opaquePixels > 0);
}

test("receipt English locale stays in the URL and localizes the receipt shell", async () => {
  assert.equal(getReceiptLocale({ pathname: "/app/receipt", search: "?lang=en" }), "en");
  assert.equal(getReceiptLocale({ pathname: "/app/receipt", search: "?code=BT-12345678" }), "ko");
  assert.equal(getReceiptLocale({ pathname: "/app/settings", search: "?lang=en" }), "ko");
  assert.equal(getReceiptSearchWithLocale("?code=BT-12345678", "en"), "?code=BT-12345678&lang=en");
  assert.equal(getReceiptSearchWithLocale("?code=BT-12345678&lang=en", "ko"), "?code=BT-12345678");
  assert.equal(applyReceiptLocaleToUrl(new URL("https://boxtier.kr/app/receipt?code=BT-12345678"), "en").searchParams.get("lang"), "en");
  assert.equal(RECEIPT_SHELL_COPY.en.home, "Home");
  assert.equal(RECEIPT_SHELL_COPY.en.moreMenu, "More menu");
  assert.equal(RECEIPT_SHELL_COPY.en.privacyPolicy, "Privacy Policy");

  const [sidebar, bottomNav, footer] = await Promise.all([
    readFile(new URL("../src/components/layout/Sidebar.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/layout/BottomNav.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/layout/DataAttribution.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(sidebar, /RECEIPT_SHELL_COPY\[getReceiptLocale\(location\)\]/);
  assert.match(bottomNav, /RECEIPT_SHELL_COPY\[getReceiptLocale\(location\)\]/);
  assert.match(footer, /RECEIPT_SHELL_COPY\[getReceiptLocale\(location\)\]/);
});

test("receipt format selector uses clear labels and preloads thermal assets", async () => {
  const [page, thermalRenderer] = await Promise.all([
    readFile(new URL("../src/pages/MatchReceipt.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/thermalReceipt.js", import.meta.url), "utf8"),
  ]);

  assert.match(page, /style: "출력 형식", scoreStyle: "스코어 포스터", thermalStyle: "감열지 영수증"/u);
  assert.match(page, /style: "Output format", scoreStyle: "Score Poster", thermalStyle: "Thermal Receipt"/u);
  assert.match(page, /className="match-receipt-preview-head"[\s\S]*className="ui-segmented-control segmented-control compact-segments match-receipt-preview-style"/u);
  assert.doesNotMatch(page, /match-receipt-output-format|match-receipt-compact-toggle/u);
  assert.match(page, /preloadThermalReceiptAssets\(\)\.catch\(\(\) => \{\}\)/u);
  assert.match(thermalRenderer, /export function preloadThermalReceiptAssets\(\)/u);
  assert.match(thermalRenderer, /Object\.values\(THERMAL_ASSET_PATHS\)\.map\(loadAssetImage\)/u);
});
import { getMatchHashtag } from "../shared/lib/handles.js";
import {
  formatMatchPublicCode,
  normalizeMatchPublicCode,
} from "../shared/lib/matchPublicCode.js";

test("receipt team names shrink before they can overflow", () => {
  assert.equal(getMatchReceiptTeamNameScale("SHORT TEAM"), 1);
  assert.equal(getMatchReceiptTeamNameScale("ABCDEFGHIJKLM"), 0.88);
  assert.equal(getMatchReceiptTeamNameScale("ABCDEFGHIJKLMNOPQ"), 0.78);
  assert.equal(getMatchReceiptTeamNameScale("ABCDEFGHIJKLMNOPQRSTU"), 0.68);
});

test("receipt photo scoreboard formats canonical final scores for the PNG atlas", () => {
  assert.equal(MATCH_RECEIPT_LIMITS.score, 999);
  assert.equal(formatMatchReceiptScoreboardScore(7), "07");
  assert.equal(formatMatchReceiptScoreboardScore(72), "72");
  assert.equal(formatMatchReceiptScoreboardScore(100), "100");
  assert.equal(formatMatchReceiptScoreboardScore(999), "999");
  assert.equal(formatMatchReceiptScoreboardScore(108), "108");
});

test("receipt nature label keeps the same five pixel score clearance in preview and saved images", async () => {
  const [styles, renderer] = await Promise.all([
    readFile(new URL("../src/styles/features/match-receipt.css", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/matchReceipt.js", import.meta.url), "utf8"),
  ]);

  assert.match(styles, /\.match-receipt-poster-score > span\s*\{[^}]*transform:\s*translateY\(-5px\)/s);
  assert.match(renderer, /ctx\.fillText\(model\.matchNatureLabel, width \/ 2, scoreTop \+ \(compact \? 2 : 12\)\)/);
});

test("receipt photo editing keeps one aspect-aware transform and defers thermal rerenders during gestures", async () => {
  const [page, thermalPreview, photoTransform] = await Promise.all([
    readFile(new URL("../src/pages/MatchReceipt.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/match/ThermalReceiptPreview.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/receiptPhotoTransform.js", import.meta.url), "utf8"),
  ]);

  assert.match(page, /const photoEditorAspect = isThermal \? THERMAL_RECEIPT_PHOTO_ASPECT : MATCH_RECEIPT_PHOTO_ASPECT/);
  assert.match(page, /style=\{\{ aspectRatio: photoEditorAspect \}\}/);
  assert.match(page, /getMatchReceiptPhotoStyle\(draft, photoEditorAspect\)/);
  assert.match(page, /suspendRender=\{photoGestureActive\}/);
  assert.match(thermalPreview, /if \(suspendRender\) return undefined/);
  assert.match(photoTransform, /export function drawReceiptCoverPhoto/);
});

test("official receipt player count includes played players and reserves without duplicates", () => {
  const match = {
    teamA: { players: ["a", "b", "c"] },
    teamB: { players: ["d", "e", "f"] },
    playedPlayerIds: { teamA: ["a", "g"], teamB: ["h"] },
    reservePlayers: { teamA: ["i", "a"], teamB: ["j"] },
    reserve_players: { home: ["k"], away: ["j"] },
    rules: {
      playedPlayerIds: { teamA: ["l"], teamB: [] },
      reservePlayers: { teamA: ["m"], teamB: [] },
    },
  };

  assert.equal(getRecordedMatchReceiptPlayerCount(match), 13);
  assert.equal(getRecordedMatchReceiptPlayerCount({ result: { playerCount: 12 } }), 12);
});

test("public receipt lookup blocks editor and QR fallback while paper stats use ink digits", async () => {
  const [page, preview, styles, qrComponent] = await Promise.all([
    readFile(new URL("../src/pages/MatchReceipt.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/match/MatchReceiptPreview.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/styles/features/match-receipt.css", import.meta.url), "utf8"),
    readFile(new URL("../src/components/common/QrCode.jsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /const \[publicCodeLookup, setPublicCodeLookup\]/);
  assert.match(page, /requestedPublicCode && !draft\.publicCode/);
  assert.match(page, /lookupError\.status === 404/);
  assert.match(page, /setPublicCodeLookupAttempt/);
  assert.match(page, /requestedPublicCode \? \(/);
  assert.match(preview, /tone="paper-ink"/);
  assert.match(
    styles,
    /\.match-receipt-stat-digits\.is-paper-ink[\s\S]*?filter:\s*brightness\(0\) saturate\(100%\)/,
  );
  assert.match(qrComponent, /useLayoutEffect/);
  assert.doesNotMatch(qrComponent, /requestAnimationFrame/);
});

test("receipt emblems allow style-specific local adjustment while canonical teams remain reusable", async () => {
  const [receiptPage, emblemEditor, thermalRenderer, teamPage, teamView, teamActions, teamApi, teamColumns, migration] = await Promise.all([
    readFile(new URL("../src/pages/MatchReceipt.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/common/EmblemCropEditor.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/thermalReceipt.js", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/TeamDetail.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/TeamDetailView.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/appData/actions/profileTeamActions.js", import.meta.url), "utf8"),
    readFile(new URL("../server/api/teams/emblem.js", import.meta.url), "utf8"),
    readFile(new URL("../shared/lib/repositoryColumns.js", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260815130000_team_receipt_emblem_upload_policy.sql", import.meta.url), "utf8"),
  ]);

  assert.match(receiptPage, /사진을 골라 선화 엠블럼으로 바로 사용할 수 있습니다\./u);
  assert.match(receiptPage, /로그인 후 팀을 만들면 팀 상세에 저장해 다음 영수증에서도 재사용할 수 있습니다\./u);
  assert.match(receiptPage, /엠블럼을 고르면 내부만 감열 4단계 회색조로 변환합니다\./u);
  assert.match(receiptPage, /직접 선택한 이미지는 이번 영수증에서만 유지됩니다\./u);
  assert.match(emblemEditor, /AI 프롬프트 복사/u);
  assert.match(receiptPage, /conversionMode=\{isThermal \? "monochrome" : "line-art"\}/u);
  assert.match(receiptPage, /onConvert=\{isThermal \? undefined : convertLocalTeamEmblem\}/u);
  assert.deepEqual(EMBLEM_GRAYSCALE_LEVELS, [18, 70, 124, 176]);
  assert.match(thermalRenderer, /if \(data\[index \+ 3\] === 0\) continue/u);
  const drawEmblemStart = thermalRenderer.indexOf("function drawEmblem");
  const drawEmblemEnd = thermalRenderer.indexOf("function drawTeams", drawEmblemStart);
  assert.notEqual(drawEmblemStart, -1);
  assert.notEqual(drawEmblemEnd, -1);
  const drawEmblemSource = thermalRenderer.slice(drawEmblemStart, drawEmblemEnd);
  assert.doesNotMatch(drawEmblemSource, /quantizeThermalEmblemPixels\(pixels\.data/u);
  assert.match(drawEmblemSource, /getThermalEmblemForegroundPlacement/u);
  assert.match(drawEmblemSource, /applyPrintMask\(\s*ringLayer/u);
  assert.match(thermalRenderer, /if \(!layout\.hasPeriods\)[\s\S]*?drawRule\(ctx, layout\.info\.x, layout\.info\.y \+ 144/u);
  assert.match(thermalRenderer, /grayscaleThermalCanvas\(base\)/u);
  assert.doesNotMatch(thermalRenderer, /const isEmblem/u);
  assert.match(receiptPage, /저장된 팀 엠블럼 없음/u);
  assert.match(receiptPage, /로그인 · 팀 만들고 엠블럼 저장/u);
  assert.match(receiptPage, /EmblemCropEditor/u);
  assert.match(receiptPage, /prepareTeamEmblemUpload/u);
  assert.match(receiptPage, /MATCH_RECEIPT_LINE_ART_AI_PROMPT/u);
  const emblemSource = await readFile(new URL("../src/lib/matchReceiptEmblem.js", import.meta.url), "utf8");
  assert.match(emblemSource, /Convert the attached team emblem into clean line art/u);
  assert.doesNotMatch(emblemSource, /첨부한 팀 엠블럼/u);
  assert.doesNotMatch(receiptPage, /uploadGuestReceiptEmblem/u);
  assert.match(teamView, /영수증 엠블럼 만들기/u);
  assert.match(teamView, /영수증 엠블럼 변경/u);
  assert.match(teamPage, /createMatchReceiptLineArt/u);
  assert.match(teamActions, /action: "receipt-upload"/u);
  assert.match(teamApi, /rankball_update_team_receipt_emblem/u);
  assert.match(teamColumns, /receipt_emblem_key,receipt_emblem_updated_at,receipt_emblem_uploaded_at,receipt_emblem_upload_count/u);
  assert.match(migration, /create or replace function public\.rankball_update_team_receipt_emblem/u);
  assert.match(migration, /role = 'captain'/u);
  assert.match(migration, /team_receipt_emblem_cooldown/u);
  assert.match(migration, /interval '30 days'/u);
  assert.match(receiptPage, /resolveMatchReceiptTeamEmblems\(/u);
  assert.match(receiptPage, /canonical:\s*canonicalTeamReceiptEmblemUrls/u);
  assert.match(receiptPage, /local:\s*localTeamEmblemUrls/u);
  assert.match(receiptPage, /const activeEmblemUrl = selectedTeamReceiptEmblemUrls\[side\]/u);
  assert.match(teamView, /disabled=\{receiptEmblemPending \|\| receiptEmblemUploadLocked\}/u);
});

test("thermal emblem D conversion preserves transparency and keeps receipt paper continuous", () => {
  const emblemPixels = new Uint8ClampedArray([
    250, 250, 250, 0,
    150, 100, 50, 255,
  ]);
  quantizeThermalEmblemPixels(emblemPixels, 2, 1);
  assert.deepEqual([...emblemPixels.slice(0, 4)], [250, 250, 250, 0]);
  assert.ok(EMBLEM_GRAYSCALE_LEVELS.includes(emblemPixels[4]));
  assert.equal(emblemPixels[4], emblemPixels[5]);
  assert.equal(emblemPixels[4], emblemPixels[6]);
  assert.equal(emblemPixels[7], 255);

  const paperPixels = new Uint8ClampedArray([235, 235, 235, 255]);
  grayscaleThermalPixels(paperPixels);
  assert.deepEqual([...paperPixels], [235, 235, 235, 255]);
});

test("receipt emblem foreground is centered and maximized without cropping", () => {
  const width = 100;
  const height = 80;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 20; y < 60; y += 1) {
    for (let x = 60; x < 80; x += 1) {
      data[(y * width + x) * 4 + 3] = 255;
    }
  }

  const placement = getThermalEmblemForegroundPlacement(data, width, height);
  const expectedRadius = Math.hypot(9.5, 19.5);
  assert.equal(placement.centerX, 70);
  assert.equal(placement.centerY, 40);
  assert.equal(placement.radius, expectedRadius);
  assert.equal(placement.scale, 68 / expectedRadius);
});

test("receipt layout keeps a masked separator when period scores are absent", () => {
  const withPeriods = getThermalReceiptLayout({
    hasPhoto: false,
    hasPeriods: true,
    hasComment: true,
  });
  const withoutPeriods = getThermalReceiptLayout({
    hasPhoto: false,
    hasPeriods: false,
    hasComment: true,
  });

  assert.equal(withPeriods.result.y - withPeriods.info.y, 328);
  assert.equal(withoutPeriods.result.y - withoutPeriods.info.y, 170);
});

test("canonical receipt keeps dedicated team receipt emblems through public reload", () => {
  const draft = getMatchReceiptDraftFromMatch({}, {
    homeTeamRecord: {
      emblemSource: "upload",
      emblemKey: "team-general/home.webp",
      receiptEmblemKey: "team-emblems/home/receipt.webp",
    },
    awayTeamRecord: {
      emblemSource: "preset",
      emblemKey: "team-general/away.webp",
      receiptEmblemKey: "team-emblems/away/receipt.webp",
    },
    homeUseLineArt: true,
    awayUseLineArt: false,
  });
  const projected = projectPublicReceiptDraft({
    ...draft,
    _canonicalReceipt: true,
  });
  const reloaded = createMatchReceiptViewModel(projected);

  assert.equal(projected.homeEmblemKey, "team-emblems/home/receipt.webp");
  assert.equal(projected.awayEmblemKey, "team-emblems/away/receipt.webp");
  assert.match(reloaded.teamEmblemUrls.home, /team-emblems\/home\/receipt\.webp$/u);
  assert.equal(reloaded.teamEmblemUrls.away, "");
});

test("receipt emblem resolver prefers current local line art over canonical team emblems", () => {
  assert.deepEqual(resolveMatchReceiptTeamEmblems({
    local: { home: "local-home" },
    guest: { home: "guest-home", away: "guest-away" },
    canonical: { home: "team-home", away: "team-away" },
    enabled: { home: true, away: true },
  }), { home: "local-home", away: "team-away" });
  assert.deepEqual(resolveMatchReceiptTeamEmblems({
    local: { home: "local-home" },
    canonical: { home: "team-home", away: "team-away" },
    enabled: { home: false, away: true },
  }), { home: "", away: "team-away" });
});
import {
  createReceiptClonePayload,
  createCanonicalReceiptSerialSeed,
  createReceiptCapability,
  getLegacyCanonicalReceiptMatchId,
  getReceiptCapabilityCookie,
  hashReceiptCapability,
  projectPublicReceiptDraft,
  receiptCapabilityMatches,
  sanitizeReceiptDraftPayload,
  setReceiptCapabilityCookie,
} from "../server/api/match-receipts/_draftSecurity.js";
import {
  cleanDraftReceiptEmblemKey,
  cleanMatchReceiptEmblemKey,
  getSafeDraftReceiptEmblems,
  getSafeMatchReceiptEmblems,
  validatePreparedReceiptEmblem,
} from "../server/api/match-receipts/_emblemStorage.js";
import { handlePublicReceipt } from "../server/api/match-receipts/public.js";
import { handleCreateReceipt } from "../server/api/match-receipts/create.js";
import { handleRenderReceipt } from "../server/api/match-receipts/render.js";
import { prepareReceiptEmblems } from "../server/api/match-receipts/_emblemProcessor.js";
import {
  cleanupExpiredMatchReceipts,
  cleanupMcpReceiptGenerationEvents,
  cleanupMatchReceiptEvents,
} from "../server/api/system/maintenance.js";
import { parseExternalReceiptInput } from "../server/api/match-receipts/_createInput.js";
import { RECORD_TYPES } from "../src/lib/constants.js";
import { getTierDivision, getTierLabel } from "../shared/lib/tier.js";

function createApiResponse() {
  return {
    body: null,
    headers: {},
    statusCode: 0,
    setHeader(name, value) { this.headers[name] = value; },
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    end(body) {
      this.body = body;
      return this;
    },
  };
}

function createPublicReceiptSupabase({ allowed = true, row = null } = {}) {
  return {
    async rpc(name) {
      assert.equal(name, "consume_match_receipt_draft_read_quota");
      return { data: allowed, error: null };
    },
    from(table) {
      assert.equal(table, "match_receipt_drafts");
      return {
        select() { return this; },
        eq() { return this; },
        gt() { return this; },
        order() { return this; },
        limit() { return this; },
        async maybeSingle() { return { data: row, error: null }; },
      };
    },
  };
}

function createReceiptSupabase({ allowed = true } = {}) {
  let inserted = null;
  return {
    get inserted() { return inserted; },
    async rpc(name) {
      assert.equal(name, "consume_match_receipt_draft_quota");
      return { data: allowed, error: null };
    },
    from(table) {
      assert.equal(table, "match_receipt_drafts");
      return {
        insert(value) { inserted = value; return this; },
        select() { return this; },
        async single() {
          return {
            data: {
              public_id: inserted.public_id,
              public_code: "BT-00000456",
              expires_at: "2026-09-21T00:00:00.000Z",
            },
            error: null,
          };
        },
      };
    },
  };
}

test("external receipt input requires style and validates period totals", () => {
  const missingStyle = parseExternalReceiptInput({
    homeTeam: "HOME",
    awayTeam: "AWAY",
    homeScore: 30,
    awayScore: 28,
    playedOn: "2026-08-22",
    venue: "BOXTIER COURT",
    format: "5v5",
  });
  assert.deepEqual(missingStyle.issues[0], { field: "style", code: "required_style" });

  const badPeriods = parseExternalReceiptInput({
    style: "classic-thermal",
    homeTeam: "HOME",
    awayTeam: "AWAY",
    homeScore: 30,
    awayScore: 28,
    playedOn: "2026-08-22",
    venue: "BOXTIER COURT",
    format: "5v5",
    periodScores: [
      { label: "1Q", homeScore: 15, awayScore: 14 },
      { label: "2Q", homeScore: 14, awayScore: 14 },
    ],
  });
  assert.ok(badPeriods.issues.some((item) => item.code === "totals_must_match_final_score"));
});

test("external receipt input rejects every emblem field", () => {
  const parsed = parseExternalReceiptInput({
    style: "boxtier-score",
    homeTeam: "HOME",
    awayTeam: "AWAY",
    homeScore: 10,
    awayScore: 8,
    playedOn: "2026-08-22",
    venue: "COURT",
    format: "3x3",
    homeEmblem: { imageBase64: "UklGRg==" },
  });
  assert.ok(parsed.issues.some((item) => item.field === "emblem"
    && item.code === "external_emblem_not_supported"));

  const emptyKey = parseExternalReceiptInput({
    style: "boxtier-score",
    homeTeam: "HOME",
    awayTeam: "AWAY",
    homeScore: 10,
    awayScore: 8,
    playedOn: "2026-08-22",
    venue: "COURT",
    format: "3x3",
    homeEmblemKey: "",
  });
  assert.ok(emptyKey.issues.some((item) => item.field === "emblem"
    && item.code === "external_emblem_not_supported"));
});

test("external receipt PNG input accepts only prepared emblem objects", () => {
  const imageBase64 = Buffer.from("prepared-emblem").toString("base64");
  const parsed = parseExternalReceiptInput({
    style: "boxtier-score",
    homeTeam: "HOME",
    awayTeam: "AWAY",
    homeScore: 10,
    awayScore: 8,
    playedOn: "2026-08-22",
    venue: "COURT",
    format: "3x3",
    homeEmblem: { imageBase64 },
  }, { allowPreparedEmblems: true });
  assert.deepEqual(parsed.emblems, {
    home: { imageBase64 },
    away: null,
  });

  const remote = parseExternalReceiptInput({
    style: "boxtier-score",
    homeTeam: "HOME",
    awayTeam: "AWAY",
    homeScore: 10,
    awayScore: 8,
    playedOn: "2026-08-22",
    venue: "COURT",
    format: "3x3",
    homeEmblem: { imageBase64: "data:image/webp;base64,UklGRg==" },
  }, { allowPreparedEmblems: true });
  assert.ok(remote.issues.some((item) => item.field === "homeEmblem"
    && item.code === "raw_image_base64_required"));

  const objectKey = parseExternalReceiptInput({
    style: "boxtier-score",
    homeTeam: "HOME",
    awayTeam: "AWAY",
    homeScore: 10,
    awayScore: 8,
    playedOn: "2026-08-22",
    venue: "COURT",
    format: "3x3",
    homeEmblemKey: "team-emblems/home.webp",
  }, { allowPreparedEmblems: true });
  assert.ok(objectKey.issues.some((item) => item.field === "emblem"
    && item.code === "external_emblem_not_supported"));
});

test("prepared receipt emblem validation preserves safe square WebP bytes", async () => {
  const square = await sharp({
    create: { width: 64, height: 64, channels: 4, background: { r: 214, g: 165, b: 34, alpha: 1 } },
  }).webp().toBuffer();
  const normalized = await validatePreparedReceiptEmblem(square.toString("base64"));
  assert.equal(normalized.dimensions.width, 64);
  assert.equal(normalized.dimensions.height, 64);
  assert.equal(Buffer.from(normalized.bytes).equals(square), true);

  const rectangle = await sharp({
    create: { width: 64, height: 32, channels: 4, background: { r: 214, g: 165, b: 34, alpha: 1 } },
  }).webp().toBuffer();
  await assert.rejects(
    validatePreparedReceiptEmblem(rectangle.toString("base64")),
    (error) => error.statusCode === 400 && error.message === "receipt_emblem_invalid_square_required",
  );
});

test("receipt emblem backdrop removal preserves enclosed light artwork", () => {
  const width = 7;
  const height = 7;
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4;
    pixels[offset] = 255;
    pixels[offset + 1] = 255;
    pixels[offset + 2] = 255;
    pixels[offset + 3] = 255;
  }

  const setBlack = (x, y) => {
    const offset = (y * width + x) * 4;
    pixels[offset] = 0;
    pixels[offset + 1] = 0;
    pixels[offset + 2] = 0;
  };

  for (let value = 2; value <= 4; value += 1) {
    setBlack(value, 2);
    setBlack(value, 4);
    setBlack(2, value);
    setBlack(4, value);
  }

  const mask = createEdgeConnectedBackdropMask(
    pixels,
    width,
    height,
    { red: 255, green: 255, blue: 255 },
    { alphaThreshold: 1, maxDistance: 0 },
  );

  assert.equal(mask[0], 1);
  assert.equal(mask[3 * width + 3], 0);
  assert.equal(mask[2 * width + 3], 0);
});

test("thermal receipt emblem centers visible artwork inside the circular safe area using D four tones", async () => {
  const asymmetric = await sharp(Buffer.from(`<svg width="320" height="320" xmlns="http://www.w3.org/2000/svg">
    <path d="M192 12 232 101 306 147 229 183 198 307 159 220 69 191 150 139Z" fill="#ececec"/>
    <path d="M192 49 215 115 267 148 211 168 190 267 168 197 106 181 170 145Z" fill="#969696"/>
    <circle cx="187" cy="154" r="38" fill="#505050"/>
    <path d="M160 154h54M187 127v54" stroke="#141414" stroke-width="13"/>
  </svg>`)).webp({ lossless: true }).toBuffer();
  const { home } = await prepareReceiptEmblems({
    home: { imageBase64: asymmetric.toString("base64") },
  }, { style: "classic-thermal" });
  const prepared = Buffer.from(home.imageBase64, "base64");
  const { data, info } = await sharp(prepared).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let alphaTotal = 0;
  let weightedX = 0;
  let weightedY = 0;
  let hasAntialiasedPixel = false;
  const pixels = [];

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const index = (y * info.width + x) * 4;
      if (data[index + 3] < 36) continue;
      alphaTotal += data[index + 3];
      weightedX += (x + 0.5) * data[index + 3];
      weightedY += (y + 0.5) * data[index + 3];
      pixels.push({
        x: x + 0.5,
        y: y + 0.5,
        tone: data[index],
        alpha: data[index + 3],
      });
      assert.equal(data[index], data[index + 1]);
      assert.equal(data[index], data[index + 2]);
      if (data[index + 3] < 255) hasAntialiasedPixel = true;
    }
  }

  const centerX = weightedX / alphaTotal;
  const centerY = weightedY / alphaTotal;
  const radius = Math.max(...pixels.map((pixel) => Math.hypot(pixel.x - centerX, pixel.y - centerY)));
  const tones = [
    ...new Set(
      pixels
        .filter(({ alpha }) => alpha === 255)
        .map(({ tone }) => tone),
    ),
  ].sort((a, b) => a - b);

  assert.equal(info.width, 320);
  assert.equal(info.height, 320);
  assert.ok(Math.abs(centerX - 160) <= 1.5, `foreground center x=${centerX}`);
  assert.ok(Math.abs(centerY - 160) <= 1.5, `foreground center y=${centerY}`);
  assert.ok(radius <= 140, `foreground radius=${radius}`);
  assert.equal(hasAntialiasedPixel, true);
  assert.deepEqual(tones, [18, 70, 124, 176]);
});

test("thermal receipt emblem does not stretch low-contrast compression noise across D tones", async () => {
  const lowContrastEmblem = await sharp(Buffer.from(`
    <svg width="320" height="320" xmlns="http://www.w3.org/2000/svg">
      <rect x="60" y="70" width="67" height="180" fill="#888888"/>
      <rect x="127" y="70" width="66" height="180" fill="#8c8c8c"/>
      <rect x="193" y="70" width="67" height="180" fill="#909090"/>
    </svg>
  `)).webp({ lossless: true }).toBuffer();

  const prepared = await prepareReceiptEmblems({
    home: { imageBase64: lowContrastEmblem.toString("base64") },
  }, { style: "classic-thermal" });
  const emblem = Buffer.from(prepared.home.imageBase64, "base64");
  const { data } = await sharp(emblem).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const tones = new Set();
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] !== 255) continue;
    assert.equal(data[index], data[index + 1]);
    assert.equal(data[index], data[index + 2]);
    tones.add(data[index]);
  }

  assert.deepEqual([...tones].sort((a, b) => a - b), [124]);
});

test("external receipt API creates a no-photo thermal draft", async () => {
  const response = createApiResponse();
  const supabase = createReceiptSupabase();
  await handleCreateReceipt({
    method: "POST",
    headers: { "x-forwarded-for": "203.0.113.11" },
    body: {
      style: "classic-thermal",
      locale: "ko",
      homeTeam: "HOME",
      awayTeam: "AWAY",
      homeScore: 30,
      awayScore: 28,
      playedOn: "2026-08-22",
      playedTime: "19:30",
      venue: "BOXTIER COURT",
      format: "5v5",
      tournamentName: "SUMMER CUP",
      comment: "좋은 경기",
      periodScores: [
        { label: "1Q", homeScore: 15, awayScore: 14 },
        { label: "2Q", homeScore: 15, awayScore: 14 },
      ],
    },
  }, response, { supabase });

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.publicCode, "BT-00000456");
  assert.equal(response.body.receipt.receiptStyle, "classic-thermal");
  assert.equal(response.body.receipt.includePhoto, false);
  assert.equal(response.body.receipt.receiptComment, "좋은 경기");
  assert.equal(response.body.receiptPath, "/app/receipt?code=BT-00000456");
  assert.equal("capability" in response.body, false);
  assert.equal(supabase.inserted.payload.verified, false);
});

test("external receipt API rejects emblems before consuming quota", async () => {
  const response = createApiResponse();
  await handleCreateReceipt({
    method: "POST",
    headers: { "x-forwarded-for": "203.0.113.14" },
    body: {
      style: "boxtier-score",
      homeTeam: "HOME",
      awayTeam: "AWAY",
      homeScore: 10,
      awayScore: 8,
      playedOn: "2026-08-22",
      venue: "COURT",
      format: "3x3",
      homeEmblem: { imageBase64: "UklGRg==" },
    },
  }, response, { supabase: null });

  assert.equal(response.statusCode, 422);
  assert.ok(response.body.fields.some((item) => item.field === "emblem"
    && item.code === "external_emblem_not_supported"));
});

test("external receipt PNG API renders a stateless selective-palette thermal story", async () => {
  const response = createApiResponse();
  const emblem = await sharp({
    create: { width: 64, height: 64, channels: 4, background: { r: 214, g: 165, b: 34, alpha: 1 } },
  }).webp().toBuffer();
  await handleRenderReceipt({
    method: "POST",
    headers: { authorization: "Bearer render-secret-0123456789" },
    body: {
      preset: "story",
      style: "classic-thermal",
      homeTeam: "서울 농구단",
      awayTeam: "부산 농구단",
      homeScore: 30,
      awayScore: 28,
      playedOn: "2026-08-22",
      playedTime: "19:30",
      venue: "BOXTIER COURT",
      format: "5v5",
      homeEmblem: { imageBase64: emblem.toString("base64") },
    },
  }, response, { secret: "render-secret-0123456789" });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["Content-Type"], "image/png");
  assert.equal(response.headers["Cache-Control"], "private, no-store, max-age=0");
  assert.equal(Buffer.isBuffer(response.body), true);
  const metadata = await sharp(response.body).metadata();
  assert.equal(metadata.format, "png");
  assert.equal(metadata.width, 796);
  assert.equal(metadata.height, 1420);
  await assertGrayscalePng(response.body);
});

test("external receipt PNG API fits the complete thermal story into a grayscale feed", async () => {
  const response = createApiResponse();
  await handleRenderReceipt({
    method: "POST",
    headers: { authorization: "Bearer render-secret-0123456789" },
    body: {
      preset: "feed",
      style: "classic-thermal",
      homeTeam: "HOME",
      awayTeam: "AWAY",
      homeScore: 30,
      awayScore: 28,
      playedOn: "2026-08-22",
      venue: "COURT",
      format: "5v5",
    },
  }, response, { secret: "render-secret-0123456789" });

  assert.equal(response.statusCode, 200);
  const metadata = await sharp(response.body).metadata();
  assert.equal(metadata.width, 1080);
  assert.equal(metadata.height, 1350);
  await assertGrayscalePng(response.body);
});

test("external receipt PNG API requires its dedicated bearer key", async () => {
  const response = createApiResponse();
  await handleRenderReceipt({ method: "POST", headers: {}, body: {} }, response, {
    secret: "render-secret-0123456789",
    render: async () => Buffer.from("unused"),
  });
  assert.equal(response.statusCode, 401);
  assert.equal(response.body.error, "invalid_receipt_render_api_key");
});

test("receipt maintenance deletes expired drafts and quota events", async () => {
  const calls = [];
  const client = {
    from(table) {
      calls.push(table);
      if (table === "match_receipt_drafts") {
        return {
          select() { return this; },
          lte() { return this; },
          order() { return this; },
          async limit() {
            return {
              data: [{ id: "draft-1", public_id: "public-1", payload: {}, expires_at: "2026-08-20T00:00:00.000Z" }],
              error: null,
            };
          },
          delete() { return this; },
          async eq(field, value) {
            assert.equal(field, "id");
            assert.equal(value, "draft-1");
            return { error: null };
          },
        };
      }
      assert.ok(["match_receipt_draft_events", "mcp_receipt_generation_events"].includes(table));
      return {
        delete(options) {
          assert.deepEqual(options, { count: "exact" });
          return this;
        },
        async lt(field, cutoff) {
          assert.equal(field, "created_at");
          assert.equal(cutoff, table === "match_receipt_draft_events"
            ? "2026-08-21T00:00:00.000Z"
            : "2026-08-20T00:00:00.000Z");
          return { count: table === "match_receipt_draft_events" ? 3 : 4, error: null };
        },
      };
    },
  };
  const now = new Date("2026-08-22T00:00:00.000Z");

  const drafts = await cleanupExpiredMatchReceipts(client, now);
  const events = await cleanupMatchReceiptEvents(client, now);
  const mcpEvents = await cleanupMcpReceiptGenerationEvents(client, now);

  assert.deepEqual(drafts, { ok: true, checked: 1, deletedDrafts: 1, deletedEmblems: 0, failed: 0 });
  assert.deepEqual(events, { ok: true, deleted: 3 });
  assert.deepEqual(mcpEvents, { ok: true, deleted: 4 });
  assert.deepEqual(calls, [
    "match_receipt_drafts",
    "match_receipt_drafts",
    "match_receipt_draft_events",
    "mcp_receipt_generation_events",
  ]);
});

test("external receipt API rejects remote photos before consuming quota", async () => {
  const response = createApiResponse();
  await handleCreateReceipt({
    method: "POST",
    headers: {},
    body: {
      style: "boxtier-score",
      homeTeam: "HOME",
      awayTeam: "AWAY",
      homeScore: 10,
      awayScore: 8,
      playedOn: "2026-08-22",
      venue: "COURT",
      format: "3x3",
      includePhoto: true,
      photoUrl: "https://example.com/game.jpg",
    },
  }, response, { supabase: null });
  assert.equal(response.statusCode, 422);
  assert.ok(response.body.fields.some((item) => item.code === "external_photo_not_supported"));
});

test("external receipt API enforces the shared hourly creation quota", async () => {
  const response = createApiResponse();
  const supabase = createReceiptSupabase({ allowed: false });
  await handleCreateReceipt({
    method: "POST",
    headers: { "x-forwarded-for": "203.0.113.12" },
    body: {
      style: "boxtier-score",
      homeTeam: "HOME",
      awayTeam: "AWAY",
      homeScore: 10,
      awayScore: 8,
      playedOn: "2026-08-22",
      venue: "COURT",
      format: "3x3",
    },
  }, response, { supabase });

  assert.equal(response.statusCode, 429);
  assert.equal(response.headers["Retry-After"], "3600");
  assert.equal(response.body.error, "receipt_draft_rate_limited");
  assert.equal(supabase.inserted, null);
});

test("public receipt API returns safe JSON by public code", async () => {
  const response = createApiResponse();
  const expiresAt = "2026-08-23T00:00:00.000Z";
  const supabase = createPublicReceiptSupabase({
    row: {
      public_id: "receipt-public-id",
      public_code: "BT-00000123",
      expires_at: expiresAt,
      payload: {
        homeTeam: "HOME",
        awayTeam: "AWAY",
        homeScore: 72,
        awayScore: 68,
        originalAddress: "private address",
        personalMmr: 1400,
        profileHashtag: "#1234567",
        officialMatchId: "private-match-id",
      },
    },
  });

  await handlePublicReceipt({
    method: "GET",
    query: { code: "#bt-00000123" },
    headers: { "x-forwarded-for": "203.0.113.10" },
  }, response, { supabase });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.object, "match_receipt");
  assert.equal(response.body.publicCode, "BT-00000123");
  assert.equal(response.body.expiresAt, expiresAt);
  assert.equal(response.body.receipt.homeScore, 72);
  assert.equal("originalAddress" in response.body.receipt, false);
  assert.equal("personalMmr" in response.body.receipt, false);
  assert.equal("profileHashtag" in response.body.receipt, false);
  assert.equal("officialMatchId" in response.body.receipt, false);
  assert.equal("canClaim" in response.body, false);
  assert.equal("capability" in response.body, false);
  assert.equal(
    response.headers["Cache-Control"],
    "public, max-age=30, s-maxage=30, stale-while-revalidate=60",
  );
});

test("public receipt API rejects invalid codes and enforces shared read quota", async () => {
  const invalidResponse = createApiResponse();
  await handlePublicReceipt({ method: "GET", query: { code: "123" }, headers: {} }, invalidResponse, {
    supabase: createPublicReceiptSupabase(),
  });
  assert.equal(invalidResponse.statusCode, 400);
  assert.equal(invalidResponse.body.error, "receipt_public_code_invalid");

  const limitedResponse = createApiResponse();
  await handlePublicReceipt({
    method: "GET",
    query: { code: "BT-00000123" },
    headers: { "x-forwarded-for": "203.0.113.10" },
  }, limitedResponse, { supabase: createPublicReceiptSupabase({ allowed: false }) });
  assert.equal(limitedResponse.statusCode, 429);
  assert.equal(limitedResponse.body.error, "receipt_draft_rate_limited");
  assert.equal(limitedResponse.headers["Retry-After"], "3600");
});

test("public receipt draft keeps only bounded safe fields", () => {
  const payload = sanitizeReceiptDraftPayload({
    homeTeam: `<script>${"A".repeat(40)}`,
    awayTeam: "Away",
    homeScore: 1200,
    awayScore: -3,
    playedOn: "2026-08-11",
    venue: "Court",
    originalAddress: `Seoul ${"B".repeat(120)}`,
    format: "invalid",
    tournamentName: "BOXTIER LEAGUE",
    q1Home: 12,
    q1Away: "",
    homeEmblemKey: "team-emblems/home.png",
    homeUseLineArt: true,
    matchNature: "semifinal",
    comment: "1234567890123456789012345",
    homeColor: "red",
    awayColor: "#ABCDEF",
    homeMmr: 1300,
    awayMmr: 1250,
    personalMmr: 1400,
    profileHashtag: "#1234567",
    hasCanonicalTeamMatch: true,
    personalStatsEligible: true,
    photo: "data:image/jpeg;base64,private",
    photoZoom: 2,
    verified: "yes",
  });

  assert.equal(payload.homeTeam.length <= 24, true);
  assert.equal(payload.homeTeam.includes("<"), false);
  assert.equal(payload.homeScore, 999);
  assert.equal(payload.awayScore, 0);
  assert.equal(payload.originalAddress.length, 96);
  assert.equal(payload.format, "3v3");
  assert.equal(payload.tournamentName, "BOXTIER LEAGUE");
  assert.equal(payload.q1Home, 12);
  assert.equal(payload.q1Away, null);
  assert.equal(payload.homeUseLineArt, true);
  assert.equal("homeEmblemKey" in payload, false);
  assert.equal(payload.matchNature, "semifinal");
  assert.equal(payload.comment, "1234567890123456789012");
  assert.equal(payload.homeColor, "#f05a46");
  assert.equal(payload.awayColor, "#abcdef");
  assert.equal(payload.homeMmr, 1300);
  assert.equal(payload.awayMmr, 1250);
  assert.equal(payload.verified, false);
  assert.equal(payload.personalStatsEligible, false);
  assert.equal("photo" in payload, false);
  assert.equal(payload.photoZoom, 2);
  assert.equal("personalMmr" in payload, false);
  assert.equal("profileHashtag" in payload, false);
  assert.equal("hasCanonicalTeamMatch" in payload, false);
});

test("public receipt draft rejects unknown match nature", () => {
  assert.equal(sanitizeReceiptDraftPayload({ matchNature: "championship" }).matchNature, "competitive");
  assert.equal(sanitizeReceiptDraftPayload({ format: "1v1" }).format, "1v1");
  assert.equal(sanitizeReceiptDraftPayload({ format: "2v2" }).format, "2v2");
  assert.equal(sanitizeReceiptDraftPayload({ format: "other" }).format, "3v3");
});

test("only trusted canonical receipt payload keeps server-only fields", () => {
  const source = {
    personalMmr: 1400,
    profileHashtag: "#1234567",
    hasCanonicalTeamMatch: true,
    verified: true,
    personalStatsEligible: true,
    homeEmblemKey: "team-emblems/home/logo.png",
    awayEmblemKey: "../private.png",
  };
  const trusted = sanitizeReceiptDraftPayload(source, { trustedCanonical: true });
  const untrusted = sanitizeReceiptDraftPayload(source);

  assert.equal(trusted.personalMmr, 1400);
  assert.equal(trusted.profileHashtag, "#1234567");
  assert.equal(trusted.hasCanonicalTeamMatch, true);
  assert.equal(trusted.verified, true);
  assert.equal(trusted.personalStatsEligible, true);
  assert.equal(trusted.homeEmblemKey, "team-emblems/home/logo.png");
  assert.equal(trusted.awayEmblemKey, "");
  assert.equal("personalMmr" in untrusted, false);
  assert.equal("profileHashtag" in untrusted, false);
  assert.equal("hasCanonicalTeamMatch" in untrusted, false);
  assert.equal(untrusted.verified, false);
  assert.equal(untrusted.personalStatsEligible, false);
  assert.equal("homeEmblemKey" in untrusted, false);
});

test("legacy guest receipt emblem keys are cleaned but never publicly projected", () => {
  const publicId = "11111111-1111-4111-8111-111111111111";
  const otherPublicId = "22222222-2222-4222-8222-222222222222";
  const homeKey = `match-receipt-emblems/drafts/${publicId}/home-0123456789abcdef01234567.webp`;
  const awayKey = `match-receipt-emblems/drafts/${publicId}/away-89abcdef0123456789abcdef.webp`;
  const matchId = "m_receipt_11111111111141118111111111111111";
  const matchHomeKey = `match-receipt-emblems/matches/${matchId}/home-fedcba9876543210fedcba98.webp`;

  assert.equal(cleanDraftReceiptEmblemKey(homeKey, publicId, "home"), homeKey);
  assert.equal(cleanDraftReceiptEmblemKey(homeKey, otherPublicId, "home"), "");
  assert.equal(cleanDraftReceiptEmblemKey(homeKey, publicId, "away"), "");
  assert.equal(cleanDraftReceiptEmblemKey("team-emblems/other.webp", publicId, "home"), "");
  assert.deepEqual(getSafeDraftReceiptEmblems({
    homeGuestEmblemKey: homeKey,
    awayGuestEmblemKey: awayKey,
  }, publicId), { home: homeKey, away: awayKey });

  const untrusted = sanitizeReceiptDraftPayload({ homeGuestEmblemKey: homeKey });
  const trusted = sanitizeReceiptDraftPayload({ homeGuestEmblemKey: homeKey, awayGuestEmblemKey: awayKey });
  assert.equal("homeGuestEmblemKey" in untrusted, false);
  assert.equal("homeGuestEmblemKey" in trusted, false);
  assert.equal("awayGuestEmblemKey" in trusted, false);

  const projected = projectPublicReceiptDraft({
    homeGuestEmblemKey: homeKey,
    awayGuestEmblemKey: awayKey,
  }, { publicId });
  assert.equal("homeGuestEmblemKey" in projected, false);
  assert.equal("awayGuestEmblemKey" in projected, false);
  assert.equal("homeEmblemKey" in projected, false);
  assert.equal("awayEmblemKey" in projected, false);
  assert.equal("homeEmblemKey" in projectPublicReceiptDraft({ homeGuestEmblemKey: homeKey }, {
    publicId: otherPublicId,
  }), false);

  assert.equal(cleanMatchReceiptEmblemKey(matchHomeKey, matchId, "home"), matchHomeKey);
  assert.equal(cleanMatchReceiptEmblemKey(matchHomeKey, "m_other", "home"), "");
  assert.deepEqual(getSafeMatchReceiptEmblems({ home: matchHomeKey }, matchId), {
    home: matchHomeKey,
    away: "",
  });
});

test("public receipt projection omits internal address and exact personal rating", () => {
  const projected = projectPublicReceiptDraft({
    _canonicalReceipt: true,
    serialSeed: "canonical:0123456789abcdef",
    originalAddress: "서울특별시 마포구 전체 원주소",
    personalMmr: 1400,
    profileHashtag: "#1234567",
    personalPoints: 12,
    personalStatsEligible: true,
    verified: true,
    hasCanonicalTeamMatch: true,
  });

  assert.equal("originalAddress" in projected, false);
  assert.equal("personalMmr" in projected, false);
  assert.equal("profileHashtag" in projected, false);
  assert.equal(projected.personalPoints, 12);
  assert.equal(projected.personalStatsEligible, true);
  assert.equal(projected.verified, true);
  assert.equal(projected.hasCanonicalTeamMatch, true);
});

test("legacy canonical receipt projection hides the source match id", () => {
  const payload = {
    _canonicalReceipt: true,
    serialSeed: "match:private-personal",
    verified: true,
  };
  const projected = projectPublicReceiptDraft(payload, { serialSecret: "test-secret" });

  assert.equal(getLegacyCanonicalReceiptMatchId(payload), "private-personal");
  assert.equal(getLegacyCanonicalReceiptMatchId({ ...payload, _canonicalReceipt: false }), "");
  assert.match(projected.serialSeed, /^canonical:[a-f0-9]{32}$/);
  assert.equal(projected.serialSeed.includes("private-personal"), false);
});

test("confirmed public matches create snapshots while private personal records do not", () => {
  const match = {
    id: "match-123",
    status: "confirmed",
    visibility: "public",
    rules: { recordType: RECORD_TYPES.match },
  };

  assert.equal(canCreatePublicMatchReceiptSnapshot(match), true);
  assert.equal(canCreatePublicMatchReceiptSnapshot({ ...match, visibility: "private" }), true);
  assert.equal(canCreatePublicMatchReceiptSnapshot({
    ...match,
    rules: { recordType: RECORD_TYPES.personalRecord },
  }), true);
  assert.equal(canCreatePublicMatchReceiptSnapshot({
    ...match,
    rules: { recordType: "personal_record" },
  }), true);
  assert.equal(canCreatePublicMatchReceiptSnapshot({
    ...match,
    visibility: "private",
    rules: { recordType: RECORD_TYPES.personalRecord },
  }), false);
  assert.equal(canCreatePublicMatchReceiptSnapshot({ ...match, status: "pending" }), false);
  assert.equal(canCreatePublicMatchReceiptSnapshot({ ...match, visibility: undefined }), true);
});

test("public receipt clones never inherit official verification or identity", () => {
  const cloned = createReceiptClonePayload({
    _canonicalReceipt: true,
    verified: true,
    personalMmr: 1640,
    profileHashtag: "#1234567",
    personalStatsEligible: true,
    hasCanonicalTeamMatch: true,
    homeTeamEmblemKey: "tier-emblems/gold-3.png",
    awayTeamEmblemKey: "tier-emblems/silver-2.png",
    homeTeam: "HOME",
    awayTeam: "AWAY",
    homeScore: 60,
    awayScore: 46,
  });

  assert.equal(cloned.verified, false);
  assert.equal("personalMmr" in cloned, false);
  assert.equal("profileHashtag" in cloned, false);
  assert.equal(cloned.personalStatsEligible, false);
  assert.equal("hasCanonicalTeamMatch" in cloned, false);
  assert.equal("homeTeamEmblemKey" in cloned, false);
  assert.equal("awayTeamEmblemKey" in cloned, false);
  assert.equal(cloned.homeTeam, "HOME");
  assert.equal(cloned.awayTeam, "AWAY");
});

test("canonical receipt team ids include record summaries", () => {
  const match = {
    rules: {
      recordSummary: {
        teamATeamId: "home-summary",
        teamBId: "away-summary",
      },
    },
  };

  assert.equal(getMatchReceiptSideTeamId(match, "teamA"), "home-summary");
  assert.equal(getMatchReceiptSideTeamId(match, "teamB"), "away-summary");
});

test("receipt shows only the current user's eligible personal stats", () => {
  const baseMatch = {
    id: "match-stats",
    status: "confirmed",
    mode: "3v3",
    createdBy: "host",
    teamA: { name: "HOME" },
    teamB: { name: "AWAY" },
    result: {
      scoreA: 60,
      scoreB: 50,
      playerStats: { player: { points: 18, rebounds: 7 } },
    },
    rules: { recordType: RECORD_TYPES.match },
  };

  const refereeDraft = getMatchReceiptDraftFromMatch({ ...baseMatch, refereeId: "referee" }, {
    currentUserId: "player",
  });
  assert.equal(refereeDraft.personalPoints, 18);
  assert.equal(refereeDraft.personalRebounds, 7);
  assert.equal(createMatchReceiptViewModel(refereeDraft).hasPersonalStats, true);

  const personalDraft = getMatchReceiptDraftFromMatch({
    ...baseMatch,
    createdBy: "player",
    rules: { recordType: RECORD_TYPES.personalRecord },
  }, { currentUserId: "player" });
  assert.equal(personalDraft.verified, false);
  assert.equal(personalDraft.personalStatsEligible, true);
  assert.equal(createMatchReceiptViewModel(personalDraft).hasPersonalStats, true);

  const noRefereeDraft = getMatchReceiptDraftFromMatch(baseMatch, { currentUserId: "player" });
  assert.equal(noRefereeDraft.personalStatsEligible, false);
  assert.equal(createMatchReceiptViewModel(noRefereeDraft).hasPersonalStats, false);

  const otherOwnerDraft = getMatchReceiptDraftFromMatch({
    ...baseMatch,
    createdBy: "other",
    rules: { recordType: RECORD_TYPES.personalRecord },
  }, { currentUserId: "player" });
  assert.equal(otherOwnerDraft.personalStatsEligible, false);
  assert.equal(createMatchReceiptViewModel(otherOwnerDraft).hasPersonalStats, false);
});

test("receipt view model uses compact game labels, venue fallback, and a safe hashtag", () => {
  const draft = {
    playedOn: "2026-08-11",
    homeTeam: "HOME",
    awayTeam: "AWAY",
    homeScore: 60,
    awayScore: 46,
    address: "마포구",
    venue: "망원한강공원 농구장",
    originalAddress: "서울특별시 마포구 망원동",
  };
  const model = createMatchReceiptViewModel(draft, { publicId: "public-receipt-id" });

  assert.equal(getMatchReceiptFormatLabel("1v1"), "1v1");
  assert.equal(getMatchReceiptFormatLabel("2v2"), "2v2");
  assert.equal(getMatchReceiptFormatLabel("3v3"), "3v3");
  assert.equal(getMatchReceiptFormatLabel("5v5"), "5v5");
  assert.equal(getMatchReceiptFormatLabel("other"), "3v3");
  assert.equal(model.locationLabel, "마포구");
  assert.equal(model.locale, "ko");
  assert.equal(createMatchReceiptViewModel(draft, { locale: "en" }).locale, "en");
  assert.equal(createMatchReceiptViewModel(draft, { locale: "fr" }).locale, "ko");
  assert.equal(createMatchReceiptViewModel({ ...draft, address: "" }).locationLabel, draft.venue);
  assert.notEqual(createMatchReceiptViewModel({ ...draft, address: "" }).locationLabel, draft.originalAddress);
  assert.match(model.serial, /^#BT-[A-Z0-9]{6}$/);
  assert.equal(model.serial.includes("public-receipt-id"), false);
  assert.equal(createMatchReceiptViewModel({ ...draft, publicCode: "BT-00000108" }).serial, "#BT-00000108");
  assert.equal(createMatchReceiptViewModel({ ...draft, personalMmr: 1400 }).showPersonalTierIdentity, false);
  const identifiedTier = createMatchReceiptViewModel({
    ...draft,
    personalMmr: 1400,
    profileHashtag: "#1234567",
  });
  assert.equal(identifiedTier.showPersonalTierIdentity, true);
  assert.equal(identifiedTier.profileHashtag, "#1234567");
  assert.equal(Boolean(identifiedTier.personalTier), true);
  assert.equal(createMatchReceiptViewModel(identifiedTier, {
    showPersonalTierIdentity: false,
  }).showPersonalTierIdentity, false);
});

test("match public code is the canonical receipt serial and match hashtag", () => {
  assert.equal(normalizeMatchPublicCode("#bt-00000108"), "BT-00000108");
  assert.equal(normalizeMatchPublicCode("BT-108"), "");
  assert.equal(formatMatchPublicCode("bt-00000108"), "#BT-00000108");
  assert.equal(getMatchHashtag({ publicCode: "BT-00000108" }), "#BT-00000108");
});

test("receipt optional details and team line art stay user controlled", () => {
  const model = createMatchReceiptViewModel({
    tournamentName: "BOXTIER LEAGUE",
    q1Home: 12,
    q1Away: 8,
    q2Home: "",
    q2Away: "",
    homeEmblemKey: "team-emblems/home.png",
    awayEmblemKey: "team-emblems/away.png",
    homeUseLineArt: true,
    awayUseLineArt: false,
  });

  assert.equal(model.tournamentName, "BOXTIER LEAGUE");
  assert.deepEqual(model.periodScores, [["1Q", 12, 8]]);
  assert.match(model.teamEmblemUrls.home, /team-emblems\/home\.png$/);
  assert.equal(model.teamEmblemUrls.away, "");
  assert.equal(createMatchReceiptViewModel({
    homeEmblemKey: "team-emblems/home.png",
    homeUseLineArt: false,
  }).teamEmblemUrls.home, "");
});

test("receipt serial stays stable until a new receipt is explicitly started", () => {
  const draft = createDefaultMatchReceiptDraft();
  const edited = normalizeMatchReceiptDraft({
    ...draft,
    publicCode: "BT-00000108",
    homeTeam: "EDITED",
    homeScore: 99,
    comment: "123456789012345",
  });
  const renewed = renewMatchReceiptDraft(edited);
  const match = {
    id: "match-123",
    publicCode: "BT-00000109",
    status: "confirmed",
    visibility: "public",
    rules: {
      recordType: RECORD_TYPES.match,
      recordSummary: { teamAName: "HOME", teamBName: "AWAY" },
    },
  };
  const canonicalA = getMatchReceiptDraftFromMatch(match, { serialSeed: "canonical:opaque-seed" });
  const canonicalB = getMatchReceiptDraftFromMatch({
    ...match,
    rules: {
      ...match.rules,
      recordSummary: { ...match.rules.recordSummary, teamAName: "CHANGED" },
    },
  }, { serialSeed: "canonical:opaque-seed" });

  assert.equal(edited.serialSeed, draft.serialSeed);
  assert.equal(edited.publicCode, "BT-00000108");
  assert.equal(edited.comment, "123456789012345");
  assert.equal(createMatchReceiptViewModel(edited).serial, "#BT-00000108");
  assert.notEqual(renewed.serialSeed, edited.serialSeed);
  assert.equal(renewed.publicCode, "");
  assert.notEqual(createMatchReceiptViewModel(renewed).serial, createMatchReceiptViewModel(edited).serial);
  assert.equal(canonicalA.serialSeed, "canonical:opaque-seed");
  assert.equal(canonicalA.publicCode, "BT-00000109");
  assert.equal(canonicalB.serialSeed, canonicalA.serialSeed);
  assert.equal(createMatchReceiptViewModel(canonicalA).serial, createMatchReceiptViewModel(canonicalB).serial);
  assert.equal(createMatchReceiptViewModel(canonicalA).serial, "#BT-00000109");
});

test("canonical receipt serial seed is stable and does not expose the match id", () => {
  const seed = createCanonicalReceiptSerialSeed("private-personal", "test-secret");

  assert.equal(seed, createCanonicalReceiptSerialSeed("private-personal", "test-secret"));
  assert.notEqual(seed, createCanonicalReceiptSerialSeed("another-match", "test-secret"));
  assert.match(seed, /^canonical:[a-f0-9]{32}$/);
  assert.equal(seed.includes("private-personal"), false);
});

test("canonical tier labels use uppercase English", () => {
  assert.equal(getTierLabel(1250), "GOLD");
  assert.equal(getTierDivision(1250), "GOLD 3");
});

test("receipt ownership capability is secret, hashed, and cookie-scoped", () => {
  const capability = createReceiptCapability();
  const hash = hashReceiptCapability(capability.secret);
  const response = {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
  };

  setReceiptCapabilityCookie(response, capability);
  const cookie = response.headers["Set-Cookie"];
  const request = { headers: { cookie: cookie.split(";")[0] } };
  const parsed = getReceiptCapabilityCookie(request, capability.publicId);

  assert.deepEqual(parsed, capability);
  assert.equal(receiptCapabilityMatches(capability.secret, hash), true);
  assert.equal(receiptCapabilityMatches(`${capability.secret}x`, hash), false);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\/api\/match-receipts/);
  assert.equal(cookie.includes(hash), false);
});

test("receipt capability cookies stay isolated when creation responses arrive out of order", () => {
  const first = createReceiptCapability();
  const second = createReceiptCapability();
  const createResponse = () => ({
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
  });
  const firstResponse = createResponse();
  const secondResponse = createResponse();

  setReceiptCapabilityCookie(firstResponse, first);
  setReceiptCapabilityCookie(secondResponse, second);
  const cookieHeader = [
    secondResponse.headers["Set-Cookie"].split(";")[0],
    firstResponse.headers["Set-Cookie"].split(";")[0],
  ].join("; ");
  const request = { headers: { cookie: cookieHeader } };

  assert.deepEqual(getReceiptCapabilityCookie(request, first.publicId), first);
  assert.deepEqual(getReceiptCapabilityCookie(request, second.publicId), second);
});

test("public match codes resolve consistently across receipt and search APIs", async () => {
  const [migration, resolver, resolveApi, draftApi, searchApi, syncHandler] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260819120000_match_public_code.sql", import.meta.url), "utf8"),
    readFile(new URL("../server/lib/matchPublicCodeResolver.js", import.meta.url), "utf8"),
    readFile(new URL("../server/api/match-receipts/resolve.js", import.meta.url), "utf8"),
    readFile(new URL("../server/api/match-receipts/draft.js", import.meta.url), "utf8"),
    readFile(new URL("../server/api/search.js", import.meta.url), "utf8"),
    readFile(new URL("../server/lib/matchSyncHandler.js", import.meta.url), "utf8"),
  ]);

  assert.match(migration, /alter table public\.matches add column if not exists public_code text/);
  assert.match(migration, /create unique index if not exists matches_public_code_key/);
  assert.match(migration, /create trigger assign_match_public_code before insert on public\.matches/);
  assert.match(migration, /create trigger preserve_match_public_code/);
  assert.match(resolver, /isPubliclyReadableConfirmedMatch/);
  assert.match(resolver, /payload\?\._canonicalReceipt/);
  assert.match(resolveApi, /resolveMatchPublicCode/);
  assert.match(draftApi, /publicCode: data\.public_code/);
  assert.match(searchApi, /kind: "match_code"/);
  assert.match(searchApi, /normalizeMatchPublicCode\(query\)/);
  assert.match(syncHandler, /publicCode: receiptDraft\.public_code/);
});

test("receipt photo tools stay outside the export card and reference dividers remain", async () => {
  const [page, preview, qrComponent, baseStyles, previewControlStyles, tokens, renderer, thermalRenderer, roomDialog, digitGenerator, displayAssetGenerator, syncScript, draftApi, emblemApi, landing, appSource, homeNeutralMark, awayNeutralMark, paperGrain, scoreDigitSource, scoreDigits, scoreboardDigits, wordmark, bebasNeue, bebasLicense, blackHanSans, detailStyles, lineArt] = await Promise.all([
    readFile(new URL("../src/pages/MatchReceipt.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/match/MatchReceiptPreview.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/common/QrCode.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/styles/features/match-receipt.css", import.meta.url), "utf8"),
    readFile(new URL("../src/styles/features/match-receipt-preview-controls.css", import.meta.url), "utf8"),
    readFile(new URL("../src/styles/tokens.css", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/matchReceipt.js", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/thermalReceipt.js", import.meta.url), "utf8"),
    readFile(new URL("../src/components/recruiting/RecruitingRoomDialogSection.jsx", import.meta.url), "utf8"),
    readFile(new URL("../scripts/generate-receipt-score-digits.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/generate-match-receipt-display-assets.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/sync-receipt-assets-to-r2.mjs", import.meta.url), "utf8"),
    readFile(new URL("../server/api/match-receipts/draft.js", import.meta.url), "utf8"),
    readFile(new URL("../server/api/match-receipts/emblem.js", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/Landing.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../public/assets/tier-emblems/tier-neutral-home-outline-v5.png", import.meta.url)),
    readFile(new URL("../public/assets/tier-emblems/tier-neutral-away-outline-v5.png", import.meta.url)),
    readFile(new URL("../public/assets/match-receipt-paper-grain-v1.png", import.meta.url)),
    readFile(new URL("../public/assets/match-receipt-score-digits-source-v1.png", import.meta.url)),
    readFile(new URL("../public/assets/match-receipt-score-digits-v3.png", import.meta.url)),
    readFile(new URL("../public/assets/match-receipt-scoreboard-digits-v2.png", import.meta.url)),
    readFile(new URL("../public/assets/match-receipt-wordmark-v1.png", import.meta.url)),
    readFile(new URL("../public/assets/fonts/BebasNeue-Regular.ttf", import.meta.url)),
    readFile(new URL("../public/assets/fonts/BebasNeue-OFL.txt", import.meta.url), "utf8"),
    readFile(new URL("../public/assets/fonts/BlackHanSans-Regular.ttf", import.meta.url)),
    readFile(new URL("../src/styles/features/match-receipt-details.css", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/matchReceiptEmblem.js", import.meta.url), "utf8"),
  ]);
  const styles = `${baseStyles}\n${previewControlStyles}`;
  const receiptSources = `${page}\n${preview}`;
  const localizedReceiptSources = `${receiptSources}\n${renderer}`;

  assert.match(page, /className="match-receipt-photo-editor-shell"/);
  assert.match(page, /className="match-receipt-photo-editor"/);
  assert.match(page, /onPointerDown=\{beginPhotoGesture\}/);
  assert.match(page, /onPointerMove=\{movePhotoGesture\}/);
  assert.match(page, /onPointerUp=\{endPhotoGesture\}/);
  assert.doesNotMatch(page, /photoRotationHandleHandlers/);
  assert.doesNotMatch(page, /getPhotoRotationHandleStyle/);
  assert.doesNotMatch(page, /querySelector\("\.match-receipt-photo"\)/);
  assert.match(page, /사진 자유 회전/);
  assert.match(page, /className="match-receipt-photo-editor-rotate"/);
  assert.match(page, /onPointerDown=\{beginPhotoRotation\}/);
  assert.doesNotMatch(page, /<RotateCcw aria-hidden="true" \/> 자유 회전/);
  assert.match(page, /<Button as="label" variant="secondary">/);
  assert.match(page, /<Button variant="danger" disabled=\{!photoUrl \|\| Boolean\(busy\)\} onClick=\{removePhoto\}>/);
  assert.ok(page.indexOf('className="match-receipt-photo-tools"') < page.indexOf('className="button ui-button button-primary ui-button-primary button-md ui-button-md match-receipt-complete"'));
  assert.match(page, /`\$\{commentLength\}\/\$\{MATCH_RECEIPT_COMMENT_MAX_LENGTH\}`/);
  assert.match(page, /commentPlaceholder: "선택 · 22자 이내"/);
  assert.match(page, /commentPlaceholder: "Optional · Up to 22 characters"/);
  assert.match(page, /onClick=\{resetReceipt\}/);
  assert.match(page, /await publicDraftRequestRef\.current/);
  assert.match(page, /clearMatchReceiptDraft\(\)/);
  assert.match(page, /clearMatchReceiptPhoto\(\)/);
  assert.match(page, /createDefaultMatchReceiptDraft\(\)/);
  assert.doesNotMatch(page, /hardRefreshReceipt|match-receipt-hard-reset|window\.caches|cache: "reload"|location\.reload|FilePlus2|startNewReceipt/);
  assert.match(page, /onWheel=\{zoomPhotoWithWheel\}/);
  assert.match(page, /onDoubleClick=\{resetPhotoTransform\}/);
  assert.match(page, /className="match-receipt-photo-actions"/);
  assert.doesNotMatch(preview, /preventBrowserGesture|gesturestart|gesturechange|touchmove/);
  assert.match(detailStyles, /\.match-receipt-info-fields > label\s*\{[^}]*contain:\s*inline-size;/);
  assert.match(detailStyles, /\.match-receipt-info-fields input\[type="date"\]\s*\{[^}]*min-inline-size:\s*0;[^}]*max-inline-size:\s*100%;/);
  assert.match(landing, /children = "로그인"/);
  assert.match(landing, /별도 가입 없이 로그인/);
  assert.match(page, /className="page-stack match-receipt-page"/);
  assert.match(page, /className="page-header match-receipt-page-head ui-page-hero ui-design-app-hero"/);
  assert.match(page, /back: "뒤로가기"/);
  assert.match(page, /home: "홈으로"/);
  assert.match(styles, /\.match-receipt-page\s*\{[^}]*width:\s*min\(100%, var\(--page-content-max\)\);[^}]*max-width:\s*var\(--page-content-max\);[^}]*margin-inline:\s*auto;[^}]*padding-block-end:\s*72px;/);
  assert.match(styles, /\.match-receipt-workspace\s*\{[^}]*width:\s*min\(1180px, 100%\);[^}]*margin:\s*0 auto;/);
  assert.doesNotMatch(styles, /match-receipt-page-head\.ui-design-app-hero\s*\{[^}]*margin-block-start:\s*0;/);
  assert.match(preview, /model\.locale === "en" \? \(model\.hasPersonalStats \? "MVP \/ Player Stats" : "Players"\)/);
  assert.match(preview, /model\.hasPersonalStats \? "MY GAME" : "GAME INFO"/);
  assert.match(preview, /match-receipt-personal-stats/);
  assert.match(preview, /neutralTeamMarkUrls\.home/);
  assert.match(preview, /neutralTeamMarkUrls\.away/);
  assert.match(page, /canonicalHomeTeamMmr/);
  assert.match(page, /app\?\.state\?\.teams/);
  assert.match(page, /homeMmr: canonicalHomeTeamMmr/);
  assert.match(page, /RECEIPT_PERIOD_FIELDS/);
  assert.match(page, /homeUseLineArt/);
  assert.match(page, /selectedTeamLineArtUrls/);
  assert.match(preview, /createMatchReceiptLineArt/);
  assert.match(preview, /teamLineArtUrls\.home \|\| createMatchReceiptLineArt/);
  assert.match(preview, /match-receipt-game-detail/);
  assert.match(renderer, /homeLineArt \|\| homeTier \|\| homeNeutralTeamMark/);
  assert.match(draftApi, /homeTeamRecord/);
  assert.match(preview, /TEAM TIER · \$\{team\.tier\.label\}/);
  assert.match(preview, /--receipt-paper-texture/);
  assert.match(preview, /--receipt-paper-grain/);
  assert.match(preview, /--receipt-score-digits/);
  assert.match(preview, /ReceiptScoreDigits/);
  assert.match(preview, /match-receipt-team-watermarks/);
  assert.match(preview, /MY TIER · \{model\.personalTier\.label\}/);
  assert.match(preview, /model\.showPersonalTierIdentity \? <span className="match-receipt-poster-profile">/);
  assert.match(page, /CourtMapPicker/);
  assert.match(page, /const receiptLocale = getReceiptLocale\(location\)/);
  assert.match(page, /className="match-receipt-locale-switch"/);
  assert.match(page, /selectReceiptLocale\("en"\)/);
  assert.match(page, /getReceiptSearchWithLocale\(location\.search, locale\)/);
  assert.match(page, /applyReceiptLocaleToUrl\(new URL\("\/app\/receipt", window\.location\.origin\), receiptLocale\)/);
  assert.match(page, /setCourtMapOpen\(false\);/);
  assert.match(page, /locale=\{receiptLocale\}/);
  assert.match(page, /\{!isEnglish \? <CourtMapPicker/);
  assert.doesNotMatch(page, /value=\{draft\.playerCount \?\? ""\}/);
  assert.match(preview, /lang=\{model\.locale\}/);
  assert.match(renderer, /model\.locale === "en" \? "★  GAME RECEIPT  ★"/);
  for (const label of [
    "GAME RECEIPT",
    "Final Score",
    "Team A",
    "Team B",
    "Date / Time / Venue",
    "Players",
    "Period Scores",
    "MVP / Player Stats",
    "Download Story",
    "Download Post",
    "Share Receipt",
    "Create Your Own",
  ]) {
    assert.equal(localizedReceiptSources.includes(label), true, `missing English receipt label: ${label}`);
  }
  assert.match(detailStyles, /\.match-receipt-locale-switch\s*\{/);
  assert.match(
    detailStyles,
    /\.match-receipt-locale-switch \.ui-button\s*\{[^}]*width:\s*var\(--ui-button-height-sm\);[^}]*height:\s*var\(--ui-button-height-sm\);[^}]*min-height:\s*var\(--ui-button-height-sm\);/,
  );
  assert.match(detailStyles, /\.match-receipt-card:lang\(en\) \.match-receipt-ticket-game > strong/);
  assert.match(page, /EmblemCropEditor/);
  assert.match(page, /prepareTeamEmblemUpload/);
  assert.doesNotMatch(page, /uploadGuestReceiptEmblem/);
  assert.doesNotMatch(page, /reserveImageSaveWindow|saveWindow\.location\.replace/);
  assert.match(page, /function isIosDevice\(navigatorValue\)/);
  assert.match(page, /isIosDevice\(navigator\) && canShareImageFile\(navigator, file\)/);
  assert.match(page, /await navigator\.share\(\{ title: receiptCopy\.shareTitle, files: \[file\] \}\)/);
  assert.match(page, /downloadBlob\(blob, fileName\)/);
  assert.match(page, /const savedReceiptEmblemTeams = useMemo/);
  assert.match(page, /selectSavedTeamReceiptEmblem\(side, event\.target\.value\)/);
  assert.match(page, /team\.receiptEmblemKey/);
  assert.ok(page.indexOf('className="match-receipt-page-head ui-page-hero ui-design-app-hero"') < page.indexOf('className="match-receipt-page-controls"'));
  assert.ok(page.indexOf('className="match-receipt-page-controls"') < page.indexOf('className="match-receipt-workspace"'));
  assert.match(page, /selectPhoto: "경기사진선택"/u);
  assert.match(page, /selectPhoto: "Choose game photo"/u);
  assert.match(page, /sanitizeMatchReceiptCommentInput\(value\)/u);
  assert.match(previewControlStyles, /@media \(max-width: 560px\)[\s\S]*\.match-receipt-photo-actions \{ grid-template-columns: minmax\(0, 1\.35fr\) repeat\(3, minmax\(0, 1fr\)\); \}/);
  assert.doesNotMatch(previewControlStyles, /\.match-receipt-photo-actions \.button:first-child \{ grid-column: 1 \/ -1/);
  assert.match(detailStyles, /\.match-receipt-line-art-fields \.match-receipt-saved-emblem\s*\{[^}]*display:\s*grid;/);
  assert.doesNotMatch(page, /emblemShareFailed|match_receipt_emblem_sync_failed|EMBLEM_SHARE_FAILURE_MESSAGE/);
  assert.match(page, /URL\.revokeObjectURL\(url\)/u);
  assert.match(page, /const publicMatchUrl = publicId\s*\? applyReceiptLocaleToUrl\(new URL/);
  assert.match(page, /사진을 골라 선화 엠블럼으로 바로 사용할 수 있습니다\./u);
  assert.match(page, /로그인 후 팀을 만들면 팀 상세에 저장해 다음 영수증에서도 재사용할 수 있습니다\./u);
  assert.match(page, /로그인 · 팀 만들고 엠블럼 저장/u);
  assert.match(emblemApi, /allowRequestMethod\(request, response, \["POST", "DELETE"\]\)/);
  assert.match(emblemApi, /410, \{ error: "receipt_emblem_upload_disabled" \}/);
  assert.match(page, /getRegisteredCourts/);
  assert.match(page, /mergeCourtSearchCourts/);
  assert.match(page, /inferRegionSelection\(courtMapRegionSource\)/);
  assert.match(page, /COURT_MAP_SEARCH_PURPOSE/);
  assert.match(page, /allowWhenDisabled: true, allowAnonymous: true/);
  assert.match(page, /loading=\{courtMapDirectoryStatus\.loading\}/);
  assert.match(page, /loadError=\{courtMapDirectoryStatus\.error\}/);
  assert.match(page, /readOnly placeholder=\{errors\.venue \? "경기 장소 또는 짧은 장소가 필요합니다" : "지도에서 선택 · 자유 입력은 짧은 장소에 작성"\}/);
  assert.doesNotMatch(page, /updateField\("venue", event\.target\.value\)/);
  assert.doesNotMatch(page, /name === "venue"/);
  assert.match(page, /<label className="is-wide">\{receiptCopy\.venue\} <input[^>]+placeholder=\{receiptCopy\.venuePlaceholder\}/);
  assert.match(page, /draft\.originalAddress \|\| profileCourtRegion/);
  assert.match(page, /RECEIPT_TEXT_FIELDS\.has\(name\)/);
  assert.match(page, /normalizeMatchReceiptDraft\(\{ \.\.\.current, venue, address, originalAddress \}\)/);
  assert.match(preview, /const commentLineCount = model\.commentLines\.length/);
  assert.match(preview, /const commentText = getMatchReceiptCommentLines\(model\.comment\)\.join\("\\n"\)/);
  assert.match(preview, /match-receipt-ticket-game--comment-lines-\$\{commentLineCount\}/);
  assert.match(preview, /<span className="match-receipt-ticket-caption">\{commentText \|\| "\\u00a0"\}<\/span>/);
  assert.doesNotMatch(page, /model\.comment \|\| "내 경기 기록"/);
  assert.match(preview, /className="match-receipt-qr" branded/);
  assert.match(page, /new URL\("\/app\/receipt", window\.location\.origin\)/);
  assert.match(page, /if \(draft\.publicCode\) url\.searchParams\.set\("code", draft\.publicCode\)/);
  assert.match(page, /else if \(activePublicDraftId\) url\.searchParams\.set\("draft", activePublicDraftId\)/);
  assert.match(receiptSources, /\/app\/receipt\?draft=/);
  assert.match(receiptSources, /\/app\/receipt\?code=/);
  assert.match(receiptSources, /\/app\/matches\?match=/);
  assert.match(page, /sourceMatchId: canonicalMatchId/);
  assert.match(page, /const currentUserId = app\?\.currentUser\?\.id \?\? "";/);
  assert.doesNotMatch(page, /const currentUserId = auth\?\.session\?\.user\?\.id/);
  assert.match(page, /clonePublicId: requestedPublicDraftId/);
  assert.match(page, /requestedDraftCanClaim/);
  assert.match(page, /draftRevisionRef/);
  assert.match(page, /publicDraftLoadedRevisionRef/);
  assert.match(page, /publicDraftSavedRevisionRef/);
  assert.match(page, /while \(true\)/);
  assert.match(page, /ownedPublicId \? \{ publicId: ownedPublicId \} : \{\}/);
  assert.match(page, /requestRevision === draftRevisionRef\.current/);
  assert.match(page, /return receiptIsReadOnly \|\| Boolean\(canonicalMatchId && CANONICAL_RECEIPT_FIELDS\.has\(name\)\)/);
  assert.doesNotMatch(page, /return Boolean\(requestedPublicDraftId \|\|/);
  assert.doesNotMatch(page, /publicDraftId && !requestedPublicDraftId/);
  assert.doesNotMatch(page, /receipt_draft_stale/);
  assert.doesNotMatch(page, /state:\s*\{\s*receiptDraft: getMatchReceiptCreateDraft\(draft\)/);
  assert.doesNotMatch(preview, /match-receipt-photo-backdrop/);
  assert.doesNotMatch(receiptSources, /index \? "AWAY" : "HOME"/);
  assert.match(preview, /index \? "TEAM B" : "TEAM A"/);
  assert.doesNotMatch(preview, /HOME TEAM|AWAY TEAM/);
  assert.match(page, /<legend>\{receiptCopy\.teamA\}<\/legend>/);
  assert.match(page, /<legend>\{receiptCopy\.teamB\}<\/legend>/);
  assert.doesNotMatch(page, /홈팀|원정팀/);
  assert.doesNotMatch(page, /홈 점수|원정 점수|placeholder="홈"|placeholder="원정"/);
  assert.doesNotMatch(renderer, /HOME TEAM|AWAY TEAM|홈팀 이름|원정팀 이름/);
  assert.match(page, /maxLength=\{MATCH_RECEIPT_COMMENT_MAX_LENGTH\} disabled=\{isFieldReadOnly\("comment"\)\}/);
  assert.equal(MATCH_RECEIPT_LIMITS.tournamentName, 20);
  assert.match(page, /draft\.tournamentName\} maxLength=\{MATCH_RECEIPT_LIMITS\.tournamentName\}/);
  assert.doesNotMatch(page, /match-receipt-color-input/);
  assert.match(qrComponent, /branded \? null : <rect/);
  assert.match(qrComponent, /qr\.matrix\.flatMap/);
  assert.match(qrComponent, /rx="0\.18"/);
  assert.match(qrComponent, /finderCenterPositions/);
  assert.doesNotMatch(qrComponent, /badgeInset/);
  assert.match(qrComponent, /const badgeSize = 5/);
  assert.doesNotMatch(qrComponent, /assetUrl|<image/);
  assert.match(qrComponent, /const BRANDED_QR_ACCENT = "#d4582b"/);
  assert.doesNotMatch(qrComponent, /#fa5030/);
  assert.match(qrComponent, /stroke="#fff3df"/);
  assert.match(qrComponent, /strokeLinecap="round"/);
  assert.doesNotMatch(renderer, /MATCH_RECEIPT_QR_BADGE_URL|qrBrandBadge|ctx\.drawImage\(brandBadge/);
  assert.match(renderer, /const MATCH_RECEIPT_QR_ACCENT = "#d4582b"/);
  assert.doesNotMatch(renderer, /#fa5030/);
  assert.match(renderer, /function drawQrBrandBadge/);
  assert.match(styles, /\.match-receipt-photo-editor\s*\{[\s\S]*touch-action: none/);
  assert.match(styles, /\.match-receipt-photo \{[\s\S]*height: 46\.09375%/);
  assert.match(styles, /\.match-receipt-poster-teams > div:not\(\.match-receipt-game-detail\) > strong[\s\S]*overflow-wrap: anywhere[\s\S]*word-break: normal/);
  assert.match(styles, /button\.match-receipt-photo-editor-rotate/);
  assert.match(styles, /button\.match-receipt-photo-editor-rotate[\s\S]*position: absolute[\s\S]*right: 8px[\s\S]*bottom: 8px[\s\S]*touch-action: none/);
  assert.match(styles, /\.match-receipt-photo-actions/);
  assert.match(styles, /\.match-receipt-game-info/);
  assert.match(styles, /\.match-receipt-poster-score > span[\s\S]*font-family: "Bebas Neue"/);
  assert.match(styles, /font-size: clamp\(10px, 3\.3cqw, 16px\)/);
  assert.match(styles, /\.match-receipt-verified[\s\S]*font-family: "Bebas Neue"/);
  assert.doesNotMatch(styles, /\.match-receipt-verified\.is-receipt/);
  assert.match(styles, /background: var\(--receipt-paper-texture\)/);
  assert.match(styles, /auto 240% repeat-x/);
  assert.doesNotMatch(styles, /text-shadow: 0 4px 16px rgba\(0, 0, 0, 0\.42\)/);
  assert.match(styles, /\.match-receipt-score-digit[\s\S]*var\(--receipt-score-digits\)/);
  assert.match(styles, /aspect-ratio: 196 \/ 400/);
  assert.match(styles, /1100% 100% no-repeat/);
  assert.match(styles, /\.match-receipt-card::after[\s\S]*var\(--receipt-paper-grain\)/);
  assert.doesNotMatch(styles, /\.match-receipt-ticket::after/);
  assert.match(styles, /font-family: "Black Han Sans", "KBO Dia Gothic", sans-serif/);
  assert.match(styles, /transform: scaleX\(0\.92\)/);
  assert.match(styles, /scale\(var\(--receipt-photo-scale\)\)/);
  assert.match(styles, /\.match-receipt-team-watermarks[\s\S]*height: 34%/);
  assert.match(styles, /\.match-receipt-team-watermarks img \{[\s\S]*opacity: 0\.08;[\s\S]*filter: grayscale\(1\) brightness\(0\) invert\(1\)/);
  assert.doesNotMatch(detailStyles, /\.match-receipt-team-watermarks img\.is-custom/);
  assert.match(styles, /\.match-receipt-poster-teams \.match-receipt-team-tier\s*\{[\s\S]*top: 42%;[\s\S]*width: 30%;/);
  assert.match(styles, /--receipt-team-name-size/);
  assert.match(styles, /font-size: clamp\(7px, 2\.1cqw, 10px\)/);
  assert.match(styles, /height: 19\.9%/);
  assert.match(styles, /\.match-receipt-team-tier\.is-neutral[\s\S]*opacity: 0\.76/);
  assert.match(styles, /\.match-receipt-personal-tier[\s\S]*width: 92%[\s\S]*opacity: 0\.72/);
  assert.match(styles, /\.match-receipt-ticket-qr \.match-receipt-qr[\s\S]*width: 94%[\s\S]*max-height: 94%/);
  assert.match(styles, /\.match-receipt-game-info b\s*\{[^}]*font-family: "Bebas Neue"/);
  assert.match(styles, /\.match-receipt-ticket-game > \.match-receipt-ticket-caption\s*\{[^}]*top: var\(--receipt-ticket-meta-y\);[^}]*font-size: clamp\(8px, 2\.5cqw, 12px\)/);
  assert.doesNotMatch(styles, /\.match-receipt-ticket-game > \.match-receipt-ticket-caption\s*\{[^}]*margin-top:\s*auto/);
  assert.match(styles, /--receipt-ticket-divider-y:\s*58%/);
  assert.match(styles, /\.match-receipt-ticket-date[\s\S]*top:\s*var\(--receipt-ticket-divider-y\)/);
  assert.match(styles, /\.match-receipt-ticket-date\s*\{[^}]*color:\s*#bd4e2a/);
  assert.match(styles, /\.match-receipt-ticket-game > \.match-receipt-ticket-caption[\s\S]*top:\s*var\(--receipt-ticket-meta-y\)/);
  assert.match(styles, /\.match-receipt-personal-tier-label[\s\S]*top:\s*var\(--receipt-ticket-tier-y\)/);
  assert.match(styles, /\.match-receipt-ticket-game--comment-lines-0 \.match-receipt-personal-tier-label \{ top: var\(--receipt-ticket-meta-y\); \}/);
  assert.match(styles, /\.match-receipt-ticket-game--comment-lines-2 \.match-receipt-personal-tier-label \{ top: calc\(var\(--receipt-ticket-tier-y\) \+ var\(--receipt-ticket-meta-line-height\)\); \}/);
  assert.match(styles, /\.match-receipt-team-fields fieldset\s*\{[^}]*border:\s*var\(--ui-stroke-width\) solid var\(--rb-line\);[^}]*border-radius:\s*var\(--radius-md\);[^}]*background:\s*transparent;/);
  assert.match(detailStyles, /\.match-receipt-period-fields\s*\{[^}]*border:\s*var\(--ui-stroke-width\) solid var\(--ui-fieldset-border\);[^}]*border-radius:\s*var\(--ui-fieldset-radius\);/);
  assert.match(detailStyles, /\.match-receipt-line-art-fields\s*\{[^}]*border:\s*var\(--ui-stroke-width\) solid var\(--ui-fieldset-border\);[^}]*border-radius:\s*var\(--ui-fieldset-radius\);/);
  assert.match(detailStyles, /\.match-receipt-line-art-fields legend,[\s\S]*?\.match-receipt-period-fields legend\s*\{[^}]*color:\s*var\(--ui-fieldset-legend-title-color\);[^}]*white-space:\s*nowrap;/);
  assert.match(detailStyles, /\.match-receipt-line-art-fields legend small\s*\{[^}]*color:\s*var\(--ui-fieldset-legend-support-color\);/);
  assert.match(detailStyles, /\.match-receipt-period-fields legend small\s*\{[^}]*color:\s*var\(--ui-fieldset-legend-support-color\);/);
  assert.match(styles, /\.match-receipt-photo-actions[\s\S]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(detailStyles, /input\[type="date"\][\s\S]*min-inline-size: 0[\s\S]*max-inline-size: 100%/);
  assert.match(detailStyles, /\.match-receipt-period-fields input\[type="number"\][\s\S]*appearance: textfield/);
  assert.match(detailStyles, /::-webkit-inner-spin-button,[\s\S]*::-webkit-outer-spin-button[\s\S]*-webkit-appearance: none/);
  assert.match(detailStyles, /\.match-receipt-game-detail[\s\S]*top: 76%/);
  assert.match(renderer, /const centerTop = compact \? 900 : 1350/);
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*?\.match-receipt-editor \{[\s\S]*?display: contents;[\s\S]*?\.match-receipt-preview-panel \{[\s\S]*?order: 2;[\s\S]*?\.match-receipt-photo-tools \{[\s\S]*?order: 3;[\s\S]*?\.match-receipt-complete \{[\s\S]*?order: 4;/);
  assert.match(styles, /\.match-receipt-ticket-date[\s\S]*border-top/);
  assert.match(styles, /\.match-receipt-ticket\s*\{[^}]*inset:\s*auto 0 1\.8%;/);
  assert.match(styles, /--receipt-ticket-personal-stats-shift:\s*-28%/);
  assert.match(styles, /\.match-receipt-ticket-game > \.match-receipt-personal-stats\s*\{[^}]*transform:\s*translateY\(var\(--receipt-ticket-personal-stats-shift\)\)/);
  assert.match(styles, /\.match-receipt-personal-stats b \+ b[\s\S]*border-left/);
  assert.match(styles, /\.match-receipt-personal-stats b\s*\{[^}]*color:\s*var\(--receipt-ink\)/);
  assert.match(styles, /\.match-receipt-stat-digits\.is-paper-ink \.match-receipt-score-digit\s*\{[^}]*filter:\s*brightness\(0\) saturate\(100%\)/);
  assert.match(renderer, /if \(model\.hasPersonalStats\) \{\s*ctx\.fillStyle = "#151515"/);
  assert.match(renderer, /const receiptTop = compact \? 1010 : 1504/);
  assert.match(renderer, /ctx\.fillStyle = "#d4582b";\s*ctx\.font = '900 27px "KBO Dia Gothic", sans-serif';\s*ctx\.fillText\(model\.playedOn/);
  assert.match(renderer, /ctx\.drawImage\(paper, 0, receiptTop, width, height - receiptTop - \(compact \? 26 : 34\)\)/);
  assert.equal(MATCH_RECEIPT_PHOTO_ASPECT, 1080 / 885);
  assert.doesNotMatch(thermalRenderer, /const SCORE_FONT_WEIGHT/u);
  assert.match(thermalRenderer, /function drawAngularScore/);
  assert.match(thermalRenderer, /function drawAngularColon/);
  assert.match(thermalRenderer, /match-receipt-score-digits-v3\.png/);
  assert.match(thermalRenderer, /"NeoDunggeunmo"/);
  assert.match(renderer, /drawCanvasScoreColon\(ctx, scoreDigits/);
  assert.doesNotMatch(renderer, /ctx\.fillText\(":",/);
  assert.match(renderer, /createCanvasPaperPattern\(ctx, paperGrain\)/);
  assert.doesNotMatch(renderer, /ctx\.shadowColor = "rgba\(0,0,0,\.42\)"/);
  assert.match(renderer, /compact \? 154 : 278/);
  assert.match(renderer, /const scoreBaseline = compact \? scoreTop \+ 132 : 1163/);
  assert.match(renderer, /const teamWatermarkSize = compact \? 450 : 600/);
  assert.match(renderer, /const MATCH_RECEIPT_TEAM_WATERMARK_OPACITY = 0\.08/);
  assert.match(renderer, /ctx\.globalAlpha = MATCH_RECEIPT_TEAM_WATERMARK_OPACITY;\s*ctx\.filter = "grayscale\(1\) brightness\(0\) invert\(1\)"/);
  assert.match(renderer, /const teamTop = compact \? 779 : 1192/);
  assert.match(renderer, /const teamTierY = compact \? 838 : 1311/);
  assert.match(renderer, /const teamTierSize = compact \? 116 : 140/);
  assert.match(renderer, /const teamLabelY = compact \? 982 : 1474/);
  assert.match(renderer, /teamFontSize \* getMatchReceiptTeamNameScale\(team\.name\)/);
  assert.match(renderer, /ctx\.font = `900 \$\{compact \? 14 : 15\}px "KBO Dia Gothic", sans-serif`/);
  assert.match(renderer, /defaultPhoto: !selectedPhotoBlob/);
  assert.match(renderer, /drawReceiptCoverPhoto\(ctx, image, rect, draft/);
  assert.match(renderer, /MATCH_RECEIPT_DEFAULT_PHOTO_FOCUS = Object\.freeze\(\{ x: 0, y: 82 \}\)/);
  assert.doesNotMatch(renderer, /const backdropScale|blur\(16px\).*brightness\(0\.62\)/);
  assert.doesNotMatch(styles, /\.match-receipt-photo\.is-default \.match-receipt-photo-image/);
  assert.match(renderer, /photoHeight \* 0\.42/);
  assert.match(renderer, /blurFade\.addColorStop\(0\.68, "rgba\(0,0,0,0\.72\)"\)/);
  assert.match(renderer, /fadeIn: 0\.24/);
  assert.match(styles, /\.match-receipt-ticket\s*\{[^}]*font-family:\s*"KBO Dia Gothic"/);
  assert.match(renderer, /function drawCanvasMapPin/);
  assert.match(renderer, /const footerLeftDivider = compact \? 386 : 409/);
  assert.match(renderer, /const footerLeftX = compact \? 220 : 236/);
  assert.match(renderer, /const footerMiddleX = compact \? 540 : 558/);
  assert.match(renderer, /const footerRightX = compact \? 850 : 862/);
  assert.match(renderer, /drawCanvasMapPin\(ctx, footerLeftX/);
  assert.match(renderer, /const qrSize = compact \? 216 : 270/);
  assert.match(renderer, /const footerCommentOffset = footerDateOffset/);
  assert.match(renderer, /const footerMetaLineHeight = compact \? 25 : 31/);
  assert.match(renderer, /const commentLines = model\.commentLines \?\? \[\]/);
  assert.match(renderer, /const footerDateOffset = compact \? 174 : 244/);
  assert.match(renderer, /const personalStatsShiftY = compact \? 12 : 16/);
  assert.match(renderer, /const personalStatsValueOffset = \(compact \? 78 : 132\) - personalStatsShiftY/);
  assert.match(renderer, /const personalStatsLabelOffset = \(compact \? 110 : 166\) - personalStatsShiftY/);
  assert.match(renderer, /const personalStatsDividerTopOffset = \(compact \? 30 : 70\) - personalStatsShiftY/);
  assert.match(renderer, /const personalStatsDividerBottomOffset = \(compact \? 116 : 180\) - personalStatsShiftY/);
  assert.match(renderer, /footerY \+ footerCommentOffset/);
  assert.match(renderer, /footerCommentOffset \+ commentLines\.length \* footerMetaLineHeight/);
  assert.match(lineArt, /const CROP_EDGE_GUARD = 5/);
  assert.match(lineArt, /const EMBLEM_CONTENT_WIDTH = 210/);
  assert.match(lineArt, /const EMBLEM_CONTENT_HEIGHT = 230/);
  assert.match(lineArt, /const normalizedCanvas = document\.createElement\("canvas"\)/);
  assert.match(lineArt, /const boundary = !isCropEdge && neighbors\.some/);
  assert.match(renderer, /const tierSize = compact \? 150 : 192/);
  assert.match(renderer, /ctx\.moveTo\(footerMiddleX, footerY \+ personalStatsDividerTopOffset\)/);
  assert.match(renderer, /ctx\.lineTo\(footerMiddleX, footerY \+ personalStatsDividerBottomOffset\)/);
  assert.match(renderer, /createCanvasPaperPattern/);
  assert.match(renderer, /drawCanvasPaperGrain/);
  assert.match(renderer, /drawCanvasScoreDigits/);
  assert.match(renderer, /loadCanvasImage\(model\.scoreDigitsUrl\)/);
  assert.match(renderer, /loadReceiptCanvasImage/);
  assert.match(renderer, /const selectedPhotoBlob = model\.includePhoto \? options\.photoBlob : null/);
  assert.match(renderer, /const photoPromise = loadCanvasImage\(selectedPhotoBlob \|\| model\.defaultPhotoUrl\)/);
  assert.match(renderer, /selectedPhotoBlob \? loadCanvasImage\(model\.defaultPhotoUrl\)/);
  assert.match(renderer, /wrapCanvasText/);
  assert.match(renderer, /tier-neutral-home-outline-v5\.png/);
  assert.match(renderer, /tier-neutral-away-outline-v5\.png/);
  assert.match(renderer, /getTierDivisionNumber/);
  assert.match(renderer, /`\$\{tier\.name\}\$\{division \? ` \$\{division\}` : ""\}`\.toUpperCase\(\)/);
  assert.match(renderer, /rankball-record-create-night-v10\.webp/);
  assert.match(preview, /!photoUrl \? <ReceiptPhotoScoreboard homeScore=\{model\.homeScore\} awayScore=\{model\.awayScore\} locale=\{model\.locale\} \/> : null/);
  assert.match(preview, /--receipt-scoreboard-digits/);
  assert.doesNotMatch(preview, /MATCH_RECEIPT_SEVEN_SEGMENT_PATHS|<svg/);
  assert.match(renderer, /if \(!selectedPhotoBlob\) \{\s*drawCanvasPhotoScoreboard/);
  assert.match(renderer, /formatMatchReceiptScoreboardScore\(model\.homeScore\)/);
  assert.match(renderer, /loadCanvasImage\(model\.scoreboardDigitsUrl\)/);
  assert.match(renderer, /function drawCanvasContainedImage/);
  assert.doesNotMatch(renderer, /MATCH_RECEIPT_SEVEN_SEGMENT_PATHS|Path2D/);
  assert.match(detailStyles, /\.match-receipt-photo-scoreboard\s*\{[^}]*top:\s*25\.2%;[^}]*left:\s*62\.7%;/);
  assert.match(detailStyles, /transform:\s*skewY\(-5\.37deg\)/);
  assert.match(detailStyles, /transform-origin:\s*top left/);
  assert.match(renderer, /topEdgeRise:\s*-11 \/ 1671/);
  assert.match(renderer, /ctx\.transform\(1, sourceBoard\.topEdgeRise \/ sourceBoard\.width, 0, 1, 0, 0\)/);
  assert.match(detailStyles, /\.match-receipt-photo-scoreboard-scores > \.match-receipt-scoreboard-value:first-child\s*\{[^}]*justify-content:\s*flex-end;/);
  assert.match(detailStyles, /\.match-receipt-photo-scoreboard-scores > \.match-receipt-scoreboard-value:last-child\s*\{[^}]*justify-content:\s*flex-start;[^}]*transform:\s*translateX\(-3%\);/);
  assert.match(renderer, /board\.x \+ board\.width \* 0\.535/);
  assert.match(renderer, /formatMatchReceiptScoreboardScore\(model\.homeScore\)[\s\S]*\}, "end"\);[\s\S]*formatMatchReceiptScoreboardScore\(model\.awayScore\)[\s\S]*\}, "start"\);/);
  assert.match(renderer, /prepareReceiptCanvasFonts\(\[/);
  assert.match(renderer, /'900 270px "Bebas Neue"'/);
  assert.match(renderer, /'900 58px "Black Han Sans"'/);
  assert.match(renderer, /TEAM TIER · \$\{team\.tier\.label\}/);
  assert.match(preview, /<ReceiptScoreboardGlyph value=":" row=\{0\} \/>/);
  assert.doesNotMatch(preview, /!team\.lineArtUrl && model\.showTeamTierEmblems/);
  assert.match(detailStyles, /grid-template-columns:\s*41% 5% 41%/);
  assert.doesNotMatch(detailStyles, /\.match-receipt-poster-teams \.match-receipt-team-tier\.is-custom\s*\{[^}]*width:/);
  assert.doesNotMatch(renderer, /index \? "AWAY" : "HOME"/);
  assert.match(roomDialog, /sourceMatch\?\.status === "confirmed"/);
  assert.match(roomDialog, /\/app\/receipt\?match=/);
  assert.match(roomDialog, /영수증 발급/);
  assert.match(digitGenerator, /const CELL_WIDTH = 196/);
  assert.match(digitGenerator, /const DIGIT_WIDTH = 176/);
  assert.match(digitGenerator, /const DIGIT_HEIGHT = 372/);
  assert.match(digitGenerator, /match-receipt-score-digits-source-v1\.png/);
  assert.match(digitGenerator, /match-receipt-score-digits-v3\.png/);
  assert.match(digitGenerator, /const GLYPH_COUNT = 11/);
  assert.match(digitGenerator, /const SOURCE_COLUMNS = 5/);
  assert.match(digitGenerator, /greenExcess/);
  assert.doesNotMatch(digitGenerator, /fontfile:/);
  assert.doesNotMatch(digitGenerator, /const DIGIT_PATHS =/);
  assert.doesNotMatch(digitGenerator, /<svg/);
  assert.match(displayAssetGenerator, /match-receipt-scoreboard-digits-v2\.png/);
  assert.match(displayAssetGenerator, /const COLORS = \[\[178, 111, 70\], \[181, 143, 112\]\]/);
  assert.match(displayAssetGenerator, /const GLOW_RADIUS = 1\.5/);
  assert.match(displayAssetGenerator, /const SEGMENT_ALPHA = 0\.76/);
  assert.match(displayAssetGenerator, /const GLOW_ALPHA = 0\.08/);
  assert.match(displayAssetGenerator, /match-receipt-wordmark-v1\.png/);
  assert.doesNotMatch(displayAssetGenerator, /<svg|fontfile:/);
  assert.match(syncScript, /match-receipt-score-digits-v3\.png/);
  assert.match(syncScript, /rankball-record-create-night-v10\.webp/);
  assert.match(syncScript, /match-receipt-scoreboard-digits-v1\.png/);
  assert.match(syncScript, /match-receipt-scoreboard-digits-v2\.png/);
  assert.match(syncScript, /match-receipt-wordmark-v1\.png/);
  assert.match(syncScript, /thermal-receipt\/thermal-paper-texture-2048\.png/);
  assert.match(syncScript, /thermal-receipt\/thermal-ink-mask-body-2048\.png/);
  assert.match(syncScript, /thermal-receipt\/thermal-ink-mask-team-2048\.png/);
  assert.match(syncScript, /thermal-receipt\/thermal-ink-mask-heavy-2048\.png/);
  assert.match(syncScript, /thermal-receipt\/thermal-ink-mask-photo-2048\.png/);
  assert.match(syncScript, /thermal-receipt\/serration-edge-796x16\.svg/);
  assert.match(syncScript, /R2_UPLOAD_MAX_ATTEMPTS = 3/);
  assert.match(syncScript, /response\.status === 429 \|\| response\.status >= 500/);
  assert.match(draftApi, /allowRequestMethod\(request, response, \["GET", "POST"\]\)/);
  assert.match(draftApi, /sourceMatchId/);
  assert.match(draftApi, /clonePublicId/);
  assert.match(draftApi, /canClaim/);
  assert.match(draftApi, /trustedCanonical/);
  assert.match(renderer, /label: `\$\{winner\.name\} WIN`/);
  assert.match(thermalRenderer, /drawThermalText\(ctx, model\.outcome\.label,/);
  assert.doesNotMatch(thermalRenderer, /`WIN\s+\$\{winner\}/);
  assert.match(preview, /<small>\{model\.outcome\.label\}<\/small>/);
  assert.doesNotMatch(preview, /className="match-receipt-outcome"/);
  assert.match(renderer, /ctx\.fillText\(model\.outcome\.label, 44, 105\)/);
  assert.doesNotMatch(renderer, /ctx\.fillText\(model\.outcome\.label, width \/ 2/);
  assert.doesNotMatch(detailStyles, /\.match-receipt-outcome/);
  assert.match(detailStyles, /\.match-receipt-wordmark small/);
  assert.match(page, /<div className="match-receipt-preview-head">\s*<span>\{receiptCopy\.preview\}<\/span>/);
  assert.doesNotMatch(page, /<strong>\{outcome\.label\}<\/strong>/);
  assert.match(renderer, /MY TIER · \$\{model\.personalTier\.label\}/);
  assert.doesNotMatch(renderer, /const badgeSize = actualSize \* 0\.14/);
  assert.match(renderer, /const badgeSize = 5/);
  assert.doesNotMatch(renderer, /ctx\.fillRect\(x, y, actualSize, actualSize\)/);
  assert.match(renderer, /model\.hasPersonalStats \? "MY GAME" : "GAME INFO"/);
  assert.match(renderer, /ctx\.fillText\(model\.matchNatureLabel/);
  assert.match(renderer, /if \(commentLines\.length\)/);
  assert.match(renderer, /commentLines\.forEach/);
  assert.doesNotMatch(renderer, /model\.comment \|\| "내 경기 기록"/);
  assert.match(renderer, /renderMatchReceiptCanvas\(value, "story", options\)/);
  assert.doesNotMatch(renderer, /const storyBlob = await renderMatchReceiptPng/);
  assert.doesNotMatch(renderer, /loadCanvasImage\(storyBlob\)/);
  assert.match(renderer, /getMatchReceiptCanvasSize\("feed"\)/);
  assert.match(renderer, /const targetHeight = height/);
  assert.match(renderer, /story\.width \/ story\.height/);
  assert.match(renderer, /const targetX = \(width - targetWidth\) \/ 2/);
  assert.match(renderer, /ctx\.drawImage\(story, targetX, 0, targetWidth, targetHeight\)/);
  assert.match(renderer, /canvasToBlob\(canvas, "image\/png"\)/);
  assert.match(landing, /<h1>농구 기록을 쌓고 연결하세요\.<\/h1>/u);
  assert.match(landing, /가입 없이 영수증 만들기/u);
  assert.match(landing, /별도 가입 없이 로그인/u);
  assert.match(landing, /to="\/app\/receipt"/u);
  assert.match(landing, /<MatchReceiptPreview draft=\{LANDING_RECEIPT_DRAFT\}/u);
  assert.equal(landing.match(/<MatchReceiptPreview/gu)?.length, 1);
  assert.match(appSource, /path="\/start"/);
  assert.equal(homeNeutralMark.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(awayNeutralMark.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(paperGrain.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(scoreDigitSource.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(scoreDigits.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(scoreboardDigits.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(wordmark.subarray(1, 4).toString("ascii"), "PNG");
  assert.ok(scoreDigitSource.length > 1_000_000);
  assert.ok(paperGrain.length > 1_000_000);
  assert.ok(scoreDigits.length > 500_000);
  assert.ok(scoreboardDigits.length > 3_000);
  assert.ok(wordmark.length > 10_000);
  assert.match(tokens, /font-family: "Bebas Neue"/);
  assert.match(tokens, /BebasNeue-Regular\.ttf/);
  assert.match(tokens, /font-family: "Black Han Sans"/);
  assert.ok(bebasNeue.length > 50_000);
  assert.match(bebasLicense, /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.ok(blackHanSans.length > 500_000);
});
