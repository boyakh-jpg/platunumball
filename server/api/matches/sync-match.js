import { randomUUID } from "node:crypto";
import { isDiscordNotificationEnabled } from "../../../src/data/settingsMappers.js";
import { getDbScheduleParts } from "../../../src/data/scheduleUtils.js";
import { getAuthenticatedContext, nullableText, readJsonBody, sendJson, toArray, toNotificationRows, uniqueValues as uniqueIds } from "../_supabaseAdmin.js";
import {
  BASKETBALL_POSITIONS,
  DAY_MS,
  DEFAULT_TOURNAMENT_MMR_GAP,
  HOUR_MS,
  MINUTE_MS,
  MATCH_SIDES,
  PLAYER_STAT_FIELD_IDS as PLAYER_STAT_FIELDS,
  RECORD_TYPES,
  getModeSize,
  isSupportedMatchMode,
  isSupportedSoloRecordMode,
  isValidBenchCapacity,
  isRefereeGrade,
  normalizeBenchCapacity,
  normalizeDisputeWindowMinutes,
} from "../../../src/lib/constants.js";
import { getMatchCancelCopy, makeAnonymousMatchPlayer } from "../../../src/lib/matchUtils.js";
import { getPostgameRecordVerification, POSTGAME_RECORD_REMINDER_HOURS } from "../../../src/lib/postgameRecordVerification.js";
import { PROFILE_CARD_COLUMNS, PROFILE_ME_COLUMNS, TEAM_COLUMNS, TEAM_MEMBER_COLUMNS } from "../../../src/data/repositoryColumns.js";
import { fromRemoteProfile } from "../../../src/data/profileMappers.js";
import { fromRemoteTeam } from "../../../src/data/teamMappers.js";
import {
  applyAuthoritativeMatchOperation,
  getOperation,
  loadAuthoritativeState,
} from "../_authoritativeState.js";
import { addTeamRoster, assertProfilesExist, assertTeamRosterMembers } from "../_rosterEligibility.js";
import { getPublicAppWebUrl } from "../_publicAppUrl.js";
import {
  MATCH_CANCEL_NOTICE_PREFIXES,
  MATCH_POSTGAME_NOTICE_PREFIXES,
  MATCH_SCHEDULED_NOTICE_PREFIXES,
} from "../../../src/lib/notifications.js";

const ACHIEVEMENT_POSITIONS = new Set(BASKETBALL_POSITIONS);
const configuredDiscordQueueTimeoutMs = Number(process.env.DISCORD_QUEUE_TIMEOUT_MS || 2500);
const DISCORD_QUEUE_TIMEOUT_MS = Number.isFinite(configuredDiscordQueueTimeoutMs) && configuredDiscordQueueTimeoutMs > 0
  ? configuredDiscordQueueTimeoutMs
  : 2500;
const MATCH_REMINDER_OFFSETS = [
  {
    suffix: "24h",
    offsetMs: DAY_MS,
    title: "내일 경기",
    intro: "내일 경기입니다. 일정과 구장을 확인해 주세요.",
  },
  {
    suffix: "2h",
    offsetMs: 2 * HOUR_MS,
    title: "경기 2시간 전",
    intro: "경기 2시간 전입니다. 이동 준비를 시작해 주세요.",
  },
  {
    suffix: "1h",
    offsetMs: HOUR_MS,
    title: "경기 1시간 전",
    intro: "경기 시작 전입니다. 경기방에서 출석 상태를 확인해 주세요.",
  },
];
const MATCH_RECORD_APPROVAL_NOTICE_PREFIXES = POSTGAME_RECORD_REMINDER_HOURS.map(
  (hours) => `match-record-approval-${hours}h`,
);
const MATCH_REFRESH_SCHEDULED_NOTICE_ACTIONS = new Set([
  "createMatch",
  "confirmRecruitingMatch",
  "createTournamentMatch",
  "agreeMatch",
  "updateTournamentMatchSchedule",
  "updateMatchRoomRules",
  "confirmMatchRefereeAbsence",
  "addMatchLatePlayer",
  "removeMatchLatePlayer",
  "setMatchRoomPlayerPlacement",
  "swapPickupMatchPlayers",
  "removeMatchRoomPlayer",
  "setMatchRecordParticipants",
  "setMatchRecordTeamRoster",
  "sync",
]);

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? number : fallback;
}

function reject(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

export function getMatchBenchPolicyError(error = {}) {
  const errorText = [error.message, error.details, error.hint].filter(Boolean).join(" ");
  if (errorText.includes("invalid_bench_capacity")) return { statusCode: 400, message: "invalid_bench_capacity" };
  if (errorText.includes("match_side_capacity_below_roster")) return { statusCode: 409, message: "match_side_capacity_below_roster" };
  if (errorText.includes("match_bench_capacity_below_roster")) return { statusCode: 409, message: "match_bench_capacity_below_roster" };
  if (errorText.includes("match_reserve_full")) return { statusCode: 409, message: "match_reserve_full" };
  if (errorText.includes("match_reserve_exceeds_bench_capacity")) {
    return { statusCode: 409, message: "match_reserve_exceeds_bench_capacity" };
  }
  if (errorText.includes("match_record_reserve_not_allowed")) {
    return { statusCode: 400, message: "match_record_reserve_not_allowed" };
  }
  if (errorText.includes("match_record_roster_exact_capacity_required") || errorText.includes("match_side_leader_required")) {
    return { statusCode: 400, message: "match_record_roster_invalid" };
  }
  if (errorText.includes("room_edit_limit_reached")) {
    return { statusCode: 409, message: "room_edit_limit_reached" };
  }
  if (errorText.includes("room_edit_window_closed")) {
    return { statusCode: 409, message: "room_edit_window_closed" };
  }
  if (errorText.includes("room_schedule_target_too_soon")) {
    return { statusCode: 409, message: "room_schedule_target_too_soon" };
  }
  if (errorText.includes("room_cancel_locked")) {
    return { statusCode: 409, message: "room_cancel_locked" };
  }
  if (errorText.includes("match_room_edit_locked")) {
    return { statusCode: 409, message: "match_room_edit_locked" };
  }
  if (errorText.includes("room_meeting_point_required")) return { statusCode: 400, message: "room_meeting_point_required" };
  if (errorText.includes("court_not_found") || errorText.includes("invalid_room_court")) return { statusCode: 400, message: "invalid_room_court" };
  return null;
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function getTimestamp(item = {}) {
  return item.updatedAt ?? item.createdAt ?? item.queuedAt ?? item.startedAt ?? item.approvedAt ?? new Date().toISOString();
}

function uniqueItemsById(items = []) {
  return [...new Map((items ?? []).filter((item) => item?.id).map((item) => [item.id, item])).values()];
}

function getMatchWebPath(matchId = "") {
  return `/app/matches?match=${encodeURIComponent(String(matchId))}`;
}

function getMatchWebUrl(matchId = "") {
  const path = getMatchWebPath(matchId);
  return getPublicAppWebUrl(path);
}

function parseMatchScheduleDate(value) {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "즉시" || raw === "일정 미정") return null;
  const kstMatch = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2})?$/);
  const date = new Date(kstMatch ? `${kstMatch[1]}T${kstMatch[2]}:00+09:00` : raw);
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatKstDateTime(date) {
  if (!date || !Number.isFinite(date.getTime())) return "일정 미정";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function getMatchCapacity(match = {}) {
  return getModeSize(match.mode) * 2;
}

function getMatchSummaryLines(match = {}) {
  const scheduledAt = parseMatchScheduleDate(match.scheduledAt);
  const playerCount = getMatchPlayerIds(match).length;
  const reserveCount = getMatchReserveIds(match).length;
  const capacity = getMatchCapacity(match);
  return [
    match.title || "경기",
    `일정: ${scheduledAt ? formatKstDateTime(scheduledAt) : match.scheduledAt || "즉시"}`,
    `구장: ${match.court || "구장 미정"}`,
    `인원: ${playerCount}/${capacity}${reserveCount ? ` · 후보 ${reserveCount}` : ""}`,
  ];
}

function getMatchDiscordPayload(match = {}, title, intro) {
  return {
    title,
    body: [intro, ...getMatchSummaryLines(match)].join("\n"),
    webPath: getMatchWebPath(match.id),
    webUrl: getMatchWebUrl(match.id),
    actions: [],
  };
}

function getSidePlayerRows(match = {}) {
  const slotPositions = match.rules?.slotPositions ?? match.slotPositions ?? {};
  const getPosition = (userId) => {
    const position = String(slotPositions?.[userId] ?? "").trim().toUpperCase();
    return ACHIEVEMENT_POSITIONS.has(position) ? position : null;
  };
  return [
    ...(match.teamA?.players ?? []).map((userId, index) => ({
      match_id: match.id,
      team_id: nullableText(match.teamA.teamId),
      user_id: userId,
      side: "teamA",
      slot_order: index,
      position: getPosition(userId),
    })),
    ...(match.teamB?.players ?? []).map((userId, index) => ({
      match_id: match.id,
      team_id: nullableText(match.teamB.teamId),
      user_id: userId,
      side: "teamB",
      slot_order: index,
      position: getPosition(userId),
    })),
  ].filter((row) => row.user_id);
}

function getParticipantIds(match = {}) {
  return new Set([
    match.createdBy,
    match.refereeId,
    match.formerRefereeId,
    ...(match.teamA?.players ?? []),
    ...(match.teamB?.players ?? []),
    ...Object.values(match.reservePlayers ?? match.rules?.reservePlayers ?? {}).flatMap(toArray),
    ...Object.values(match.playedPlayerIds ?? match.rules?.playedPlayerIds ?? {}).flatMap(toArray),
    ...Object.values(match.attendance ?? {}).flatMap(toArray),
  ].filter(Boolean));
}

function getRecordPlayerIds(match = {}) {
  return new Set([
    ...(match.teamA?.players ?? []),
    ...(match.teamB?.players ?? []),
    ...Object.values(match.playedPlayerIds ?? match.rules?.playedPlayerIds ?? {}).flatMap(toArray),
  ].filter(Boolean));
}

function getRoomManagerIds(match = {}) {
  return [match.refereeId || match.createdBy || match.ownerId || match.playerId].filter(Boolean);
}

export async function getDiscordProfiles(supabase, profileIds = [], event = "match") {
  const ids = Array.from(new Set(profileIds.filter(Boolean)));
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from("profiles")
    .select("id, discord_user_id, app_settings")
    .in("id", ids)
    .not("discord_user_id", "is", null);
  if (error) throw error;
  return (data ?? []).filter((profile) => (
    profile.id && profile.discord_user_id && isDiscordNotificationEnabled(profile.app_settings, event)
  ));
}

export function getMatchNotificationId(matchId = "", idPrefix = "notice", profileId = "") {
  return `notice-${idPrefix}-${matchId}-${profileId}`;
}

export function toDiscordDeliveryRows(match = {}, profiles = [], notification = {}) {
  const now = new Date().toISOString();
  const sendAt = notification.sendAt ?? now;
  const payload = getMatchDiscordPayload(match, notification.title, notification.intro);
  return profiles.map((profile) => {
    const id = `discord-${notification.idPrefix}-${match.id}-${profile.id}`;
    const notificationId = getMatchNotificationId(match.id, notification.idPrefix, profile.id);
    return {
      id,
      notification_id: notificationId,
      target_user_id: profile.id,
      discord_user_id: profile.discord_user_id,
      event: "match",
      status: "queued",
      payload: {
        ...payload,
        id,
        notificationId,
        matchId: match.id,
        targetUserId: profile.id,
        status: "queued",
        queuedAt: now,
        sendAt,
        ...(notification.expiresAt ? { expiresAt: notification.expiresAt } : {}),
      },
      queued_at: now,
      send_at: sendAt,
      sent_at: null,
      failed_at: null,
      last_error: null,
      created_at: now,
      updated_at: now,
    };
  });
}

export function toMatchNotificationRows(match = {}, profileIds = [], notification = {}) {
  const now = new Date().toISOString();
  const sendAt = notification.sendAt ?? now;
  const payload = getMatchDiscordPayload(match, notification.title, notification.intro);
  const uniqueProfileIds = [...new Set(profileIds.filter(Boolean))];
  return uniqueProfileIds.map((profileId) => {
    const id = getMatchNotificationId(match.id, notification.idPrefix, profileId);
    return {
      id,
      user_id: profileId,
      target_user_id: profileId,
      title: notification.title,
      body: payload.body,
      tone: notification.tone ?? "match",
      type: notification.type ?? `match_${String(notification.idPrefix || "notice").replace(/-/g, "_")}`,
      match_id: match.id,
      recruiting_post_id: null,
      invitation_id: null,
      discord_event: "match",
      read_at: null,
      payload: {
        ...payload,
        id,
        matchId: match.id,
        targetUserId: profileId,
        actionRequired: notification.actionRequired === true,
        homeAction: notification.homeAction === true,
        skipDiscordSync: true,
        sendAt,
        queuedAt: now,
        ...(notification.expiresAt ? { expiresAt: notification.expiresAt } : {}),
      },
      created_at: now,
      updated_at: now,
    };
  });
}

export async function upsertDiscordDeliveryRows(supabase, rows = []) {
  if (!rows.length) return 0;
  const ids = rows.map((row) => row.id).filter(Boolean);
  const { data: existingRows, error: existingError } = await supabase
    .from("discord_notification_deliveries")
    .select("id, sent_at")
    .in("id", ids);
  if (existingError) throw existingError;

  const sentIds = new Set((existingRows ?? []).filter((row) => row.sent_at).map((row) => row.id));
  const pendingRows = rows.filter((row) => !sentIds.has(row.id));
  if (!pendingRows.length) return 0;

  const { error } = await supabase
    .from("discord_notification_deliveries")
    .upsert(pendingRows, { onConflict: "id" });
  if (error) throw error;
  return pendingRows.length;
}

async function upsertMatchNotificationRows(supabase, rows = []) {
  if (!rows.length) return 0;
  const ids = rows.map((row) => row.id).filter(Boolean);
  const { data: existingRows, error: existingError } = await supabase
    .from("notifications")
    .select("id")
    .in("id", ids);
  if (existingError) throw existingError;

  const existingIds = new Set((existingRows ?? []).map((row) => row.id));
  const pendingRows = rows.filter((row) => !existingIds.has(row.id));
  if (!pendingRows.length) return 0;

  const { error } = await supabase
    .from("notifications")
    .upsert(pendingRows, { onConflict: "id" });
  if (error) throw error;
  return pendingRows.length;
}

async function cancelPendingDiscordDeliveryPrefixes(supabase, matchId, prefixes = []) {
  const ids = prefixes
    .filter(Boolean)
    .map((prefix) => `discord-${prefix}-${matchId}`)
    .filter(Boolean);
  if (!ids.length) return 0;
  const orClause = ids.map((id) => `id.like.${id}-%`).join(",");
  const { data, error } = await supabase
    .from("discord_notification_deliveries")
    .delete()
    .eq("status", "queued")
    .is("sent_at", null)
    .or(orClause)
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

async function cancelPendingMatchNotificationPrefixes(supabase, matchId, prefixes = []) {
  const ids = prefixes
    .filter(Boolean)
    .map((prefix) => `notice-${prefix}-${matchId}`)
    .filter(Boolean);
  if (!ids.length) return 0;
  const orClause = ids.map((id) => `id.like.${id}-%`).join(",");
  const { data, error } = await supabase
    .from("notifications")
    .delete()
    .is("read_at", null)
    .or(orClause)
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

export async function queueMatchDiscordDeliveries(supabase, match = {}, action = "sync") {
  const participantIds = Array.from(getParticipantIds(match));
  const managerIds = getRoomManagerIds(match);
  const nowMs = Date.now();
  const scheduledAt = parseMatchScheduleDate(match.scheduledAt);
  const rows = [];
  const notificationRows = [];

  if (MATCH_REFRESH_SCHEDULED_NOTICE_ACTIONS.has(action)) {
    await cancelPendingDiscordDeliveryPrefixes(supabase, match.id, MATCH_SCHEDULED_NOTICE_PREFIXES);
    await cancelPendingMatchNotificationPrefixes(supabase, match.id, MATCH_SCHEDULED_NOTICE_PREFIXES);
  }
  if (action === "startMatch") {
    await cancelPendingDiscordDeliveryPrefixes(supabase, match.id, MATCH_SCHEDULED_NOTICE_PREFIXES);
    await cancelPendingMatchNotificationPrefixes(supabase, match.id, MATCH_SCHEDULED_NOTICE_PREFIXES);
  }
  if (["endMatch", "submitMatchResult", "disputeMatch", "approveMatch", "resolveMatchDispute", "resumeMatchApproval", "rejectMatchDispute", "forfeitTournamentMatch"].includes(action)) {
    await cancelPendingDiscordDeliveryPrefixes(supabase, match.id, [
      ...MATCH_SCHEDULED_NOTICE_PREFIXES,
      ...MATCH_POSTGAME_NOTICE_PREFIXES,
    ]);
    await cancelPendingMatchNotificationPrefixes(supabase, match.id, [
      ...MATCH_SCHEDULED_NOTICE_PREFIXES,
      ...MATCH_POSTGAME_NOTICE_PREFIXES,
    ]);
  }
  if (["submitMatchResult", "approveMatch"].includes(action)) {
    await cancelPendingDiscordDeliveryPrefixes(supabase, match.id, MATCH_RECORD_APPROVAL_NOTICE_PREFIXES);
    await cancelPendingMatchNotificationPrefixes(supabase, match.id, MATCH_RECORD_APPROVAL_NOTICE_PREFIXES);
  }
  if (["cancelMatch", "voidMatch"].includes(action)) {
    const cancelPrefixes = [...MATCH_CANCEL_NOTICE_PREFIXES, ...MATCH_RECORD_APPROVAL_NOTICE_PREFIXES];
    await cancelPendingDiscordDeliveryPrefixes(supabase, match.id, cancelPrefixes);
    await cancelPendingMatchNotificationPrefixes(supabase, match.id, cancelPrefixes);
  }

  if (!participantIds.length && !managerIds.length) return 0;
  const profiles = await getDiscordProfiles(supabase, participantIds);
  const managerProfiles = await getDiscordProfiles(supabase, managerIds);
  const addRows = (targetIds = [], discordProfiles = [], notification = {}) => {
    rows.push(...toDiscordDeliveryRows(match, discordProfiles, notification));
    notificationRows.push(...toMatchNotificationRows(match, targetIds, notification));
  };

  if (
    scheduledAt &&
    scheduledAt.getTime() > nowMs &&
    ["contract", "agreed"].includes(match.status) &&
    !match.startedAt &&
    !match.endedAt &&
    !match.result
  ) {
    MATCH_REMINDER_OFFSETS.forEach((reminder) => {
      const sendAtMs = scheduledAt.getTime() - reminder.offsetMs;
      if (sendAtMs <= nowMs) return;
      addRows(participantIds, profiles, {
        idPrefix: `match-reminder-${reminder.suffix}`,
        title: reminder.title,
        intro: reminder.intro,
        sendAt: new Date(sendAtMs).toISOString(),
      });
    });

    const checkinAtMs = scheduledAt.getTime() - 10 * MINUTE_MS;
    if (checkinAtMs > nowMs) {
      addRows(managerIds, managerProfiles, {
        idPrefix: "match-manager-checkin-10m",
        title: "출석 확인 안내",
        intro: "경기 10분 전입니다. 참여자 도착 여부를 확인하고, 필요하면 명단을 정리해 주세요.",
        sendAt: new Date(checkinAtMs).toISOString(),
      });
    }
    const startReminderAtMs = scheduledAt.getTime() - 5 * MINUTE_MS;
    if (startReminderAtMs > nowMs) {
      addRows(managerIds, managerProfiles, {
        idPrefix: "match-manager-start-5m",
        title: "경기 시작 5분 전",
        intro: "경기 시작 5분 전입니다. 준비가 끝났다면 시작 처리를 준비해 주세요.",
        sendAt: new Date(startReminderAtMs).toISOString(),
        expiresAt: scheduledAt.toISOString(),
      });
    }
  }

  if (action === "cancelMatch") {
    const cancelCopy = getMatchCancelCopy(match);
    addRows(participantIds, profiles, {
      idPrefix: "match-cancelled",
      title: cancelCopy.notificationTitle,
      intro: cancelCopy.discordIntro,
      type: "match_cancelled",
      actionRequired: false,
    });
  }

  if (action === "voidMatch") {
    addRows(participantIds, profiles, {
      idPrefix: "match-voided",
      title: "경기 무효",
      intro: "경기가 무효 처리되었습니다. 경기 상세에서 무효 사유를 확인해 주세요.",
      type: "match_voided",
      actionRequired: false,
    });
  }

  if (action === "endMatch") {
    const endedAt = match.endedAt ? new Date(match.endedAt) : new Date();
    addRows(participantIds, profiles, {
      idPrefix: "match-ended-score",
      actionRequired: true,
      homeAction: true,
      title: "경기 종료",
      intro: "경기가 종료되었습니다. 경기 점수를 입력해 주세요.",
    });
    addRows(participantIds, profiles, {
      idPrefix: "match-dispute-check",
      actionRequired: true,
      homeAction: true,
      title: "이의신청 확인",
      intro: "경기 종료 후 30분이 지났습니다. 입력된 결과를 확인하고, 문제가 있으면 이의신청을 해 주세요.",
      sendAt: new Date(endedAt.getTime() + 30 * MINUTE_MS).toISOString(),
    });
  }

  if (
    match.rules?.recordType === RECORD_TYPES.matchRecord
    && ["submitMatchResult", "approveMatch"].includes(action)
  ) {
    const verification = getPostgameRecordVerification(match);
    const submittedAtMs = new Date(verification.submittedAt ?? Date.now()).getTime();
    const targetIds = verification.unconfirmedIds;
    const targetIdSet = new Set(targetIds);
    const targetProfiles = profiles.filter((profile) => targetIdSet.has(profile.id));
    POSTGAME_RECORD_REMINDER_HOURS.forEach((hours) => {
      const sendAtMs = submittedAtMs + hours * HOUR_MS;
      if ((hours === 0 && action !== "submitMatchResult") || sendAtMs < nowMs) return;
      addRows(targetIds, targetProfiles, {
        idPrefix: `match-record-approval-${hours}h`,
        actionRequired: true,
        homeAction: true,
        title: hours === 0 ? "사후 기록 확인 요청" : "사후 기록 확인 필요",
        intro: "본인 참가 사실과 경기 결과를 확인해 주세요. 무응답은 자동 승인되지 않습니다.",
        sendAt: new Date(Math.max(sendAtMs, nowMs)).toISOString(),
      });
    });
  }

  await upsertMatchNotificationRows(supabase, notificationRows);
  return upsertDiscordDeliveryRows(supabase, rows);
}

function getMatchPlayerIds(match = {}) {
  return [
    ...(match.teamA?.players ?? []),
    ...(match.teamB?.players ?? []),
  ].filter(Boolean);
}

function getMatchReserveIds(match = {}) {
  return Object.values(match.reservePlayers ?? match.rules?.reservePlayers ?? {}).flatMap(toArray);
}

function getMatchBenchCapacity(match = {}) {
  return normalizeBenchCapacity(match.benchCapacity ?? match.rules?.benchCapacity);
}

function getMatchPlayedIds(match = {}) {
  return Object.values(match.playedPlayerIds ?? match.rules?.playedPlayerIds ?? {}).flatMap(toArray);
}

function getMatchPlayedIdMap(match = {}) {
  const playedPlayerIds = match.playedPlayerIds ?? match.played_player_ids ?? match.rules?.playedPlayerIds ?? {};
  return {
    teamA: toArray(playedPlayerIds.teamA).filter(Boolean),
    teamB: toArray(playedPlayerIds.teamB).filter(Boolean),
  };
}

function getMatchSideIdMap(value = {}) {
  return {
    teamA: toArray(value?.teamA).filter(Boolean),
    teamB: toArray(value?.teamB).filter(Boolean),
  };
}

function createAnonymousLatePlayerId() {
  return `anon_${Date.now().toString(36)}_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

function getLatePlayerSqlPayload(match = {}, operation = {}) {
  const playedPlayerIds = getMatchPlayedIdMap(match);
  const reservePlayers = getMatchSideIdMap(match.reservePlayers ?? match.rules?.reservePlayers ?? {});
  const anonymousPlayers = match.anonymousPlayers ?? {};
  const mmrExcludedPlayerIds = toArray(match.mmrExcludedPlayerIds ?? match.rules?.mmrExcludedPlayerIds).filter(Boolean);

  if (operation.action === "removeMatchLatePlayer") {
    return {
      playerId: operation.playerId ?? "",
      playedPlayerIds,
      reservePlayers,
      anonymousPlayers,
      mmrExcludedPlayerIds,
    };
  }

  const draft = operation.draft && typeof operation.draft === "object" ? operation.draft : {};
  if (draft.userId) return null;
  const name = String(draft.name ?? "").trim();
  if (!name) return null;

  const sideName = draft.sideName === "teamB" ? "teamB" : "teamA";
  const playerId = createAnonymousLatePlayerId();
  const nextPlayedPlayerIds = {
    ...playedPlayerIds,
    [sideName]: uniqueIds([...(playedPlayerIds[sideName] ?? []), playerId]),
  };
  const nextReservePlayers = {
    teamA: uniqueIds(reservePlayers.teamA ?? []).filter((id) => id !== playerId),
    teamB: uniqueIds(reservePlayers.teamB ?? []).filter((id) => id !== playerId),
  };
  const nextAnonymousPlayers = {
    ...anonymousPlayers,
    [playerId]: makeAnonymousMatchPlayer(playerId, name, draft.position),
  };
  const nextExcludedIds = uniqueIds([...mmrExcludedPlayerIds, playerId]);

  return {
    playerId: "",
    playedPlayerIds: nextPlayedPlayerIds,
    reservePlayers: nextReservePlayers,
    anonymousPlayers: nextAnonymousPlayers,
    mmrExcludedPlayerIds: nextExcludedIds,
  };
}

function getAnonymousPlayerIds(match = {}) {
  return new Set(Object.keys(match.anonymousPlayers ?? {}).filter(Boolean));
}

export function validateMatchShape(match = {}) {
  const mode = match.mode ?? "5v5";
  const supported = isSoloRecordMatch(match)
    ? isSupportedSoloRecordMode(mode)
    : isSupportedMatchMode(mode);
  if (!supported) reject(400, "unsupported_match_mode");
  const capacity = getModeSize(match.mode);
  const explicitBenchCapacity = match.benchCapacity ?? match.rules?.benchCapacity;
  if (explicitBenchCapacity !== undefined && !isValidBenchCapacity(explicitBenchCapacity)) reject(400, "invalid_bench_capacity");
  const benchCapacity = getMatchBenchCapacity(match);
  if ((match.teamA?.players ?? []).filter(Boolean).length > capacity) reject(400, "team_a_exceeds_mode_capacity");
  if ((match.teamB?.players ?? []).filter(Boolean).length > capacity) reject(400, "team_b_exceeds_mode_capacity");
  if (toArray((match.reservePlayers ?? match.rules?.reservePlayers ?? {}).teamA).length > benchCapacity) reject(400, "team_a_exceeds_bench_capacity");
  if (toArray((match.reservePlayers ?? match.rules?.reservePlayers ?? {}).teamB).length > benchCapacity) reject(400, "team_b_exceeds_bench_capacity");

  const allPlayerIds = [...getMatchPlayerIds(match), ...getMatchReserveIds(match)];
  const duplicate = allPlayerIds.find((playerId, index) => allPlayerIds.indexOf(playerId) !== index);
  if (duplicate) reject(400, "duplicate_match_player");
  if (match.refereeId && allPlayerIds.includes(match.refereeId)) reject(400, "referee_cannot_be_player");
}

export function validateMatchCreateCourt(match = {}) {
  if (isSoloRecordMatch(match) || isMatchRecordMatch(match)) return;
  const courtId = nullableText(match.courtId ?? match.court_id ?? match.approvedCourtId ?? match.registeredCourtId);
  if (!courtId) reject(400, "missing_match_court");
}

function getSideScopedIds(match = {}, sideName) {
  return [
    ...(toArray(match[sideName]?.players)),
    ...(toArray((match.reservePlayers ?? match.rules?.reservePlayers ?? {})[sideName])),
    ...(toArray((match.playedPlayerIds ?? match.rules?.playedPlayerIds ?? {})[sideName])),
  ];
}

async function validateMatchRosterEligibility(supabase, match = {}) {
  const anonymousPlayerIds = getAnonymousPlayerIds(match);
  const realProfileIds = (ids = []) => ids.filter((userId) => !anonymousPlayerIds.has(userId));
  const rosterIds = [
    ...getMatchPlayerIds(match),
    ...getMatchReserveIds(match),
    ...getMatchPlayedIds(match),
  ];
  await assertProfilesExist(supabase, realProfileIds(rosterIds), "match_player_not_found");

  const rostersByTeam = new Map();
  MATCH_SIDES.forEach((sideName) => {
    const teamId = match[sideName]?.teamId;
    if (!teamId) return;
    addTeamRoster(rostersByTeam, teamId, realProfileIds(getSideScopedIds(match, sideName)));
  });
  await assertTeamRosterMembers(supabase, rostersByTeam, "match_team_roster_not_member");
}

function validateResultShape(match = {}, action = "sync") {
  if (!shouldReplaceMatchResult(action, match) || !match.result) return;

  const scoreA = toFiniteNumber(match.result.scoreA, -1);
  const scoreB = toFiniteNumber(match.result.scoreB, -1);
  if (scoreA < 0 || scoreA > 999 || scoreB < 0 || scoreB > 999) reject(400, "invalid_match_score");

  const recordableIds = new Set([
    ...getMatchPlayerIds(match),
    ...getMatchPlayedIds(match),
  ].filter(Boolean));
  const invalidPlayerId = Object.keys(match.result.playerStats ?? {}).find((userId) => !recordableIds.has(userId));
  if (invalidPlayerId) reject(400, "stat_player_not_in_match");

  const invalidStat = Object.values(match.result.playerStats ?? {}).some((stat) => (
    PLAYER_STAT_FIELDS.some((field) => {
      const value = toFiniteNumber(stat?.[field], -1);
      return value < 0 || value > 999;
    })
  ));
  if (invalidStat) reject(400, "invalid_player_stat");
}

function validateSoloRecordSnapshot(match = {}, actorProfileId = "") {
  if (!isSoloRecordMatch(match)) return;
  const teamAPlayers = toArray(match.teamA?.players);
  const teamBPlayers = toArray(match.teamB?.players);
  if (match.createdBy && match.createdBy !== actorProfileId) reject(403, "solo_record_owner_mismatch");
  if (match.visibility !== "private") reject(400, "solo_record_visibility_invalid");
  if (match.status !== "confirmed" && match.status !== "cancelled") reject(400, "solo_record_status_invalid");
  if (match.ranked !== false) reject(400, "solo_record_ranked_invalid");
  if (teamAPlayers.length !== 1 || teamAPlayers[0] !== actorProfileId || teamBPlayers.length) {
    reject(400, "solo_record_roster_invalid");
  }
  if (match.refereeId) reject(400, "solo_record_referee_invalid");
}

function toMatchRow(match = {}, actorProfileId = "") {
  const statRecorders = match.statRecorders ?? match.rules?.statRecorders ?? {};
  const playedPlayerIds = match.playedPlayerIds ?? match.rules?.playedPlayerIds ?? {};
  const mmrExcludedPlayerIds = match.mmrExcludedPlayerIds ?? match.rules?.mmrExcludedPlayerIds ?? [];
  const recruitingPostId = nullableText(match.recruitingPostId ?? match.rules?.recruitingPostId);
  const courtId = match.courtId ?? match.court_id ?? match.approvedCourtId ?? match.registeredCourtId ?? null;
  const schedule = getDbScheduleParts(match);
  const benchCapacity = getMatchBenchCapacity(match);
  return {
    id: match.id,
    title: match.title ?? "경기",
    mode: match.mode ?? "5v5",
    court_id: courtId,
    court_name: match.court ?? match.courtName ?? "미정",
    visibility: match.visibility ?? match.rules?.visibility ?? "private",
    status: match.status ?? "contract",
    ranked: match.ranked !== false,
    mmr_limit_mode: match.mmrLimitMode ?? "block",
    trust_feedback: match.trustFeedback ?? {},
    referee_id: match.refereeId || null,
    former_referee_id: match.formerRefereeId || null,
    referee_trust_min: Number(match.refereeTrustMin ?? 90),
    stat_entry_minutes: Number(match.statEntryMinutes ?? 60),
    dispute_minutes: normalizeDisputeWindowMinutes(match.disputeMinutes),
    stat_recorders: statRecorders,
    played_player_ids: playedPlayerIds,
    reserve_players: match.reservePlayers ?? match.rules?.reservePlayers ?? {},
    promoted_reserve_ids: match.promotedReserveIds ?? {},
    attendance: match.attendance ?? { teamA: [], teamB: [] },
    referee_absence_request: match.refereeAbsenceRequest ?? null,
    dispute_draft_result: match.disputeDraftResult ?? null,
    dispute_draft_updated_at: match.disputeDraftUpdatedAt ?? null,
    dispute_resolved_at: match.disputeResolvedAt ?? null,
    mmr_excluded_player_ids: mmrExcludedPlayerIds,
    anonymous_players: match.anonymousPlayers ?? {},
    tournament_id: match.tournamentId ?? null,
    tournament_format: match.tournamentFormat ?? null,
    tournament_round: match.tournamentRound ?? null,
    tournament_fixture: match.tournamentFixture ?? null,
    tournament_mmr_policy: match.tournamentMmrPolicy ?? null,
    official: Boolean(match.official),
    pre_registered: Boolean(match.preRegistered),
    scheduled_at: schedule.scheduledAt,
    scheduled_date: schedule.scheduledDate,
    scheduled_time: schedule.scheduledTime,
    team_a_id: nullableText(match.teamA?.teamId),
    team_b_id: nullableText(match.teamB?.teamId),
    score_a: Number(match.result?.scoreA ?? 0),
    score_b: Number(match.result?.scoreB ?? 0),
    rules: {
      ...(match.rules ?? {}),
      timingType: schedule.timingType,
      visibility: match.visibility ?? match.rules?.visibility ?? "private",
      benchCapacity,
      statRecorders,
      playedPlayerIds,
      mmrExcludedPlayerIds,
      ...(recruitingPostId ? { recruitingPostId } : {}),
    },
    memo: match.memo ?? "",
    stakes: match.stakes ?? "",
    objection_window: match.objectionWindow ?? null,
    evidence: match.evidence ?? [],
    created_by: match.createdBy ?? match.teamA?.players?.[0] ?? actorProfileId,
    created_at: match.createdAt ?? new Date().toISOString(),
    agreed_at: match.agreedAt ?? null,
    started_at: match.startedAt ?? null,
    ended_at: match.endedAt ?? null,
    confirmed_at: match.confirmedAt ?? null,
    cancelled_at: match.cancelledAt ?? null,
    voided_at: match.voidedAt ?? null,
    rating_result: match.ratingResult ?? null,
    team_rating_result: match.teamRatingResult ?? null,
    updated_at: new Date().toISOString(),
  };
}

function toTournamentRow(tournament = {}) {
  return {
    id: tournament.id,
    title: tournament.title,
    format: tournament.format,
    visibility: tournament.visibility,
    status: tournament.status,
    region: tournament.region,
    court_id: tournament.courtId ?? tournament.court_id ?? null,
    court_name: tournament.court ?? tournament.courtName ?? tournament.court_name ?? null,
    mode: tournament.mode,
    ranked: tournament.ranked !== false,
    official: Boolean(tournament.official),
    start_date: tournament.startDate || tournament.start_date || null,
    end_date: tournament.endDate || tournament.end_date || null,
    schedule_policy: tournament.schedulePolicy ?? tournament.schedule_policy ?? "weekly",
    schedule_note: tournament.scheduleNote ?? tournament.schedule_note ?? "",
    mmr_limit_mode: tournament.mmrLimitMode ?? tournament.mmr_limit_mode ?? "warn",
    max_mmr_gap: Number(tournament.maxMmrGap ?? tournament.max_mmr_gap ?? DEFAULT_TOURNAMENT_MMR_GAP),
    mmr_policy: tournament.mmrPolicy ?? tournament.mmr_policy ?? "gap_adjusted",
    rules: tournament.rules ?? {},
    memo: tournament.memo ?? "",
    created_by: tournament.createdBy ?? tournament.created_by ?? null,
    created_at: tournament.createdAt ?? tournament.created_at ?? new Date().toISOString(),
    started_at: tournament.startedAt ?? tournament.started_at ?? null,
    match_ids: toArray(tournament.matchIds ?? tournament.match_ids),
    team_statuses: tournament.teamStatuses ?? tournament.team_statuses ?? {},
    team_approvals: tournament.teamApprovals ?? tournament.team_approvals ?? {},
    bracket: tournament.bracket ?? {},
    updated_at: new Date().toISOString(),
  };
}

function toTournamentTeamRows(tournament = {}) {
  return toArray(tournament.teamIds ?? tournament.team_ids).map((teamId, index) => {
    const approval = tournament.teamApprovals?.[teamId] ?? {};
    return {
      tournament_id: tournament.id,
      team_id: teamId,
      seed_order: index + 1,
      status: tournament.teamStatuses?.[teamId] ?? "invited",
      approved_by: approval.by || approval.approvedBy || null,
      approved_at: approval.approvedAt || approval.approved_at || null,
    };
  });
}

async function persistTournamentSnapshot(context, tournament = {}, notifications = []) {
  if (!tournament?.id) return null;
  const notificationRows = toNotificationRows(notifications, context.profileId, {
    defaultTitle: "대회 변경",
    defaultTone: "match",
    defaultType: "tournament",
    filterToProfile: true,
  });
  const { data, error } = await context.supabase.rpc("rankball_persist_tournament_snapshot_locked", {
    p_tournament_row: toTournamentRow(tournament),
    p_team_rows: toTournamentTeamRows(tournament),
    p_notification_rows: notificationRows,
  });
  if (error) throw error;
  return data ?? { ok: true };
}

function toResultRow(match = {}, actorProfileId = "") {
  if (!match.result) return null;
  return {
    match_id: match.id,
    submitted_by: match.result.submittedBy ?? match.refereeId ?? match.teamA?.players?.[0] ?? actorProfileId,
    score_a: Number(match.result.scoreA ?? 0),
    score_b: Number(match.result.scoreB ?? 0),
    stat_submissions: match.result.statSubmissions ?? {},
    submitted_at: match.result.submittedAt ?? new Date().toISOString(),
  };
}

function toStatRows(match = {}) {
  return Object.entries(match.result?.playerStats ?? {}).map(([userId, stat]) => ({
    match_id: match.id,
    user_id: userId,
    recorded_by: match.result?.statSubmissions?.[userId]?.by ?? null,
    record_source: match.result?.statSubmissions?.[userId]?.source ?? "player",
    points: Number(stat.points ?? 0),
    rebounds: Number(stat.rebounds ?? 0),
    assists: Number(stat.assists ?? 0),
    steals: Number(stat.steals ?? 0),
    blocks: Number(stat.blocks ?? 0),
    fouls: Number(stat.fouls ?? 0),
    updated_at: new Date().toISOString(),
  }));
}

function toAgreementRows(match = {}) {
  return [
    ...(match.agreements?.teamA ?? []).map((userId) => ({ match_id: match.id, user_id: userId, side: "teamA" })),
    ...(match.agreements?.teamB ?? []).map((userId) => ({ match_id: match.id, user_id: userId, side: "teamB" })),
  ];
}

function toApprovalRows(match = {}) {
  return [
    ...(match.approvals?.teamA ?? []).map((userId) => ({ match_id: match.id, user_id: userId, side: "teamA" })),
    ...(match.approvals?.teamB ?? []).map((userId) => ({ match_id: match.id, user_id: userId, side: "teamB" })),
  ];
}

function toUuid(value = "") {
  const text = String(value || "");
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
    ? text
    : randomUUID();
}

function toDisputeRows(match = {}) {
  return toArray(match.disputes).map((dispute) => ({
    id: toUuid(dispute.id),
    match_id: match.id,
    user_id: dispute.by ?? dispute.userId,
    reason: dispute.reason ?? "",
    created_at: dispute.createdAt ?? new Date().toISOString(),
  })).filter((row) => row.id && row.user_id);
}

function existingParticipantIds(existingMatch, existingPlayers = []) {
  return new Set([
    existingMatch?.created_by,
    existingMatch?.referee_id,
    existingMatch?.former_referee_id,
    ...(existingPlayers ?? []).map((player) => player.user_id),
  ].filter(Boolean));
}

function getExistingSidePlayerIds(existingPlayers = [], side) {
  return toArray(existingPlayers)
    .filter((player) => player.side === side)
    .sort((a, b) => Number(a.slot_order ?? 0) - Number(b.slot_order ?? 0))
    .map((player) => player.user_id)
    .filter(Boolean);
}

function sameOrderedIds(left = [], right = []) {
  if (left.length !== right.length) return false;
  return left.every((id, index) => id === right[index]);
}

function getExistingSideReserveIds(existingMatch = {}, sideName = "") {
  return toArray(existingMatch?.reserve_players?.[sideName] ?? existingMatch?.rules?.reservePlayers?.[sideName]);
}

function getExistingSideRosterIds(existingMatch = {}, existingPlayers = [], sideName = "") {
  return uniqueIds([
    ...getExistingSidePlayerIds(existingPlayers, sideName),
    ...getExistingSideReserveIds(existingMatch, sideName),
  ]);
}

function getNextSideRosterIds(match = {}, sideName = "") {
  return uniqueIds([
    ...toArray(match?.[sideName]?.players),
    ...toArray(match?.reservePlayers?.[sideName] ?? match?.rules?.reservePlayers?.[sideName]),
  ]);
}

function sameRosterIds(left = [], right = []) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === rightSet.size && [...leftSet].every((id) => rightSet.has(id));
}

function canSyncMatchRecordTeamRoster(profileId, existingMatch, existingPlayers, nextMatch) {
  if (
    !profileId ||
    existingMatch?.rules?.recordType !== RECORD_TYPES.matchRecord ||
    nextMatch?.rules?.recordType !== RECORD_TYPES.matchRecord ||
    existingMatch?.status === "cancelled" ||
    existingMatch?.status === "void" ||
    existingMatch?.confirmed_at ||
    nextMatch?.result
  ) {
    return false;
  }

  const changedSides = MATCH_SIDES.filter((sideName) => !sameRosterIds(
    getExistingSideRosterIds(existingMatch, existingPlayers, sideName),
    getNextSideRosterIds(nextMatch, sideName),
  ));
  if (changedSides.length !== 1) return false;

  const sideName = changedSides[0];
  const existingLeaderId = getExistingSidePlayerIds(existingPlayers, sideName)[0] ?? "";
  const nextLeaderId = toArray(nextMatch?.[sideName]?.players)[0] ?? "";
  return profileId === existingLeaderId && profileId === nextLeaderId;
}

function sortPlainObject(value) {
  if (Array.isArray(value)) return value.map(sortPlainObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortPlainObject(value[key])]));
}

function normalizePlayerStats(stats = {}) {
  return Object.fromEntries(Object.entries(stats ?? {})
    .filter(([userId]) => Boolean(userId))
    .map(([userId, stat]) => [
      userId,
      Object.fromEntries(PLAYER_STAT_FIELDS.map((field) => [field, toFiniteNumber(stat?.[field])])),
    ]));
}

function normalizeStatRows(rows = []) {
  return Object.fromEntries(toArray(rows)
    .filter((row) => Boolean(row.user_id))
    .map((row) => [
      row.user_id,
      Object.fromEntries(PLAYER_STAT_FIELDS.map((field) => [field, toFiniteNumber(row[field])])),
    ]));
}

function normalizeResultSnapshot(result = null, statRows = []) {
  if (!result) return null;
  return sortPlainObject({
    scoreA: toFiniteNumber(result.score_a ?? result.scoreA),
    scoreB: toFiniteNumber(result.score_b ?? result.scoreB),
    playerStats: result.playerStats ? normalizePlayerStats(result.playerStats) : normalizeStatRows(statRows),
  });
}

function getStatRecorderIds(match = {}) {
  const recorders = match.statRecorders ?? match.stat_recorders ?? match.rules?.statRecorders ?? {};
  return Object.values(recorders).flatMap((value) => Array.isArray(value) ? value : [value]).filter(Boolean);
}

async function isActiveReferee(supabase, userId, minTrust = 90) {
  if (!userId) return false;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("trust_score")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) throw profileError;
  if (Number(profile?.trust_score ?? 0) < Number(minTrust ?? 90)) return false;

  const { data, error } = await supabase
    .from("referee_appointments")
    .select("id, role, grade, status, starts_at, ends_at")
    .eq("user_id", userId)
    .eq("role", "referee")
    .eq("status", "active");
  if (error) throw error;

  const now = Date.now();
  return toArray(data).some((row) => {
    const startsAt = row.starts_at ? Date.parse(row.starts_at) : 0;
    const endsAt = row.ends_at ? Date.parse(row.ends_at) : 0;
    return isRefereeGrade(row.grade) && (!startsAt || startsAt <= now) && (!endsAt || endsAt > now);
  });
}

function isMatchOperator(profileId, existingMatch, nextMatch) {
  return Boolean(profileId && [
    existingMatch?.created_by,
    existingMatch?.referee_id,
    nextMatch?.createdBy,
    nextMatch?.refereeId,
  ].filter(Boolean).includes(profileId));
}

const CREATE_MATCH_ACTIONS = new Set([
  "createMatch",
  "confirmRecruitingMatch",
  "createTournamentMatch",
]);

const OPERATOR_MATCH_ACTIONS = new Set([
  "updateTournamentMatchSchedule",
  "forfeitTournamentMatch",
  "handoffMatchRecorder",
  "checkInMatchPlayer",
  "confirmPickupSideAssignment",
  "requestMatchRefereeAbsence",
  "confirmMatchRefereeAbsence",
  "cancelMatch",
  "deleteSoloRecord",
  "voidMatch",
  "resolveMatchDispute",
  "rejectMatchDispute",
  "resumeMatchApproval",
  "startMatch",
  "endMatch",
  "addMatchLatePlayer",
  "removeMatchLatePlayer",
  "updateMatchRoomRules",
  "setMatchRoomPlayerPlacement",
  "swapPickupMatchPlayers",
  "removeMatchRoomPlayer",
]);

const MATCH_RECORD_ROSTER_ACTION = "setMatchRecordTeamRoster";
const MATCH_RECORD_SETUP_ACTION = "setMatchRecordParticipants";

const PARTICIPANT_MATCH_ACTIONS = new Set([
  "acknowledgeMatchRoomRules",
  "agreeMatch",
  "approveMatch",
  "confirmMatchRecordParticipation",
  "toggleMatchStar",
  "submitMatchThumbs",
  "disputeMatch",
  "respondMatchScheduleProposal",
]);

const REFEREE_ELIGIBILITY_ACTIONS = new Set([
  "createMatch",
  "confirmRecruitingMatch",
  "createTournamentMatch",
  "startMatch",
  "endMatch",
  "submitMatchResult",
]);

const RESULT_REPLACE_MATCH_ACTIONS = new Set([
  "submitMatchResult",
  "resumeMatchApproval",
  "rejectMatchDispute",
]);

function isSoloRecordMatch(match = {}) {
  return match?.rules?.recordType === RECORD_TYPES.personalRecord;
}

function isMatchRecordMatch(match = {}) {
  return match?.rules?.recordType === RECORD_TYPES.matchRecord;
}

function shouldReplaceMatchResult(action, match = {}) {
  return RESULT_REPLACE_MATCH_ACTIONS.has(action) || (action === "createMatch" && isSoloRecordMatch(match) && Boolean(match.result));
}

function shouldReplayMatchOperation(operation = null, match = null) {
  if (!operation) return false;
  if (operation.action === MATCH_RECORD_SETUP_ACTION) return true;
  return operation.action === "createMatch" && (!match || !isSoloRecordMatch(match));
}

const ROSTER_LOCKED_MATCH_ACTIONS = new Set([
  ...PARTICIPANT_MATCH_ACTIONS,
  "checkInMatchPlayer",
  "confirmPickupSideAssignment",
  "requestMatchRefereeAbsence",
  "confirmMatchRefereeAbsence",
  "startMatch",
  "endMatch",
  "submitMatchResult",
]);

const REFEREE_LOCKED_MATCH_ACTIONS = new Set([
  ...PARTICIPANT_MATCH_ACTIONS,
  "checkInMatchPlayer",
  "confirmPickupSideAssignment",
  "requestMatchRefereeAbsence",
  "startMatch",
  "endMatch",
  "submitMatchResult",
]);

function canSubmitResult(profileId, existingMatch, nextMatch) {
  const disputeDraftSubmission = existingMatch?.status === "disputed" || nextMatch?.status === "disputed" || nextMatch?.disputeDraftResult;
  const refereeId = nextMatch.refereeId || existingMatch?.referee_id;
  const hostId = nextMatch.createdBy || existingMatch?.created_by;
  if (disputeDraftSubmission) return refereeId ? profileId === refereeId : profileId === hostId;
  const startedAt = nextMatch.startedAt || existingMatch?.started_at;
  const endedAt = nextMatch.endedAt || existingMatch?.ended_at;
  if (!startedAt && !endedAt) return false;
  if (refereeId) return profileId === refereeId;
  const recorderIds = getStatRecorderIds(nextMatch);
  const recordPlayer = getRecordPlayerIds(nextMatch).has(profileId);
  if (endedAt) return recorderIds.includes(profileId) || recordPlayer || profileId === hostId;
  return recorderIds.includes(profileId) || recordPlayer;
}

function canDeleteSoloRecord(profileId, existingMatch, nextMatch) {
  return Boolean(
    profileId &&
    existingMatch?.created_by === profileId &&
    existingMatch?.rules?.recordType === RECORD_TYPES.personalRecord &&
    nextMatch?.rules?.recordType === RECORD_TYPES.personalRecord &&
    nextMatch?.status === "cancelled"
  );
}

function canSyncMatchAction(profileId, existingMatch, existingPlayers, nextMatch, action) {
  if (!profileId || !nextMatch?.id) return false;
  const nextParticipants = getParticipantIds(nextMatch);
  if (!existingMatch) return CREATE_MATCH_ACTIONS.has(action) && nextParticipants.has(profileId);
  const existingParticipants = existingParticipantIds(existingMatch, existingPlayers);
  if (action === "deleteSoloRecord") return canDeleteSoloRecord(profileId, existingMatch, nextMatch);
  if (action === "handoffMatchRecorder") return isMatchOperator(profileId, existingMatch, nextMatch) || getStatRecorderIds(existingMatch).includes(profileId);
  if (action === "substituteMatchPlayer") return isMatchOperator(profileId, existingMatch, nextMatch) || getStatRecorderIds(existingMatch).includes(profileId);
  if (action === MATCH_RECORD_ROSTER_ACTION) return canSyncMatchRecordTeamRoster(profileId, existingMatch, existingPlayers, nextMatch);
  if (action === MATCH_RECORD_SETUP_ACTION) {
    return Boolean(
      existingMatch?.created_by === profileId &&
      existingMatch?.rules?.recordType === RECORD_TYPES.matchRecord &&
      !existingMatch?.confirmed_at &&
      !existingMatch?.result
    );
  }
  if (action === "generatePickupSideAssignment") {
    return isMatchOperator(profileId, existingMatch, nextMatch)
      || existingParticipants.has(profileId)
      || nextParticipants.has(profileId);
  }
  if (OPERATOR_MATCH_ACTIONS.has(action)) return isMatchOperator(profileId, existingMatch, nextMatch);
  if (action === "submitMatchResult") return canSubmitResult(profileId, existingMatch, nextMatch);
  if (PARTICIPANT_MATCH_ACTIONS.has(action)) return existingParticipants.has(profileId) || nextParticipants.has(profileId);
  return existingParticipants.has(profileId) || nextParticipants.has(profileId);
}

async function validateRefereeEligibility(supabase, existingMatch, nextMatch, action, actorProfileId = "") {
  const refereeId = String(nextMatch.refereeId ?? existingMatch?.referee_id ?? "").trim();
  if (!refereeId) return;

  const existingRefereeId = String(existingMatch?.referee_id ?? "").trim();
  const refereeChanged = refereeId !== existingRefereeId;
  const actorIsAssignedReferee = refereeId === String(actorProfileId || "").trim();
  if (!refereeChanged && !actorIsAssignedReferee && !REFEREE_ELIGIBILITY_ACTIONS.has(action)) return;

  const minTrust = Number(nextMatch.refereeTrustMin ?? existingMatch?.referee_trust_min ?? 90);
  if (!(await isActiveReferee(supabase, refereeId, minTrust))) reject(403, "referee_not_eligible");
}

function validateLockedMatchCore(existingMatch, existingPlayers, nextMatch, action) {
  if (!existingMatch) return;
  const existingVisibility = existingMatch.visibility || "public";
  const nextVisibility = nextMatch.visibility ?? nextMatch.rules?.visibility ?? existingVisibility;
  if (existingVisibility !== nextVisibility && action !== "updateMatchRoomRules") {
    reject(403, "match_visibility_locked");
  }

  if (ROSTER_LOCKED_MATCH_ACTIONS.has(action)) {
    const existingTeamA = getExistingSidePlayerIds(existingPlayers, "teamA");
    const existingTeamB = getExistingSidePlayerIds(existingPlayers, "teamB");
    const nextTeamA = toArray(nextMatch.teamA?.players);
    const nextTeamB = toArray(nextMatch.teamB?.players);
    if (!sameOrderedIds(existingTeamA, nextTeamA) || !sameOrderedIds(existingTeamB, nextTeamB)) {
      reject(403, "match_roster_locked");
    }
  }

  if (action === "submitMatchResult") {
    const existingPlayed = getMatchPlayedIdMap(existingMatch);
    const nextPlayed = getMatchPlayedIdMap(nextMatch);
    if (!sameOrderedIds(existingPlayed.teamA, nextPlayed.teamA) || !sameOrderedIds(existingPlayed.teamB, nextPlayed.teamB)) {
      reject(403, "match_played_roster_locked");
    }
  }

  if (REFEREE_LOCKED_MATCH_ACTIONS.has(action)) {
    const existingRefereeId = existingMatch.referee_id || "";
    const nextRefereeId = nextMatch.refereeId || "";
    if (existingRefereeId !== nextRefereeId) reject(403, "match_referee_locked");
  }
}

function validateParticipantResultUnchanged(action, existingResult, existingStats, nextMatch) {
  if (!PARTICIPANT_MATCH_ACTIONS.has(action)) return;
  const existingSnapshot = normalizeResultSnapshot(existingResult, existingStats);
  const nextSnapshot = normalizeResultSnapshot(nextMatch.result);
  if (!existingSnapshot && !nextSnapshot) return;
  if (JSON.stringify(existingSnapshot) !== JSON.stringify(nextSnapshot)) {
    reject(403, "participant_cannot_change_result");
  }
}

function validateResultOnlyOnSubmission(action, existingResult, existingStats, nextMatch) {
  if (shouldReplaceMatchResult(action, nextMatch) || !nextMatch.result) return;
  const existingSnapshot = normalizeResultSnapshot(existingResult, existingStats);
  const nextSnapshot = normalizeResultSnapshot(nextMatch.result);
  if (!existingSnapshot && !nextSnapshot) return;
  if (JSON.stringify(existingSnapshot) !== JSON.stringify(nextSnapshot)) {
    reject(403, "match_result_submission_required");
  }
}

function canCommitRatingResult(action, existingResult, nextMatch) {
  return ["approveMatch", "resumeMatchApproval", "rejectMatchDispute"].includes(action) && Boolean(existingResult) && nextMatch?.status === "confirmed";
}

const SQL_REDUCER_MATCH_ACTIONS = new Set([
  "acknowledgeMatchRoomRules",
  "addMatchLatePlayer",
  "agreeMatch",
  "approveMatch",
  "cancelMatch",
  "checkInMatchPlayer",
  "confirmPickupSideAssignment",
  "generatePickupSideAssignment",
  "confirmMatchRecordParticipation",
  "deleteSoloRecord",
  "disputeMatch",
  "resolveMatchDispute",
  "endMatch",
  "forfeitTournamentMatch",
  "handoffMatchRecorder",
  "removeMatchLatePlayer",
  "removeMatchRoomPlayer",
  "requestMatchRefereeAbsence",
  "confirmMatchRefereeAbsence",
  "resumeMatchApproval",
  "rejectMatchDispute",
  "setMatchRecordTeamRoster",
  "setMatchRoomPlayerPlacement",
  "swapPickupMatchPlayers",
  "startMatch",
  "submitMatchResult",
  "submitMatchThumbs",
  "substituteMatchPlayer",
  "toggleMatchStar",
  "updateMatchRoomRules",
  "respondMatchScheduleProposal",
  "updateTournamentMatchSchedule",
  "voidMatch",
]);

const REPLAY_ONLY_MATCH_ACTIONS = new Set([MATCH_RECORD_SETUP_ACTION]);

function isSupportedMatchAction(action = "") {
  return SQL_REDUCER_MATCH_ACTIONS.has(action) || REPLAY_ONLY_MATCH_ACTIONS.has(action);
}

function isMissingSqlMatchReducer(error = {}) {
  const message = String(error?.message ?? "");
  return (
    error?.code === "PGRST202" ||
    message.includes("rankball_match_agree_action") ||
    message.includes("rankball_match_approval_action") ||
    message.includes("rankball_match_checkin_action") ||
    message.includes("rankball_match_confirm_pickup_assignment") ||
    message.includes("rankball_match_generate_pickup_assignment") ||
    message.includes("rankball_match_rule_ack_action") ||
    message.includes("rankball_match_schedule_response_action") ||
    message.includes("rankball_match_record_participation_action") ||
    message.includes("rankball_match_dispute_action") ||
    message.includes("rankball_match_resolve_dispute_action") ||
    message.includes("rankball_match_end_action") ||
    message.includes("rankball_tournament_match_forfeit_action") ||
    message.includes("rankball_match_late_player_action") ||
    message.includes("rankball_match_referee_absence_action") ||
    message.includes("rankball_match_result_action") ||
    message.includes("rankball_match_resume_approval_action") ||
    message.includes("rankball_match_reject_dispute_action") ||
    message.includes("rankball_match_room_update_action") ||
    message.includes("rankball_match_room_action") ||
    message.includes("rankball_match_roster_move_action") ||
    message.includes("rankball_match_star_toggle_action") ||
    message.includes("rankball_match_thumbs_action") ||
    message.includes("rankball_match_start_action") ||
    message.includes("rankball_match_start_action_guarded") ||
    message.includes("rankball_match_team_roster_action") ||
    message.includes("rankball_match_terminal_action") ||
    message.includes("rankball_tournament_match_schedule_action") ||
    message.includes("rankball_tournament_match_roster_action")
  );
}

function rejectSqlMatchFallback(data = {}) {
  if (!data?.fallback) return;
  reject(409, String(data.reason || "match_operation_blocked"));
}

function shouldUseSqlMatchAction(operation = {}) {
  return SQL_REDUCER_MATCH_ACTIONS.has(String(operation?.action ?? ""));
}

function canUseSqlMatchActionWithoutSnapshot(operation = {}) {
  return [
    "agreeMatch",
    "approveMatch",
    "cancelMatch",
    "checkInMatchPlayer",
    "confirmPickupSideAssignment",
    "generatePickupSideAssignment",
    "confirmMatchRecordParticipation",
    "deleteSoloRecord",
    "disputeMatch",
    "resolveMatchDispute",
    "endMatch",
    "forfeitTournamentMatch",
    "handoffMatchRecorder",
    "addMatchLatePlayer",
    "removeMatchLatePlayer",
    "removeMatchRoomPlayer",
    "requestMatchRefereeAbsence",
    "confirmMatchRefereeAbsence",
    "resumeMatchApproval",
    "rejectMatchDispute",
    "setMatchRecordTeamRoster",
    "setMatchRoomPlayerPlacement",
    "swapPickupMatchPlayers",
    "startMatch",
    "submitMatchResult",
    "submitMatchThumbs",
    "substituteMatchPlayer",
    "toggleMatchStar",
    "updateMatchRoomRules",
    "acknowledgeMatchRoomRules",
    "respondMatchScheduleProposal",
    "updateTournamentMatchSchedule",
    "voidMatch",
  ].includes(operation?.action) && Boolean(operation?.matchId);
}

async function loadSyncedMatch(context, matchId = "") {
  if (!matchId) return null;
  const state = await loadAuthoritativeState(context, { operation: { matchId } });
  return (state.matches ?? []).find((item) => item.id === matchId) ?? null;
}

function getSqlMatchReloadPredicate(operation = {}) {
  const action = String(operation.action || "");
  if (action === "submitMatchResult") {
    return (match) => Boolean(match?.result) &&
      Number(match.result.scoreA ?? match.teamA?.score ?? 0) === Number(operation.result?.scoreA ?? 0) &&
      Number(match.result.scoreB ?? match.teamB?.score ?? 0) === Number(operation.result?.scoreB ?? 0);
  }
  if (action === "updateTournamentMatchSchedule") {
    return (match) => match?.scheduledDate === operation.schedule?.scheduledDate &&
      String(match?.scheduledTime || "").slice(0, 5) === String(operation.schedule?.scheduledTime || "").slice(0, 5) &&
      (!operation.schedule?.courtId || match?.courtId === operation.schedule.courtId);
  }
  if (action === "forfeitTournamentMatch") {
    return (match) => match?.status === "confirmed" && match?.forfeitSide === operation.losingSide;
  }
  if (action === "approveMatch") {
    return (match) => match?.status === "confirmed" || (match?.approvals?.[operation.sideName] ?? []).includes(operation.playerId);
  }
  if (action === "agreeMatch") {
    return (match) => match?.status === "agreed" || (match?.agreements?.[operation.sideName] ?? []).includes(operation.playerId);
  }
  if (action === "startMatch") return (match) => Boolean(match?.startedAt);
  if (action === "endMatch") return (match) => Boolean(match?.endedAt);
  if (action === "checkInMatchPlayer") {
    return (match) => (match?.attendance?.[operation.sideName] ?? []).includes(operation.playerId);
  }
  if (action === "confirmPickupSideAssignment") {
    return (match) => match?.rules?.sideAssignmentStatus === "confirmed";
  }
  if (action === "generatePickupSideAssignment") {
    return (match) => match?.rules?.sideAssignmentStatus === "draft";
  }
  return null;
}

async function loadSyncedMatchAfterWrite(context, matchId = "", fallbackMatch = null, options = {}) {
  const predicate = typeof options.predicate === "function" ? options.predicate : null;
  const delays = predicate ? [0, 60, 120, 240, 480] : [0];
  let latestMatch = fallbackMatch;
  for (const delay of delays) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      const loadedMatch = await loadSyncedMatch(context, matchId);
      if (loadedMatch) latestMatch = loadedMatch;
      if (!predicate || predicate(loadedMatch)) return loadedMatch;
    } catch (error) {
      console.warn("Match post-write reload failed.", error.message);
    }
  }
  return latestMatch;
}

async function assertMatchTeamPlacementSide(context, operation = {}, matchId = "") {
  if (operation.action !== "setMatchRoomPlayerPlacement") return;
  const playerId = String(operation.playerId ?? "").trim();
  const requestedSide = MATCH_SIDES.includes(operation.placement?.side)
    ? operation.placement.side
    : null;
  if (!matchId || !playerId || !requestedSide) return;

  const [{ data: matchRow, error: matchError }, { data: playerRow, error: playerError }] = await Promise.all([
    context.supabase
      .from("matches")
      .select("id,team_a_id,team_b_id,reserve_players")
      .eq("id", matchId)
      .maybeSingle(),
    context.supabase
      .from("match_players")
      .select("side")
      .eq("match_id", matchId)
      .eq("user_id", playerId)
      .maybeSingle(),
  ]);
  if (matchError) throw matchError;
  if (playerError) throw playerError;
  if (!matchRow) reject(404, "match_not_found");

  const reserveSides = MATCH_SIDES.filter((sideName) => (
    toArray(matchRow.reserve_players?.[sideName]).includes(playerId)
  ));
  const currentSide = playerRow?.side ?? (reserveSides.length === 1 ? reserveSides[0] : null);
  if (!currentSide) return;
  const currentTeamId = currentSide === "teamA" ? matchRow.team_a_id : matchRow.team_b_id;
  if (currentTeamId && requestedSide !== currentSide) reject(409, "match_team_side_locked");
}

async function applySqlMatchAction(context, operation = {}, match = {}) {
  if (operation.action === "acknowledgeMatchRoomRules" && operation.matchId) {
    const { data, error } = await context.supabase.rpc("rankball_match_rule_ack_action", {
      p_actor_profile_id: context.profileId,
      p_match_id: operation.matchId,
      p_rule_revision: Number(operation.revision ?? 0),
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) reject(503, "match_rule_ack_rpc_required");
      throw error;
    }
    return { ok: true, ...(data && typeof data === "object" ? data : {}), matchId: operation.matchId };
  }

  if (operation.action === "respondMatchScheduleProposal" && operation.matchId) {
    const { data, error } = await context.supabase.rpc("rankball_match_schedule_response_action", {
      p_actor_profile_id: context.profileId,
      p_match_id: operation.matchId,
      p_proposal_id: operation.proposalId ?? "",
      p_decision: operation.decision ?? "approve",
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) reject(503, "match_schedule_response_rpc_required");
      throw error;
    }
    return { ok: true, ...(data && typeof data === "object" ? data : {}), matchId: operation.matchId };
  }

  if (operation.action === "updateMatchRoomRules" && operation.matchId) {
    const { data, error } = await context.supabase.rpc("rankball_match_room_update_action", {
      p_actor_profile_id: context.profileId,
      p_match_id: operation.matchId,
      p_patch: operation.patch ?? {},
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) reject(503, "match_room_update_rpc_required");
      throw error;
    }
    rejectSqlMatchFallback(data);
    return { ok: true, ...(data && typeof data === "object" ? data : {}), matchId: operation.matchId };
  }

  if (operation.action === "updateTournamentMatchSchedule" && operation.matchId) {
    const { data, error } = await context.supabase.rpc("rankball_tournament_match_schedule_action", {
      p_actor_profile_id: context.profileId,
      p_tournament_id: operation.tournamentId ?? "",
      p_match_id: operation.matchId,
      p_schedule: operation.schedule ?? {},
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) return null;
      throw error;
    }
    return { ok: true, ...(data && typeof data === "object" ? data : {}), matchId: operation.matchId };
  }

  if (operation.action === "forfeitTournamentMatch" && operation.matchId) {
    const { data, error } = await context.supabase.rpc("rankball_tournament_match_forfeit_action", {
      p_actor_profile_id: context.profileId,
      p_tournament_id: operation.tournamentId ?? "",
      p_match_id: operation.matchId,
      p_losing_side: operation.losingSide ?? "",
      p_reason: operation.reason ?? "팀 불참",
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) return null;
      throw error;
    }
    return { ok: true, ...(data && typeof data === "object" ? data : {}), matchId: operation.matchId };
  }

  if (operation.action === "submitMatchResult" && (match?.id || operation.matchId)) {
    const matchId = operation.matchId ?? match.id;
    const sourceMatch = match?.id ? match : await loadSyncedMatch(context, matchId);
    if (sourceMatch?.rules?.recordType === RECORD_TYPES.matchRecord && sourceMatch.rules?.recordSetupReady !== true) {
      reject(409, "match_record_setup_required");
    }
    const { data, error } = await context.supabase.rpc("rankball_match_result_action", {
      p_actor_profile_id: context.profileId,
      p_match_id: matchId,
      p_result: operation.result ?? {},
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) reject(503, "match_result_rpc_required");
      throw error;
    }
    return { ok: true, ...(data && typeof data === "object" ? data : {}), matchId };
  }

  if (["requestMatchRefereeAbsence", "confirmMatchRefereeAbsence"].includes(operation.action) && (match?.id || operation.matchId)) {
    const matchId = operation.matchId ?? match.id;
    const { data, error } = await context.supabase.rpc("rankball_match_referee_absence_action", {
      p_actor_profile_id: context.profileId,
      p_match_id: matchId,
      p_action: operation.action,
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) return null;
      throw error;
    }
    return { ok: true, ...(data && typeof data === "object" ? data : {}), matchId };
  }

  if (operation.action === "setMatchRecordTeamRoster" && (match?.id || operation.matchId)) {
    const matchId = operation.matchId ?? match.id;
    const { data, error } = await context.supabase.rpc("rankball_match_team_roster_action", {
      p_actor_profile_id: context.profileId,
      p_match_id: matchId,
      p_payload: operation,
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) return null;
      throw error;
    }
    return { ok: true, ...(data && typeof data === "object" ? data : {}), matchId };
  }

  if (operation.action === "confirmPickupSideAssignment" && (match?.id || operation.matchId)) {
    const matchId = operation.matchId ?? match.id;
    const { data, error } = await context.supabase.rpc("rankball_match_confirm_pickup_assignment", {
      p_actor_profile_id: context.profileId,
      p_match_id: matchId,
      p_rotation_mode: operation.rotationMode ?? "manual",
      p_rotation_interval_minutes: Number(operation.rotationIntervalMinutes ?? 5),
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) return null;
      throw error;
    }
    rejectSqlMatchFallback(data);
    return { ok: true, ...(data && typeof data === "object" ? data : {}), matchId };
  }

  if (operation.action === "generatePickupSideAssignment" && (match?.id || operation.matchId)) {
    const matchId = operation.matchId ?? match.id;
    const { data, error } = await context.supabase.rpc("rankball_match_generate_pickup_assignment", {
      p_actor_profile_id: context.profileId,
      p_match_id: matchId,
      p_assignment_mode: operation.assignmentMode ?? "",
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) reject(503, "pickup_assignment_rpc_required");
      throw error;
    }
    rejectSqlMatchFallback(data);
    return { ok: true, ...(data && typeof data === "object" ? data : {}), matchId };
  }

  if (operation.action === "swapPickupMatchPlayers" && (match?.id || operation.matchId)) {
    const matchId = operation.matchId ?? match.id;
    const { data, error } = await context.supabase.rpc("rankball_match_swap_pickup_players", {
      p_actor_profile_id: context.profileId,
      p_match_id: matchId,
      p_first_player_id: operation.firstPlayerId ?? "",
      p_second_player_id: operation.secondPlayerId ?? "",
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) reject(503, "pickup_player_swap_rpc_required");
      throw error;
    }
    rejectSqlMatchFallback(data);
    return { ok: true, ...(data && typeof data === "object" ? data : {}), matchId };
  }

  if (operation.action === "confirmMatchRecordParticipation" && (match?.id || operation.matchId)) {
    const matchId = operation.matchId ?? match.id;
    const { data, error } = await context.supabase.rpc("rankball_match_record_participation_action", {
      p_actor_profile_id: context.profileId,
      p_match_id: matchId,
      p_player_id: operation.playerId ?? context.profileId,
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) reject(503, "match_record_participation_rpc_required");
      throw error;
    }
    rejectSqlMatchFallback(data);
    return { ok: true, ...(data && typeof data === "object" ? data : {}), matchId };
  }

  if (["setMatchRoomPlayerPlacement", "removeMatchRoomPlayer"].includes(operation.action) && (match?.id || operation.matchId)) {
    const matchId = operation.matchId ?? match.id;
    await assertMatchTeamPlacementSide(context, operation, matchId);
    const { data, error } = await context.supabase.rpc("rankball_match_room_action", {
      p_actor_profile_id: context.profileId,
      p_match_id: matchId,
      p_action: operation.action,
      p_payload: operation,
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) return null;
      throw error;
    }
    return { ok: true, ...(data && typeof data === "object" ? data : {}), matchId };
  }

  if (operation.action === "resumeMatchApproval" && (match?.id || operation.matchId)) {
    const matchId = operation.matchId ?? match.id;
    const { data, error } = await context.supabase.rpc("rankball_match_resume_approval_action", {
      p_actor_profile_id: context.profileId,
      p_match_id: matchId,
      p_result_draft: operation.resultDraft ?? null,
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) return null;
      throw error;
    }
    return { ok: true, ...(data && typeof data === "object" ? data : {}), matchId };
  }

  if (operation.action === "resolveMatchDispute" && (match?.id || operation.matchId)) {
    const matchId = operation.matchId ?? match.id;
    const { data, error } = await context.supabase.rpc("rankball_match_resolve_dispute_action", {
      p_actor_profile_id: context.profileId,
      p_match_id: matchId,
      p_dispute_id: operation.disputeId ?? "",
      p_decision: operation.decision ?? "",
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) reject(503, "match_dispute_resolution_rpc_required");
      throw error;
    }
    rejectSqlMatchFallback(data);
    return { ok: true, ...(data && typeof data === "object" ? data : {}), matchId };
  }

  if (operation.action === "rejectMatchDispute" && (match?.id || operation.matchId)) {
    const matchId = operation.matchId ?? match.id;
    const { data, error } = await context.supabase.rpc("rankball_match_reject_dispute_action", {
      p_actor_profile_id: context.profileId,
      p_match_id: matchId,
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) return null;
      throw error;
    }
    return { ok: true, ...(data && typeof data === "object" ? data : {}), matchId };
  }

  if (operation.action === "disputeMatch" && (match?.id || operation.matchId)) {
    const matchId = operation.matchId ?? match.id;
    const { data, error } = await context.supabase.rpc("rankball_match_dispute_action", {
      p_actor_profile_id: context.profileId,
      p_match_id: matchId,
      p_dispute_request: operation.reason ?? "",
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) return null;
      throw error;
    }
    rejectSqlMatchFallback(data);

    let discordDeliveryCount = 0;
    let discordDeliveryError = null;
    const deliveryMatch = await loadSyncedMatchAfterWrite(context, matchId, match?.id ? match : null);
    try {
      if (deliveryMatch?.id) {
        discordDeliveryCount = await withTimeout(
          queueMatchDiscordDeliveries(context.supabase, deliveryMatch, operation.action),
          DISCORD_QUEUE_TIMEOUT_MS,
          "discord_match_delivery_timeout",
        );
      }
    } catch (deliveryError) {
      discordDeliveryError = deliveryError.message || "discord_match_delivery_failed";
      console.error("Match Discord delivery queue failed.", deliveryError);
    }

    return {
      ok: true,
      ...(data && typeof data === "object" ? data : {}),
      matchId,
      discordDeliveryCount,
      discordDeliveryError,
    };
  }

  if (["cancelMatch", "deleteSoloRecord", "voidMatch"].includes(operation.action) && (match?.id || operation.matchId)) {
    const matchId = operation.matchId ?? match.id;
    const { data, error } = await context.supabase.rpc("rankball_match_terminal_action", {
      p_actor_profile_id: context.profileId,
      p_action: operation.action,
      p_match_id: matchId,
      p_reason: operation.reason ?? "",
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) return null;
      throw error;
    }
    rejectSqlMatchFallback(data);

    let discordDeliveryCount = 0;
    let discordDeliveryError = null;
    if (operation.action !== "deleteSoloRecord") {
      const deliveryMatch = await loadSyncedMatchAfterWrite(context, matchId, match?.id ? match : null);
      try {
        if (deliveryMatch?.id) {
          discordDeliveryCount = await withTimeout(
            queueMatchDiscordDeliveries(context.supabase, deliveryMatch, operation.action),
            DISCORD_QUEUE_TIMEOUT_MS,
            "discord_match_delivery_timeout",
          );
        }
      } catch (deliveryError) {
        discordDeliveryError = deliveryError.message || "discord_match_delivery_failed";
        console.error("Match Discord delivery queue failed.", deliveryError);
      }
    }

    return {
      ok: true,
      ...(data && typeof data === "object" ? data : {}),
      matchId,
      discordDeliveryCount,
      discordDeliveryError,
    };
  }

  if (operation.action === "toggleMatchStar" && (match?.id || operation.matchId)) {
    const { data, error } = await context.supabase.rpc("rankball_match_star_toggle_action", {
      p_actor_profile_id: context.profileId,
      p_match_id: operation.matchId ?? match.id,
      p_target_user_id: operation.targetUserId ?? "",
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) return null;
      throw error;
    }
    rejectSqlMatchFallback(data);
    return {
      ok: true,
      ...(data && typeof data === "object" ? data : {}),
      matchId: operation.matchId ?? match.id,
    };
  }

  if (operation.action === "submitMatchThumbs" && (match?.id || operation.matchId)) {
    const { data, error } = await context.supabase.rpc("rankball_match_thumbs_action", {
      p_actor_profile_id: context.profileId,
      p_match_id: operation.matchId ?? match.id,
      p_target_user_ids: operation.targetUserIds ?? [],
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) return null;
      throw error;
    }
    rejectSqlMatchFallback(data);
    return {
      ok: true,
      ...(data && typeof data === "object" ? data : {}),
      matchId: operation.matchId ?? match.id,
    };
  }

  if (operation.action === "approveMatch" && (match?.id || operation.matchId)) {
    const { data, error } = await context.supabase.rpc("rankball_match_approval_action", {
      p_actor_profile_id: context.profileId,
      p_match_id: operation.matchId ?? match.id,
      p_side: operation.sideName ?? "",
      p_player_id: operation.playerId ?? "",
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) return null;
      throw error;
    }
    rejectSqlMatchFallback(data);
    return {
      ok: true,
      ...(data && typeof data === "object" ? data : {}),
      matchId: operation.matchId ?? match.id,
    };
  }

  if (operation.action === "agreeMatch" && (match?.id || operation.matchId)) {
    const { data, error } = await context.supabase.rpc("rankball_match_agree_action", {
      p_actor_profile_id: context.profileId,
      p_match_id: operation.matchId ?? match.id,
      p_side: operation.sideName ?? "",
      p_player_id: operation.playerId ?? "",
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) return null;
      throw error;
    }
    rejectSqlMatchFallback(data);
    return {
      ok: true,
      ...(data && typeof data === "object" ? data : {}),
      matchId: operation.matchId ?? match.id,
    };
  }

  if (operation.action === "checkInMatchPlayer" && (match?.id || operation.matchId)) {
    const { data, error } = await context.supabase.rpc("rankball_match_checkin_action", {
      p_actor_profile_id: context.profileId,
      p_match_id: operation.matchId ?? match.id,
      p_side: operation.sideName ?? "",
      p_player_id: operation.playerId ?? "",
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) return null;
      throw error;
    }
    rejectSqlMatchFallback(data);
    return {
      ok: true,
      ...(data && typeof data === "object" ? data : {}),
      matchId: operation.matchId ?? match.id,
    };
  }

  if (["handoffMatchRecorder", "substituteMatchPlayer"].includes(operation.action) && (match?.id || operation.matchId)) {
    const { data, error } = await context.supabase.rpc("rankball_match_roster_move_action", {
      p_actor_profile_id: context.profileId,
      p_action: operation.action,
      p_match_id: operation.matchId ?? match.id,
      p_side: operation.sideName ?? "",
      p_active_player_id: operation.activePlayerId ?? "",
      p_reserve_player_id: operation.reservePlayerId ?? "",
      p_next_recorder_id: operation.nextRecorderId ?? "",
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) return null;
      throw error;
    }
    rejectSqlMatchFallback(data);
    return {
      ok: true,
      ...(data && typeof data === "object" ? data : {}),
      matchId: operation.matchId ?? match.id,
    };
  }

  if (operation.action === "startMatch" && (match?.id || operation.matchId)) {
    const matchId = operation.matchId ?? match.id;
    const pickup = (match?.formationMode ?? match?.rules?.formationMode) === "pickup"
      || (match?.matchIntent ?? match?.rules?.matchIntent) === "pickup";
    if (pickup && match?.rules?.sideAssignmentStatus !== "confirmed") {
      reject(409, "pickup_side_assignment_required");
    }
    const { data, error } = await context.supabase.rpc("rankball_match_start_action_guarded", {
      p_actor_profile_id: context.profileId,
      p_match_id: matchId,
      p_started_at: match?.startedAt ?? match?.rules?.startedAt ?? "",
      p_agreed_at: match?.agreedAt ?? "",
      p_attendance: match?.attendance ?? {},
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) return null;
      throw error;
    }
    rejectSqlMatchFallback(data);

    let discordDeliveryCount = 0;
    let discordDeliveryError = null;
    const deliveryMatch = match?.id ? match : await loadSyncedMatchAfterWrite(context, matchId, null);
    try {
      if (deliveryMatch?.id) {
        discordDeliveryCount = await withTimeout(
          queueMatchDiscordDeliveries(context.supabase, deliveryMatch, operation.action),
          DISCORD_QUEUE_TIMEOUT_MS,
          "discord_match_delivery_timeout",
        );
      }
    } catch (deliveryError) {
      discordDeliveryError = deliveryError.message || "discord_match_delivery_failed";
      console.error("Match Discord delivery queue failed.", deliveryError);
    }

    return {
      ok: true,
      ...(data && typeof data === "object" ? data : {}),
      matchId,
      discordDeliveryCount,
      discordDeliveryError,
    };
  }

  if (["addMatchLatePlayer", "removeMatchLatePlayer"].includes(operation.action) && (match?.id || operation.matchId)) {
    const sourceMatch = match?.id ? match : await loadSyncedMatch(context, operation.matchId);
    const latePlayerPayload = getLatePlayerSqlPayload(sourceMatch, operation);
    if (!sourceMatch?.id || !latePlayerPayload) reject(409, "unsupported_match_late_player_operation");
    const { data, error } = await context.supabase.rpc("rankball_match_late_player_action", {
      p_actor_profile_id: context.profileId,
      p_action: operation.action,
      p_match_id: operation.matchId ?? sourceMatch.id,
      p_player_id: latePlayerPayload.playerId,
      p_played_player_ids: latePlayerPayload.playedPlayerIds,
      p_reserve_players: latePlayerPayload.reservePlayers,
      p_anonymous_players: latePlayerPayload.anonymousPlayers,
      p_mmr_excluded_player_ids: latePlayerPayload.mmrExcludedPlayerIds,
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) return null;
      throw error;
    }
    rejectSqlMatchFallback(data);
    return {
      ok: true,
      ...(data && typeof data === "object" ? data : {}),
      matchId: operation.matchId ?? sourceMatch.id,
    };
  }

  if (operation.action !== "endMatch" || !(match?.id || operation.matchId)) return null;
  const matchId = operation.matchId ?? match.id;
  const { data, error } = await context.supabase.rpc("rankball_match_end_action", {
    p_actor_profile_id: context.profileId,
    p_match_id: matchId,
    p_started_at: match?.startedAt ?? match?.rules?.startedAt ?? "",
    p_ended_at: match?.endedAt ?? "",
  });
  if (error) {
    if (isMissingSqlMatchReducer(error)) return null;
    throw error;
  }
  rejectSqlMatchFallback(data);

  let discordDeliveryCount = 0;
  let discordDeliveryError = null;
  const deliveryMatch = match?.id ? match : await loadSyncedMatchAfterWrite(context, matchId, null);
  try {
    if (deliveryMatch?.id) {
      discordDeliveryCount = await withTimeout(
        queueMatchDiscordDeliveries(context.supabase, deliveryMatch, operation.action),
        DISCORD_QUEUE_TIMEOUT_MS,
        "discord_match_delivery_timeout",
      );
    }
  } catch (deliveryError) {
    discordDeliveryError = deliveryError.message || "discord_match_delivery_failed";
    console.error("Match Discord delivery queue failed.", deliveryError);
  }

  return {
    ok: true,
    ...(data && typeof data === "object" ? data : {}),
    matchId,
    discordDeliveryCount,
    discordDeliveryError,
  };
}

export async function commitMatchRating(context, ratingCommit = {}) {
  const { data, error } = await context.supabase.rpc("rankball_commit_match_rating", {
    p_match_id: ratingCommit.matchId,
    p_actor_profile_id: context.profileId,
    p_rating_result: ratingCommit.ratingResult ?? [],
    p_team_rating_result: ratingCommit.teamRatingResult ?? {},
    p_profile_updates: ratingCommit.profileUpdates ?? [],
    p_team_updates: ratingCommit.teamUpdates ?? [],
    p_confirmed_at: ratingCommit.confirmedAt ?? new Date().toISOString(),
  });
  if (error) throw error;
  return data ?? { ok: true };
}

function getRatingCommitProfileIds(ratingCommit = {}) {
  return uniqueIds([
    ...(ratingCommit.ratingResult ?? []).map((item) => item?.playerId),
    ...(ratingCommit.profileUpdates ?? []).map((item) => item?.id),
  ]);
}

function getRatingCommitTeamIds(ratingCommit = {}) {
  return uniqueIds((ratingCommit.teamUpdates ?? []).map((item) => item?.id));
}

async function loadCommittedRatingState(context, ratingCommit = {}) {
  const profileIds = getRatingCommitProfileIds(ratingCommit);
  const teamIds = getRatingCommitTeamIds(ratingCommit);
  if (!profileIds.length && !teamIds.length) return null;

  const currentProfileId = profileIds.includes(context.profileId) ? context.profileId : "";
  const publicProfileIds = profileIds.filter((profileId) => profileId !== currentProfileId);

  const [
    { data: currentProfile, error: currentProfileError },
    { data: publicProfiles, error: publicProfilesError },
    { data: teamRows, error: teamError },
    { data: teamMemberRows, error: teamMemberError },
  ] = await Promise.all([
    currentProfileId
      ? context.supabase.from("profiles").select(PROFILE_ME_COLUMNS).eq("id", currentProfileId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    publicProfileIds.length
      ? context.supabase.from("profiles").select(PROFILE_CARD_COLUMNS).in("id", publicProfileIds)
      : Promise.resolve({ data: [], error: null }),
    teamIds.length
      ? context.supabase.from("teams").select(TEAM_COLUMNS).in("id", teamIds).is("deleted_at", null)
      : Promise.resolve({ data: [], error: null }),
    teamIds.length
      ? context.supabase.from("team_members").select(TEAM_MEMBER_COLUMNS).in("team_id", teamIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (currentProfileError) throw currentProfileError;
  if (publicProfilesError) throw publicProfilesError;
  if (teamError) throw teamError;
  if (teamMemberError) throw teamMemberError;

  const teamMembersByTeam = new Map();
  (teamMemberRows ?? []).forEach((row) => {
    const rows = teamMembersByTeam.get(row.team_id) ?? [];
    rows.push(row);
    teamMembersByTeam.set(row.team_id, rows);
  });

  const users = [
    ...(publicProfiles ?? []).map(fromRemoteProfile),
    ...(currentProfile ? [fromRemoteProfile(currentProfile)] : []),
  ];
  const teams = (teamRows ?? []).map((row) => fromRemoteTeam(row, teamMembersByTeam.get(row.id)));

  return users.length || teams.length ? { users, teams } : null;
}

export async function commitProfileTrustDeltas(context, trustCommit = {}) {
  const profileUpdates = (trustCommit.profileUpdates ?? []).filter((item) => item?.id && Number(item.trustDelta));
  if (!trustCommit.matchId || !profileUpdates.length) return { ok: true, skipped: true, profileCount: 0 };
  const { data, error } = await context.supabase.rpc("rankball_apply_profile_trust_deltas", {
    p_actor_profile_id: context.profileId,
    p_match_id: trustCommit.matchId,
    p_deltas: profileUpdates,
  });
  if (error) throw error;
  return data ?? { ok: true, profileCount: profileUpdates.length };
}

export async function persistMatchSnapshot(context, { match, notifications = [], action = "sync", body = {}, ratingCommit = null, trustCommit = null, trustedServerCreate = false, recruitingPersistence = null }) {
  if (!match?.id) reject(400, "missing_match");
  validateMatchShape(match);
  validateResultShape(match, action);
  const expectedUpdatedAt = body?.expectedUpdatedAt ?? body?.baseUpdatedAt ?? body?.operation?.expectedUpdatedAt ?? body?.operation?.baseUpdatedAt ?? null;

  const { data: existingMatch, error: existingError } = await context.supabase
      .from("matches")
      .select("id, visibility, status, created_by, referee_id, former_referee_id, referee_trust_min, stat_recorders, played_player_ids, reserve_players, score_a, score_b, rating_result, team_rating_result, agreed_at, started_at, ended_at, confirmed_at, rules")
      .eq("id", match.id)
      .maybeSingle();
  if (existingError) throw existingError;

  const { data: existingPlayers, error: playerError } = await context.supabase
      .from("match_players")
      .select("user_id, side, slot_order")
      .eq("match_id", match.id);
  if (playerError) throw playerError;

  const { data: existingResult, error: resultError } = await context.supabase
      .from("match_results")
      .select("score_a, score_b")
      .eq("match_id", match.id)
      .maybeSingle();
  if (resultError) throw resultError;

  const { data: existingStats, error: statError } = await context.supabase
      .from("player_match_stats")
      .select("user_id, points, rebounds, assists, steals, blocks, fouls")
      .eq("match_id", match.id);
  if (statError) throw statError;

  if (!trustedServerCreate && !canSyncMatchAction(context.profileId, existingMatch, existingPlayers, match, action)) {
    reject(403, "match_sync_permission_denied");
  }
  validateSoloRecordSnapshot(match, context.profileId);
  if (!existingMatch && CREATE_MATCH_ACTIONS.has(action)) validateMatchCreateCourt(match);
  validateLockedMatchCore(existingMatch, existingPlayers, match, action);
  validateParticipantResultUnchanged(action, existingResult, existingStats, match);
  validateResultOnlyOnSubmission(action, existingResult, existingStats, match);
  await validateRefereeEligibility(context.supabase, existingMatch, match, action, context.profileId);
  await validateMatchRosterEligibility(context.supabase, match);

  const matchRow = toMatchRow(match, context.profileId);
  if (expectedUpdatedAt) matchRow.__expectedUpdatedAt = expectedUpdatedAt;
  const playerRows = getSidePlayerRows(match);
  const shouldCommitRating = canCommitRatingResult(action, existingResult, match);
  const shouldReplaceResult = shouldReplaceMatchResult(action, match);
  if (shouldCommitRating && !ratingCommit) reject(400, "missing_rating_commit");
  if (action !== "submitMatchResult" && existingMatch) {
    if (action !== "updateMatchRoomRules") {
      matchRow.visibility = existingMatch.visibility ?? matchRow.visibility;
      matchRow.rules = {
        ...(matchRow.rules ?? {}),
        visibility: matchRow.visibility,
      };
    }
    if (!shouldReplaceResult) {
      matchRow.score_a = Number(existingResult?.score_a ?? existingMatch.score_a ?? 0);
      matchRow.score_b = Number(existingResult?.score_b ?? existingMatch.score_b ?? 0);
    }
    if (shouldCommitRating) {
      matchRow.status = existingMatch.status ?? "approval";
      matchRow.rating_result = existingMatch.rating_result ?? null;
      matchRow.team_rating_result = existingMatch.team_rating_result ?? null;
      matchRow.confirmed_at = existingMatch.confirmed_at ?? null;
    } else {
      matchRow.rating_result = existingMatch.rating_result ?? null;
      matchRow.team_rating_result = existingMatch.team_rating_result ?? null;
    }
  }
  const resultRow = shouldReplaceResult ? toResultRow(match, context.profileId) : null;
  const statRows = shouldReplaceResult ? toStatRows(match) : [];
  const agreementRows = toAgreementRows(match);
  const approvalRows = toApprovalRows(match);
  const disputeRows = toDisputeRows(match);
  const snapshotNotifications = ["cancelMatch", "voidMatch"].includes(action)
    ? notifications.filter((notification) => notification.matchId !== match.id)
    : notifications;
  const notificationRows = toNotificationRows(snapshotNotifications, context.profileId, { coalesce: "nullish", getUpdatedAt: getTimestamp });

  let persistRpcName = shouldCommitRating ? "rankball_match_action_with_rating" : "rankball_match_action";
  let persistArgs = {
    p_actor_profile_id: context.profileId,
    p_action: action,
    p_match_row: matchRow,
    p_player_rows: playerRows,
    p_result_row: resultRow,
    p_stat_rows: statRows,
    p_agreement_rows: agreementRows,
    p_approval_rows: approvalRows,
    p_dispute_rows: disputeRows,
    p_notification_rows: notificationRows,
    p_replace_result: shouldReplaceResult,
    ...(shouldCommitRating ? {
      p_rating_result: ratingCommit.ratingResult ?? [],
      p_team_rating_result: ratingCommit.teamRatingResult ?? {},
      p_profile_updates: ratingCommit.profileUpdates ?? [],
      p_team_updates: ratingCommit.teamUpdates ?? [],
      p_confirmed_at: ratingCommit.confirmedAt ?? new Date().toISOString(),
    } : {}),
  };
  if (recruitingPersistence) {
    if (shouldCommitRating || action !== "confirmRecruitingMatch") reject(400, "invalid_atomic_recruiting_confirmation");
    persistRpcName = "rankball_confirm_recruiting_match_action";
    persistArgs = {
      p_actor_profile_id: context.profileId,
      p_post_action: recruitingPersistence.p_action,
      p_post_row: recruitingPersistence.p_post_row,
      p_application_rows: recruitingPersistence.p_application_rows,
      p_recruiting_notification_rows: recruitingPersistence.p_notification_rows,
      p_expected_updated_at: recruitingPersistence.p_expected_updated_at,
      p_match_action: action,
      p_match_row: matchRow,
      p_player_rows: playerRows,
      p_result_row: resultRow,
      p_stat_rows: statRows,
      p_agreement_rows: agreementRows,
      p_approval_rows: approvalRows,
      p_dispute_rows: disputeRows,
      p_match_notification_rows: notificationRows,
      p_replace_result: shouldReplaceResult,
    };
  }
  const { data: persistResult, error: persistError } = await context.supabase.rpc(persistRpcName, persistArgs);
  if (persistError) throw persistError;
  const matchPersistResult = recruitingPersistence ? persistResult?.match : persistResult;
  const recruitingPersistResult = recruitingPersistence ? persistResult?.recruiting : null;
  const ratingCommitResult = shouldCommitRating ? matchPersistResult?.ratingCommit : null;
  const ratingState = shouldCommitRating ? await loadCommittedRatingState(context, ratingCommit) : null;
  const trustCommitResult = trustCommit ? await commitProfileTrustDeltas(context, trustCommit) : null;
  let discordDeliveryCount = 0;
  let discordDeliveryError = null;
  if (!isSoloRecordMatch(match)) {
    try {
      discordDeliveryCount = await withTimeout(
        queueMatchDiscordDeliveries(context.supabase, match, action),
        DISCORD_QUEUE_TIMEOUT_MS,
        "discord_match_delivery_timeout",
      );
    } catch (deliveryError) {
      discordDeliveryError = deliveryError.message || "discord_match_delivery_failed";
      console.error("Match Discord delivery queue failed.", deliveryError);
    }
  }
  const syncedMatch = isSoloRecordMatch(match) ? match : await loadSyncedMatchAfterWrite(context, match.id, match);
  const responseState = ratingState ? { ...ratingState, matches: syncedMatch ? [syncedMatch] : [] } : null;

  return {
    ok: true,
    match: syncedMatch ?? match,
    matchId: match.id,
    playerCount: Number(matchPersistResult?.playerCount ?? playerRows.length),
    statCount: Number(matchPersistResult?.statCount ?? statRows.length),
    notificationCount: Number(matchPersistResult?.notificationCount ?? notificationRows.length),
    discordDeliveryCount,
    discordDeliveryError,
    ...(responseState ? { state: responseState } : {}),
    ratingCommitted: Boolean(ratingCommitResult?.ok),
    ratingAlreadyCommitted: Boolean(ratingCommitResult?.alreadyCommitted),
    ratingAtomic: Boolean(shouldCommitRating && matchPersistResult?.ratingAtomic),
    confirmationAtomic: Boolean(recruitingPersistence && persistResult?.confirmationAtomic),
    ...(recruitingPersistResult ? { recruitingPersistResult } : {}),
    trustCommitted: Boolean(trustCommitResult?.ok && !trustCommitResult?.skipped),
    trustProfileCount: Number(trustCommitResult?.profileCount ?? 0),
  };
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const context = await getAuthenticatedContext(request);
    const operation = getOperation(body, body.action ? String(body.action) : "sync");
    if (!operation) reject(400, "match_operation_required");
    if (!isSupportedMatchAction(operation.action) && operation.action !== "createMatch") {
      reject(400, "unsupported_match_operation");
    }
    const { error: disciplineError } = await context.supabase.rpc("rankball_assert_match_actor_active", {
      p_actor_profile_id: context.profileId,
    });
    if (disciplineError) {
      if (isMissingSqlMatchReducer(disciplineError)) reject(503, "match_actor_guard_required");
      throw disciplineError;
    }
    let match = null;
    let notifications = [];
    let action = operation.action;
    let ratingCommit = null;
    let trustCommit = null;
    let tournament = null;
    let createdTournamentMatches = [];
    let tournamentNotifications = [];

    if (operation && shouldUseSqlMatchAction(operation) && (match || canUseSqlMatchActionWithoutSnapshot(operation))) {
      const sqlResult = await applySqlMatchAction(context, operation, match);
      if (sqlResult) {
        const syncedMatch = await loadSyncedMatchAfterWrite(
          context,
          sqlResult.matchId ?? operation.matchId ?? match?.id,
          match,
          { predicate: getSqlMatchReloadPredicate(operation) },
        );
        let discordDeliveryCount = Number(sqlResult.discordDeliveryCount ?? 0);
        let discordDeliveryError = sqlResult.discordDeliveryError ?? null;
        const shouldRefreshMatchDeliveries = MATCH_REFRESH_SCHEDULED_NOTICE_ACTIONS.has(operation.action) ||
          ["submitMatchResult", "approveMatch", "resolveMatchDispute", "resumeMatchApproval", "rejectMatchDispute", "forfeitTournamentMatch"].includes(operation.action);
        if (shouldRefreshMatchDeliveries && syncedMatch?.id) {
          try {
            discordDeliveryCount = await withTimeout(
              queueMatchDiscordDeliveries(context.supabase, syncedMatch, operation.action),
              DISCORD_QUEUE_TIMEOUT_MS,
              "discord_match_delivery_timeout",
            );
          } catch (deliveryError) {
            discordDeliveryError = deliveryError.message || "discord_match_delivery_failed";
            console.error("Match Discord delivery queue failed.", deliveryError);
          }
        }
        const finalizedState = sqlResult.ratingAtomic
          ? await loadAuthoritativeState(context, { operation: { action: "approveMatch", matchId: sqlResult.matchId ?? operation.matchId } })
          : null;
        const nextTournamentMatches = finalizedState && syncedMatch?.tournamentId
          ? (finalizedState.matches ?? []).filter((item) => (
              item.tournamentId === syncedMatch.tournamentId &&
              Number(item.tournamentRound ?? 0) > Number(syncedMatch.tournamentRound ?? 0)
            ))
          : [];
        sendJson(response, 200, {
          ...sqlResult,
          ratingCommitted: Boolean(sqlResult.ratingCommitted || sqlResult.ratingAtomic),
          discordDeliveryCount,
          discordDeliveryError,
          ...(syncedMatch ? { match: syncedMatch } : {}),
          ...(finalizedState ? { state: finalizedState } : {}),
          ...(syncedMatch?.tournamentId ? {
            tournamentSynced: true,
            createdTournamentMatchCount: nextTournamentMatches.length,
          } : {}),
        });
        return;
      }
      reject(503, "match_sql_reducer_unavailable");
    }

    if (shouldReplayMatchOperation(operation, match)) {
      const state = await loadAuthoritativeState(context, { operation });
      const result = applyAuthoritativeMatchOperation(state, operation);
      match = result.match;
      notifications = result.notifications;
      action = operation.action;
      ratingCommit = result.ratingCommit;
      trustCommit = result.trustCommit;
      tournament = result.tournament;
      createdTournamentMatches = result.createdTournamentMatches ?? [];
      tournamentNotifications = result.tournamentNotifications ?? [];
    } else if (operation && match) {
      action = operation.action;
    }

    const result = await persistMatchSnapshot(context, { match, notifications, action, body, ratingCommit, trustCommit });
    const tournamentPersistResult = tournament
      ? await persistTournamentSnapshot(context, tournament, tournamentNotifications.filter((notification) => !notification.matchId))
      : null;
    let createdTournamentMatchCount = 0;
    for (const tournamentMatch of createdTournamentMatches) {
      await persistMatchSnapshot(context, {
        match: tournamentMatch,
        notifications: tournamentNotifications.filter((notification) => notification.matchId === tournamentMatch.id),
        action: "createTournamentMatch",
        body: {},
        trustedServerCreate: true,
      });
      createdTournamentMatchCount += 1;
    }
    const responseStateMatches = uniqueItemsById([
      ...(result.state?.matches ?? []),
      result.match,
      ...createdTournamentMatches,
    ]);
    const responseState = result.state || tournament || responseStateMatches.length
      ? {
          ...(result.state ?? {}),
          ...(responseStateMatches.length ? { matches: responseStateMatches } : {}),
          ...(tournament ? { tournaments: [tournament] } : {}),
        }
      : null;
    sendJson(response, 200, {
      ...result,
      ...(responseState ? { state: responseState } : {}),
      tournamentSynced: Boolean(tournamentPersistResult?.ok),
      createdTournamentMatchCount,
    });
  } catch (error) {
    console.error("Match sync failed.", error);
    const benchPolicyError = getMatchBenchPolicyError(error);
    const permissionDenied = error.code === "42501";
    const statusCode = benchPolicyError?.statusCode
      ?? error.statusCode
      ?? (permissionDenied ? 403 : error.code === "40001" || error.message === "match_stale_snapshot" ? 409 : 500);
    sendJson(response, statusCode, {
      error: benchPolicyError?.message ?? (permissionDenied ? "match_sync_permission_denied" : error.message || "match_sync_failed"),
      ...(permissionDenied ? { reason: error.message || "match_sync_permission_denied" } : {}),
    });
  }
}
