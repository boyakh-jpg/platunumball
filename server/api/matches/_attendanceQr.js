import { createHmac, timingSafeEqual } from "node:crypto";
import { getPublicAppWebUrl } from "../_publicAppUrl.js";

export const ATTENDANCE_QR_ROTATION_MS = 5 * 60 * 1000;
const ATTENDANCE_QR_GRACE_MS = 15 * 1000;

function getSigningSecret() {
  const secret = String(
    process.env.MATCH_ATTENDANCE_QR_SECRET
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || "",
  );
  if (!secret) throw new Error("match_attendance_qr_secret_missing");
  return secret;
}

function signToken(matchId, bucket) {
  return createHmac("sha256", getSigningSecret())
    .update(`rankball-attendance-v2\n${matchId}\n${bucket}`)
    .digest()
    .subarray(0, 16)
    .toString("base64url");
}

function safeSignatureMatches(actual = "", expected = "") {
  const actualBuffer = Buffer.from(String(actual));
  const expectedBuffer = Buffer.from(String(expected));
  return actualBuffer.length === expectedBuffer.length
    && actualBuffer.length > 0
    && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function createMatchAttendanceQr(matchId, request = null, nowMs = Date.now()) {
  const safeMatchId = String(matchId || "").trim();
  if (!safeMatchId) throw new Error("match_id_required");
  const bucket = Math.floor(nowMs / ATTENDANCE_QR_ROTATION_MS);
  const token = `2.${bucket.toString(36)}.${signToken(safeMatchId, bucket)}`;
  const expiresAtMs = (bucket + 1) * ATTENDANCE_QR_ROTATION_MS;
  const path = `/app/matches/${encodeURIComponent(safeMatchId)}?attendanceQr=${encodeURIComponent(token)}`;
  return {
    token,
    value: getPublicAppWebUrl(path, request),
    expiresAt: new Date(expiresAtMs).toISOString(),
    refreshAfterMs: Math.max(1000, expiresAtMs - nowMs + 500),
    rotationSeconds: ATTENDANCE_QR_ROTATION_MS / 1000,
  };
}

export function verifyMatchAttendanceQr(token = "", matchId = "", nowMs = Date.now()) {
  const [version, bucketText, signature, ...extra] = String(token || "").split(".");
  const safeMatchId = String(matchId || "").trim();
  if (
    version !== "2"
    || !/^[0-9a-z]+$/u.test(bucketText || "")
    || !signature
    || extra.length
  ) {
    throw new Error("match_attendance_qr_invalid");
  }
  const bucket = Number.parseInt(bucketText, 36);
  if (
    !safeMatchId
    || !Number.isSafeInteger(bucket)
    || bucket < 0
    || !safeSignatureMatches(signature, signToken(safeMatchId, bucket))
  ) {
    throw new Error("match_attendance_qr_invalid");
  }
  const bucketStartMs = bucket * ATTENDANCE_QR_ROTATION_MS;
  const expiresAtMs = bucketStartMs + ATTENDANCE_QR_ROTATION_MS;
  if (nowMs < bucketStartMs || nowMs > expiresAtMs + ATTENDANCE_QR_GRACE_MS) {
    throw new Error("match_attendance_qr_expired");
  }
  return { matchId: safeMatchId, bucket, expiresAt: new Date(expiresAtMs).toISOString() };
}
