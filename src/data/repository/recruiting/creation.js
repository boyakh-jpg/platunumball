import { MODE_SIZES } from "../../../lib/constants.js";
import { PUBLIC_ROOM_SCHEDULE_MAX_DAYS } from "../../../lib/constants.js";
import { REFEREE_TRUST_MIN } from "../../../lib/constants.js";
import { ROOM_SCHEDULE_MAX_DAYS } from "../../../lib/constants.js";
import { STAT_ENTRY_WINDOW_MINUTES } from "../../../lib/constants.js";
import { ensureTeamPartyLeader } from "../../teamMappers.js";
import { getCourtId } from "../../../lib/courts.js";
import { getMatchCreationPolicyPayload } from "../../../lib/matchCreationPolicies.js";
import { getMatchRulesPayload } from "../../../lib/matchRules.js";
import { getNextQueueSchedule } from "../../scheduleUtils.js";
import { getPublicRoomTimingStatus } from "../../../lib/matchUtils.js";
import { getRecruitingBenchCapacity } from "../../../lib/recruiting.js";
import { getRecruitingSideCapacity } from "../../../lib/recruiting.js";
import { getRegisteredCourts } from "../../../lib/courts.js";
import { getSelectableTeamPlayerIds } from "../../../lib/recruiting.js";
import { getSelectedReservePlayerIds } from "../../teamMappers.js";
import { getSelectedTeamPlayerIds } from "../../../lib/recruiting.js";
import { getTeamEventEligibility } from "../../../lib/recruiting.js";
import { getTeamMemberIds } from "../../teamMappers.js";
import { isRecruitingRoomOwner } from "../../../lib/recruiting.js";
import { isScheduleDateInAllowedWindow } from "../../scheduleUtils.js";
import { isSupportedMatchMode } from "../../../lib/constants.js";
import { isTeamOnlyRecruitingRoom } from "../../../lib/recruiting.js";
import { makeId } from "../../rowUtils.js";
import { normalizeDisputeWindowMinutes } from "../../../lib/constants.js";
import { normalizeRecruitingMmrRangeMode } from "../../../lib/recruiting.js";
import { normalizeRecruitingRoomState } from "../../../lib/recruiting.js";
import { getDisciplineBlockedState, getHostTrustBlockNotification, getInvalidPublicScheduleNotification, getInvalidScheduleNotification } from "../guards.js";
import { getTrustedRefereeId } from "../lifecycle.js";
import { getServerRatingValue } from "../runtime.js";

export function createRecruitingPost(state, draft) {
  const requestedMode = draft.mode || "5v5";
  const requestedSideCapacity = getRecruitingSideCapacity(draft);
  if (!isSupportedMatchMode(requestedMode) || MODE_SIZES[requestedMode] !== requestedSideCapacity) return state;
  const disciplineBlock = getDisciplineBlockedState(state, "매칭방 생성");
  if (disciplineBlock) return disciplineBlock;
  const creationPolicy = getMatchCreationPolicyPayload({ ...(draft.rules ?? {}), ...draft });
  const pickup = creationPolicy.formationMode === "pickup";
  const hostJoinMode = pickup ? "player" : draft.hostJoinMode === "player" ? "player" : "team";
  const visibility = draft.visibility === "private" ? "private" : "public";
  const teamOnly = hostJoinMode === "team";
  const teamSelectionPending = teamOnly;
  const postType = teamOnly ? "need_team" : hostJoinMode === "team" ? "need_player" : "find_team";
  const hostTrustBlock = getHostTrustBlockNotification(state, { ...draft, ranked: creationPolicy.ranked, official: creationPolicy.official, visibility });
  if (hostTrustBlock) return { ...state, notifications: [hostTrustBlock, ...state.notifications] };
  const userTeamIds = new Set(
    state.teams
      .filter((team) => team.members.some((member) => member.userId === state.currentUserId))
      .map((team) => team.id),
  );

  if (!teamSelectionPending && hostJoinMode === "team" && draft.teamId && !userTeamIds.has(draft.teamId)) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "소속 팀 필요",
          body: "팀으로 방을 열려면 내 팀을 먼저 선택해야 합니다.",
          tone: "team",
        },
        ...state.notifications,
      ],
    };
  }

  const sideCapacity = getRecruitingSideCapacity(draft);
  const benchCapacity = getRecruitingBenchCapacity(draft);
  const mmrRangeMode = normalizeRecruitingMmrRangeMode(draft.mmrRangeMode);
  const mmrLimitMode = pickup || creationPolicy.ranked === false ? "off" : "block";
  const allowedAgeGroups = draft.allowedAgeGroups ?? draft.rules?.allowedAgeGroups ?? [];
  const hostTeam = teamSelectionPending ? null : hostJoinMode === "team" ? state.teams.find((team) => team.id === draft.teamId) : null;
  const hostPlayerIds = hostJoinMode === "team" && hostTeam ? [state.currentUserId].filter((playerId) => getTeamMemberIds(hostTeam).includes(playerId)) : [];
  const hostReservePlayerIds = [];
  const privateTeamInviteOnly = visibility === "private" && hostJoinMode === "team";
  const opponentTeam = !teamSelectionPending && visibility === "private" && hostJoinMode === "team"
    ? state.teams.find((team) => team.id === (draft.opponentTeamId ?? draft.targetTeamId))
    : null;
  const hostSidePlayerIds = new Set([...hostPlayerIds, ...hostReservePlayerIds]);
  const rawOpponentPlayerIds = opponentTeam
    ? getSelectedTeamPlayerIds(opponentTeam, sideCapacity, draft.opponentPlayerIds).filter((playerId) => !hostSidePlayerIds.has(playerId))
    : [];
  const requestedOpponentLeaderId = String(draft.opponentLeaderId || draft.opponentPlayerIds?.[0] || "").trim();
  const opponentMemberIds = new Set(getSelectableTeamPlayerIds(opponentTeam));
  const opponentLeaderId = privateTeamInviteOnly
    ? (requestedOpponentLeaderId && opponentMemberIds.has(requestedOpponentLeaderId) && !hostSidePlayerIds.has(requestedOpponentLeaderId) ? requestedOpponentLeaderId : "")
    : rawOpponentPlayerIds.includes(draft.opponentLeaderId) ? draft.opponentLeaderId : rawOpponentPlayerIds[0] ?? "";
  const hostEligibility = hostTeam ? getTeamEventEligibility(hostTeam, state.users, {
    capacity: sideCapacity,
    ranked: creationPolicy.ranked,
    mmrLimitMode,
    mmrRangeMode,
    targetMmr: hostTeam.mmr,
    allowedAgeGroups,
    requireCaptainEligible: false,
  }) : null;
  const opponentEligibility = opponentTeam ? getTeamEventEligibility(opponentTeam, state.users, {
    capacity: sideCapacity,
    ranked: creationPolicy.ranked,
    mmrLimitMode,
    mmrRangeMode,
    targetMmr: hostTeam?.mmr ?? opponentTeam.mmr,
    allowedAgeGroups,
    requireCaptainEligible: true,
  }) : null;
  const orderedOpponentPlayerIds = opponentTeam
    ? (privateTeamInviteOnly ? [] : ensureTeamPartyLeader(opponentTeam, rawOpponentPlayerIds, opponentLeaderId, sideCapacity))
    : [];
  const opponentReservePlayerIds = opponentTeam && !privateTeamInviteOnly
    ? getSelectedReservePlayerIds(opponentTeam, orderedOpponentPlayerIds, draft.opponentReservePlayerIds, benchCapacity).filter((playerId) => !hostSidePlayerIds.has(playerId))
    : [];
  const hostPlayerId = state.currentUserId;
  const selectedCourt = getRegisteredCourts(state).find((court) => court.name === draft.court || court.id === getCourtId(draft)) ?? null;
  const roomRegion = selectedCourt?.region || draft.region || state.users.find((user) => user.id === state.currentUserId)?.region || "전체";
  if (!teamSelectionPending && hostJoinMode === "team" && draft.teamId && !hostPlayerIds.length) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "참여 팀원 필요",
          body: "팀으로 방을 열려면 방장이 해당 팀 소속이어야 합니다.",
          tone: "team",
        },
        ...state.notifications,
      ],
    };
  }
  const hostRepresentativeEligible = hostEligibility?.eligiblePlayerIds?.includes(state.currentUserId);
  if (!teamSelectionPending && hostJoinMode === "team" && draft.teamId && (!hostEligibility?.allowed || !hostRepresentativeEligible)) {
    return {
      ...state,
      notifications: [{
        id: makeId("n"),
        title: "팀전 생성 제한",
        body: !hostRepresentativeEligible
          ? "방장이 현재 경기의 연령·MMR 조건을 충족하지 않습니다."
          : hostEligibility?.reason,
        tone: "team",
      }, ...state.notifications],
    };
  }
  if (privateTeamInviteOnly && opponentTeam && !opponentEligibility?.allowed) {
    return {
      ...state,
      notifications: [{
        id: makeId("n"),
        title: "상대 팀 초대 제한",
        body: `${opponentTeam?.name ?? "상대 팀"}: ${opponentEligibility?.reason ?? "참가 조건을 확인해 주세요."}`,
        tone: "team",
      }, ...state.notifications],
    };
  }
  if (privateTeamInviteOnly && opponentTeam && (opponentTeam.id === hostTeam?.id || !opponentLeaderId || opponentLeaderId !== opponentEligibility?.captainId)) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "상대 사이드 필요",
          body: "비공개 팀전은 A사이드 팀과 B사이드 확인 대표 1명이 필요합니다.",
          tone: "team",
        },
        ...state.notifications,
      ],
    };
  }
  const hostSize = hostJoinMode === "team" ? hostPlayerIds.length : 1;
  const opponentSize = orderedOpponentPlayerIds.length;
  const requestedRefereeId = getTrustedRefereeId(state, draft.refereeId, [state.currentUserId, ...hostPlayerIds, ...orderedOpponentPlayerIds]);
  const refereeWanted = Boolean(draft.refereeWanted || requestedRefereeId);
  const refereeId = "";
  const timingType = draft.timingType === "instant" ? "instant" : "scheduled";
  const fallbackSchedule = timingType === "instant" ? null : getNextQueueSchedule(state.recruitingPosts ?? []);
  const scheduledDate = timingType === "instant" ? "" : (draft.scheduledDate || fallbackSchedule.scheduledDate);
  const scheduledTime = timingType === "instant" ? "" : (draft.scheduledTime || fallbackSchedule.scheduledTime);
  const scheduledAt = timingType === "instant" ? "즉시" : `${scheduledDate} ${scheduledTime}`;
  const scheduleMaxDays = visibility === "public" ? PUBLIC_ROOM_SCHEDULE_MAX_DAYS : ROOM_SCHEDULE_MAX_DAYS;
  if (timingType !== "instant" && !isScheduleDateInAllowedWindow(scheduledDate, new Date(), scheduleMaxDays)) {
    return { ...state, notifications: [getInvalidScheduleNotification(scheduleMaxDays), ...state.notifications] };
  }
  const timingStatus = getPublicRoomTimingStatus({ visibility, timingType, scheduledDate, scheduledTime, scheduledAt, createdAt: new Date().toISOString() });
  if (visibility === "public" && !timingStatus.canCreate) {
    return { ...state, notifications: [getInvalidPublicScheduleNotification(timingStatus.detail), ...state.notifications] };
  }
  const ratingScale = creationPolicy.ranked === false
    ? 0
    : getServerRatingValue("getRecruitingRatingScale", { ranked: creationPolicy.ranked, mmrRangeMode });
  const createdAt = new Date().toISOString();
  const partyReserves = {};
  if (hostReservePlayerIds.length) partyReserves.host = hostReservePlayerIds;
  if (opponentTeam && opponentReservePlayerIds.length) partyReserves[`team:${opponentTeam.id}`] = opponentReservePlayerIds;
  const privatePlayerInviteTargets = visibility === "private" && hostJoinMode === "player"
    ? Array.from(new Set(Array.isArray(draft.invitePlayerIds) ? draft.invitePlayerIds : []))
        .filter((targetUserId) => targetUserId && targetUserId !== state.currentUserId)
        .filter((targetUserId) => state.users.some((user) => user.id === targetUserId && !user.anonymous))
    : [];
  const invitationTargets = visibility === "private" && hostJoinMode === "team" && opponentTeam && opponentLeaderId
    ? [{ targetUserId: opponentLeaderId, teamId: opponentTeam.id, joinMode: "team", side: "teamB" }]
    : privatePlayerInviteTargets.map((targetUserId) => ({ targetUserId, teamId: null, joinMode: "player", side: "teamB" }));
  const initialInvitations = invitationTargets.map((target) => ({
    id: makeId("inv"),
    role: "player",
    targetUserId: target.targetUserId,
    fromUserId: state.currentUserId,
    teamId: target.teamId,
    joinMode: target.joinMode,
    side: target.side,
    reserve: false,
    status: "pending",
    createdAt,
    updatedAt: createdAt,
  }));
  const initialRefereeInvitations = refereeWanted && requestedRefereeId
    ? [{
        id: makeId("inv"),
        role: "referee",
        targetUserId: requestedRefereeId,
        fromUserId: state.currentUserId,
        teamId: null,
        side: "teamB",
        reserve: false,
        status: "pending",
        createdAt,
        updatedAt: createdAt,
      }]
    : [];
  const applicants = opponentTeam && orderedOpponentPlayerIds.length
    ? [
        {
          kind: "team",
          joinMode: "team",
          teamId: opponentTeam.id,
          playerId: opponentLeaderId || orderedOpponentPlayerIds[0],
          side: "teamB",
          status: "waiting",
          reserve: false,
          playerIds: orderedOpponentPlayerIds,
          createdAt,
          updatedAt: createdAt,
        },
      ]
    : [];
  const post = {
    id: draft.id || makeId("q"),
    type: postType,
    title: draft.title?.trim() || `${creationPolicy.ranked === false ? "친선전" : "정규전"} ${draft.mode || "5v5"} 매치 큐`,
    region: roomRegion,
    courtId: selectedCourt?.id ?? getCourtId(draft),
    court: draft.court || "미정",
    mode: draft.mode || "5v5",
    scheduledDate,
    scheduledTime,
    scheduledAt,
    timingType,
    ranked: creationPolicy.ranked,
    mmrRangeMode,
    mmrLimitMode,
    ageRestriction: draft.ageRestriction ?? draft.rules?.ageRestriction ?? "any",
    allowedAgeGroups: draft.allowedAgeGroups ?? draft.rules?.allowedAgeGroups ?? [],
    ratingScale,
    spots: Math.max(0, sideCapacity * 2 - hostSize - opponentSize),
    teamId: teamSelectionPending ? null : hostJoinMode === "team" ? draft.teamId || null : null,
    targetTeamId: teamSelectionPending ? null : privateTeamInviteOnly ? opponentTeam?.id ?? null : draft.targetTeamId ?? null,
    refereeWanted,
    refereeId,
    refereeTrustMin: REFEREE_TRUST_MIN,
    statEntryMinutes: STAT_ENTRY_WINDOW_MINUTES,
    disputeMinutes: normalizeDisputeWindowMinutes(Number.parseInt(draft.objectionWindow, 10) || draft.disputeMinutes),
    ownerId: state.currentUserId,
    hostJoinMode,
    teamOnly,
    hostSide: pickup ? null : "teamA",
    hostReady: hostJoinMode !== "team" || Boolean(hostTeam),
    visibility,
    roomState: {
      ownerId: state.currentUserId,
      mmrRangeMode,
      mmrLimitMode,
      timingType,
      ruleRevision: 1,
      teamOnly,
      refereeWanted,
      approvalModeA: draft.approvalModeA === "all" ? "all" : "leader",
      approvalModeB: draft.approvalModeB === "all" ? "all" : "leader",
      partyReserves,
      partyLeaders: hostJoinMode === "team" && !hostTeam
        ? {}
        : {
            host: state.currentUserId,
            ...(opponentTeam && orderedOpponentPlayerIds.length && opponentLeaderId ? { [`team:${opponentTeam.id}`]: opponentLeaderId } : {}),
          },
      invitations: [...initialInvitations, ...initialRefereeInvitations],
    },
    sideCapacity,
    benchCapacity,
    playerIds: hostPlayerIds,
    position: hostJoinMode === "player" ? draft.position || "포지션 자유" : "포지션 자유",
    playerId: hostPlayerId,
    rules: {
      ...(draft.rules ?? {}),
      ...getMatchRulesPayload({ ...(draft.rules ?? {}), ...draft }, { mode: draft.mode }),
      ...creationPolicy,
      mmrRangeMode,
      mmrLimitMode,
      sideAssignmentStatus: pickup ? "pending" : "confirmed",
      rotationMode: creationPolicy.rotationMode,
      rotationIntervalMinutes: creationPolicy.rotationIntervalMinutes,
      benchCapacity,
    },
    official: creationPolicy.official,
    preRegistered: draft.preRegistered !== false,
    stakes: draft.stakes ?? "",
    courtReserved: Boolean(draft.courtReserved),
    courtFee: draft.courtFee ?? "",
    memo: draft.memo?.trim() || (teamOnly ? "팀 대표가 방 안에서 출전/후보 명단을 확정합니다." : "개인이나 팀 파티로 빈자리에 들어올 수 있습니다."),
    status: "open",
    applicants,
    createdAt,
  };

  return {
    ...state,
    recruitingPosts: [post, ...(state.recruitingPosts ?? [])],
    notifications: [
      ...initialInvitations.map((invitation) => ({
        id: makeId("n"),
        title: "매치방 초대",
        body: invitation.joinMode === "team"
          ? `${post.title} B사이드 파티장 초대장이 도착했습니다. 수락하면 B사이드 참가가 확정됩니다.`
          : `${post.title} 초대장이 도착했습니다. 수락하면 B사이드 참가가 확정됩니다.`,
        tone: "match",
        targetUserId: invitation.targetUserId,
        recruitingPostId: post.id,
        invitationId: invitation.id,
        fromUserId: invitation.fromUserId,
      })),
      ...initialRefereeInvitations.map((invitation) => ({
        id: makeId("n"),
        title: "심판 초대",
        body: `${post.title} 심판 초대가 도착했습니다. 수락하면 심판으로 배정됩니다.`,
        tone: "match",
        targetUserId: invitation.targetUserId,
        recruitingPostId: post.id,
        invitationId: invitation.id,
        fromUserId: invitation.fromUserId,
      })),
      {
        id: makeId("n"),
        title: "매치 큐 등록",
        body: `${post.title} 방이 열렸습니다.`,
        tone: "team",
      },
      ...state.notifications,
    ],
  };
}

export function setRecruitingRoomTeam(state, postId, side, teamId, contextMessage = "") {
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  const safeSide = side === "teamA" || side === "teamB" ? side : "";
  const team = state.teams?.find((item) => item.id === teamId);
  const roomState = normalizeRecruitingRoomState(post?.roomState ?? {});
  const teamOnly = post ? isTeamOnlyRecruitingRoom({ ...post, roomState }) : false;
  if (
    !post ||
    post.status !== "open" ||
    post.confirmedAt ||
    !isRecruitingRoomOwner(post, state.currentUserId) ||
    post.hostJoinMode !== "team" ||
    !teamOnly ||
    !safeSide ||
    !team
  ) return state;

  const captainId = team.members?.find((member) => member.role === "captain")?.userId ?? "";
  const currentUserIsMember = team.members?.some((member) => member.userId === state.currentUserId) ?? false;
  const mmrRangeMode = normalizeRecruitingMmrRangeMode(post.mmrRangeMode ?? roomState.mmrRangeMode);
  const mmrLimitMode = post.ranked === false ? "off" : "block";
  const hostTeam = state.teams?.find((item) => item.id === post.teamId) ?? null;
  const eligibility = getTeamEventEligibility(team, state.users, {
    capacity: getRecruitingSideCapacity(post),
    ranked: post.ranked !== false,
    mmrLimitMode,
    mmrRangeMode,
    targetMmr: safeSide === "teamA" ? team.mmr : hostTeam?.mmr ?? team.mmr,
    allowedAgeGroups: post.allowedAgeGroups ?? post.rules?.allowedAgeGroups,
    requireCaptainEligible: safeSide !== "teamA",
  });
  const currentUserEligible = eligibility?.eligiblePlayerIds?.includes(state.currentUserId);
  if (
    !captainId
    || !eligibility?.allowed
    || (safeSide === "teamA" && (!currentUserIsMember || !currentUserEligible))
  ) {
    return {
      ...state,
      notifications: [{
        id: makeId("n"),
        title: "\uD300 \uC120\uD0DD \uC81C\uD55C",
        body: safeSide === "teamA" && !currentUserIsMember
          ? "\uBC29\uC7A5\uC774 \uD604\uC7AC \uC18C\uC18D\uB41C \uD300\uB9CC A\uC0AC\uC774\uB4DC\uB85C \uC120\uD0DD\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4."
          : safeSide === "teamA" && !currentUserEligible
            ? "\uBC29\uC7A5\uC774 \uD604\uC7AC \uACBD\uAE30\uC758 \uC5F0\uB839\u00B7MMR \uC870\uAC74\uC744 \uCDA9\uC871\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4."
          : eligibility?.reason ?? "\uD604\uC7AC \uD300 \uCC38\uAC00 \uC870\uAC74\uC744 \uCDA9\uC871\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.",
        tone: "team",
        recruitingPostId: postId,
      }, ...state.notifications],
    };
  }

  if (safeSide === "teamA") {
    if (post.teamId || post.targetTeamId === team.id) return state;
    return {
      ...state,
      recruitingPosts: state.recruitingPosts.map((item) => item.id === postId ? {
        ...item,
        teamId: team.id,
        playerIds: [state.currentUserId],
        spots: Math.max(0, Number(item.spots ?? 0) - 1),
        hostReady: false,
        mmrRangeMode,
        mmrLimitMode,
        roomState: {
          ...roomState,
          mmrRangeMode,
          mmrLimitMode,
          partyLeaders: { ...(roomState.partyLeaders ?? {}), host: state.currentUserId },
          partySides: { ...(roomState.partySides ?? {}), host: "teamA" },
        },
        rules: { ...(item.rules ?? {}), mmrRangeMode, mmrLimitMode },
      } : item),
    };
  }

  if (post.visibility !== "private" || !post.teamId || post.targetTeamId || team.id === post.teamId) return state;
  const createdAt = new Date().toISOString();
  const invitation = {
    id: makeId("inv"),
    role: "player",
    targetUserId: captainId,
    fromUserId: state.currentUserId,
    teamId: team.id,
    joinMode: "team",
    side: "teamB",
    reserve: false,
    status: "pending",
    createdAt,
    updatedAt: createdAt,
  };
  const invitationContext = String(contextMessage ?? "").trim();
  return {
    ...state,
    recruitingPosts: state.recruitingPosts.map((item) => item.id === postId ? {
      ...item,
      targetTeamId: team.id,
      mmrRangeMode,
      mmrLimitMode,
      roomState: {
        ...roomState,
        mmrRangeMode,
        mmrLimitMode,
        invitations: [...(roomState.invitations ?? []), invitation],
      },
      rules: { ...(item.rules ?? {}), mmrRangeMode, mmrLimitMode },
    } : item),
    notifications: [{
      id: makeId("n"),
      title: "\uB9E4\uCE58\uBC29 \uCD08\uB300",
      body: [
        `${post.title} B\uC0AC\uC774\uB4DC \uD300 \uCD08\uB300\uAC00 \uB3C4\uCC29\uD588\uC2B5\uB2C8\uB2E4.`,
        invitationContext,
      ].filter(Boolean).join("\n"),
      tone: "match",
      targetUserId: captainId,
      recruitingPostId: postId,
      invitationId: invitation.id,
      fromUserId: state.currentUserId,
    }, ...state.notifications],
  };
}
