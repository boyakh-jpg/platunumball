import { createProfileShell } from "./profileMappers.js";
import { uniqueScopeIds } from "./remoteQuery.js";
import { flattenIdValues } from "./rowUtils.js";

export function collectMatchPageScope(matches = [], matchPlayers = [], matchResults = [], playerStats = [], agreements = [], approvals = [], disputes = [], profileIds = []) {
  const teamIds = [];
  const courtIds = [];
  const scopedProfileIds = [...profileIds];
  matches.forEach((match) => {
    teamIds.push(match.team_a_id, match.team_b_id);
    courtIds.push(match.court_id);
    scopedProfileIds.push(
      match.created_by,
      match.referee_id,
      match.former_referee_id,
      ...flattenIdValues(match.stat_recorders),
      ...flattenIdValues(match.played_player_ids),
      ...flattenIdValues(match.reserve_players),
      ...flattenIdValues(match.promoted_reserve_ids),
      ...flattenIdValues(match.attendance),
      ...flattenIdValues(match.referee_absence_request),
      ...flattenIdValues(match.dispute_draft_result),
    );
  });
  matchPlayers.forEach((row) => {
    teamIds.push(row.team_id);
    scopedProfileIds.push(row.user_id);
  });
  matchResults.forEach((row) => {
    scopedProfileIds.push(row.submitted_by, ...flattenIdValues(row.stat_submissions));
  });
  playerStats.forEach((row) => {
    scopedProfileIds.push(row.user_id, row.recorded_by);
  });
  agreements.forEach((row) => scopedProfileIds.push(row.user_id));
  approvals.forEach((row) => scopedProfileIds.push(row.user_id));
  disputes.forEach((row) => scopedProfileIds.push(row.user_id));
  return {
    teamIds: uniqueScopeIds(teamIds),
    courtIds: uniqueScopeIds(courtIds),
    profileIds: uniqueScopeIds(scopedProfileIds),
  };
}

function collectTeamIdsFromRoomKeys(value = {}) {
  return Object.keys(value ?? {})
    .map((key) => String(key || "").match(/^team:(.+)$/)?.[1] ?? "")
    .filter(Boolean);
}

export function collectRecruitingPageScope(posts = [], applications = [], profileIds = []) {
  const teamIds = [];
  const courtIds = [];
  const scopedProfileIds = [...profileIds];
  posts.forEach((post) => {
    const roomState = post.room_state ?? {};
    const invitations = Array.isArray(roomState.invitations) ? roomState.invitations : [];
    teamIds.push(
      post.team_id,
      post.target_team_id,
      ...invitations.map((invitation) => invitation.teamId ?? invitation.team_id),
      ...collectTeamIdsFromRoomKeys(roomState.partyLeaders),
      ...collectTeamIdsFromRoomKeys(roomState.partyReserves),
    );
    courtIds.push(post.court_id);
    scopedProfileIds.push(
      post.player_id,
      post.referee_id,
      ...flattenIdValues(post.player_ids),
      roomState.ownerId,
      ...flattenIdValues(roomState.partyLeaders),
      ...flattenIdValues(roomState.partyReserves),
      ...flattenIdValues(roomState.pinnedReservePlayers),
      ...flattenIdValues(roomState.reserveReady),
      ...invitations.flatMap((invitation) => [
        invitation.targetUserId,
        invitation.fromUserId,
        ...(invitation.playerIds ?? []),
      ]),
    );
  });
  applications.forEach((application) => {
    teamIds.push(application.team_id, application.source_team_id);
    scopedProfileIds.push(application.player_id, ...flattenIdValues(application.player_ids));
  });
  return {
    teamIds: uniqueScopeIds(teamIds),
    courtIds: uniqueScopeIds(courtIds),
    profileIds: uniqueScopeIds(scopedProfileIds),
  };
}

export function collectTournamentPageScope(tournaments = [], tournamentTeams = [], profileIds = []) {
  const teamIds = [];
  const courtIds = [];
  const scopedProfileIds = [...profileIds];
  tournaments.forEach((tournament) => {
    courtIds.push(tournament.court_id);
    scopedProfileIds.push(
      tournament.created_by,
      ...flattenIdValues(tournament.team_approvals),
      ...flattenIdValues(tournament.bracket),
    );
  });
  tournamentTeams.forEach((row) => {
    teamIds.push(row.team_id);
    scopedProfileIds.push(row.approved_by);
  });
  return {
    teamIds: uniqueScopeIds(teamIds),
    courtIds: uniqueScopeIds(courtIds),
    profileIds: uniqueScopeIds(scopedProfileIds),
  };
}

export function makeCurrentUserFromProfiles(profiles = [], authUserIdText = "", authEmail = "") {
  const currentProfile = authUserIdText
    ? profiles.find((profile) => String(profile.auth_user_id ?? "") === authUserIdText)
    : null;
  const shellUser = authUserIdText && !currentProfile ? createProfileShell(authUserIdText, authEmail) : null;
  const currentUserId = currentProfile?.id ?? shellUser?.id ?? profiles[0]?.id ?? "";
  return { currentProfile, shellUser, currentUserId };
}

export function getClientPrivateProfileFilter(authUserIdText = "") {
  if (!authUserIdText) return null;
  return (query) => query.eq("auth_user_id", authUserIdText);
}

export function mergePublicProfilesIntoProfiles(profiles = [], publicProfiles = [], privateProfileById = new Map()) {
  publicProfiles.forEach((profile) => {
    const mergedProfile = { ...profile, ...(privateProfileById.get(profile.id) ?? {}) };
    const existingIndex = profiles.findIndex((item) => item.id === mergedProfile.id);
    if (existingIndex >= 0) profiles[existingIndex] = { ...profiles[existingIndex], ...mergedProfile };
    else profiles.push(mergedProfile);
  });
  return profiles;
}

export function getMatchRowReaderIds(row = {}, players = [], results = [], stats = [], agreements = [], approvals = [], disputes = []) {
  return uniqueScopeIds([
    row.created_by,
    row.referee_id,
    row.former_referee_id,
    row.result?.submitted_by,
    ...players.map((player) => player.user_id),
    ...results.map((result) => result.submitted_by),
    ...stats.flatMap((stat) => [stat.user_id, stat.recorded_by]),
    ...agreements.map((agreement) => agreement.user_id),
    ...approvals.map((approval) => approval.user_id),
    ...disputes.map((dispute) => dispute.user_id),
    ...flattenIdValues(row.stat_recorders),
    ...flattenIdValues(row.played_player_ids),
    ...flattenIdValues(row.reserve_players),
    ...flattenIdValues(row.promoted_reserve_ids),
    ...flattenIdValues(row.attendance),
    ...flattenIdValues(row.referee_absence_request),
    ...flattenIdValues(row.dispute_draft_result),
  ]);
}
