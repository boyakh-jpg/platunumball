import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  getDatePart,
  getDbScheduleParts,
  getTimePart,
  toDateTime,
  toDbTime,
} from "../shared/lib/matchPersistence.js";
import { fromRemoteMatch } from "../src/data/matchMappers.js";
import { fromRemoteRecruitingPost } from "../src/data/recruitingMappers.js";
import { toDateTime as toRowDateTime } from "../src/data/rowUtils.js";
import { toDateTime as toServerDateTime } from "../server/api/_supabaseAdmin.js";

function makeMatchContext() {
  return {
    playersByMatch: new Map(),
    resultsByMatch: {},
    statsByMatch: new Map(),
    disputesByMatch: new Map(),
    agreementsByMatch: new Map(),
    approvalsByMatch: new Map(),
    teamById: {},
    courtById: {},
  };
}

test("schedule projection keeps local calendar text without timezone conversion", () => {
  assert.equal(toDateTime("2026-07-29", "00:30:59+09"), "2026-07-29 00:30");
  assert.equal(toDateTime("2026-07-29", "", "fallback"), "2026-07-29");
  assert.equal(toDateTime("", "", "즉시"), "즉시");
  assert.equal(toDateTime(null, null, ""), "");
  assert.equal(toDateTime(null, null, null), "일정 미정");
  assert.equal(toRowDateTime(null, null, undefined), "일정 미정");
  assert.equal(toServerDateTime(null, null, undefined), "미정");
});

test("schedule persistence separates instant rooms from scheduled date parts", () => {
  assert.equal(getDatePart("2026-07-29T15:30:00+09:00"), "2026-07-29");
  assert.equal(getTimePart("2026-07-29T15:30:00+09:00"), "15:30");
  assert.equal(toDbTime("15:30:59"), "15:30");
  assert.deepEqual(getDbScheduleParts({
    scheduledAt: "2026-07-29T15:30:00+09:00",
  }), {
    timingType: "scheduled",
    scheduledDate: "2026-07-29",
    scheduledTime: "15:30",
    scheduledAt: "2026-07-29 15:30",
  });
  assert.deepEqual(getDbScheduleParts({
    roomState: { timingType: "instant" },
    scheduledDate: "2026-07-29",
    scheduledTime: "15:30",
  }), {
    timingType: "instant",
    scheduledDate: null,
    scheduledTime: null,
    scheduledAt: null,
  });
});

test("match and recruiting read projections preserve legacy instant and fallback semantics", () => {
  const instantMatch = fromRemoteMatch({
    id: "match-instant",
    scheduled_at: "즉시",
    rules: {},
  }, makeMatchContext());
  assert.equal(instantMatch.timingType, "instant");
  assert.equal(instantMatch.scheduledAt, "즉시");

  const scheduledMatch = fromRemoteMatch({
    id: "match-scheduled",
    scheduled_date: "2026-07-29",
    scheduled_time: "21:15:00",
    rules: {},
  }, makeMatchContext());
  assert.equal(scheduledMatch.timingType, "scheduled");
  assert.equal(scheduledMatch.scheduledAt, "2026-07-29 21:15");
  assert.equal(scheduledMatch.scheduledDate, "2026-07-29");
  assert.equal(scheduledMatch.scheduledTime, "21:15");

  const instantRoom = fromRemoteRecruitingPost({
    id: "room-instant",
    scheduled_at: "즉시",
    room_state: {},
  });
  assert.equal(instantRoom.timingType, "instant");
  assert.equal(instantRoom.scheduledAt, "즉시");

  const missingRoom = fromRemoteRecruitingPost({
    id: "room-missing",
    room_state: {},
  });
  assert.equal(missingRoom.timingType, "scheduled");
  assert.equal(missingRoom.scheduledAt, "일정 미정");
});

test("date-time join has one shared implementation and server no longer reaches into client schedule utilities", async () => {
  const [
    rowUtilsSource,
    matchMappersSource,
    recruitingMappersSource,
    supabaseAdminSource,
    matchSyncSource,
    recruitingSyncSource,
  ] = await Promise.all([
    readFile(new URL("../shared/lib/rowUtils.js", import.meta.url), "utf8"),
    readFile(new URL("../shared/lib/matchMappers.js", import.meta.url), "utf8"),
    readFile(new URL("../shared/lib/recruitingMappers.js", import.meta.url), "utf8"),
    readFile(new URL("../server/api/_supabaseAdmin.js", import.meta.url), "utf8"),
    readFile(new URL("../server/api/matches/sync-match.js", import.meta.url), "utf8"),
    readFile(new URL("../server/api/recruiting/sync-post.js", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(rowUtilsSource, /function toDateTime\(/);
  assert.doesNotMatch(matchMappersSource, /function toDateTime\(/);
  assert.doesNotMatch(recruitingMappersSource, /function defaultToDateTime\(/);
  assert.doesNotMatch(supabaseAdminSource, /from "\.\.\/\.\.\/src\/data\/scheduleUtils\.js"/);
  assert.match(supabaseAdminSource, /toSharedDateTime\(date, time, fallback, "\\uBBF8\\uC815"\)/);
  assert.doesNotMatch(matchSyncSource, /src\/data\/scheduleUtils\.js/);
  assert.doesNotMatch(recruitingSyncSource, /src\/data\/scheduleUtils\.js/);
});
