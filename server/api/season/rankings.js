import { fromRemoteProfile } from "../../../shared/lib/profileMappers.js";
import { fromRemoteTeam } from "../../../shared/lib/teamMappers.js";
import {
  allowRequestMethod,
  getAuthenticatedContext,
  readJsonBody,
  sendJson,
} from "../_supabaseAdmin.js";

function mapPlayer(row = {}) {
  return {
    ...fromRemoteProfile(row.profile ?? {}),
    privacy: row.privacy ?? { regionRanking: false },
    seasonPlayed: Number(row.season_played ?? 0),
    seasonWins: Number(row.season_wins ?? 0),
    seasonLosses: Number(row.season_losses ?? 0),
    seasonDelta: Number(row.season_delta ?? 0),
    seasonStats: row.season_stats ?? { points: 0, rebounds: 0, assists: 0 },
    seasonScore: Number(row.season_score ?? 0),
  };
}

function mapTeam(row = {}) {
  return {
    ...fromRemoteTeam(row.team ?? {}, []),
    seasonPlayed: Number(row.season_played ?? 0),
    seasonWins: Number(row.season_wins ?? 0),
    seasonLosses: Number(row.season_losses ?? 0),
    seasonDelta: Number(row.season_delta ?? 0),
    seasonScore: Number(row.season_score ?? 0),
  };
}

export default async function handler(request, response) {
  if (!allowRequestMethod(request, response)) return;

  try {
    const body = await readJsonBody(request);
    const context = await getAuthenticatedContext(request);
    const seasonId = String(body.seasonId ?? "").trim().slice(0, 120) || null;
    const { data, error } = await context.supabase.rpc("rankball_season_rankings", {
      p_actor_profile_id: context.profileId,
      p_season_id: seasonId,
    });
    if (error) throw error;

    sendJson(response, 200, {
      ok: true,
      season: data?.season ?? null,
      players: (data?.players ?? []).map(mapPlayer),
      teams: (data?.teams ?? []).map(mapTeam),
    });
  } catch (error) {
    sendJson(response, error.statusCode || 500, { error: error.message || "season_rankings_load_failed" });
  }
}
