import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  HIGH_IMPACT_ADMIN_REVIEW_ACTIONS,
  isHighImpactAdminReviewAction as sharedIsHighImpactAdminReviewAction,
} from "../shared/lib/adminReview.js";
import * as sharedConstants from "../shared/lib/constants.js";
import * as sharedCourtPolicy from "../shared/lib/courtPolicy.js";
import { isWithinOneEdit } from "../shared/lib/fuzzyText.js";
import * as sharedMatchUtils from "../shared/lib/matchUtils.js";
import { normalizeNaverAddress } from "../shared/lib/naverAddress.js";
import { sortPlainObject } from "../shared/lib/plainObject.js";
import * as sharedPostgameRecordVerification from "../shared/lib/postgameRecordVerification.js";
import * as sharedRecordRetention from "../shared/lib/recordRetention.js";
import * as sharedRecruiting from "../shared/lib/recruiting.js";
import * as sharedRegionText from "../shared/lib/regionText.js";
import * as sharedReportReasons from "../shared/lib/reportReasons.js";
import * as clientConstants from "../src/lib/constants.js";
import { isHighImpactAdminReviewAction as clientIsHighImpactAdminReviewAction } from "../src/lib/admin.js";
import * as clientCourts from "../src/lib/courts.js";
import * as clientMatchUtils from "../src/lib/matchUtils.js";
import * as clientPostgameRecordVerification from "../src/lib/postgameRecordVerification.js";
import * as clientRecordRetention from "../src/lib/recordRetention.js";
import * as clientRecruiting from "../src/lib/recruiting.js";
import * as clientRegionText from "../src/lib/regionText.js";
import * as clientReportReasons from "../src/lib/reportReasons.js";
import { toQueuedDiscordDeliveryRow } from "../server/lib/discordDeliveryRows.js";
import { assertCourtRequestAccess } from "../server/lib/courtRequestAccess.js";
import { createFixedWindowRateLimiter } from "../server/lib/fixedWindowRateLimit.js";
import { projectTournamentDbIdentity } from "../server/lib/tournamentPersistence.js";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

async function listJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return listJavaScriptFiles(target);
    return entry.isFile() && /\.(?:js|mjs|jsx)$/.test(entry.name) ? [target] : [];
  }));
  return nested.flat();
}

function assertSameExports(client, shared) {
  assert.deepEqual(Object.keys(client).sort(), Object.keys(shared).sort());
  for (const exportName of Object.keys(shared)) {
    assert.strictEqual(client[exportName], shared[exportName]);
  }
}

test("server domain policies keep one shared implementation", () => {
  assertSameExports(clientConstants, sharedConstants);
  assertSameExports(clientMatchUtils, sharedMatchUtils);
  assertSameExports(clientPostgameRecordVerification, sharedPostgameRecordVerification);
  assertSameExports(clientRecordRetention, sharedRecordRetention);
  assertSameExports(clientRecruiting, sharedRecruiting);
  assertSameExports(clientRegionText, sharedRegionText);
  assertSameExports(clientReportReasons, sharedReportReasons);
  assert.strictEqual(clientCourts.normalizeCourtOptionalBoolean, sharedCourtPolicy.normalizeCourtOptionalBoolean);
});

test("client compatibility modules only re-export shared domain policies", async () => {
  const expectedShims = new Map([
    ["src/lib/constants.js", 'export * from "../../shared/lib/constants.js";'],
    ["src/lib/matchUtils.js", 'export * from "../../shared/lib/matchUtils.js";'],
    ["src/lib/postgameRecordVerification.js", 'export * from "../../shared/lib/postgameRecordVerification.js";'],
    ["src/lib/recordRetention.js", 'export * from "../../shared/lib/recordRetention.js";'],
    ["src/lib/recruiting.js", 'export * from "../../shared/lib/recruiting.js";'],
    ["src/lib/regionText.js", 'export * from "../../shared/lib/regionText.js";'],
    ["src/lib/reportReasons.js", 'export * from "../../shared/lib/reportReasons.js";'],
  ]);

  for (const [relativePath, expectedSource] of expectedShims) {
    const source = await readFile(path.join(ROOT, relativePath), "utf8");
    assert.equal(source.trim(), expectedSource);
  }
});

test("server and shared domain modules never import the client compatibility paths", async () => {
  const forbidden = /src\/lib\/(?:constants|matchUtils|postgameRecordVerification|recordRetention|recruiting|regionText|reportReasons)\.js/;
  const serverFiles = await listJavaScriptFiles(path.join(ROOT, "server"));
  const serverSources = await Promise.all(serverFiles.map(async (file) => ({
    file,
    source: await readFile(file, "utf8"),
  })));

  for (const { file, source } of serverSources) {
    assert.doesNotMatch(source.replaceAll("\\", "/"), forbidden, path.relative(ROOT, file));
  }

  const sharedFiles = [
    "constants.js",
    "matchUtils.js",
    "postgameRecordVerification.js",
    "recordRetention.js",
    "recruiting.js",
    "regionText.js",
    "reportReasons.js",
  ];
  for (const filename of sharedFiles) {
    const source = await readFile(path.join(ROOT, "shared/lib", filename), "utf8");
    assert.doesNotMatch(source.replaceAll("\\", "/"), /(?:^|["'])\.\.\/\.\.\/src\//, filename);
  }

  const combinedServerSource = serverSources.map(({ source }) => source).join("\n");
  [
    "shared/lib/constants.js",
    "shared/lib/matchUtils.js",
    "shared/lib/postgameRecordVerification.js",
    "shared/lib/recordRetention.js",
    "shared/lib/recruiting.js",
    "shared/lib/reportReasons.js",
  ].forEach((sharedPath) => assert.match(combinedServerSource, new RegExp(sharedPath.replaceAll("/", "\\/"))));
});

test("small cross-runtime utilities keep one shared implementation", async () => {
  assert.strictEqual(clientIsHighImpactAdminReviewAction, sharedIsHighImpactAdminReviewAction);
  assert.equal(HIGH_IMPACT_ADMIN_REVIEW_ACTIONS.includes("suspendTarget"), true);
  assert.equal(sharedIsHighImpactAdminReviewAction("dismissReport"), false);
  assert.equal(isWithinOneEdit("court", "cour"), true);
  assert.equal(isWithinOneEdit("court", "coast"), false);
  assert.deepEqual(sortPlainObject({ z: 1, a: { y: 1, b: 2 } }), {
    a: { b: 2, y: 1 },
    z: 1,
  });
  assert.deepEqual(normalizeNaverAddress({
    x: "127.1",
    y: "37.2",
    roadAddress: "서울로 1",
    addressElements: [{ types: ["SIDO"], longName: "서울특별시" }],
  }, 2), {
    id: "naver:127.1:37.2:2",
    addressText: "서울로 1",
    roadAddress: "서울로 1",
    jibunAddress: "",
    buildingName: "",
    bname: "",
    hname: "",
    sido: "서울특별시",
    sigungu: "",
    zonecode: "",
    lat: 37.2,
    lng: 127.1,
  });

  const consumers = [
    ["src/lib/admin.js", "shared/lib/adminReview.js"],
    ["server/api/admin/review-action.js", "shared/lib/adminReview.js"],
    ["server/api/discord/dm-worker.js", "shared/lib/notifications.js"],
    ["server/lib/matchSyncDependencies.js", "shared/lib/plainObject.js"],
    ["server/api/tournaments/sync-tournament.js", "shared/lib/plainObject.js"],
    ["src/lib/courtCore.js", "shared/lib/fuzzyText.js"],
    ["server/api/search.js", "shared/lib/fuzzyText.js"],
    ["src/lib/naverAddress.js", "shared/lib/naverAddress.js"],
    ["server/api/courts/address-search.js", "shared/lib/naverAddress.js"],
  ];
  for (const [relativePath, sharedPath] of consumers) {
    const source = (await readFile(path.join(ROOT, relativePath), "utf8")).replaceAll("\\", "/");
    assert.match(source, new RegExp(sharedPath.replaceAll("/", "\\/")), relativePath);
  }
});

test("server infrastructure helpers preserve route-specific limits and queued delivery rows", async () => {
  let now = 100;
  const assertRateLimit = createFixedWindowRateLimiter({
    windowMs: 60,
    max: 2,
    errorCode: "test_rate_limited",
    now: () => now,
  });
  assert.doesNotThrow(() => assertRateLimit("profile-1"));
  assert.doesNotThrow(() => assertRateLimit("profile-1"));
  assert.throws(() => assertRateLimit("profile-1"), (error) => (
    error.message === "test_rate_limited" && error.statusCode === 429
  ));
  now = 161;
  assert.doesNotThrow(() => assertRateLimit("profile-1"));

  const makeCourtAccessContext = (data, error = null) => ({
    profileId: "profile-1",
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data, error }),
          }),
        }),
      }),
    },
  });
  await assert.doesNotReject(assertCourtRequestAccess(makeCourtAccessContext({ trust_score: 100 })));
  await assert.rejects(
    assertCourtRequestAccess(makeCourtAccessContext({ trust_score: 0 })),
    (error) => error.message === "court_request_trust_required" && error.statusCode === 403,
  );

  assert.deepEqual(toQueuedDiscordDeliveryRow({
    id: "delivery-1",
    notificationId: "notice-1",
    targetUserId: "profile-1",
    discordUserId: "discord-1",
    payload: { status: "queued" },
    queuedAt: "2026-07-30T00:00:00.000Z",
    sendAt: "2026-07-30T00:01:00.000Z",
  }), {
    id: "delivery-1",
    notification_id: "notice-1",
    target_user_id: "profile-1",
    discord_user_id: "discord-1",
    event: "match",
    status: "queued",
    payload: { status: "queued" },
    queued_at: "2026-07-30T00:00:00.000Z",
    send_at: "2026-07-30T00:01:00.000Z",
    sent_at: null,
    failed_at: null,
    last_error: null,
    created_at: "2026-07-30T00:00:00.000Z",
    updated_at: "2026-07-30T00:00:00.000Z",
  });
  assert.deepEqual(projectTournamentDbIdentity({
    id: "tournament-1",
    title: "Summer",
    format: "league",
    visibility: "public",
    status: "draft",
    region: "서울특별시",
    courtId: "court-1",
    court: "서울 체육관",
    mode: "5v5",
  }), {
    id: "tournament-1",
    title: "Summer",
    format: "league",
    visibility: "public",
    status: "draft",
    region: "서울특별시",
    court_id: "court-1",
    court_name: "서울 체육관",
    mode: "5v5",
  });
  assert.equal(
    projectTournamentDbIdentity({ courtId: "canonical" }, { courtId: "snapshot" }).court_id,
    "snapshot",
  );

  const consumers = [
    ["server/api/courts/address-search.js", "lib/courtRequestAccess.js"],
    ["server/api/courts/place-search.js", "lib/courtRequestAccess.js"],
    ["server/api/courts/address-search.js", "lib/fixedWindowRateLimit.js"],
    ["server/api/courts/place-search.js", "lib/fixedWindowRateLimit.js"],
    ["server/lib/matchSyncDependencies.js", "matchNotifications.js"],
    ["server/lib/matchSyncDependencies.js", "matchSnapshotRows.js"],
    ["server/lib/matchSyncDependencies.js", "matchSnapshotValidation.js"],
    ["server/lib/matchNotificationRows.js", "discordDeliveryRows.js"],
    ["server/lib/matchSnapshotValidation.js", "matchSnapshotRows.js"],
    ["server/api/recruiting/_syncPostProjection.js", "lib/discordDeliveryRows.js"],
    ["server/lib/matchSyncDependencies.js", "tournamentPersistence.js"],
    ["server/api/tournaments/sync-tournament.js", "lib/tournamentPersistence.js"],
  ];
  for (const [relativePath, sharedPath] of consumers) {
    const source = (await readFile(path.join(ROOT, relativePath), "utf8")).replaceAll("\\", "/");
    assert.match(source, new RegExp(sharedPath.replaceAll("/", "\\/")), relativePath);
  }
});
