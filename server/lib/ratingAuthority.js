import {
  applyMatchRating,
  averageTeamMmr,
  calculateRosterBasedTeamMmr,
  calculateTeamDelta,
  getFinalizationRatingContext,
  getMatchSideTeamGroups,
  TEAM_PERFORMANCE_ADJUSTMENT_LIMIT,
  teamRegularRatio,
} from "./ratingEngine.js";
import { clampTrustScore, getFoulTrustPenalty } from "../../shared/lib/trustUtils.js";
import {
  getAdminRestoreRatingFactor,
  getPickupTeamAssignmentRatingScale,
  getPostgameRecordMmrScale,
  getRecruitingRatingScale,
  getTournamentRatingScale,
} from "../../shared/lib/ratingAuthority.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function calculateFinalizationRating(state, targetMatch) {
  const ratingContext = getFinalizationRatingContext(targetMatch, state.teams);
  const ratingMatch = ratingContext.matchForRating;
  const ratings = Object.fromEntries(state.users.map((user) => [user.id, clone(user.ratings)]));
  const ratingResult = ratingContext.canApplyPersonalMmr
    ? applyMatchRating(ratingMatch, state.users, ratings, state.matches, state.teams)
    : { ratings: {}, changes: [] };
  const scoreA = Number(targetMatch.result.scoreA);
  const scoreB = Number(targetMatch.result.scoreB);
  const actualA = scoreA === scoreB ? 0.5 : scoreA > scoreB ? 1 : 0;
  const actualB = 1 - actualA;
  const teamAGroups = ratingContext.canApplyTeamMmr ? getMatchSideTeamGroups(state, ratingMatch, "teamA") : [];
  const teamBGroups = ratingContext.canApplyTeamMmr ? getMatchSideTeamGroups(state, ratingMatch, "teamB") : [];
  const teamAMmr = averageTeamMmr(teamAGroups);
  const teamBMmr = averageTeamMmr(teamBGroups);
  const teamDeltaEntries = [
    ...teamAGroups.map((group) => ({
      teamId: group.team.id,
      side: "teamA",
      actual: actualA,
      delta: calculateTeamDelta({
        teamMmr: group.team.mmr,
        opponentTeamMmr: teamBMmr,
        actual: actualA,
        match: ratingMatch,
        regularRatio: teamRegularRatio(group.team, group.playerIds, state.users),
      }),
    })),
    ...teamBGroups.map((group) => ({
      teamId: group.team.id,
      side: "teamB",
      actual: actualB,
      delta: calculateTeamDelta({
        teamMmr: group.team.mmr,
        opponentTeamMmr: teamAMmr,
        actual: actualB,
        match: ratingMatch,
        regularRatio: teamRegularRatio(group.team, group.playerIds, state.users),
      }),
    })),
  ];
  const teamDeltaById = Object.fromEntries(teamDeltaEntries.map((entry) => [entry.teamId, entry]));
  const trustRewards = new Map();
  if (targetMatch.refereeId) trustRewards.set(targetMatch.refereeId, 1);

  const users = state.users.map((user) => {
    const nextRatings = ratingResult.ratings[user.id];
    const trustReward = trustRewards.get(user.id) ?? 0;
    if (!nextRatings && !trustReward) return user;
    const change = ratingResult.changes.find((item) => item.playerId === user.id);
    const foulPenalty = getFoulTrustPenalty(targetMatch.result?.playerStats?.[user.id]);
    return {
      ...user,
      trustScore: clampTrustScore((user.trustScore ?? 80) + (nextRatings ? 1 : 0) + trustReward + foulPenalty),
      streak: nextRatings
        ? change?.result === "win"
          ? Math.max(1, user.streak + 1)
          : change?.result === "loss"
            ? Math.min(-1, user.streak - 1)
            : user.streak
        : user.streak,
      ratings: nextRatings ?? user.ratings,
    };
  });
  const teams = state.teams.map((team) => {
    const teamDelta = teamDeltaById[team.id];
    const base = calculateRosterBasedTeamMmr(team, users);
    if (!teamDelta) return { ...team, ...base };
    const performanceAdjustment = Math.max(
      -TEAM_PERFORMANCE_ADJUSTMENT_LIMIT,
      Math.min(TEAM_PERFORMANCE_ADJUSTMENT_LIMIT, base.performanceAdjustment + teamDelta.delta),
    );
    return {
      ...team,
      rosterMmr: base.rosterMmr,
      performanceAdjustment,
      mmr: Math.round(base.rosterMmr + performanceAdjustment),
      wins: team.wins + (teamDelta.actual === 1 ? 1 : 0),
      losses: team.losses + (teamDelta.actual === 0 ? 1 : 0),
    };
  });

  return {
    users,
    teams,
    changes: ratingResult.changes,
    teamRatingResult: {
      teamA: teamDeltaEntries.filter((entry) => entry.side === "teamA").reduce((sum, entry) => sum + entry.delta, 0),
      teamB: teamDeltaEntries.filter((entry) => entry.side === "teamB").reduce((sum, entry) => sum + entry.delta, 0),
      teams: Object.fromEntries(teamDeltaEntries.map((entry) => [entry.teamId, entry.delta])),
    },
  };
}

export const SERVER_RATING_AUTHORITY = Object.freeze({
  calculateFinalizationRating,
  getAdminRestoreRatingFactor,
  getPickupTeamAssignmentRatingScale,
  getPostgameRecordMmrScale,
  getRecruitingRatingScale,
  getTournamentRatingScale,
});
