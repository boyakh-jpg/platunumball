import {
  DEFAULT_RATING,
  REFEREE_TRUST_MIN,
  STAT_ENTRY_WINDOW_MINUTES,
  normalizeDisputeWindowMinutes,
} from "../lib/constants.js";
import { isPublicTeamRecruitingRoom } from "../lib/recruiting.js";
import {
  ROOM_CHAT_CLIENT_CACHE_LIMIT,
  ROOM_CHAT_OPTIMISTIC_MATCH_WINDOW_MS,
  fromRoomChatMessageRow,
} from "../lib/roomChat.js";
import { normalizeTeamEmblemTextMode } from "../lib/teamEmblem.js";

function defaultToDateTime(date, time, fallback) {
  if (date && time) return `${date} ${String(time).slice(0, 5)}`;
  if (date) return date;
  return fallback ?? "일정 미정";
}

function defaultNormalizeRegionKey(value = "") {
  return String(value ?? "").trim();
}

function mergeRecruitingRoomChatMessages(legacyMessages = [], remoteMessages = []) {
  const merged = [];
  [...(legacyMessages ?? []), ...(remoteMessages ?? [])].forEach((message) => {
    const next = fromRoomChatMessageRow(message);
    if (!next.userId || !next.body.trim()) return;
    const nextTime = Date.parse(next.createdAt || 0);
    const duplicate = merged.some((item) => {
      if (next.id && item.id === next.id) return true;
      if (item.userId !== next.userId || item.body !== next.body) return false;
      const itemTime = Date.parse(item.createdAt || 0);
      return Number.isFinite(nextTime) && Number.isFinite(itemTime) && Math.abs(nextTime - itemTime) <= ROOM_CHAT_OPTIMISTIC_MATCH_WINDOW_MS;
    });
    if (!duplicate) merged.push(next);
  });
  return merged
    .sort((a, b) => (Number(a.messageSeq ?? 0) - Number(b.messageSeq ?? 0)) || String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")))
    .slice(-ROOM_CHAT_CLIENT_CACHE_LIMIT);
}

export function toClientRecruitingTeam(row = {}, memberRows = []) {
  const members = [...(memberRows ?? [])]
    .sort((a, b) => String(a.role).localeCompare(String(b.role)) || String(a.user_id).localeCompare(String(b.user_id)))
    .map((member) => ({ userId: member.user_id, role: member.role ?? "regular" }));
  return {
    id: row.id,
    name: row.name,
    homeCourt: row.home_court,
    region: row.region,
    mmr: row.mmr ?? DEFAULT_RATING,
    wins: row.wins ?? 0,
    losses: row.losses ?? 0,
    accent: row.accent,
    emblemKey: row.emblem_key ?? null,
    emblemSource: row.emblem_source ?? (row.emblem_key ? "upload" : "initial"),
    emblemUpdatedAt: row.emblem_updated_at ?? null,
    emblemUploadedAt: row.emblem_uploaded_at ?? null,
    emblemUploadCount: Number(row.emblem_upload_count ?? 0),
    emblemColor: row.emblem_color ?? row.accent ?? null,
    emblemBorderEnabled: row.emblem_border_enabled !== false,
    emblemBorderColor: row.emblem_border_color ?? row.accent ?? null,
    emblemTextMode: normalizeTeamEmblemTextMode(row.emblem_text_mode),
    emblemAbbreviation: row.emblem_abbreviation ?? "",
    emblemFont: row.emblem_font ?? "sport",
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? row.created_at ?? null,
    membersPartial: members.length === 0,
    members,
  };
}

export function fromRemoteRecruitingApplication(row = {}) {
  return {
    kind: row.kind,
    joinMode: row.kind,
    teamId: row.team_id,
    playerId: row.player_id,
    side: row.side,
    status: row.status,
    reserve: row.reserve,
    position: row.position,
    playerIds: row.player_ids ?? [],
    sourceTeamId: row.source_team_id ?? null,
    sourceEntryId: row.source_entry_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function fromRemoteRecruitingPost(row = {}, {
  applicationsByPost = new Map(),
  courtById = {},
  chatMessagesByPost = new Map(),
  normalizeRegionKey = defaultNormalizeRegionKey,
  toDateTime = defaultToDateTime,
} = {}) {
  const rawScheduledAt = toDateTime(row.scheduled_date, row.scheduled_time, row.scheduled_at);
  const roomState = row.room_state && typeof row.room_state === "object" ? row.room_state : {};
  const chatMessages = chatMessagesByPost.has(row.id)
    ? mergeRecruitingRoomChatMessages(roomState.chatMessages ?? [], chatMessagesByPost.get(row.id) ?? [])
    : roomState.chatMessages;
  const timingType = roomState.timingType === "instant" || rawScheduledAt === "즉시" ? "instant" : "scheduled";
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    visibility: row.visibility ?? "public",
    region: row.region,
    regionKey: normalizeRegionKey(row.region),
    courtId: row.court_id ?? null,
    court: row.court_name ?? courtById[row.court_id]?.name ?? "미정",
    mode: row.mode,
    scheduledDate: row.scheduled_date,
    scheduledTime: row.scheduled_time ? String(row.scheduled_time).slice(0, 5) : "",
    scheduledAt: timingType === "instant" ? "즉시" : rawScheduledAt,
    timingType,
    ranked: row.ranked,
    official: Boolean(row.official),
    preRegistered: row.pre_registered !== false,
    ratingScale: Number(row.rating_scale ?? 1),
    ageRestriction: row.age_restriction ?? "any",
    allowedAgeGroups: row.allowed_age_groups ?? [],
    rules: row.rules ?? {},
    stakes: row.stakes ?? "",
    courtReserved: Boolean(row.court_reserved),
    courtFee: row.court_fee ?? "",
    spots: row.spots,
    teamId: row.team_id,
    targetTeamId: row.target_team_id,
    refereeWanted: Boolean(roomState.refereeWanted || row.referee_id),
    refereeId: row.referee_id ?? "",
    refereeTrustMin: row.referee_trust_min ?? REFEREE_TRUST_MIN,
    statEntryMinutes: row.stat_entry_minutes ?? STAT_ENTRY_WINDOW_MINUTES,
    disputeMinutes: normalizeDisputeWindowMinutes(row.dispute_minutes),
    roomState: chatMessages ? { ...roomState, chatMessages } : roomState,
    mmrLimitMode: ["off", "warn", "block"].includes(roomState.mmrLimitMode) ? roomState.mmrLimitMode : "block",
    teamOnly: roomState.teamOnly === true || isPublicTeamRecruitingRoom({ visibility: row.visibility, hostJoinMode: row.host_join_mode }),
    hostJoinMode: row.host_join_mode,
    hostSide: row.host_side,
    hostReady: row.host_ready,
    sideCapacity: row.side_capacity,
    playerIds: row.player_ids ?? [],
    position: row.position,
    playerId: row.player_id,
    memo: row.memo,
    status: row.status,
    confirmedAt: row.confirmed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    applicants: (applicationsByPost.get(row.id) ?? []).map(fromRemoteRecruitingApplication),
  };
}
