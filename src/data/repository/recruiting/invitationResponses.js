import { DEFAULT_RATING } from "../../../lib/constants.js";
import { MATCH_SIDES } from "../../../lib/constants.js";
import { SIDE_LABEL_TEXT } from "../../../lib/constants.js";
import { currentUserCanRefereeRecruitingRoom } from "../../../lib/recruiting.js";
import { expirePendingPlayerInvitationsWhenFull } from "../../../lib/recruiting.js";
import { getExplicitInvitationTeamPlayerIds } from "../../../lib/recruiting.js";
import { getRecruitingApplicantKey } from "../../../lib/recruiting.js";
import { getRecruitingBenchCapacity } from "../../../lib/recruiting.js";
import { getRecruitingBestSide } from "../../../lib/recruiting.js";
import { getRecruitingFit } from "../../../lib/recruiting.js";
import { getRecruitingLobby } from "../../../lib/recruiting.js";
import { getRecruitingRoomOwnerId } from "../../../lib/recruiting.js";
import { getRecruitingSideCapacity } from "../../../lib/recruiting.js";
import { getTeamMemberIds } from "../../teamMappers.js";
import { hasRecruitingApplicant } from "../../../lib/recruiting.js";
import { hasRecruitingTeamMemberOnOtherSide } from "../../../lib/recruiting.js";
import { inferRecruitingInvitationTeamId } from "../../../lib/recruiting.js";
import { isIndividualOnlyRecruitingRoom } from "../../../lib/recruiting.js";
import { isPickupRecruitingRoom } from "../../../lib/recruiting.js";
import { isRecruitingReserveLimitExceeded } from "../../../lib/recruiting.js";
import { isRecruitingRoomOwner } from "../../../lib/recruiting.js";
import { isRoomScheduleChangePending } from "../../../lib/roomFlow.js";
import { makeId } from "../../rowUtils.js";
import { normalizeRecruitingApplicants } from "../../../lib/recruiting.js";
import { normalizeMmrLimitMode as normalizeRecruitingMmrLimitMode } from "../../../lib/constants.js";
import { normalizeRecruitingRoomState } from "../../../lib/recruiting.js";
import { removeAcceptedRecruitingInvitations } from "../../../lib/recruiting.js";
import { updatePinnedReservePlayers } from "../../../lib/recruiting.js";
import { getDisciplineBlockedState, getPublicRoomDisciplineBlockedState } from "../guards.js";
import { applyAutomaticRecruitingConfirmations } from "../lifecycle.js";
import { getPendingScheduleChangeNotification } from "../roomRules.js";
import { withRecruitingPartySideConflictNotification } from "./party.js";

function makeRecruitingTeamNoticeNotifications({ post, team, side, acceptedBy, acceptedByName, now } = {}) {
  if (!post?.id || !team?.id) return [];
  const leaderName = acceptedByName || acceptedBy || "팀 대표";
  const memberIds = getTeamMemberIds(team).filter((userId) => userId && userId !== acceptedBy);
  return memberIds.map((targetUserId) => ({
    id: makeId("n"),
    title: "팀전 참여 알림",
    body: `${team.name} 팀이 ${post.title} ${SIDE_LABEL_TEXT[side]} 초대를 수락했습니다. 대표: ${leaderName}. 출전 명단은 방에서 확정됩니다.`,
    tone: "match",
    targetUserId,
    recruitingPostId: post.id,
    discordEvent: "match",
    createdAt: now,
    updatedAt: now,
  }));
}
function expirePendingPlayerInvitationsForFilledRoom(post, state, now) {
  const lobby = getRecruitingLobby(post, state);
  const occupiedCount = MATCH_SIDES.reduce((total, side) => (
    total
    + (lobby.sides[side]?.filled ?? 0)
    + (lobby.sides[side]?.reserveCandidates?.length ?? 0)
  ), 0);
  const capacity = MATCH_SIDES.reduce((total, side) => (
    total + (lobby.sides[side]?.capacity ?? getRecruitingSideCapacity(post)) + getRecruitingBenchCapacity(post)
  ), 0);
  const roomFilledNow = capacity > 0
    && occupiedCount >= capacity
    && !post.roomState?.playerCapacityFilledAt;
  if (!roomFilledNow) return { post, notifications: [] };

  const expiredInvitations = (post.roomState?.invitations ?? []).filter((candidate) => (
    candidate.role !== "referee" && candidate.status === "pending"
  ));
  const ownerId = getRecruitingRoomOwnerId(post);
  return {
    post: {
      ...post,
      roomState: {
        ...post.roomState,
        playerCapacityFilledAt: now,
        invitations: expirePendingPlayerInvitationsWhenFull(
          post.roomState?.invitations ?? [],
          { occupiedCount, capacity, now },
        ),
      },
    },
    notifications: [
      ...expiredInvitations.map((candidate) => ({
        id: makeId("n"),
        title: "초대 종료",
        body: `${post.title} 초대받은 방의 출전·후보 슬롯이 모두 찼습니다.`,
        tone: "orange",
        targetUserId: candidate.targetUserId,
        recruitingPostId: post.id,
        invitationId: candidate.id,
        createdAt: now,
        updatedAt: now,
      })),
      ...(ownerId ? [{
        id: makeId("n"),
        title: "방 정원 충족",
        body: `${post.title} 정원이 모두 찼습니다. 방을 확인하고 경기를 확정해 주세요.`,
        tone: "match",
        targetUserId: ownerId,
        recruitingPostId: post.id,
        createdAt: now,
        updatedAt: now,
      }] : []),
    ],
  };
}
export function acceptRecruitingInvitation(state, postId, invitationId) {
  const disciplineBlock = getDisciplineBlockedState(state, "초대 수락");
  if (disciplineBlock) return disciplineBlock;
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!post || post.status !== "open" || isRecruitingRoomOwner(post, state.currentUserId) || post.playerId === state.currentUserId) return state;
  if (isRoomScheduleChangePending(post)) {
    return { ...state, notifications: [getPendingScheduleChangeNotification({ postId }), ...state.notifications] };
  }
  const publicRoomDisciplineBlock = getPublicRoomDisciplineBlockedState(state, post);
  if (publicRoomDisciplineBlock) return publicRoomDisciplineBlock;
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const invitation = roomState.invitations.find((item) => (
    item.id === invitationId &&
    item.targetUserId === state.currentUserId &&
    item.status === "pending"
  ));
  if (!invitation) return state;
  const invitationOwnerId = getRecruitingRoomOwnerId(post) || invitation.fromUserId || post.playerId || "";

  if (invitation.role === "referee") {
    const expireRefereeInvitation = (body) => ({
      ...state,
      recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
        item.id === postId
          ? {
              ...item,
              roomState: {
                ...roomState,
                invitations: roomState.invitations.map((candidate) => (
                  candidate.id === invitationId ? { ...candidate, status: "expired", updatedAt: new Date().toISOString() } : candidate
                )),
              },
            }
          : item
      )),
      notifications: [
        {
          id: makeId("n"),
          title: "심판 초대 만료",
          body,
          tone: "orange",
          recruitingPostId: postId,
        },
        ...state.notifications,
      ],
    });
    if (post.refereeId) return expireRefereeInvitation("이미 배정된 심판이 있습니다.");
    if (!currentUserCanRefereeRecruitingRoom(state, post)) {
      return expireRefereeInvitation("심판 권한이 있고 경기 참가자가 아닌 계정만 심판 초대를 수락할 수 있습니다.");
    }
    return {
      ...state,
      recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
        item.id === postId
          ? {
              ...item,
              refereeWanted: true,
              refereeId: state.currentUserId,
              roomState: {
                ...roomState,
                refereeWanted: true,
                invitations: removeAcceptedRecruitingInvitations(roomState.invitations, invitation, state.currentUserId),
              },
            }
          : item
      )),
      notifications: [
        {
          id: makeId("n"),
          title: "심판 초대 수락",
          body: `${post.title} 심판으로 배정됐습니다.`,
          tone: "match",
          recruitingPostId: postId,
        },
        ...state.notifications,
      ],
    };
  }

  const user = state.users.find((item) => item.id === state.currentUserId);
  const invitationTeamId = isIndividualOnlyRecruitingRoom(post)
    ? ""
    : inferRecruitingInvitationTeamId(post, state, invitation);
  const invitedTeam = invitationTeamId
    ? state.teams.find((team) => team.id === invitationTeamId && team.members.some((member) => member.userId === state.currentUserId))
    : null;
  const candidateMmr = invitedTeam
    ? invitedTeam.mmr ?? user?.ratings?.integrated ?? DEFAULT_RATING
    : user?.ratings?.integrated ?? DEFAULT_RATING;
  const fit = getRecruitingFit(post, candidateMmr, state);
  const mmrLimitMode = normalizeRecruitingMmrLimitMode(post.mmrLimitMode ?? roomState.mmrLimitMode);
  const expireInvitation = (body) => ({
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
      item.id === postId
        ? {
            ...item,
            roomState: {
              ...roomState,
              invitations: roomState.invitations.map((candidate) => (
                candidate.id === invitationId ? { ...candidate, status: "expired", updatedAt: new Date().toISOString() } : candidate
              )),
            },
          }
        : item
    )),
    notifications: [
      {
        id: makeId("n"),
        title: "초대 수락 실패",
        body,
        tone: "orange",
      },
      ...state.notifications,
    ],
  });

  if (mmrLimitMode === "block" && !fit.allowed) {
    return expireInvitation(`${post.title} 정규전은 ${fit.range.label} 구간만 대기할 수 있습니다.`);
  }

  const lobby = getRecruitingLobby(post, state);
  const side = isPickupRecruitingRoom(post)
    ? getRecruitingBestSide(post, state)
    : MATCH_SIDES.includes(invitation.side) ? invitation.side : getRecruitingBestSide(post, state);
  const benchCapacity = getRecruitingBenchCapacity(post);
  let reserve = Boolean(invitation.reserve);
  const invitedTeamCapacity = getRecruitingSideCapacity(post);
  const invitedTeamKey = invitedTeam ? `team:${invitedTeam.id}` : "";
  const existingInvitedTeamApplicant = invitedTeam
    ? normalizeRecruitingApplicants(post.applicants ?? []).find((applicant) => getRecruitingApplicantKey(applicant) === invitedTeamKey)
    : null;
  const alreadyInInvitedTeamSlot = existingInvitedTeamApplicant
    ? getExplicitInvitationTeamPlayerIds(
      invitedTeam,
      invitedTeamCapacity,
      existingInvitedTeamApplicant.playerIds,
      existingInvitedTeamApplicant.playerId,
    ).includes(state.currentUserId)
    : false;
  const reserveFull = (lobby.sides[side]?.reserveCandidates?.length ?? 0) >= benchCapacity;
  const activeFull = lobby.sides[side].filled >= lobby.sides[side].capacity && !alreadyInInvitedTeamSlot;
  if (reserve && reserveFull) {
    return expireInvitation(`${SIDE_LABEL_TEXT[side]} 후보가 이미 ${benchCapacity}명입니다.`);
  }
  if (!reserve && activeFull) {
    if (reserveFull) return expireInvitation("출전 슬롯과 후보 슬롯이 모두 찼습니다.");
    reserve = true;
  }

  const now = new Date().toISOString();
  const makeOwnerAcceptNotifications = (body) => (
    invitationOwnerId && invitationOwnerId !== state.currentUserId
      ? [{
          id: makeId("n"),
          title: "초대 수락",
          body,
          tone: "match",
          targetUserId: invitationOwnerId,
          recruitingPostId: postId,
          invitationId,
          createdAt: now,
          updatedAt: now,
        }]
      : []
  );
  if (invitedTeam && !isIndividualOnlyRecruitingRoom(post)) {
    const capacity = invitedTeamCapacity;
    const applicants = normalizeRecruitingApplicants(post.applicants ?? []);
    const teamKey = invitedTeamKey;
    const isHostParty = post.teamId === invitedTeam.id && post.hostJoinMode !== "player";
    const existingApplicant = existingInvitedTeamApplicant;
    const allowedEntryId = existingApplicant?.side === side ? teamKey : "";
    if (hasRecruitingTeamMemberOnOtherSide(post, state, invitedTeam.id, side, allowedEntryId)) {
      return withRecruitingPartySideConflictNotification(state, postId, side);
    }
    const currentPlayerIds = isHostParty
      ? getExplicitInvitationTeamPlayerIds(invitedTeam, capacity, post.playerIds, post.playerId)
      : existingApplicant
        ? getExplicitInvitationTeamPlayerIds(invitedTeam, capacity, existingApplicant.playerIds, existingApplicant.playerId)
          : [];
    const nextPlayerIds = Array.from(new Set([...currentPlayerIds, state.currentUserId])).slice(0, capacity);
    if (!reserve && !nextPlayerIds.includes(state.currentUserId)) {
      return expireInvitation("방이 꽉 찼습니다. 먼저 수락한 선수만 들어갑니다.");
    }

    const reserveKey = isHostParty ? "host" : teamKey;
    const currentReserveIds = roomState.partyReserves?.[reserveKey] ?? [];
    const nextReserveIds = reserve
      ? Array.from(new Set([...currentReserveIds, state.currentUserId]))
      : currentReserveIds.filter((playerId) => playerId !== state.currentUserId);
    const nextPartyReserves = { ...roomState.partyReserves, [reserveKey]: nextReserveIds };
    if (!nextReserveIds.length) delete nextPartyReserves[reserveKey];
    const nextPartyLeaders = { ...(roomState.partyLeaders ?? {}) };
    if (post.visibility === "private" && post.hostJoinMode === "team" && side === "teamB" && !reserve) {
      nextPartyLeaders[reserveKey] = state.currentUserId;
    }
    const nextRoomState = {
      ...updatePinnedReservePlayers(
        { ...roomState, partyReserves: nextPartyReserves, partyLeaders: nextPartyLeaders },
        side,
        state.currentUserId,
        reserve,
      ),
      invitations: removeAcceptedRecruitingInvitations(roomState.invitations, invitation, state.currentUserId),
    };
    const nextApplicant = existingApplicant
      ? null
      : {
          kind: "team",
          joinMode: "team",
          teamId: invitedTeam.id,
          playerId: state.currentUserId,
          side,
          status: "ready",
          reserve: reserve && !nextPlayerIds.length,
          position: null,
          playerIds: reserve && !nextPlayerIds.length ? [state.currentUserId] : nextPlayerIds,
          createdAt: now,
          updatedAt: now,
        };
    const nextApplicants = isHostParty
      ? applicants
        : existingApplicant
          ? applicants
          .map((applicant) => (
            getRecruitingApplicantKey(applicant) === teamKey
              ? {
                  ...applicant,
                  side: applicant.side ?? side,
                  reserve: reserve ? applicant.reserve : false,
                  status: "ready",
                  playerIds: reserve ? currentPlayerIds : nextPlayerIds,
                  updatedAt: now,
                }
              : applicant
          ))
        : [
            ...applicants,
            nextApplicant,
          ];
    const nextPost = isHostParty
      ? {
          ...post,
          hostReady: true,
          playerIds: reserve ? currentPlayerIds : nextPlayerIds,
          roomState: nextRoomState,
          applicants: nextApplicants,
        }
      : { ...post, applicants: nextApplicants, roomState: nextRoomState };
    if (reserve && isRecruitingReserveLimitExceeded(nextPost, state, side)) {
      return expireInvitation(`${SIDE_LABEL_TEXT[side]} 후보가 이미 ${benchCapacity}명입니다.`);
    }
    if (!reserve) {
      const nextLobby = getRecruitingLobby(nextPost, state);
      if (nextLobby.sides[side].filled > nextLobby.sides[side].capacity) {
        return expireInvitation("방이 꽉 찼습니다. 먼저 수락한 선수만 들어갑니다.");
      }
    }

    const filledRoomResult = expirePendingPlayerInvitationsForFilledRoom(nextPost, state, now);
    return applyAutomaticRecruitingConfirmations({
      ...state,
      recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
        item.id === postId ? filledRoomResult.post : item
      )),
      notifications: [
        ...filledRoomResult.notifications,
        ...makeRecruitingTeamNoticeNotifications({
          post,
          team: invitedTeam,
          side,
          acceptedBy: state.currentUserId,
          acceptedByName: user?.name,
          now,
        }),
        ...makeOwnerAcceptNotifications(`${post.title} ${SIDE_LABEL_TEXT[side]} ${reserve ? "후보" : "출전"} 초대가 수락되었습니다.`),
        {
          id: makeId("n"),
          title: "초대 수락",
          body: `${post.title} ${SIDE_LABEL_TEXT[side]} ${reserve ? "후보" : "출전"}으로 팀 파티 등록됐습니다.`,
          tone: "match",
        },
        ...state.notifications,
      ],
    });
  }

  const nextApplicant = {
    kind: "player",
    joinMode: "player",
    playerId: state.currentUserId,
    teamId: null,
    side,
    status: "ready",
    reserve,
    position: user?.position ?? null,
    createdAt: now,
    updatedAt: now,
  };
  if (hasRecruitingApplicant(post, nextApplicant)) return state;

  const filledRoomResult = expirePendingPlayerInvitationsForFilledRoom({
    ...post,
    applicants: [...normalizeRecruitingApplicants(post.applicants ?? []), nextApplicant],
    roomState: {
      ...updatePinnedReservePlayers(roomState, side, state.currentUserId, reserve),
      invitations: removeAcceptedRecruitingInvitations(roomState.invitations, invitation, state.currentUserId),
    },
  }, state, now);

  return applyAutomaticRecruitingConfirmations({
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
      item.id === postId ? filledRoomResult.post : item
    )),
    notifications: [
      ...filledRoomResult.notifications,
      ...makeOwnerAcceptNotifications(`${post.title} ${SIDE_LABEL_TEXT[side]} ${reserve ? "후보" : "출전"} 초대가 수락되었습니다.`),
      {
        id: makeId("n"),
        title: "초대 수락",
        body: `${post.title} ${SIDE_LABEL_TEXT[side]} ${reserve ? "후보" : "출전"}으로 대기 등록됐습니다.`,
        tone: "match",
      },
      ...state.notifications,
    ],
  });
}
export function declineRecruitingInvitation(state, postId, invitationId) {
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!post || post.status !== "open") return state;
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const invitation = roomState.invitations.find((item) => item.id === invitationId && item.targetUserId === state.currentUserId);
  if (!invitation) return state;

  return {
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
      item.id === postId
        ? { ...item, roomState: { ...roomState, invitations: roomState.invitations.filter((candidate) => candidate.id !== invitationId) } }
        : item
    )),
  };
}
