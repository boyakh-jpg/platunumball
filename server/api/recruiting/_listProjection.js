import { flattenIdValues, isMissingRoomFeedCards, uniqueStringIds as uniqueIds } from "../_supabaseAdmin.js";
import { attachRoomFeedCardJson, collectUniqueRoomFeedCards, mergeFeedRelations, readRoomFeedCard } from "../../lib/roomFeedCards.js";
import { fromRemoteRecruitingApplication } from "../../../shared/lib/recruitingMappers.js";
import { normalizeBenchCapacity } from "../../../shared/lib/constants.js";
import { PROFILE_CARD_COLUMNS as PROFILE_PUBLIC_COLUMNS } from "../../../shared/lib/repositoryColumns.js";
import { getRecruitingLobby, isPickupRecruitingRoom, isPublicTeamRecruitingRoom } from "../../../shared/lib/recruiting.js";
export { compactRecruitingListState } from "./_listProjectionCompact.js";


const REGION_SIDO_PREFIXES = [
  "서울특별시",
  "부산광역시",
  "대구광역시",
  "인천광역시",
  "대전광역시",
  "울산광역시",
  "세종특별자치시",
  "경기도",
  "강원특별자치도",
  "충청북도",
  "충청남도",
  "전북특별자치도",
  "전남광주통합특별시",
  "광주광역시",
  "전라남도",
  "전남광주특별시",
  "광주전남통합특별시",
  "광주전남특별통합시",
  "광주특별시",
  "전라북도",
  "경상북도",
  "경상남도",
  "제주특별자치도",
];

const REGION_KEY_ALIASES = new Map([
  ["성수", "성동"],
  ["잠실", "송파"],
  ["seoul:mapo", "마포"],
  ["seoulmapo", "마포"],
  ["mapo", "마포"],
]);

export function normalizeRegionKey(value = "") {
  const compact = String(value ?? "").trim().replace(/\s+/g, "").toLowerCase();
  if (!compact) return "";
  if (REGION_KEY_ALIASES.has(compact)) return REGION_KEY_ALIASES.get(compact);
  const parts = String(value ?? "").trim().toLowerCase().split(/[\s:/_-]+/).filter(Boolean);
  let district = parts.at(-1) || compact;
  for (const prefix of REGION_SIDO_PREFIXES) {
    const normalizedPrefix = prefix.toLowerCase();
    if (district.startsWith(normalizedPrefix)) {
      district = district.slice(normalizedPrefix.length);
      break;
    }
  }
  const key = district
    .replace(/\s+/g, "")
    .replace(/(특별시|광역시|특별자치시|특별자치도|자치구|시|군|구)$/u, "");
  return REGION_KEY_ALIASES.get(key) ?? key;
}

function normalizeRecruitingListCountSide(value = {}, fallbackCapacity = 5) {
  if (Array.isArray(value)) {
    const [filled, projectedFilled, confirmationProjectedFilled, capacity] = value;
    return {
      filled: Number(filled ?? 0) || 0,
      projectedFilled: Number(projectedFilled ?? filled ?? 0) || 0,
      confirmationProjectedFilled: Number(confirmationProjectedFilled ?? projectedFilled ?? filled ?? 0) || 0,
      capacity: Number(capacity ?? fallbackCapacity) || fallbackCapacity,
    };
  }
  const filled = Number(value?.filled ?? value?.f ?? value?.count ?? 0) || 0;
  const projectedFilled = Number(value?.projectedFilled ?? value?.p ?? filled) || filled;
  const confirmationProjectedFilled = Number(value?.confirmationProjectedFilled ?? value?.cf ?? projectedFilled) || projectedFilled;
  return {
    filled,
    projectedFilled,
    confirmationProjectedFilled,
    capacity: Number(value?.capacity ?? value?.c ?? fallbackCapacity) || fallbackCapacity,
  };
}

function normalizeRecruitingListCounts(value = {}, sideCapacity = 5) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const teamA = normalizeRecruitingListCountSide(value.teamA ?? value.a, sideCapacity);
  const teamB = normalizeRecruitingListCountSide(value.teamB ?? value.b, sideCapacity);
  return {
    teamA,
    teamB,
    filled: Number(value.filled ?? value.f ?? teamA.filled + teamB.filled) || 0,
    projectedFilled: Number(value.projectedFilled ?? value.p ?? teamA.projectedFilled + teamB.projectedFilled) || 0,
    capacity: Number(value.capacity ?? value.c ?? teamA.capacity + teamB.capacity) || 0,
    partyCount: Number(value.partyCount ?? value.pc ?? 0) || 0,
    pickup: value.pickup === true || value.pk === true,
    participantFilled: Number(value.participantFilled ?? value.participantCount ?? 0) || 0,
    participantCapacity: Number(value.participantCapacity ?? value.pickupCapacity ?? 0) || 0,
  };
}

export function isSameRegionKey(value = "", regionKey = "") {
  return Boolean(regionKey && normalizeRegionKey(value) === regionKey);
}

export function getProfileRegionKey(profile = {}) {
  return normalizeRegionKey(profile?.region_district || profile?.region || "");
}

function normalizeRecruitingFeedCard(row = {}) {
  const candidate = readRoomFeedCard(row);
  if (!candidate || !Object.keys(candidate.card).length) return null;
  const { card, id } = candidate;
  const roomState = card.roomState && typeof card.roomState === "object" && !Array.isArray(card.roomState) ? card.roomState : {};
  const ownerId = card.ownerId ?? roomState.ownerId ?? card.createdBy ?? card.playerId ?? "";
  const playerId = card.playerId ?? ownerId;
  const teamId = String(card.teamId ?? card.team_id ?? "").trim();
  const hostJoinMode = card.hostJoinMode === "player" || !teamId ? "player" : "team";
  return {
    ...card,
    id,
    regionKey: normalizeRegionKey(card.regionKey ?? card.region ?? ""),
    ...(card.listCounts ? { listCounts: normalizeRecruitingListCounts(card.listCounts, Number(card.sideCapacity ?? 5) || 5) } : {}),
    teamId: teamId || null,
    hostJoinMode,
    ...(ownerId ? { ownerId } : {}),
    ...(playerId ? { playerId } : {}),
    roomState: ownerId && !roomState.ownerId ? { ...roomState, ownerId } : roomState,
  };
}

export function hasThinRecruitingListCounts(card = {}) {
  return Boolean(
    card?.listCardOnly === true &&
    card?.listCounts &&
    typeof card.listCounts === "object" &&
    !Array.isArray(card.listCounts) &&
    card.listCounts.teamA &&
    card.listCounts.teamB,
  );
}

function getLobbySideListCounts(side = {}) {
  const capacity = Math.max(1, Number(side.capacity ?? 0) || 1);
  const filled = Math.max(0, Number(side.filled ?? 0) || 0);
  const projectedFilled = Math.max(filled, Number(side.projectedFilled ?? filled) || filled);
  const confirmationProjectedFilled = Math.max(projectedFilled, Number(side.confirmationProjectedFilled ?? projectedFilled) || projectedFilled);
  return {
    filled: Math.min(filled, capacity),
    projectedFilled: Math.min(projectedFilled, capacity),
    confirmationProjectedFilled: Math.min(confirmationProjectedFilled, capacity),
    capacity,
  };
}

export function getRecruitingListCountsFromPost(post = {}) {
  const lobby = getRecruitingLobby(post, { users: [], teams: [] });
  const teamA = getLobbySideListCounts(lobby.sides?.teamA);
  const teamB = getLobbySideListCounts(lobby.sides?.teamB);
  const pickup = isPickupRecruitingRoom(post);
  const participantFilled = uniqueIds(
    (lobby.entries ?? []).flatMap((entry) => [
      ...(entry.players ?? []),
      ...(entry.reserves ?? []),
    ]),
  ).length;
  const activeCapacity = teamA.capacity + teamB.capacity;
  return {
    teamA,
    teamB,
    filled: teamA.filled + teamB.filled,
    projectedFilled: teamA.projectedFilled + teamB.projectedFilled,
    capacity: activeCapacity,
    partyCount: (lobby.entries ?? []).filter((entry) => (
      entry.kind === "team" &&
      new Set([...(entry.players ?? []), ...(entry.reserves ?? [])].filter(Boolean)).size >= 2
    )).length,
    pickup,
    participantFilled: pickup ? participantFilled : 0,
    participantCapacity: pickup
      ? activeCapacity + normalizeBenchCapacity(post.benchCapacity ?? post.rules?.benchCapacity) * 2
      : 0,
  };
}

export function toRecruitingCountPost(row = {}, applicationsByPost = new Map()) {
  const roomState = row.room_state && typeof row.room_state === "object" ? row.room_state : {};
  return {
    id: row.id,
    type: row.type,
    visibility: row.visibility,
    mode: row.mode,
    rules: row.rules ?? {},
    roomState,
    hostJoinMode: row.host_join_mode,
    hostSide: row.host_side,
    teamOnly: roomState.teamOnly === true || isPublicTeamRecruitingRoom({ visibility: row.visibility, hostJoinMode: row.host_join_mode }),
    sideCapacity: row.side_capacity,
    benchCapacity: normalizeBenchCapacity(row.bench_capacity ?? row.rules?.benchCapacity),
    playerIds: row.player_ids ?? [],
    playerId: row.player_id,
    teamId: row.team_id,
    status: row.status,
    applicants: (applicationsByPost.get(row.id) ?? []).map(fromRemoteRecruitingApplication),
  };
}

export function attachFreshRecruitingListCounts(cards = [], countsByPost = new Map()) {
  if (!countsByPost.size) return cards;
  return (cards ?? []).map((card) => (
    card?.id && countsByPost.has(card.id)
      ? { ...card, listCounts: countsByPost.get(card.id) }
      : card
  ));
}

export function uniqueFeedCards(rows = [], ids = []) {
  return collectUniqueRoomFeedCards(rows, ids, {
    normalizeCard: (row) => {
      const card = normalizeRecruitingFeedCard(row);
      const relation = String(row?.relation ?? "").trim();
      return card && relation ? { ...card, __feedRelations: [relation] } : card;
    },
    mergeDuplicate: (existing, row) => {
      const relation = String(row?.relation ?? "").trim();
      if (relation) existing.__feedRelations = mergeFeedRelations(existing.__feedRelations, [relation]);
      return existing;
    },
  });
}

export async function attachRoomFeedCards(client, rows = [], entityType = "recruiting") {
  return attachRoomFeedCardJson(client, rows, {
    entityType,
    uniqueIds,
    isMissingTableError: isMissingRoomFeedCards,
  });
}

function hasPendingInvitationForProfile(card = {}, profileId = "") {
  const invitations = card?.roomState?.invitations;
  if (!profileId || !Array.isArray(invitations)) return false;
  return invitations.some((invitation) => (
    invitation?.id &&
    invitation?.targetUserId === profileId &&
    String(invitation?.status ?? "pending") === "pending"
  ));
}


export function getRecruitingFeedCardRejectReason(card = {}, profileId = "") {
  if (!card) return "missing_card";
  if (!card?.playerId && !card?.ownerId && !card?.roomState?.ownerId) return "missing_host_identity";
  if (!card.updatedAt && !card.updated_at) return "missing_updated_at";
  const hasListCounts = hasThinRecruitingListCounts(card);
  if (!hasListCounts && !Array.isArray(card.playerIds)) return "missing_player_ids";
  if (!hasListCounts && !Array.isArray(card.applicants)) return "missing_applicants";
  if (card.hostJoinMode === "team" && !card.teamId) return "missing_team_id";
  if (!profileId) return "";
  const relations = Array.isArray(card?.__feedRelations) ? card.__feedRelations : [];
  if (relations.includes("invited") && !hasPendingInvitationForProfile(card, profileId)) return "missing_pending_invitation";
  return "";
}

export function canUseFeedCardForProfile(card = {}, profileId = "") {
  return !getRecruitingFeedCardRejectReason(card, profileId);
}

export async function attachPendingInvitationsToFeedCards(client, cards = [], profileId = "") {
  if (!profileId) return [];
  const candidates = cards.filter((card) => getRecruitingFeedCardRejectReason(card, profileId) === "missing_pending_invitation");
  const ids = uniqueIds(candidates.map((card) => card?.id));
  if (!ids.length) return [];
  const { data, error } = await client
    .from("recruiting_posts")
    .select("id,room_state,updated_at")
    .in("id", ids);
  if (error) throw error;
  const rowById = new Map((data ?? []).map((row) => [row.id, row]));
  return candidates
    .map((card) => {
      const row = rowById.get(card.id);
      const invitations = Array.isArray(row?.room_state?.invitations) ? row.room_state.invitations : [];
      const invitation = invitations.find((item) => (
        item?.id &&
        item.targetUserId === profileId &&
        String(item.status ?? "pending") === "pending"
      ));
      if (!invitation) return null;
      const roomState = card.roomState && typeof card.roomState === "object" && !Array.isArray(card.roomState) ? card.roomState : {};
      return {
        ...card,
        updatedAt: card.updatedAt ?? row?.updated_at,
        roomState: {
          ...roomState,
          invitations: [invitation],
        },
      };
    })
    .filter(Boolean);
}











export function getRoomStateParticipantIds(roomState = {}) {
  const reserveReadyIds = roomState.reserveReady && typeof roomState.reserveReady === "object"
    ? Object.entries(roomState.reserveReady).filter(([, ready]) => ready).map(([playerId]) => playerId)
    : [];
  return uniqueIds([
    ...flattenIdValues(roomState.partyLeaders),
    ...flattenIdValues(roomState.partyReserves),
    ...flattenIdValues(roomState.pinnedReservePlayers),
    ...reserveReadyIds,
  ]);
}

function hasReadableRecruitingInvitation(roomState = {}, profileId = "") {
  if (!profileId || !Array.isArray(roomState.invitations)) return false;
  return roomState.invitations.some((invitation) => (
    invitation?.targetUserId === profileId &&
    ["pending", "accepted", "ready"].includes(String(invitation?.status ?? "pending"))
  ));
}

export function canReadRecruitingPostDetail(row = {}, applications = [], profileId = "", adminLevel = 0) {
  if ((row.visibility ?? "public") !== "private") return true;
  if (adminLevel > 0) return true;
  if (!profileId) return false;
  const roomState = row.room_state && typeof row.room_state === "object" ? row.room_state : {};
  const readableIds = uniqueIds([
    row.player_id,
    row.referee_id,
    ...flattenIdValues(row.player_ids),
    roomState.ownerId,
    ...flattenIdValues(roomState.partyLeaders),
    ...flattenIdValues(roomState.partyReserves),
    ...flattenIdValues(roomState.pinnedReservePlayers),
    ...getRoomStateParticipantIds(roomState),
    ...applications.flatMap((application) => [
      application?.player_id,
      ...flattenIdValues(application?.player_ids),
    ]),
  ]);
  return readableIds.includes(profileId) || hasReadableRecruitingInvitation(roomState, profileId);
}

function collectTeamIdsFromRoomKeys(value = {}) {
  return Object.keys(value ?? {})
    .map((key) => String(key).startsWith("team:") ? String(key).slice(5) : "")
    .filter(Boolean);
}

export function collectRecruitingScope(postRows = [], applicationRows = [], profileId = "") {
  const profileIds = [profileId];
  const teamIds = [];
  const courtIds = [];
  postRows.forEach((post) => {
    const roomState = post.room_state && typeof post.room_state === "object" ? post.room_state : {};
    profileIds.push(
      post.player_id,
      post.referee_id,
      ...flattenIdValues(post.player_ids),
      roomState.ownerId,
      ...flattenIdValues(roomState.partyLeaders),
      ...flattenIdValues(roomState.partyReserves),
      ...flattenIdValues(roomState.pinnedReservePlayers),
      ...getRoomStateParticipantIds(roomState),
      ...(Array.isArray(roomState.invitations) ? roomState.invitations
        .flatMap((invitation) => [invitation.targetUserId, invitation.fromUserId, ...(invitation.playerIds ?? [])]) : []),
    );
    teamIds.push(
      post.team_id,
      post.target_team_id,
      ...collectTeamIdsFromRoomKeys(roomState.partyLeaders),
      ...collectTeamIdsFromRoomKeys(roomState.partyReserves),
    );
    courtIds.push(post.court_id);
  });
  applicationRows.forEach((application) => {
    teamIds.push(application.team_id, application.source_team_id);
    profileIds.push(application.player_id, ...flattenIdValues(application.player_ids));
  });
  return {
    profileIds: uniqueIds(profileIds),
    teamIds: uniqueIds(teamIds),
    courtIds: uniqueIds(courtIds),
  };
}

export function collectRecruitingCardScope(cards = [], profileId = "") {
  const profileIds = [profileId];
  const teamIds = [];
  const courtIds = [];
  cards.forEach((post) => {
    const roomState = post?.roomState && typeof post.roomState === "object" && !Array.isArray(post.roomState)
      ? post.roomState
      : {};
    const invitations = Array.isArray(roomState.invitations) ? roomState.invitations : [];
    const applicants = Array.isArray(post?.applicants) ? post.applicants : [];
    profileIds.push(
      post?.ownerId,
      post?.playerId,
      post?.refereeId,
      roomState.ownerId,
      ...flattenIdValues(post?.playerIds),
      ...flattenIdValues(roomState.partyLeaders),
      ...flattenIdValues(roomState.partyReserves),
      ...flattenIdValues(roomState.pinnedReservePlayers),
      ...getRoomStateParticipantIds(roomState),
      ...invitations.flatMap((invitation) => [
        invitation?.targetUserId,
        invitation?.fromUserId,
        ...(invitation?.playerIds ?? []),
      ]),
    );
    teamIds.push(
      post?.teamId,
      post?.targetTeamId,
      ...collectTeamIdsFromRoomKeys(roomState.partyLeaders),
      ...collectTeamIdsFromRoomKeys(roomState.partyReserves),
    );
    courtIds.push(post?.courtId);
    applicants.forEach((application) => {
      profileIds.push(application?.playerId, ...flattenIdValues(application?.playerIds));
      teamIds.push(application?.teamId, application?.sourceTeamId);
    });
  });
  return {
    profileIds: uniqueIds(profileIds),
    teamIds: uniqueIds(teamIds),
    courtIds: uniqueIds(courtIds),
  };
}

export function attachRecruitingCardReferences(card = {}, courtById = {}) {
  if (!card?.id) return card;
  const court = courtById[card.courtId];
  const courtName = court?.name ?? card.court;
  return {
    ...card,
    ...(courtName ? { court: courtName } : {}),
    courtPaid: court?.paid ?? card.courtPaid ?? null,
  };
}

export async function appendMissingTeamMemberProfiles(client, profileRows = [], teamMemberRows = [], currentUserId = "") {
  const existingIds = new Set((profileRows ?? []).map((row) => row.id).filter(Boolean));
  if (currentUserId) existingIds.add(currentUserId);
  const missingIds = uniqueIds((teamMemberRows ?? []).map((row) => row.user_id)).filter((id) => !existingIds.has(id));
  if (!missingIds.length) return profileRows ?? [];
  const { data, error } = await client
    .from("profiles")
    .select(PROFILE_PUBLIC_COLUMNS)
    .in("id", missingIds);
  if (error) throw error;
  return [...(profileRows ?? []), ...(data ?? [])];
}
