import { allowRequestMethod, getAdminLevel, getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import { getSupabaseAdminClient } from "../_supabaseAuth.js";
import { loadAuthoritativeState } from "../_authoritativeState.js";
import { isPubliclyReadableConfirmedMatch } from "../../../shared/lib/matchRecordTypes.js";
import { EMPTY_STATE } from "../../../shared/lib/repositoryDefaults.js";
import { flattenPlayerIdValues, projectMatchParticipationIds } from "../../../shared/lib/playerIds.js";
import { mapClientTeamEmblem } from "../../../shared/lib/teamEmblem.js";
import { filterStateForProfile, projectPublicMatch, projectPublicUser } from "../../lib/stateVisibility.js";

function projectPublicTeam(team = {}) {
  const publicTeam = {};
  [
    "id",
    "name",
    "description",
    "homeCourt",
    "region",
    "mmr",
    "rosterMmr",
    "wins",
    "losses",
    "accent",
    "createdAt",
    "updatedAt",
  ].forEach((key) => {
    if (team[key] !== undefined) publicTeam[key] = team[key];
  });
  return {
    ...publicTeam,
    ...mapClientTeamEmblem(team),
    members: (Array.isArray(team.members) ? team.members : [])
      .filter((member) => member?.userId)
      .map((member) => ({ userId: member.userId, role: member.role })),
  };
}

export function createPublicMatchState(rawState, match) {
  const profileIds = new Set([
    ...projectMatchParticipationIds(match),
    ...flattenPlayerIdValues(match?.reservePlayers),
    ...flattenPlayerIdValues(match?.rules?.reservePlayers),
    ...Object.keys(match?.result?.playerStats ?? {}),
    match?.refereeId,
    match?.rules?.refereeId,
  ].filter(Boolean).map(String));
  const teamIds = new Set([
    match?.teamA?.teamId,
    match?.teamB?.teamId,
    ...Object.values(match?.teamA?.playerTeams ?? {}),
    ...Object.values(match?.teamB?.playerTeams ?? {}),
  ].filter(Boolean).map(String));
  const filteredState = filterStateForProfile(rawState ?? {}, "", false);

  return {
    ...EMPTY_STATE,
    users: (filteredState.users ?? [])
      .filter((user) => profileIds.has(String(user.id)))
      .map(projectPublicUser),
    teams: (filteredState.teams ?? [])
      .filter((team) => teamIds.has(String(team.id)))
      .map(projectPublicTeam),
    seasons: (filteredState.seasons ?? []).filter((season) => String(season.id) === String(match?.seasonId ?? "")),
    matches: [match],
    settings: {
      ...EMPTY_STATE.settings,
      approvedCourts: filteredState.settings?.approvedCourts ?? [],
    },
  };
}

export async function handleMatchDetail(request, response, { publicRead = false, authenticatedContext = null } = {}) {
  if (!allowRequestMethod(request, response)) return;

  try {
    const body = await readJsonBody(request);
    const matchId = String(body.matchId ?? body.id ?? "").trim();
    if (!matchId) {
      sendJson(response, 400, { error: "match_id_required" });
      return;
    }

    const context = authenticatedContext ?? (publicRead
      ? { supabase: getSupabaseAdminClient(), authUserId: "", authUser: null, profileId: "" }
      : await getAuthenticatedContext(request, { allowMissingProfile: true }));
    const adminLevel = !publicRead && context.profileId ? await getAdminLevel(context) : 0;
    const rawState = await loadAuthoritativeState(context, {
      operation: { action: "loadMatch", matchId },
    });
    const rawMatch = (rawState?.matches ?? []).find((item) => item.id === matchId) ?? null;
    if (publicRead && !isPubliclyReadableConfirmedMatch(rawMatch)) {
      sendJson(response, 404, { error: "match_not_found" });
      return;
    }
    const profileId = context.profileId ?? rawState?.currentUserId ?? "";
    const state = filterStateForProfile(rawState ?? {}, profileId, adminLevel >= 30);
    const match = publicRead
      ? projectPublicMatch(rawMatch)
      : (state.matches ?? []).find((item) => item.id === matchId) ?? null;
    if (!match) {
      sendJson(response, 404, { error: "match_not_found", matchId });
      return;
    }

    sendJson(response, 200, {
      ok: true,
      state: publicRead
        ? createPublicMatchState(rawState, match)
        : {
          ...state,
          matches: [match],
          recruitingPosts: [],
          tournaments: [],
          reports: [],
          discordNotificationDeliveries: [],
        },
      updatedAt: match.updatedAt ?? 0,
    });
  } catch (error) {
    sendJson(response, error.statusCode || 500, { error: error.message || "matches_detail_failed" });
  }
}

export default async function handler(request, response) {
  try {
    const authenticatedContext = await getAuthenticatedContext(request, { allowMissingProfile: true });
    return await handleMatchDetail(request, response, { authenticatedContext });
  } catch (error) {
    sendJson(response, error.statusCode || 500, { error: error.message || "matches_detail_failed" });
  }
}
