import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  BASKETBALL_POSITIONS,
  DEFAULT_PLAYER_RATINGS,
  DEFAULT_RATING,
  MATCH_SIDES,
  getModeSize,
  isRefereeGrade,
} from "../src/lib/constants.js";
import { getDbScheduleParts } from "../src/data/scheduleUtils.js";
import {
  ROOM_CHAT_CLIENT_CACHE_LIMIT,
  ROOM_CHAT_HISTORY_LIMIT,
  ROOM_CHAT_MESSAGE_MAX_LENGTH,
  clampRoomChatHistoryLimit,
  fromRoomChatMessageRow,
  normalizeRoomChatBody,
  sanitizeRoomChatBody,
} from "../src/lib/roomChat.js";
import {
  getDiscordCdnAvatarUrl,
  getDiscordInviteCustomId,
  isDiscordSnowflake,
} from "../src/lib/discordProtocol.js";
import { getEmblemUploadWarning, isEmblemHexColor } from "../src/lib/emblemPolicy.js";
import {
  TEAM_EMBLEM_ABBREVIATION_MAX_CHARACTERS,
  getTeamEmblemAbbreviationCharacterCount,
  getTeamEmblemTextLines,
  isTeamEmblemAbbreviation,
  isTeamEmblemAbbreviationDraftWithinLimits,
  isTeamEmblemFont,
  isTeamEmblemTextMode,
  normalizeTeamEmblemAbbreviation,
  normalizeTeamEmblemTextMode,
} from "../src/lib/teamEmblem.js";
import {
  MATCH_CANCEL_NOTICE_PREFIXES,
  MATCH_POSTGAME_NOTICE_PREFIXES,
  MATCH_SCHEDULED_NOTICE_PREFIXES,
  getNotificationTargetPath,
  isTerminalMatchStatus,
  isTerminalRecruitingStatus,
} from "../src/lib/notifications.js";
import {
  compareMatchRecency,
  getMatchSideResult,
  getPlayerMatchResult,
  isMatchWithinRecordDetailWindow,
} from "../src/lib/matchUtils.js";
import {
  decodeBase64Image,
  readWebpDimensions,
  validateWebpImage,
} from "../server/api/_r2ImageStorage.js";

const root = new URL("../", import.meta.url);
const readSource = (path) => readFile(new URL(path, root), "utf8");

test("core match policy has one canonical default", () => {
  assert.deepEqual(MATCH_SIDES, ["teamA", "teamB"]);
  assert.deepEqual(BASKETBALL_POSITIONS, ["PG", "SG", "SF", "PF", "C"]);
  assert.equal(DEFAULT_RATING, 1200);
  assert.equal(DEFAULT_PLAYER_RATINGS.integrated, DEFAULT_RATING);
  assert.deepEqual(DEFAULT_PLAYER_RATINGS.modes, {
    "1v1": DEFAULT_RATING,
    "2v2": DEFAULT_RATING,
    "3v3": DEFAULT_RATING,
    "5v5": DEFAULT_RATING,
  });
  assert.equal(getModeSize("4v4"), 4);
  assert.equal(getModeSize("unknown", 3), 3);
  assert.ok(isRefereeGrade("official"));
  assert.equal(isRefereeGrade("admin"), false);
});

test("schedule policy normalizes client and database field names", () => {
  const expected = {
    timingType: "scheduled",
    scheduledDate: "2026-07-22",
    scheduledTime: "19:30",
    scheduledAt: "2026-07-22 19:30",
  };
  assert.deepEqual(getDbScheduleParts({ scheduledAt: "2026-07-22 19:30" }), expected);
  assert.deepEqual(getDbScheduleParts({ scheduled_at: "2026-07-22 19:30" }), expected);
  assert.deepEqual(getDbScheduleParts({ room_state: { timingType: "instant" } }), {
    timingType: "instant",
    scheduledDate: null,
    scheduledTime: null,
    scheduledAt: null,
  });
});

test("room chat limits and row mapping stay shared", () => {
  assert.equal(ROOM_CHAT_MESSAGE_MAX_LENGTH, 60);
  assert.equal(ROOM_CHAT_HISTORY_LIMIT, 30);
  assert.equal(ROOM_CHAT_CLIENT_CACHE_LIMIT, 50);
  assert.equal(normalizeRoomChatBody(" \u0000hello "), "hello");
  assert.equal(sanitizeRoomChatBody("x".repeat(80)).length, ROOM_CHAT_MESSAGE_MAX_LENGTH);
  assert.equal(clampRoomChatHistoryLimit(999), ROOM_CHAT_HISTORY_LIMIT);
  assert.deepEqual(fromRoomChatMessageRow({
    id: "message-1",
    message_seq: 7,
    user_id: "player-1",
    body: "hello",
    created_at: "2026-07-21T00:00:00.000Z",
  }), {
    id: "message-1",
    messageSeq: 7,
    userId: "player-1",
    body: "hello",
    createdAt: "2026-07-21T00:00:00.000Z",
  });
});

test("Discord protocol identifiers and URLs stay canonical", () => {
  assert.ok(isDiscordSnowflake("12345678901234567"));
  assert.equal(isDiscordSnowflake("1234"), false);
  assert.equal(
    getDiscordInviteCustomId("accept", "post/a", "invite:b"),
    "rankball:invite:accept:post%2Fa:invite%3Ab",
  );
  assert.equal(
    getDiscordCdnAvatarUrl({ id: "12345678901234567", discriminator: "2" }),
    "https://cdn.discordapp.com/embed/avatars/2.png",
  );
});

test("emblem validators share frontend and server allowlists", () => {
  assert.ok(isEmblemHexColor("#58d2c0"));
  assert.equal(isEmblemHexColor("58d2c0"), false);
  assert.ok(isTeamEmblemTextMode("abbreviation"));
  assert.equal(normalizeTeamEmblemTextMode("invalid"), "initial");
  assert.ok(isTeamEmblemFont("sport"));
  assert.equal(isTeamEmblemFont("script"), false);
  assert.equal(TEAM_EMBLEM_ABBREVIATION_MAX_CHARACTERS, 4);
  assert.equal(normalizeTeamEmblemAbbreviation("  RB  \r\n BC  "), "RB\nBC");
  assert.equal(getTeamEmblemAbbreviationCharacterCount("R B\nC D"), 4);
  assert.ok(isTeamEmblemAbbreviation("RB\nBC"));
  assert.equal(isTeamEmblemAbbreviation(" \n "), false);
  assert.equal(isTeamEmblemAbbreviation("ABCDE"), false);
  assert.equal(isTeamEmblemAbbreviation("A\nB\nC"), false);
  assert.ok(isTeamEmblemAbbreviationDraftWithinLimits("A B\nCD"));
  assert.equal(isTeamEmblemAbbreviationDraftWithinLimits("A\nB\nC"), false);
  assert.deepEqual(getTeamEmblemTextLines({ emblemTextMode: "abbreviation", emblemAbbreviation: "RB\nBC" }), ["RB", "BC"]);
  assert.equal(
    getEmblemUploadWarning(3, "2026-07-21T00:00:00.000Z"),
    "(처음 한번) 사진을 업로드한 뒤 한 번까지는 바로 변경할 수 있으며, 그 이후에는 마지막 업로드일로부터 30일 뒤에 변경할 수 있습니다.",
  );
});

test("team emblem border controls stay common to initial and uploaded sources", async () => {
  const teamDetail = await readSource("src/pages/TeamDetail.jsx");
  const initialControlsStart = teamDetail.indexOf('{emblemSource === "initial" ? (');
  const initialControlsEnd = teamDetail.indexOf(") : null}", initialControlsStart);
  const borderControlsStart = teamDetail.indexOf("team-emblem-style-controls", initialControlsStart);
  assert.ok(initialControlsStart >= 0);
  assert.ok(initialControlsEnd > initialControlsStart);
  assert.ok(borderControlsStart > initialControlsEnd);
  assert.match(teamDetail.slice(borderControlsStart), /테두리 사용/);
  assert.match(teamDetail.slice(borderControlsStart), /테두리 색/);
});

test("notification status and delivery prefix policies stay aligned", () => {
  assert.ok(isTerminalMatchStatus("VOIDED"));
  assert.ok(isTerminalRecruitingStatus("expired"));
  assert.equal(isTerminalMatchStatus("confirmed"), false);
  MATCH_SCHEDULED_NOTICE_PREFIXES.forEach((prefix) => assert.ok(MATCH_CANCEL_NOTICE_PREFIXES.includes(prefix)));
  MATCH_POSTGAME_NOTICE_PREFIXES.forEach((prefix) => assert.ok(MATCH_CANCEL_NOTICE_PREFIXES.includes(prefix)));
  assert.equal(getNotificationTargetPath({ tournamentId: "t 1" }), "/app/tournaments/t%201");
  assert.equal(getNotificationTargetPath({ matchId: "m/1" }), "/app/matches?match=m%2F1");
});

test("profile record result and recency helpers preserve match semantics", () => {
  const older = { scheduledAt: "2026-07-20T10:00:00.000Z" };
  const newer = { scheduledAt: "2026-07-21T10:00:00.000Z" };
  const match = {
    scheduledAt: "2026-07-20T10:00:00.000Z",
    teamA: { players: ["player-a"] },
    teamB: { players: ["player-b"] },
    result: { scoreA: 21, scoreB: 18 },
  };
  assert.ok(compareMatchRecency(newer, older) < 0);
  assert.equal(getMatchSideResult(match, "teamA"), "W");
  assert.equal(getPlayerMatchResult(match, "player-b"), "L");
  assert.equal(getPlayerMatchResult(match, "unknown"), "D");
  assert.ok(isMatchWithinRecordDetailWindow(match, 6, new Date("2026-07-21T00:00:00.000Z")));
});

test("R2 image payload and WebP validation share one implementation", () => {
  const bytes = Buffer.alloc(30);
  bytes.write("RIFF", 0, "ascii");
  bytes.write("WEBP", 8, "ascii");
  bytes.write("VP8X", 12, "ascii");
  bytes.writeUIntLE(319, 24, 3);
  bytes.writeUIntLE(199, 27, 3);
  const decoded = decodeBase64Image(bytes.toString("base64"), { maxBytes: 1024, errorPrefix: "test_image" });
  assert.deepEqual(readWebpDimensions(decoded), { width: 320, height: 200 });
  assert.deepEqual(validateWebpImage(decoded, { maxDimension: 320 }), { width: 320, height: 200 });
  assert.throws(
    () => decodeBase64Image("not-base64", { maxBytes: 1024, errorPrefix: "test_image" }),
    /test_image_invalid_payload/,
  );
});

test("core consumers do not restore duplicated policy literals", async () => {
  const [repository, matchUtils, recruitingPage, matchSync, recruitingSync, profileEmblem, teamEmblem, discordBridge] = await Promise.all([
    readSource("src/data/repository.js"),
    readSource("src/lib/matchUtils.js"),
    readSource("src/pages/Recruiting.jsx"),
    readSource("server/api/matches/sync-match.js"),
    readSource("server/api/recruiting/sync-post.js"),
    readSource("server/api/profile/emblem.js"),
    readSource("server/api/teams/emblem.js"),
    readSource("server/api/discord/_roomChatBridge.js"),
  ]);
  const matchConsumers = [repository, matchUtils, recruitingPage, matchSync, recruitingSync].join("\n");
  assert.doesNotMatch(matchConsumers, /\["teamA",\s*"teamB"\]/);
  assert.doesNotMatch(matchConsumers, /\?\?\s*1200/);
  assert.doesNotMatch(`${profileEmblem}\n${teamEmblem}`, /api\.cloudflare\.com\/client\/v4\/accounts/);
  assert.doesNotMatch(`${profileEmblem}\n${teamEmblem}`, /function readWebpDimensions/);
  assert.doesNotMatch(discordBridge, /https:\/\/discord\.com\/api\/v10/);
  assert.doesNotMatch(discordBridge, /\^\\d\{17,20\}\$/);
});
