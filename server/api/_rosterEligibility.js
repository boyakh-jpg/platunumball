import { toArray } from "./_supabaseAdmin.js";

function reject(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

export function addTeamRoster(rostersByTeam, teamId, userIds = []) {
  const safeTeamId = String(teamId || "").trim();
  if (!safeTeamId) return;
  const ids = toArray(userIds).map((userId) => String(userId).trim()).filter(Boolean);
  if (!ids.length) return;
  if (!rostersByTeam.has(safeTeamId)) rostersByTeam.set(safeTeamId, new Set());
  ids.forEach((userId) => rostersByTeam.get(safeTeamId).add(userId));
}

export async function assertProfilesExist(supabase, userIds = [], message = "profile_not_found") {
  const ids = [...new Set(toArray(userIds).map((userId) => String(userId).trim()).filter(Boolean))];
  if (!ids.length) return;

  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .in("id", ids);
  if (error) throw error;

  const foundIds = new Set(toArray(data).map((profile) => profile.id));
  if (ids.some((userId) => !foundIds.has(userId))) reject(403, message);
}

export async function assertTeamRosterMembers(supabase, rostersByTeam, message = "team_roster_not_member") {
  const teamIds = [...rostersByTeam.keys()].filter(Boolean);
  const userIds = [...new Set(teamIds.flatMap((teamId) => [...rostersByTeam.get(teamId)]))];
  if (!teamIds.length || !userIds.length) return;

  const { data, error } = await supabase
    .from("team_members")
    .select("team_id, user_id")
    .in("team_id", teamIds)
    .in("user_id", userIds);
  if (error) throw error;

  const validPairs = new Set(toArray(data).map((row) => `${row.team_id}:${row.user_id}`));
  for (const teamId of teamIds) {
    for (const userId of rostersByTeam.get(teamId)) {
      if (!validPairs.has(`${teamId}:${userId}`)) reject(403, message);
    }
  }
}
