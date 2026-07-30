import { isSupportedMatchMode } from "../../../shared/lib/matchConstants.js";
import { nullableText, toArray } from "../_supabaseAdmin.js";
import { isValidBenchCapacity } from "../../../shared/lib/constants.js";
import { addTeamRoster, assertProfilesExist, assertTeamRosterMembers } from "../_rosterEligibility.js";
import { normalizeRecruitingMmrRangeMode } from "../../../shared/lib/recruiting.js";
import { getCanonicalBenchCapacity, getCanonicalHostJoinMode, getCanonicalSideCapacity, getExplicitBenchCapacity, getRecruitingBenchIdsBySide, getRecruitingCoreSnapshot, normalizeRoomState, participantIdsFromPost, rosterIdsFromPost, sameJson } from "./_syncPostProjection.js";
import { isTrue, reject } from "./_syncPostCommon.js";

export function getSideCapacity(post = {}) {
  return getCanonicalSideCapacity(post);
}

export function isSoloIndividualRoom(post = {}) {
  const teamId = nullableText(post.teamId ?? post.team_id);
  return getSideCapacity(post) === 1 && (getCanonicalHostJoinMode(post) === "player" || !teamId);
}

export function isPickupRoom(post = {}) {
  const rules = post.rules && typeof post.rules === "object" ? post.rules : {};
  return (post.formationMode ?? post.formation_mode ?? rules.formationMode) === "pickup"
    || (post.matchIntent ?? post.match_intent ?? rules.matchIntent) === "pickup";
}

export function isIndividualOnlyRoom(post = {}) {
  return isPickupRoom(post) || isSoloIndividualRoom(post);
}

export function getEntryActivePlayerIds(entry = {}, capacity = 5, fallbackPlayerId = "") {
  const playerIds = toArray(entry.playerIds ?? entry.player_ids);
  if (playerIds.length) return playerIds;
  return fallbackPlayerId ? [fallbackPlayerId] : [];
}

export function getRecruitingSideCounts(post = {}) {
  const capacity = getSideCapacity(post);
  const hostSide = (post.hostSide ?? post.host_side) === "teamB" ? "teamB" : "teamA";
  const counts = { teamA: 0, teamB: 0 };
  const seen = new Set();
  const seenSides = new Map();
  const teamPartySides = new Map();
  let crossSideDuplicate = false;
  let crossSideTeamParty = false;
  const addPlayers = (side, playerIds = []) => {
    if (!counts[side]) counts[side] = 0;
    toArray(playerIds).forEach((playerId) => {
      if (!playerId) return;
      const seenSide = seenSides.get(playerId);
      if (seenSide && seenSide !== side) crossSideDuplicate = true;
      seenSides.set(playerId, side);
      if (!playerId || seen.has(playerId)) return;
      seen.add(playerId);
      counts[side] += 1;
    });
  };
  const addTeamParty = (side, teamId) => {
    const normalizedTeamId = nullableText(teamId);
    if (!normalizedTeamId) return;
    const seenSide = teamPartySides.get(normalizedTeamId);
    if (seenSide && seenSide !== side) crossSideTeamParty = true;
    teamPartySides.set(normalizedTeamId, side);
  };

  const hostJoinMode = getCanonicalHostJoinMode(post);
  if (hostJoinMode === "team") addTeamParty(hostSide, post.teamId ?? post.team_id);
  const hostPlayers = hostJoinMode === "team"
    ? getEntryActivePlayerIds(post, capacity, post.playerId ?? post.player_id ?? "")
    : [post.playerId ?? post.player_id].filter(Boolean);
  addPlayers(hostSide, hostPlayers);

  toArray(post.applicants).forEach((application) => {
    const side = application.side === "teamA" ? "teamA" : "teamB";
    const applicationTeamId = application.teamId ?? application.team_id;
    const isTeamEntry = application.kind === "team" || applicationTeamId;
    if (isTeamEntry) addTeamParty(side, applicationTeamId);
    if (application.reserve) return;
    const players = isTeamEntry
      ? getEntryActivePlayerIds(application, capacity, application.playerId ?? application.player_id ?? "")
      : [application.playerId ?? application.player_id].filter(Boolean);
    addPlayers(side, players);
  });

  counts.crossSideDuplicate = crossSideDuplicate;
  counts.crossSideTeamParty = crossSideTeamParty;
  return counts;
}

export function validatePickupRecruitingShape(post = {}) {
  const rules = post.rules && typeof post.rules === "object" ? post.rules : {};
  const matchIntent = post.matchIntent ?? post.match_intent ?? rules.matchIntent;
  const formationMode = post.formationMode ?? post.formation_mode ?? rules.formationMode;
  if (formationMode !== "pickup" && matchIntent !== "pickup") return;

  const roomState = normalizeRoomState(post.roomState ?? post.room_state, post);
  const teamOnly = isTrue(post.teamOnly ?? post.team_only ?? roomState.teamOnly);
  const requestedHostJoinMode = post.hostJoinMode ?? post.host_join_mode;
  if ((requestedHostJoinMode !== undefined && requestedHostJoinMode !== "player") || getCanonicalHostJoinMode(post) !== "player" || teamOnly) {
    reject(400, "pickup_requires_player_room");
  }
  if (isTrue(post.official)) reject(400, "pickup_official_not_supported");
  if ((post.playingTimePolicy ?? rules.playingTimePolicy) !== "equal_rotation") reject(400, "pickup_requires_equal_rotation");
  if ((post.lineupSelectionPolicy ?? rules.lineupSelectionPolicy) !== "no_fixed_starter") reject(400, "pickup_requires_no_fixed_starter");
}

export function validatePickupRecruitingUpdate(existingPost = {}, patch = {}) {
  const currentRules = existingPost.rules && typeof existingPost.rules === "object" ? existingPost.rules : {};
  const patchRules = patch.rules && typeof patch.rules === "object" ? patch.rules : {};
  const currentIntent = existingPost.matchIntent ?? existingPost.match_intent ?? currentRules.matchIntent;
  const requestedIntent = patch.matchIntent ?? patch.match_intent ?? patchRules.matchIntent;
  if (currentIntent !== "pickup" && requestedIntent !== "pickup") return;
  if (currentIntent !== "pickup") reject(400, "pickup_intent_cannot_be_added_by_room_update");
  if (requestedIntent !== undefined && requestedIntent !== "pickup") reject(400, "pickup_intent_cannot_be_removed_by_room_update");

  validatePickupRecruitingShape({
    ...existingPost,
    ...patch,
    matchIntent: "pickup",
    rules: {
      ...currentRules,
      ...patchRules,
      ...(patch.playingTimePolicy === undefined ? {} : { playingTimePolicy: patch.playingTimePolicy }),
      ...(patch.lineupSelectionPolicy === undefined ? {} : { lineupSelectionPolicy: patch.lineupSelectionPolicy }),
      matchIntent: "pickup",
    },
  });
}

export const PICKUP_PARTY_ACTIONS = new Set([
  "joinRecruitingSideParty",
  "setRecruitingPartyPlayerPlacement",
  "setRecruitingPartyPlayerReserve",
  "setRecruitingTeamPartyRoster",
  "detachRecruitingPartyPlayer",
  "removeRecruitingPartyPlayer",
]);

export const PICKUP_POLICY_OPERATION_ACTIONS = new Set([
  "acceptRecruitingInvitation",
  "interestRecruitingPost",
  "inviteRecruitingPlayers",
  "updateRecruitingRoomRules",
  ...PICKUP_PARTY_ACTIONS,
]);

export function normalizePickupRecruitingOperation(existingPost = {}, operation = {}) {
  if (!isPickupRoom(existingPost)) return operation;

  if (PICKUP_PARTY_ACTIONS.has(operation.action)) reject(409, "pickup_party_not_allowed");

  if (operation.action === "inviteRecruitingPlayers") {
    return {
      ...operation,
      invite: {
        ...(operation.invite && typeof operation.invite === "object" ? operation.invite : {}),
        joinMode: "player",
        teamId: "",
        side: "",
        reserve: false,
      },
    };
  }

  if (operation.action === "interestRecruitingPost") {
    if ((operation.application?.joinMode ?? operation.joinMode) === "referee") return operation;
    return {
      ...operation,
      joinMode: "player",
      application: {
        ...(operation.application && typeof operation.application === "object" ? operation.application : {}),
        joinMode: "player",
        teamId: "",
      },
    };
  }

  return operation;
}

export async function validatePickupRecruitingOperation(context, operation = {}) {
  if (operation.action === "createRecruitingPost") {
    validatePickupRecruitingShape(operation.draft ?? {});
    return operation;
  }
  if (!PICKUP_POLICY_OPERATION_ACTIONS.has(operation.action)) return operation;
  const postId = String(operation.postId ?? "").trim();
  if (!postId) return operation;
  const { data, error } = await context.supabase
    .from("recruiting_posts")
    .select("id,ranked,official,host_join_mode,team_id,side_capacity,room_state,rules")
    .eq("id", postId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return operation;
  if (operation.action === "updateRecruitingRoomRules") validatePickupRecruitingUpdate(data, operation.patch ?? {});
  const requestedJoinMode = operation.application?.joinMode ?? operation.joinMode;
  if (
    operation.action === "interestRecruitingPost"
    && requestedJoinMode === "team"
    && !isPickupRoom(data)
    && isSoloIndividualRoom(data)
  ) {
    reject(400, "solo_room_team_party_not_allowed");
  }
  return normalizePickupRecruitingOperation(data, operation);
}
