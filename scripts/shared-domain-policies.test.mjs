import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
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
import { REGION_TREE, inferRegionSelection } from "../src/lib/profileSetup.js";
import {
  AFFILIATION_CHANGE_COOLDOWN_DAYS,
  AFFILIATION_TYPE,
  canChangeAffiliation,
  getAffiliationNormalizedKey,
  getNextAffiliationChangeDate,
  normalizeAffiliationName,
} from "../src/lib/affiliations.js";
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
  getCourtAccessLabel,
  getCourtHoopCount,
  getCourtKindLabel,
  getCourtMapUrl,
  getNearbyCourtCandidates,
  getCourtPaidLabel,
  getCourtPickerResults,
  getCourtReservationValue,
  getCourtSearchText,
  mergeCourtSearchCourts,
  normalizeCourtOptionalBoolean,
  normalizeCourtSourceUrl,
  normalizeCourtType,
} from "../src/lib/courts.js";
import { selectNaverPlaceCandidates, selectNearbyCourtCandidates } from "../server/api/courts/place-search.js";
import {
  UNSAFE_INPUT_ERROR_CODE,
  assertSafeInputPayload,
  getSafeImageUrl,
  getUnsafeUserTextReason,
} from "../src/lib/inputSecurity.js";
import {
  decodeBase64Image,
  readWebpDimensions,
  validateWebpImage,
} from "../server/api/_r2ImageStorage.js";
import { readJsonBody } from "../server/api/_supabaseAdmin.js";
import { getRecruitingListCardLobby, isPaidRecruitingCourt } from "../src/lib/recruiting.js";
import { mergeRecruitingPostsById } from "../src/hooks/useAppData.js";
import { getPlayerSeasonActivity } from "../src/lib/season.js";
import { fromRemoteProfile } from "../src/data/profileMappers.js";
import { IMAGE_CONTEXT_MENU_ALLOW_ATTRIBUTE, getProtectedImageTarget } from "../src/hooks/useImageInteractionGuard.js";

const root = new URL("../", import.meta.url);
const readSource = (path) => readFile(new URL(path, root), "utf8");

async function readSourceTree(relativeDirectory) {
  const sources = [];
  const walk = async (directoryUrl) => {
    const entries = await readdir(directoryUrl, { withFileTypes: true });
    await Promise.all(entries.map(async (entry) => {
      const entryUrl = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directoryUrl);
      if (entry.isDirectory()) {
        await walk(entryUrl);
      } else if (/\.(?:js|jsx|mjs)$/i.test(entry.name)) {
        sources.push(await readFile(entryUrl, "utf8"));
      }
    }));
  };
  await walk(new URL(`${relativeDirectory.replace(/\/?$/, "/")}`, root));
  return sources.join("\n");
}

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

test("team roster summons are atomic and resolve actionable invitations", async () => {
  const migrationSource = await readSource("supabase/migrations/20260721170000_team_roster_summon_atomic.sql");
  assert.match(migrationSource, /directTeamRosterSummon/);
  assert.match(migrationSource, /#variable_conflict use_variable/);
  assert.match(migrationSource, /setRecruitingTeamPartyRoster/);
  assert.match(migrationSource, /recruiting_party_leader_required/);
  assert.match(migrationSource, /actionRequired', false/);
  assert.match(migrationSource, /read_at = coalesce\(notification\.read_at, now_at\)/);
  assert.match(migrationSource, /rankball_refresh_recruiting_feed_for_post\(safe_post_id\)/);
  assert.doesNotMatch(migrationSource, /delete from public\.notifications/i);
});

test("recruiting schedule cards keep fresh list counts over cached detail rows", () => {
  const existing = {
    id: "room-full-team-match",
    mode: "5v5",
    sideCapacity: 5,
    playerId: "host-player",
    playerIds: ["host-player"],
    applicants: [{
      kind: "team",
      teamId: "guest-team",
      playerId: "guest-captain",
      playerIds: ["guest-captain", "guest-player"],
      side: "teamB",
      status: "ready",
    }],
    __feedRelations: ["participant"],
    updatedAt: "2026-07-21T06:40:00.000Z",
  };
  const listCounts = {
    teamA: { filled: 5, projectedFilled: 5, confirmationProjectedFilled: 5, capacity: 5 },
    teamB: { filled: 5, projectedFilled: 5, confirmationProjectedFilled: 5, capacity: 5 },
  };
  const incoming = {
    id: existing.id,
    listCardOnly: true,
    listCounts,
    __feedRelations: ["team"],
    updatedAt: "2026-07-21T06:30:00.000Z",
  };

  const [merged] = mergeRecruitingPostsById([existing], [incoming]);
  const lobby = getRecruitingListCardLobby(merged, {});

  assert.equal(merged.listCardOnly, undefined);
  assert.deepEqual(merged.playerIds, existing.playerIds);
  assert.deepEqual(merged.applicants, existing.applicants);
  assert.deepEqual(merged.__feedRelations, ["participant", "team"]);
  assert.equal(lobby.sides.teamA.filled, 5);
  assert.equal(lobby.sides.teamB.filled, 5);
  assert.equal(lobby.sides.teamA.capacity, 5);
  assert.equal(lobby.sides.teamB.capacity, 5);
});

test("paid recruiting courts require explicit fee evidence", () => {
  assert.equal(isPaidRecruitingCourt({ courtPaid: true }), true);
  assert.equal(isPaidRecruitingCourt({}, { paid: true }), true);
  assert.equal(isPaidRecruitingCourt({ courtFee: "12,000원" }, { paid: false }), true);
  assert.equal(isPaidRecruitingCourt({ courtFee: "무료" }), false);
  assert.equal(isPaidRecruitingCourt({ courtPaid: false }), false);
  assert.equal(isPaidRecruitingCourt({}, { paid: null }), false);
});

test("region selectors preserve the current government code order", () => {
  assert.deepEqual(REGION_TREE.map((item) => item.sido), [
    "서울특별시",
    "전남광주통합특별시",
    "부산광역시",
    "대구광역시",
    "인천광역시",
    "대전광역시",
    "울산광역시",
    "세종특별자치시",
    "경기도",
    "충청북도",
    "충청남도",
    "경상북도",
    "경상남도",
    "제주특별자치도",
    "강원특별자치도",
    "전북특별자치도",
  ]);
  assert.deepEqual(REGION_TREE[0].districts.slice(0, 5), ["종로구", "중구", "용산구", "성동구", "광진구"]);
  assert.deepEqual(REGION_TREE[4].districts, ["제물포구", "영종구", "미추홀구", "연수구", "남동구", "부평구", "계양구", "서해구", "검단구", "강화군", "옹진군"]);
  assert.deepEqual(inferRegionSelection("광주광역시 광산구"), { sido: "전남광주통합특별시", district: "광산구" });
});

test("optional affiliation names and 30-day changes use one shared policy", () => {
  assert.equal(AFFILIATION_TYPE, "organization");
  assert.equal(AFFILIATION_CHANGE_COOLDOWN_DAYS, 30);
  assert.equal(normalizeAffiliationName("  서울\u0000   대학교  "), "서울 대학교");
  assert.equal(normalizeAffiliationName("ＡＢＣ"), "ABC");
  assert.equal(getAffiliationNormalizedKey("서울 대"), getAffiliationNormalizedKey("서울대"));
  assert.notEqual(getAffiliationNormalizedKey("서울대"), getAffiliationNormalizedKey("서울대학교"));
  const user = { affiliationUpdatedAt: "2026-07-01T00:00:00.000Z" };
  assert.equal(getNextAffiliationChangeDate(user).toISOString(), "2026-07-31T00:00:00.000Z");
  assert.equal(canChangeAffiliation(user, new Date("2026-07-30T23:59:59.999Z")), false);
  assert.equal(canChangeAffiliation(user, new Date("2026-07-31T00:00:00.000Z")), true);
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

test("profile icon background choice and image preview stay persistent and separate", async () => {
  assert.equal(fromRemoteProfile({ id: "profile-1", name: "선수", avatar_background_enabled: false }).avatarBackgroundEnabled, false);
  assert.equal(fromRemoteProfile({ id: "profile-2", name: "선수" }).avatarBackgroundEnabled, true);

  const [dialog, emblem, api, columns, migration, styles] = await Promise.all([
    readSource("src/components/profile/ProfileIconDialog.jsx"),
    readSource("src/components/profile/ProfileEmblem.jsx"),
    readSource("server/api/profile/emblem.js"),
    readSource("src/data/repositoryColumns.js"),
    readSource("supabase/migrations/20260721190000_profile_icon_background_toggle.sql"),
    readSource("src/styles/globals.css"),
  ]);
  assert.match(dialog, /avatarBackgroundEnabled/);
  assert.match(dialog, /profile-icon-preview-dialog/);
  assert.match(dialog, /setPreviewIcon\(icon\)/);
  assert.match(dialog, /배경색 사용/);
  assert.match(emblem, /no-avatar-background/);
  assert.match(api, /p_background_enabled/);
  assert.match(columns, /avatar_background_enabled/);
  assert.match(migration, /add column if not exists avatar_background_enabled boolean not null default true/);
  assert.match(migration, /'avatarBackgroundEnabled', current_profile\.avatar_background_enabled/);
  assert.match(styles, /cursor: zoom-in/);
});

test("image native menus and drag stay blocked by one shared guard", async () => {
  const protectedImage = { getAttribute: () => null };
  const allowedImage = {
    getAttribute: (name) => (name === IMAGE_CONTEXT_MENU_ALLOW_ATTRIBUTE ? "true" : null),
  };

  assert.equal(getProtectedImageTarget({ closest: () => protectedImage }), protectedImage);
  assert.equal(getProtectedImageTarget({ closest: () => allowedImage }), null);
  assert.equal(getProtectedImageTarget({ closest: () => null }), null);

  const [app, guard, styles] = await Promise.all([
    readSource("src/App.jsx"),
    readSource("src/hooks/useImageInteractionGuard.js"),
    readSource("src/styles/globals.css"),
  ]);
  assert.match(app, /useImageInteractionGuard\(\)/);
  assert.match(guard, /addEventListener\("contextmenu", preventImageNativeAction, true\)/);
  assert.match(guard, /addEventListener\("dragstart", preventImageNativeAction, true\)/);
  assert.match(styles, /data-allow-image-context-menu="true"/);
});

test("sidebar account card uses the shared profile emblem", async () => {
  const sidebar = await readSource("src/components/layout/Sidebar.jsx");
  assert.match(sidebar, /import ProfileEmblem from "\.\.\/profile\/ProfileEmblem\.jsx"/);
  assert.match(sidebar, /<ProfileEmblem user=\{safeUser\} \/>/);
  assert.doesNotMatch(sidebar, /getDiscordAvatarClassName|getDiscordAvatarStyle/);
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

test("primary match pages share one empty state component", async () => {
  const [emptyState, recruiting, matches, recorder] = await Promise.all([
    readSource("src/components/common/EmptyState.jsx"),
    readSource("src/pages/Recruiting.jsx"),
    readSource("src/pages/Matches.jsx"),
    readSource("src/pages/Recorder.jsx"),
  ]);
  assert.match(emptyState, /export default function EmptyState/);
  [recruiting, matches, recorder].forEach((source) => assert.match(source, /import EmptyState/));
  assert.doesNotMatch(`${recruiting}\n${matches}\n${recorder}`, /arena-empty-state|om-empty-state|recorder-empty/);
});

test("empty home upcoming card does not keep the desktop match minimum height", async () => {
  const [home, styles] = await Promise.all([
    readSource("src/pages/Home.jsx"),
    readSource("src/styles/globals.css"),
  ]);
  assert.match(home, /home-upcoming-card\$\{upcomingItems\.length \? "" : " is-empty"\}/);
  assert.match(styles, /\.rank-home \.home-upcoming-card\.is-empty\s*\{\s*min-height:\s*auto;/);
});

test("team ranking starts from the full bounded directory", async () => {
  const teams = await readSource("src/pages/Teams.jsx");
  assert.match(teams, /const \[region, setRegion\] = useState\("전체"\);/);
  assert.doesNotMatch(teams, /팀 탐색/);
});

test("season hub is player-centered while regional MMR stays separate", async () => {
  const season = { startsAt: "2026-07-01", endsAt: "2026-07-31" };
  const confirmed = (id, mode, ranked, official = false, scheduledDate = "2026-07-20") => ({
    id,
    mode,
    ranked,
    official,
    scheduledDate,
    status: "confirmed",
    result: { scoreA: 21, scoreB: 18 },
    teamA: { players: ["player-49"] },
    teamB: { players: ["opponent"] },
  });
  const activity = getPlayerSeasonActivity([
    confirmed("m1", "3v3", true, true),
    confirmed("m2", "5v5", false),
    confirmed("m3", "3v3", true),
    confirmed("old", "1v1", true, false, "2026-06-20"),
    { ...confirmed("pending", "2v2", true), status: "approval" },
  ], "player-49", season);
  assert.deepEqual(activity.modes, { "1v1": 0, "2v2": 0, "3v3": 2, "4v4": 0, "5v5": 1 });
  assert.equal(activity.total, 3);
  assert.equal(activity.primaryMode, "3v3");
  assert.equal(activity.ranked, 2);
  assert.equal(activity.friendly, 1);
  assert.equal(activity.official, 1);

  const [seasonPage, rankingsPage, styles] = await Promise.all([
    readSource("src/pages/Season.jsx"),
    readSource("src/pages/Rankings.jsx"),
    readSource("src/styles/globals.css"),
  ]);
  assert.match(seasonPage, /getPlayerSeasonRows\(app\.state\.users, app\.state\.matches, season, "전체"\)/);
  assert.match(seasonPage, /전국 개인 승격권/);
  assert.match(seasonPage, /이번 시즌 플레이/);
  assert.doesNotMatch(seasonPage, /운영 체크|처리할 경기|getOperationsSummary|MatchRoomModal/);
  assert.match(rankingsPage, /\{ id: "region", label: "지역" \}/);
  assert.match(rankingsPage, /useState\("integrated"\)/);
  assert.match(styles, /\.season-race-list > \.player-hover-trigger/);
});

test("user input rejects executable markup without blocking ordinary chat", async () => {
  assert.equal(getUnsafeUserTextReason("오늘 3점 5개! <3 🏀"), "");
  assert.equal(getUnsafeUserTextReason("A팀 21 : 18 B팀"), "");
  [
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    "javascript:alert(1)",
    "data:text/html,<svg onload=alert(1)>",
    "&lt;iframe srcdoc=alert(1)&gt;",
    "background:url(javascript:alert(1))",
  ].forEach((value) => assert.ok(getUnsafeUserTextReason(value)));
  assert.throws(
    () => assertSafeInputPayload({ operation: { body: "<svg onload=alert(1)>" } }),
    (error) => error.code === UNSAFE_INPUT_ERROR_CODE && error.statusCode === 400,
  );
  assert.equal(getSafeImageUrl("javascript:alert(1)"), "");
  assert.equal(getSafeImageUrl("data:text/html,alert(1)"), "");
  assert.equal(getSafeImageUrl("/assets/profile-icons/01-first-bucket.png"), "/assets/profile-icons/01-first-bucket.png");
  assert.equal(getSafeImageUrl("https://cdn.discordapp.com/avatar.png"), "https://cdn.discordapp.com/avatar.png");
  assert.deepEqual(
    await readJsonBody({ body: { operation: { body: "오늘 3점 5개! <3 🏀" } } }),
    { operation: { body: "오늘 3점 5개! <3 🏀" } },
  );
  await assert.rejects(
    readJsonBody({ body: { operation: { body: "<svg onload=alert(1)>" } } }),
    (error) => error.code === UNSAFE_INPUT_ERROR_CODE && error.statusCode === 400,
  );
});

test("server and browser keep untrusted text out of executable sinks", async () => {
  const [apiIndex, supabaseAdmin, serverActions, recruiting, vercelConfig, sourceTree] = await Promise.all([
    readSource("api/index.js"),
    readSource("server/api/_supabaseAdmin.js"),
    readSource("src/lib/serverActions.js"),
    readSource("src/pages/Recruiting.jsx"),
    readSource("vercel.json"),
    readSourceTree("src"),
  ]);
  assert.match(apiIndex, /assertSafeInputPayload\(request\.query/);
  assert.match(supabaseAdmin, /validateJsonBody/);
  assert.match(serverActions, /assertSafeInputPayload\(payload/);
  assert.match(recruiting, /UNSAFE_INPUT_MESSAGE/);
  assert.doesNotMatch(sourceTree, /dangerouslySetInnerHTML|\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write\s*\(|\beval\s*\(|new Function\s*\(/);
  const securityHeaders = JSON.parse(vercelConfig).headers[0].headers;
  const csp = securityHeaders.find((header) => header.key === "Content-Security-Policy")?.value ?? "";
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-(?:inline|eval)'/);
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

test("court map URLs pin stored coordinates and search by address only", () => {
  const pinnedUrl = new URL(getCourtMapUrl({
    name: "연북중학교 농구장",
    roadAddress: "서울특별시 마포구 연남로 80",
    lat: 37.56321,
    lng: 126.92234,
  }));
  assert.equal(pinnedUrl.origin, "https://map.naver.com");
  assert.equal(pinnedUrl.pathname, "/");
  assert.equal(pinnedUrl.searchParams.get("lat"), "37.56321");
  assert.equal(pinnedUrl.searchParams.get("lng"), "126.92234");
  assert.equal(pinnedUrl.searchParams.get("title"), "서울특별시 마포구 연남로 80");
  assert.equal(pinnedUrl.searchParams.get("title").includes("연북중학교"), false);
  assert.equal(
    getCourtMapUrl({ name: "연북중학교 농구장", addressText: "서울특별시 마포구 연남로 80" }),
    `https://map.naver.com/p/search/${encodeURIComponent("서울특별시 마포구 연남로 80")}`,
  );
});

test("court request attributes preserve unknown values instead of inventing facts", () => {
  assert.equal(normalizeCourtType(""), "확인 필요");
  assert.equal(normalizeCourtType("indoor"), "실내");
  assert.equal(normalizeCourtOptionalBoolean(undefined), null);
  assert.equal(normalizeCourtOptionalBoolean(false), false);
  assert.equal(getCourtKindLabel({ courtKind: "unknown" }), "확인 필요");
  assert.equal(getCourtAccessLabel({ accessType: "unknown" }), "확인 필요");
  assert.equal(getCourtPaidLabel({ paid: null }), "비용 확인 필요");
  assert.equal(getCourtReservationValue({ accessType: "reservation" }), true);
  assert.equal(getCourtReservationValue({ accessType: "restricted" }), null);
  assert.equal(getCourtHoopCount({ courtLayout: "unknown" }), null);
  assert.equal(getCourtHoopCount({ courtLayout: "full" }), 2);
  assert.equal(normalizeCourtSourceUrl("javascript:alert(1)"), "");
  assert.equal(normalizeCourtSourceUrl("https://example.com/reserve"), "https://example.com/reserve");
});

test("court identity and paid-room UI stay shared across list surfaces", async () => {
  const [homeSource, hoverSource, recruitingSource, matchesSource, matchListSource, recruitingListSource] = await Promise.all([
    readSource("src/pages/Home.jsx"),
    readSource("src/components/court/CourtHoverCard.jsx"),
    readSource("src/pages/Recruiting.jsx"),
    readSource("src/pages/Matches.jsx"),
    readSource("src/components/match/MatchListCard.jsx"),
    readSource("server/api/recruiting/list.js"),
  ]);

  assert.match(homeSource, /<CourtIdentityIcon compact \/>/);
  assert.match(hoverSource, /export function CourtIdentityIcon/);
  assert.match(hoverSource, /<CourtIdentityIcon \/>/);
  assert.doesNotMatch(homeSource, /court-mini-dot/);
  assert.match(recruitingSource, /유료 구장입니다\./);
  assert.match(recruitingSource, /isPaidRecruitingCourt\(post, postCourt\)/);
  assert.match(matchesSource, /isPaidRecruitingCourt\(post, postCourt\)/);
  assert.match(matchListSource, /if \(tone\) return normalizeMatchListTone/);
  assert.match(recruitingListSource, /paid:payload->paid/);
  assert.match(recruitingListSource, /courtFee: post\.courtFee/);
});

test("court place search keeps parent facilities at the pinned address", () => {
  const candidates = selectNaverPlaceCandidates([
    {
      title: "<b>망원한강공원</b>",
      category: "여행,명소>도시근린공원",
      address: "서울특별시 마포구 망원동 205-4",
      roadAddress: "서울특별시 마포구 마포나루길 467",
      mapx: "1269000000",
      mapy: "375000000",
    },
    {
      title: "망원편의점",
      category: "생활,편의>편의점",
      address: "서울특별시 마포구 망원동 205-4",
      roadAddress: "서울특별시 마포구 마포나루길 467",
      mapx: "1269000100",
      mapy: "375000100",
    },
    {
      title: "먼공원",
      category: "여행,명소>공원",
      address: "서울특별시 마포구 다른동 1",
      roadAddress: "서울특별시 마포구 다른로 1",
      mapx: "1269100000",
      mapy: "375100000",
    },
  ], {
    addressText: "서울특별시 마포구 마포나루길 467",
    roadAddress: "서울특별시 마포구 마포나루길 467",
    jibunAddress: "서울특별시 마포구 망원동 205-4",
    lat: 37.5,
    lng: 126.9,
  });

  assert.deepEqual(candidates.map((candidate) => candidate.name), ["망원한강공원"]);
  assert.equal(candidates[0].sameAddress, true);
  assert.equal(candidates[0].distanceMeters, 0);
});

test("nearby court review lists approved and pending courts by distance", () => {
  const nearby = getNearbyCourtCandidates({ lat: 1, lng: 1, addressText: "테스트시 테스트구 테스트로 1" }, {
    settings: {
      approvedCourts: [
        { id: "approved-near", name: "근처 등록 구장", lat: 1.0005, lng: 1, addressText: "테스트시 테스트구 테스트로 2" },
        { id: "approved-far", name: "먼 등록 구장", lat: 1.02, lng: 1, addressText: "테스트시 테스트구 테스트로 200" },
      ],
      courtRequests: [
        { id: "request-near", status: "pending", name: "근처 검토 구장", lat: 1.0001, lng: 1, addressText: "테스트시 테스트구 테스트로 3" },
        { id: "request-rejected", status: "rejected", name: "반려 구장", lat: 1.0002, lng: 1, addressText: "테스트시 테스트구 테스트로 4" },
      ],
    },
  }, { maxDistanceMeters: 500, limit: 5 });

  assert.deepEqual(nearby.map((candidate) => candidate.court.id), ["request-near", "approved-near"]);
  assert.equal(nearby[0].type, "request");
  assert.equal(nearby[0].sameLocation, true);
  assert.ok(nearby[1].distanceMeters > 35 && nearby[1].distanceMeters < 500);
});

test("server nearby court results expose only duplicate review fields", () => {
  const nearby = selectNearbyCourtCandidates([
    {
      type: "request",
      court: {
        id: "request-near",
        name: "검토 중 구장",
        address_text: "테스트시 테스트구 테스트로 1",
        road_address: "테스트시 테스트구 테스트로 1",
        lat: 1.0001,
        lng: 1,
        requested_by: "private-profile",
        payload: { memo: "private" },
      },
    },
  ], {
    addressText: "테스트시 테스트구 테스트로 2",
    roadAddress: "테스트시 테스트구 테스트로 2",
    lat: 1,
    lng: 1,
  });

  assert.equal(nearby.length, 1);
  assert.deepEqual(Object.keys(nearby[0].court).sort(), ["addressText", "id", "jibunAddress", "name", "roadAddress"]);
  assert.equal(nearby[0].type, "request");
  assert.equal(nearby[0].sameLocation, true);
});

test("team and room court pickers share one single-selection search policy", async () => {
  const courts = [
    { id: "court-mapo", name: "망원한강공원 농구장", hashtag: "#10001", region: "마포", addressText: "서울특별시 마포구 마포나루길 467", type: "야외" },
    { id: "court-yeonbuk", name: "연북중학교 체육관 1F", hashtag: "#34264", region: "서대문", roadAddress: "서울특별시 서대문구 연희로 80", type: "실내" },
  ];

  assert.match(getCourtSearchText(courts[1]), /연희로 80/);
  assert.deepEqual(
    getCourtPickerResults(courts, { query: "연희로 80", region: "마포", currentRegion: "마포" }).map((court) => court.id),
    ["court-yeonbuk"],
  );
  assert.deepEqual(
    getCourtPickerResults(courts, { query: "연북중학고", region: "마포", currentRegion: "마포" }).map((court) => court.id),
    ["court-yeonbuk"],
  );
  assert.deepEqual(
    getCourtPickerResults(courts, { query: "", region: "마포", currentRegion: "마포" }).map((court) => court.id),
    ["court-mapo"],
  );
  assert.equal(mergeCourtSearchCourts(courts, [courts[1], { id: "court-remote", name: "원격 구장" }]).length, 3);

  const [teams, createMatch] = await Promise.all([
    readSource("src/pages/Teams.jsx"),
    readSource("src/pages/CreateMatch.jsx"),
  ]);
  [teams, createMatch].forEach((source) => {
    assert.match(source, /getCourtPickerResults/);
    assert.match(source, /getSearchText=\{getCourtSearchText\}/);
    assert.match(source, /mergeCourtSearchCourts/);
  });
  assert.match(teams, /setCourtQuery\(""\)/);
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
