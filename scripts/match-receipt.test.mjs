import assert from "node:assert/strict";
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
