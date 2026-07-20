import { MAX_RECRUITING_RESERVES_PER_SIDE, normalizeTeamRole } from "../lib/constants.js";
import { getSelectableTeamPlayerIds } from "../lib/recruiting.js";
import { uniquePlayerIds } from "./rowUtils.js";

export function fromRemoteTeam(row, memberRows) {
  return {
    id: row.id,
    name: row.name,
    homeCourt: row.home_court,
    region: row.region,
    mmr: row.mmr ?? 1200,
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
    emblemTextMode: new Set(["name", "abbreviation"]).has(row.emblem_text_mode) ? row.emblem_text_mode : "initial",
    emblemAbbreviation: row.emblem_abbreviation ?? "",
    emblemFont: row.emblem_font ?? "sport",
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? row.created_at ?? null,
    members: [...(memberRows ?? [])]
      .sort((a, b) => String(a.role).localeCompare(String(b.role)) || String(a.user_id).localeCompare(String(b.user_id)))
      .map((member) => ({ userId: member.user_id, role: member.role ?? "regular" })),
  };
}

export function fromRemoteTeamInvitation(row = {}) {
  return {
    id: row.id,
    teamId: row.team_id,
    fromUserId: row.from_user_id,
    targetUserId: row.target_user_id,
    role: row.role ?? "regular",
    status: row.status ?? "pending",
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
  };
}

export function getTeamPlayers(team, size) {
  return team.members.slice(0, size).map((member) => member.userId);
}

export function getTeamMemberIds(team = {}) {
  return (team.members ?? []).map((member) => member.userId).filter(Boolean);
}

export function ensureTeamPartyLeader(team = {}, playerIds = [], leaderId = "", capacity = Infinity) {
  const selectableIds = new Set(getSelectableTeamPlayerIds(team));
  const safePlayerIds = uniquePlayerIds(playerIds).filter((playerId) => selectableIds.has(playerId));
  if (!leaderId || !selectableIds.has(leaderId)) return safePlayerIds.slice(0, capacity);
  return [leaderId, ...safePlayerIds.filter((playerId) => playerId !== leaderId)].slice(0, capacity);
}

export function getSelectedReservePlayerIds(team = {}, activeIds = [], reserveIds = [], capacity = MAX_RECRUITING_RESERVES_PER_SIDE) {
  if (!team || !Array.isArray(reserveIds) || !reserveIds.length) return [];
  const activeSet = new Set(activeIds);
  const teamPlayerIds = new Set((team.members ?? []).map((member) => member.userId));
  return uniquePlayerIds(reserveIds)
    .filter((playerId) => teamPlayerIds.has(playerId) && !activeSet.has(playerId))
    .slice(0, capacity);
}

export function normalizeTeamInviteRole(role = "regular") {
  return normalizeTeamRole(role, { allowCaptain: false });
}
