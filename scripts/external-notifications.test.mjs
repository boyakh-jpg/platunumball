import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { canResolveExternalContact } from "../server/api/contacts/resolve.js";
import { decodeNotificationCursor, encodeNotificationCursor } from "../server/api/notifications/list.js";
import { getRetryDelaySeconds } from "../server/api/notifications/push-worker.js";
import {
  createMinimalPushPayload,
  getNotificationCategory,
  isExternalChannelEnabled,
  isNotificationCategoryEnabled,
  normalizeKakaoOpenProfileUrl,
  normalizeNotificationDeliveryPreferences,
  normalizeSafeAppPath,
} from "../shared/lib/externalNotifications.js";

const root = new URL("../", import.meta.url);
const readSource = (path) => readFile(new URL(path, root), "utf8");

test("external notification defaults and modes stay canonical", () => {
  assert.deepEqual(normalizeNotificationDeliveryPreferences(), {
    mode: "none",
    gameRecruiting: true,
    team: true,
    recordTier: true,
    service: false,
  });
  assert.equal(isExternalChannelEnabled({ mode: "both" }, "push"), true);
  assert.equal(isExternalChannelEnabled({ mode: "discord" }, "push"), false);
  assert.equal(isNotificationCategoryEnabled({}, "service"), false);
  assert.equal(isNotificationCategoryEnabled({}, "team"), true);
  assert.equal(getNotificationCategory({ type: "tier_changed" }), "record");
  assert.equal(getNotificationCategory({ recruitingPostId: "room-1" }), "recruiting");
  assert.equal(getNotificationCategory({ type: "team_invite" }), "team");
});

test("push payload is minimal and accepts only internal app paths", () => {
  assert.equal(normalizeSafeAppPath("/app"), "/app");
  assert.equal(normalizeSafeAppPath("/app/matching?room=1#team"), "/app/matching?room=1#team");
  assert.equal(normalizeSafeAppPath("/application"), "/app/notifications");
  assert.equal(normalizeSafeAppPath("https://evil.example/app"), "/app/notifications");
  assert.equal(normalizeSafeAppPath("/app/login"), "/app/notifications");

  const payload = createMinimalPushPayload({
    id: "notice-1",
    type: "match_ready",
    title: "경기 준비",
    body: "입장해 주세요.",
    secret: "must-not-leak",
  }, "/app/matches/1");
  assert.deepEqual(Object.keys(payload), ["id", "type", "title", "body", "path", "tag", "timestamp"]);
  assert.equal("secret" in payload, false);
});

test("Kakao contact URL validation rejects every non-canonical component", () => {
  assert.equal(normalizeKakaoOpenProfileUrl("https://open.kakao.com/o/Abc_123-"), "https://open.kakao.com/o/Abc_123-");
  [
    "http://open.kakao.com/o/Abc123",
    "https://open.kakao.com:444/o/Abc123",
    "https://user@open.kakao.com/o/Abc123",
    "https://open.kakao.com/o/Abc123?q=1",
    "https://open.kakao.com/o/Abc123#x",
    "https://open.kakao.com/not-o/Abc123",
    "https://evil.example/o/Abc123",
  ].forEach((url) => assert.equal(normalizeKakaoOpenProfileUrl(url), ""));
});

test("contact resolution requires two distinct unblocked context participants", () => {
  const participantIds = new Set(["requester", "target"]);
  assert.equal(canResolveExternalContact({ requesterId: "requester", targetId: "target", participantIds }), true);
  assert.equal(canResolveExternalContact({ requesterId: "requester", targetId: "requester", participantIds }), false);
  assert.equal(canResolveExternalContact({ requesterId: "requester", targetId: "target", participantIds, blocked: true }), false);
  assert.equal(canResolveExternalContact({ requesterId: "outsider", targetId: "target", participantIds }), false);
});

test("push retry is bounded and supports Retry-After", () => {
  assert.equal(getRetryDelaySeconds(1), 30);
  assert.equal(getRetryDelaySeconds(5), 480);
  assert.equal(getRetryDelaySeconds(20), 3600);
  assert.equal(getRetryDelaySeconds(1, "120"), 120);
});

test("notification cursor accepts canonical non-UUID ids without filter injection", () => {
  const cursor = encodeNotificationCursor({
    created_at: "2026-08-18T01:02:03.000Z",
    id: "tournament-invite-0123456789abcdef",
  });
  assert.deepEqual(decodeNotificationCursor(cursor), {
    createdAt: "2026-08-18T01:02:03.000Z",
    id: "tournament-invite-0123456789abcdef",
  });
  const unsafeCursor = Buffer.from(JSON.stringify({
    createdAt: "2026-08-18T01:02:03.000Z",
    id: "notice),created_at.gt.1970-01-01",
  })).toString("base64url");
  assert.equal(decodeNotificationCursor(unsafeCursor), null);
});

test("service worker and migrations preserve delivery boundaries", async () => {
  const [serviceWorker, migration, cronMigration, vercelConfigSource] = await Promise.all([
    readSource("public/sw.js"),
    readSource("supabase/migrations/20260816193000_external_notification_delivery.sql"),
    readSource("supabase/migrations/20260818040017_supabase_push_notification_cron.sql"),
    readSource("vercel.json"),
  ]);
  const vercelConfig = JSON.parse(vercelConfigSource);
  assert.equal(vercelConfig.crons.some(({ path }) => path === "/api/notifications/push-worker"), false);
  assert.match(serviceWorker, /addEventListener\("push"/);
  assert.match(serviceWorker, /addEventListener\("notificationclick"/);
  assert.doesNotMatch(serviceWorker, /addEventListener\("fetch"/);
  assert.match(serviceWorker, /visibilityState === "visible"/);
  assert.match(migration, /revoke all on public\.external_contact_preferences from anon;/);
  assert.match(migration, /queued\.status = 'sending'.*interval '10 minutes'/s);
  assert.doesNotMatch(migration, /drop trigger[^;]*discord/i);
  assert.doesNotMatch(migration, /\bpg_cron\b|cron\.schedule|\bpg_net\b|net\.http|supabase_functions\.http_request/i);
  assert.match(cronMigration, /rankball_app_base_url/);
  assert.match(cronMigration, /rankball_cron_secret/);
  assert.match(cronMigration, /\/api\/notifications\/push-worker/);
  assert.match(cronMigration, /rankball-push-notification-worker[\s\S]*'\* \* \* \* \*'/);
  assert.doesNotMatch(cronMigration, /cron-job\.org|vercel/i);
});
