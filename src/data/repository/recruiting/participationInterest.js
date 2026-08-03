import { DEFAULT_RATING } from "../../../lib/constants.js";
import { MATCH_SIDES } from "../../../lib/constants.js";
import { SIDE_LABEL_TEXT } from "../../../lib/constants.js";
import { currentUserCanRefereeRecruitingRoom } from "../../../lib/recruiting.js";
import { ensureTeamPartyLeader } from "../../teamMappers.js";
import { getLobbyPrimaryTeamId } from "../../../lib/recruiting.js";
import { getRecruitingApplicantKey } from "../../../lib/recruiting.js";
import { getRecruitingApplicantKind } from "../../../lib/recruiting.js";
import { getRecruitingBenchCapacity } from "../../../lib/recruiting.js";
import { getRecruitingBestSide } from "../../../lib/recruiting.js";
import { getRecruitingFit } from "../../../lib/recruiting.js";
import { getRecruitingLobby } from "../../../lib/recruiting.js";
import { getRecruitingSideCapacity } from "../../../lib/recruiting.js";
import { getRecruitingTargetMmr } from "../../../lib/recruiting.js";
import { getSelectedReservePlayerIds } from "../../teamMappers.js";
import { getSelectedTeamPlayerIds } from "../../../lib/recruiting.js";
import { getTeamEventEligibility } from "../../../lib/recruiting.js";
import { hasRecruitingApplicant } from "../../../lib/recruiting.js";
import { isIndividualOnlyRecruitingRoom } from "../../../lib/recruiting.js";
import { isRecruitingReserveLimitExceeded } from "../../../lib/recruiting.js";
import { isRecruitingRoomOwner } from "../../../lib/recruiting.js";
import { isRoomScheduleChangePending } from "../../../lib/roomFlow.js";
import { isTeamOnlyRecruitingRoom } from "../../../lib/recruiting.js";
import { makeId } from "../../rowUtils.js";
import { normalizeRecruitingApplicants } from "../../../lib/recruiting.js";
import { normalizeMmrLimitMode as normalizeRecruitingMmrLimitMode } from "../../../lib/constants.js";
import { normalizeRecruitingRoomState } from "../../../lib/recruiting.js";
import { updateManyPinnedReservePlayers } from "../../../lib/recruiting.js";
import { getDisciplineBlockedState, getPublicRoomDisciplineBlockedState, getRecruitingReserveLimitNotification } from "../guards.js";
import { applyAutomaticRecruitingConfirmations } from "../lifecycle.js";
import { getPendingScheduleChangeNotification } from "../roomRules.js";
import { getAveragePlayerMmr } from "../runtime.js";

export function interestRecruitingPost(state, postId, application = {}) {
  const disciplineBlock = getDisciplineBlockedState(state, "매칭방 참여");
  if (disciplineBlock) return disciplineBlock;
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!post || post.status !== "open") return state;
  if (isRoomScheduleChangePending(post)) {
    return { ...state, notifications: [getPendingScheduleChangeNotification({ postId }), ...state.notifications] };
  }
  const publicRoomDisciplineBlock = getPublicRoomDisciplineBlockedState(state, post);
  if (publicRoomDisciplineBlock) return publicRoomDisciplineBlock;
  if (isRecruitingRoomOwner(post, state.currentUserId) || post.playerId === state.currentUserId) return state;
  const user = state.users.find((item) => item.id === state.currentUserId);
  const teamOnly = isTeamOnlyRecruitingRoom(post);
  if (teamOnly && !post.teamId) {
    return {
      ...state,
      notifications: [{
        id: makeId("n"),
        title: "A\uD300 \uC120\uD0DD \uD544\uC694",
        body: "\uBC29\uC7A5\uC774 A\uC0AC\uC774\uB4DC \uD300\uC744 \uC120\uD0DD\uD55C \uB4A4 \uCC38\uAC00\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.",
        tone: "team",
        recruitingPostId: postId,
      }, ...state.notifications],
    };
  }
  const refereeWanted = Boolean(post.refereeWanted || post.roomState?.refereeWanted || post.refereeId);
  if (application.joinMode === "referee") {
    if (post.visibility === "private") {
      return {
        ...state,
        notifications: [
          {
            id: makeId("n"),
            title: "심판 참여 제한",
            body: "비공개방 심판은 초대 수락으로만 배정됩니다.",
            tone: "orange",
            recruitingPostId: postId,
          },
          ...state.notifications,
        ],
      };
    }
    if (!refereeWanted) {
      return {
        ...state,
        notifications: [
          {
            id: makeId("n"),
            title: "심판 참여 제한",
            body: "심판을 모집 중인 방만 심판으로 참여할 수 있습니다.",
            tone: "orange",
            recruitingPostId: postId,
          },
          ...state.notifications,
        ],
      };
    }
    if (post.refereeId) {
      return {
        ...state,
        notifications: [
          {
            id: makeId("n"),
            title: "심판 참여 제한",
            body: "이미 배정된 심판이 있습니다.",
            tone: "orange",
            recruitingPostId: postId,
          },
          ...state.notifications,
        ],
      };
    }
    if (!currentUserCanRefereeRecruitingRoom(state, post)) {
      return {
        ...state,
        notifications: [
          {
            id: makeId("n"),
            title: "심판 참여 제한",
            body: "심판 권한이 있고 경기 참가자가 아닌 계정만 심판으로 참여할 수 있습니다.",
            tone: "orange",
            recruitingPostId: postId,
          },
          ...state.notifications,
        ],
      };
    }
    const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
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
                invitations: roomState.invitations.filter((invitation) => (
                  invitation.role !== "referee"
                )),
              },
            }
          : item
      )),
      notifications: [
        {
          id: makeId("n"),
          title: "심판 참여",
          body: `${post.title} 심판으로 배정됐습니다.`,
          tone: "match",
          recruitingPostId: postId,
        },
        ...state.notifications,
      ],
    };
  }
  if (post.visibility === "private") {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "비공개방 참여 제한",
          body: "비공개방은 초대 수락으로만 참여할 수 있습니다.",
          tone: "orange",
          recruitingPostId: postId,
        },
        ...state.notifications,
      ],
    };
  }
  const requestedJoinMode = application.joinMode === "team"
    ? "team"
    : application.joinMode === "player"
      ? "player"
      : application.teamId
        ? "team"
        : getRecruitingApplicantKind(post);
  if (teamOnly && requestedJoinMode === "player") {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "팀전 참여 제한",
          body: "팀전 방은 팀으로만 참여할 수 있습니다.",
          tone: "orange",
          recruitingPostId: postId,
        },
        ...state.notifications,
      ],
    };
  }
  if (isIndividualOnlyRecruitingRoom(post) && requestedJoinMode === "team") {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "1v1 참여 제한",
          body: "1v1 개인방은 개인 1명으로만 참여할 수 있습니다.",
          tone: "orange",
          recruitingPostId: postId,
        },
        ...state.notifications,
      ],
    };
  }
  const applicantKind = requestedJoinMode === "team" ? "team" : "player";
  const myTeams = state.teams.filter((team) => team.members.some((member) => member.userId === state.currentUserId));
  const team = applicantKind === "team"
    ? myTeams.find((item) => item.id === application.teamId) ?? myTeams[0]
    : null;

  if (applicantKind === "team" && !team) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "소속 팀 필요",
          body: "팀으로 들어가려면 내 팀이 필요합니다.",
          tone: "team",
        },
        ...state.notifications,
      ],
    };
  }

  const sideCapacity = getRecruitingSideCapacity(post);
  const benchCapacity = getRecruitingBenchCapacity(post);
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const side = MATCH_SIDES.includes(application.side) ? application.side : getRecruitingBestSide(post, state);
  const lobby = getRecruitingLobby(post, state);
  const occupiedSideTeamId = applicantKind === "team" ? getLobbyPrimaryTeamId(lobby, side) : null;
  const publicTeamJoin = post.visibility === "public" && teamOnly && applicantKind === "team";
  if (teamOnly && occupiedSideTeamId && occupiedSideTeamId !== team?.id) {
    return {
      ...state,
      notifications: [{
        id: makeId("n"),
        title: "팀 참가 마감",
        body: `${SIDE_LABEL_TEXT[side]}에는 이미 다른 팀이 확정됐습니다.`,
        tone: "team",
        recruitingPostId: postId,
      }, ...state.notifications],
    };
  }
  const reserveRequested = publicTeamJoin ? false : Boolean(application.reserve);
  const sideState = lobby.sides[side];
  const teamSelectionCapacity = applicantKind === "team"
    ? teamOnly
      ? sideCapacity
      : reserveRequested
        ? Math.max(0, benchCapacity - (sideState?.reserveCandidates?.length ?? 0))
        : Math.max(0, (sideState?.capacity ?? sideCapacity) - (sideState?.filled ?? 0))
    : sideCapacity;
  const reserveSelectionCapacity = Math.max(0, benchCapacity - (sideState?.reserveCandidates?.length ?? 0));
  const teamEligibility = team ? getTeamEventEligibility(team, state.users, {
    capacity: sideCapacity,
    ranked: post.ranked,
    mmrLimitMode: post.mmrLimitMode ?? roomState.mmrLimitMode,
    mmrRangeMode: post.mmrRangeMode ?? roomState.mmrRangeMode,
    targetMmr: getRecruitingTargetMmr(post, state),
    allowedAgeGroups: post.allowedAgeGroups ?? post.rules?.allowedAgeGroups,
    requireCaptainEligible: false,
  }) : null;
  const currentUserIsTeamMember = team?.members?.some((member) => member.userId === state.currentUserId) ?? false;
  const currentUserEligible = teamEligibility?.eligiblePlayerIds?.includes(state.currentUserId) ?? false;
  if (applicantKind === "team" && (!currentUserIsTeamMember || !currentUserEligible || !teamEligibility?.allowed)) {
    return {
      ...state,
      notifications: [{
        id: makeId("n"),
        title: "팀전 참가 제한",
        body: !currentUserIsTeamMember
          ? "현재 소속된 팀으로만 참가할 수 있습니다."
          : !currentUserEligible
            ? "현재 경기의 연령·MMR 조건을 충족하지 않습니다."
            : teamEligibility?.reason,
        tone: "team",
      }, ...state.notifications],
    };
  }
  const selectedPlayerIds = applicantKind === "team"
    ? publicTeamJoin
      ? [state.currentUserId]
      : ensureTeamPartyLeader(team, getSelectedTeamPlayerIds(team, teamSelectionCapacity, application.playerIds), state.currentUserId, teamSelectionCapacity)
    : [];
  const selectedReservePlayerIds = applicantKind === "team" && !reserveRequested && !publicTeamJoin
    ? getSelectedReservePlayerIds(team, selectedPlayerIds, application.reservePlayerIds, reserveSelectionCapacity)
    : [];
  if (applicantKind === "team") {
    const eligiblePlayerIds = new Set(teamEligibility?.eligiblePlayerIds ?? []);
    if ([...selectedPlayerIds, ...selectedReservePlayerIds].some((playerId) => !eligiblePlayerIds.has(playerId))) {
      return {
        ...state,
        notifications: [{
          id: makeId("n"),
          title: "명단 조건 불일치",
          body: "연령·MMR 조건을 충족한 팀원만 출전·후보로 선택할 수 있습니다.",
          tone: "team",
        }, ...state.notifications],
      };
    }
  }
  const teamSummonPlayerIds = publicTeamJoin
    ? [...selectedPlayerIds, ...selectedReservePlayerIds].filter((playerId) => playerId && playerId !== state.currentUserId)
    : [];
  const candidateMmr = applicantKind === "team"
    ? getAveragePlayerMmr(state, selectedPlayerIds, team?.mmr ?? user?.ratings?.integrated ?? DEFAULT_RATING)
    : user?.ratings?.integrated ?? DEFAULT_RATING;
  const fit = getRecruitingFit(post, candidateMmr, state);
  const mmrLimitMode = normalizeRecruitingMmrLimitMode(post.mmrLimitMode ?? roomState.mmrLimitMode);
  if (mmrLimitMode === "block" && !fit.allowed) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "티어 구간 제한",
          body: `${post.title} 정규전은 ${fit.range.label} 구간만 대기할 수 있습니다.`,
          tone: "team",
        },
        ...state.notifications,
      ],
    };
  }

  if (applicantKind === "team" && !selectedPlayerIds.length) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "참여 팀원 필요",
          body: teamOnly ? "팀으로만 참여 방은 팀 대표가 먼저 들어간 뒤 방 안에서 출전·후보 명단을 확정합니다." : "팀으로 대기하려면 실제 참여할 팀원을 1명 이상 선택해야 합니다.",
          tone: "team",
        },
        ...state.notifications,
      ],
    };
  }
  const partySize = applicantKind === "team" ? selectedPlayerIds.length : 1;
  const reserve = publicTeamJoin
    ? false
    : Boolean(application.reserve) || lobby.sides[side].filled + partySize > lobby.sides[side].capacity;
  const now = new Date().toISOString();
  const nextApplicant = applicantKind === "team"
    ? {
        kind: "team",
        joinMode: "team",
        teamId: team.id,
        playerId: state.currentUserId,
        side,
        status: "ready",
        reserve,
        position: application.position ?? null,
        playerIds: selectedPlayerIds,
        createdAt: now,
        updatedAt: now,
      }
    : {
        kind: "player",
        joinMode: "player",
        playerId: state.currentUserId,
        teamId: null,
        side,
        status: "ready",
        reserve,
        position: application.position ?? user?.position ?? null,
        createdAt: now,
        updatedAt: now,
      };
  if (hasRecruitingApplicant(post, nextApplicant)) return state;
  const applicants = [...normalizeRecruitingApplicants(post.applicants ?? []), nextApplicant];
  const applicantKey = getRecruitingApplicantKey(nextApplicant);
  const nextPartyReserves = { ...roomState.partyReserves };
  if (applicantKind === "team" && selectedReservePlayerIds.length) {
    nextPartyReserves[applicantKey] = selectedReservePlayerIds;
  } else {
    delete nextPartyReserves[applicantKey];
  }
  const nextPartyLeaders = { ...(roomState.partyLeaders ?? {}) };
  if (applicantKind === "team") nextPartyLeaders[applicantKey] = state.currentUserId;
  const reservePinnedIds = applicantKind === "team" ? selectedPlayerIds : [state.currentUserId];
  const existingPlayerIds = new Set([
    post.playerId,
    ...lobby.entries.flatMap((entry) => [entry.playerId, ...(entry.players ?? []), ...(entry.reserves ?? [])]),
  ].filter(Boolean));
  const teamSummonTargets = teamSummonPlayerIds.filter((playerId) => !existingPlayerIds.has(playerId));
  const nextRoomState = updateManyPinnedReservePlayers(
    updateManyPinnedReservePlayers(
      { ...roomState, partyReserves: nextPartyReserves, partyLeaders: nextPartyLeaders },
      side,
      reservePinnedIds,
      reserve,
    ),
    side,
    selectedReservePlayerIds,
    true,
  );
  const nextPost = { ...post, applicants, roomState: nextRoomState };
  if (reserve && isRecruitingReserveLimitExceeded(nextPost, state, side)) {
    return {
      ...state,
      notifications: [getRecruitingReserveLimitNotification(postId, side), ...state.notifications],
    };
  }

  return applyAutomaticRecruitingConfirmations({
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (item.id === postId ? nextPost : item)),
    notifications: [
      ...teamSummonTargets.map((playerId) => ({
        id: makeId("n"),
        title: "팀원 소집",
        body: `${post.title} ${SIDE_LABEL_TEXT[side]} 팀원으로 등록되었습니다. 방에서 출전 선수와 후보 선수를 확인해 주세요.`,
        tone: "match",
        targetUserId: playerId,
        recruitingPostId: postId,
      })),
      ...state.notifications,
    ],
  });
}
