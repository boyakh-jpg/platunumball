import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { getCoordinateDistanceMeters, getCourtPhotoLocationEvidence, getCourtPhotoPixelQualityError } from "../shared/lib/courtRequestImagePolicy.js";
import { normalizeWebpUpload, uploadPrivateR2Webp, validateSafeWebpContainer } from "../server/api/_r2ImageStorage.js";
import {
  getCourtAiQuotaState,
  getCourtAiUsage,
  getCourtRequestLimitState,
  getCourtVerificationDecision,
  inspectCourtRequestPhotos,
  normalizeCourtPhotoAiAnswer,
} from "../server/lib/courtRequestVerification.js";
import courtAiWorker from "../cloudflare/court-ai/worker.js";
import { encodeCourtPhotoCanvas } from "../src/lib/courtRequestImages.js";
import { getCourtRequestQuotaUi } from "../src/pages/settingsPageModel.js";

const eligibleAssessment = {
  court: true,
  hoop: true,
  lines: true,
  venue: false,
  synthetic: false,
};
const venueAssessment = {
  court: false,
  hoop: false,
  lines: false,
  venue: true,
  synthetic: false,
};

const eligibleEvidence = {
  assessments: [eligibleAssessment, venueAssessment],
  photoCount: 2,
  fieldAccuracyMeters: 12,
  fieldDistanceMeters: 18,
  fieldCapturedAt: new Date().toISOString(),
  trustScore: 90,
  nearbyDuplicateCount: 0,
  type: "야외",
  publicAccess: "public",
  photoLocation: { status: "matched", confidence: 1 },
};

test("court photos fall back to JPEG and are sanitized back to WebP", async () => {
  const requestedTypes = [];
  const canvas = {
    toBlob(callback, type) {
      requestedTypes.push(type);
      callback(new Blob([type], { type: type === "image/webp" ? "image/png" : type }));
    },
  };
  assert.equal((await encodeCourtPhotoCanvas(canvas, 0.82)).type, "image/jpeg");
  assert.deepEqual(requestedTypes, ["image/webp", "image/jpeg"]);

  const jpeg = await sharp({ create: { width: 640, height: 480, channels: 3, background: "#f15a3a" } }).jpeg().toBuffer();
  const normalized = await normalizeWebpUpload(jpeg, { maxBytes: 300_000, maxDimension: 1280, errorPrefix: "court_photo" });
  assert.deepEqual(normalized.dimensions, { width: 640, height: 480 });
  assert.deepEqual(validateSafeWebpContainer(normalized.bytes).map(({ type }) => type), ["VP8 "]);
  await assert.rejects(
    normalizeWebpUpload(Buffer.concat([jpeg, Buffer.from("<script>")]), { maxBytes: 300_000, maxDimension: 1280, errorPrefix: "court_photo" }),
    /court_photo_webp_required/,
  );
});

test("court AI policy uses server evidence checks instead of model self-confidence", () => {
  const decision = getCourtVerificationDecision({
    ...eligibleEvidence,
    assessments: eligibleEvidence.assessments.map((assessment) => ({ ...assessment, confidence: 0 })),
  });
  assert.equal(decision.decision, "auto_approve");
  assert.equal(decision.confidence, 1);
  assert.equal(getCourtVerificationDecision({ ...eligibleEvidence, fieldAccuracyMeters: null, fieldDistanceMeters: null, fieldCapturedAt: null }).locationSource, "photo_gps");
  assert.equal(getCourtVerificationDecision({ ...eligibleEvidence, photoLocation: { status: "unavailable", confidence: 0.75 } }).locationSource, "live_gps");
  assert.equal(getCourtVerificationDecision({ ...eligibleEvidence, fieldDistanceMeters: 149, photoLocation: { status: "uncertain", confidence: 0.6 } }).decision, "auto_approve");
  assert.equal(getCourtVerificationDecision({ ...eligibleEvidence, fieldDistanceMeters: 151, photoLocation: { status: "uncertain", confidence: 0.6 } }).decision, "manual_review");
  assert.equal(getCourtVerificationDecision({ ...eligibleEvidence, photoLocation: { status: "mismatch", confidence: 0.25 } }).decision, "manual_review");
  assert.equal(getCourtVerificationDecision({ ...eligibleEvidence, fieldAccuracyMeters: null, fieldDistanceMeters: null, fieldCapturedAt: null, photoLocation: { status: "unavailable", confidence: 0.75 } }).decision, "manual_review");
  assert.equal(getCourtVerificationDecision({ ...eligibleEvidence, type: "실내" }).decision, "auto_approve");
  assert.equal(getCourtVerificationDecision({ ...eligibleEvidence, publicAccess: "private" }).decision, "manual_review");
  assert.equal(getCourtVerificationDecision({ ...eligibleEvidence, assessments: [venueAssessment, venueAssessment] }).decision, "manual_review");
});

test("court AI response and coordinate distance are normalized", () => {
  assert.deepEqual(normalizeCourtPhotoAiAnswer(`result: ${JSON.stringify(eligibleAssessment)}`), eligibleAssessment);
  assert.deepEqual(normalizeCourtPhotoAiAnswer({
    court: "yes",
    hoop: "yes",
    lines: "yes",
    venue: "no",
    synthetic: "no",
    confidence: 0,
  }), eligibleAssessment);
  assert.throws(() => normalizeCourtPhotoAiAnswer({ court: true }), /court_ai_invalid_response/);
  assert.ok(getCoordinateDistanceMeters(37.5, 127, 37.5001, 127) > 10);
  assert.equal(getCoordinateDistanceMeters(37.5, 127, null, 127), null);
});

test("court photo EXIF location is a request evidence signal", () => {
  const locations = { fieldLat: 37.5, fieldLng: 127, pinLat: 37.50005, pinLng: 127 };
  const matched = getCourtPhotoLocationEvidence([
    { latitude: 37.5001, longitude: 127, capturedAt: "2026-08-04T04:00:00.000Z" },
    { latitude: 37.5002, longitude: 127 },
  ], locations);
  const uncertain = getCourtPhotoLocationEvidence([
    { latitude: 37.501, longitude: 127 },
    { latitude: 37.5011, longitude: 127 },
  ], locations);
  const mismatch = getCourtPhotoLocationEvidence([
    { latitude: 37.503, longitude: 127 },
    { latitude: 37.5031, longitude: 127 },
  ], locations);
  const unavailable = getCourtPhotoLocationEvidence([
    { latitude: null, longitude: null },
    {},
  ], { ...locations, fieldLat: null, fieldLng: null });
  assert.equal(matched.status, "matched");
  assert.equal(matched.confidence, 1);
  assert.equal(uncertain.status, "uncertain");
  assert.equal(mismatch.status, "mismatch");
  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.gpsPhotoCount, 0);
  assert.equal(getCourtVerificationDecision({ ...eligibleEvidence, photoLocation: mismatch }).decision, "manual_review");
  assert.equal(getCourtVerificationDecision({ ...eligibleEvidence, photoLocation: {} }).decision, "auto_approve");
});

test("court AI token metrics map to neurons and block at 80 percent", () => {
  const usage = getCourtAiUsage({ input_tokens: 817, output_tokens: 59 });
  const compatibleUsage = getCourtAiUsage({ prompt_tokens: 817, completion_tokens: 59 });
  assert.equal(usage.calls, 1);
  assert.ok(Math.abs(usage.neurons - 7.231057) < 0.000001);
  assert.equal(compatibleUsage.neurons, usage.neurons);
  assert.equal(getCourtAiQuotaState(7_999).blocked, false);
  assert.equal(getCourtAiQuotaState(8_000).blocked, true);
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
  const [sql, serviceRoleSql, usageSql, limitSql, locationSql, nearbyCaptureSql, photoPairSql] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260803222000_court_request_ai_verification.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260804091749_court_request_evidence_service_role.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260804120000_court_ai_daily_usage.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260804121640_court_request_submission_limits.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260804160000_classify_court_request_location_evidence.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260804191704_allow_nearby_court_capture.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260804221405_court_ai_photo_pair_policy.sql", import.meta.url), "utf8"),
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
  assert.match(locationSql, /alter column field_lat drop not null/i);
  assert.match(locationSql, /photo_location_status <> 'matched'/i);
  assert.doesNotMatch(locationSql, /grant .* to (anon|authenticated)|drop table|truncate|delete from/i);
  assert.match(nearbyCaptureSql, /field_distance_meters <= 150/i);
  assert.match(nearbyCaptureSql, /photo_location_status = 'mismatch'/i);
  assert.doesNotMatch(nearbyCaptureSql, /photo_location_status in \('uncertain', 'mismatch'\)/i);
  assert.doesNotMatch(nearbyCaptureSql, /grant .* to (anon|authenticated)|drop table|truncate|delete from/i);
  assert.match(photoPairSql, /jsonb_array_length\(photo_keys\) between 1 and 2/i);
  assert.match(photoPairSql, /payload->>'type'[^\n]+\('실내', '야외'\)/i);
  assert.match(photoPairSql, /courtEvidence/);
  assert.match(photoPairSql, /evidenceCoverage/);
  assert.doesNotMatch(photoPairSql, /courtVisible|hoopVisible|overviewVisible|layoutMatches/);
  assert.doesNotMatch(photoPairSql, /drop table|truncate|delete from/i);
});

test("court photos use browser resizing and private R2", async () => {
  const [client, server, storage, evidence, form, controller, styles, map] = await Promise.all([
    readFile(new URL("../src/lib/courtRequestImages.js", import.meta.url), "utf8"),
    readFile(new URL("../server/api/court-requests/submit.js", import.meta.url), "utf8"),
    readFile(new URL("../server/api/_r2ImageStorage.js", import.meta.url), "utf8"),
    readFile(new URL("../server/api/court-requests/evidence.js", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/SettingsSideColumn.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/useSettingsCourtRequestController.js", import.meta.url), "utf8"),
    readFile(new URL("../src/styles/features/court-request-evidence.css", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/naverAddress.js", import.meta.url), "utf8"),
  ]);
  assert.match(client, /encodeCourtPhotoCanvas/);
  assert.match(client, /exifr\/dist\/lite\.esm\.mjs/);
  assert.match(client, /DateTimeOriginal/);
  assert.match(client, /getCourtPhotoPixelQualityError/);
  assert.match(client, /image\.onload = resolve/);
  assert.doesNotMatch(client, /await image\.decode\(\)/);
  assert.match(client, /canvasToBlob\(canvas, "image\/webp"/);
  assert.match(client, /canvasToBlob\(canvas, "image\/jpeg"/);
  assert.match(client, /blob\.size <= COURT_REQUEST_PHOTO_MAX_BYTES/);
  assert.ok(client.indexOf("if (fallback)") < client.indexOf('throw imageError("court_photo_too_large_after_resize")'));
  assert.doesNotMatch(client, /file\.size\s*[><=]/);
  assert.match(server, /getPrivateR2Config/);
  assert.match(server, /normalizeWebpUpload/);
  assert.match(server, /\.resize\(\{ width: 448, height: 448/);
  assert.match(storage, /safeContainer:\s*true/);
  assert.match(server, /getCourtPhotoLocationEvidence/);
  assert.match(server, /photoMetadata/);
  assert.ok(server.lastIndexOf("COURT_REQUEST_PHOTO_MIN_BYTES") < server.lastIndexOf("inspectCourtRequestPhotos("));
  assert.match(server, /rankball_auto_approve_court_request/);
  const policyInputIndex = server.indexOf("const policyInput");
  assert.ok(policyInputIndex > -1 && policyInputIndex < server.indexOf("inspectCourtRequestPhotos(", policyInputIndex));
  assert.match(server, /automaticReviewCandidate/);
  assert.match(evidence, /requireAdminContext/);
  assert.match(evidence, /\^cr_sim_/);
  const fileInputs = form.match(/<input type="file"[\s\S]*?\/>/g) ?? [];
  assert.equal(fileInputs.length, 2);
  assert.ok(fileInputs.every((input) => input.includes('accept="image/*"')));
  assert.ok(fileInputs.every((input) => !input.includes("courtPhotoPending")));
  assert.ok(fileInputs.every((input) => input.includes("onInput=")));
  assert.ok(fileInputs.every((input) => input.includes("onChange=")));
  assert.match(form, /capture=\{onsiteCourtEntry \? "environment" : undefined\}/);
  assert.match(form, /disabled=\{!courtPinConfirmed\}/);
  assert.match(form, /settings-court-photo-add/);
  assert.match(form, /courtPhotos\.length < COURT_REQUEST_PHOTO_MAX/);
  assert.match(form, /selectCourtPhotos\(event, index\)/);
  assert.match(form, /현재 위치로 구장 지정/);
  assert.match(form, /현재 위치 사용/);
  assert.match(form, /주소로 찾기/);
  assert.match(form, /지도에서 핀 미세 조정/);
  assert.doesNotMatch(form, /settings-court-location-edit/);
  assert.match(form, /다른 조건도 충족하면 AI 자동승인 후보/);
  assert.match(form, /setCourtAddressQuery\(event\.target\.value, true\)/);
  assert.match(controller, /reverseGeocodeNaverCoordinate/);
  assert.match(controller, /onsiteCourtEntry && courtPinConfirmed && courtFieldLocation/);
  assert.match(controller, /distanceMeters: getCoordinateDistanceMeters\(pinLat, pinLng, current\.lat, current\.lng\)/);
  assert.match(map, /zoom: 18/);
  assert.match(server, /rankball_submit_court_request"/);
  assert.match(server, /if \(!photoInputs\.length\)/);
  const photoHandler = controller.slice(controller.indexOf("const selectCourtPhotos"), controller.indexOf("const removeCourtPhoto"));
  assert.match(photoHandler, /Array\.from\(input\.files \?\? \[\]\)/);
  assert.match(photoHandler, /courtPhotoSelectionRef\.current === selectionKey/);
  assert.ok(photoHandler.indexOf("URL.createObjectURL(file)") < photoHandler.indexOf("prepareCourtRequestPhotos"));
  assert.match(photoHandler, /pending:\s*true/);
  assert.match(photoHandler, /error:\s*message/);
  assert.ok(photoHandler.indexOf("prepareCourtRequestPhotos") < photoHandler.indexOf('input.value = ""'));
  assert.match(photoHandler, /replaceIndex === null/);
  assert.doesNotMatch(photoHandler, /readCourtFieldLocation/);
  assert.match(controller, /const courtReadyPhotos = courtPhotos\.filter/);
  assert.match(controller, /!courtPhotoHasError/);
  assert.match(controller, /courtReadyPhotos\.map/);
  const evidenceStepIndex = form.indexOf('aria-labelledby="court-step-photo-title"');
  assert.ok(evidenceStepIndex > -1 && evidenceStepIndex < form.indexOf('<div className="form-grid two">', evidenceStepIndex));
  assert.match(form, /const courtPhotoStepComplete = courtPinConfirmed && !courtPhotoPending && !courtPhotoError/);
  assert.match(form, /id="court-step-details-title">구장 정보/);
  assert.match(form, /settings-court-photo-state/);
  assert.doesNotMatch(form, /className="settings-court-photo-remove" disabled=/);
  assert.match(styles, /settings-court-step/);
  assert.match(styles, /inset:\s*0;[\s\S]{0,80}width:\s*100%;[\s\S]{0,80}height:\s*100%/);
  assert.match(styles, /settings-court-photo-add\[aria-disabled="true"\][\s\S]{0,180}pointer-events:\s*none/);
  assert.match(styles, /\.settings-court-photo-state/);
  assert.match(styles, /settings-court-photo-remove[\s\S]{0,120}width:\s*40px;[\s\S]{0,40}height:\s*40px/);
  assert.match(styles, /@media \(max-width:\s*560px\)[\s\S]*settings-court-photo-remove \{ width:\s*44px; height:\s*44px;/);
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
        response: calls === 1 ? "invalid" : eligibleAssessment,
        metrics: calls === 1 ? { input_tokens: 10, output_tokens: 5 } : { input_tokens: 817, output_tokens: 59 },
      },
    }), { status: 200 });
  };

  const result = await inspectCourtRequestPhotos([{ imageBase64: "image" }]);
  assert.equal(result.status, "complete");
  assert.equal(calls, 2);
  assert.equal(result.usage.calls, 2);
  assert.equal(result.usage.inputTokens, 827);
  assert.ok(requests.every((request) => request.url === "https://court-ai.test"));
  assert.ok(requests.every((request) => request.options.headers.Authorization === "Bearer proxy-secret"));
  assert.match(JSON.parse(requests[0].options.body).prompt, /Output exactly one JSON object/);
});

test("court AI spends no quota when deterministic approval checks already fail", async () => {
  const result = await inspectCourtRequestPhotos([
    { imageBase64: "image-a" },
    { imageBase64: "image-b" },
  ], false);
  assert.equal(result.status, "unavailable");
  assert.equal(result.failureReason, "court_ai_not_required");
  assert.deepEqual(result.usage, { calls: 0, inputTokens: 0, outputTokens: 0, neurons: 0, estimated: false });
});

test("court AI worker accepts only authenticated bounded evidence", async () => {
  const input = {
    image: "data:image/webp;base64,image",
    prompt: "Inspect court evidence",
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
          result: { response: JSON.stringify(eligibleAssessment) },
          usage: { prompt_tokens: 817, completion_tokens: 59 },
        };
      },
    },
  });
  assert.equal(authorized.status, 200);
  const authorizedPayload = await authorized.json();
  assert.equal(authorizedPayload.result.response, JSON.stringify(eligibleAssessment));
  assert.equal(authorizedPayload.usage.prompt_tokens, 817);
  assert.equal(calls[0][0], "@cf/meta/llama-3.2-11b-vision-instruct");
  assert.equal(calls[0][1].image, input.image);
  assert.equal(calls[0][1].prompt, input.prompt);
  assert.equal(calls[0][1].max_tokens, 48);
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
