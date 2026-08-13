import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canCreatePublicMatchReceiptSnapshot,
  createDefaultMatchReceiptDraft,
  createMatchReceiptViewModel,
  getMatchReceiptDraftFromMatch,
  getMatchReceiptFormatLabel,
  getMatchReceiptTeamNameScale,
  MATCH_RECEIPT_PHOTO_ASPECT,
  normalizeMatchReceiptDraft,
  renewMatchReceiptDraft,
} from "../src/lib/matchReceipt.js";

test("receipt team names shrink before they can overflow", () => {
  assert.equal(getMatchReceiptTeamNameScale("SHORT TEAM"), 1);
  assert.equal(getMatchReceiptTeamNameScale("ABCDEFGHIJKLM"), 0.88);
  assert.equal(getMatchReceiptTeamNameScale("ABCDEFGHIJKLMNOPQ"), 0.78);
  assert.equal(getMatchReceiptTeamNameScale("ABCDEFGHIJKLMNOPQRSTU"), 0.68);
});
import {
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
import { RECORD_TYPES } from "../src/lib/constants.js";
import { getTierDivision, getTierLabel } from "../shared/lib/tier.js";

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
    comment: "123456789012345",
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
  assert.equal(payload.comment, "123456789012");
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

test("only trusted canonical receipt payload keeps server-only fields", () => {
  const source = {
    personalMmr: 1400,
    hasCanonicalTeamMatch: true,
    verified: true,
  };
  const trusted = sanitizeReceiptDraftPayload(source, { trustedCanonical: true });
  const untrusted = sanitizeReceiptDraftPayload(source);

  assert.equal(trusted.personalMmr, 1400);
  assert.equal(trusted.hasCanonicalTeamMatch, true);
  assert.equal(trusted.verified, true);
  assert.equal("personalMmr" in untrusted, false);
  assert.equal("hasCanonicalTeamMatch" in untrusted, false);
  assert.equal(untrusted.verified, false);
});

test("public receipt projection omits internal address and exact personal rating", () => {
  const projected = projectPublicReceiptDraft({
    _canonicalReceipt: true,
    serialSeed: "canonical:0123456789abcdef",
    originalAddress: "서울특별시 마포구 전체 원주소",
    personalMmr: 1400,
    personalPoints: 12,
    verified: true,
    hasCanonicalTeamMatch: true,
  });

  assert.equal("originalAddress" in projected, false);
  assert.equal("personalMmr" in projected, false);
  assert.equal(projected.personalPoints, 12);
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

test("only confirmed public team matches can create canonical public receipt snapshots", () => {
  const match = {
    id: "match-123",
    status: "confirmed",
    visibility: "public",
    rules: { recordType: RECORD_TYPES.match },
  };

  assert.equal(canCreatePublicMatchReceiptSnapshot(match), true);
  assert.equal(canCreatePublicMatchReceiptSnapshot({ ...match, visibility: "private" }), false);
  assert.equal(canCreatePublicMatchReceiptSnapshot({
    ...match,
    rules: { recordType: RECORD_TYPES.personalRecord },
  }), false);
  assert.equal(canCreatePublicMatchReceiptSnapshot({
    ...match,
    rules: { recordType: "personal_record" },
  }), false);
  assert.equal(canCreatePublicMatchReceiptSnapshot({ ...match, status: "pending" }), false);
  assert.equal(canCreatePublicMatchReceiptSnapshot({ ...match, visibility: undefined }), false);
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

  assert.equal(getMatchReceiptFormatLabel("3v3"), "3v3");
  assert.equal(getMatchReceiptFormatLabel("5v5"), "5v5");
  assert.equal(getMatchReceiptFormatLabel("other"), "OTHER");
  assert.equal(model.locationLabel, "마포구");
  assert.equal(createMatchReceiptViewModel({ ...draft, address: "" }).locationLabel, draft.venue);
  assert.notEqual(createMatchReceiptViewModel({ ...draft, address: "" }).locationLabel, draft.originalAddress);
  assert.match(model.serial, /^#BT-[A-Z0-9]{6}$/);
  assert.equal(model.serial.includes("public-receipt-id"), false);
});

test("receipt serial stays stable until a new receipt is explicitly started", () => {
  const draft = createDefaultMatchReceiptDraft();
  const edited = normalizeMatchReceiptDraft({
    ...draft,
    homeTeam: "EDITED",
    homeScore: 99,
    comment: "123456789012345",
  });
  const renewed = renewMatchReceiptDraft(edited);
  const match = {
    id: "match-123",
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
  assert.equal(edited.comment, "123456789012");
  assert.equal(createMatchReceiptViewModel(edited).serial, createMatchReceiptViewModel(draft).serial);
  assert.notEqual(renewed.serialSeed, edited.serialSeed);
  assert.notEqual(createMatchReceiptViewModel(renewed).serial, createMatchReceiptViewModel(edited).serial);
  assert.equal(canonicalA.serialSeed, "canonical:opaque-seed");
  assert.equal(canonicalB.serialSeed, canonicalA.serialSeed);
  assert.equal(createMatchReceiptViewModel(canonicalA).serial, createMatchReceiptViewModel(canonicalB).serial);
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

test("receipt photo tools stay outside the export card and reference dividers remain", async () => {
  const [page, preview, qrComponent, styles, tokens, renderer, roomDialog, digitGenerator, syncScript, draftApi, landing, appSource, homeNeutralMark, awayNeutralMark, paperGrain, scoreDigitSource, scoreDigits, wordmark, bebasNeue, bebasLicense, blackHanSans] = await Promise.all([
    readFile(new URL("../src/pages/MatchReceipt.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/match/MatchReceiptPreview.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/common/QrCode.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/styles/features/match-receipt.css", import.meta.url), "utf8"),
    readFile(new URL("../src/styles/tokens.css", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/matchReceipt.js", import.meta.url), "utf8"),
    readFile(new URL("../src/components/recruiting/RecruitingRoomDialogSection.jsx", import.meta.url), "utf8"),
    readFile(new URL("../scripts/generate-receipt-score-digits.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/sync-receipt-assets-to-r2.mjs", import.meta.url), "utf8"),
    readFile(new URL("../server/api/match-receipts/draft.js", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/Landing.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../public/assets/tier-emblems/tier-neutral-home-outline-v5.png", import.meta.url)),
    readFile(new URL("../public/assets/tier-emblems/tier-neutral-away-outline-v5.png", import.meta.url)),
    readFile(new URL("../public/assets/match-receipt-paper-grain-v1.png", import.meta.url)),
    readFile(new URL("../public/assets/match-receipt-score-digits-source-v1.png", import.meta.url)),
    readFile(new URL("../public/assets/match-receipt-score-digits-v2.png", import.meta.url)),
    readFile(new URL("../public/assets/boxtier_letter_dark.png", import.meta.url)),
    readFile(new URL("../public/assets/fonts/BebasNeue-Regular.ttf", import.meta.url)),
    readFile(new URL("../public/assets/fonts/BebasNeue-OFL.txt", import.meta.url), "utf8"),
    readFile(new URL("../public/assets/fonts/BlackHanSans-Regular.ttf", import.meta.url)),
  ]);
  const receiptSources = `${page}\n${preview}`;

  assert.doesNotMatch(page, /match-receipt-photo-editor|match-receipt-photo-crop/);
  assert.match(page, /photoGestureHandlers/);
  assert.doesNotMatch(page, /photoRotationHandleHandlers/);
  assert.doesNotMatch(page, /getPhotoRotationHandleStyle/);
  assert.match(page, /querySelector\("\.match-receipt-photo"\)/);
  assert.match(page, /사진 자유 회전/);
  assert.match(page, /className="match-receipt-photo-rotate-handle"/);
  assert.doesNotMatch(page, /<RotateCcw aria-hidden="true" \/> 자유 회전/);
  assert.match(page, /<Button as="label" variant="secondary">/);
  assert.match(page, /<Button variant="danger" disabled=\{!photoUrl \|\| Boolean\(busy\)\} onClick=\{removePhoto\}>/);
  assert.match(page, /\{draft\.comment\.length\}\/\{MATCH_RECEIPT_LIMITS\.comment\}/);
  assert.match(page, /placeholder="선택 · 12자 이내"/);
  assert.match(page, /onClick=\{resetReceipt\}/);
  assert.match(page, /clearMatchReceiptDraft\(\)/);
  assert.match(page, /clearMatchReceiptPhoto\(\)/);
  assert.match(page, /createDefaultMatchReceiptDraft\(\)/);
  assert.doesNotMatch(page, /hardRefreshReceipt|match-receipt-hard-reset|window\.caches|cache: "reload"|location\.reload|FilePlus2|startNewReceipt/);
  assert.match(page, /onWheel: zoomPhotoWithWheel/);
  assert.match(page, /onDoubleClick: resetPhotoTransform/);
  assert.match(page, /className="match-receipt-photo-tools"/);
  assert.match(preview, /addEventListener\("touchmove", preventBrowserGesture, \{ passive: false \}\)/);
  assert.match(preview, /addEventListener\("gesturestart", preventBrowserGesture, \{ passive: false \}\)/);
  assert.match(preview, /addEventListener\("gesturechange", preventBrowserGesture, \{ passive: false \}\)/);
  assert.match(styles, /\.match-receipt-info-fields > label\s*\{[^}]*contain:\s*inline-size;/);
  assert.match(styles, /\.match-receipt-info-fields input\[type="date"\]\s*\{[^}]*min-inline-size:\s*0;[^}]*max-inline-size:\s*100%;/);
  assert.match(landing, /children = "로그인"/);
  assert.match(landing, /가입 없이 Google로 로그인/);
  assert.match(page, /className="page-header match-receipt-page-head ui-page-hero ui-design-app-hero"/);
  assert.match(page, /> 뒤로가기/);
  assert.match(page, /> 홈으로/);
  assert.match(preview, /model\.hasPersonalStats \? "MY GAME" : "GAME INFO"/);
  assert.match(preview, /match-receipt-personal-stats/);
  assert.match(preview, /neutralTeamMarkUrls\.home/);
  assert.match(preview, /neutralTeamMarkUrls\.away/);
  assert.match(page, /canonicalHomeTeamMmr/);
  assert.match(page, /app\?\.state\?\.teams/);
  assert.match(page, /homeMmr: canonicalHomeTeamMmr/);
  assert.match(preview, /TEAM TIER · \$\{team\.tier\.label\}/);
  assert.match(preview, /--receipt-paper-texture/);
  assert.match(preview, /--receipt-paper-grain/);
  assert.match(preview, /--receipt-score-digits/);
  assert.match(preview, /ReceiptScoreDigits/);
  assert.match(preview, /match-receipt-team-watermarks/);
  assert.match(preview, /MY TIER · \{model\.personalTier\.label\}/);
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
  assert.match(preview, /\{model\.comment \? <span/);
  assert.doesNotMatch(page, /model\.comment \|\| "내 경기 기록"/);
  assert.match(preview, /className="match-receipt-qr" branded/);
  assert.match(receiptSources, /\/app\/receipt\?draft=/);
  assert.doesNotMatch(receiptSources, /\/app\/matches\?match=/);
  assert.match(page, /sourceMatchId: canonicalMatchId/);
  assert.match(page, /clonePublicId: requestedPublicDraftId/);
  assert.match(page, /requestedDraftCanClaim/);
  assert.match(page, /draftRevisionRef/);
  assert.match(page, /receipt_draft_stale/);
  assert.doesNotMatch(page, /state:\s*\{\s*receiptDraft: getMatchReceiptCreateDraft\(draft\)/);
  assert.match(preview, /match-receipt-photo-backdrop/);
  assert.doesNotMatch(receiptSources, /index \? "AWAY" : "HOME"/);
  assert.match(page, /maxLength=\{MATCH_RECEIPT_LIMITS\.comment\} disabled=\{isFieldReadOnly\("comment"\)\}/);
  assert.doesNotMatch(page, /match-receipt-color-input/);
  assert.match(qrComponent, /branded \? null : <rect/);
  assert.match(qrComponent, /qr\.matrix\.flatMap/);
  assert.match(qrComponent, /rx="0\.18"/);
  assert.match(qrComponent, /finderCenterPositions/);
  assert.match(qrComponent, />\s*B\s*<\/text>/);
  assert.match(styles, /\.match-receipt-photo\.is-editable[\s\S]*touch-action: none/);
  assert.match(styles, /\.match-receipt-photo \{[\s\S]*height: 46\.09375%/);
  assert.match(styles, /\.match-receipt-poster-teams strong[\s\S]*overflow-wrap: anywhere[\s\S]*word-break: normal/);
  assert.match(styles, /\.match-receipt-photo-rotate-handle/);
  assert.match(styles, /\.match-receipt-photo-rotate-handle[\s\S]*position: absolute[\s\S]*top: 0[\s\S]*right: 0[\s\S]*cursor: grab[\s\S]*touch-action: none/);
  assert.match(styles, /\.match-receipt-photo-tools/);
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
  assert.match(styles, /1000% 100% no-repeat/);
  assert.match(styles, /\.match-receipt-card::after[\s\S]*var\(--receipt-paper-grain\)/);
  assert.match(styles, /\.match-receipt-ticket::after[\s\S]*var\(--receipt-paper-grain\)/);
  assert.match(styles, /font-family: "Black Han Sans", "KBO Dia Gothic", sans-serif/);
  assert.match(styles, /transform: scaleX\(0\.92\)/);
  assert.match(styles, /scale\(calc\(var\(--receipt-photo-scale\) \* 0\.92\)\)/);
  assert.match(styles, /\.match-receipt-team-watermarks[\s\S]*height: 34%/);
  assert.match(styles, /\.match-receipt-poster-teams \.match-receipt-team-tier\s*\{[\s\S]*top: 42%;[\s\S]*width: 30%;/);
  assert.match(styles, /--receipt-team-name-size/);
  assert.match(styles, /font-size: clamp\(6px, 1\.9cqw, 9px\)/);
  assert.match(styles, /inset: auto 3\.1% 1\.8%/);
  assert.match(styles, /height: 19\.9%/);
  assert.match(styles, /\.match-receipt-team-tier\.is-neutral[\s\S]*opacity: 0\.76/);
  assert.match(styles, /\.match-receipt-personal-tier[\s\S]*opacity: 0\.64/);
  assert.match(styles, /\.match-receipt-ticket-qr \.match-receipt-qr[\s\S]*width: 72%[\s\S]*max-height: 78%/);
  assert.match(styles, /\.match-receipt-team-fields fieldset[\s\S]*background: var\(--surface-2\)[\s\S]*border: 0;/);
  assert.match(styles, /\.match-receipt-photo-tools[\s\S]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(styles, /input\[type="date"\][\s\S]*min-width: 0[\s\S]*max-width: 100%/);
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*?\.match-receipt-editor \{[\s\S]*?display: contents;[\s\S]*?\.match-receipt-preview-panel \{[\s\S]*?order: 2;[\s\S]*?\.match-receipt-complete \{[\s\S]*?order: 3;/);
  assert.match(styles, /\.match-receipt-ticket-date[\s\S]*border-top/);
  assert.match(styles, /\.match-receipt-personal-stats b \+ b[\s\S]*border-left/);
  assert.match(renderer, /const receiptTop = compact \? 1010 : 1504/);
  assert.equal(MATCH_RECEIPT_PHOTO_ASPECT, 1080 / 885);
  assert.match(renderer, /match-receipt-score-digits-v2\.png/);
  assert.match(renderer, /createCanvasPaperPattern\(ctx, paperGrain\)/);
  assert.doesNotMatch(renderer, /ctx\.shadowColor = "rgba\(0,0,0,\.42\)"/);
  assert.match(renderer, /compact \? 154 : 278/);
  assert.match(renderer, /const scoreBaseline = compact \? scoreTop \+ 132 : 1163/);
  assert.match(renderer, /const teamWatermarkSize = compact \? 450 : 600/);
  assert.match(renderer, /const teamTop = compact \? 779 : 1192/);
  assert.match(renderer, /const teamTierY = compact \? 838 : 1311/);
  assert.match(renderer, /const teamTierSize = compact \? 116 : 140/);
  assert.match(renderer, /const teamLabelY = compact \? 982 : 1474/);
  assert.match(renderer, /teamFontSize \* getMatchReceiptTeamNameScale\(team\.name\)/);
  assert.match(renderer, /ctx\.font = `900 \$\{compact \? 14 : 15\}px "KBO Dia Gothic", sans-serif`/);
  assert.match(renderer, /defaultPhoto: !options\.photoBlob/);
  assert.match(renderer, /const shiftX = rect\.width \* panRange \* photoX \/ 100/);
  assert.match(renderer, /MATCH_RECEIPT_DEFAULT_PHOTO_FOCUS = Object\.freeze\(\{ x: 0, y: 82 \}\)/);
  assert.match(renderer, /const foregroundScale = options\.defaultPhoto \? 0\.92 : 1/);
  assert.match(renderer, /photoHeight \* 0\.42/);
  assert.match(renderer, /blurFade\.addColorStop\(0\.68, "rgba\(0,0,0,0\.72\)"\)/);
  assert.match(renderer, /fadeIn: 0\.24/);
  assert.match(renderer, /const footerLeftDivider = compact \? 386 : 414/);
  assert.match(renderer, /const qrSize = compact \? 176 : 218/);
  assert.match(renderer, /ctx\.moveTo\(footerMiddleX, footerY \+ \(compact \? 30 : 70\)\)/);
  assert.match(renderer, /createCanvasPaperPattern/);
  assert.match(renderer, /drawCanvasPaperGrain/);
  assert.match(renderer, /drawCanvasScoreDigits/);
  assert.match(renderer, /loadCanvasImage\(model\.scoreDigitsUrl\)/);
  assert.match(renderer, /function getCanvasImageSources\(source\)/);
  assert.match(renderer, /parsed\.pathname\.startsWith\("\/assets\/"\)/);
  assert.match(renderer, /const photoPromise = loadCanvasImage\(options\.photoBlob \|\| model\.defaultPhotoUrl\)/);
  assert.match(renderer, /options\.photoBlob \? loadCanvasImage\(model\.defaultPhotoUrl\)/);
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
  assert.match(roomDialog, /sourceMatch\?\.status === "confirmed"/);
  assert.match(roomDialog, /\/app\/receipt\?match=/);
  assert.match(roomDialog, /영수증 발급/);
  assert.match(digitGenerator, /const CELL_WIDTH = 196/);
  assert.match(digitGenerator, /const DIGIT_WIDTH = 176/);
  assert.match(digitGenerator, /const DIGIT_HEIGHT = 372/);
  assert.match(digitGenerator, /match-receipt-score-digits-source-v1\.png/);
  assert.match(digitGenerator, /match-receipt-score-digits-v2\.png/);
  assert.match(digitGenerator, /const SOURCE_COLUMNS = 5/);
  assert.match(digitGenerator, /greenExcess/);
  assert.doesNotMatch(digitGenerator, /fontfile:/);
  assert.doesNotMatch(digitGenerator, /const DIGIT_PATHS =/);
  assert.doesNotMatch(digitGenerator, /<svg/);
  assert.match(syncScript, /match-receipt-score-digits-v2\.png/);
  assert.match(syncScript, /boxtier_letter_dark\.png/);
  assert.match(draftApi, /allowRequestMethod\(request, response, \["GET", "POST"\]\)/);
  assert.match(draftApi, /sourceMatchId/);
  assert.match(draftApi, /clonePublicId/);
  assert.match(draftApi, /canClaim/);
  assert.match(draftApi, /trustedCanonical/);
  assert.match(renderer, /label: `\$\{winner\.name\} WIN`/);
  assert.match(renderer, /MY TIER · \$\{model\.personalTier\.label\}/);
  assert.match(renderer, /const badgeSize = actualSize \* 0\.14/);
  assert.doesNotMatch(renderer, /ctx\.fillRect\(x, y, actualSize, actualSize\)/);
  assert.match(renderer, /model\.hasPersonalStats \? "MY GAME" : "GAME INFO"/);
  assert.match(renderer, /ctx\.fillText\(model\.matchNatureLabel/);
  assert.match(renderer, /if \(model\.comment\)/);
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
  assert.match(landing, /농구 기록을<br \/>쌓고 연결하세요\./u);
  assert.match(landing, /가입 없이 영수증 만들기/u);
  assert.match(landing, /Google로 로그인/u);
  assert.match(landing, /to="\/app\/receipt"/u);
  assert.match(landing, /<MatchReceiptPreview draft=\{LANDING_RECEIPT_DRAFT\}/u);
  assert.equal(landing.match(/<MatchReceiptPreview/gu)?.length, 1);
  assert.match(appSource, /path="\/start"/);
  assert.equal(homeNeutralMark.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(awayNeutralMark.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(paperGrain.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(scoreDigitSource.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(scoreDigits.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(wordmark.subarray(1, 4).toString("ascii"), "PNG");
  assert.ok(scoreDigitSource.length > 1_000_000);
  assert.ok(paperGrain.length > 1_000_000);
  assert.ok(scoreDigits.length > 500_000);
  assert.ok(wordmark.length > 10_000);
  assert.match(tokens, /font-family: "Bebas Neue"/);
  assert.match(tokens, /BebasNeue-Regular\.ttf/);
  assert.match(tokens, /font-family: "Black Han Sans"/);
  assert.ok(bebasNeue.length > 50_000);
  assert.match(bebasLicense, /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.ok(blackHanSans.length > 500_000);
});
