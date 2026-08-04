import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getCoordinateDistanceMeters } from "../shared/lib/courtRequestImagePolicy.js";
import { uploadPrivateR2Webp } from "../server/api/_r2ImageStorage.js";
import { getCourtVerificationDecision, inspectCourtRequestPhotos, normalizeCourtPhotoAiAnswer } from "../server/lib/courtRequestVerification.js";
import courtAiWorker from "../cloudflare/court-ai/worker.js";

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
  assert.deepEqual(normalizeCourtPhotoAiAnswer({
    basketballCourt: "yes",
    hoopVisible: "yes",
    overviewVisible: "yes",
    screenshotOrSynthetic: "no",
    courtLayout: "standard",
    confidence: "high",
  }), { ...eligibleAssessment, confidence: 0.9 });
  assert.ok(getCoordinateDistanceMeters(37.5, 127, 37.5001, 127) > 10);
  assert.equal(getCoordinateDistanceMeters(37.5, 127, null, 127), null);
});

test("court evidence migration keeps data private and RPC guarded", async () => {
  const [sql, serviceRoleSql] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260803222000_court_request_ai_verification.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260804091749_court_request_evidence_service_role.sql", import.meta.url), "utf8"),
  ]);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on table public\.court_request_evidence from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.rankball_auto_approve_court_request\(text\) to service_role/i);
  assert.doesNotMatch(sql, /drop table|truncate|delete from/i);
  assert.match(serviceRoleSql, /grant select, update on table public\.court_request_evidence to service_role/i);
  assert.doesNotMatch(serviceRoleSql, /grant .* to (anon|authenticated)|drop table|truncate|delete from/i);
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

test("court AI retries one malformed response", async (context) => {
  const originalFetch = globalThis.fetch;
  const originalAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const originalAiToken = process.env.CLOUDFLARE_AI_API_TOKEN;
  const originalProxyUrl = process.env.CLOUDFLARE_AI_PROXY_URL;
  const originalProxySecret = process.env.CLOUDFLARE_AI_PROXY_SECRET;
  let calls = 0;
  const requests = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalAccountId === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID;
    else process.env.CLOUDFLARE_ACCOUNT_ID = originalAccountId;
    if (originalAiToken === undefined) delete process.env.CLOUDFLARE_AI_API_TOKEN;
    else process.env.CLOUDFLARE_AI_API_TOKEN = originalAiToken;
    if (originalProxyUrl === undefined) delete process.env.CLOUDFLARE_AI_PROXY_URL;
    else process.env.CLOUDFLARE_AI_PROXY_URL = originalProxyUrl;
    if (originalProxySecret === undefined) delete process.env.CLOUDFLARE_AI_PROXY_SECRET;
    else process.env.CLOUDFLARE_AI_PROXY_SECRET = originalProxySecret;
  });
  process.env.CLOUDFLARE_ACCOUNT_ID = "account";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token";
  process.env.CLOUDFLARE_AI_PROXY_URL = "https://court-ai.test";
  process.env.CLOUDFLARE_AI_PROXY_SECRET = "proxy-secret";
  globalThis.fetch = async (url, options) => {
    calls += 1;
    requests.push({ url, options });
    return new Response(JSON.stringify({
      success: true,
      result: { answer: calls === 1 ? "invalid" : JSON.stringify(eligibleAssessment) },
    }), { status: 200 });
  };

  const result = await inspectCourtRequestPhotos([{ imageBase64: "image" }], "full");
  assert.equal(result.status, "complete");
  assert.equal(calls, 2);
  assert.ok(requests.every((request) => request.url === "https://court-ai.test"));
  assert.ok(requests.every((request) => request.options.headers.Authorization === "Bearer proxy-secret"));
});

test("court AI worker accepts only authenticated bounded evidence", async () => {
  const input = {
    task: "query",
    image: "data:image/webp;base64,image",
    question: "Inspect court evidence",
  };
  const unauthorized = await courtAiWorker.fetch(new Request("https://court-ai.test", {
    method: "POST",
    body: JSON.stringify(input),
  }), { CRON_SECRET: "secret", AI: { run: assert.fail } });
  assert.equal(unauthorized.status, 401);

  const calls = [];
  const authorized = await courtAiWorker.fetch(new Request("https://court-ai.test", {
    method: "POST",
    headers: { Authorization: "Bearer secret" },
    body: JSON.stringify(input),
  }), {
    CRON_SECRET: "secret",
    AI: {
      run: async (...args) => {
        calls.push(args);
        return { result: { answer: JSON.stringify(eligibleAssessment) }, usage: {} };
      },
    },
  });
  assert.equal(authorized.status, 200);
  assert.equal((await authorized.json()).result.answer, JSON.stringify(eligibleAssessment));
  assert.equal(calls[0][0], "@cf/moondream/moondream3.1-9B-A2B");
  assert.equal(calls[0][1].image, input.image);
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
