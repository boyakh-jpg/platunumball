import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
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

test("receipt photo editing stays in the preview and reference dividers remain", async () => {
  const [page, styles, renderer, neutralMark] = await Promise.all([
    readFile(new URL("../src/pages/MatchReceipt.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/styles/features/match-receipt.css", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/matchReceipt.js", import.meta.url), "utf8"),
    readFile(new URL("../public/assets/tier-emblems/tier-neutral-outline-v2.png", import.meta.url)),
  ]);

  assert.doesNotMatch(page, /match-receipt-photo-editor|match-receipt-photo-crop/);
  assert.match(page, /photoGestureHandlers/);
  assert.match(page, /match-receipt-personal-stats/);
  assert.match(page, /neutralTeamMarkUrl/);
  assert.match(page, /TEAM TIER · \$\{team\.tier\.label\}/);
  assert.match(page, /--receipt-paper-texture/);
  assert.match(page, /model\.personalTier && model\.hasPersonalStats/);
  assert.match(page, /match-receipt-team-watermarks/);
  assert.match(page, /MY TIER · \{model\.personalTier\.label\}/);
  assert.match(page, /CourtMapPicker/);
  assert.match(page, /getRegisteredCourts/);
  assert.match(page, /직접 입력 또는 지도에서 선택/);
  assert.doesNotMatch(page, /match-receipt-color-input/);
  assert.match(styles, /\.match-receipt-photo\.is-editable[\s\S]*touch-action: none/);
  assert.match(styles, /\.match-receipt-poster-score > span[\s\S]*font-variation-settings: "wght" 300/);
  assert.match(styles, /font-size: clamp\(10px, 3\.3cqw, 16px\)/);
  assert.match(styles, /background: var\(--receipt-paper-texture\)/);
  assert.match(styles, /\.match-receipt-team-watermarks[\s\S]*height: 27%/);
  assert.match(styles, /\.match-receipt-team-tier[\s\S]*width: 38%/);
  assert.match(styles, /inset: auto 3\.1% 1\.8%/);
  assert.match(styles, /height: 19\.9%/);
  assert.match(styles, /\.match-receipt-team-tier\.is-neutral[\s\S]*opacity: 0\.9/);
  assert.match(styles, /\.match-receipt-personal-tier[\s\S]*opacity: 0\.48/);
  assert.match(styles, /\.match-receipt-ticket-date[\s\S]*border-top/);
  assert.match(styles, /\.match-receipt-personal-stats b \+ b[\s\S]*border-left/);
  assert.match(renderer, /const receiptTop = compact \? 1010 : 1504/);
  assert.match(renderer, /compact \? 146 : 270/);
  assert.match(renderer, /const teamWatermarkSize = compact \? 360 : 470/);
  assert.match(renderer, /const teamTierSize = compact \? 124 : 174/);
  assert.match(renderer, /const footerLeftDivider = compact \? 386 : 414/);
  assert.match(renderer, /ctx\.moveTo\(footerMiddleX, footerY \+ \(compact \? 30 : 70\)\)/);
  assert.match(renderer, /createCanvasPaperPattern/);
  assert.match(renderer, /wrapCanvasText/);
  assert.match(renderer, /tier-neutral-outline-v2\.png/);
  assert.match(renderer, /getTierDivisionNumber/);
  assert.match(renderer, /`\$\{tier\.name\}\$\{division \? ` \$\{division\}` : ""\}`\.toUpperCase\(\)/);
  assert.match(renderer, /rankball-record-create-night-v3\.webp/);
  assert.match(renderer, /TEAM TIER · \$\{team\.tier\.label\}/);
  assert.match(renderer, /MY TIER · \$\{model\.personalTier\.label\}/);
  assert.equal(neutralMark.subarray(1, 4).toString("ascii"), "PNG");
});
