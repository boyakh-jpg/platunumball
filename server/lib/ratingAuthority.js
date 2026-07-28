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
import { clampTrustScore, getFoulTrustPenalty } from "../../src/data/trustUtils.js";

const RECRUITING_RANGE_SCALES = Object.freeze({
  narrow: 1.1,
  normal: 1,
  wide: 0.8,
});
const PICKUP_ASSIGNMENT_SCALES = Object.freeze({
  manual: 0.9,
  random: 1,
  balanced: 1.1,
});
const POSTGAME_RECORD_SCALES = Object.freeze({
  "1v1": 0.1,
  "2v2": 0.2,
  "3v3": 0.35,
  "5v5": 0.5,
});
const TOURNAMENT_COMMUNITY_SCALE = 0.8;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getRecruitingRatingScale({ ranked = true, mmrRangeMode = "normal" } = {}) {
  if (ranked === false) return 0;
  return RECRUITING_RANGE_SCALES[mmrRangeMode] ?? RECRUITING_RANGE_SCALES.normal;
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
  getAdminRestoreRatingFactor: (actionType) => actionType === "restoreMatchHalf" ? 0.5 : 1,
  getPickupTeamAssignmentRatingScale: (mode) => PICKUP_ASSIGNMENT_SCALES[mode] ?? PICKUP_ASSIGNMENT_SCALES.balanced,
  getPostgameRecordMmrScale: (match = {}) => POSTGAME_RECORD_SCALES[match.mode] ?? 0,
  getRecruitingRatingScale,
  getTournamentRatingScale: (official) => official ? 1 : TOURNAMENT_COMMUNITY_SCALE,
});
