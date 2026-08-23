import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { setApiSecurityHeaders } from "../_requestSecurity.js";

const BODY_MAX_BYTES = 1024 * 1024;
const GRAPH_VERSION_PATTERN = /^v\d+\.\d+$/u;
const INSTAGRAM_RECEIPT_PROCESSING_MESSAGE = "영수증 만드는 중입니다.";

function sendWebhookJson(response, statusCode, payload) {
  setApiSecurityHeaders(response);
  if (statusCode === 401) response.setHeader?.("WWW-Authenticate", "Bearer");
  response.status(statusCode).json(payload);
}

function secretEqual(actual = "", expected = "") {
  if (!actual || !expected) return false;
  const a = createHash("sha256").update(String(actual)).digest();
  const b = createHash("sha256").update(String(expected)).digest();
  return timingSafeEqual(a, b);
}

function requiredText(value, code) {
  const result = String(value ?? "").trim();
  if (!result) throw Object.assign(new Error(code), { statusCode: 503 });
  return result;
}

function requiredInteger(value, code, min, max) {
  const result = Number(value);
  if (!Number.isInteger(result) || result < min || result > max) throw Object.assign(new Error(code), { statusCode: 503 });
  return result;
}

export function getInstagramBotConfig(env = process.env) {
  const graphVersion = requiredText(env.INSTAGRAM_GRAPH_API_VERSION, "instagram_graph_version_not_configured");
  if (!GRAPH_VERSION_PATTERN.test(graphVersion)) throw Object.assign(new Error("instagram_graph_version_invalid"), { statusCode: 503 });
  const publicBaseUrl = requiredText(env.INSTAGRAM_BOT_PUBLIC_BASE_URL, "instagram_public_base_url_not_configured");
  const publicUrl = new URL(publicBaseUrl);
  if (publicUrl.protocol !== "https:") throw Object.assign(new Error("instagram_public_base_url_invalid"), { statusCode: 503 });
  return {
    appSecret: requiredText(env.INSTAGRAM_APP_SECRET, "instagram_app_secret_not_configured"),
    verifyToken: requiredText(env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN, "instagram_verify_token_not_configured"),
    accessToken: requiredText(env.INSTAGRAM_ACCESS_TOKEN, "instagram_access_token_not_configured"),
    accountId: requiredText(env.INSTAGRAM_ACCOUNT_ID, "instagram_account_id_not_configured"),
    hashSecret: requiredText(env.INSTAGRAM_BOT_HASH_SECRET, "instagram_hash_secret_not_configured"),
    graphVersion, publicBaseUrl: publicUrl.origin,
    cooldownSeconds: requiredInteger(env.INSTAGRAM_BOT_COOLDOWN_SECONDS, "instagram_cooldown_not_configured", 1, 86400),
    hourlyLimit: requiredInteger(env.INSTAGRAM_BOT_HOURLY_LIMIT, "instagram_hourly_limit_not_configured", 1, 1000),
    dailyLimit: requiredInteger(env.INSTAGRAM_BOT_DAILY_LIMIT, "instagram_daily_limit_not_configured", 1, 10000),
    globalHourlyLimit: requiredInteger(env.INSTAGRAM_BOT_GLOBAL_HOURLY_LIMIT, "instagram_global_limit_not_configured", 1, 100000),
    contentDedupeSeconds: requiredInteger(env.INSTAGRAM_BOT_CONTENT_DEDUPE_SECONDS, "instagram_content_dedupe_not_configured", 1, 86400),
    renderTtlSeconds: requiredInteger(env.INSTAGRAM_BOT_RENDER_TTL_SECONDS, "instagram_render_ttl_not_configured", 60, 86400),
    linkTtlSeconds: requiredInteger(env.INSTAGRAM_BOT_LINK_TTL_SECONDS, "instagram_link_ttl_not_configured", 60, 3600),
  };
}

async function readRawBody(request) {
  if (Buffer.isBuffer(request.body)) return request.body;
  if (typeof request.body === "string") return Buffer.from(request.body);
  if (request.body && typeof request.body === "object") return Buffer.from(JSON.stringify(request.body));
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > BODY_MAX_BYTES) throw Object.assign(new Error("request_body_too_large"), { statusCode: 413 });
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export function verifyInstagramSignature(rawBody, signature = "", appSecret = "") {
  const match = String(signature).match(/^sha256=([a-f0-9]{64})$/iu);
  if (!match || !appSecret) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const actual = Buffer.from(match[1], "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function keyedHash(value, secret) {
  return createHmac("sha256", secret).update(String(value)).digest("hex");
}

function getCommand(value = "", normalizeMessage) {
  const normalized = normalizeMessage(value);
  return normalized === "연결" || normalized === "기록" ? normalized : "";
}

export function createInstagramReceiptSummary(input, preset) {
  return {
    homeTeam: input.homeTeam,
    awayTeam: input.awayTeam,
    homeScore: input.homeScore,
    awayScore: input.awayScore,
    playedOn: input.playedOn,
    venue: input.venue,
    format: input.format,
    style: input.style,
    preset,
  };
}

function formatHistoryMessage(rows = []) {
  if (!rows.length) return "저장된 영수증 기록이 없습니다.";
  return ["최근 영수증 기록", ...rows.map((row, index) => {
    const summary = row.receipt_summary ?? {};
    return `${index + 1}. ${summary.playedOn ?? "-"} ${summary.homeTeam ?? "-"} ${summary.homeScore ?? "-"}-${summary.awayScore ?? "-"} ${summary.awayTeam ?? "-"}`;
  })].join("\n");
}

async function loadLinkedProfileId(supabase, senderHash) {
  const { data, error } = await supabase.from("instagram_receipt_bot_accounts")
    .select("profile_id").eq("sender_hash", senderHash).maybeSingle();
  if (error) throw error;
  return data?.profile_id ?? null;
}

function getEvents(payload = {}) {
  if (payload.object !== "instagram") return [];
  return (payload.entry ?? []).flatMap((entry) => [
    ...(entry.messaging ?? []),
    ...(entry.changes ?? [])
      .filter((change) => change?.field === "messages")
      .map((change) => change.value),
  ]).filter((event) => (
    event?.message?.mid && typeof event?.message?.text === "string" && event?.sender?.id && !event?.message?.is_echo
  ));
}

export async function sendInstagramMessage(recipientId, message, config, fetchImpl = fetch) {
  const response = await fetchImpl(`https://graph.instagram.com/${config.graphVersion}/${encodeURIComponent(config.accountId)}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id: recipientId }, message }),
  });
  if (!response.ok) throw new Error(`instagram_send_failed_${response.status}`);
}

async function processEvent(event, { config, supabase, sendMessage, receiptMessage }) {
  const eventHash = keyedHash(event.message.mid, config.hashSecret);
  const senderHash = keyedHash(event.sender.id, config.hashSecret);
  const normalizedMessage = receiptMessage.normalizeInstagramMessage(event.message.text);
  const contentHash = keyedHash(normalizedMessage, config.hashSecret);
  const command = getCommand(event.message.text, receiptMessage.normalizeInstagramMessage);
  const profileId = await loadLinkedProfileId(supabase, senderHash);
  const principalHash = profileId ? keyedHash(`profile:${profileId}`, config.hashSecret) : senderHash;
  const { data: decision, error: claimError } = await supabase.rpc("claim_instagram_receipt_bot_request_v2", {
    p_event_hash: eventHash, p_sender_hash: senderHash, p_principal_hash: principalHash,
    p_profile_id: profileId, p_content_hash: contentHash, p_request_kind: command ? "command" : "receipt",
    p_cooldown_seconds: config.cooldownSeconds, p_hour_limit: config.hourlyLimit,
    p_day_limit: config.dailyLimit, p_global_hour_limit: config.globalHourlyLimit,
    p_content_dedupe_seconds: config.contentDedupeSeconds,
  });
  if (claimError) throw claimError;
  if (decision !== "accepted") return;

  let outcome = "failed";
  try {
    if (command === "연결") {
      const code = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + config.linkTtlSeconds * 1000).toISOString();
      const { error: linkError } = await supabase.from("instagram_receipt_bot_link_codes").insert({
        code_hash: keyedHash(code, config.hashSecret), sender_hash: senderHash, expires_at: expiresAt,
      });
      if (linkError) throw linkError;
      const linkUrl = new URL("/instagram/connect", config.publicBaseUrl);
      linkUrl.searchParams.set("code", code);
      await sendMessage(event.sender.id, { text: `BoxTier에 로그인해 계정을 연결하세요.\n${linkUrl.toString()}\n링크는 잠시 후 만료됩니다.` });
      outcome = "link_sent";
      return;
    }
    if (command === "기록") {
      if (!profileId) {
        await sendMessage(event.sender.id, { text: "먼저 '연결'을 보내 BoxTier 계정을 연결하세요." });
        outcome = "link_required";
        return;
      }
      const { data: history, error: historyError } = await supabase.from("instagram_receipt_bot_history")
        .select("receipt_summary, created_at").eq("profile_id", profileId)
        .order("created_at", { ascending: false }).limit(5);
      if (historyError) throw historyError;
      await sendMessage(event.sender.id, { text: formatHistoryMessage(history) });
      outcome = "history_sent";
      return;
    }
    const parsed = receiptMessage.parseInstagramReceiptMessage(event.message.text);
    if (parsed.issues.length) {
      await sendMessage(event.sender.id, { text: `형식이 맞지 않습니다.\n\n${receiptMessage.INSTAGRAM_RECEIPT_USAGE}` });
      outcome = "help";
      return;
    }
    await sendMessage(event.sender.id, { text: INSTAGRAM_RECEIPT_PROCESSING_MESSAGE });
    const publicId = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + config.renderTtlSeconds * 1000).toISOString();
    const { error: insertError } = await supabase.from("instagram_receipt_bot_render_jobs").insert({
      public_id: publicId, receipt_input: parsed.input, preset: parsed.preset, expires_at: expiresAt,
    });
    if (insertError) throw insertError;
    const imageUrl = new URL("/api/instagram/receipt-image", config.publicBaseUrl);
    imageUrl.searchParams.set("id", publicId);
    await sendMessage(event.sender.id, { attachment: { type: "image", payload: { url: imageUrl.toString(), is_reusable: false } } });
    const { error: historyError } = await supabase.from("instagram_receipt_bot_history").insert({
      event_hash: eventHash,
      sender_hash: senderHash,
      profile_id: profileId,
      receipt_summary: createInstagramReceiptSummary(parsed.input, parsed.preset),
    });
    if (historyError) throw historyError;
    outcome = "image_sent";
  } finally {
    await supabase.from("instagram_receipt_bot_requests").update({ outcome, completed_at: new Date().toISOString() }).eq("event_hash", eventHash);
  }
}

export async function handleInstagramWebhook(request, response, options = {}) {
  setApiSecurityHeaders(response);
  const requestId = randomBytes(6).toString("hex");
  console.info("Instagram webhook received.", { requestId, method: request.method });
  try {
    const config = options.config ?? getInstagramBotConfig(options.env);
    if (request.method === "GET") {
      const mode = String(request.query?.["hub.mode"] ?? request.query?.hub_mode ?? "");
      const token = String(request.query?.["hub.verify_token"] ?? request.query?.hub_verify_token ?? "");
      const challenge = String(request.query?.["hub.challenge"] ?? request.query?.hub_challenge ?? "");
      const tokenMatched = secretEqual(token, config.verifyToken);
      const verified = mode === "subscribe" && Boolean(challenge) && tokenMatched;
      console.info("Instagram webhook verification.", { verified, modeIsSubscribe: mode === "subscribe", hasChallenge: Boolean(challenge), tokenMatched });
      if (!verified) return sendWebhookJson(response, 403, { error: "instagram_webhook_verification_failed" });
      response.statusCode = 200;
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      return response.end(challenge);
    }
    const rawBody = await readRawBody(request);
    const verifySignature = options.verifySignature ?? verifyInstagramSignature;
    const signatureVerified = verifySignature(rawBody, request.headers?.["x-hub-signature-256"] ?? request.headers?.["X-Hub-Signature-256"], config.appSecret);
    console.info("Instagram webhook signature checked.", { requestId, bodyBytes: rawBody.length, signatureVerified });
    if (!signatureVerified) {
      return sendWebhookJson(response, 401, { error: "invalid_instagram_signature" });
    }
    let payload;
    try { payload = JSON.parse(rawBody.toString("utf8")); } catch { return sendWebhookJson(response, 400, { error: "invalid_json_body" }); }
    const [receiptMessage, supabaseModule] = await Promise.all([
      import("./_receiptMessage.js"),
      options.supabase ? null : import("../_supabaseAdmin.js"),
    ]);
    const supabase = options.supabase ?? supabaseModule.getSupabaseAdminClient();
    const sendMessage = options.sendMessage ?? ((recipientId, message) => sendInstagramMessage(recipientId, message, config, options.fetchImpl));
    const events = getEvents(payload);
    console.info("Instagram webhook events normalized.", {
      requestId,
      object: payload.object,
      entryCount: Array.isArray(payload.entry) ? payload.entry.length : 0,
      eventCount: events.length,
    });
    for (const event of events) await processEvent(event, { config, supabase, sendMessage, receiptMessage });
    await supabase.rpc("cleanup_instagram_receipt_bot_data");
    console.info("Instagram webhook completed.", { requestId, eventCount: events.length });
    return sendWebhookJson(response, 200, { received: true });
  } catch (error) {
    console.warn("Instagram receipt webhook failed.", { requestId, error: error.message });
    return sendWebhookJson(response, error.statusCode || 500, { error: error.statusCode ? error.message : "instagram_webhook_failed" });
  }
}

export default function handler(request, response) {
  return handleInstagramWebhook(request, response, { verifySignature: verifyInstagramSignature });
}
