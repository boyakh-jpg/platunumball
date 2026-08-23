import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { config as webhookFunctionConfig } from "../api/instagram-webhook.js";
import { parseInstagramReceiptMessage } from "../server/api/instagram/_receiptMessage.js";
import { handleInstagramAccount } from "../server/api/instagram/account.js";
import { handleInstagramReceiptImage } from "../server/api/instagram/receipt-image.js";
import { handleInstagramWebhook, verifyInstagramSignature } from "../server/api/instagram/webhook.js";

const config = Object.freeze({
  appSecret: "app-secret", verifyToken: "verify-token", accessToken: "access-token",
  accountId: "account-id", hashSecret: "hash-secret", graphVersion: "v24.0",
  publicBaseUrl: "https://example.com", cooldownSeconds: 10, hourlyLimit: 5,
  dailyLimit: 10, globalHourlyLimit: 100, contentDedupeSeconds: 60, renderTtlSeconds: 300,
  linkTtlSeconds: 600,
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

async function runWebhook(request, response, options = {}) {
  const tasks = [];
  await handleInstagramWebhook(request, response, {
    ...options,
    waitUntil(task) { tasks.push(task); },
  });
  await Promise.all(tasks);
}

function createSupabase(decision = "accepted", options = {}) {
  const state = { inserted: [], updated: [], rpc: [] };
  return {
    state,
    async rpc(name, args) {
      state.rpc.push({ name, args });
      return { data: name.startsWith("claim_") ? decision : name === "consume_instagram_receipt_bot_link_v2" ? true : null, error: null };
    },
    from(table) {
      return {
        select() { return this; },
        eq() { return this; },
        order() { return this; },
        async limit() { return { data: options.history ?? [], error: null }; },
        async maybeSingle() {
          return { data: options.profileId ? { profile_id: options.profileId } : null, error: null };
        },
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
  await runWebhook({ method: "POST", headers: { "x-hub-signature-256": signature }, body: raw }, response, {
    config, supabase, sendMessage: async (recipientId, message) => sent.push({ recipientId, message }),
  });
  assert.equal(response.statusCode, 200);
  assert.equal(supabase.state.inserted.length, 2);
  assert.equal(supabase.state.inserted[0].table, "instagram_receipt_bot_render_jobs");
  assert.equal(supabase.state.inserted[1].table, "instagram_receipt_bot_history");
  assert.equal(sent.length, 2);
  assert.equal(sent[0].message.text, "영수증 만드는 중입니다.");
  assert.match(sent[1].message.attachment.payload.url, /^https:\/\/example\.com\/api\/instagram\/receipt-image\?id=/u);
  assert.equal(supabase.state.updated[0].value.outcome, "image_sent");
  const claim = supabase.state.rpc.find(({ name }) => name === "claim_instagram_receipt_bot_request_v3");
  assert.equal(claim.args.p_day_limit, 10);
  assert.equal(claim.args.p_request_kind, "receipt");
  assert.equal(supabase.state.rpc.at(-1).name, "cleanup_instagram_receipt_bot_data");
});

test("Instagram changes messages 이벤트도 canonical DM 이벤트로 처리한다", async () => {
  const payload = {
    object: "instagram",
    entry: [{
      changes: [{
        field: "messages",
        value: { sender: { id: "sender-1" }, message: { mid: "event-changes-1", text: validMessage } },
      }],
    }],
  };
  const raw = Buffer.from(JSON.stringify(payload));
  const supabase = createSupabase();
  const sent = [];
  const response = createResponse();
  await runWebhook({ method: "POST", headers: {}, body: raw }, response, {
    config, supabase, verifySignature: () => true,
    sendMessage: async (recipientId, message) => sent.push({ recipientId, message }),
  });
  assert.equal(response.statusCode, 200);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].message.text, "영수증 만드는 중입니다.");
  assert.match(sent[1].message.attachment.payload.url, /^https:\/\/example\.com\/api\/instagram\/receipt-image\?id=/u);
});

test("연결 회원은 프로필 기준 제한과 기록 소유권을 사용한다", async () => {
  const payload = { object: "instagram", entry: [{ messaging: [{ sender: { id: "sender-1" }, message: { mid: "event-1", text: validMessage } }] }] };
  const raw = Buffer.from(JSON.stringify(payload));
  const supabase = createSupabase("accepted", { profileId: "profile-1" });
  await runWebhook({ method: "POST", headers: {}, body: raw }, createResponse(), {
    config, supabase, verifySignature: () => true, sendMessage: async () => {},
  });
  const claim = supabase.state.rpc.find(({ name }) => name === "claim_instagram_receipt_bot_request_v3");
  assert.equal(claim.args.p_profile_id, "profile-1");
  assert.notEqual(claim.args.p_principal_hash, claim.args.p_sender_hash);
  assert.equal(supabase.state.inserted.find(({ table }) => table === "instagram_receipt_bot_history").value.profile_id, "profile-1");
});

test("연결 명령은 원문 Instagram ID를 저장하지 않는 일회용 링크를 발급한다", async () => {
  const payload = { object: "instagram", entry: [{ messaging: [{ sender: { id: "raw-instagram-id" }, message: { mid: "event-link", text: "연결" } }] }] };
  const raw = Buffer.from(JSON.stringify(payload));
  const supabase = createSupabase();
  const sent = [];
  await runWebhook({ method: "POST", headers: {}, body: raw }, createResponse(), {
    config, supabase, verifySignature: () => true, sendMessage: async (_recipientId, message) => sent.push(message),
  });
  const linkRow = supabase.state.inserted.find(({ table }) => table === "instagram_receipt_bot_link_codes").value;
  assert.match(linkRow.code_hash, /^[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(linkRow).includes("raw-instagram-id"), false);
  assert.match(sent[0].text, /https:\/\/example\.com\/instagram\/connect\?code=[A-Za-z0-9_-]{43}/u);
  const claim = supabase.state.rpc.find(({ name }) => name === "claim_instagram_receipt_bot_request_v3");
  assert.equal(claim.args.p_request_kind, "command");
});

test("로그인 연결 API는 서버 프로필과 code 해시만 RPC에 전달한다", async () => {
  const supabase = createSupabase("accepted", { history: [{ id: 1, receipt_summary: { homeTeam: "A" }, created_at: "2026-08-23T00:00:00Z" }] });
  const response = createResponse();
  const code = "b".repeat(43);
  await handleInstagramAccount({ method: "POST", body: { action: "link", code } }, response, {
    context: { supabase, profileId: "profile-1" }, env: { INSTAGRAM_BOT_HASH_SECRET: config.hashSecret },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.history.length, 1);
  const consume = supabase.state.rpc.find(({ name }) => name === "consume_instagram_receipt_bot_link_v2");
  assert.equal(consume.args.p_profile_id, "profile-1");
  assert.match(consume.args.p_code_hash, /^[a-f0-9]{64}$/u);
  assert.notEqual(consume.args.p_code_hash, code);
  assert.match(consume.args.p_profile_principal_hash, /^[a-f0-9]{64}$/u);
});

test("중복 이벤트는 답장과 렌더를 생략한다", async () => {
  const payload = { object: "instagram", entry: [{ messaging: [{ sender: { id: "sender-1" }, message: { mid: "event-1", text: validMessage } }] }] };
  const raw = Buffer.from(JSON.stringify(payload));
  const signature = `sha256=${createHmac("sha256", config.appSecret).update(raw).digest("hex")}`;
  const supabase = createSupabase("duplicate_event");
  const sent = [];
  await runWebhook({ method: "POST", headers: { "x-hub-signature-256": signature }, body: raw }, createResponse(), {
    config, supabase, sendMessage: async (...args) => sent.push(args),
  });
  assert.equal(sent.length, 0);
  assert.equal(supabase.state.inserted.length, 0);
});

test("사용자 제한은 원인을 안내하고 내부 이벤트 중복은 조용히 생략한다", async () => {
  const payload = { object: "instagram", entry: [{ messaging: [{ sender: { id: "sender-1" }, message: { mid: "event-limit", text: validMessage } }] }] };
  const raw = Buffer.from(JSON.stringify(payload));
  for (const [decision, expected] of [
    ["duplicate_content", "같은 내용의 영수증이 이미 처리됐습니다."],
    ["cooldown", "요청이 너무 빠릅니다. 잠시 후 다시 보내세요."],
    ["hourly_limit", "시간당 영수증 생성 한도에 도달했습니다. 잠시 후 다시 보내세요."],
    ["daily_limit", "오늘 영수증 생성 한도 10회를 모두 사용했습니다."],
  ]) {
    const sent = [];
    await runWebhook({ method: "POST", headers: {}, body: raw }, createResponse(), {
      config, supabase: createSupabase(decision), verifySignature: () => true,
      sendMessage: async (_recipientId, message) => sent.push(message.text),
    });
    assert.deepEqual(sent, [expected]);
  }
});

test("Webhook은 느린 이미지 처리 전에 200을 반환한다", async () => {
  const payload = { object: "instagram", entry: [{ messaging: [{ sender: { id: "sender-1" }, message: { mid: "event-fast-ack", text: validMessage } }] }] };
  const raw = Buffer.from(JSON.stringify(payload));
  const response = createResponse();
  const tasks = [];
  let releaseSend;
  const blockedSend = new Promise((resolve) => { releaseSend = resolve; });
  await handleInstagramWebhook({ method: "POST", headers: {}, body: raw }, response, {
    config, supabase: createSupabase(), verifySignature: () => true,
    sendMessage: async () => blockedSend,
    waitUntil(task) { tasks.push(task); },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.payload, { received: true, eventCount: 1 });
  assert.equal(tasks.length, 1);
  releaseSend();
  await Promise.all(tasks);
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

test("실제 renderer가 Instagram 제한 이내 PNG를 만든다", async () => {
  const parsed = parseInstagramReceiptMessage(validMessage);
  const supabase = {
    from() {
      return { select() { return this; }, eq() { return this; }, async maybeSingle() {
        return { data: { receipt_input: parsed.input, preset: parsed.preset, expires_at: new Date(Date.now() + 60_000).toISOString() }, error: null };
      } };
    },
  };
  const response = createResponse();
  await handleInstagramReceiptImage({ query: { id: "c".repeat(43) } }, response, { supabase });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.ok(response.body.length < 8 * 1024 * 1024);
  assert.equal(response.headers["content-length"], String(response.body.length));
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

test("계정·기록 migration은 회원 일일 제한, 비공개 기록, 보존 기한을 정의한다", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260823110000_instagram_receipt_bot_accounts_history.sql", import.meta.url), "utf8");
  assert.match(sql, /principal_hash text/u);
  assert.match(sql, /request_kind = 'receipt'[\s\S]*interval '1 day'/u);
  assert.match(sql, /instagram_receipt_bot_accounts enable row level security/u);
  assert.match(sql, /instagram_receipt_bot_history enable row level security/u);
  assert.match(sql, /where sender_hash = v_sender_hash/u);
  assert.match(sql, /interval '30 days'/u);
  assert.match(sql, /interval '1 year'/u);
});

test("재시도 migration은 lease 상태와 연결 전 사용량 승계를 정의한다", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260823230743_instagram_receipt_bot_retry_state.sql", import.meta.url), "utf8");
  assert.match(sql, /processing_state text not null default 'completed'/u);
  assert.match(sql, /attempt_count >= 3/u);
  assert.match(sql, /return 'retry'/u);
  assert.match(sql, /p_request_kind = 'receipt' and exists[\s\S]*p_cooldown_seconds/u);
  assert.match(sql, /set principal_hash = p_profile_principal_hash, profile_id = p_profile_id/u);
  assert.match(sql, /set search_path = ''/u);
  assert.match(sql, /grant execute[\s\S]*to service_role/u);
});

test("명령은 영수증 쿨다운과 시간당 한도 사용량에서 제외한다", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260823231937_instagram_receipt_bot_command_quota_repair.sql", import.meta.url), "utf8");
  assert.match(sql, /principal_hash = p_principal_hash and request_kind = 'receipt' and decision = 'accepted'[\s\S]*p_cooldown_seconds/u);
  assert.match(sql, /principal_hash = p_principal_hash and request_kind = 'receipt' and decision = 'accepted'[\s\S]*interval '1 hour'/u);
  assert.match(sql, /set search_path = ''/u);
  assert.match(sql, /grant execute[\s\S]*to service_role/u);
});
