import assert from "node:assert/strict";
import test from "node:test";
import { handleTemporaryReceiptDownload } from "../server/api/match-receipts/download.js";
import {
  createTemporaryReceiptDelivery,
  deleteTemporaryReceiptPng,
  readTemporaryReceiptPng,
  storeTemporaryReceiptPng,
  verifyTemporaryReceiptDownload,
} from "../server/api/match-receipts/_temporaryPngStorage.js";

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("boxtier-test"),
]);
const ID = "A".repeat(43);
const SECRET = "s".repeat(32);
const R2_CONFIG = { accountId: "account", bucket: "bucket", token: "token" };

test("temporary PNG storage uses one canonical key and preserves exact bytes", async () => {
  const calls = [];
  await storeTemporaryReceiptPng(ID, PNG, {
    r2Config: R2_CONFIG,
    upload: async (config, key, body) => calls.push(["upload", config, key, body]),
  });
  const restored = await readTemporaryReceiptPng(ID, {
    r2Config: R2_CONFIG,
    read: async (config, key) => {
      calls.push(["read", config, key]);
      return PNG;
    },
  });
  await deleteTemporaryReceiptPng(ID, {
    r2Config: R2_CONFIG,
    remove: async (config, key) => calls.push(["delete", config, key]),
  });

  assert.equal(calls[0][2], `temporary/match-receipts/${ID}.png`);
  assert.strictEqual(calls[0][3], PNG);
  assert.strictEqual(restored, PNG);
  assert.equal(calls[1][2], calls[0][2]);
  assert.equal(calls[2][2], calls[0][2]);
});

test("delivery URL is signed, short-lived, and points to the stored PNG", async () => {
  const now = Date.UTC(2026, 7, 24, 0, 0, 0);
  let stored;
  const result = await createTemporaryReceiptDelivery(PNG, {
    createId: () => ID,
    deliveryConfig: { secret: SECRET, ttlSeconds: 600 },
    now,
    publicBaseUrl: "https://boxtier.kr",
    store: async (id, png) => { stored = { id, png }; },
  });
  const url = new URL(result.downloadUrl);

  assert.deepEqual(stored, { id: ID, png: PNG });
  assert.equal(url.origin, "https://boxtier.kr");
  assert.equal(url.pathname, "/api/match-receipts/download");
  assert.equal(result.downloadExpiresAt, "2026-08-24T00:10:00.000Z");
  assert.deepEqual(verifyTemporaryReceiptDownload(Object.fromEntries(url.searchParams), {
    deliveryConfig: { secret: SECRET, ttlSeconds: 600 },
    now,
  }), { id: ID, expires: Math.floor(now / 1000) + 600 });

  url.searchParams.set("signature", `${url.searchParams.get("signature")}x`);
  assert.throws(() => verifyTemporaryReceiptDownload(Object.fromEntries(url.searchParams), {
    deliveryConfig: { secret: SECRET, ttlSeconds: 600 },
    now,
  }), { statusCode: 404 });
});

test("expired delivery URL is rejected", () => {
  assert.throws(() => verifyTemporaryReceiptDownload({ id: ID, expires: "1", signature: "x" }, {
    deliveryConfig: { secret: SECRET, ttlSeconds: 600 },
    now: 2_000,
  }), { statusCode: 404 });
});

test("download endpoint returns exact stored PNG as an attachment", async () => {
  const headers = new Map();
  let body;
  const response = {
    statusCode: 0,
    setHeader(name, value) { headers.set(name, value); },
    end(value) { body = value; },
  };
  await handleTemporaryReceiptDownload({ query: { id: ID, expires: "1", signature: "x" } }, response, {
    verify: () => ({ id: ID, expires: 1 }),
    readPng: async () => PNG,
  });

  assert.equal(response.statusCode, 200);
  assert.strictEqual(body, PNG);
  assert.equal(headers.get("Content-Type"), "image/png");
  assert.equal(headers.get("Content-Length"), String(PNG.length));
  assert.equal(headers.get("Content-Disposition"), 'attachment; filename="boxtier-receipt.png"');
  assert.equal(headers.get("Cache-Control"), "private, no-store, max-age=0");
});
