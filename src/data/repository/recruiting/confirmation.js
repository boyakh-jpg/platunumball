import { MATCH_SIDES } from "../../../lib/constants.js";
import { REFEREE_TRUST_MIN } from "../../../lib/constants.js";
import { SIDE_LABEL_TEXT } from "../../../lib/constants.js";
import { STAT_ENTRY_WINDOW_MINUTES } from "../../../lib/constants.js";
import { adjustUserTrust } from "../../trustUtils.js";
import { getCourtId } from "../../../lib/courts.js";
import { getDefaultMatchRules } from "../../../lib/matchRules.js";
import { getLobbyEntryTeamId } from "../../../lib/recruiting.js";
import { getLobbyPrimaryTeamId } from "../../../lib/recruiting.js";
import { getLobbySidePlayerTeamIds } from "../../../lib/recruiting.js";
import { getPublicRoomTimingStatus } from "../../../lib/matchUtils.js";
import { getRecruitingApplicantKey } from "../../../lib/recruiting.js";
import { getRecruitingBenchCapacity } from "../../../lib/recruiting.js";
import { getRecruitingLobby } from "../../../lib/recruiting.js";
import { getRecruitingMmrBalance } from "../../../lib/recruiting.js";
import { getRecruitingRoomOwnerId } from "../../../lib/recruiting.js";
import { getRecruitingRuleAcknowledgement } from "../../../lib/roomFlow.js";
import { getRecruitingSideCapacity } from "../../../lib/recruiting.js";
import { getRoomCancellationPolicy } from "../../../lib/roomFlow.js";
import { isRecruitingPartyEntry } from "../../../lib/recruiting.js";
import { isMmrBalancedRecruitingRoom } from "../../../lib/recruiting.js";
import { isRecruitingRoomOwner } from "../../../lib/recruiting.js";
import { isRoomScheduleChangePending } from "../../../lib/roomFlow.js";
import { isTeamOnlyRecruitingRoom } from "../../../lib/recruiting.js";
import { makeId } from "../../rowUtils.js";
import { normalizeDisputeWindowMinutes } from "../../../lib/constants.js";
import { normalizeRecruitingApplicants } from "../../../lib/recruiting.js";
import { normalizeRecruitingMmrRangeMode } from "../../../lib/recruiting.js";
import { normalizeRecruitingRoomState } from "../../../lib/recruiting.js";
import { uniquePlayerIds } from "../../rowUtils.js";
import { updateManyPinnedReservePlayers } from "../../../lib/recruiting.js";
import { getTrustedRefereeId } from "../lifecycle.js";
import { getPendingScheduleChangeNotification, getRecruitingChangeRequiredIds, getRoomCancelLockedNotification } from "../roomRules.js";
import { getServerRatingValue } from "../runtime.js";

function getLobbySideName(lobby, sideName) {
  const names = lobby.sides[sideName].entries
    .map((entry) => entry.team?.name ?? entry.user?.name)
    .filter(Boolean);
  if (!names.length) return sideName === "teamA" ? "A사이드" : "B사이드";
  return names.slice(0, 3).join(" + ");
}

function promoteRecruitingReservesForConfirmation(post, state, lobby) {
  const fillSlots = MATCH_SIDES.flatMap((sideName) => (
    [...(lobby.sides[sideName]?.fillSlots ?? []), ...(lobby.sides[sideName]?.reserveCandidates ?? [])]
      .filter((candidate, index, candidates) => (
        candidate.status === "ready" &&
        candidates.findIndex((item) => item.playerId === candidate.playerId) === index
      ))
      .slice(0, Math.max(0, (lobby.sides[sideName]?.capacity ?? 0) - (lobby.sides[sideName]?.filled ?? 0)))
      .map((candidate) => ({ ...candidate, side: sideName }))
  ));
  const promotedIdsBySide = {
    teamA: fillSlots.filter((candidate) => candidate.side === "teamA").map((candidate) => candidate.playerId),
    teamB: fillSlots.filter((candidate) => candidate.side === "teamB").map((candidate) => candidate.playerId),
  };
  if (!fillSlots.length) return { post, promotedIdsBySide };

  const capacity = getRecruitingSideCapacity(post);
  const updatedAt = new Date().toISOString();
  const byEntry = fillSlots.reduce((acc, candidate) => {
    if (!candidate.entryId || !candidate.playerId) return acc;
    const current = acc.get(candidate.entryId) ?? { side: candidate.side, playerIds: [] };
    current.playerIds = uniquePlayerIds([...current.playerIds, candidate.playerId]);
    acc.set(candidate.entryId, current);
    return acc;
  }, new Map());

  let nextPost = { ...post };
  let nextRoomState = normalizeRecruitingRoomState(post.roomState ?? {});
  let nextApplicants = normalizeRecruitingApplicants(post.applicants ?? []);
  const nextPartyReserves = { ...(nextRoomState.partyReserves ?? {}) };
  const promotedPlayerIds = [];

  byEntry.forEach(({ playerIds }, entryId) => {
    const entry = (lobby.entries ?? []).find((item) => item.id === entryId);
    if (!entry) return;
    const promotedIds = uniquePlayerIds(playerIds).filter((playerId) => (
      (entry.players ?? []).includes(playerId) || (entry.reserves ?? []).includes(playerId)
    ));
    if (!promotedIds.length) return;
    promotedPlayerIds.push(...promotedIds);

    const reserveKey = entry.fixed ? "host" : entry.id;
    const existingReserveIds = uniquePlayerIds(nextPartyReserves[reserveKey] ?? []);
    const entryWasReserve = Boolean(entry.reserve);
    const remainingReserveIds = entryWasReserve
      ? uniquePlayerIds(entry.players ?? []).filter((playerId) => !promotedIds.includes(playerId))
      : uniquePlayerIds([...(entry.reserves ?? []), ...existingReserveIds]).filter((playerId) => !promotedIds.includes(playerId));

    if (entry.fixed) {
      if (entry.kind === "team") {
        const activeIds = entryWasReserve
          ? promotedIds.slice(0, capacity)
          : uniquePlayerIds([...(nextPost.playerIds ?? []), ...promotedIds]).slice(0, capacity);
        nextPost = {
          ...nextPost,
          playerIds: activeIds,
          hostReady: true,
        };
        const reserveIds = uniquePlayerIds([...existingReserveIds, ...remainingReserveIds]).filter((playerId) => !activeIds.includes(playerId));
        if (reserveIds.length) nextPartyReserves[reserveKey] = reserveIds;
        else delete nextPartyReserves[reserveKey];
      } else {
        nextPost = { ...nextPost, hostReady: true };
      }
      if (entryWasReserve) nextRoomState = { ...nextRoomState, hostReserve: false };
      return;
    }

    nextApplicants = nextApplicants.map((applicant) => {
      if (getRecruitingApplicantKey(applicant) !== entry.id) return applicant;
      if (applicant.kind === "team") {
        const activeIds = entryWasReserve
          ? promotedIds.slice(0, capacity)
          : uniquePlayerIds([...(applicant.playerIds ?? []), ...promotedIds]).slice(0, capacity);
        const reserveIds = uniquePlayerIds([...existingReserveIds, ...remainingReserveIds]).filter((playerId) => !activeIds.includes(playerId));
        if (reserveIds.length) nextPartyReserves[reserveKey] = reserveIds;
        else delete nextPartyReserves[reserveKey];
        return {
          ...applicant,
          reserve: false,
          status: "ready",
          playerId: activeIds[0] ?? applicant.playerId,
          playerIds: activeIds,
          updatedAt,
        };
      }
      return {
        ...applicant,
        reserve: false,
        status: "ready",
        updatedAt,
      };
    });
  });

  nextRoomState = updateManyPinnedReservePlayers(
    { ...nextRoomState, partyReserves: nextPartyReserves },
    "teamA",
    promotedPlayerIds,
    false,
  );
  nextRoomState = updateManyPinnedReservePlayers(nextRoomState, "teamB", promotedPlayerIds, false);

  return {
    post: {
      ...nextPost,
      roomState: nextRoomState,
      applicants: nextApplicants,
    },
    promotedIdsBySide,
  };
}

export function confirmRecruitingMatch(state, postId, options = {}) {
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!post || post.status !== "open" || !isRecruitingRoomOwner(post, state.currentUserId)) return state;
  if (isTeamOnlyRecruitingRoom(post) && !post.teamId) {
    return {
      ...state,
      notifications: [{
        id: makeId("n"),
        title: "A\uD300 \uC120\uD0DD \uD544\uC694",
        body: "A\uC0AC\uC774\uB4DC \uD300\uC744 \uC120\uD0DD\uD55C \uB4A4 \uB9E4\uCE58\uB97C \uD655\uC815\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.",
        tone: "team",
        recruitingPostId: postId,
      }, ...state.notifications],
    };
  }
  if (isRoomScheduleChangePending(post)) {
    return {
      ...state,
      notifications: [getPendingScheduleChangeNotification({ postId }), ...state.notifications],
    };
  }
  const currentRequiredIds = getRecruitingChangeRequiredIds(post, state);
  const acknowledgement = getRecruitingRuleAcknowledgement(post);
  const remainingRuleAcknowledgements = acknowledgement.requiredIds
    .filter((playerId) => currentRequiredIds.includes(playerId))
    .filter((playerId) => !acknowledgement.acknowledgedIds.includes(playerId));
  if (remainingRuleAcknowledgements.length) {
    return {
      ...state,
      notifications: [{
        id: makeId("n"),
        title: "변경 내용 확인 필요",
        body: "현재 참가자 전원이 최신 경기 규칙을 확인해야 매치를 확정할 수 있습니다.",
        tone: "orange",
        recruitingPostId: postId,
      }, ...state.notifications],
    };
  }
  const promotion = promoteRecruitingReservesForConfirmation(post, state, getRecruitingLobby(post, state));
  const promotedPost = promotion.post;
  const lobby = getRecruitingLobby(promotedPost, state);

  if (!lobby.canConfirm) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "매치 확정 불가",
          body: "양쪽 슬롯이 채워지고 필요한 수락이 끝나야 합니다.",
          tone: "match",
          matchId: null,
        },
        ...state.notifications,
      ],
    };
  }
  const mmrBalancedSides = isMmrBalancedRecruitingRoom(promotedPost);
  const sideMmrBalance = getRecruitingMmrBalance(
    promotedPost,
    lobby,
    Object.fromEntries((state.users ?? []).map((user) => [user.id, user])),
    "confirmationProjectedPlayers",
  );
  if (mmrBalancedSides && !sideMmrBalance.allowed) {
    return {
      ...state,
      notifications: [{
        id: makeId("n"),
        title: "매치 확정 불가",
        body: `사이드 평균 차이와 내부 MMR 폭은 ${sideMmrBalance.limit} 이하여야 합니다.`,
        tone: "orange",
        recruitingPostId: postId,
      }, ...state.notifications],
    };
  }
  const timingStatus = getPublicRoomTimingStatus(promotedPost);
  if (!timingStatus.canConfirm) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "매치 확정 불가",
          body: timingStatus.detail,
          tone: "match",
          matchId: null,
        },
        ...state.notifications,
      ],
    };
  }

  const timingType = promotedPost.timingType === "instant" || promotedPost.roomState?.timingType === "instant" ? "instant" : "scheduled";
  const scheduledAt = timingType === "instant" ? "즉시" : (promotedPost.scheduledDate && promotedPost.scheduledTime ? `${promotedPost.scheduledDate} ${promotedPost.scheduledTime}` : "일정 미정");
  const now = new Date().toISOString();
  const benchCapacity = getRecruitingBenchCapacity(promotedPost);
  const pickup = (promotedPost.formationMode ?? promotedPost.rules?.formationMode) === "pickup"
    || (promotedPost.matchIntent ?? promotedPost.rules?.matchIntent) === "pickup";
  const teamOnly = isTeamOnlyRecruitingRoom(promotedPost);
  const teamAPlayers = lobby.sides.teamA.projectedPlayers.slice(0, lobby.sides.teamA.capacity);
  const teamBPlayers = lobby.sides.teamB.projectedPlayers.slice(0, lobby.sides.teamB.capacity);
  const teamAReservePlayers = uniquePlayerIds(lobby.sides.teamA.reserveCandidates.map((candidate) => candidate.playerId))
    .filter((playerId) => !teamAPlayers.includes(playerId))
    .slice(0, benchCapacity);
  const teamBReservePlayers = uniquePlayerIds(lobby.sides.teamB.reserveCandidates.map((candidate) => candidate.playerId))
    .filter((playerId) => !teamBPlayers.includes(playerId))
    .slice(0, benchCapacity);
  const teamAPlayerTeams = pickup ? {} : getLobbySidePlayerTeamIds(lobby, "teamA");
  const teamBPlayerTeams = pickup ? {} : getLobbySidePlayerTeamIds(lobby, "teamB");
  const playerIds = [...teamAPlayers, ...teamBPlayers];
  const confirmedReserveIds = new Set([...teamAReservePlayers, ...teamBReservePlayers]);
  const refereeId = getTrustedRefereeId(state, promotedPost.refereeId, playerIds);
  const promotedRoomState = normalizeRecruitingRoomState(promotedPost.roomState ?? {});
  const mmrRangeMode = normalizeRecruitingMmrRangeMode(promotedPost.mmrRangeMode ?? promotedPost.roomState?.mmrRangeMode);
  const ranked = promotedPost.ranked !== false;
  const ratingScale = getServerRatingValue("getRecruitingRatingScale", { ranked, mmrRangeMode });
  const defaultRules = getDefaultMatchRules(promotedPost.mode);
  const disputeMinutes = normalizeDisputeWindowMinutes(promotedPost.disputeMinutes);
  const match = {
    id: options.matchId || makeId("m"),
    title: promotedPost.title,
    mode: promotedPost.mode,
    courtId: promotedPost.courtId ?? getCourtId(promotedPost),
    court: promotedPost.court,
    scheduledDate: timingType === "instant" ? "" : (promotedPost.scheduledDate ?? ""),
    scheduledTime: timingType === "instant" ? "" : (promotedPost.scheduledTime ?? ""),
    scheduledAt,
    timingType,
    visibility: promotedPost.visibility ?? "public",
    status: "agreed",
    official: ranked && Boolean(promotedPost.official),
    preRegistered: true,
    refereeId,
    refereeTrustMin: REFEREE_TRUST_MIN,
    statEntryMinutes: STAT_ENTRY_WINDOW_MINUTES,
    disputeMinutes,
    rules: {
      ...defaultRules,
      ...(promotedPost.rules ?? {}),
      timingType,
      visibility: promotedPost.visibility ?? "public",
      region: promotedPost.region,
      mmrRangeMode,
      mmrBalancedSides,
      ratingScale,
      benchCapacity,
      slotPositions: promotedRoomState.slotPositions ?? {},
    },
    memo: promotedPost.memo,
    stakes: "매치 큐에서 확정된 경기입니다.",
    ranked,
    mmrRangeMode,
    ratingScale,
    objectionWindow: `${disputeMinutes}분`,
    evidence: [],
    teamA: {
      name: pickup ? SIDE_LABEL_TEXT.teamA : getLobbySideName(lobby, "teamA"),
      teamId: pickup || !teamOnly ? null : getLobbyPrimaryTeamId(lobby, "teamA"),
      playerTeams: teamAPlayerTeams,
      players: teamAPlayers,
      score: 0,
    },
    teamB: {
      name: pickup ? SIDE_LABEL_TEXT.teamB : getLobbySideName(lobby, "teamB"),
      teamId: pickup || !teamOnly ? null : getLobbyPrimaryTeamId(lobby, "teamB"),
      playerTeams: teamBPlayerTeams,
      players: teamBPlayers,
      score: 0,
    },
    parties: pickup ? [] : lobby.entries
      .filter((entry) => isRecruitingPartyEntry(entry))
      .map((entry) => ({
        kind: entry.kind,
        side: entry.side,
        teamId: getLobbyEntryTeamId(entry),
        playerId: entry.playerId,
        partyLeaderId: promotedRoomState.partyLeaders?.[entry.id] ?? (entry.fixed ? promotedPost.playerId : entry.playerId) ?? "",
        players: entry.reserve && entry.status !== "ready" ? [] : entry.players,
        reserves: (entry.reserves ?? []).filter((playerId) => confirmedReserveIds.has(playerId)),
        reserve: entry.reserve,
      }))
      .filter((entry) => entry.players.length || entry.reserves.length),
    reservePlayers: {
      teamA: teamAReservePlayers,
      teamB: teamBReservePlayers,
    },
    promotedReserveIds: {
      teamA: promotion.promotedIdsBySide.teamA,
      teamB: promotion.promotedIdsBySide.teamB,
    },
    agreements: { teamA: teamAPlayers, teamB: teamBPlayers },
    attendance: { teamA: [], teamB: [] },
    approvals: { teamA: [], teamB: [] },
    disputes: [],
    result: null,
    ratingResult: null,
    teamRatingResult: null,
    recruitingPostId: promotedPost.id,
    createdBy: getRecruitingRoomOwnerId(promotedPost) || promotedPost.playerId,
    agreedAt: now,
    createdAt: now,
  };

  return {
    ...state,
    matches: [match, ...state.matches],
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
      item.id === postId
        ? { ...promotedPost, status: "closed", confirmedAt: now, roomState: { ...normalizeRecruitingRoomState(promotedPost.roomState ?? {}), invitations: [] } }
        : item
    )),
    notifications: [
      {
        id: makeId("n"),
        title: "매치 확정",
        body: `${match.title} 경기방이 생성됐습니다.`,
        tone: "match",
        matchId: match.id,
      },
      ...state.notifications,
    ],
  };
}

export function closeRecruitingPost(state, postId, reason = "") {
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!post || !isRecruitingRoomOwner(post, state.currentUserId)) return state;
  const cancellationReason = String(reason).trim();
  if (cancellationReason.length < 5 || cancellationReason.length > 200) return state;
  const cancellationPolicy = getRoomCancellationPolicy(post);
  if (!cancellationPolicy.allowed) {
    return {
      ...state,
      notifications: [getRoomCancelLockedNotification({ postId }), ...state.notifications],
    };
  }
  const penalty = cancellationPolicy.penalty;
  const now = new Date().toISOString();
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const hostPenalties = penalty
    ? [
        ...roomState.hostPenalties,
        { id: makeId("penalty"), by: state.currentUserId, penalty, reason: "room_closed", createdAt: now },
      ]
    : roomState.hostPenalties;

  return {
    ...state,
    users: adjustUserTrust(state.users, state.currentUserId, -penalty),
    recruitingPosts: (state.recruitingPosts ?? []).map((post) => (
      post.id === postId && isRecruitingRoomOwner(post, state.currentUserId)
        ? {
            ...post,
            status: "closed",
            roomState: {
              ...roomState,
              hostPenalties,
              invitations: [],
              cancelPenalty: penalty,
              cancelPenaltyWaived: cancellationPolicy.waived,
              cancelWaiverReason: cancellationPolicy.waiverReason,
              cancellationReasonText: cancellationReason,
              cancelledBy: state.currentUserId,
              cancelledAt: now,
            },
          }
        : post
    )),
    notifications: penalty
      ? [
          {
            id: makeId("n"),
            title: "경기 취소 신뢰도 반영",
            body: `경기 시작 12시간 이내에 취소해 신뢰도 ${penalty}점이 감소했습니다.`,
            tone: "orange",
            recruitingPostId: postId,
          },
          ...state.notifications,
        ]
      : state.notifications,
  };
}
