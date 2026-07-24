import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { BRAND_NAME } from "../src/lib/brand.js";
import { getAdminStatusLabel } from "../src/lib/admin.js";
import {
  BASKETBALL_POSITIONS,
  DEFAULT_PLAYER_RATINGS,
  DEFAULT_RATING,
  MATCH_MODES,
  MATCH_SIDES,
  getTestAccountDisplayLabel,
  getModeSize,
  isRefereeGrade,
} from "../src/lib/constants.js";
import { getDbScheduleParts } from "../src/data/scheduleUtils.js";
import { fromRemoteApprovedCourt } from "../src/data/remotePayloadMappers.js";
import { toApprovedCourtRow } from "../src/data/remoteRowSerializers.js";
import { markAllNotificationsRead, rejectMatchDispute, voidMatch as applyMatchVoid } from "../src/data/repository.js";
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
  compareNotificationsNewestFirst,
  dedupeNotifications,
  getNotificationDisplayAt,
  getNotificationHref,
  getNotificationTargetPath,
  isTerminalMatchStatus,
  isTerminalRecruitingStatus,
} from "../src/lib/notifications.js";
import { toDiscordDeliveryRows, toMatchNotificationRows } from "../server/api/matches/sync-match.js";
import {
  canRequestVoidMatchRestore,
  compareMatchRecency,
  getVoidMatchRestoreTargetUserId,
  getMatchSideResult,
  getPlayerMatchResult,
  isMatchWithinRecordDetailWindow,
} from "../src/lib/matchUtils.js";
import { DEFAULT_RATING_POLICY, RATING_POLICY_MODE_IDS } from "../src/lib/ratingPolicy.js";
import { VOID_MATCH_RESTORE_REPORT_REASON } from "../src/lib/reportReasons.js";
import { PROFILE_ICON_CATALOG } from "../src/lib/profileIcons.js";
import {
  getCourtAccessLabel,
  getCourtHoopCount,
  getCourtKindLabel,
  getCourtCoordinate,
  getCourtLocationNote,
  getCourtMapUrl,
  getNearbyCourtCandidates,
  getCourtPaidLabel,
  getCourtPublicAccessLabel,
  getCourtPickerResults,
  getCourtReservationValue,
  getCourtSearchText,
  mergeCourtSearchCourts,
  normalizeCourtFacilityName,
  normalizeCourtOptionalBoolean,
  normalizeCourtPublicAccess,
  normalizeCourtSourceUrl,
  normalizeCourtType,
} from "../src/lib/courts.js";
import { selectNearbyCourtCandidates } from "../server/api/courts/place-search.js";
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
import { getRecruitingListCardCounts, getRecruitingListCardLobby, isPaidRecruitingCourt } from "../src/lib/recruiting.js";
import { mergeRecruitingPostsById } from "../src/hooks/useAppData.js";
import { getPlayerSeasonActivity } from "../src/lib/season.js";
import { fromRemoteProfile } from "../src/data/profileMappers.js";
import { IMAGE_CONTEXT_MENU_ALLOW_ATTRIBUTE, getProtectedImageTarget } from "../src/hooks/useImageInteractionGuard.js";
import { REFEREE_EXAM_VERSION } from "../src/lib/refereeExamBank.js";
import {
  REFEREE_RULEBOOK_CHECKLIST,
  REFEREE_RULEBOOK_NOTICE,
  REFEREE_RULEBOOK_SECTIONS,
  REFEREE_STAT_GUIDELINES,
} from "../src/lib/refereeRulebook.js";

const root = new URL("../", import.meta.url);
const readSource = (path) => readFile(new URL(path, root), "utf8");

const PUBLIC_COPY_SOURCE_PATHS = Object.freeze([
  "index.html",
  "src/lib/brand.js",
  "src/components/layout/Sidebar.jsx",
  "src/pages/Recruiting.jsx",
  "server/api/discord/interactions.js",
  "server/api/discord/dm-worker.js",
  "server/api/discord/_roomChatBridge.js",
]);

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

test("room modes and administrator MMR policy use the same mode keys", () => {
  const modeIds = MATCH_MODES.map((mode) => mode.id);
  assert.deepEqual(RATING_POLICY_MODE_IDS, modeIds);
  assert.deepEqual(Object.keys(DEFAULT_RATING_POLICY.playerMmr.modeScalePercent), modeIds);
  assert.deepEqual(Object.keys(DEFAULT_RATING_POLICY.playerMmr.integratedScalePercent), modeIds);
  for (const mode of MATCH_MODES) {
    assert.equal(getModeSize(mode.id), mode.size);
  }
});

test("public product copy uses the BOXTIER brand and production tone", async () => {
  assert.equal(BRAND_NAME, "BOXTIER");
  assert.equal(getTestAccountDisplayLabel("rankball-006"), "6번 계정");
  assert.equal(getTestAccountDisplayLabel("rankball-050 test"), "50번 계정");
  assert.equal(getAdminStatusLabel("approved"), "승인됨");
  assert.equal(getAdminStatusLabel("unknown_internal"), "상태 확인 중");
  assert.equal(
    getCourtLocationNote("테스트 체육관입니다. 대관 일정을 확인한다."),
    "테스트 체육관입니다. 대관 일정을 확인해 주세요.",
  );

  const sources = await Promise.all(PUBLIC_COPY_SOURCE_PATHS.map(readSource));
  const publicCopySource = sources.join("\n");
  const documentSource = sources[0];

  assert.match(documentSource, /<title>BOXTIER<\/title>/);
  assert.match(documentSource, /content="BOXTIER - [^"]+"/);
  assert.doesNotMatch(publicCopySource, /RankBall|PlatinumBall|Platinum Ball|플래티넘볼|랭크볼/);

  const refinedUiSource = await Promise.all([
    "src/hooks/useAuthSession.js",
    "src/hooks/useAppData.js",
    "src/lib/handles.js",
    "src/lib/admin.js",
    "src/lib/mockData.js",
    "src/lib/naverAddress.js",
    "src/lib/teamEmblem.js",
    "src/App.jsx",
    "src/components/layout/Sidebar.jsx",
    "src/components/match/MatchCard.jsx",
    "src/components/ranking/RankingTable.jsx",
    "src/pages/Admin.jsx",
    "src/pages/Recruiting.jsx",
    "src/pages/Matches.jsx",
    "src/pages/MatchRoom.jsx",
    "src/pages/CreateMatch.jsx",
    "src/pages/Login.jsx",
    "src/pages/PlayerDetail.jsx",
    "src/pages/Recorder.jsx",
    "src/pages/Settings.jsx",
    "src/pages/Signup.jsx",
    "src/pages/TeamDetail.jsx",
    "src/pages/Teams.jsx",
    "src/pages/TournamentDetail.jsx",
    "src/lib/constants.js",
    "server/api/matches/sync-match.js",
    "server/api/recruiting/sync-post.js",
  ].map(readSource)).then((items) => items.join("\n"));

  [
    "필터를 바꾸거나 새 매치방을 열어라.",
    "선택할 팀이 없다.",
    "서버 연결을 확인한 뒤 다시 시도한다.",
    "기록 조건이 맞았다. 내 승인만 처리하면 된다.",
    "핀은 시설 주소 기준이다.",
    "대관 일정을 확인한다.",
    "원문:",
    "테스트 계정 로그인은 VITE_DEMO_LOGIN",
    "seed auth-only",
    "Supabase Google Provider",
    "Cloudflare 업로드",
    "이유: ${errorCode}",
    "공개 모집방만 탐색하고, 개인전과 팀전은 방 생성 단계에서 나눈다.",
    "Admin Seed",
    "Google OAuth 또는 데모 계정",
    "Demo queue room opened.",
    "Demo room opened.",
    "입력해주세요",
    "열어주세요",
    "확인해주세요",
    "서버에 NAVER_MAP_CLIENT_SECRET이 없습니다.",
    "네이버 주소검색 API 호출이 실패했습니다.",
    "VITE_NAVER_MAP_CLIENT_ID가 없습니다.",
    "서버 트랜잭션",
    "저장 실패",
    "로드 실패",
    "복사 실패",
    "삭제됐거나 아직 동기화되지 않은 대회다.",
    "초대팀 주장이 모두 승인하면 자동으로 경기와 대진이 열린다.",
  ].forEach((legacyCopy) => assert.equal(refinedUiSource.includes(legacyCopy), false, legacyCopy));
  assert.doesNotMatch(refinedUiSource, /fallback\s*=\s*"rankball"|\|\|\s*"rankball"/);
  assert.doesNotMatch(refinedUiSource, /\?\?\s*(?:match|tournament|report|request|review)\.(?:status|actionType|mmrPolicy|format)/);
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

test("pickup list cards expose one participant pool instead of temporary A/B placement", () => {
  const pickupPost = {
    mode: "3v3",
    sideCapacity: 3,
    benchCapacity: 2,
    listCounts: {
      pickup: true,
      participantFilled: 4,
      participantCapacity: 10,
      teamA: { filled: 1, projectedFilled: 1, capacity: 3 },
      teamB: { filled: 3, projectedFilled: 3, capacity: 3 },
    },
  };
  const pickupLobby = getRecruitingListCardLobby(pickupPost, {});

  assert.deepEqual(getRecruitingListCardCounts(pickupPost, pickupLobby), {
    layout: "unified",
    filled: 4,
    capacity: 10,
    teamA: { filled: 1, capacity: 3 },
    teamB: { filled: 3, capacity: 3 },
  });

  const prearrangedPost = {
    ...pickupPost,
    listCounts: {
      teamA: pickupPost.listCounts.teamA,
      teamB: pickupPost.listCounts.teamB,
    },
  };
  assert.equal(
    getRecruitingListCardCounts(prearrangedPost, getRecruitingListCardLobby(prearrangedPost, {})).layout,
    "sides",
  );
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

test("profile icon picker lists owned icons only and locked achievements conceal artwork", async () => {
  const [dialog, achievements, achievementApi, styles] = await Promise.all([
    readSource("src/components/profile/ProfileIconDialog.jsx"),
    readSource("src/pages/ProfileAchievements.jsx"),
    readSource("server/api/_profileIconAchievements.js"),
    readSource("src/styles/globals.css"),
  ]);
  assert.match(dialog, /group\.icons\.filter\(\(icon\) => unlockedSet\.has\(icon\.id\)\)/);
  assert.match(dialog, /unlockedGroups\.map\(\(group\) =>/);
  assert.match(achievements, /state\?\.unlocked \? "unlocked" : "locked"/);
  assert.match(styles, /\.profile-achievement-icon\s*{[^}]*border-radius: 50%;[^}]*overflow: hidden;/s);
  assert.match(styles, /\.profile-achievement-icon\s*{[^}]*clip-path: circle\(50% at 50% 50%\)/s);
  assert.match(styles, /\.profile-achievement-icon\s*{[^}]*-webkit-mask-image: radial-gradient\(circle closest-side at center, #000 98%, transparent 100%\)/s);
  assert.match(styles, /\.profile-achievement-icon\s*{[^}]*contain: paint/s);
  assert.match(styles, /\.profile-achievement-card\.locked \.profile-achievement-icon img\s*{[^}]*filter: brightness\(0\) saturate\(0\) blur\(1\.2px\)/s);
  assert.equal(PROFILE_ICON_CATALOG.length, 340);
  assert.equal(PROFILE_ICON_CATALOG.some((icon) => icon.id.includes("four-on-four")), false);
  assert.equal(PROFILE_ICON_CATALOG.some((icon) => icon.id.startsWith("226-five-on-five-")), true);
  assert.equal(PROFILE_ICON_CATALOG.filter((icon) => /^22[1-5]-referee-exam-/.test(icon.id)).length, 5);
  assert.deepEqual(
    PROFILE_ICON_CATALOG
      .filter((icon) => /^22[1-5]-referee-exam-/.test(icon.id))
      .map((icon) => icon.achievement.requirements[0].target),
    [1, 3, 5, 10, 20],
  );
  assert.match(achievementApi, /referee_exam_attempts/);
  assert.match(achievementApi, /refereeExamCompletedCount/);
  assert.match(achievementApi, /activeUnlockedRows = \(unlockedRows \?\? \[\]\)\.filter\(\(row\) => PROFILE_ICON_ID_SET\.has\(row\.icon_key\)\)/);
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
  assert.match(csp, /script-src[^;]*https:\/\/nrbe\.pstatic\.net/);
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
  assert.equal(getNotificationHref({
    type: "match_cancelled",
    matchId: "m/1",
    targetUnavailable: true,
  }), "/app/matches?match=m%2F1");
  assert.equal(getNotificationHref({
    type: "recruiting_cancelled",
    recruitingPostId: "r/1",
    targetUnavailable: true,
  }), "/app/recruiting?post=r%2F1");
});

test("notification ordering uses due time and terminal duplicates collapse to the canonical row", () => {
  const scheduled = {
    id: "notice-scheduled",
    targetUserId: "user-1",
    type: "match_reminder",
    matchId: "match-1",
    dueAt: "2026-07-23T03:42:00.000Z",
    createdAt: "2026-07-20T00:00:00.000Z",
  };
  const immediate = {
    id: "notice-immediate",
    targetUserId: "user-1",
    type: "report",
    createdAt: "2026-07-23T03:40:00.000Z",
  };
  assert.equal(getNotificationDisplayAt(scheduled), scheduled.dueAt);
  assert.deepEqual([immediate, scheduled].sort(compareNotificationsNewestFirst).map((item) => item.id), [scheduled.id, immediate.id]);

  const legacy = {
    id: "n-legacy",
    userId: "user-1",
    title: "경기 취소",
    matchId: "match-1",
    payload: { action: "cancelMatch" },
    createdAt: "2026-07-23T03:41:59.000Z",
  };
  const canonical = {
    id: "notice-match-cancelled-match-1-user-1",
    userId: "user-1",
    targetUserId: "user-1",
    title: "경기 취소",
    type: "match_cancelled",
    matchId: "match-1",
    payload: { skipDiscordSync: true },
    createdAt: "2026-07-23T03:42:00.000Z",
  };
  assert.deepEqual(dedupeNotifications([legacy, canonical]).map((item) => item.id), [canonical.id]);
});

test("match Discord deliveries reference the same canonical app notification", () => {
  const match = {
    id: "match-1",
    title: "테스트 경기",
    mode: "1v1",
    court: "구장 미정",
    scheduledAt: "2026-07-23T12:00:00.000Z",
    teamA: { players: ["user-1"] },
    teamB: { players: ["user-2"] },
    rules: {},
  };
  const notification = { idPrefix: "match-cancelled", title: "경기 취소", intro: "경기가 취소됐습니다." };
  const appRow = toMatchNotificationRows(match, ["user-1"], notification)[0];
  const deliveryRow = toDiscordDeliveryRows(match, [{ id: "user-1", discord_user_id: "12345678901234567" }], notification)[0];

  assert.equal(deliveryRow.notification_id, appRow.id);
  assert.equal(deliveryRow.payload.notificationId, appRow.id);
  assert.equal(appRow.payload.actionRequired, false);
  assert.equal(appRow.payload.homeAction, false);
});

test("mark all notifications leaves future and other-user rows unread", () => {
  const now = Date.now();
  const state = {
    currentUserId: "user-1",
    notifications: [
      { id: "due", targetUserId: "user-1", dueAt: new Date(now - 60_000).toISOString(), readAt: null },
      { id: "future", targetUserId: "user-1", dueAt: new Date(now + 60_000).toISOString(), readAt: null },
      { id: "other", targetUserId: "user-2", dueAt: new Date(now - 60_000).toISOString(), readAt: null },
    ],
  };
  const next = markAllNotificationsRead(state);
  assert.ok(next.notifications.find((item) => item.id === "due").readAt);
  assert.equal(next.notifications.find((item) => item.id === "future").readAt, null);
  assert.equal(next.notifications.find((item) => item.id === "other").readAt, null);
});

test("notification read action and terminal trigger stay server-atomic", async () => {
  const [readApi, migration] = await Promise.all([
    readSource("server/api/notifications/read.js"),
    readSource("supabase/migrations/20260723104000_notification_consistency.sql"),
  ]);
  assert.match(readApi, /rankball_mark_notifications_read_action/);
  assert.match(migration, /rankball_mark_notifications_read_action/);
  assert.match(migration, /matches_create_terminal_notifications/);
  assert.match(migration, /notifications_suppress_legacy_match_terminal/);
  assert.match(migration, /supersededBy/);
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

test("court map URLs pin stored coordinates and fall back to address search", () => {
  assert.equal(getCourtCoordinate(null), null);
  assert.equal(getCourtCoordinate(undefined), null);
  assert.equal(getCourtCoordinate({ lat: "", lng: "" }), null);
  assert.deepEqual(getCourtCoordinate({ latitude: 37.56321, longitude: 126.92234 }), {
    lat: 37.56321,
    lng: 126.92234,
  });
  assert.deepEqual(getCourtCoordinate({ lat: "", lng: "", latitude: 37.56321, longitude: 126.92234 }), {
    lat: 37.56321,
    lng: 126.92234,
  });
  const pinnedUrl = new URL(getCourtMapUrl({
    name: "테스트 농구장",
    roadAddress: "서울특별시 중구 세종대로 110",
    lat: 37.56321,
    lng: 126.92234,
  }));
  assert.equal(pinnedUrl.origin, "https://map.naver.com");
  assert.equal(pinnedUrl.pathname, "/");
  assert.equal(pinnedUrl.searchParams.get("lat"), "37.56321");
  assert.equal(pinnedUrl.searchParams.get("lng"), "126.92234");
  assert.equal(pinnedUrl.searchParams.get("title"), "테스트 농구장");
  assert.equal(
    getCourtMapUrl({ name: "테스트 농구장", addressText: "서울특별시 중구 세종대로 110" }),
    `https://map.naver.com/p/search/${encodeURIComponent("서울특별시 중구 세종대로 110")}`,
  );
});

test("court request attributes preserve unknown values instead of inventing facts", () => {
  assert.equal(normalizeCourtType(""), "확인 필요");
  assert.equal(normalizeCourtType("indoor"), "실내");
  assert.equal(normalizeCourtOptionalBoolean(undefined), null);
  assert.equal(normalizeCourtOptionalBoolean(false), false);
  assert.equal(getCourtKindLabel({ courtKind: "unknown" }), "확인 필요");
  assert.equal(getCourtAccessLabel({ accessType: "unknown" }), "확인 필요");
  assert.equal(normalizeCourtPublicAccess("공개"), "public");
  assert.equal(normalizeCourtPublicAccess("비공개"), "private");
  assert.equal(normalizeCourtPublicAccess("추정"), "unknown");
  assert.equal(getCourtPublicAccessLabel({ publicAccess: "unknown" }), "알 수 없음");
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
  assert.match(recruitingListSource, /RECRUITING_APPROVED_COURT_COLUMNS = `\$\{COURT_COLUMNS\},paid`/);
  assert.doesNotMatch(recruitingListSource, /paid:payload->paid/);
  assert.match(recruitingListSource, /courtFee: post\.courtFee/);
});

test("approved court list mapping uses relational columns without payload duplication", () => {
  const mapped = fromRemoteApprovedCourt({
    id: "court-1",
    name: "마포구 한빛공원 농구장",
    facility_name: "한빛공원",
    sigungu: "마포구",
    indoor_outdoor: "outdoor",
    paid: false,
    payload: { name: "중복 이름", paid: true, privateNote: "노출 금지" },
  });
  assert.equal(mapped.name, "마포구 한빛공원 농구장");
  assert.equal(mapped.facilityName, "한빛공원");
  assert.equal(mapped.region, "마포구");
  assert.equal(mapped.type, "야외");
  assert.equal(mapped.paid, false);
  assert.equal(Object.hasOwn(mapped, "privateNote"), false);

  const serialized = toApprovedCourtRow(mapped);
  assert.equal(Object.hasOwn(serialized, "payload"), false);
  assert.equal(serialized.facility_name, "한빛공원");
  assert.equal(serialized.paid, false);
});

test("court facility names use source-independent conservative normalization", () => {
  assert.equal(normalizeCourtFacilityName("농구장(구일역)"), "구일역 농구장");
  assert.equal(normalizeCourtFacilityName("마루공원농구장"), "마루공원 농구장");
  assert.equal(normalizeCourtFacilityName("관음근린공원(농구장)"), "관음근린공원 농구장");
  assert.equal(normalizeCourtFacilityName("[15]도림천 농구장 제방위"), "도림천 농구장 제방위");
  assert.equal(normalizeCourtFacilityName("안양천농구장5"), "안양천 농구장 5");
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

test("match dispute rejection, void reasons, restoration and scoped penalties stay separate", async () => {
  const now = new Date().toISOString();
  const voidedMatch = {
    id: "match-void",
    status: "void",
    createdBy: "host",
    voidedBy: "referee",
    voidedAt: now,
    teamA: { players: ["host", "player-a"] },
    teamB: { players: ["player-b"] },
  };
  assert.equal(getVoidMatchRestoreTargetUserId(voidedMatch), "referee");
  assert.equal(canRequestVoidMatchRestore(voidedMatch, "player-a"), true);
  assert.equal(canRequestVoidMatchRestore(voidedMatch, "referee"), false);
  assert.equal(DEFAULT_RATING_POLICY.trust.matchVoidHostPenalty, 2);
  assert.equal(VOID_MATCH_RESTORE_REPORT_REASON, "무효 경기 복구 요청");

  const ratings = { integrated: 1200, modes: { "1v1": 1200 } };
  const disputedMatch = {
    id: "match-disputed",
    title: "검증 경기",
    status: "disputed",
    createdBy: "host",
    refereeId: null,
    mode: "1v1",
    ranked: false,
    rules: { ratingScale: 1 },
    teamA: { players: ["host"] },
    teamB: { players: ["guest"] },
    result: {
      scoreA: 10,
      scoreB: 8,
      playerStats: {
        host: { points: 10, rebounds: 0, assists: 0, steals: 0, blocks: 0, fouls: 0 },
        guest: { points: 8, rebounds: 0, assists: 0, steals: 0, blocks: 0, fouls: 0 },
      },
    },
    disputes: [{ id: "dispute-open", by: "guest", status: "open", reason: "점수 확인" }],
  };
  const state = {
    currentUserId: "host",
    users: [{ id: "host", trustScore: 80, ratings }, { id: "guest", trustScore: 80, ratings }],
    matches: [disputedMatch],
    notifications: [],
    teams: [],
    affiliations: [],
    settings: { ratingPolicy: { trust: { matchVoidHostPenalty: 2 } } },
  };
  assert.equal(applyMatchVoid(state, disputedMatch.id, "짧음"), state);
  const voidedState = applyMatchVoid(state, disputedMatch.id, "경기 진행 합의가 깨져 전체 경기를 무효 처리합니다.");
  assert.equal(voidedState.matches[0].status, "void");
  assert.equal(voidedState.matches[0].voidSnapshot.result.scoreA, 10);
  assert.equal(voidedState.users[0].trustScore, 78);
  const rejectedState = rejectMatchDispute(state, disputedMatch.id);
  assert.equal(rejectedState.matches[0].status, "approval");
  assert.equal(rejectedState.matches[0].result.scoreA, 10);

  const [matchRoom, recruiting, matchSync, reportSubmit, adminReview, migration] = await Promise.all([
    readSource("src/pages/MatchRoom.jsx"),
    readSource("src/pages/Recruiting.jsx"),
    readSource("server/api/matches/sync-match.js"),
    readSource("server/api/reports/submit.js"),
    readSource("server/api/admin/review-action.js"),
    readSource("supabase/migrations/20260721210000_match_void_review_and_dispute_rejection.sql"),
  ]);
  assert.match(matchRoom, /MatchDisputeQueue/);
  assert.match(recruiting, /경기 무효 처리/);
  assert.match(matchSync, /rankball_match_reject_dispute_action/);
  assert.match(matchSync, /p_reason: operation\.reason/);
  assert.match(reportSubmit, /matchReviewType:\s*"void_restore"/);
  assert.match(adminReview, /rankball_review_void_match_report/);
  assert.match(migration, /char_length\(safe_reason\) < 10/);
  assert.match(migration, /'restoreMatchHalf'/);
  assert.match(migration, /public_room_suspension/);
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

test("pickup player invitation keeps multi-select enabled", async () => {
  const recruitingPage = await readSource("src/pages/Recruiting.jsx");
  assert.doesNotMatch(recruitingPage, /toggleSingleInvitePlayer/);
  assert.ok((recruitingPage.match(/onTogglePlayer=\{toggleInvitePlayer\}/g) ?? []).length >= 2);
});

test("referee rulebook matches current FIBA and BOXTIER operating rules", async () => {
  const rulebookText = JSON.stringify({
    sections: REFEREE_RULEBOOK_SECTIONS,
    stats: REFEREE_STAT_GUIDELINES,
    checklist: REFEREE_RULEBOOK_CHECKLIST,
    notice: REFEREE_RULEBOOK_NOTICE,
  });
  const page = await readSource("src/pages/RefereeRulebook.jsx");

  assert.equal(REFEREE_EXAM_VERSION, "rankball-referee-2026-07");
  assert.doesNotMatch(rulebookText, /림 위 원통|4번 드리블|낮은 가중치/);
  assert.match(rulebookText, /1m 안에서 밀착 수비/);
  assert.match(rulebookText, /비접촉 테크니컬/);
  assert.match(rulebookText, /30분 또는 60분/);
  assert.match(rulebookText, /손에서 떠나기 전이어도 블록/);
  assert.match(page, /FIBA 경기규칙 2024/);
  assert.match(page, /FIBA 통계 매뉴얼 2024/);
  assert.match(page, /RULEBOOK_ASSET_VERSION/);
});
