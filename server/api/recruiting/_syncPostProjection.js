import { getModeSize } from "../../../shared/lib/matchConstants.js";
import { getDbScheduleParts, toDbTime } from "../../../shared/lib/matchPersistence.js";
import { nullableText, toArray, toNotificationRows } from "../_supabaseAdmin.js";
import { MATCH_SIDES, normalizeDisputeWindowMinutes } from "../../../shared/lib/constants.js";
import { getDiscordProfiles, upsertDiscordDeliveryRows } from "../matches/sync-match.js";
import { toQueuedDiscordDeliveryRow } from "../../lib/discordDeliveryRows.js";
import { getPublicAppWebUrl } from "../_publicAppUrl.js";
import { getRecruitingBenchCapacity, normalizeRecruitingApplicationStatus, normalizeRecruitingMmrRangeMode } from "../../../shared/lib/recruiting.js";

export function getTimestamp(item = {}) {
  return item.updatedAt ?? item.createdAt ?? item.queuedAt ?? item.startedAt ?? item.approvedAt ?? new Date().toISOString();
}

export function normalizeRoomState(roomState = {}, post = {}) {
  const source = roomState && typeof roomState === "object" ? roomState : {};
  const rules = post.rules && typeof post.rules === "object" ? post.rules : {};
  const mmrRangeMode = normalizeRecruitingMmrRangeMode(post.mmrRangeMode ?? source.mmrRangeMode ?? rules.mmrRangeMode);
  const matchIntent = post.matchIntent ?? rules.matchIntent;
  const pickup = matchIntent === "pickup" || (post.formationMode ?? rules.formationMode) === "pickup";
  const record = matchIntent === "record" || matchIntent === "match_record";
  const mmrLimitMode = post.ranked === false || pickup || record ? "off" : "block";
  return {
    ...source,
    ownerId: post.ownerId ?? source.ownerId ?? post.playerId ?? "",
    timingType: post.timingType ?? source.timingType ?? "scheduled",
    mmrRangeMode,
    mmrLimitMode,
  };
}

export function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function getRecruitingCoreSnapshot(post = {}) {
  const teamId = nullableText(post.teamId ?? post.team_id);
  return {
    visibility: post.visibility === "private" ? "private" : "public",
    playerId: post.playerId ?? post.player_id ?? "",
    teamId,
    targetTeamId: nullableText(post.targetTeamId ?? post.target_team_id),
    mode: post.mode ?? "5v5",
    scheduledDate: post.scheduledDate ?? post.scheduled_date ?? null,
    scheduledTime: toDbTime(post.scheduledTime ?? post.scheduled_time) ?? null,
    ranked: post.ranked !== false,
    official: Boolean(post.official),
    ageRestriction: post.ageRestriction ?? post.age_restriction ?? "any",
    allowedAgeGroups: toArray(post.allowedAgeGroups ?? post.allowed_age_groups).map(String).sort(),
    sideCapacity: getCanonicalSideCapacity(post),
    benchCapacity: getCanonicalBenchCapacity(post),
    hostJoinMode: getCanonicalHostJoinMode(post),
    hostSide: (post.hostSide ?? post.host_side) === "teamB" ? "teamB" : "teamA",
    playerIds: toArray(post.playerIds ?? post.player_ids),
    refereeId: post.refereeId || post.referee_id || "",
  };
}

export function toRecruitingPostRow(post = {}) {
  const roomState = normalizeRoomState(post.roomState, post);
  const benchCapacity = getCanonicalBenchCapacity(post);
  const courtId = post.courtId ?? post.court_id ?? post.approvedCourtId ?? post.registeredCourtId ?? null;
  const schedule = getDbScheduleParts({ ...post, roomState });
  return {
    id: post.id,
    type: post.type ?? "need_player",
    title: String(post.title ?? "").trim() || "매칭방",
    visibility: post.visibility === "private" ? "private" : "public",
    player_id: post.playerId,
    team_id: nullableText(post.teamId),
    region: nullableText(post.region),
    court_id: nullableText(courtId),
    court_name: post.court ?? post.courtName ?? "미정",
    mode: post.mode ?? "5v5",
    scheduled_date: schedule.scheduledDate,
    scheduled_time: schedule.scheduledTime,
    scheduled_at: schedule.scheduledAt,
    ranked: post.ranked !== false,
    official: Boolean(post.official),
    pre_registered: post.preRegistered !== false,
    rating_scale: Number(post.ratingScale ?? 1),
    age_restriction: post.ageRestriction ?? null,
    allowed_age_groups: toArray(post.allowedAgeGroups),
    rules: { ...(post.rules ?? {}), benchCapacity },
    stakes: post.stakes ?? "",
    court_reserved: Boolean(post.courtReserved),
    court_fee: nullableText(post.courtFee),
    spots: Number(post.spots ?? 0),
    target_team_id: nullableText(post.targetTeamId),
    referee_id: nullableText(post.refereeId),
    referee_trust_min: Number(post.refereeTrustMin ?? 90),
    stat_entry_minutes: Number(post.statEntryMinutes ?? 60),
    dispute_minutes: normalizeDisputeWindowMinutes(post.disputeMinutes),
    room_state: { ...roomState, timingType: schedule.timingType },
    host_join_mode: post.hostJoinMode === "player" ? "player" : "team",
    host_side: post.hostSide === "teamB" ? "teamB" : "teamA",
    host_ready: Boolean(post.hostReady),
    side_capacity: getCanonicalSideCapacity(post),
    bench_capacity: benchCapacity,
    player_ids: toArray(post.playerIds),
    position: roomState.slotPositions?.[post.playerId] ?? post.position ?? null,
    memo: post.memo ?? "",
    status: post.status ?? "open",
    confirmed_at: post.confirmedAt ?? null,
    created_at: post.createdAt ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export function toRecruitingApplicationRows(post = {}) {
  const roomState = normalizeRoomState(post.roomState, post);
  return toArray(post.applicants).map((application) => {
    const teamId = nullableText(application.teamId);
    return {
      post_id: post.id,
      player_id: application.playerId,
      team_id: teamId,
      kind: application.kind === "team" || teamId ? "team" : "player",
      side: application.side === "teamA" ? "teamA" : "teamB",
      status: normalizeRecruitingApplicationStatus(application.status),
      reserve: Boolean(application.reserve),
      position: roomState.slotPositions?.[application.playerId] ?? application.position ?? null,
      player_ids: toArray(application.playerIds),
      source_team_id: nullableText(application.sourceTeamId),
      source_entry_id: nullableText(application.sourceEntryId),
      created_at: application.createdAt ?? new Date().toISOString(),
      updated_at: application.updatedAt ?? application.createdAt ?? new Date().toISOString(),
    };
  }).filter((row) => row.player_id);
}

export function fromRecruitingApplicationRows(rows = []) {
  return toArray(rows).map((application) => ({
    kind: application.kind === "team" || application.team_id ? "team" : "player",
    joinMode: application.kind === "team" || application.team_id ? "team" : "player",
    teamId: application.team_id ?? null,
    playerId: application.player_id,
    side: application.side,
    status: application.status,
    reserve: application.reserve,
    position: application.position,
    playerIds: toArray(application.player_ids),
    sourceTeamId: application.source_team_id ?? null,
    sourceEntryId: application.source_entry_id ?? null,
    createdAt: application.created_at,
    updatedAt: application.updated_at,
  })).filter((application) => application.playerId);
}

export function participantIdsFromPost(post = {}) {
  const roomState = normalizeRoomState(post.roomState, post);
  return new Set([
    post.ownerId,
    roomState.ownerId,
    post.playerId,
    ...(toArray(post.playerIds)),
    ...(toArray(post.applicants).flatMap((application) => [
      application.playerId,
      ...(toArray(application.playerIds)),
      ...(toArray(application.reservePlayerIds)),
    ])),
    ...(Object.values(roomState.partyReserves ?? {}).flatMap(toArray)),
    ...(toArray(roomState.invitations).map((invitation) => invitation.targetUserId)),
    ...(toArray(roomState.invitations).map((invitation) => invitation.fromUserId)),
  ].filter(Boolean));
}

export function rosterIdsFromPost(post = {}) {
  const roomState = normalizeRoomState(post.roomState ?? post.room_state, post);
  return new Set([
    post.ownerId,
    roomState.ownerId,
    post.playerId,
    post.player_id,
    post.refereeId,
    post.referee_id,
    ...(toArray(post.playerIds ?? post.player_ids)),
    ...(toArray(post.applicants).flatMap((application) => [
      application.playerId,
      application.player_id,
      ...(toArray(application.playerIds ?? application.player_ids)),
      ...(toArray(application.reservePlayerIds)),
    ])),
    ...(Object.values(roomState.partyReserves ?? {}).flatMap(toArray)),
    ...(Object.values(roomState.pinnedReservePlayers ?? {}).flatMap(toArray)),
  ].filter(Boolean));
}

function getRecruitingWebPath(postId = "") {
  return `/app/recruiting?post=${encodeURIComponent(String(postId))}`;
}

function getRecruitingWebUrl(postId = "") {
  const path = getRecruitingWebPath(postId);
  return getPublicAppWebUrl(path);
}

export function getCanonicalSideCapacity(post = {}) {
  const modeCapacity = getModeSize(post.mode);
  const rawCapacity = Number(post.sideCapacity ?? post.side_capacity ?? modeCapacity);
  const safeCapacity = Number.isFinite(rawCapacity) ? rawCapacity : modeCapacity;
  return Math.max(1, Math.min(5, modeCapacity, safeCapacity));
}

export function getCanonicalBenchCapacity(post = {}) {
  return getRecruitingBenchCapacity(post);
}

export function getExplicitBenchCapacity(post = {}) {
  if (post.benchCapacity !== undefined) return post.benchCapacity;
  if (post.bench_capacity !== undefined) return post.bench_capacity;
  if (post.rules && Object.prototype.hasOwnProperty.call(post.rules, "benchCapacity")) return post.rules.benchCapacity;
  return undefined;
}

export function getRecruitingBenchIdsBySide(post = {}) {
  const roomState = normalizeRoomState(post.roomState ?? post.room_state, post);
  const result = { teamA: new Set(), teamB: new Set() };
  const add = (side, ids = []) => {
    if (!MATCH_SIDES.includes(side)) return;
    toArray(ids).filter(Boolean).forEach((playerId) => result[side].add(playerId));
  };
  const hostSide = (post.hostSide ?? post.host_side) === "teamB" ? "teamB" : "teamA";
  add(hostSide, roomState.partyReserves?.host);
  toArray(post.applicants).forEach((application) => {
    const side = application.side === "teamA" ? "teamA" : "teamB";
    const teamId = nullableText(application.teamId ?? application.team_id);
    const applicationKey = teamId ? `team:${teamId}` : `player:${application.playerId ?? application.player_id ?? ""}`;
    if (application.reserve) {
      const playerIds = toArray(application.playerIds ?? application.player_ids);
      add(side, playerIds.length ? playerIds : [application.playerId ?? application.player_id]);
    }
    add(side, roomState.partyReserves?.[applicationKey]);
  });
  MATCH_SIDES.forEach((side) => add(side, roomState.pinnedReservePlayers?.[side]));
  toArray(roomState.invitations).forEach((invitation) => {
    if (invitation.role !== "referee" && invitation.status === "pending" && invitation.reserve) {
      add(invitation.side === "teamA" ? "teamA" : "teamB", [invitation.targetUserId]);
    }
  });
  return result;
}

export function getCanonicalHostJoinMode(post = {}) {
  const teamId = nullableText(post.teamId ?? post.team_id);
  const hostJoinMode = post.hostJoinMode ?? post.host_join_mode;
  return hostJoinMode === "player" || !teamId ? "player" : "team";
}

function getRoomCancelledPayload(post = {}) {
  const cancellationReason = String(post.roomState?.cancellationReasonText ?? "").trim();
  return {
    title: "방 취소",
    body: [
      `${post.title || "매칭방"} 방이 취소되었습니다.`,
      ...(cancellationReason ? [`취소 사유: ${cancellationReason}`] : []),
      `구장: ${post.court || "구장 미정"}`,
      `방식: ${post.mode || "5v5"}`,
    ].join("\n"),
    webPath: getRecruitingWebPath(post.id),
    webUrl: getRecruitingWebUrl(post.id),
    actions: [],
  };
}

function toRoomCancelledNotificationRows(post = {}, participantIds = []) {
  const now = new Date().toISOString();
  const payload = getRoomCancelledPayload(post);
  const fromUserId = post.ownerId ?? post.roomState?.ownerId ?? post.playerId ?? "";
  return toNotificationRows(participantIds.map((profileId) => ({
    id: `discord-room-cancelled-${post.id}-${profileId}`,
    targetUserId: profileId,
    fromUserId,
    title: payload.title,
    body: payload.body,
    tone: "match",
    type: "recruiting_cancelled",
    discordEvent: "match",
    recruitingPostId: post.id,
    webPath: payload.webPath,
    webUrl: payload.webUrl,
    targetStatus: "closed",
    targetUnavailable: true,
    status: "cancelled",
    actionRequired: false,
    homeAction: false,
    skipDiscordSync: true,
    sendAt: now,
    createdAt: now,
    updatedAt: now,
  })), "", { coalesce: "nullish" });
}

function toRoomCancelledDiscordRows(post = {}, profiles = []) {
  const now = new Date().toISOString();
  const payload = getRoomCancelledPayload(post);
  const fromUserId = post.ownerId ?? post.roomState?.ownerId ?? post.playerId ?? "";
  return profiles.map((profile) => {
    const id = `discord-room-cancelled-${post.id}-${profile.id}`;
    return toQueuedDiscordDeliveryRow({
      id,
      notificationId: id,
      targetUserId: profile.id,
      discordUserId: profile.discord_user_id,
      payload: {
        ...payload,
        id,
        recruitingPostId: post.id,
        targetUserId: profile.id,
        fromUserId,
        targetStatus: "closed",
        targetUnavailable: true,
        status: "cancelled",
        queuedAt: now,
        sendAt: now,
      },
      queuedAt: now,
      sendAt: now,
    });
  });
}

export async function queueRecruitingRoomCancelledDeliveries(supabase, post = {}, action = "sync") {
  if (action !== "closeRecruitingPost" || !post?.id) return 0;
  const participantIds = Array.from(participantIdsFromPost(post));
  const notificationRows = toRoomCancelledNotificationRows(post, participantIds);
  if (notificationRows.length) {
    const { error } = await supabase
      .from("notifications")
      .upsert(notificationRows, { onConflict: "id", ignoreDuplicates: true });
    if (error) throw error;
  }
  const profiles = await getDiscordProfiles(supabase, participantIds);
  return upsertDiscordDeliveryRows(supabase, toRoomCancelledDiscordRows(post, profiles));
}
