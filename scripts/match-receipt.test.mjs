import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canCreatePublicMatchReceiptSnapshot,
  createDefaultMatchReceiptDraft,
  createMatchReceiptViewModel,
  getMatchReceiptDraftFromMatch,
  getMatchReceiptFormatLabel,
  getMatchReceiptSideTeamId,
  getMatchReceiptTeamNameScale,
  MATCH_RECEIPT_LIMITS,
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

test("saved team receipt emblems require an explicit receipt load and lock replacement uploads", async () => {
  const [receiptPage, teamPage, teamView, teamActions, teamApi, teamColumns, migration] = await Promise.all([
    readFile(new URL("../src/pages/MatchReceipt.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/TeamDetail.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/TeamDetailView.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/appData/actions/profileTeamActions.js", import.meta.url), "utf8"),
    readFile(new URL("../server/api/teams/emblem.js", import.meta.url), "utf8"),
    readFile(new URL("../shared/lib/repositoryColumns.js", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260814143000_team_receipt_emblem.sql", import.meta.url), "utf8"),
  ]);

  assert.match(receiptPage, /팀 엠블럼 불러오기/u);
  assert.match(receiptPage, /팀 저장 엠블럼이 있어 사진 업로드를 사용할 수 없습니다\./u);
  assert.match(receiptPage, /disabled>\s*<ImagePlus[^>]*\/> \{label\} 사진 올리기/u);
  assert.match(teamView, /영수증 엠블럼 만들기/u);
  assert.match(teamView, /영수증 엠블럼 변경/u);
  assert.match(teamPage, /createMatchReceiptLineArt/u);
  assert.match(teamActions, /action: "receipt-upload"/u);
  assert.match(teamApi, /rankball_update_team_receipt_emblem/u);
  assert.match(teamColumns, /receipt_emblem_key,receipt_emblem_updated_at/u);
  assert.match(migration, /create or replace function public\.rankball_update_team_receipt_emblem/u);
  assert.match(migration, /role = 'captain'/u);
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
    tournamentName: "BOXTIER LEAGUE",
    q1Home: 12,
    q1Away: "",
    homeEmblemKey: "team-emblems/home.png",
    homeUseLineArt: true,
    matchNature: "semifinal",
    comment: "123456789012345",
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
  assert.equal(payload.comment, "12345678901");
  assert.equal(payload.homeColor, "#f05a46");
  assert.equal(payload.awayColor, "#abcdef");
  assert.equal(payload.homeMmr, 1300);
  assert.equal(payload.awayMmr, 1250);
  assert.equal(payload.verified, false);
  assert.equal(payload.personalStatsEligible, false);
  assert.equal("photo" in payload, false);
  assert.equal("photoZoom" in payload, false);
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
  assert.equal(createMatchReceiptViewModel({ ...draft, address: "" }).locationLabel, draft.venue);
  assert.notEqual(createMatchReceiptViewModel({ ...draft, address: "" }).locationLabel, draft.originalAddress);
  assert.match(model.serial, /^#BT-[A-Z0-9]{6}$/);
  assert.equal(model.serial.includes("public-receipt-id"), false);
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
  assert.equal(edited.comment, "12345678901");
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
  const [page, preview, qrComponent, styles, tokens, renderer, roomDialog, digitGenerator, syncScript, draftApi, landing, appSource, homeNeutralMark, awayNeutralMark, paperGrain, scoreDigitSource, scoreDigits, wordmark, bebasNeue, bebasLicense, blackHanSans, detailStyles, emblemCropEditor, teamEmblem] = await Promise.all([
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
    readFile(new URL("../public/assets/match-receipt-score-digits-v3.png", import.meta.url)),
    readFile(new URL("../public/assets/boxtier_letter_dark.png", import.meta.url)),
    readFile(new URL("../public/assets/fonts/BebasNeue-Regular.ttf", import.meta.url)),
    readFile(new URL("../public/assets/fonts/BebasNeue-OFL.txt", import.meta.url), "utf8"),
    readFile(new URL("../public/assets/fonts/BlackHanSans-Regular.ttf", import.meta.url)),
    readFile(new URL("../src/styles/features/match-receipt-details.css", import.meta.url), "utf8"),
    readFile(new URL("../src/components/common/EmblemCropEditor.jsx", import.meta.url), "utf8"),
    readFile(new URL("../shared/lib/teamEmblem.js", import.meta.url), "utf8"),
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
  assert.match(page, /placeholder="선택 · 11자 이내"/);
  assert.match(page, /onClick=\{resetReceipt\}/);
  assert.match(page, /await publicDraftRequestRef\.current/);
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
  assert.match(detailStyles, /\.match-receipt-info-fields > label\s*\{[^}]*contain:\s*inline-size;/);
  assert.match(detailStyles, /\.match-receipt-info-fields input\[type="date"\]\s*\{[^}]*min-inline-size:\s*0;[^}]*max-inline-size:\s*100%;/);
  assert.match(landing, /children = "로그인"/);
  assert.match(landing, /가입 없이 Google로 로그인/);
  assert.match(page, /className="page-stack match-receipt-page"/);
  assert.match(page, /className="page-header match-receipt-page-head ui-page-hero ui-design-app-hero"/);
  assert.match(page, /> 뒤로가기/);
  assert.match(page, /> 홈으로/);
  assert.match(styles, /\.match-receipt-page\s*\{[^}]*width:\s*min\(100%, var\(--page-content-max\)\);[^}]*max-width:\s*var\(--page-content-max\);[^}]*margin-inline:\s*auto;[^}]*padding-block-end:\s*72px;/);
  assert.match(styles, /\.match-receipt-workspace\s*\{[^}]*width:\s*min\(1180px, 100%\);[^}]*margin:\s*0 auto;/);
  assert.doesNotMatch(styles, /match-receipt-page-head\.ui-design-app-hero\s*\{[^}]*margin-block-start:\s*0;/);
  assert.match(preview, /model\.hasPersonalStats \? "MY GAME" : "GAME INFO"/);
  assert.match(preview, /match-receipt-personal-stats/);
  assert.match(preview, /neutralTeamMarkUrls\.home/);
  assert.match(preview, /neutralTeamMarkUrls\.away/);
  assert.match(page, /canonicalHomeTeamMmr/);
  assert.match(page, /app\?\.state\?\.teams/);
  assert.match(page, /homeMmr: canonicalHomeTeamMmr/);
  assert.match(page, /RECEIPT_PERIOD_FIELDS/);
  assert.match(page, /homeUseLineArt/);
  assert.match(page, /TEAM_EMBLEM_LINE_ART_PROMPT/);
  assert.match(page, /배경은 완전 투명\(alpha 0\)/);
  assert.match(page, /순수 #00FF00/);
  assert.match(page, /copyTeamEmblemPrompt/);
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
  assert.match(page, /EmblemCropEditor/);
  assert.match(page, /prepareTeamEmblemUpload\(file, crop, \{ circular: true \}\)/);
  assert.match(page, /reserveImageSaveWindow\(\)/);
  assert.match(page, /saveWindow\.location\.replace\(url\)/);
  assert.match(page, /공유 메뉴에서 이미지 저장을 선택하세요/);
  assert.match(page, /try \{\s*publicId = await ensurePublicDraft\(result\.draft\);\s*\} catch \{/);
  assert.match(page, /const publicMatchUrl = publicId\s*\? new URL/);
  assert.match(page, /<EmblemCropEditor\s+file=\{emblemCropTarget\?\.file\}\s+circular/);
  assert.match(emblemCropEditor, /drawEmblemCrop\([^;]+\{ circular \}\)/);
  assert.match(teamEmblem, /context\.arc\(dimension \/ 2, dimension \/ 2, dimension \/ 2/);
  assert.match(teamEmblem, /if \(options\.circular === true\) context\.restore\(\)/);
  assert.match(page, /setCroppedTeamEmblemUrls/);
  assert.match(page, /setEmblemCropCandidate\(\{ side, croppedUrl, lineArtUrl, width: prepared\.width, height: prepared\.height \}\)/);
  assert.match(page, /convertedPreview=\{emblemCropCandidate && emblemCropTarget && emblemCropCandidate\.side === emblemCropTarget\.side/);
  assert.match(page, /onConvert=\{convertTeamEmblemCrop\}/);
  assert.doesNotMatch(page, /lineArtPreview|convertTeamEmblemToLineArt|confirmTeamLineArt/);
  assert.match(emblemCropEditor, /선화로 변경/);
  assert.match(emblemCropEditor, /disabled=\{pending \|\| \(Boolean\(onConvert\) && !convertedPreview\)\}/);
  assert.match(emblemCropEditor, /onClick=\{\(\) => onConfirm\?\.\(crop\)\}>확인</);
  assert.match(page, /자동 변환 결과가 좋지 않으면 AI를 이용해 투명 배경 선화로 바꾼 뒤 다시 업로드하세요/);
  assert.match(page, /자동 변환 결과는 자동 적용하지 않으며, 미리보기 확인 후 직접 선택합니다/);
  assert.doesNotMatch(page, /기계 변환/);
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
  assert.match(page, />짧은 장소 <input[^>]+placeholder="경기 장소 대신 주소나 장소를 입력 가능"/);
  assert.match(page, /draft\.originalAddress \|\| profileCourtRegion/);
  assert.match(page, /RECEIPT_TEXT_FIELDS\.has\(name\)/);
  assert.match(page, /normalizeMatchReceiptDraft\(\{ \.\.\.current, venue, address, originalAddress \}\)/);
  assert.match(preview, /const hasSingleGameInfoMeta = !model\.hasPersonalStats[\s\S]*Boolean\(model\.comment\) !== Boolean\(model\.personalTier\)/);
  assert.match(preview, /hasSingleGameInfoMeta \? " match-receipt-ticket-game--single-meta" : ""/);
  assert.match(preview, /<span className="match-receipt-ticket-caption">\{model\.comment \|\| "\\u00a0"\}<\/span>/);
  assert.doesNotMatch(page, /model\.comment \|\| "내 경기 기록"/);
  assert.match(preview, /className="match-receipt-qr" branded/);
  assert.match(page, /new URL\("\/app\/receipt", window\.location\.origin\)/);
  assert.match(page, /if \(activePublicDraftId\) url\.searchParams\.set\("draft", activePublicDraftId\)/);
  assert.match(receiptSources, /\/app\/receipt\?draft=/);
  assert.doesNotMatch(receiptSources, /\/app\/matches\?match=/);
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
  assert.match(page, /return Boolean\(canonicalMatchId && CANONICAL_RECEIPT_FIELDS\.has\(name\)\)/);
  assert.doesNotMatch(page, /return Boolean\(requestedPublicDraftId \|\|/);
  assert.doesNotMatch(page, /publicDraftId && !requestedPublicDraftId/);
  assert.doesNotMatch(page, /receipt_draft_stale/);
  assert.doesNotMatch(page, /state:\s*\{\s*receiptDraft: getMatchReceiptCreateDraft\(draft\)/);
  assert.match(preview, /match-receipt-photo-backdrop/);
  assert.doesNotMatch(receiptSources, /index \? "AWAY" : "HOME"/);
  assert.match(preview, /index \? "TEAM B" : "TEAM A"/);
  assert.doesNotMatch(preview, /HOME TEAM|AWAY TEAM/);
  assert.match(page, /<legend>TEAM A<\/legend>/);
  assert.match(page, /<legend>TEAM B<\/legend>/);
  assert.doesNotMatch(page, /홈팀|원정팀/);
  assert.doesNotMatch(page, /홈 점수|원정 점수|placeholder="홈"|placeholder="원정"/);
  assert.doesNotMatch(renderer, /HOME TEAM|AWAY TEAM|홈팀 이름|원정팀 이름/);
  assert.match(page, /maxLength=\{MATCH_RECEIPT_LIMITS\.comment\} disabled=\{isFieldReadOnly\("comment"\)\}/);
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
  assert.match(styles, /\.match-receipt-photo\.is-editable[\s\S]*touch-action: none/);
  assert.match(styles, /\.match-receipt-photo \{[\s\S]*height: 46\.09375%/);
  assert.match(styles, /\.match-receipt-poster-teams > div:not\(\.match-receipt-game-detail\) > strong[\s\S]*overflow-wrap: anywhere[\s\S]*word-break: normal/);
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
  assert.match(styles, /1100% 100% no-repeat/);
  assert.match(styles, /\.match-receipt-card::after[\s\S]*var\(--receipt-paper-grain\)/);
  assert.doesNotMatch(styles, /\.match-receipt-ticket::after/);
  assert.match(styles, /font-family: "Black Han Sans", "KBO Dia Gothic", sans-serif/);
  assert.match(styles, /transform: scaleX\(0\.92\)/);
  assert.match(styles, /scale\(calc\(var\(--receipt-photo-scale\) \* 0\.92\)\)/);
  assert.match(styles, /\.match-receipt-team-watermarks[\s\S]*height: 34%/);
  assert.match(styles, /\.match-receipt-team-watermarks img \{[\s\S]*opacity: 0\.08;[\s\S]*filter: grayscale\(1\) brightness\(0\) invert\(1\)/);
  assert.doesNotMatch(detailStyles, /\.match-receipt-team-watermarks img\.is-custom/);
  assert.match(styles, /\.match-receipt-poster-teams \.match-receipt-team-tier\s*\{[\s\S]*top: 42%;[\s\S]*width: 30%;/);
  assert.match(styles, /--receipt-team-name-size/);
  assert.match(styles, /font-size: clamp\(7px, 2\.1cqw, 10px\)/);
  assert.match(styles, /height: 19\.9%/);
  assert.match(styles, /\.match-receipt-team-tier\.is-neutral[\s\S]*opacity: 0\.76/);
  assert.match(styles, /\.match-receipt-personal-tier[\s\S]*width: 92%[\s\S]*opacity: 0\.64/);
  assert.match(styles, /\.match-receipt-ticket-qr \.match-receipt-qr[\s\S]*width: 94%[\s\S]*max-height: 94%/);
  assert.match(styles, /\.match-receipt-game-info b\s*\{[^}]*font-family: "Bebas Neue"/);
  assert.match(styles, /\.match-receipt-ticket-game > \.match-receipt-ticket-caption\s*\{[^}]*padding-top: 5%;[^}]*font-size: clamp\(8px, 2\.5cqw, 12px\)/);
  assert.doesNotMatch(styles, /\.match-receipt-ticket-game > \.match-receipt-ticket-caption\s*\{[^}]*margin-top:\s*auto/);
  assert.match(styles, /--receipt-ticket-divider-y:\s*58%/);
  assert.match(styles, /\.match-receipt-ticket-date[\s\S]*top:\s*var\(--receipt-ticket-divider-y\)/);
  assert.match(styles, /\.match-receipt-ticket-date\s*\{[^}]*color:\s*#bd4e2a/);
  assert.match(styles, /\.match-receipt-ticket-game > \.match-receipt-ticket-caption[\s\S]*top:\s*var\(--receipt-ticket-divider-y\)/);
  assert.match(styles, /\.match-receipt-personal-tier-label[\s\S]*top:\s*78%/);
  assert.match(styles, /\.match-receipt-ticket-game--single-meta > :is\(\.match-receipt-ticket-caption, \.match-receipt-personal-tier-label\) \{ top: var\(--receipt-ticket-divider-y\); padding-top: 7%; \}/);
  assert.match(styles, /\.match-receipt-team-fields fieldset[\s\S]*background: var\(--surface-2\)[\s\S]*border: 0;/);
  assert.match(styles, /\.match-receipt-photo-tools[\s\S]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(detailStyles, /input\[type="date"\][\s\S]*min-inline-size: 0[\s\S]*max-inline-size: 100%/);
  assert.match(detailStyles, /\.match-receipt-period-fields input\[type="number"\][\s\S]*appearance: textfield/);
  assert.match(detailStyles, /::-webkit-inner-spin-button,[\s\S]*::-webkit-outer-spin-button[\s\S]*-webkit-appearance: none/);
  assert.match(detailStyles, /\.match-receipt-game-detail[\s\S]*top: 76%/);
  assert.match(renderer, /const centerTop = compact \? 900 : 1350/);
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*?\.match-receipt-editor \{[\s\S]*?display: contents;[\s\S]*?\.match-receipt-preview-panel \{[\s\S]*?order: 2;[\s\S]*?\.match-receipt-complete \{[\s\S]*?order: 3;/);
  assert.match(styles, /\.match-receipt-ticket-date[\s\S]*border-top/);
  assert.match(styles, /\.match-receipt-ticket\s*\{[^}]*inset:\s*auto 0 1\.8%;/);
  assert.match(styles, /\.match-receipt-personal-stats b \+ b[\s\S]*border-left/);
  assert.match(renderer, /const receiptTop = compact \? 1010 : 1504/);
  assert.match(renderer, /ctx\.fillStyle = "#d4582b";\s*ctx\.font = '900 27px "KBO Dia Gothic", sans-serif';\s*ctx\.fillText\(model\.playedOn/);
  assert.match(renderer, /ctx\.drawImage\(paper, 0, receiptTop, width, height - receiptTop - \(compact \? 26 : 34\)\)/);
  assert.equal(MATCH_RECEIPT_PHOTO_ASPECT, 1080 / 885);
  assert.match(renderer, /match-receipt-score-digits-v3\.png/);
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
  assert.match(renderer, /defaultPhoto: !options\.photoBlob/);
  assert.match(renderer, /const shiftX = rect\.width \* panRange \* photoX \/ 100/);
  assert.match(renderer, /MATCH_RECEIPT_DEFAULT_PHOTO_FOCUS = Object\.freeze\(\{ x: 0, y: 82 \}\)/);
  assert.match(renderer, /const foregroundScale = options\.defaultPhoto \? 0\.92 : 1/);
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
  assert.match(renderer, /const footerCommentOffset = footerMiddleDividerOffset \+ \(compact \? 24 : 30\)/);
  assert.match(renderer, /const footerTierLabelOffset = compact \? 184 : 246/);
  assert.match(renderer, /const footerDateOffset = compact \? 174 : 244/);
  assert.match(renderer, /const hasSingleGameInfoMeta = !model\.hasPersonalStats[\s\S]*Boolean\(model\.comment\) !== Boolean\(personalTier\)/);
  assert.match(renderer, /hasSingleGameInfoMeta \? footerDateOffset : footerCommentOffset/);
  assert.match(renderer, /hasSingleGameInfoMeta \? footerDateOffset : footerTierLabelOffset/);
  assert.match(renderer, /const tierSize = compact \? 150 : 192/);
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
  assert.match(digitGenerator, /match-receipt-score-digits-v3\.png/);
  assert.match(digitGenerator, /const GLYPH_COUNT = 11/);
  assert.match(digitGenerator, /const SOURCE_COLUMNS = 5/);
  assert.match(digitGenerator, /greenExcess/);
  assert.doesNotMatch(digitGenerator, /fontfile:/);
  assert.doesNotMatch(digitGenerator, /const DIGIT_PATHS =/);
  assert.doesNotMatch(digitGenerator, /<svg/);
  assert.match(syncScript, /match-receipt-score-digits-v3\.png/);
  assert.match(syncScript, /boxtier_letter_dark\.png/);
  assert.match(draftApi, /allowRequestMethod\(request, response, \["GET", "POST"\]\)/);
  assert.match(draftApi, /sourceMatchId/);
  assert.match(draftApi, /clonePublicId/);
  assert.match(draftApi, /canClaim/);
  assert.match(draftApi, /trustedCanonical/);
  assert.match(renderer, /label: `\$\{winner\.name\} WIN`/);
  assert.match(renderer, /MY TIER · \$\{model\.personalTier\.label\}/);
  assert.doesNotMatch(renderer, /const badgeSize = actualSize \* 0\.14/);
  assert.match(renderer, /const badgeSize = 5/);
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
