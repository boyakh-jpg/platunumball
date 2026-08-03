import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import {
  ADMIN_LIB_SOURCE_PATHS,
  APP_DATA_ACTION_SOURCE_PATHS,
  APP_DATA_ORCHESTRATOR_SOURCE_PATHS,
  APP_DATA_REMOTE_MERGE_SOURCE_PATHS,
  CREATE_MATCH_PAGE_SOURCE_PATHS,
  HOME_PAGE_SOURCE_PATHS,
  MATCHES_PAGE_SOURCE_PATHS,
  MATCH_CLOCK_PANEL_SOURCE_PATHS,
  MATCH_ROOM_SOURCE_PATHS,
  MATCH_SYNC_SOURCE_PATHS,
  RECRUITING_LIST_SOURCE_PATHS,
  REPOSITORY_MATCHES_SOURCE_PATHS,
  RECRUITING_PAGE_SOURCE_PATHS,
  TOURNAMENT_DETAIL_SOURCE_PATHS,
  TEAM_DETAIL_SOURCE_PATHS,
  readSourceGroup,
} from "./management-source-groups.mjs";
import { readCssTree } from "./css-source-tree.mjs";
import { BRAND_NAME } from "../src/lib/brand.js";
import { getAdminStatusLabel } from "../src/lib/admin.js";
import {
  BASKETBALL_POSITIONS,
  DEFAULT_PLAYER_RATINGS,
  DEFAULT_RATING,
  MATCH_MODES,
  MATCH_SIDES,
  MAX_RECRUITING_RESERVES_PER_SIDE,
  getTestAccountDisplayLabel,
  getModeSize,
  isRefereeGrade,
  normalizeBenchCapacity,
} from "../src/lib/constants.js";
import { getDbScheduleParts } from "../src/data/scheduleUtils.js";
import {
  acceptTeamInvitation,
  cancelTeamInvitation,
  createTeam,
  declineTeamInvitation,
  deleteTeam,
  inviteTeamMember,
  removeTeamMember,
  updateTeamMemberRole,
} from "../src/data/repository/account.js";
import { getRoomScheduleLabel } from "../src/lib/matchUtils.js";
import { getResumableRefereeExamAttempt, matchesReportSearchQuery } from "../src/pages/settingsPageModel.js";
import { fromRemoteApprovedCourt } from "../src/data/remotePayloadMappers.js";
import { toApprovedCourtRow } from "../src/data/remoteRowSerializers.js";
import {
  blockUser,
  finalizeMatchByAuthority,
  configureServerRatingAuthority,
  incrementMatchScore,
  markAllNotificationsRead,
  reportCourtReview,
  reportMatch,
  reportTeamEmblem,
  resolveMatchDispute,
  submitMatchResult,
  toggleFavoriteCourt,
  toggleFavoritePlayer,
  toggleFavoriteReferee,
  toggleFavoriteTeam,
  unblockUser,
  updateTournamentMatchSchedule,
  voidMatch as applyMatchVoid,
} from "../src/data/repository.js";
import { SERVER_RATING_AUTHORITY } from "../server/lib/ratingAuthority.js";
import { isCourtFuzzyMatch } from "../server/api/search.js";

configureServerRatingAuthority(SERVER_RATING_AUTHORITY);

test("selected report target text keeps matching punctuation-separated metadata", () => {
  const haystack = "강민준 #rb001pg PG Team A 출전 오늘의 2v2 경쟁전 #m7 연북중학교";
  assert.equal(matchesReportSearchQuery(haystack, "강민준 #rb001pg · #m7"), true);
  assert.equal(matchesReportSearchQuery(haystack, "강민준 #rb001pg · #missing"), false);
});
import { getTeamDiscoveryGroups } from "../src/data/teamMappers.js";
import { getTournamentRosterTeam } from "../src/data/tournamentMappers.js";
import { REGION_TREE, getRegionDistrictOptions, inferRegionSelection } from "../src/lib/profileSetup.js";
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
  mapClientTeamEmblem,
  mapRemoteTeamEmblem,
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
import {
  getMatchDisputeReminderTiming,
  toDiscordDeliveryRows,
  toMatchNotificationRows,
} from "../server/api/matches/sync-match.js";
import {
  canRequestVoidMatchRestore,
  compareMatchRecency,
  getActualMatchPlayerIds,
  getActualMatchPlayerSideName,
  getMatchParticipationType,
  getMatchScoreEditableSides,
  getMatchResultEntryPermission,
  hasMatchScoreboardOperators,
  getVoidMatchRestoreTargetUserId,
  getMatchSideResult,
  getLocalDateInputValue,
  getPlayerMatchResult,
  getPlayerRecentRecordMatches,
  getTournamentScheduleEditPolicy,
  isMatchWithinRecordDetailWindow,
  isTournamentMatchLineupEditable,
} from "../src/lib/matchUtils.js";
import { DEFAULT_RATING_POLICY, RATING_POLICY_MODE_IDS } from "../server/lib/ratingPolicy.js";
import {
  COURT_DUPLICATE_REPORT_REASON,
  REPORT_TARGET_TYPES,
  VOID_MATCH_RESTORE_REPORT_REASON,
  getCourtCorrectionFieldForReportReason,
  getReportTargetType,
} from "../src/lib/reportReasons.js";
import { getRoomPhaseViewModel } from "../src/lib/roomFlow.js";
import { DEFAULT_UNLOCKED_PROFILE_ICON_KEYS, PROFILE_ICON_CATALOG } from "../src/lib/profileIcons.js";
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
import { compactClientUser } from "../server/lib/clientProjection.js";
import { getRecruitingListCardCounts, getRecruitingListCardLobby, isPaidRecruitingCourt } from "../src/lib/recruiting.js";
import { mergeRecruitingPostsById } from "../src/hooks/useAppData.js";
import { getPlayerSeasonActivity } from "../src/lib/season.js";
import { fromRemoteProfile } from "../src/data/profileMappers.js";
import { IMAGE_CONTEXT_MENU_ALLOW_ATTRIBUTE, getProtectedImageTarget } from "../src/hooks/useImageInteractionGuard.js";
import { createRefereeExamSet, hasCompleteRefereeExamAnswers, REFEREE_EXAM_SIZE, REFEREE_EXAM_VERSION } from "../src/lib/refereeExamBank.js";
import {
  REFEREE_RULEBOOK_CHECKLIST,
  REFEREE_RULEBOOK_EASY_SECTIONS,
  REFEREE_RULEBOOK_NOTICE,
  REFEREE_RULEBOOK_SECTIONS,
  REFEREE_STAT_GUIDELINES,
} from "../src/lib/refereeRulebook.js";

const root = new URL("../", import.meta.url);
const readSource = (path) => readFile(new URL(path, root), "utf8");
const readRecruitingPageSource = () => readSourceGroup(readSource, RECRUITING_PAGE_SOURCE_PATHS);
const readHomePageSource = () => readSourceGroup(readSource, HOME_PAGE_SOURCE_PATHS);
const readCreateMatchPageSource = () => readSourceGroup(readSource, CREATE_MATCH_PAGE_SOURCE_PATHS);

async function readGlobalStyles() {
  return readCssTree("src/styles/globals.css");
}

const PUBLIC_COPY_SOURCE_PATHS = Object.freeze([
  "index.html",
  "src/lib/brand.js",
  "src/components/layout/Sidebar.jsx",
  ...RECRUITING_PAGE_SOURCE_PATHS,
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

test("tournament schedule allows one revision and locks after lineup submission", () => {
  const scheduledMatch = {
    id: "match-1",
    tournamentId: "tournament-1",
    status: "agreed",
    scheduledDate: "2026-07-30",
    scheduledTime: "19:00",
    rules: {},
  };

  assert.deepEqual(getTournamentScheduleEditPolicy({
    ...scheduledMatch,
    scheduledDate: "",
    scheduledTime: "",
  }), {
    allowed: true,
    reason: "",
    hasSchedule: false,
    revisionCount: 0,
  });
  assert.equal(getTournamentScheduleEditPolicy(scheduledMatch).allowed, true);
  assert.equal(getTournamentScheduleEditPolicy({
    ...scheduledMatch,
    rules: { tournamentScheduleRevisionCount: 1 },
  }).reason, "revision_limit");
  assert.equal(getTournamentScheduleEditPolicy({
    ...scheduledMatch,
    rules: { rosterReady: { teamA: false, teamB: true } },
  }).reason, "lineup_submitted");
  assert.equal(isTournamentMatchLineupEditable({
    ...scheduledMatch,
    confirmedAt: "2026-07-25T12:00:00.000Z",
  }), true);
  assert.equal(isTournamentMatchLineupEditable({
    ...scheduledMatch,
    status: "confirmed",
  }), false);
  assert.deepEqual(
    getRoomPhaseViewModel({
      match: {
        ...scheduledMatch,
        confirmedAt: "2026-07-25T12:00:00.000Z",
      },
    }).sectionOrder,
    ["recordSetup", "versus", "recordBoard"],
  );
});

test("local tournament schedule reducer counts only a real revision", () => {
  const formatKstDate = (days) => getLocalDateInputValue(new Date(Date.now() + days * 86_400_000));
  const state = {
    currentUserId: "organizer-1",
    tournaments: [{
      id: "tournament-1",
      createdBy: "organizer-1",
      courtId: "court-1",
      rules: { allowedCourtIds: ["court-1"] },
    }],
    matches: [{
      id: "match-1",
      tournamentId: "tournament-1",
      title: "1경기",
      status: "agreed",
      teamA: { teamId: "team-a" },
      teamB: { teamId: "team-b" },
      rules: {},
    }],
    teams: [],
    notifications: [],
    settings: {
      approvedCourts: [{ id: "court-1", name: "테스트 구장", status: "active" }],
    },
  };

  const initial = updateTournamentMatchSchedule(state, "tournament-1", "match-1", {
    scheduledDate: formatKstDate(2),
    scheduledTime: "19:00",
    courtId: "court-1",
  });
  assert.equal(initial.matches[0].rules.tournamentScheduleRevisionCount, 0);

  const unchanged = updateTournamentMatchSchedule(initial, "tournament-1", "match-1", {
    scheduledDate: formatKstDate(2),
    scheduledTime: "19:00",
    courtId: "court-1",
  });
  assert.equal(unchanged, initial);

  const revised = updateTournamentMatchSchedule(initial, "tournament-1", "match-1", {
    scheduledDate: formatKstDate(3),
    scheduledTime: "20:00",
    courtId: "court-1",
  });
  assert.equal(revised.matches[0].rules.tournamentScheduleRevisionCount, 1);

  const rejected = updateTournamentMatchSchedule(revised, "tournament-1", "match-1", {
    scheduledDate: formatKstDate(4),
    scheduledTime: "21:00",
    courtId: "court-1",
  });
  assert.equal(rejected.matches[0].scheduledDate, formatKstDate(3));
  assert.equal(rejected.notifications[0].title, "일정 수정 불가");
});

test("tournament roster snapshot restores a captain omitted from the current directory", () => {
  const team = getTournamentRosterTeam(
    { id: "team-a", name: "마포 러너스", members: [{ userId: "member-1", role: "regular" }] },
    {
      rules: {
        teamRosterSnapshot: {
          teams: {
            "team-a": {
              captainId: "captain-1",
              members: [{ userId: "captain-1", role: "captain" }],
            },
          },
        },
      },
    },
    "team-a",
  );

  assert.deepEqual(team.members, [
    { userId: "captain-1", role: "captain" },
    { userId: "member-1", role: "regular" },
  ]);
});

test("tournament schedule guard is enforced in UI, CSS, and DB", async () => {
  const [detailSource, recruitingSource, roomFlowSource, styles, migration] = await Promise.all([
    readSourceGroup(readSource, TOURNAMENT_DETAIL_SOURCE_PATHS),
    readRecruitingPageSource(),
    readSource("src/lib/roomFlow.js"),
    readSource("src/styles/responsive/matches-arena-responsive.css"),
    readSource("supabase/migrations/20260725017000_tournament_schedule_revision_lock.sql"),
  ]);

  assert.match(detailSource, /getTournamentScheduleEditPolicy/);
  assert.match(detailSource, /출전 명단 제출 후 잠금/);
  assert.match(recruitingSource, /getTournamentRosterTeam/);
  assert.match(recruitingSource, /isTournamentMatchLineupEditable/);
  assert.match(roomFlowSource, /\["recordSetup", "versus", "recordBoard"\]/);
  assert.match(styles, /\.tournament-schedule-list input:is\(\[type="date"\], \[type="time"\]\)[\s\S]*min-inline-size: 0;/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.tournament-schedule-list form[\s\S]*grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(migration, /tournament_schedule_lineup_submitted/);
  assert.match(migration, /tournament_schedule_revision_limit/);
  assert.match(migration, /if not schedule_changed then/);
  assert.match(migration, /rankball_tournament_match_schedule_action_unrestricted/);
});

test("match_record keeps three reserves without overriding live or tournament bench capacity", async () => {
  const [recruitingSource, repositorySource, migration, logicPolicy] = await Promise.all([
    readRecruitingPageSource(),
    readSourceGroup(readSource, REPOSITORY_MATCHES_SOURCE_PATHS),
    readSource("supabase/migrations/20260729170000_match_record_batch_score_and_reserves.sql"),
    readSource("docs/logic-and-terminology.md"),
  ]);

  assert.equal(MAX_RECRUITING_RESERVES_PER_SIDE, 3);
  assert.equal(normalizeBenchCapacity(0), 0);
  assert.equal(normalizeBenchCapacity(2), 2);
  assert.match(
    recruitingSource,
    /reserveCapacity=\{sourceMatchIsRecordRoom \? MAX_RESERVE_PLAYERS_PER_SIDE : benchCapacity\}/,
  );
  assert.match(
    repositorySource,
    /const benchCapacity = isMatchRecordMatch\(match\)\s*\?\s*MAX_BENCH_CAPACITY\s*:\s*getRecruitingBenchCapacity\(match\);/,
  );
  assert.match(migration, /if requested_reserve_count > 3 then/);
  assert.match(logicPolicy, /경기 기록은 사이드당 최대 3명의 후보를 보존하는 사후 명단/);
});

test("match clock scoreboard requires a referee or an identified host", () => {
  assert.equal(hasMatchScoreboardOperators({ refereeId: "referee-1" }), true);
  assert.equal(hasMatchScoreboardOperators({ createdBy: "host-1" }), true);
  assert.equal(hasMatchScoreboardOperators({
    reservePlayers: { teamA: ["recorder-a"], teamB: ["recorder-b"] },
    statRecorders: { teamA: "recorder-a", teamB: "recorder-b" },
  }), false);
  assert.equal(hasMatchScoreboardOperators({}), false);
});

test("점수 권한은 심판 경기의 심판, 무심판 시계 경기의 담당자, 시계 없는 경기의 방장으로 분리한다", () => {
  const refereeMatch = {
    refereeId: "referee-1",
    rules: { gameClockEnabled: true },
  };
  assert.deepEqual(
    getMatchScoreEditableSides(refereeMatch, "referee-1", { refereeEligible: true }),
    MATCH_SIDES,
  );
  assert.deepEqual(
    getMatchScoreEditableSides(refereeMatch, "clock-controller", { clockController: true }),
    [],
  );
  assert.deepEqual(getMatchScoreEditableSides(refereeMatch, "host-1"), []);

  const noRefereeClockMatch = {
    createdBy: "host-1",
    rules: { gameClockEnabled: true },
  };
  assert.deepEqual(
    getMatchScoreEditableSides(noRefereeClockMatch, "clock-controller", { clockController: true }),
    MATCH_SIDES,
  );
  assert.deepEqual(
    getMatchScoreEditableSides(noRefereeClockMatch, "host-1", { canOperatePostStart: true }),
    [],
  );

  const noClockMatch = {
    createdBy: "host-1",
    rules: { gameClockEnabled: false },
  };
  assert.deepEqual(
    getMatchScoreEditableSides(noClockMatch, "host-1", { canOperatePostStart: true }),
    MATCH_SIDES,
  );
  assert.deepEqual(getMatchScoreEditableSides(noClockMatch, "guest-1"), []);
});

test("심판 경기의 기록·이의·최종 확정은 심판만 수행하고 마지막 이의 판정은 자동 확정하지 않는다", () => {
  const now = new Date().toISOString();
  const match = {
    id: "practice-referee-authority",
    practiceMode: true,
    title: "심판 권한 경기",
    status: "disputed",
    createdBy: "host-1",
    refereeId: "referee-1",
    refereeTrustMin: 80,
    startedAt: now,
    endedAt: now,
    ranked: false,
    teamA: { name: "A", players: ["host-1"], score: 21 },
    teamB: { name: "B", players: ["guest-1"], score: 20 },
    playedPlayerIds: { teamA: ["host-1"], teamB: ["guest-1"] },
    reservePlayers: { teamA: [], teamB: [] },
    result: {
      scoreA: 21,
      scoreB: 20,
      submittedAt: now,
      playerStats: {
        "host-1": { points: 21 },
        "guest-1": { points: 20 },
      },
      statSubmissions: {},
    },
    disputes: [{
      id: "dispute-1",
      by: "guest-1",
      status: "open",
      request: {
        kind: "player_stats",
        playerId: "guest-1",
        requestedStats: { points: 22, rebounds: 0, assists: 0, steals: 0, blocks: 0, turnovers: 0, fouls: 0 },
        baseRevision: 0,
      },
    }],
    rules: {
      recordType: "match",
      gameClockEnabled: true,
      playedPlayerIds: { teamA: ["host-1"], teamB: ["guest-1"] },
    },
  };
  const users = [
    { id: "host-1", name: "방장", trustScore: 100, ratings: {} },
    { id: "guest-1", name: "선수", trustScore: 100, ratings: {} },
    {
      id: "referee-1",
      name: "심판",
      trustScore: 100,
      refereeGrade: "official",
      officialReferee: true,
      ratings: {},
    },
  ];
  const baseState = {
    currentUserId: "host-1",
    users,
    teams: [],
    matches: [match],
    notifications: [],
    affiliations: [],
    settings: {},
  };

  const refereePermission = getMatchResultEntryPermission(match, "referee-1", {
    canOperatePostStart: true,
    refereeEligible: true,
    now,
  });
  const hostPermission = getMatchResultEntryPermission(match, "host-1", {
    canOperatePostStart: false,
    now,
  });
  assert.equal(refereePermission.canEditDisputeDraft, true);
  assert.deepEqual(refereePermission.editablePlayerIds, ["host-1", "guest-1"]);
  assert.equal(hostPermission.canEditDisputeDraft, false);
  assert.deepEqual(hostPermission.editablePlayerIds, []);

  assert.strictEqual(finalizeMatchByAuthority(baseState, match.id), baseState);
  assert.strictEqual(
    resolveMatchDispute(baseState, match.id, "dispute-1", "accepted", "요청 점수를 확인함"),
    baseState,
  );

  const refereeState = { ...baseState, currentUserId: "referee-1" };
  assert.strictEqual(finalizeMatchByAuthority(refereeState, match.id), refereeState);
  const resolved = resolveMatchDispute(
    refereeState,
    match.id,
    "dispute-1",
    "accepted",
    "현장 기록과 요청 점수를 확인함",
  );
  assert.equal(resolved.matches[0].status, "approval");
  assert.equal(resolved.matches[0].result.scoreB, 22);
  assert.equal(resolved.matches[0].confirmedAt, undefined);

  const finalized = finalizeMatchByAuthority(resolved, match.id, {
    disputesAcknowledged: true,
    now: Date.now() + (4 * 60_000),
  });
  assert.equal(finalized.matches[0].status, "confirmed");
  assert.ok(finalized.matches[0].confirmedAt);

  assert.strictEqual(
    resolveMatchDispute(finalized, match.id, "dispute-1", "rejected", "이미 확정된 경기"),
    finalized,
  );
  assert.strictEqual(
    incrementMatchScore(finalized, match.id, 1, 0, { expectedRevisionA: 0 }),
    finalized,
  );
  assert.strictEqual(
    submitMatchResult(finalized, match.id, { scoreA: 99, scoreB: 0, playerStats: {} }),
    finalized,
  );
});

test("무심판 경기의 최종 확정은 방장만 수행한다", () => {
  const now = new Date().toISOString();
  const match = {
    id: "practice-no-referee-authority",
    practiceMode: true,
    title: "무심판 권한 경기",
    status: "approval",
    createdBy: "host-1",
    refereeId: "",
    startedAt: now,
    endedAt: now,
    ranked: false,
    teamA: { name: "A", players: ["host-1"], score: 15 },
    teamB: { name: "B", players: ["guest-1"], score: 13 },
    result: { scoreA: 15, scoreB: 13, submittedAt: now },
    disputes: [],
    rules: { recordType: "match", gameClockEnabled: false },
  };
  const state = {
    currentUserId: "guest-1",
    users: [
      { id: "host-1", name: "방장", ratings: {} },
      { id: "guest-1", name: "선수", ratings: {} },
    ],
    teams: [],
    matches: [match],
    notifications: [],
    affiliations: [],
    settings: {},
  };

  assert.strictEqual(finalizeMatchByAuthority(state, match.id), state);
  const finalized = finalizeMatchByAuthority(
    { ...state, currentUserId: "host-1" },
    match.id,
    { disputesAcknowledged: true, now: Date.now() + (4 * 60_000) },
  );
  assert.equal(finalized.matches[0].status, "confirmed");
  assert.deepEqual(finalized.matches[0].result.playerStats, {});
  assert.deepEqual(finalized.matches[0].result.statSubmissions, {});

  const disputedMatch = {
    ...match,
    status: "disputed",
    disputes: [{
      id: "no-ref-dispute-1",
      by: "guest-1",
      status: "open",
      request: { kind: "team_scores", requestedScoreA: 15, requestedScoreB: 14, baseRevision: 0 },
    }],
  };
  const disputedState = { ...state, matches: [disputedMatch] };
  assert.strictEqual(
    resolveMatchDispute(
      disputedState,
      match.id,
      "no-ref-dispute-1",
      "accepted",
      "방장이 현장 점수를 확인함",
    ),
    disputedState,
  );
  const resolved = resolveMatchDispute(
    { ...disputedState, currentUserId: "host-1" },
    match.id,
    "no-ref-dispute-1",
    "accepted",
    "방장이 현장 점수를 확인함",
  );
  assert.equal(resolved.matches[0].status, "approval");
  assert.equal(resolved.matches[0].result.scoreB, 14);
  assert.equal(resolved.matches[0].confirmedAt, undefined);
});

test("match clock keeps shot settings stable and fullscreen compact", async () => {
  const panelSource = await readSourceGroup(readSource, MATCH_CLOCK_PANEL_SOURCE_PATHS);
  const clockStyles = await readCssTree("src/styles/match-clock.css");
  const qrStyles = await readSource("src/styles/primitives/ui-entity-feedback.css");
  const recruitingSource = await readRecruitingPageSource();
  const matchRoomSource = await readSourceGroup(readSource, MATCH_ROOM_SOURCE_PATHS);
  const forceEndMigration = [
    await readSource("supabase/migrations/20260724230000_match_clock_one_hour_force_end.sql"),
    await readSource("supabase/migrations/20260725012000_match_duration_and_clock_limits.sql"),
  ].join("\n");

  assert.match(panelSource, /configurationDirtyRef\.current/);
  assert.match(panelSource, /onClick=\{\(\) => selectShotClock\(option\.value\)\}/);
  assert.match(panelSource, /\{shotClockEnabled \? \(/);
  assert.match(panelSource, /isRunning && hasRemainingPeriodTime/);
  assert.match(panelSource, /!isBreak && hasRemainingPeriodTime/);
  assert.match(panelSource, /normalizeMatchRules\(match\.rules, \{ mode: match\.mode \}\)/);
  assert.match(panelSource, /matchRules\.periodBreakMinutes/);
  assert.match(panelSource, /matchRules\.halftimeMinutes/);
  assert.match(panelSource, /directScoreControlsEnabled = scoreboardEnabled/);
  assert.match(panelSource, /export \{ default as MatchScoreControls \} from "\.\/MatchScoreControls\.jsx";/);
  assert.match(panelSource, /directScoreControlsEnabled && !isEnded && clockEditableScoreSides\.length/);
  assert.match(panelSource, /clockEditableScoreSides\.includes\("teamA"\)/);
  assert.match(panelSource, /clockEditableScoreSides\.includes\("teamB"\)/);
  assert.match(panelSource, /breakLimitMs > 0/);
  assert.match(panelSource, /liveClock\?\.matchEndedAt/);
  assert.match(panelSource, /closeFocusMode\(\)/);
  assert.match(panelSource, /document\.documentElement\.style\.overflow = "hidden"/);
  assert.match(panelSource, /document\.documentElement\.style\.overflow = previousRootOverflow/);
  assert.match(panelSource, /ui-match-clock-scoreboard-label">점수판/);
  assert.match(panelSource, /ui-match-clock-main-time-label">경기시계/);
  assert.match(panelSource, /ui-match-clock-score-controls/);
  assert.match(
    panelSource,
    /<\/div>\s*\{directScoreControlsEnabled && !isEnded && clockEditableScoreSides\.length \? \(\s*<div className="ui-match-clock-score-controls"/,
  );
  assert.match(panelSource, /ui-match-shot-clock-action/);
  assert.match(panelSource, /<RotateCcw size=\{15\}/);
  assert.match(panelSource, /<QrCode value=\{attendanceQr\.value\} label="지각 출석 QR 코드" expandable \/>/);
  assert.match(panelSource, /navigator\.mediaSession\.setActionHandler\("play", resetFromMediaControl\)/);
  assert.match(panelSource, /navigator\.mediaSession\.setActionHandler\("pause", resetFromMediaControl\)/);
  assert.match(panelSource, /resetRequestedAt - lastMediaResetAtRef\.current < 300/);
  assert.match(panelSource, /mediaResetEnabled[\s\S]*void runAction\("resetShot"\)/);
  assert.match(panelSource, /onPointerDown=\{enableMediaControl\}/);
  assert.doesNotMatch(panelSource, /setActionHandler\("(?:nexttrack|previoustrack)"/);
  assert.match(recruitingSource, /onMatchEnded=\{\(\) => void app\.actions\.loadMatchDetail\(sourceMatch\.id\)\}/);
  assert.match(recruitingSource, /!selectedMatchRules\.gameClockEnabled[\s\S]*?<MatchScoreControls/);
  assert.match(matchRoomSource, /normalizedRules\.gameClockEnabled === false[\s\S]*?<MatchScoreControls/);
  assert.match(matchRoomSource, /isSharedRecord && match\.rules\?\.recordSetupReady === true/);
  assert.doesNotMatch(panelSource, /담당·샷클락 저장|AudioContext/);
  assert.match(clockStyles, /\.ui-match-clock-focus-backdrop[\s\S]*?overflow: hidden;/);
  assert.match(clockStyles, /\.ui-match-clock-panel-focus[\s\S]*?height: 100%;[\s\S]*?overflow: hidden;/);
  assert.match(clockStyles, /\.ui-match-clock-scoreboard \{[^}]*overflow: hidden;/);
  assert.match(clockStyles, /\.ui-match-score-control-grid[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(clockStyles, /@media \(width <= 720px\)[\s\S]*\.ui-match-score-control-grid[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(clockStyles, /\.ui-match-clock-panel-focus \.ui-match-clock-device-notice \{[^}]*pointer-events: none;/);
  assert.match(clockStyles, /\.ui-match-clock-display-grid-with-attendance:not\(\.ui-match-clock-display-grid-single\) \{[^}]*grid-template-areas:\s*"score score"\s*"attendance shot";[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(clockStyles, /\.ui-match-clock-panel-focus \.ui-match-clock-actions \{[^}]*grid-column: 2;[^}]*grid-row: 4;[^}]*width: 100%;/);
  assert.match(clockStyles, /\.ui-match-clock-panel-focus \.ui-match-clock-attendance-qr \{[^}]*grid-template-rows: auto auto;[^}]*align-content: center;/);
  assert.match(clockStyles, /\.ui-match-clock-panel-focus \.ui-match-clock-attendance-qr svg \{[^}]*margin-inline: auto;/);
  assert.match(clockStyles, /\.ui-match-clock-panel-focus \.ui-match-clock-device-tools \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 0\.72fr\)\) minmax\(0, 2fr\);[^}]*grid-column: 2;[^}]*grid-row: 5;/);
  assert.doesNotMatch(clockStyles, /\.ui-match-clock-panel-focus \.ui-match-clock-device-tools \.ui-button:nth-child/);
  assert.match(clockStyles, /\.ui-match-clock-panel-focus \.ui-match-clock-volume \{[^}]*flex: 0 1 clamp\(160px, 22vw, 240px\);/);
  assert.doesNotMatch(clockStyles, /@media \(width >= 721px\)[\s\S]*?\.ui-match-clock-panel-focus \.ui-match-clock-display-grid/);
  assert.match(qrStyles, /\.ui-qr-expand-backdrop\s*\{[^}]*z-index:\s*4000;/);
  assert.match(clockStyles, /\.ui-match-clock-score-actions \.ui-button \{[^}]*min-height: 44px;/);
  assert.match(clockStyles, /\.ui-match-clock-score-controls \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(
    clockStyles,
    /@container \(width <= 520px\)[\s\S]*?\.ui-match-clock-panel:not\(\.ui-match-clock-panel-focus\) \.ui-match-clock-score-controls \{[^}]*grid-template-columns: minmax\(0, 1fr\);/,
  );
  assert.match(
    clockStyles,
    /\.ui-match-clock-panel-focus \.ui-match-clock-score-actions \{[^}]*grid-template-columns: repeat\(4, minmax\(34px, 1fr\)\);/,
  );
  assert.match(clockStyles, /\.ui-match-clock-panel-focus \.ui-match-clock-score-control-side \{[^}]*background: transparent;[^}]*border: 0;/);
  assert.match(clockStyles, /\.ui-match-clock-panel-focus \.ui-match-clock-main-time time \{[^}]*font-size: clamp\(3rem, 16vmin, 8rem\);/);
  assert.match(clockStyles, /\.ui-match-clock-panel-focus \.ui-match-shot-clock-value \{[^}]*font-size: clamp\(2rem, 8vmin, 3\.5rem\);/);
  assert.match(clockStyles, /\.ui-match-shot-clock-action \{[^}]*background: var\(--rb-orange\);/);
  assert.match(clockStyles, /::-webkit-slider-thumb \{[^}]*margin-top: -6px;/);
  assert.match(clockStyles, /::-moz-range-progress/);
  assert.match(forceEndMigration, /clock_started_at \+ interval '90 minutes'/);
  assert.match(forceEndMigration, /period_count \* period_minutes > 63/);
  assert.match(forceEndMigration, /match_regulation_duration_exceeded/);
  assert.match(forceEndMigration, /'forceEnd'/);
  assert.match(forceEndMigration, /ended_at = force_end_at/);
  assert.match(forceEndMigration, /rankball_match_clock_close_on_match_end_trigger/);
  assert.match(forceEndMigration, /\* \* \* \* \*/);
  assert.doesNotMatch(forceEndMigration, /period_remaining_ms\s*=\s*0[\s\S]*ended_at/);
  assert.doesNotMatch(panelSource, /QUARTER_BREAK_LIMIT_MS|HALFTIME_BREAK_LIMIT_MS/);
  assert.doesNotMatch(panelSource, /isHalftimeBreak \? "10분" : "5분"/);
  assert.equal(
    clockStyles.match(/\.ui-match-clock-scoreboard:not\(\.ui-match-clock-scoreboard-time-only\)/g)?.length,
    3,
  );
});

test("match recommendations finish from the SQL result without a full match reload", async () => {
  const [appDataMergeSource, appDataOrchestratorSource, matchServerSource] = await Promise.all([
    readSourceGroup(readSource, APP_DATA_REMOTE_MERGE_SOURCE_PATHS),
    readSourceGroup(readSource, APP_DATA_ORCHESTRATOR_SOURCE_PATHS),
    readSourceGroup(readSource, MATCH_SYNC_SOURCE_PATHS),
  ]);
  const appDataSource = `${appDataMergeSource}\n${appDataOrchestratorSource}`;

  assert.match(appDataSource, /function mergeMatchThumbsResult\(/);
  assert.match(appDataSource, /operation\?\.action === "submitMatchThumbs"/);
  assert.match(appDataSource, /\[actorProfileId\]: targetUserIds/);
  assert.match(matchServerSource, /operation\.action === "submitMatchThumbs"\s*\?\s*null\s*:\s*await loadSyncedMatchAfterWrite/);
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

test("a stale deployed route chunk reloads once without entering a refresh loop", async () => {
  const mainSource = await readSource("src/main.jsx");
  assert.match(mainSource, /window\.addEventListener\("vite:preloadError"/);
  assert.match(mainSource, /event\.preventDefault\(\)/);
  assert.match(mainSource, /window\.location\.reload\(\)/);
  assert.match(mainSource, /Date\.now\(\) - lastRecoveryAt < PRELOAD_RECOVERY_WINDOW_MS/);
  assert.match(mainSource, /window\.sessionStorage\.removeItem\(PRELOAD_RECOVERY_KEY\)/);
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
    ...APP_DATA_ORCHESTRATOR_SOURCE_PATHS,
    ...APP_DATA_ACTION_SOURCE_PATHS,
    "src/lib/handles.js",
    ...ADMIN_LIB_SOURCE_PATHS,
    "src/lib/mockData.js",
    "src/lib/naverAddress.js",
    "src/lib/teamEmblem.js",
    "src/App.jsx",
    "src/components/layout/Sidebar.jsx",
    "src/components/match/MatchCard.jsx",
    "src/components/ranking/RankingTable.jsx",
    "src/pages/Admin.jsx",
    "src/pages/adminPageModel.js",
    "src/pages/AdminPageParts.jsx",
    "src/pages/useAdminPageController.jsx",
    "src/pages/AdminPageView.jsx",
    ...RECRUITING_PAGE_SOURCE_PATHS,
    "src/pages/Matches.jsx",
    "src/pages/matchesPageSelectors.js",
    "src/pages/MatchesPagePanels.jsx",
    "src/pages/useMatchesPageController.jsx",
    "src/pages/MatchesPageView.jsx",
    "src/pages/MatchRoom.jsx",
    "src/pages/matchRoomModel.js",
    "src/pages/MatchRoomParts.jsx",
    "src/pages/MatchRoomView.jsx",
    ...CREATE_MATCH_PAGE_SOURCE_PATHS,
    "src/pages/Login.jsx",
    "src/pages/PlayerDetail.jsx",
    "src/pages/Recorder.jsx",
    "src/pages/Settings.jsx",
    "src/pages/settingsPageModel.js",
    "src/pages/useSettingsPageController.jsx",
    "src/pages/useSettingsReportController.jsx",
    "src/pages/SettingsPageView.jsx",
    "src/pages/SettingsPrimaryColumn.jsx",
    "src/pages/SettingsSideColumn.jsx",
    "src/pages/SettingsRefereeSection.jsx",
    "src/pages/Signup.jsx",
    "src/pages/TeamDetail.jsx",
    "src/pages/Teams.jsx",
    "src/pages/TournamentDetail.jsx",
    "src/pages/tournamentDetailModel.jsx",
    "src/pages/TournamentDetailView.jsx",
    "src/lib/constants.js",
    "server/api/matches/sync-match.js",
    "server/api/recruiting/_syncPostHandler.js",
    "server/api/recruiting/_syncPostPolicy.js",
    "server/api/recruiting/_syncPostActions.js",
    "server/api/recruiting/_syncPostPersistence.js",
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
  assert.equal(getRegionDistrictOptions("서울특별시")[0], "종로구");
  assert.equal(getRegionDistrictOptions("존재하지 않는 지역")[0], "종로구");
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

test("room schedule labels stay canonical across all recruiting surfaces", async () => {
  assert.equal(getRoomScheduleLabel({
    scheduledDate: "2026-07-22",
    scheduledTime: "19:30",
  }), "2026-07-22 19:30");
  assert.equal(getRoomScheduleLabel({
    timingType: "instant",
    createdAt: "2026-07-22T10:00:00",
  }), "즉시");
  assert.equal(getRoomScheduleLabel({}), "일정 미정");

  const [home, recruiting, notifications] = await Promise.all([
    readHomePageSource(),
    readRecruitingPageSource(),
    readSource("src/pages/Notifications.jsx"),
  ]);
  const scheduleConsumers = `${home}\n${recruiting}\n${notifications}`;
  assert.doesNotMatch(scheduleConsumers, /function\s+getRecruitingSchedule\s*\(/);
  [home, recruiting, notifications].forEach((source) => assert.match(source, /getRoomScheduleLabel/));
});

test("notification actions keep tournament links and failed team invites in place", async () => {
  const notifications = await readSource("src/pages/Notifications.jsx");
  const bootstrap = await readSource("src/hooks/appData/bootstrap.js");
  const runtimeHydration = await readSource("src/hooks/appData/orchestrator/runtimeHydration.js");
  assert.match(notifications, /getNotificationHref\(notification\)/u);
  assert.match(notifications, /loadDirectory\?\.\(\{ kind: "self", force: true \}\)/u);
  assert.match(notifications, /const result = await runInvitationAction\([\s\S]{0,160}app\.actions\.acceptTeamInvitation\(invitation\.id\)/u);
  assert.match(notifications, /if \(!result \|\| result\.ok === false\) return/u);
  assert.match(notifications, /pendingInvitationKeysRef\.current\.has\(key\)/u);
  assert.match(bootstrap, /pathname === "\/app\/notifications"[\s\S]{0,120}includeTeamInvitations: true/u);
  assert.match(bootstrap, /includeExtraProfiles: includeFavorites \|\| includeTeamInvitations/u);
  assert.match(runtimeHydration, /includeTeamInvitations: initialLoadOptions\.includeTeamInvitations === true/u);
});

test("season rival challenge closes the created room when the B-team invite fails", async () => {
  const [season, createController, createEffects, createActions] = await Promise.all([
    readSource("src/pages/Season.jsx"),
    readSource("src/components/match/useCreateMatchBaseController.js"),
    readSource("src/components/match/useCreateMatchValidationEffects.js"),
    readSource("src/components/match/CreateMatchActions.jsx"),
  ]);
  assert.match(season, /challengeTeamAId=\$\{encodeURIComponent\(myTeam\.id\)\}&challengeTeamBId=\$\{encodeURIComponent\(opponentTeam\.id\)\}/u);
  assert.match(createController, /challengeSearchParams\.get\("challengeTeamAId"\)/u);
  assert.match(createController, /challengeSearchParams\.get\("challengeTeamBId"\)/u);
  assert.match(createEffects, /if \(!hasTeamChallenge\) return;[\s\S]{0,240}visibility: "private",[\s\S]{0,180}teamAId: challengeTeamAId,[\s\S]{0,80}teamBId: challengeTeamBId/u);
  assert.match(createEffects, /if \(isTeamRoom && !isTournamentRoom\) \{\s*if \(hasTeamChallenge\) return;/u);
  assert.match(createEffects, /if \(canCreateTeamRoom \|\| hasTeamChallenge\) return;/u);
  assert.match(createActions, /const result = await app\.actions\.setRecruitingRoomTeam\(postId, "teamB", presetTeamBId, "시즌 라이벌 매치업에서 보낸 팀 초대입니다\."\)/u);
  assert.match(createActions, /if \(!result \|\| result\?\.ok === false\) \{[\s\S]{0,240}closeRecruitingPost\(postId, "B팀 초대 실패로 생성 취소"\)[\s\S]{0,240}return;/u);
});

test("remote favorite search hydrates the selected entity before optimistic toggle", async () => {
  const favoriteSource = await readSource("src/pages/useSettingsFavorites.jsx");
  const settingsActions = await readSource("src/hooks/appData/actions/settingsActions.js");
  const serverActions = await readSource("src/hooks/appData/orchestrator/serverActions.js");
  assert.match(favoriteSource, /const result = await toggleAction\(item\.id, item\)/);
  assert.match(favoriteSource, /if \(!result \|\| result\?\.ok === false\)/);
  assert.match(favoriteSource, /favoriteActionPendingRef\.current/);
  assert.match(settingsActions, /toggleFavoritePlayer: \(userId, targetSnapshot\)[\s\S]*toggleFavoriteReferee: \(userId, targetSnapshot\)/);
  assert.match(serverActions, /active && targetSnapshot\?\.id === safeTargetId/);
  assert.match(serverActions, /mergeRemoteProfileState\(current, targetType === "team"/);
  assert.match(serverActions, /approvedCourts: mergeCourtSearchCourts/);
});

test("report success survives a synchronous directory refresh failure", async () => {
  const settingsReport = await readSource("src/pages/useSettingsReportController.jsx");
  assert.match(settingsReport, /const loadDirectory = app\.actions\.loadDirectory/u);
  assert.match(settingsReport, /setReportSubmitStatus\(result\.duplicate[\s\S]*if \(loadDirectory\)/u);
  assert.match(settingsReport, /Promise\.resolve\(\)\s*\.then\(\(\) => loadDirectory\(/u);
  assert.match(settingsReport, /current === "신고가 접수됐습니다\."/u);
  assert.doesNotMatch(settingsReport, /Promise\.resolve\(loadDirectory\(/u);
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

test("team emblem row mapping preserves response fallbacks and null handling", () => {
  assert.deepEqual(mapRemoteTeamEmblem({
    accent: "#123456",
    emblem_key: "teams/example.webp",
    emblem_upload_count: "3",
    emblem_border_enabled: false,
    emblem_text_mode: "name",
  }), {
    emblemKey: "teams/example.webp",
    emblemSource: "upload",
    emblemUpdatedAt: null,
    emblemUploadedAt: null,
    emblemUploadCount: 3,
    emblemColor: "#123456",
    emblemBorderEnabled: false,
    emblemBorderColor: "#123456",
    emblemTextMode: "name",
    emblemAbbreviation: "",
    emblemFont: "sport",
  });
  assert.deepEqual(mapRemoteTeamEmblem({
    accent: null,
    emblem_key: null,
    emblem_source: "",
    emblem_color: "",
    emblem_border_color: "",
    emblem_text_mode: "unsupported",
    emblem_abbreviation: null,
    emblem_font: "custom",
  }), {
    emblemKey: null,
    emblemSource: "",
    emblemUpdatedAt: null,
    emblemUploadedAt: null,
    emblemUploadCount: 0,
    emblemColor: "",
    emblemBorderEnabled: true,
    emblemBorderColor: "",
    emblemTextMode: "initial",
    emblemAbbreviation: "",
    emblemFont: "custom",
  });
  assert.deepEqual(mapClientTeamEmblem({
    accent: "#abcdef",
    emblemKey: "teams/client.webp",
    emblemUploadCount: "2",
    emblemBorderEnabled: false,
    emblemTextMode: "abbreviation",
  }), {
    emblemKey: "teams/client.webp",
    emblemSource: "upload",
    emblemUpdatedAt: null,
    emblemUploadedAt: null,
    emblemUploadCount: 2,
    emblemColor: "#abcdef",
    emblemBorderEnabled: false,
    emblemBorderColor: "#abcdef",
    emblemTextMode: "abbreviation",
    emblemAbbreviation: "",
    emblemFont: "sport",
  });
});

test("compact API user mapping keeps public cards small and self details intact", () => {
  const ratings = {
    integrated: 1234,
    modes: { "3v3": 1240 },
    placement: { matchCount: 4 },
  };
  const user = {
    id: "profile-1",
    name: "Player",
    handle: "#player",
    hashtag: "#player",
    position: "PG",
    region: "서울",
    avatarColor: "#58d2c0",
    avatarBorderColor: null,
    trustScore: 81,
    ratings,
    ageGroup: "open",
    school: "School",
    discordConnection: { username: "player" },
  };
  assert.deepEqual(compactClientUser(user, "viewer"), {
    id: "profile-1",
    name: "Player",
    handle: "#player",
    hashtag: "#player",
    position: "PG",
    region: "서울",
    avatarColor: "#58d2c0",
    avatarKey: null,
    avatarSource: "initial",
    avatarIconKey: null,
    avatarUpdatedAt: null,
    avatarBackgroundEnabled: true,
    avatarBorderEnabled: false,
    avatarBorderColor: "#58d2c0",
    discordAvatarUrl: null,
    trustScore: 81,
    ratings: { integrated: 1234, placement: ratings.placement },
    ageGroup: "open",
  });
  const self = compactClientUser(user, "profile-1");
  assert.equal(self.ratings, ratings);
  assert.equal(self.school, "School");
  assert.equal(self.discordConnection, user.discordConnection);
});

test("team and compact user API projections stay on shared mappers", async () => {
  const [
    teamMappers,
    recruitingMappers,
    matchList,
    recruitingList,
    search,
    supabaseAdmin,
  ] = await Promise.all([
    readSource("shared/lib/teamMappers.js"),
    readSource("shared/lib/recruitingMappers.js"),
    Promise.all([
      readSource("server/api/matches/_listProjection.js"),
      readSource("server/api/matches/_listLoader.js"),
    ]).then((sources) => sources.join("\n")),
    readSourceGroup(readSource, RECRUITING_LIST_SOURCE_PATHS),
    readSource("server/api/search.js"),
    readSource("server/api/_supabaseAdmin.js"),
  ]);
  for (const source of [teamMappers, recruitingMappers, matchList, search, supabaseAdmin]) {
    assert.match(source, /projectTeamRow\(/);
  }
  assert.match(recruitingList, /compactClientUser\(/);
  assert.match(matchList, /compactClientUser\(/);
  assert.doesNotMatch(recruitingList, /function compactUser\(/);
  assert.doesNotMatch(matchList, /function compactUser\(/);
});

test("profile icon background choice and image preview stay persistent and separate", async () => {
  assert.equal(fromRemoteProfile({ id: "profile-1", name: "선수", avatar_background_enabled: false }).avatarBackgroundEnabled, false);
  assert.equal(fromRemoteProfile({ id: "profile-2", name: "선수" }).avatarBackgroundEnabled, true);

  const [dialog, emblem, api, columns, migration, styles] = await Promise.all([
    readSource("src/components/profile/ProfileIconDialog.jsx"),
    readSource("src/components/profile/ProfileEmblem.jsx"),
    readSource("server/api/profile/emblem.js"),
    readSource("shared/lib/repositoryColumns.js"),
    readSource("supabase/migrations/20260721190000_profile_icon_background_toggle.sql"),
    readCssTree("src/styles/features/profile-emblems.css"),
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
  const [dialog, achievements, achievementApi, profileActions, styles] = await Promise.all([
    readSource("src/components/profile/ProfileIconDialog.jsx"),
    readSource("src/pages/ProfileAchievements.jsx"),
    readSource("server/api/_profileIconAchievements.js"),
    readSource("src/hooks/appData/actions/profileTeamActions.js"),
    readCssTree("src/styles/features/profile-emblems.css"),
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
  assert.equal(DEFAULT_UNLOCKED_PROFILE_ICON_KEYS.length, 5);
  assert.deepEqual(
    PROFILE_ICON_CATALOG
      .filter((icon) => /^22[1-5]-referee-exam-/.test(icon.id))
      .map((icon) => icon.achievement.requirements[0].target),
    [1, 3, 5, 10, 20],
  );
  assert.match(achievementApi, /referee_exam_attempts/);
  assert.match(achievementApi, /refereeExamCompletedCount/);
  assert.match(achievementApi, /activeUnlockedRows = \(unlockedRows \?\? \[\]\)\.filter\(\(row\) => PROFILE_ICON_ID_SET\.has\(row\.icon_key\)\)/);
  assert.match(profileActions, /if \(!isSupabaseConfigured\)[\s\S]*DEFAULT_UNLOCKED_PROFILE_ICON_KEYS/);
  assert.match(profileActions, /saveLocalProfileIconPatch/);
  assert.match(profileActions, /isEmblemHexColor/);
  assert.match(profileActions, /discord_avatar_unavailable/);
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
    readGlobalStyles(),
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
  const teamDetail = await readSourceGroup(readSource, TEAM_DETAIL_SOURCE_PATHS);
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
    readRecruitingPageSource(),
    readSourceGroup(readSource, MATCHES_PAGE_SOURCE_PATHS),
    readSource("src/pages/Recorder.jsx"),
  ]);
  assert.match(emptyState, /export default function EmptyState/);
  [recruiting, matches, recorder].forEach((source) => assert.match(source, /import EmptyState/));
  assert.doesNotMatch(`${recruiting}\n${matches}\n${recorder}`, /arena-empty-state|om-empty-state|recorder-empty/);
});

test("empty home upcoming card does not keep the desktop match minimum height", async () => {
  const [home, styles] = await Promise.all([
    readHomePageSource(),
    readGlobalStyles(),
  ]);
  assert.match(home, /home-upcoming-card[^`]*\$\{upcomingItems\.length \? "" : " is-empty"\}/);
  assert.match(styles, /\.rank-home \.home-upcoming-card\.is-empty\s*\{\s*min-height:\s*auto;/);
});

test("team menu starts from curated recommendations", async () => {
  const teams = await readSource("src/pages/Teams.jsx");
  assert.match(teams, /const \[regionSido, setRegionSido\] = useState\(TEAM_DISCOVERY_VIEW\);/);
  assert.match(teams, /const \[regionDistrict, setRegionDistrict\] = useState\(defaultRegionSelection\.district\);/);
  assert.match(teams, /const TEAM_DISCOVERY_VIEW = "추천";/);
  assert.match(teams, /TEAM_SEARCH_RESULT_LIMIT = 15/);
  assert.doesNotMatch(teams, /loadMoreDirectory/);
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
    readGlobalStyles(),
  ]);
  assert.match(seasonPage, /getPlayerSeasonRows\(app\.state\.users, app\.state\.matches, season, "전체"\)/);
  assert.match(seasonPage, /const mySeasonRow = seasonPlayerRows\.find\(\(user\) => user\.id === app\.currentUser\.id\)/);
  assert.match(seasonPage, /const blockedUserIds = new Set\(app\.state\.settings\?\.blockedUserIds \?\? \[\]\)/);
  assert.equal((seasonPage.match(/\.filter\(\(user\) => !blockedUserIds\.has\(user\.id\)\)/g) ?? []).length, 2);
  assert.match(seasonPage, /전국 개인 승격권/);
  assert.match(seasonPage, /이번 시즌 플레이/);
  assert.match(seasonPage, /state=\{\{ teamPreview: team \}\}/);
  assert.match(seasonPage, /<TeamEmblem team=\{team\} size="sm" \/>/);
  assert.match(seasonPage, /to="\/app\/rankings\?view=promotion"[\s\S]*?>전체 순위<\/Button>/);
  assert.match(seasonPage, /to="\/app\/rankings\?view=promotion&tab=teams"[\s\S]*?>전체 팀 순위<\/Button>/);
  assert.doesNotMatch(seasonPage, /운영 체크|처리할 경기|getOperationsSummary|MatchRoomModal/);
  assert.match(rankingsPage, /\{ id: "region", label: "지역" \}/);
  assert.match(rankingsPage, /\{ id: "2v2", label: "2v2" \}/);
  assert.match(rankingsPage, /const promotionView = searchParams\.get\("view"\) === "promotion"/);
  assert.match(rankingsPage, /const canonicalEnabled = isSupabaseConfigured && app\.remoteReady && promotionView/);
  assert.match(rankingsPage, /useCanonicalSeasonRankings\(canonicalEnabled, season\.id\)/);
  assert.match(rankingsPage, /canonicalRankings\.data\.players/);
  assert.match(rankingsPage, /canonicalRankings\.data\.teams/);
  assert.match(rankingsPage, /승격권 기록을 불러오지 못했습니다/);
  assert.match(rankingsPage, /promotionLoading \? <BasketballLoader label="승격권 기록 불러오는 중"/);
  assert.match(rankingsPage, /directoryStatusMatches[\s\S]*placementCompleteOnly === placementCompleteOnly[\s\S]*rankingSort === rankingSort/);
  assert.match(rankingsPage, /<SeasonPromotionTable/);
  assert.match(rankingsPage, /nextSearchParams\.set\("tab", nextTab\)/);
  assert.match(styles, /\.season-race-list > \.player-hover-trigger/);
});

test("랭킹 디렉터리 실패는 요청 범위를 보존해 재시도 화면을 연다", async () => {
  const directoryLoader = await readSource("src/hooks/appData/orchestrator/directoryLoaders.js");
  assert.match(directoryLoader, /const requestPage = \{[\s\S]*placementCompleteOnly,[\s\S]*rankingSort,/);
  assert.match(directoryLoader, /loading: true, error: "", page: requestPage, cacheKey/);
  assert.match(directoryLoader, /loading: false, loaded: false[\s\S]*page: requestPage, cacheKey/);
});

test("team detail keeps navigation preview and always refreshes authoritative team data once", async () => {
  const teamDetailPage = await readSource("src/pages/TeamDetail.jsx");
  const teamDetailView = await readSource("src/pages/TeamDetailView.jsx");
  const teamHoverCard = await readSource("src/components/team/TeamHoverCard.jsx");
  assert.match(teamDetailPage, /location\.state\?\.teamPreview\?\.id === teamId/);
  assert.match(teamDetailPage, /const authoritativeTeam = app\.state\.teams\.find/);
  assert.match(teamDetailPage, /const team = authoritativeTeam \?\? \(!teamDetailReady \? previewTeam : null\)/);
  assert.match(teamDetailPage, /const canManage = teamDetailReady[\s\S]{0,180}authoritativeCaptain\?\.userId === app\.currentUser\.id/);
  assert.match(teamDetailPage, /authoritativeTeam\?\.membersPartial !== true/);
  assert.match(teamDetailPage, /const refreshTeamDetail = useCallback\(async \(\) => \{/);
  assert.match(teamDetailPage, /const loaded = await loadDirectory\(\{ force: true, teamId \}\)/);
  assert.match(teamDetailPage, /error: loaded === true \? "" : "팀 정보를 불러오지 못했습니다\."/);
  assert.match(teamDetailPage, /if \(detailRequestRef\.current !== teamId\)/);
  assert.match(teamDetailPage, /detailRequestRef\.current = teamId;\s+refreshTeam\(\);/);
  assert.match(teamDetailPage, /!team && teamDetailError/);
  assert.match(teamDetailPage, /!team && !teamDetailReady && app\.remoteReady !== false/);
  assert.match(teamDetailView, /teamDetailError[\s\S]{0,420}refreshTeamDetail\(\)[\s\S]{0,120}다시 시도/);
  assert.match(teamDetailPage, /const result = await app\.actions\.inviteTeamMember/);
  assert.match(teamDetailPage, /if \(!result \|\| result\.ok === false\)/);
  assert.match(teamDetailPage, /if \(!canAddMember \|\| teamInvitePendingRef\.current \|\| teamManagementPendingRef\.current\) return;/);
  assert.match(teamDetailView, /disabled=\{!canAddMember \|\| teamControlPending\}/);
  assert.match(teamDetailView, /result=\{record\.result\}/u);
  assert.doesNotMatch(teamDetailView, /getScoreOutcome/u);
  assert.match(teamDetailView, /const inviteRoleOptions = TEAM_INVITE_ROLES\.map/u);
  assert.match(teamDetailView, /function getManagedRoleOptions\(member, captainId\)/u);
  assert.match(teamDetailPage, /const result = await app\.actions\.toggleFavoriteTeam\(team\.id, team\)/);
  assert.match(teamDetailPage, /if \(deleted\) navigate\("\/app\/teams", \{ replace: true \}\)/);
  assert.match(teamDetailView, /toggleTeamFavorite\(\)/);
  assert.match(teamHoverCard, /navigate\(teamPath, \{ state: \{ teamPreview: team \} \}\)/);
  assert.match(teamHoverCard, /state=\{\{ teamPreview: team \}\}/);
});

test("blocked player labels remain identifiable after directory filtering", async () => {
  const [settingsRepository, settingsActions, settingsServer, settingsView] = await Promise.all([
    readSource("src/data/repository/settings.js"),
    readSource("src/hooks/appData/actions.js"),
    readSource("server/api/settings/sync.js"),
    readSource("src/pages/SettingsSideColumn.jsx"),
  ]);
  assert.match(settingsRepository, /blockedUserProfiles/);
  assert.match(settingsRepository, /userProfile\?\.id === userId \? userProfile/);
  assert.match(settingsActions, /syncSettingsServer\(\{ blockedUserIds: nextBlockedUserIds, blockedUserProfiles: nextBlockedUserProfiles \}\)/);
  assert.match(settingsActions, /targetProfile \?\? stateRef\.current\.users\.find/);
  assert.match(settingsServer, /settingsPatch\.blockedUserProfiles/);
  assert.match(settingsView, /blockedUserProfiles\?\.\[userId\]\?\.name/);
});

test("team creation requires one active approved home court selection", async () => {
  const [teamsPage, teamRepository, teamServer, backendSimulation] = await Promise.all([
    readSource("src/pages/Teams.jsx"),
    readSource("src/data/repository/account.js"),
    readSource("server/api/teams/sync-team.js"),
    readSource("scripts/simulate-backend-flow.mjs"),
  ]);
  assert.match(teamsPage, /homeCourtId: ""/);
  assert.match(teamsPage, /court\.id === draft\.homeCourtId && court\.name === draft\.homeCourt/);
  assert.match(teamsPage, /homeCourt: court\.name, homeCourtId: court\.id/);
  assert.match(teamsPage, /teamNameInvalid \|\| homeCourtInvalid/);
  assert.match(teamsPage, /teamCreatePendingRef\.current \|\| teamCreatePending/);
  assert.match(teamsPage, /teamCreatePendingRef\.current = true[\s\S]*finally \{[\s\S]*teamCreatePendingRef\.current = false/);
  assert.match(teamsPage, /setSelectedSearchTeam\(team\)/);
  assert.match(teamsPage, /selectedSearchTeam && !rankingTeams\.some/);
  assert.match(teamRepository, /homeCourtId: teamDraft\.homeCourtId/);
  assert.match(teamServer, /from\("approved_courts"\)[\s\S]*?\.eq\("id", team\.homeCourtId\)[\s\S]*?\.eq\("status", "active"\)/);
  assert.match(teamServer, /new Error\("invalid_team_home_court"\)/);
  assert.match(teamServer, /team\.homeCourt = approvedCourt\.name/);
  assert.match(backendSimulation, /runTeamLifecycleScenario[\s\S]*?homeCourtId: simulationCourtId/);
  assert.match(backendSimulation, /runTeamEmblemModerationScenario[\s\S]*?homeCourtId: simulationCourtId/);
  assert.match(backendSimulation, /setRepresentativeTeam[\s\S]*?rejectNonMemberRepresentativeTeam[\s\S]*?representativeTeamDeleteFallback/);
  assert.match(backendSimulation, /memberRoleUpdated: true[\s\S]*?memberRemoved: true/);
});

test("team lifecycle reducer preserves invitation, role, removal, and deletion invariants", () => {
  let state = {
    currentUserId: "captain",
    users: [{ id: "captain" }, { id: "member" }],
    teams: [],
    teamInvitations: [],
    recruitingPosts: [],
    notifications: [],
    settings: {},
  };
  state = createTeam(state, { name: "QA TEAM", homeCourt: "QA COURT", homeCourtId: "court-qa", region: "서울" });
  const teamId = state.teams[0].id;
  state = inviteTeamMember(state, teamId, "member", "regular");
  const invitationId = state.teamInvitations[0].id;
  state = acceptTeamInvitation({ ...state, currentUserId: "member" }, invitationId);
  assert.equal(state.teams[0].members.find((member) => member.userId === "member")?.role, "regular");
  state = updateTeamMemberRole({ ...state, currentUserId: "captain" }, teamId, "member", "mercenary");
  assert.equal(state.teams[0].members.find((member) => member.userId === "member")?.role, "mercenary");
  state = removeTeamMember(state, teamId, "member");
  assert.deepEqual(state.teams[0].members, [{ userId: "captain", role: "captain" }]);
  state = deleteTeam(state, teamId);
  assert.equal(state.teams.length, 0);
  assert.deepEqual(state.deletedTeamIds, [teamId]);
});

test("team deletion expires pending invitations and falls back from the deleted representative team", () => {
  const state = {
    currentUserId: "captain",
    teams: [
      { id: "deleted", name: "삭제 팀", members: [{ userId: "captain", role: "captain" }] },
      { id: "fallback", name: "대체 팀", members: [{ userId: "captain", role: "regular" }] },
    ],
    teamInvitations: [
      { id: "pending", teamId: "deleted", status: "pending" },
      { id: "accepted", teamId: "deleted", status: "accepted" },
    ],
    recruitingPosts: [],
    notifications: [],
    settings: { representativeTeamId: "deleted", favoriteTeamIds: ["deleted"] },
  };
  const next = deleteTeam(state, "deleted");
  assert.deepEqual(next.teams.map(({ id }) => id), ["fallback"]);
  assert.equal(next.teamInvitations.find(({ id }) => id === "pending").status, "expired");
  assert.equal(next.teamInvitations.find(({ id }) => id === "accepted").status, "accepted");
  assert.equal(next.settings.representativeTeamId, "fallback");
  assert.deepEqual(next.settings.favoriteTeamIds, []);
});

test("team invitation reducer preserves authority and terminal states", () => {
  const team = {
    id: "team-guard",
    name: "GUARD",
    members: [{ userId: "captain", role: "captain" }],
  };
  const base = {
    currentUserId: "outsider",
    users: [{ id: "captain" }, { id: "member" }],
    teams: [team],
    teamInvitations: [],
    notifications: [],
    settings: {},
  };
  const denied = inviteTeamMember(base, team.id, "member");
  assert.equal(denied.teamInvitations.length, 0);
  assert.match(denied.notifications[0].title, /권한 없음/);

  const invited = inviteTeamMember({ ...base, currentUserId: "captain" }, team.id, "member");
  const invitationId = invited.teamInvitations[0].id;
  assert.equal(acceptTeamInvitation({ ...invited, currentUserId: "outsider" }, invitationId).teams[0].members.length, 1);
  assert.equal(declineTeamInvitation({ ...invited, currentUserId: "member" }, invitationId).teamInvitations[0].status, "declined");
  assert.equal(cancelTeamInvitation(invited, invitationId).teamInvitations[0].status, "cancelled");
  assert.equal(inviteTeamMember(invited, team.id, "member").teamInvitations.length, 1);
});

test("favorite reducers add, remove, and validate current or retired targets", () => {
  const users = [
    { id: "me", name: "나" },
    { id: "player", name: "선수" },
    { id: "referee", name: "심판", trustScore: 95 },
  ];
  const state = {
    currentUserId: "me",
    users,
    teams: [{ id: "team", members: [] }],
    settings: {
      approvedCourts: [{ id: "court", name: "구장", status: "active" }],
      refereeAppointments: [{ userId: "referee", role: "referee", grade: "candidate", status: "active" }],
      favoritePlayerIds: [],
      favoriteTeamIds: [],
      favoriteCourtIds: [],
      favoriteRefereeIds: [],
    },
  };
  const added = [
    [toggleFavoritePlayer, "player", "favoritePlayerIds"],
    [toggleFavoriteTeam, "team", "favoriteTeamIds"],
    [toggleFavoriteCourt, "court", "favoriteCourtIds"],
    [toggleFavoriteReferee, "referee", "favoriteRefereeIds"],
  ].reduce((current, [toggle, id]) => toggle(current, id), state);
  assert.deepEqual(added.settings.favoritePlayerIds, ["player"]);
  assert.deepEqual(added.settings.favoriteTeamIds, ["team"]);
  assert.deepEqual(added.settings.favoriteCourtIds, ["court"]);
  assert.deepEqual(added.settings.favoriteRefereeIds, ["referee"]);
  assert.deepEqual(toggleFavoritePlayer(added, "missing").settings.favoritePlayerIds, ["player"]);
  assert.deepEqual(toggleFavoriteReferee(added, "player").settings.favoriteRefereeIds, ["referee"]);
  assert.deepEqual(toggleFavoritePlayer(added, "player").settings.favoritePlayerIds, []);
  const retired = {
    ...added,
    users: [{ id: "me" }],
    teams: [],
    settings: { ...added.settings, approvedCourts: [], refereeAppointments: [] },
  };
  assert.deepEqual(toggleFavoritePlayer(retired, "player").settings.favoritePlayerIds, []);
  assert.deepEqual(toggleFavoriteTeam(retired, "team").settings.favoriteTeamIds, []);
  assert.deepEqual(toggleFavoriteCourt(retired, "court").settings.favoriteCourtIds, []);
  assert.deepEqual(toggleFavoriteReferee(retired, "referee").settings.favoriteRefereeIds, []);
});

test("court review and uploaded team emblem reports preserve eligibility and duplicate guards", () => {
  const base = {
    currentUserId: "reporter",
    users: [{ id: "reporter" }, { id: "reviewer" }, { id: "captain" }],
    teams: [{
      id: "team",
      name: "신고 팀",
      emblemSource: "upload",
      emblemKey: "team/team.webp",
      members: [{ userId: "captain", role: "captain" }],
    }],
    reports: [],
    notifications: [],
    settings: { courtReviews: [{ id: "review", reviewerId: "reviewer", courtName: "신고 구장" }] },
  };
  const reviewReported = reportCourtReview(base, "review", "허위 리뷰");
  assert.equal(reviewReported.reports[0].type, "court_review");
  assert.equal(reportCourtReview(reviewReported, "review", "중복").reports.length, 1);
  assert.equal(reportCourtReview({ ...base, currentUserId: "reviewer" }, "review").reports.length, 0);

  const emblemReported = reportTeamEmblem(base, "team", "부적절한 이미지");
  assert.equal(emblemReported.reports[0].type, "team_emblem");
  assert.deepEqual(emblemReported.reports[0].reportedUserIds, ["captain"]);
  assert.equal(reportTeamEmblem(emblemReported, "team", "중복").reports.length, 1);
  assert.equal(reportTeamEmblem({ ...base, currentUserId: "captain" }, "team").reports.length, 0);
});

test("match reports keep one unresolved row per reporter and match", () => {
  const state = {
    currentUserId: "reporter",
    matches: [{
      id: "match",
      title: "신고 경기",
      endedAt: new Date().toISOString(),
      teamA: { players: ["reporter"] },
      teamB: { players: ["opponent"] },
    }],
    reports: [],
    notifications: [],
    settings: {},
  };
  const first = reportMatch(state, "match", "첫 신고", ["opponent"]);
  const duplicate = reportMatch(first, "match", "중복 신고", ["opponent"]);
  assert.equal(first.reports.length, 1);
  assert.equal(duplicate, first);
});

test("court fuzzy search tolerates one edit without opening one-character queries", () => {
  const court = { name: "연북중학교 농구장", address_text: "서울특별시 마포구 연남동" };
  assert.equal(isCourtFuzzyMatch(court, "연북중학고"), true);
  assert.equal(isCourtFuzzyMatch(court, "연남동"), true);
  assert.equal(isCourtFuzzyMatch(court, "연"), false);
  assert.equal(isCourtFuzzyMatch(court, "부산진구"), false);
});

test("search keeps player and referee identities separate and remote blocking updates immediately", async () => {
  const searchPicker = await readSource("src/components/common/SearchPicker.jsx");
  assert.match(searchPicker, /categoryKey = String\(category \|\| "entity"\)\.toLowerCase\(\) === "profile"/);
  assert.match(searchPicker, /`id:\$\{categoryKey\}:\$\{identity\}`/);
  assert.match(searchPicker, /mergeSearchItems\(localItems, mappedRemoteItems, remoteSearchCategory\)/);

  const state = {
    currentUserId: "me",
    users: [{ id: "me", name: "나" }],
    settings: { blockedUserIds: [] },
    teamInvitations: [
      { id: "blocked-team", targetUserId: "me", fromUserId: "remote-user" },
      { id: "visible-team", targetUserId: "me", fromUserId: "other-user" },
    ],
    recruitingPosts: [{
      id: "room",
      roomState: { invitations: [
        { id: "blocked-room", targetUserId: "me", fromUserId: "remote-user" },
        { id: "visible-room", targetUserId: "me", fromUserId: "other-user" },
      ] },
    }],
    notifications: [
      { id: "blocked-notice", targetUserId: "me", fromUserId: "remote-user" },
      { id: "visible-notice", targetUserId: "me", fromUserId: "other-user" },
    ],
  };
  const next = blockUser(state, "remote-user", { id: "remote-user", name: "원격 선수", hashtag: "#remote" });
  assert.deepEqual(next.settings.blockedUserIds, ["remote-user"]);
  assert.deepEqual(next.settings.blockedUserProfiles["remote-user"], { name: "원격 선수", hashtag: "#remote" });
  assert.deepEqual(next.teamInvitations.map(({ id }) => id), ["visible-team"]);
  assert.deepEqual(next.recruitingPosts[0].roomState.invitations.map(({ id }) => id), ["visible-room"]);
  assert.equal(next.notifications.some(({ id }) => id === "blocked-notice"), false);
  const unblocked = unblockUser(next, "remote-user");
  assert.deepEqual(unblocked.settings.blockedUserIds, []);
  assert.deepEqual(unblocked.settings.blockedUserProfiles, {});
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
    readRecruitingPageSource(),
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
  assert.match(csp, /media-src 'self' blob: data:/);
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

test("postgame dispute reminders follow each configured window", () => {
  assert.deepEqual(getMatchDisputeReminderTiming({ disputeMinutes: 10 }), {
    windowMinutes: 10,
    leadMinutes: 5,
    offsetMinutes: 5,
  });
  assert.deepEqual(getMatchDisputeReminderTiming({ disputeMinutes: 15 }), {
    windowMinutes: 15,
    leadMinutes: 5,
    offsetMinutes: 10,
  });
  assert.deepEqual(getMatchDisputeReminderTiming({ disputeMinutes: 20 }), {
    windowMinutes: 20,
    leadMinutes: 5,
    offsetMinutes: 15,
  });
  assert.deepEqual(getMatchDisputeReminderTiming({ disputeMinutes: 30 }), {
    windowMinutes: 15,
    leadMinutes: 5,
    offsetMinutes: 10,
  });
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

test("깨진 대회 알림 보정은 식별된 단일 운영 row만 갱신한다", async () => {
  const migration = await readSource("supabase/migrations/20260802010000_repair_corrupted_tournament_notification.sql");
  assert.match(migration, /created_at = timestamptz '2026-07-26 18:26:59\.25077\+00'/);
  assert.match(migration, /payload->>'tournamentId' = 'trn_mrzoso61_499880eb3c'/);
  assert.match(migration, /title = '\?\?\? \?\?\?'/);
  assert.doesNotMatch(migration.replace(/--[^\r\n]*/g, ""), /\b(?:delete|truncate|drop table)\b/i);
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

test("profile records use actual participation and split individual, team, and personal records", () => {
  const playedAt = "2026-07-20T10:00:00.000Z";
  const teamMatch = {
    id: "team-match",
    status: "confirmed",
    scheduledAt: playedAt,
    teamA: { teamId: "team-a", players: ["active-a"] },
    teamB: { teamId: "team-b", players: ["active-b"] },
    playedPlayerIds: { teamA: ["played-a"], teamB: [] },
    reservePlayers: { teamA: ["late-reserve", "played-a"], teamB: [] },
  };
  const individualMatch = {
    id: "individual-match",
    status: "confirmed",
    scheduledAt: playedAt,
    teamA: { players: ["played-a"] },
    teamB: { players: ["other"] },
  };
  const personalRecord = {
    id: "personal-record",
    status: "confirmed",
    scheduledAt: playedAt,
    rules: { recordType: "solo" },
    teamA: { players: ["played-a"] },
    teamB: { players: ["anonymous"] },
  };

  assert.equal(getActualMatchPlayerSideName(teamMatch, "played-a"), "teamA");
  assert.equal(getActualMatchPlayerSideName(teamMatch, "active-a"), "teamA");
  assert.equal(getActualMatchPlayerSideName(teamMatch, "late-reserve"), null);
  assert.deepEqual(getActualMatchPlayerIds(teamMatch), ["played-a", "active-a", "active-b"]);
  assert.equal(getMatchParticipationType(teamMatch), "team");
  assert.equal(getMatchParticipationType(individualMatch), "individual");
  assert.equal(getMatchParticipationType(personalRecord), "personal");
  assert.deepEqual(
    getPlayerRecentRecordMatches(
      [teamMatch, individualMatch, personalRecord],
      "late-reserve",
      { now: new Date("2026-07-21T00:00:00.000Z") },
    ),
    [],
  );
  assert.deepEqual(
    getPlayerRecentRecordMatches(
      [teamMatch, individualMatch, personalRecord],
      "played-a",
      { now: new Date("2026-07-21T00:00:00.000Z") },
    ).map((matchItem) => matchItem.id).sort(),
    ["individual-match", "personal-record", "team-match"],
  );
});

test("home recent records hydrate authoritative played and reserve fields", async () => {
  const source = await readSource("server/api/matches/_listLoader.js");
  assert.match(source, /const recentCompletedIds = new Set\(recentCompletedPage\?\.ids \?\? \[\]\)/);
  assert.match(source, /!feedCardIds\.has\(id\) \|\| recentCompletedIds\.has\(id\)/);
});

test("home loads the authoritative profile record page when bootstrap has no record detail", async () => {
  const source = await readSource("src/pages/Home.jsx");
  assert.match(source, /!app\.remoteReady \|\| app\.actions\.profileRecordsLoaded \|\| !app\.actions\.loadProfileRecords/);
  assert.match(source, /app\.actions\.loadProfileRecords\(\)/);
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
    readHomePageSource(),
    readSource("src/components/court/CourtHoverCard.jsx"),
    readRecruitingPageSource(),
    readSourceGroup(readSource, MATCHES_PAGE_SOURCE_PATHS),
    readSource("src/components/match/MatchListCard.jsx"),
    readSourceGroup(readSource, RECRUITING_LIST_SOURCE_PATHS),
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
  courts.push({ ...courts[0], id: "court-mapo-rated", recommendationScore: 5 });

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
    ["court-mapo-rated", "court-mapo"],
  );
  assert.equal(mergeCourtSearchCourts(courts, [courts[1], { id: "court-remote", name: "원격 구장" }]).length, 4);

  const [teams, createMatch] = await Promise.all([
    readSource("src/pages/Teams.jsx"),
    readCreateMatchPageSource(),
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
  assert.equal(COURT_DUPLICATE_REPORT_REASON, "중복 구장");
  assert.equal(getReportTargetType(COURT_DUPLICATE_REPORT_REASON), REPORT_TARGET_TYPES.court);
  assert.equal(getCourtCorrectionFieldForReportReason("구장 위치 오류"), "location");
  assert.equal(getCourtCorrectionFieldForReportReason("구장 상태 위험"), "operation");
  assert.equal(getCourtCorrectionFieldForReportReason(COURT_DUPLICATE_REPORT_REASON), "duplicate");

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
  const rejectedState = resolveMatchDispute(
    state,
    disputedMatch.id,
    "dispute-open",
    "rejected",
    "현장 점수와 기존 결과가 일치함",
  );
  assert.equal(rejectedState.matches[0].status, "approval");
  assert.equal(rejectedState.matches[0].result.scoreA, 10);
  assert.match(rejectedState.notifications[0].body, /방장이 최종 승인/);

  const [matchRoom, recruiting, matchSync, reportSubmit, adminReview, migration, cleanupMigration, disputeBoundMigration, disputeNormalizationMigration] = await Promise.all([
    readSourceGroup(readSource, MATCH_ROOM_SOURCE_PATHS),
    readRecruitingPageSource(),
    readSourceGroup(readSource, MATCH_SYNC_SOURCE_PATHS),
    readSource("server/api/reports/submit.js"),
    readSource("server/api/admin/review-action.js"),
    readSource("supabase/migrations/20260721210000_match_void_review_and_dispute_rejection.sql"),
    readSource("supabase/migrations/20260725010000_remove_legacy_match_dispute_actions.sql"),
    readSource("supabase/migrations/20260725014000_restore_dispute_points_upper_bound.sql"),
    readSource("supabase/migrations/20260725015000_preserve_dispute_wrapper_normalization_health.sql"),
  ]);
  assert.match(matchRoom, /MatchDisputeQueue/);
  assert.match(recruiting, /경기 무효 처리/);
  assert.match(matchSync, /rankball_match_resolve_dispute_action/);
  assert.doesNotMatch(matchSync, /rankball_match_(resume_approval|reject_dispute)_action/);
  assert.match(matchSync, /p_reason: operation\.reason/);
  assert.match(reportSubmit, /matchReviewType:\s*"void_restore"/);
  assert.match(adminReview, /rankball_review_void_match_report/);
  assert.match(migration, /char_length\(safe_reason\) < 10/);
  assert.match(migration, /'restoreMatchHalf'/);
  assert.match(migration, /public_room_suspension/);
  assert.match(cleanupMigration, /drop function if exists public\.rankball_match_resume_approval_action/);
  assert.match(cleanupMigration, /drop function if exists public\.rankball_match_reject_dispute_action/);
  assert.match(disputeBoundMigration, /round\(requested_points_text::numeric\) > 999/);
  assert.match(disputeBoundMigration, /raise exception 'match_stat_value_out_of_range'/);
  assert.match(disputeNormalizationMigration, /rankball_normalize_dispute_minutes\(null\)/);
  assert.match(disputeNormalizationMigration, /rankball_match_dispute_action_pre_points_bound/);
});

test("core consumers do not restore duplicated policy literals", async () => {
  const [repository, matchUtils, recruitingPage, matchSync, recruitingSync, profileEmblem, teamEmblem, discordBridge] = await Promise.all([
    readSourceTree("src/data/repository"),
    readSource("shared/lib/matchUtils.js"),
    readRecruitingPageSource(),
    readSource("server/api/matches/sync-match.js"),
    Promise.all([
      readSource("server/api/recruiting/_syncPostCommon.js"),
      readSource("server/api/recruiting/_syncPostProjection.js"),
      readSource("server/api/recruiting/_syncPostPolicy.js"),
      readSource("server/api/recruiting/_syncPostActions.js"),
      readSource("server/api/recruiting/_syncPostResponse.js"),
      readSource("server/api/recruiting/_syncPostChat.js"),
      readSource("server/api/recruiting/_syncPostPersistence.js"),
      readSource("server/api/recruiting/_syncPostHandler.js"),
    ]).then((sources) => sources.join("\n")),
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
  const recruitingPage = await readRecruitingPageSource();
  assert.doesNotMatch(recruitingPage, /toggleSingleInvitePlayer/);
  assert.ok((recruitingPage.match(/onTogglePlayer=\{toggleInvitePlayer\}/g) ?? []).length >= 2);
});

test("team management mutations are serialized and participant setup stays recoverable", async () => {
  const [teamDetail, teamDetailView, participantSetup] = await Promise.all([
    readSource("src/pages/TeamDetail.jsx"),
    readSource("src/pages/TeamDetailView.jsx"),
    readSource("src/components/recruiting/MatchRecordParticipantSetupPanel.jsx"),
  ]);

  assert.match(teamDetail, /teamManagementPendingRef\.current/);
  assert.match(teamDetail, /const runTeamManagementMutation = async/);
  assert.match(teamDetail, /finally \{\s*teamManagementPendingRef\.current = false;\s*setTeamManagementPending\(false\);/);
  assert.match(teamDetailView, /const teamControlPending = teamInvitePending \|\| teamManagementPending/);
  assert.doesNotMatch(teamDetailView, /app\.actions\.(cancelTeamInvitation|updateTeamMemberRole|removeTeamMember)/);
  assert.match(participantSetup, /getTeamCaptainMemberId\(team\)/);
  assert.match(participantSetup, /if \(team\.id === teamAId\) return "A사이드와 같은 팀"/);
  assert.match(participantSetup, /if \(captainId === selectedTeamACaptainId\) return "A사이드와 같은 팀장"/);
  assert.match(participantSetup, /disabled=\{Boolean\(ineligibilityReason\)\}/);
  assert.doesNotMatch(participantSetup, /match\?\.updatedAt/);
  assert.match(participantSetup, /catch \{\s*setFeedback\("참가자 구성을 저장하지 못했습니다\. 잠시 후 다시 시도해 주세요\."\);\s*\} finally \{\s*setSaving\(false\);/);
});

test("team discovery uses canonical regions and bounded deduplicated groups", () => {
  const currentUser = {
    id: "me",
    region: "서울특별시 성동구",
    ageGroup: "adult",
    affiliationId: "affiliation-1",
    ratings: { integrated: 1280 },
  };
  const users = [
    { id: "rival-member", ageGroup: "adult" },
    { id: "young-member", ageGroup: "youth" },
    { id: "affiliation-member", ageGroup: "open", affiliationId: "affiliation-1" },
    { id: "nearby-affiliation-member", ageGroup: "adult", affiliationId: "affiliation-1" },
  ];
  const nearbyTeams = Array.from({ length: 6 }, (_, index) => ({
    id: `nearby-${index + 1}`,
    name: `주변 ${index + 1}`,
    region: "성동",
    mmr: 1280 + index,
    members: index === 0 ? [{ userId: "nearby-affiliation-member" }] : [],
  }));
  const teams = [
    { id: "own-team", name: "내 팀", region: "성동", mmr: 1280, members: [{ userId: "me" }] },
    ...nearbyTeams,
    { id: "rival-team", name: "라이벌", region: "마포", mmr: 1300, members: [{ userId: "rival-member" }] },
    { id: "wrong-age-team", name: "다른 연령", region: "마포", mmr: 1290, members: [{ userId: "young-member" }] },
    { id: "affiliation-team", name: "같은 소속", region: "마포", mmr: 1700, members: [{ userId: "affiliation-member" }] },
  ];

  const groups = getTeamDiscoveryGroups({
    teams,
    users,
    currentUser,
    ownTeamIds: ["own-team"],
  });
  const allTeamIds = Object.values(groups).flat().map((team) => team.id);

  assert.equal(groups.nearby.length, 5);
  assert.ok(groups.nearby.every((team) => team.region === "성동"));
  assert.deepEqual(groups.rivals.map((team) => team.id), ["rival-team"]);
  assert.deepEqual(groups.affiliation.map((team) => team.id), ["affiliation-team"]);
  assert.equal(new Set(allTeamIds).size, allTeamIds.length);
  assert.equal(allTeamIds.includes("own-team"), false);
  assert.equal(allTeamIds.includes("wrong-age-team"), false);
});

test("referee rulebook matches current FIBA and BOXTIER operating rules", async () => {
  const rulebookText = JSON.stringify({
    easy: REFEREE_RULEBOOK_EASY_SECTIONS,
    sections: REFEREE_RULEBOOK_SECTIONS,
    stats: REFEREE_STAT_GUIDELINES,
    checklist: REFEREE_RULEBOOK_CHECKLIST,
    notice: REFEREE_RULEBOOK_NOTICE,
  });
  const page = await readSource("src/pages/RefereeRulebook.jsx");
  const tutorial = (await Promise.all([
    readSource("src/pages/GettingStarted.jsx"),
    readSource("src/pages/gettingStartedGuidePrimary.jsx"),
    readSource("src/pages/gettingStartedGuideSecondary.jsx"),
  ])).join("\n");
  const recruiting = await readRecruitingPageSource();
  const matchRoom = await readSourceGroup(readSource, MATCH_ROOM_SOURCE_PATHS);
  const matchClockPanel = await readSourceGroup(readSource, MATCH_CLOCK_PANEL_SOURCE_PATHS);

  assert.equal(REFEREE_EXAM_VERSION, "rankball-referee-2026-07");
  assert.equal(REFEREE_RULEBOOK_EASY_SECTIONS.length, 6);
  assert.match(rulebookText, /QR 출석과 실제 출전은 다름/);
  assert.match(rulebookText, /개인기록은 심판 경기만/);
  assert.match(rulebookText, /턴오버\(TO\).*공격권을 상대에게 넘긴 선수/);
  assert.doesNotMatch(rulebookText, /림 위 원통|4번 드리블|낮은 가중치/);
  assert.match(rulebookText, /1m 안에서 밀착 수비/);
  assert.match(rulebookText, /비접촉 테크니컬/);
  assert.match(rulebookText, /10분·15분·20분/);
  assert.match(rulebookText, /심판 경기는 배정 심판, 무심판 경기는 방장이 판정/);
  assert.match(rulebookText, /사용 안 함·24초·30초·60초/);
  assert.match(rulebookText, /자동 공격권 판정과 14초 자동 재설정은 지원하지 않습니다/);
  assert.match(rulebookText, /현재 경기시계 담당자는 담당 기기에 연결된 워치·비오디오 미디어 리모컨의 재생·일시정지 입력으로 샷클락을 초기화/);
  assert.match(rulebookText, /이어폰·헤드셋은 부저 출력과 충돌할 수 있어 지원 대상으로 안내하지 않습니다/);
  assert.match(rulebookText, /무심판 경기에는 개인활약 입력과 빈 0 스탯을 만들지 않습니다/);
  assert.match(rulebookText, /지각 QR만 찍고 실제 교체하지 않은 선수는 실제 출전 기록·개인 전적·MMR 대상이 아닙니다/);
  assert.match(rulebookText, /만료됐거나 다른 경기에 발급됐거나 서명이 잘못된 QR과 미등록 사용자의 스캔은 서버에서 거부합니다/);
  assert.match(rulebookText, /체크인 참가자 표는 3초, 경기 전 QR 패널은 15초, 경기시계와 지각 QR은 3초/);
  assert.match(rulebookText, /마지막 요청을 판정해도 자동 확정하지 않고 별도 최종 승인을 기다립니다/);
  assert.match(rulebookText, /모든 실제 출전선수는 개인기록 입력 또는 심판의 0 기록 확인이 필요합니다/);
  assert.match(rulebookText, /통합은 실제 출전한 공식 개인전과 팀전의 합계/);
  assert.match(rulebookText, /MMR은 실력이 비슷한 상대를 찾고 순위를 계산하는 경기력 점수/);
  assert.doesNotMatch(rulebookText, /일반 live 경기|personal_record|match_record|결과 revision|교체 transaction/);
  assert.match(rulebookText, /상세 산식과 내부 보정값은 공개하지 않습니다/);
  assert.doesNotMatch(rulebookText, /1v1 10%|2v2 20%|3v3 35%|5v5 50%|상위 최대 5명 평균|정규멤버 비율만큼|-150부터 \+150/);
  assert.match(tutorial, /상세 산식은 공개하지 않습니다/);
  assert.doesNotMatch(tutorial, /1v1 10%|2v2 20%|3v3 35%|5v5 50%|상위 5명 평균|정규멤버 비율만큼|MMR 100%|성과 보정은 0%/);
  assert.doesNotMatch(recruiting, /MMR 반영률:|현장 직접 90%|완전 랜덤 100%|MMR 균형 110%|팀원의 비율을 기준|ratingScale \* 100/);
  assert.doesNotMatch(matchRoom, /정규 · MMR \$\{|ratingScale \?\?/);
  assert.doesNotMatch(matchClockPanel, /시계 미사용 시 MMR은|fallbackFactor \* 100/);
  assert.doesNotMatch(rulebookText, /마지막 요청을 판정하면 별도 재승인 없이 결과가 확정/);
  assert.match(rulebookText, /기록 확정 뒤 24시간 추천·신고 안내/);
  assert.doesNotMatch(rulebookText, /따봉/);
  assert.doesNotMatch(rulebookText, /30분 또는 60분|새 과반 승인/);
  assert.match(rulebookText, /손에서 떠나기 전이어도 블록/);
  assert.match(page, /FIBA 경기규칙 2024/);
  assert.match(page, /FIBA 통계 매뉴얼 2024/);
  assert.match(page, /RULEBOOK_ASSET_VERSION/);
  assert.match(page, /쉬운 규칙/);
  assert.match(page, /상세 규칙/);
  assert.match(page, /searchParams\.get\("level"\) === "detail"/);
});

test("심판 시험은 저장된 시작 attempt를 복구하고 정확한 전체 답안만 완료한다", async () => {
  const { questionIds, questions } = createRefereeExamSet("referee-resume", REFEREE_EXAM_SIZE);
  const startedAttempt = {
    id: "rea_resume",
    userId: "user-a",
    status: "started",
    startedAt: "2026-07-31T10:00:00.000Z",
    questions,
  };
  const completedAttempt = { ...startedAttempt, id: "rea_done", status: "passed", startedAt: "2026-07-24T10:00:00.000Z", finishedAt: "2026-07-24T10:10:00.000Z" };
  const answers = Object.fromEntries(questionIds.map((questionId) => [questionId, 0]));

  assert.equal(getResumableRefereeExamAttempt([completedAttempt, startedAttempt], "user-a")?.id, startedAttempt.id);
  assert.equal(getResumableRefereeExamAttempt([completedAttempt], "user-a"), null);
  assert.equal(hasCompleteRefereeExamAnswers(questionIds, answers), true);
  assert.equal(hasCompleteRefereeExamAnswers(questionIds, { ...answers, [questionIds[0]]: 4 }), false);
  assert.equal(hasCompleteRefereeExamAnswers(questionIds, Object.fromEntries(Object.entries(answers).slice(1))), false);
  assert.equal(hasCompleteRefereeExamAnswers(questionIds, { ...answers, extra: 0 }), false);
  const refereeSyncSource = await readSource("server/api/referee/sync.js");
  const refereeControllerSource = await readSource("src/pages/useSettingsRefereeController.js");
  const refereeSectionSource = await readSource("src/pages/SettingsRefereeSection.jsx");
  assert.match(refereeSyncSource, /hasCompleteRefereeExamAnswers\(questionIds, attempt\.answers\)/);
  assert.match(refereeSyncSource, /incomplete_exam_answers/);
  assert.match(refereeControllerSource, /getResumableRefereeExamAttempt/);
  assert.match(refereeControllerSource, /refereeActionPendingRef\.current/);
  assert.match(refereeSectionSource, /disabled=\{Boolean\(refereeActionPending\)/);
});

test("랭킹·홈·선수 상세·소속 화면은 원격 페이지와 실패 상태를 보존한다", async () => {
  const [rankings, loaderActions, home, homeSearch, playerDetail, affiliations] = await Promise.all([
    readSource("src/pages/Rankings.jsx"),
    readSource("src/hooks/appData/actions/loaderActions.js"),
    readSource("src/pages/Home.jsx"),
    readSource("src/pages/useHomeSearchModel.jsx"),
    readSource("src/pages/PlayerDetail.jsx"),
    readSource("src/pages/Affiliations.jsx"),
  ]);
  assert.match(rankings, /rankingSort/);
  assert.match(rankings, /const directoryLoading = !promotionView && !directoryLoadError/);
  assert.match(rankings, /directoryLoading[\s\S]*?<BasketballLoader label="랭킹 불러오는 중"/);
  assert.match(rankings, /useEffect\(\(\) => \{\s*if \(promotionView\) return;/);
  assert.match(rankings, /\{!promotionView && directoryStatusMatches && app\.directoryStatus\?\.page\?\.hasMore/);
  assert.match(loaderActions, /rankingSort: current\.page\?\.rankingSort/);
  assert.match(home, /!blockedUserIds\.includes\(item\.id\)/);
  assert.match(homeSearch, /blockedUserIdSet\.has\(item\.id\)\) return null/);
  assert.match(homeSearch, /favoritePlayerIds[\s\S]*blockedUserIdSet\.has\(playerId\)/);
  assert.match(homeSearch, /favoriteRefereeIds[\s\S]*blockedUserIdSet\.has\(refereeId\)/);
  assert.match(playerDetail, /profileId: playerId/);
  assert.match(playerDetail, /선수 프로필을 불러오지 못했습니다/);
  assert.match(playerDetail, /선수 프로필을 찾을 수 없습니다/);
  assert.doesNotMatch(playerDetail, /<Navigate/);
  assert.match(affiliations, /refreshAffiliations\(true\)/);
  assert.match(affiliations, /typeRankById/);
  assert.match(affiliations, /#\{affiliation\.rank\}/);
});

test("이름 신고는 rejected 요청 뒤 pending을 풀고 실패 피드백을 남긴다", async () => {
  const source = await readSource("src/components/common/NameReportForm.jsx");

  assert.match(source, /try \{[\s\S]*await onSubmit\(reason\)/);
  assert.match(source, /catch \{[\s\S]*신고를 접수하지 못했습니다\./);
  assert.match(source, /finally \{[\s\S]*setPending\(false\)/);
});

test("팀 초대 검색 결과는 선택 표면 안에서 hover card를 열지 않는다", async () => {
  const source = await readSource("src/pages/TeamDetail.jsx");

  assert.match(source, /<span className="search-picker-player-identity">/);
  assert.doesNotMatch(source, /<PlayerHoverCard as="span"[^>]*search-picker-player-identity/);
});
