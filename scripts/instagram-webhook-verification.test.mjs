import assert from "node:assert/strict";
import test from "node:test";
import instagramWebhook from "../api/instagram-webhook.js";

const TEST_ENV = Object.freeze({
  INSTAGRAM_APP_SECRET: "app-secret",
  INSTAGRAM_WEBHOOK_VERIFY_TOKEN: "verify-token",
  INSTAGRAM_ACCESS_TOKEN: "access-token",
  INSTAGRAM_ACCOUNT_ID: "account-id",
  INSTAGRAM_BOT_HASH_SECRET: "hash-secret",
  INSTAGRAM_GRAPH_API_VERSION: "v24.0",
  INSTAGRAM_BOT_PUBLIC_BASE_URL: "https://example.com",
  INSTAGRAM_BOT_COOLDOWN_SECONDS: "10",
  INSTAGRAM_BOT_HOURLY_LIMIT: "5",
  INSTAGRAM_BOT_DAILY_LIMIT: "10",
  INSTAGRAM_BOT_GLOBAL_HOURLY_LIMIT: "100",
  INSTAGRAM_BOT_CONTENT_DEDUPE_SECONDS: "60",
  INSTAGRAM_BOT_RENDER_TTL_SECONDS: "300",
  INSTAGRAM_BOT_LINK_TTL_SECONDS: "600",
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

test("Meta의 점·밑줄 Webhook 검증 쿼리를 허용한다", async () => {
  const originalEnv = Object.fromEntries(Object.keys(TEST_ENV).map((key) => [key, process.env[key]]));
  Object.assign(process.env, TEST_ENV);
  try {
    for (const query of [
      {
        "hub.mode": "subscribe", "hub.challenge": "12345", "hub.verify_token": "verify-token",
        hub_mode: "subscribe", hub_challenge: "12345", hub_verify_token: "verify-token",
      },
      { hub_mode: "subscribe", hub_challenge: "67890", hub_verify_token: "verify-token" },
    ]) {
      const response = createResponse();
      await instagramWebhook({ method: "GET", query }, response);
      assert.equal(response.statusCode, 200);
      assert.equal(response.body, query["hub.challenge"] ?? query.hub_challenge);
    }
  } finally {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
