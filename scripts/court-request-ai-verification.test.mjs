import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getCoordinateDistanceMeters, getCourtPhotoPixelQualityError } from "../shared/lib/courtRequestImagePolicy.js";
import { uploadPrivateR2Webp } from "../server/api/_r2ImageStorage.js";
import {
  getCourtAiQuotaState,
  getCourtAiUsage,
  getCourtRequestLimitState,
  getCourtVerificationDecision,
  inspectCourtRequestPhotos,
  normalizeCourtPhotoAiAnswer,
} from "../server/lib/courtRequestVerification.js";
import courtAiWorker from "../cloudflare/court-ai/worker.js";
import { getCourtRequestQuotaUi } from "../src/pages/settingsPageModel.js";

const eligibleAssessment = {
  basketballCourt: true,
  hoopVisible: true,
  overviewVisible: true,
  screenshotOrSynthetic: false,
  courtLayout: "full",
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

test("court AI policy uses server evidence checks instead of model self-confidence", () => {
  const decision = getCourtVerificationDecision({
    ...eligibleEvidence,
    assessments: eligibleEvidence.assessments.map((assessment) => ({ ...assessment, confidence: 0 })),
  });
  assert.equal(decision.decision, "auto_approve");
  assert.equal(decision.confidence, 1);
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
    confidence: 0,
  }), eligibleAssessment);
  assert.throws(() => normalizeCourtPhotoAiAnswer({ basketballCourt: true }), /court_ai_invalid_response/);
  assert.ok(getCoordinateDistanceMeters(37.5, 127, 37.5001, 127) > 10);
  assert.equal(getCoordinateDistanceMeters(37.5, 127, null, 127), null);
});

test("court AI token metrics map to neurons and block at 70 percent", () => {
  const usage = getCourtAiUsage({ input_tokens: 817, output_tokens: 59 });
  const compatibleUsage = getCourtAiUsage({ prompt_tokens: 817, completion_tokens: 59 });
  assert.equal(usage.calls, 1);
  assert.ok(Math.abs(usage.neurons - 27.646) < 0.01);
  assert.equal(compatibleUsage.neurons, usage.neurons);
  assert.equal(getCourtAiQuotaState(6_999).blocked, false);
  assert.equal(getCourtAiQuotaState(7_000).blocked, true);
});

test("court request limit state is normalized for the server", async () => {
  const supabase = {
    rpc: async (name, payload) => {
      assert.equal(name, "rankball_get_court_request_limit_state");
      assert.deepEqual(payload, { actor_profile_id: "u1" });
      return { data: { dailyCount: 3, dailyLimit: 3, abuseBlocked: false }, error: null };
    },
  };
  assert.deepEqual(await getCourtRequestLimitState(supabase, "u1"), {
    dailyCount: 3,
    dailyLimit: 3,
    abuseBlocked: false,
    remaining: 0,
    dailyBlocked: true,
    blocked: true,
  });
  assert.match(getCourtRequestQuotaUi({ dailyBlocked: true, dailyLimit: 3 }, null, 90).message, /하루 3건/);
  assert.match(getCourtRequestQuotaUi({ abuseBlocked: true }, null, 90).message, /운영자 확인/);
});

test("court photo quality rejects unusable pixels before AI", () => {
  const pixels = (valueAt) => {
    const output = new Uint8ClampedArray(16 * 16 * 4);
    for (let index = 0; index < 16 * 16; index += 1) {
      const value = valueAt(index % 16, Math.floor(index / 16));
      output.set([value, value, value, 255], index * 4);
    }
    return output;
  };
  assert.equal(getCourtPhotoPixelQualityError(pixels((x, y) => (x + y) % 2 ? 210 : 40), 16, 16), null);
  assert.equal(getCourtPhotoPixelQualityError(pixels(() => 5), 16, 16), "court_photo_too_dark");
  assert.equal(getCourtPhotoPixelQualityError(pixels(() => 250), 16, 16), "court_photo_too_bright");
  assert.equal(getCourtPhotoPixelQualityError(pixels(() => 128), 16, 16), "court_photo_too_blurry");
});

test("court evidence and AI usage migrations keep data private", async () => {
  const [sql, serviceRoleSql, usageSql, limitSql] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260803222000_court_request_ai_verification.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260804091749_court_request_evidence_service_role.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260804120000_court_ai_daily_usage.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260804121640_court_request_submission_limits.sql", import.meta.url), "utf8"),
  ]);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on table public\.court_request_evidence from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.rankball_auto_approve_court_request\(text\) to service_role/i);
  assert.doesNotMatch(sql, /drop table|truncate|delete from/i);
  assert.match(serviceRoleSql, /grant select, update on table public\.court_request_evidence to service_role/i);
  assert.doesNotMatch(serviceRoleSql, /grant .* to (anon|authenticated)|drop table|truncate|delete from/i);
  assert.match(usageSql, /revoke all on table public\.court_ai_usage_events from public, anon, authenticated/i);
  assert.match(usageSql, /grant select, insert on table public\.court_ai_usage_events to service_role/i);
  assert.doesNotMatch(usageSql, /grant .* to (anon|authenticated)|drop table|truncate|delete from/i);
  assert.match(limitSql, /court_request_submission_events[\s\S]*enable row level security/i);
  assert.match(limitSql, /revoke all on table public\.court_request_submission_events from public, anon, authenticated/i);
  assert.match(limitSql, /pg_advisory_xact_lock/);
  assert.match(limitSql, /when offense_number = 1 then interval '3 days'[\s\S]*when offense_number = 2 then interval '7 days'[\s\S]*interval '30 days'/);
  assert.match(limitSql, /before insert on public\.court_requests/);
  assert.doesNotMatch(limitSql, /grant .* to (anon|authenticated)|drop table|truncate|delete from/i);
});

test("court photos use browser resizing and private R2", async () => {
  const [client, server, evidence, form, controller, styles] = await Promise.all([
    readFile(new URL("../src/lib/courtRequestImages.js", import.meta.url), "utf8"),
    readFile(new URL("../server/api/court-requests/submit.js", import.meta.url), "utf8"),
    readFile(new URL("../server/api/court-requests/evidence.js", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/SettingsSideColumn.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/useSettingsCourtRequestController.js", import.meta.url), "utf8"),
    readFile(new URL("../src/styles/features/court-request-evidence.css", import.meta.url), "utf8"),
  ]);
  assert.match(client, /canvasToWebp/);
  assert.match(client, /getCourtPhotoPixelQualityError/);
  assert.doesNotMatch(client, /file\.size\s*[><=]/);
  assert.match(server, /getPrivateR2Config/);
  assert.match(server, /safeContainer:\s*true/);
  assert.ok(server.lastIndexOf("COURT_REQUEST_PHOTO_MIN_BYTES") < server.lastIndexOf("inspectCourtRequestPhotos("));
  assert.match(server, /rankball_auto_approve_court_request/);
  assert.match(evidence, /requireAdminContext/);
  assert.match(evidence, /\^cr_sim_/);
  assert.match(form, /capture="environment"/);
  assert.match(form, /disabled=\{!courtPinConfirmed \|\| courtFieldLocationPending \|\| courtPhotoPending/);
  assert.doesNotMatch(form, /disabled=\{!courtFieldLocation \|\| courtPhotoPending/);
  assert.match(controller, /await readCourtFieldLocation\(\)/);
  assert.ok(form.indexOf("settings-court-evidence") < form.indexOf("시설\/장소명"));
  assert.match(styles, /inset:\s*0;[\s\S]{0,80}width:\s*100%;[\s\S]{0,80}height:\s*100%/);
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
      result: {
        answer: calls === 1 ? "invalid" : JSON.stringify(eligibleAssessment),
        metrics: calls === 1 ? { input_tokens: 10, output_tokens: 5 } : { input_tokens: 817, output_tokens: 59 },
      },
    }), { status: 200 });
  };

  const result = await inspectCourtRequestPhotos([{ imageBase64: "image" }], "full");
  assert.equal(result.status, "complete");
  assert.equal(calls, 2);
  assert.equal(result.usage.calls, 2);
  assert.equal(result.usage.inputTokens, 827);
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
        return {
          result: { answer: JSON.stringify(eligibleAssessment) },
          usage: { prompt_tokens: 817, completion_tokens: 59 },
        };
      },
    },
  });
  assert.equal(authorized.status, 200);
  const authorizedPayload = await authorized.json();
  assert.equal(authorizedPayload.result.answer, JSON.stringify(eligibleAssessment));
  assert.equal(authorizedPayload.usage.prompt_tokens, 817);
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
