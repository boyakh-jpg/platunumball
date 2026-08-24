import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  deleteR2Object,
  getPrivateR2Config,
  readR2Object,
  uploadPrivateR2Png,
} from "../_r2ImageStorage.js";

const TEMPORARY_RECEIPT_PREFIX = "temporary/match-receipts";
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DEFAULT_TTL_SECONDS = 600;

function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

function getDeliveryConfig(env = process.env) {
  const secret = String(env.MATCH_RECEIPT_DELIVERY_SECRET || "").trim();
  if (secret.length < 32) throw httpError(503, "match_receipt_delivery_secret_not_configured");
  const configuredTtl = env.MATCH_RECEIPT_DELIVERY_TTL_SECONDS == null
    ? DEFAULT_TTL_SECONDS
    : Number(env.MATCH_RECEIPT_DELIVERY_TTL_SECONDS);
  if (!Number.isInteger(configuredTtl) || configuredTtl < 60 || configuredTtl > 3600) {
    throw httpError(503, "match_receipt_delivery_ttl_invalid");
  }
  return { secret, ttlSeconds: configuredTtl };
}

function assertOpaqueId(id) {
  if (!OPAQUE_ID_PATTERN.test(String(id || ""))) throw httpError(404, "receipt_png_not_found");
  return String(id);
}

function assertPng(png) {
  if (!Buffer.isBuffer(png) || png.length <= PNG_SIGNATURE.length || !png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw httpError(500, "invalid_receipt_png");
  }
}

function getObjectKey(id) {
  return `${TEMPORARY_RECEIPT_PREFIX}/${assertOpaqueId(id)}.png`;
}

function sign(id, expires, secret) {
  return createHmac("sha256", secret).update(`${id}.${expires}`).digest("base64url");
}

export async function storeTemporaryReceiptPng(id, png, options = {}) {
  assertPng(png);
  const config = options.r2Config ?? getPrivateR2Config();
  await (options.upload ?? uploadPrivateR2Png)(config, getObjectKey(id), png, "temporary receipt PNG");
}

export async function readTemporaryReceiptPng(id, options = {}) {
  const config = options.r2Config ?? getPrivateR2Config();
  const png = await (options.read ?? readR2Object)(config, getObjectKey(id), "temporary receipt PNG");
  assertPng(png);
  return png;
}

export async function deleteTemporaryReceiptPng(id, options = {}) {
  const config = options.r2Config ?? getPrivateR2Config();
  return (options.remove ?? deleteR2Object)(config, getObjectKey(id), "temporary receipt PNG");
}

export async function createTemporaryReceiptDelivery(png, options = {}) {
  assertPng(png);
  const { secret, ttlSeconds } = options.deliveryConfig ?? getDeliveryConfig(options.env);
  const id = (options.createId ?? (() => randomBytes(32).toString("base64url")))();
  assertOpaqueId(id);
  const expires = Math.floor((options.now ?? Date.now()) / 1000) + ttlSeconds;
  const url = new URL("/api/match-receipts/download", options.publicBaseUrl);
  url.searchParams.set("id", id);
  url.searchParams.set("expires", String(expires));
  url.searchParams.set("signature", sign(id, expires, secret));
  await (options.store ?? storeTemporaryReceiptPng)(id, png);
  return { downloadUrl: url.toString(), downloadExpiresAt: new Date(expires * 1000).toISOString() };
}

export function verifyTemporaryReceiptDownload(input, options = {}) {
  const id = assertOpaqueId(input.id);
  const expires = Number(input.expires);
  const signature = String(input.signature || "");
  if (!Number.isSafeInteger(expires) || expires <= Math.floor((options.now ?? Date.now()) / 1000)) {
    throw httpError(404, "receipt_png_not_found");
  }
  const { secret } = options.deliveryConfig ?? getDeliveryConfig(options.env);
  const expected = Buffer.from(sign(id, expires, secret));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw httpError(404, "receipt_png_not_found");
  return { id, expires };
}
