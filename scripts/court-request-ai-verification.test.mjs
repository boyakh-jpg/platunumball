import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getCoordinateDistanceMeters } from "../shared/lib/courtRequestImagePolicy.js";
import { uploadPrivateR2Webp } from "../server/api/_r2ImageStorage.js";
import { getCourtVerificationDecision, normalizeCourtPhotoAiAnswer } from "../server/lib/courtRequestVerification.js";

const eligibleAssessment = {
  basketballCourt: true,
  hoopVisible: true,
  overviewVisible: true,
  screenshotOrSynthetic: false,
  courtLayout: "full",
  confidence: 0.99,
};

const eligibleEvidence = {
  assessments: [eligibleAssessment, eligibleAssessment],
  photoCount: 2,
  expectedLayout: "full",
  fieldAccuracyMeters: 12,
  fieldDistanceMeters: 18,
  fieldCapturedAt: new Date().toISOString(),
  trustScore: 90,
  nearbyDuplicateCount: 0,
  type: "야외",
  publicAccess: "public",
};

test("court AI policy auto-approves only complete high-confidence evidence", () => {
  assert.equal(getCourtVerificationDecision(eligibleEvidence).decision, "auto_approve");
  assert.equal(getCourtVerificationDecision({ ...eligibleEvidence, fieldDistanceMeters: null }).decision, "manual_review");
});

test("court AI response and coordinate distance are normalized", () => {
  assert.deepEqual(normalizeCourtPhotoAiAnswer(`result: ${JSON.stringify(eligibleAssessment)}`), eligibleAssessment);
  assert.ok(getCoordinateDistanceMeters(37.5, 127, 37.5001, 127) > 10);
  assert.equal(getCoordinateDistanceMeters(37.5, 127, null, 127), null);
});

test("court evidence migration keeps data private and RPC guarded", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260803222000_court_request_ai_verification.sql", import.meta.url), "utf8");
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on table public\.court_request_evidence from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.rankball_auto_approve_court_request\(text\) to service_role/i);
  assert.doesNotMatch(sql, /drop table|truncate|delete from/i);
});

test("court photos use browser resizing and private R2", async () => {
  const [client, server, evidence] = await Promise.all([
    readFile(new URL("../src/lib/courtRequestImages.js", import.meta.url), "utf8"),
    readFile(new URL("../server/api/court-requests/submit.js", import.meta.url), "utf8"),
    readFile(new URL("../server/api/court-requests/evidence.js", import.meta.url), "utf8"),
  ]);
  assert.match(client, /canvasToWebp/);
  assert.doesNotMatch(client, /file\.size\s*[><=]/);
  assert.match(server, /getPrivateR2Config/);
  assert.match(server, /rankball_auto_approve_court_request/);
  assert.match(evidence, /requireAdminContext/);
  assert.match(evidence, /\^cr_sim_/);
});

test("private R2 upload creates a missing bucket once", async (context) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return requests.length === 1
      ? new Response(JSON.stringify({ errors: [{ message: "bucket not found" }] }), { status: 404 })
      : new Response("{}", { status: 200 });
  };

  await uploadPrivateR2Webp(
    { accountId: "account", apiToken: "token", bucket: "rankball-private" },
    "court-requests/cr_test/photo.webp",
    Buffer.from("webp"),
  );

  assert.deepEqual(requests.map(({ options }) => options.method), ["PUT", "POST", "PUT"]);
  assert.equal(JSON.parse(requests[1].options.body).name, "rankball-private");
});
