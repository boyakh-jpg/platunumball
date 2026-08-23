import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { config as webhookFunctionConfig } from "../api/instagram-webhook.js";
import { parseInstagramReceiptMessage } from "../server/api/instagram/_receiptMessage.js";
import { handleInstagramReceiptImage } from "../server/api/instagram/receipt-image.js";
import { handleInstagramWebhook, verifyInstagramSignature } from "../server/api/instagram/webhook.js";

const config = Object.freeze({
  appSecret: "app-secret", verifyToken: "verify-token", accessToken: "access-token",
  accountId: "account-id", hashSecret: "hash-secret", graphVersion: "v24.0",
  publicBaseUrl: "https://example.com", cooldownSeconds: 10, hourlyLimit: 5,
  dailyLimit: 20, globalHourlyLimit: 100, contentDedupeSeconds: 60, renderTtlSeconds: 300,
});

test("Instagram webhook Vercel function preserves the raw request body", () => {
  assert.equal(webhookFunctionConfig.api.bodyParser, false);
});

function createResponse() {
  return {
    headers: {}, statusCode: 200, payload: null, body: null,
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    status(statusCode) { this.statusCode = statusCode; return this; },
    json(payload) { this.payload = payload; return this; },
    end(body) { this.body = body; return this; },
  };
}

function createSupabase(decision = "accepted") {
  const state = { inserted: [], updated: [], rpc: [] };
  return {
    state,
    async rpc(name, args) { state.rpc.push({ name, args }); return { data: name.startsWith("claim_") ? decision : null, error: null }; },
    from(table) {
      return {
        async insert(value) { state.inserted.push({ table, value }); return { error: null }; },
        update(value) {
          return { async eq(field, expected) { state.updated.push({ table, value, field, expected }); return { error: null }; } };
        },
      };
    },
  };
}

const validMessage = [
  "영수증", "홈팀: 서울 A", "원정팀: 부산 B", "점수: 81-79", "날짜: 2026-08-23",
  "장소: BOXTIER COURT", "방식: 5v5", "스타일: 감열", "비율: 스토리",
].join("\n");

test("Instagram DM 형식을 canonical 영수증 입력으로 변환한다", () => {
  const parsed = parseInstagramReceiptMessage(validMessage);
  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.input.style, "classic-thermal");
  assert.equal(parsed.input.homeScore, 81);
  assert.equal(parsed.input.awayScore, 79);
  assert.equal(parsed.preset, "story");
  assert.ok(parseInstagramReceiptMessage("홈팀: A").issues.length > 0);
  assert.ok(parseInstagramReceiptMessage(`${validMessage}\n홈팀: 중복`).issues.length > 0);
});

test("Instagram Webhook 서명과 검증 토큰을 확인한다", async () => {
  const raw = Buffer.from('{"object":"instagram"}');
  const signature = `sha256=${createHmac("sha256", config.appSecret).update(raw).digest("hex")}`;
  assert.equal(verifyInstagramSignature(raw, signature, config.appSecret), true);
  assert.equal(verifyInstagramSignature(raw, signature.replace(/.$/u, "0"), config.appSecret), false);

  const response = createResponse();
  await handleInstagramWebhook({ method: "GET", query: { "hub.mode": "subscribe", "hub.verify_token": "verify-token", "hub.challenge": "12345" } }, response, { config });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body, "12345");
});

test("수락 이벤트만 임시 렌더 job과 이미지 답장을 만든다", async () => {
  const payload = { object: "instagram", entry: [{ messaging: [{ sender: { id: "sender-1" }, message: { mid: "event-1", text: validMessage } }] }] };
  const raw = Buffer.from(JSON.stringify(payload));
  const signature = `sha256=${createHmac("sha256", config.appSecret).update(raw).digest("hex")}`;
  const supabase = createSupabase();
  const sent = [];
  const response = createResponse();
  await handleInstagramWebhook({ method: "POST", headers: { "x-hub-signature-256": signature }, body: raw }, response, {
    config, supabase, sendMessage: async (recipientId, message) => sent.push({ recipientId, message }),
  });
  assert.equal(response.statusCode, 200);
  assert.equal(supabase.state.inserted.length, 1);
  assert.equal(supabase.state.inserted[0].table, "instagram_receipt_bot_render_jobs");
  assert.equal(sent.length, 1);
  assert.match(sent[0].message.attachment.payload.url, /^https:\/\/example\.com\/api\/instagram\/receipt-image\?id=/u);
  assert.equal(supabase.state.updated[0].value.outcome, "image_sent");
  assert.equal(supabase.state.rpc.at(-1).name, "cleanup_instagram_receipt_bot_data");
});

test("중복 이벤트는 답장과 렌더를 생략한다", async () => {
  const payload = { object: "instagram", entry: [{ messaging: [{ sender: { id: "sender-1" }, message: { mid: "event-1", text: validMessage } }] }] };
  const raw = Buffer.from(JSON.stringify(payload));
  const signature = `sha256=${createHmac("sha256", config.appSecret).update(raw).digest("hex")}`;
  const supabase = createSupabase("duplicate_event");
  const sent = [];
  await handleInstagramWebhook({ method: "POST", headers: { "x-hub-signature-256": signature }, body: raw }, createResponse(), {
    config, supabase, sendMessage: async (...args) => sent.push(args),
  });
  assert.equal(sent.length, 0);
  assert.equal(supabase.state.inserted.length, 0);
});

test("만료되지 않은 임시 입력을 PNG로 렌더하고 이미지 바이트는 저장하지 않는다", async () => {
  const parsed = parseInstagramReceiptMessage(validMessage);
  const png = Buffer.from("png");
  const supabase = {
    from() {
      return { select() { return this; }, eq() { return this; }, async maybeSingle() {
        return { data: { receipt_input: parsed.input, preset: parsed.preset, expires_at: new Date(Date.now() + 60_000).toISOString() }, error: null };
      } };
    },
  };
  const response = createResponse();
  await handleInstagramReceiptImage({ query: { id: "a".repeat(43) } }, response, { supabase, render: async () => png });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body, png);
  assert.equal(response.headers["content-type"], "image/png");
});

test("migration은 해시 dedupe, 원자 잠금, RLS, TTL 정리를 정의한다", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260823100000_instagram_receipt_bot.sql", import.meta.url), "utf8");
  assert.match(sql, /event_hash text primary key/u);
  assert.match(sql, /pg_advisory_xact_lock/u);
  assert.match(sql, /hashtextextended\('instagram_receipt_bot_global', 2\)/u);
  assert.match(sql, /enable row level security/u);
  assert.match(sql, /revoke all[\s\S]*from public, anon, authenticated/u);
  assert.match(sql, /expires_at <= now\(\)/u);
  assert.match(sql, /created_at < now\(\) - interval '7 days'/u);
});
