import { getActualMatchPlayerIds } from "../../lib/matchUtils.js";
import { getMatchHostPlayerId as getMatchHostPlayerIdFromMatch } from "../../lib/matchUtils.js";
import { getMatchRoomPhase } from "../../lib/matchUtils.js";
import { getMatchRosterSideName } from "../../lib/matchUtils.js";
import { getMatchSideLeaderId } from "../../lib/matchUtils.js";
import { isEligibleReferee } from "../../lib/matchUtils.js";
import { isMatchReferee } from "../../lib/matchUtils.js";

function getMatchHostPlayerId(state, match) {
  const sourcePost = match?.recruitingPostId
    ? state.recruitingPosts?.find((post) => post.id === match.recruitingPostId)
    : null;
  return getMatchHostPlayerIdFromMatch(match, sourcePost);
}

function currentUserIsMatchHost(state, match) {
  const hostPlayerId = getMatchHostPlayerId(state, match);
  return Boolean(hostPlayerId && hostPlayerId === state.currentUserId);
}

function currentUserIsEligibleMatchReferee(state, match) {
  const currentUser = state.users.find((user) => user.id === state.currentUserId);
  return Boolean(isMatchReferee(match, state.currentUserId) && isEligibleReferee(currentUser, match?.refereeTrustMin, state.settings?.refereeAppointments));
}

function currentUserCanOperateMatch(state, match) {
  if (!match) return false;
  if (match.refereeId) return currentUserIsEligibleMatchReferee(state, match);
  return currentUserIsMatchHost(state, match);
}

const currentUserCanOperateStartedMatch = currentUserCanOperateMatch;
const currentUserCanResolveMatchDispute = currentUserCanOperateMatch;

function currentUserCanOperateMatchPreparation(state, match) {
  if (!match) return false;
  if (match.refereeId && getMatchRoomPhase(match).phase === "checkin") {
    return currentUserIsEligibleMatchReferee(state, match);
  }
  return currentUserIsMatchHost(state, match);
}

const currentUserCanStartMatch = currentUserCanOperateMatch;

function getMatchRefereeAbsenceOpponentLeaderId(state, match) {
  const hostId = getMatchHostPlayerId(state, match);
  const hostSideName = getMatchRosterSideName(match, hostId) ?? "teamA";
  const opponentSideName = hostSideName === "teamA" ? "teamB" : "teamA";
  return getMatchSideLeaderId(match, state.teams, opponentSideName);
}

function currentUserCanConfirmRefereeAbsence(state, match) {
  const leaderId = getMatchRefereeAbsenceOpponentLeaderId(state, match);
  return Boolean(leaderId && leaderId === state.currentUserId);
}

function currentUserCanFileMatchDispute(state, match) {
  if (!match) return false;
  return getActualMatchPlayerIds(match).includes(state.currentUserId);
}

function canEditMatchPreparation(state, match) {
  if (!match || !["contract", "agreed"].includes(match.status) || match.result || match.endedAt || match.startedAt) return false;
  return currentUserCanOperateMatchPreparation(state, match);
}

export {
  canEditMatchPreparation,
  currentUserCanConfirmRefereeAbsence,
  currentUserCanFileMatchDispute,
  currentUserCanOperateMatchPreparation,
  currentUserCanOperateStartedMatch,
  currentUserCanResolveMatchDispute,
  currentUserCanStartMatch,
  currentUserIsEligibleMatchReferee,
  currentUserIsMatchHost,
  getMatchHostPlayerId,
};
