import { createHash } from "node:crypto";
import {
  decodeBase64Image,
  deleteR2Object,
  getR2Config,
  normalizeWebpUpload,
  readR2Object,
  uploadR2Webp,
} from "../_r2ImageStorage.js";

export const MATCH_RECEIPT_EMBLEM_MAX_BYTES = 96 * 1024;
export const MATCH_RECEIPT_EMBLEM_MAX_DIMENSION = 320;
export const MATCH_RECEIPT_EMBLEM_FIELDS = Object.freeze({
  home: "homeGuestEmblemKey",
  away: "awayGuestEmblemKey",
});

const PUBLIC_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MATCH_ID_PATTERN = /^[A-Za-z0-9:_-]{1,96}$/;
const DIGEST_PATTERN = /^[0-9a-f]{24}$/;

function cleanId(value, pattern) {
  const id = String(value ?? "").trim();
  return pattern.test(id) ? id : "";
}

function cleanSide(value) {
  return value === "home" || value === "away" ? value : "";
}

function getDraftPrefix(publicId) {
  const id = cleanId(publicId, PUBLIC_ID_PATTERN);
  return id ? `match-receipt-emblems/drafts/${id}/` : "";
}

function getMatchPrefix(matchId) {
  const id = cleanId(matchId, MATCH_ID_PATTERN);
  return id ? `match-receipt-emblems/matches/${id}/` : "";
}

function cleanKey(value, prefix, side) {
  const key = String(value ?? "").trim().replace(/^\/+/, "");
  const cleanEmblemSide = cleanSide(side);
  if (!prefix || !cleanEmblemSide || !key.startsWith(prefix) || key.includes("..")) return "";
  const tail = key.slice(prefix.length);
  const match = tail.match(/^(home|away)-([0-9a-f]{24})\.webp$/);
  return match?.[1] === cleanEmblemSide && DIGEST_PATTERN.test(match[2]) ? key : "";
}

export function cleanDraftReceiptEmblemKey(value, publicId, side) {
  return cleanKey(value, getDraftPrefix(publicId), side);
}

export function cleanMatchReceiptEmblemKey(value, matchId, side) {
  return cleanKey(value, getMatchPrefix(matchId), side);
}

export function getSafeDraftReceiptEmblems(payload, publicId) {
  return Object.fromEntries(Object.entries(MATCH_RECEIPT_EMBLEM_FIELDS).map(([side, field]) => [
    side,
    cleanDraftReceiptEmblemKey(payload?.[field], publicId, side),
  ]));
}

export function getSafeMatchReceiptEmblems(payload, matchId) {
  return Object.fromEntries(["home", "away"].map((side) => [
    side,
    cleanMatchReceiptEmblemKey(payload?.[side], matchId, side),
  ]));
}

async function normalizeReceiptEmblem(bytes, errorPrefix = "receipt_emblem_invalid") {
  return normalizeWebpUpload(bytes, {
    maxBytes: MATCH_RECEIPT_EMBLEM_MAX_BYTES,
    maxDimension: MATCH_RECEIPT_EMBLEM_MAX_DIMENSION,
    errorPrefix,
    canonicalizeWebp: false,
  });
}

function getDigest(bytes) {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 24);
}

export async function uploadDraftReceiptEmblem({ publicId, side, imageBase64, previousKey = "" }) {
  const prefix = getDraftPrefix(publicId);
  const cleanEmblemSide = cleanSide(side);
  if (!prefix || !cleanEmblemSide) throw new Error("receipt_emblem_target_invalid");
  const decoded = decodeBase64Image(imageBase64, {
    maxBytes: MATCH_RECEIPT_EMBLEM_MAX_BYTES,
    errorPrefix: "receipt_emblem_invalid",
  });
  const normalized = await normalizeReceiptEmblem(decoded);
  const key = `${prefix}${cleanEmblemSide}-${getDigest(normalized.bytes)}.webp`;
  const oldKey = cleanDraftReceiptEmblemKey(previousKey, publicId, cleanEmblemSide);
  if (key !== oldKey) {
    const config = getR2Config();
    await uploadR2Webp(config, key, normalized.bytes, "match receipt emblem");
  }
  return key;
}

export async function deleteDraftReceiptEmblem({ publicId, side, key }) {
  const safeKey = cleanDraftReceiptEmblemKey(key, publicId, side);
  if (!safeKey) return false;
  await deleteR2Object(getR2Config(), safeKey, "match receipt emblem");
  return true;
}

async function copyReceiptEmblem(sourceKey, targetPrefix, side) {
  if (!sourceKey || !targetPrefix) return "";
  const config = getR2Config();
  const source = await readR2Object(config, sourceKey, "match receipt emblem");
  const normalized = await normalizeReceiptEmblem(source, "receipt_emblem_source_invalid");
  const key = `${targetPrefix}${side}-${getDigest(normalized.bytes)}.webp`;
  await uploadR2Webp(config, key, normalized.bytes, "copied match receipt emblem");
  return key;
}

export async function copyDraftReceiptEmblems({ payload, sourcePublicId, targetPublicId = "", targetMatchId = "" }) {
  const source = getSafeDraftReceiptEmblems(payload, sourcePublicId);
  const targetPrefix = targetPublicId ? getDraftPrefix(targetPublicId) : getMatchPrefix(targetMatchId);
  if (!targetPrefix) throw new Error("receipt_emblem_target_invalid");
  const copied = { home: "", away: "" };
  try {
    for (const side of ["home", "away"]) {
      copied[side] = await copyReceiptEmblem(source[side], targetPrefix, side);
    }
  } catch (error) {
    if (targetPublicId) await deleteReceiptEmblemKeys(Object.values(copied));
    throw error;
  }
  return copied;
}

export async function deleteReceiptEmblemKeys(keys = [], { ignoreErrors = true } = {}) {
  const config = getR2Config();
  const removals = keys.filter(Boolean).map((key) => deleteR2Object(config, key, "match receipt emblem"));
  if (ignoreErrors) {
    await Promise.all(removals.map((removal) => removal.catch(() => {})));
    return;
  }
  await Promise.all(removals);
}
