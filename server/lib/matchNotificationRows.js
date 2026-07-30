import {
  HOUR_MS,
  MINUTE_MS,
  getModeSize,
} from "../../shared/lib/matchConstants.js";
import { compactArray } from "../../shared/lib/arrayValues.js";
import { collectMatchActivePlayerIds } from "../../shared/lib/playerIds.js";
import { isDiscordNotificationEnabled } from "../../shared/lib/settingsMappers.js";
import {
  RECORD_TYPES,
  normalizeDisputeWindowMinutes,
} from "../../shared/lib/constants.js";
import { getMatchCancelCopy } from "../../shared/lib/matchUtils.js";
import {
  POSTGAME_RECORD_REMINDER_MINUTES,
  getPostgameRecordVerification,
} from "../../shared/lib/postgameRecordVerification.js";
import {
  MATCH_ATTENDANCE_READY_NOTICE_PREFIX,
  MATCH_CANCEL_NOTICE_PREFIXES,
  MATCH_POSTGAME_NOTICE_PREFIXES,
  MATCH_SCHEDULED_NOTICE_PREFIXES,
} from "../../shared/lib/notifications.js";
import { getPublicAppWebUrl } from "../api/_publicAppUrl.js";
import { toQueuedDiscordDeliveryRow } from "./discordDeliveryRows.js";

export function getMatchWebPath(matchId = "") {
  return `/app/matches?match=${encodeURIComponent(String(matchId))}`;
}

export function getMatchWebUrl(matchId = "") {
  return getPublicAppWebUrl(getMatchWebPath(matchId));
}

export function parseMatchScheduleDate(value) {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "즉시" || raw === "일정 미정") return null;
  const kstMatch = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2})?$/);
  const date = new Date(kstMatch ? `${kstMatch[1]}T${kstMatch[2]}:00+09:00` : raw);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function formatKstDateTime(date) {
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

export function getMatchReserveIds(match = {}) {
  return Object.values(match.reservePlayers ?? match.rules?.reservePlayers ?? {})
    .flatMap(compactArray);
}

export function getMatchSummaryLines(match = {}) {
  const scheduledAt = parseMatchScheduleDate(match.scheduledAt);
  const playerCount = collectMatchActivePlayerIds(match).length;
  const reserveCount = getMatchReserveIds(match).length;
  const capacity = getModeSize(match.mode) * 2;
  return [
    match.title || "경기",
    `일정: ${scheduledAt ? formatKstDateTime(scheduledAt) : match.scheduledAt || "즉시"}`,
    `구장: ${match.court || "구장 미정"}`,
    `인원: ${playerCount}/${capacity}${reserveCount ? ` · 후보 ${reserveCount}` : ""}`,
  ];
}

export function getMatchDiscordPayload(match = {}, title, intro) {
  return {
    title,
    body: [intro, ...getMatchSummaryLines(match)].join("\n"),
    webPath: getMatchWebPath(match.id),
    webUrl: getMatchWebUrl(match.id),
    actions: [],
  };
}

export function getMatchParticipantIds(match = {}) {
  return new Set([
    match.createdBy,
    match.refereeId,
    match.formerRefereeId,
    ...(match.teamA?.players ?? []),
    ...(match.teamB?.players ?? []),
    ...Object.values(match.reservePlayers ?? match.rules?.reservePlayers ?? {}).flatMap(compactArray),
    ...Object.values(match.playedPlayerIds ?? match.rules?.playedPlayerIds ?? {}).flatMap(compactArray),
    ...Object.values(match.attendance ?? {}).flatMap(compactArray),
  ].filter(Boolean));
}

export function getRoomManagerIds(match = {}) {
  return [match.refereeId || match.createdBy || match.ownerId || match.playerId].filter(Boolean);
}

export function getRequiredMatchAttendanceIds(match = {}) {
  const refereeId = String(match.refereeId ?? "").trim();
  return [...new Set([
    ...(match.teamA?.players ?? []),
    ...(match.teamB?.players ?? []),
    ...Object.values(match.reservePlayers ?? match.rules?.reservePlayers ?? {}).flatMap(compactArray),
  ].filter((profileId) => profileId && profileId !== refereeId))];
}

export function getCheckedInMatchAttendanceIds(match = {}) {
  return new Set(Object.values(match.attendance ?? {}).flatMap(compactArray).filter(Boolean));
}

export function getMissingMatchAttendanceIds(match = {}) {
  const checkedInIds = getCheckedInMatchAttendanceIds(match);
  return getRequiredMatchAttendanceIds(match)
    .filter((profileId) => !checkedInIds.has(profileId));
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
    profile.id
    && profile.discord_user_id
    && isDiscordNotificationEnabled(profile.app_settings, event)
  ));
}

export function getMatchNotificationId(matchId = "", idPrefix = "notice", profileId = "") {
  return `notice-${idPrefix}-${matchId}-${profileId}`;
}

export function toDiscordDeliveryRows(match = {}, profiles = [], notification = {}) {
  const now = new Date().toISOString();
  const sendAt = notification.sendAt ?? now;
  const payload = getMatchDiscordPayload(match, notification.title, notification.intro);
  const fromUserId = match.createdBy || match.ownerId || match.playerId || match.refereeId || "";
  return profiles.map((profile) => {
    const id = `discord-${notification.idPrefix}-${match.id}-${profile.id}`;
    const notificationId = getMatchNotificationId(match.id, notification.idPrefix, profile.id);
    return toQueuedDiscordDeliveryRow({
      id,
      notificationId,
      targetUserId: profile.id,
      discordUserId: profile.discord_user_id,
      payload: {
        ...payload,
        id,
        notificationId,
        noticePrefix: notification.idPrefix,
        matchId: match.id,
        scheduledAt: match.scheduledAt,
        targetUserId: profile.id,
        fromUserId,
        status: "queued",
        queuedAt: now,
        sendAt,
        ...(notification.expiresAt ? { expiresAt: notification.expiresAt } : {}),
      },
      queuedAt: now,
      sendAt,
    });
  });
}

export function toMatchNotificationRows(match = {}, profileIds = [], notification = {}) {
  const now = new Date().toISOString();
  const sendAt = notification.sendAt ?? now;
  const payload = getMatchDiscordPayload(match, notification.title, notification.intro);
  const fromUserId = match.createdBy || match.ownerId || match.playerId || match.refereeId || "";
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
      type: notification.type
        ?? `match_${String(notification.idPrefix || "notice").replace(/-/g, "_")}`,
      match_id: match.id,
      recruiting_post_id: null,
      invitation_id: null,
      discord_event: "match",
      read_at: null,
      payload: {
        ...payload,
        id,
        noticePrefix: notification.idPrefix,
        matchId: match.id,
        scheduledAt: match.scheduledAt,
        targetUserId: profileId,
        fromUserId,
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

export function getMatchDisputeReminderTiming(match = {}) {
  const windowMinutes = normalizeDisputeWindowMinutes(match.disputeMinutes);
  const leadMinutes = Math.min(5, Math.max(1, windowMinutes - 1));
  return {
    windowMinutes,
    leadMinutes,
    offsetMinutes: windowMinutes - leadMinutes,
  };
}

export async function upsertDiscordDeliveryRows(supabase, rows = []) {
  if (!rows.length) return 0;
  const ids = rows.map((row) => row.id).filter(Boolean);
  const { data: existingRows, error: existingError } = await supabase
    .from("discord_notification_deliveries")
    .select("id, status, sent_at, send_at, queued_at, attempt_count, payload")
    .in("id", ids);
  if (existingError) throw existingError;

  const pendingRows = getUpsertableDiscordDeliveryRows(rows, existingRows ?? []);
  if (!pendingRows.length) return 0;

  const { error } = await supabase
    .from("discord_notification_deliveries")
    .upsert(pendingRows, { onConflict: "id" });
  if (error) throw error;
  return pendingRows.length;
}

export function getUpsertableDiscordDeliveryRows(rows = [], existingRows = []) {
  const existingById = new Map((existingRows ?? []).map((row) => [row.id, row]));
  return rows
    .filter((row) => {
      const existing = existingById.get(row.id);
      return !existing
        || hasScheduledNotificationRevisionChanged(existing, row)
        || (!existing.sent_at && ["queued", "sending"].includes(existing.status));
    })
    .map((row) => {
      const existing = existingById.get(row.id);
      if (!existing || hasScheduledNotificationRevisionChanged(existing, row)) {
        return { ...row, attempt_count: 0 };
      }
      const attemptCount = Number(existing.attempt_count ?? 0);
      return {
        ...row,
        status: existing.status,
        queued_at: existing.queued_at ?? row.queued_at,
        attempt_count: attemptCount,
        send_at: attemptCount > 0 && existing.send_at ? existing.send_at : row.send_at,
      };
    });
}

export function hasScheduledNotificationRevisionChanged(existing = {}, next = {}) {
  const existingSchedule = String(existing.payload?.scheduledAt ?? "").trim();
  const nextSchedule = String(next.payload?.scheduledAt ?? "").trim();
  return Boolean(nextSchedule && existingSchedule !== nextSchedule);
}
