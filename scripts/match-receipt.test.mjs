import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createMatchReceiptViewModel,
  getMatchReceiptFormatLabel,
} from "../src/lib/matchReceipt.js";
import {
  createReceiptCapability,
  getReceiptCapabilityCookie,
  hashReceiptCapability,
  receiptCapabilityMatches,
  sanitizeReceiptDraftPayload,
  setReceiptCapabilityCookie,
} from "../server/api/match-receipts/_draftSecurity.js";

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
    matchNature: "semifinal",
    homeColor: "red",
    awayColor: "#ABCDEF",
    homeMmr: 1300,
    awayMmr: 1250,
    personalMmr: 1400,
    hasCanonicalTeamMatch: true,
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
  assert.equal(payload.matchNature, "semifinal");
  assert.equal(payload.homeColor, "#f05a46");
  assert.equal(payload.awayColor, "#abcdef");
  assert.equal(payload.homeMmr, 1300);
  assert.equal(payload.awayMmr, 1250);
  assert.equal(payload.verified, false);
  assert.equal("photo" in payload, false);
  assert.equal("photoZoom" in payload, false);
  assert.equal("personalMmr" in payload, false);
  assert.equal("hasCanonicalTeamMatch" in payload, false);
});

test("public receipt draft rejects unknown match nature", () => {
  assert.equal(sanitizeReceiptDraftPayload({ matchNature: "championship" }).matchNature, "competitive");
});

test("receipt view model uses compact game labels, address fallback, and a safe hashtag", () => {
  const draft = {
    playedOn: "2026-08-11",
    homeTeam: "HOME",
    awayTeam: "AWAY",
    homeScore: 60,
    awayScore: 46,
    address: "마포구",
    originalAddress: "서울특별시 마포구 망원동",
  };
  const model = createMatchReceiptViewModel(draft, { publicId: "public-receipt-id" });

  assert.equal(getMatchReceiptFormatLabel("3v3"), "3v3");
  assert.equal(getMatchReceiptFormatLabel("5v5"), "5v5");
  assert.equal(getMatchReceiptFormatLabel("other"), "OTHER");
  assert.equal(model.displayAddress, "마포구");
  assert.equal(createMatchReceiptViewModel({ ...draft, address: "" }).displayAddress, draft.originalAddress);
  assert.match(model.serial, /^#BT-[A-Z0-9]{6}$/);
  assert.equal(model.serial.includes("public-receipt-id"), false);
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
  const parsed = getReceiptCapabilityCookie(request);

  assert.deepEqual(parsed, capability);
  assert.equal(receiptCapabilityMatches(capability.secret, hash), true);
  assert.equal(receiptCapabilityMatches(`${capability.secret}x`, hash), false);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\/api\/match-receipts/);
  assert.equal(cookie.includes(hash), false);
});

test("receipt photo tools stay outside the export card and reference dividers remain", async () => {
  const [page, qrComponent, styles, tokens, renderer, homeNeutralMark, awayNeutralMark, paperGrain, scoreDigits, bebasNeue, bebasLicense, blackHanSans] = await Promise.all([
    readFile(new URL("../src/pages/MatchReceipt.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/common/QrCode.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/styles/features/match-receipt.css", import.meta.url), "utf8"),
    readFile(new URL("../src/styles/tokens.css", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/matchReceipt.js", import.meta.url), "utf8"),
    readFile(new URL("../public/assets/tier-emblems/tier-neutral-home-outline-v5.png", import.meta.url)),
    readFile(new URL("../public/assets/tier-emblems/tier-neutral-away-outline-v5.png", import.meta.url)),
    readFile(new URL("../public/assets/match-receipt-paper-grain-v1.png", import.meta.url)),
    readFile(new URL("../public/assets/match-receipt-score-digits-v1.png", import.meta.url)),
    readFile(new URL("../public/assets/fonts/BebasNeue-Regular.ttf", import.meta.url)),
    readFile(new URL("../public/assets/fonts/BebasNeue-OFL.txt", import.meta.url), "utf8"),
    readFile(new URL("../public/assets/fonts/BlackHanSans-Regular.ttf", import.meta.url)),
  ]);

  assert.doesNotMatch(page, /match-receipt-photo-editor|match-receipt-photo-crop/);
  assert.match(page, /photoGestureHandlers/);
  assert.match(page, /photoRotationHandleHandlers/);
  assert.match(page, /onWheel: zoomPhotoWithWheel/);
  assert.match(page, /onDoubleClick: resetPhotoTransform/);
  assert.match(page, /className="match-receipt-photo-tools"/);
  assert.match(page, /model\.hasPersonalStats \? "MY GAME" : "GAME INFO"/);
  assert.match(page, /match-receipt-personal-stats/);
  assert.match(page, /neutralTeamMarkUrls\.home/);
  assert.match(page, /neutralTeamMarkUrls\.away/);
  assert.match(page, /TEAM TIER · \$\{team\.tier\.label\}/);
  assert.match(page, /--receipt-paper-texture/);
  assert.match(page, /--receipt-paper-grain/);
  assert.match(page, /--receipt-score-digits/);
  assert.match(page, /ReceiptScoreDigits/);
  assert.match(page, /match-receipt-team-watermarks/);
  assert.match(page, /MY TIER · \{model\.personalTier\.label\}/);
  assert.match(page, /CourtMapPicker/);
  assert.match(page, /getRegisteredCourts/);
  assert.match(page, /mergeCourtSearchCourts/);
  assert.match(page, /inferRegionSelection\(courtMapRegionSource\)/);
  assert.match(page, /COURT_MAP_SEARCH_PURPOSE/);
  assert.match(page, /allowWhenDisabled: true, allowAnonymous: true/);
  assert.match(page, /loading=\{courtMapDirectoryStatus\.loading\}/);
  assert.match(page, /loadError=\{courtMapDirectoryStatus\.error\}/);
  assert.match(page, /직접 입력 또는 지도에서 선택/);
  assert.match(page, /RECEIPT_TEXT_FIELDS\.has\(name\)/);
  assert.match(page, /normalizeMatchReceiptDraft\(\{ \.\.\.current, venue, address, originalAddress \}\)/);
  assert.match(page, /model\.comment \|\| "내 경기 기록"/);
  assert.match(page, /className="match-receipt-qr" branded/);
  assert.match(page, /match-receipt-photo-backdrop/);
  assert.doesNotMatch(page, /index \? "AWAY" : "HOME"/);
  assert.match(page, /maxLength=\{MATCH_RECEIPT_LIMITS\.comment\} disabled=\{readOnlyReceipt\}/);
  assert.doesNotMatch(page, /match-receipt-color-input/);
  assert.match(qrComponent, /branded \? null : <rect/);
  assert.match(qrComponent, /qr\.matrix\.flatMap/);
  assert.match(qrComponent, /rx="0\.18"/);
  assert.match(qrComponent, /finderCenterPositions/);
  assert.match(qrComponent, />\s*B\s*<\/text>/);
  assert.match(styles, /\.match-receipt-photo\.is-editable[\s\S]*touch-action: none/);
  assert.match(styles, /\.match-receipt-photo-rotate-handle/);
  assert.match(styles, /\.match-receipt-photo-tools/);
  assert.match(styles, /\.match-receipt-game-info/);
  assert.match(styles, /\.match-receipt-poster-score > span[\s\S]*font-family: "Bebas Neue"/);
  assert.match(styles, /font-size: clamp\(10px, 3\.3cqw, 16px\)/);
  assert.match(styles, /\.match-receipt-verified\.is-receipt[\s\S]*font-family: "Bebas Neue"/);
  assert.match(styles, /background: var\(--receipt-paper-texture\)/);
  assert.match(styles, /auto 240% repeat-x/);
  assert.doesNotMatch(styles, /text-shadow: 0 4px 16px rgba\(0, 0, 0, 0\.42\)/);
  assert.match(styles, /\.match-receipt-score-digit[\s\S]*var\(--receipt-score-digits\)/);
  assert.match(styles, /1000% 100% no-repeat/);
  assert.match(styles, /\.match-receipt-card::after[\s\S]*var\(--receipt-paper-grain\)/);
  assert.match(styles, /\.match-receipt-ticket::after[\s\S]*var\(--receipt-paper-grain\)/);
  assert.match(styles, /font-family: "Black Han Sans", "KBO Dia Gothic", sans-serif/);
  assert.match(styles, /transform: scaleX\(0\.92\)/);
  assert.match(styles, /scale\(calc\(var\(--receipt-photo-scale\) \* 0\.92\)\)/);
  assert.match(styles, /\.match-receipt-team-watermarks[\s\S]*height: 34%/);
  assert.match(styles, /\.match-receipt-team-tier[\s\S]*width: 50%/);
  assert.match(styles, /inset: auto 3\.1% 1\.8%/);
  assert.match(styles, /height: 19\.9%/);
  assert.match(styles, /\.match-receipt-team-tier\.is-neutral[\s\S]*opacity: 0\.76/);
  assert.match(styles, /\.match-receipt-personal-tier[\s\S]*opacity: 0\.64/);
  assert.match(styles, /\.match-receipt-ticket-date[\s\S]*border-top/);
  assert.match(styles, /\.match-receipt-personal-stats b \+ b[\s\S]*border-left/);
  assert.match(renderer, /const receiptTop = compact \? 1010 : 1504/);
  assert.match(renderer, /createCanvasPaperPattern\(ctx, paperGrain\)/);
  assert.doesNotMatch(renderer, /ctx\.shadowColor = "rgba\(0,0,0,\.42\)"/);
  assert.match(renderer, /compact \? 154 : 278/);
  assert.match(renderer, /const teamWatermarkSize = compact \? 450 : 600/);
  assert.match(renderer, /const teamTierSize = compact \? 152 : 218/);
  assert.match(renderer, /defaultPhoto: !options\.photoBlob/);
  assert.match(renderer, /MATCH_RECEIPT_DEFAULT_PHOTO_FOCUS = Object\.freeze\(\{ x: 0, y: 82 \}\)/);
  assert.match(renderer, /const foregroundScale = options\.defaultPhoto \? 0\.92 : 1/);
  assert.match(renderer, /photoHeight \* 0\.42/);
  assert.match(renderer, /blurFade\.addColorStop\(0\.68, "rgba\(0,0,0,0\.72\)"\)/);
  assert.match(renderer, /fadeIn: 0\.24/);
  assert.match(renderer, /const footerLeftDivider = compact \? 386 : 414/);
  assert.match(renderer, /ctx\.moveTo\(footerMiddleX, footerY \+ \(compact \? 30 : 70\)\)/);
  assert.match(renderer, /createCanvasPaperPattern/);
  assert.match(renderer, /drawCanvasPaperGrain/);
  assert.match(renderer, /drawCanvasScoreDigits/);
  assert.match(renderer, /loadCanvasImage\(model\.scoreDigitsUrl\)/);
  assert.match(renderer, /wrapCanvasText/);
  assert.match(renderer, /tier-neutral-home-outline-v5\.png/);
  assert.match(renderer, /tier-neutral-away-outline-v5\.png/);
  assert.match(renderer, /getTierDivisionNumber/);
  assert.match(renderer, /`\$\{tier\.name\}\$\{division \? ` \$\{division\}` : ""\}`\.toUpperCase\(\)/);
  assert.match(renderer, /rankball-record-create-night-v5\.webp/);
  assert.match(renderer, /document\.fonts\.load\('900 270px "Bebas Neue"'\)/);
  assert.match(renderer, /document\.fonts\.load\('900 58px "Black Han Sans"'\)/);
  assert.match(renderer, /TEAM TIER · \$\{team\.tier\.label\}/);
  assert.doesNotMatch(renderer, /index \? "AWAY" : "HOME"/);
  assert.match(renderer, /label: `\$\{winner\.name\} WIN`/);
  assert.match(renderer, /MY TIER · \$\{model\.personalTier\.label\}/);
  assert.match(renderer, /const badgeSize = actualSize \* 0\.14/);
  assert.doesNotMatch(renderer, /ctx\.fillRect\(x, y, actualSize, actualSize\)/);
  assert.match(renderer, /model\.hasPersonalStats \? "MY GAME" : "GAME INFO"/);
  assert.match(renderer, /ctx\.fillText\(model\.matchNatureLabel/);
  assert.match(renderer, /model\.comment \|\| "내 경기 기록"/);
  assert.equal(homeNeutralMark.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(awayNeutralMark.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(paperGrain.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(scoreDigits.subarray(1, 4).toString("ascii"), "PNG");
  assert.ok(paperGrain.length > 1_000_000);
  assert.ok(scoreDigits.length > 500_000);
  assert.match(tokens, /font-family: "Bebas Neue"/);
  assert.match(tokens, /BebasNeue-Regular\.ttf/);
  assert.match(tokens, /font-family: "Black Han Sans"/);
  assert.ok(bebasNeue.length > 50_000);
  assert.match(bebasLicense, /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.ok(blackHanSans.length > 500_000);
});
