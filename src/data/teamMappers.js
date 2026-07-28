import { DEFAULT_RATING, MAX_RECRUITING_RESERVES_PER_SIDE, isSameRegion, normalizeTeamRole } from "../lib/constants.js";
import { getAgeGroupForUser } from "../lib/profileSetup.js";
import { MMR_RANGE_POLICIES, getSelectableTeamPlayerIds } from "../lib/recruiting.js";
import { uniquePlayerIds } from "./rowUtils.js";

export const TEAM_DISCOVERY_GROUP_LIMIT = 5;

function getTeamMemberProfiles(team = {}, userById = new Map()) {
  return (team.members ?? [])
    .map((member) => userById.get(member.userId))
    .filter(Boolean);
}

function getDominantTeamAgeGroup(team = {}, userById = new Map()) {
  const counts = new Map();
  getTeamMemberProfiles(team, userById).forEach((user) => {
    const ageGroup = getAgeGroupForUser(user);
    if (ageGroup) counts.set(ageGroup, (counts.get(ageGroup) ?? 0) + 1);
  });
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "";
}

export function getTeamDiscoveryGroups({
  teams = [],
  users = [],
  currentUser = {},
  ownTeamIds = [],
  referenceTeam = null,
  limit = TEAM_DISCOVERY_GROUP_LIMIT,
} = {}) {
  const safeLimit = Math.max(1, Math.min(TEAM_DISCOVERY_GROUP_LIMIT, Number(limit) || TEAM_DISCOVERY_GROUP_LIMIT));
  const ownTeamIdSet = new Set(ownTeamIds);
  const userById = new Map(users.filter((user) => user?.id).map((user) => [user.id, user]));
  const referenceMmr = Number(referenceTeam?.mmr ?? currentUser?.ratings?.integrated ?? DEFAULT_RATING);
  const currentAgeGroup = getAgeGroupForUser(currentUser);
  const currentAffiliationId = String(currentUser?.affiliationId ?? "").trim();
  const candidates = teams
    .filter((team) => team?.id && !ownTeamIdSet.has(team.id))
    .map((team) => ({
      team,
      mmrGap: Math.abs(Number(team.mmr ?? DEFAULT_RATING) - referenceMmr),
      ageGroup: getDominantTeamAgeGroup(team, userById),
      sharesAffiliation: Boolean(
        currentAffiliationId
        && getTeamMemberProfiles(team, userById).some((user) => user.affiliationId === currentAffiliationId)
      ),
    }))
    .sort((a, b) => a.mmrGap - b.mmrGap || String(a.team.name).localeCompare(String(b.team.name)));
  const usedTeamIds = new Set();
  const take = (predicate) => {
    const selected = candidates
      .filter((candidate) => !usedTeamIds.has(candidate.team.id) && predicate(candidate))
      .slice(0, safeLimit)
      .map((candidate) => candidate.team);
    selected.forEach((team) => usedTeamIds.add(team.id));
    return selected;
  };

  return {
    nearby: take(({ team }) => isSameRegion(team.region, currentUser.region)),
    rivals: take(({ mmrGap, ageGroup }) => (
      ageGroup === currentAgeGroup
      && mmrGap <= MMR_RANGE_POLICIES.normal.gap
    )),
    affiliation: take(({ sharesAffiliation }) => sharesAffiliation),
  };
}

export function fromRemoteTeam(row, memberRows) {
  return {
    id: row.id,
    name: row.name,
    homeCourt: row.home_court,
    region: row.region,
    mmr: row.mmr ?? DEFAULT_RATING,
    rosterMmr: row.roster_mmr ?? row.mmr ?? DEFAULT_RATING,
    performanceAdjustment: Number(row.performance_adjustment ?? 0),
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
    emblemViolationCount: Number(row.emblem_violation_count ?? 0),
    emblemUploadBlockedUntil: row.emblem_upload_blocked_until ?? null,
    emblemModeratedAt: row.emblem_moderated_at ?? null,
    emblemModerationReason: row.emblem_moderation_reason ?? "",
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

export function getTeamCaptainMemberId(team = {}) {
  return (team.members ?? []).find((member) => member.role === "captain")?.userId ?? null;
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
