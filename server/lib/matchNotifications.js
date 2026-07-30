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
import { getMatchWebPath, getMatchWebUrl, parseMatchScheduleDate, formatKstDateTime, getMatchReserveIds, getMatchSummaryLines, getMatchDiscordPayload, getMatchParticipantIds, getRoomManagerIds, getRequiredMatchAttendanceIds, getCheckedInMatchAttendanceIds, getMissingMatchAttendanceIds, getDiscordProfiles, getMatchNotificationId, toDiscordDeliveryRows, toMatchNotificationRows, getMatchDisputeReminderTiming, upsertDiscordDeliveryRows, getUpsertableDiscordDeliveryRows, hasScheduledNotificationRevisionChanged } from "./matchNotificationRows.js";
export { parseMatchScheduleDate, getMatchParticipantIds, getRequiredMatchAttendanceIds, getCheckedInMatchAttendanceIds, getMissingMatchAttendanceIds, getDiscordProfiles, getMatchNotificationId, toDiscordDeliveryRows, toMatchNotificationRows, getMatchDisputeReminderTiming, upsertDiscordDeliveryRows, getUpsertableDiscordDeliveryRows, hasScheduledNotificationRevisionChanged } from "./matchNotificationRows.js";

const PREGAME_DISCORD_EXPIRY_MS = 90 * 1000;
const MATCH_REMINDER_OFFSETS = [
  {
    suffix: "1h",
    offsetMs: HOUR_MS,
    title: "경기 1시간 전",
    intro: "경기 일정과 구장을 확인해 주세요.",
  },
];
const MATCH_RECORD_APPROVAL_NOTICE_PREFIXES = POSTGAME_RECORD_REMINDER_MINUTES.map(
  (minutes) => `match-record-approval-${minutes}m`,
);
export const MATCH_REFRESH_SCHEDULED_NOTICE_ACTIONS = new Set([
  "createMatch",
  "confirmRecruitingMatch",
  "createTournamentMatch",
  "agreeMatch",
  "updateTournamentMatchSchedule",
  "updateMatchRoomRules",
  "confirmMatchRefereeAbsence",
  "setMatchRoomPlayerPlacement",
  "swapPickupMatchPlayers",
  "removeMatchRoomPlayer",
  "setMatchRecordParticipants",
  "setMatchRecordTeamRoster",
  "checkInMatchPlayer",
  "sync",
]);

async function cancelScheduledMatchNotices(supabase, matchId) {
  await cancelPendingDiscordDeliveryPrefixes(
    supabase,
    matchId,
    MATCH_SCHEDULED_NOTICE_PREFIXES,
  );
  await cancelPendingMatchNotificationPrefixes(
    supabase,
    matchId,
    MATCH_SCHEDULED_NOTICE_PREFIXES,
  );
  await cancelPendingMatchNotificationPrefixes(
    supabase,
    matchId,
    [MATCH_ATTENDANCE_READY_NOTICE_PREFIX],
  );
}

async function upsertMatchNotificationRows(supabase, rows = []) {
  if (!rows.length) return 0;
  const ids = rows.map((row) => row.id).filter(Boolean);
  const { data: existingRows, error: existingError } = await supabase
    .from("notifications")
    .select("id, read_at, payload, created_at")
    .in("id", ids);
  if (existingError) throw existingError;

  const existingById = new Map((existingRows ?? []).map((row) => [row.id, row]));
  const pendingRows = rows
    .filter((row) => {
      const existing = existingById.get(row.id);
      return !existing
        || !existing.read_at
        || hasScheduledNotificationRevisionChanged(existing, row);
    })
    .map((row) => ({
      ...row,
      created_at: existingById.get(row.id)?.created_at ?? row.created_at,
    }));
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
    .in("status", ["queued", "sending"])
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

async function cancelPendingAttendanceNoticesForProfiles(
  supabase,
  matchId,
  profileIds = [],
) {
  const safeProfileIds = [...new Set(profileIds.filter(Boolean))];
  if (!safeProfileIds.length) return 0;
  const prefixes = ["match-attendance-20m", "match-attendance-10m"];
  const notificationIds = safeProfileIds.flatMap((profileId) => (
    prefixes.map((prefix) => getMatchNotificationId(matchId, prefix, profileId))
  ));
  const deliveryIds = notificationIds.map((id) => id.replace(/^notice-/, "discord-"));
  const [{ error: deliveryError }, { error: notificationError }] = await Promise.all([
    supabase
      .from("discord_notification_deliveries")
      .delete()
      .in("id", deliveryIds)
      .in("status", ["queued", "sending"])
      .is("sent_at", null),
    supabase
      .from("notifications")
      .delete()
      .in("id", notificationIds)
      .is("read_at", null),
  ]);
  if (deliveryError) throw deliveryError;
  if (notificationError) throw notificationError;
  return notificationIds.length;
}

export async function reconcileMatchAttendanceNotifications(
  supabase,
  match = {},
  checkedInProfileId = "",
) {
  if (!match?.id) return { allCheckedIn: false, requiredCount: 0, checkedInCount: 0 };
  const requiredIds = getRequiredMatchAttendanceIds(match);
  const checkedInIds = getCheckedInMatchAttendanceIds(match);
  const checkedInCount = requiredIds.filter((profileId) => checkedInIds.has(profileId)).length;
  const allCheckedIn = requiredIds.length > 0 && checkedInCount === requiredIds.length;
  const scheduledAt = parseMatchScheduleDate(match.scheduledAt);
  const attendanceWindowOpen = match.rules?.timingType === "instant"
    || (scheduledAt && Date.now() >= scheduledAt.getTime() - 20 * MINUTE_MS);
  const readyForEarlyStart = Boolean(allCheckedIn && attendanceWindowOpen);

  if (readyForEarlyStart) {
    await cancelPendingAttendanceNoticesForProfiles(supabase, match.id, requiredIds);
  } else {
    await cancelPendingAttendanceNoticesForProfiles(supabase, match.id, [checkedInProfileId]);
    await cancelPendingMatchNotificationPrefixes(
      supabase,
      match.id,
      [MATCH_ATTENDANCE_READY_NOTICE_PREFIX],
    );
  }

  const managerIds = getRoomManagerIds(match);
  if (readyForEarlyStart && managerIds.length && !match.startedAt && !match.endedAt) {
    await upsertMatchNotificationRows(supabase, toMatchNotificationRows(match, managerIds, {
      idPrefix: MATCH_ATTENDANCE_READY_NOTICE_PREFIX,
      title: "전원 출석 완료",
      intro: "전원 출석 완료 · 지금 경기 시작 가능",
      type: "match_attendance_ready",
      actionRequired: true,
      homeAction: true,
    }));
  }

  return {
    allCheckedIn,
    requiredCount: requiredIds.length,
    checkedInCount,
  };
}

export function getMatchPregameNotificationPlan(match = {}, nowMs = Date.now()) {
  const scheduledAt = parseMatchScheduleDate(match.scheduledAt);
  if (
    !scheduledAt
    || scheduledAt.getTime() <= nowMs
    || !["contract", "agreed"].includes(match.status)
    || match.startedAt
    || match.endedAt
    || match.result
  ) {
    return [];
  }

  const plan = [];
  const attendanceTargetIds = getRequiredMatchAttendanceIds(match);
  const checkedInIds = getCheckedInMatchAttendanceIds(match);
  const missingAttendanceIds = attendanceTargetIds
    .filter((profileId) => !checkedInIds.has(profileId));
  const reminderIds = [...new Set([...attendanceTargetIds, match.refereeId].filter(Boolean))];
  const managerIds = getRoomManagerIds(match);
  const addNotice = (targetIds, notice) => {
    if (!targetIds.length) return;
    plan.push({ ...notice, targetIds: [...new Set(targetIds)] });
  };

  MATCH_REMINDER_OFFSETS.forEach((reminder) => {
    const sendAtMs = scheduledAt.getTime() - reminder.offsetMs;
    if (sendAtMs <= nowMs) return;
    addNotice(reminderIds, {
      idPrefix: `match-reminder-${reminder.suffix}`,
      title: reminder.title,
      intro: reminder.intro,
      sendAt: new Date(sendAtMs).toISOString(),
      expiresAt: new Date(sendAtMs + PREGAME_DISCORD_EXPIRY_MS).toISOString(),
    });
  });

  if (match.rules?.qrAttendanceEnabled !== true) return plan;

  const attendanceOpenAtMs = scheduledAt.getTime() - 20 * MINUTE_MS;
  const lastAttendanceReminderAtMs = scheduledAt.getTime() - 10 * MINUTE_MS;
  const addAttendanceReminder = (minutes, sendAtMs) => {
    addNotice(missingAttendanceIds, {
      idPrefix: `match-attendance-${minutes}m`,
      title: minutes === 20 ? "QR 출석 시작" : "QR 출석 확인",
      intro: minutes === 20
        ? "QR 출석이 열렸습니다. 경기 전에 출석을 완료해 주세요."
        : "아직 출석하지 않았습니다. 예정시간 전 조기 시작을 위해 QR 출석을 완료해 주세요.",
      sendAt: new Date(sendAtMs).toISOString(),
      expiresAt: new Date(sendAtMs + PREGAME_DISCORD_EXPIRY_MS).toISOString(),
    });
  };

  if (attendanceOpenAtMs > nowMs) {
    addAttendanceReminder(20, attendanceOpenAtMs);
    addAttendanceReminder(10, lastAttendanceReminderAtMs);
  } else if (lastAttendanceReminderAtMs > nowMs) {
    addAttendanceReminder(20, nowMs);
  } else {
    addAttendanceReminder(10, nowMs);
  }

  const managerSendAtMs = lastAttendanceReminderAtMs > nowMs
    ? lastAttendanceReminderAtMs
    : nowMs;
  const checkedInCount = attendanceTargetIds.length - missingAttendanceIds.length;
  addNotice(managerIds, {
    idPrefix: "match-manager-attendance-10m",
    title: "경기 출석 현황",
    intro: missingAttendanceIds.length
      ? `출석 완료 ${checkedInCount}명 · 미출석 ${missingAttendanceIds.length}명입니다. 전원 출석 전에는 조기 시작할 수 없습니다.`
      : "전원 출석이 완료되었습니다. 지금 경기를 시작할 수 있습니다.",
    sendAt: new Date(managerSendAtMs).toISOString(),
    expiresAt: new Date(managerSendAtMs + PREGAME_DISCORD_EXPIRY_MS).toISOString(),
  });

  return plan;
}

export async function queueMatchDiscordDeliveries(
  supabase,
  match = {},
  action = "sync",
) {
  const participantIds = Array.from(getMatchParticipantIds(match));
  const attendanceTargetIds = getRequiredMatchAttendanceIds(match);
  const checkedInIds = getCheckedInMatchAttendanceIds(match);
  const missingAttendanceIds = attendanceTargetIds
    .filter((profileId) => !checkedInIds.has(profileId));
  const managerIds = getRoomManagerIds(match);
  const nowMs = Date.now();
  const scheduledAt = parseMatchScheduleDate(match.scheduledAt);
  const attendanceWindowOpen = match.rules?.timingType === "instant"
    || (scheduledAt && nowMs >= scheduledAt.getTime() - 20 * MINUTE_MS);
  const rows = [];
  const notificationRows = [];

  if (MATCH_REFRESH_SCHEDULED_NOTICE_ACTIONS.has(action) || action === "startMatch") {
    await cancelScheduledMatchNotices(supabase, match.id);
  }
  if ([
    "endMatch",
    "submitMatchResult",
    "disputeMatch",
    "approveMatch",
    "finalizeMatch",
    "resolveMatchDispute",
    "forfeitTournamentMatch",
  ].includes(action)) {
    await cancelPendingDiscordDeliveryPrefixes(supabase, match.id, [
      ...MATCH_SCHEDULED_NOTICE_PREFIXES,
      ...MATCH_POSTGAME_NOTICE_PREFIXES,
    ]);
    await cancelPendingMatchNotificationPrefixes(supabase, match.id, [
      ...MATCH_SCHEDULED_NOTICE_PREFIXES,
      ...MATCH_POSTGAME_NOTICE_PREFIXES,
    ]);
  }
  if (["submitMatchResult", "approveMatch", "finalizeMatch"].includes(action)) {
    await cancelPendingDiscordDeliveryPrefixes(
      supabase,
      match.id,
      MATCH_RECORD_APPROVAL_NOTICE_PREFIXES,
    );
    await cancelPendingMatchNotificationPrefixes(
      supabase,
      match.id,
      MATCH_RECORD_APPROVAL_NOTICE_PREFIXES,
    );
  }
  if (["cancelMatch", "voidMatch"].includes(action)) {
    const cancelPrefixes = [
      ...MATCH_CANCEL_NOTICE_PREFIXES,
      ...MATCH_RECORD_APPROVAL_NOTICE_PREFIXES,
    ];
    await cancelPendingDiscordDeliveryPrefixes(supabase, match.id, cancelPrefixes);
    await cancelPendingMatchNotificationPrefixes(supabase, match.id, cancelPrefixes);
  }

  if (!participantIds.length && !managerIds.length) return 0;
  const profiles = await getDiscordProfiles(supabase, participantIds);
  const discordProfilesFor = (targetIds = []) => {
    const targetIdSet = new Set(targetIds);
    return profiles.filter((profile) => targetIdSet.has(profile.id));
  };
  const addRows = (targetIds = [], discordProfiles = [], notification = {}) => {
    rows.push(...toDiscordDeliveryRows(match, discordProfiles, notification));
    notificationRows.push(...toMatchNotificationRows(match, targetIds, notification));
  };

  getMatchPregameNotificationPlan(match, nowMs)
    .forEach(({ targetIds, ...notification }) => {
      addRows(targetIds, discordProfilesFor(targetIds), notification);
    });

  if (
    match.rules?.qrAttendanceEnabled === true
    && attendanceWindowOpen
    && attendanceTargetIds.length > 0
    && missingAttendanceIds.length === 0
    && !match.startedAt
    && !match.endedAt
    && ["contract", "agreed"].includes(match.status)
  ) {
    notificationRows.push(...toMatchNotificationRows(match, managerIds, {
      idPrefix: MATCH_ATTENDANCE_READY_NOTICE_PREFIX,
      title: "전원 출석 완료",
      intro: "전원 출석 완료 · 지금 경기 시작 가능",
      type: "match_attendance_ready",
      actionRequired: true,
      homeAction: true,
    }));
  }

  if (action === "cancelMatch") {
    const cancelCopy = getMatchCancelCopy(match);
    const cancellationReason = String(match.rules?.cancellationReason ?? "").trim();
    addRows(participantIds, profiles, {
      idPrefix: "match-cancelled",
      title: cancelCopy.notificationTitle,
      intro: cancellationReason
        ? `${cancelCopy.discordIntro}\n취소 사유: ${cancellationReason}`
        : cancelCopy.discordIntro,
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
    const disputeReminder = getMatchDisputeReminderTiming(match);
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
      intro: `이의신청 마감 ${disputeReminder.leadMinutes}분 전입니다. 입력된 결과를 확인하고, 문제가 있으면 이의신청을 해 주세요.`,
      sendAt: new Date(
        endedAt.getTime() + disputeReminder.offsetMinutes * MINUTE_MS,
      ).toISOString(),
    });
  }

  if (
    ["submitMatchResult", "approveMatch"].includes(action)
    && match.rules?.recordType === RECORD_TYPES.matchRecord
    && match.result?.submittedAt
  ) {
    const verification = getPostgameRecordVerification(match);
    const submittedAtMs = new Date(match.result.submittedAt).getTime();
    if (
      !verification.expired
      && verification.unconfirmedIds.length
      && Number.isFinite(submittedAtMs)
    ) {
      POSTGAME_RECORD_REMINDER_MINUTES.forEach((afterMinutes) => {
        addRows(
          verification.unconfirmedIds,
          discordProfilesFor(verification.unconfirmedIds),
          {
            idPrefix: `match-record-approval-${afterMinutes}m`,
            title: afterMinutes === 0 ? "내 참가 확인 필요" : "내 참가 확인 알림",
            intro: "사후 경기 점수가 입력되었습니다. 본인 참가 사실과 경기 결과를 확인해 주세요.",
            type: afterMinutes === 0
              ? "postgame_record_approval_requested"
              : "postgame_record_approval_reminder",
            actionRequired: true,
            homeAction: true,
            sendAt: new Date(
              submittedAtMs + afterMinutes * MINUTE_MS,
            ).toISOString(),
          },
        );
      });
    }
  }

  await upsertMatchNotificationRows(supabase, notificationRows);
  return upsertDiscordDeliveryRows(supabase, rows);
}
