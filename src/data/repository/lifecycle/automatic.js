import { MATCH_SIDES } from "../../../lib/constants.js";
import { adjustUserTrust } from "../../trustUtils.js";
import { fillMatchDecision } from "../../../lib/matchUtils.js";
import { getPostgameRecordVerification } from "../../../lib/postgameRecordVerification.js";
import { getPublicRoomTimingStatus } from "../../../lib/matchUtils.js";
import { getRecruitingApplicantKey } from "../../../lib/recruiting.js";
import { getRecruitingLobby } from "../../../lib/recruiting.js";
import { getRecruitingRoomOwnerId } from "../../../lib/recruiting.js";
import { getRecruitingSideCapacity } from "../../../lib/recruiting.js";
import { getScheduledStartMs } from "../../matchLifecycleUtils.js";
import { getStatSubmissionStatus } from "../../../lib/matchUtils.js";
import { isAutoDecisionDue } from "../../../lib/matchUtils.js";
import { isMatchRecordMatch } from "../../../lib/matchUtils.js";
import { isRecruitingPartyEntry } from "../../../lib/recruiting.js";
import { makeId } from "../../rowUtils.js";
import { normalizeDisputeWindowMinutes } from "../../../lib/constants.js";
import { normalizeRecruitingApplicants } from "../../../lib/recruiting.js";
import { normalizeRecruitingPost } from "../../../lib/recruiting.js";
import { normalizeRecruitingRoomState } from "../../../lib/recruiting.js";
import { isPracticeEntity } from "../../../lib/practiceMode.js";
import { uniquePlayerIds } from "../../rowUtils.js";
import { getServerRatingValue } from "../runtime.js";
import { finalizeMatch } from "./matches.js";

function applyAutomaticMatchDecisions(state, now = new Date()) {
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  let nextState = state;

  for (const match of state.matches ?? []) {
    const current = nextState.matches.find((item) => item.id === match.id);
    if (!current) continue;

    if (isMatchRecordMatch(current) && ["agreed", "approval", "disputed"].includes(current.status) && current.result) {
      const verification = getPostgameRecordVerification(current, { now });
      if (!verification.expired) continue;
      const hasOpenReport = (nextState.reports ?? []).some((report) => (
        report.type === "match"
        && report.targetId === current.id
        && !["resolved", "dismissed"].includes(report.status)
      ));
      const hasOpenDispute = (current.disputes ?? []).some((dispute) => dispute.status === "open");
      if (!verification.canAutoFinalize || hasOpenReport || hasOpenDispute) {
        const verificationStatus = hasOpenReport || hasOpenDispute ? "review" : "insufficient";
        const nextMatch = {
          ...current,
          rules: {
            ...(current.rules ?? {}),
            matchRecordVerificationStatus: verificationStatus,
            matchRecordConfirmationClosedAt: current.rules?.matchRecordConfirmationClosedAt ?? nowIso,
          },
          updatedAt: nowIso,
        };
        nextState = {
          ...nextState,
          matches: nextState.matches.map((item) => item.id === current.id ? nextMatch : item),
        };
        continue;
      }
      const practiceMatch = isPracticeEntity(current);
      const nextMatch = {
        ...current,
        ranked: practiceMatch ? false : true,
        mmrExcludedPlayerIds: verification.unconfirmedIds,
        rules: {
          ...(current.rules ?? {}),
          ratingScale: practiceMatch ? 0 : getServerRatingValue("getPostgameRecordMmrScale", current),
          mmrExcludedPlayerIds: verification.unconfirmedIds,
          teamRatingDisabled: true,
          matchRecordVerificationStatus: "confirmed",
          matchRecordAutoFinalizedAt: nowIso,
        },
        autoConfirmedAt: current.autoConfirmedAt ?? nowIso,
      };
      nextState = finalizeMatch(
        {
          ...nextState,
          matches: nextState.matches.map((item) => (item.id === current.id ? nextMatch : item)),
        },
        nextMatch,
      );
      continue;
    }

    if (current.status === "approval" && current.result) {
      const submittedAtMs = new Date(current.result.submittedAt ?? "").getTime();
      const disputeMinutes = normalizeDisputeWindowMinutes(current.disputeMinutes);
      if (!Number.isFinite(submittedAtMs) || nowMs < submittedAtMs + disputeMinutes * 60 * 1000) continue;
      if ((current.disputes ?? []).some((dispute) => dispute.status === "open")) continue;
      const resultValid = [current.result.scoreA, current.result.scoreB]
        .every((value) => Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 999);
      const statStatus = getStatSubmissionStatus(current);
      if (!resultValid || (current.refereeId && !statStatus.complete)) continue;
      const result = current.disputeDraftResult ?? current.result;
      const nextMatch = {
        ...current,
        result,
        teamA: { ...current.teamA, score: result.scoreA },
        teamB: { ...current.teamB, score: result.scoreB },
        disputeDraftResult: undefined,
        disputeDraftUpdatedAt: undefined,
        autoConfirmedAt: current.autoConfirmedAt ?? nowIso,
        rules: {
          ...(current.rules ?? {}),
          autoFinalizationAudit: {
            actor: "system",
            finalizedAt: nowIso,
            policy: "dispute_window_elapsed",
          },
        },
      };
      nextState = finalizeMatch(
        {
          ...nextState,
          matches: nextState.matches.map((item) => (item.id === current.id ? nextMatch : item)),
        },
        nextMatch,
      );
      continue;
    }

    if (!isAutoDecisionDue(current, nowMs)) continue;

    if (current.status === "contract") {
      const nextMatch = {
        ...current,
        status: "agreed",
        agreements: fillMatchDecision(current, "agreements"),
        agreedAt: current.agreedAt ?? nowIso,
        autoAgreedAt: current.autoAgreedAt ?? nowIso,
      };
      nextState = {
        ...nextState,
        matches: nextState.matches.map((item) => (item.id === current.id ? nextMatch : item)),
        notifications: [
          {
            id: makeId("n"),
            title: "동의 자동 처리",
            body: `${current.title} 동의가 24시간 안에 처리되지 않아 자동 동의 처리됐습니다.`,
            tone: "match",
            matchId: current.id,
          },
          ...nextState.notifications,
        ],
      };
      continue;
    }

  }

  return nextState;
}
function applyExpiredRecruitingRooms(state, now = new Date()) {
  const expiredRows = (state.recruitingPosts ?? []).map((post) => {
    if (post.status !== "open") return false;
    const lobby = getRecruitingLobby(post, state);
    const timing = getPublicRoomTimingStatus(post, now);
    if (timing.expired) return { post, lobby, penalizeHost: lobby.projectedFull };
    const deadlineMs = getScheduledStartMs(post);
    if (!Number.isFinite(deadlineMs) || now.getTime() <= deadlineMs || lobby.projectedFull) return false;
    return { post, lobby, penalizeHost: false };
  }).filter(Boolean);
  if (!expiredRows.length) return state;

  const expiredPosts = expiredRows.map((row) => row.post);
  const expiredIds = new Set(expiredPosts.map((post) => post.id));
  const penalizedHostIds = expiredRows.filter((row) => row.penalizeHost).map((row) => getRecruitingRoomOwnerId(row.post) || row.post.playerId);
  const nowIso = now.toISOString();

  return {
    ...state,
    users: penalizedHostIds.reduce((users, userId) => adjustUserTrust(users, userId, -4), state.users),
    recruitingPosts: (state.recruitingPosts ?? []).map((post) => {
      if (!expiredIds.has(post.id)) return post;
      const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
      return {
        ...post,
        status: "cancelled",
        cancelledAt: post.cancelledAt ?? nowIso,
        roomState: {
          ...roomState,
          invitations: roomState.invitations.map((invitation) => (
            invitation.status === "pending" ? { ...invitation, status: "expired", updatedAt: nowIso } : invitation
          )),
        },
      };
    }),
    notifications: [
      ...expiredPosts.map((post) => ({
        id: makeId("n"),
        title: "매칭방 자동 취소",
        body: `${post.title} 인원이 제한시간 안에 차지 않아 취소됐습니다.`,
        tone: "orange",
        recruitingPostId: post.id,
      })),
      ...state.notifications,
    ],
  };
}
export function applyAutomaticRecruitingConfirmations(state) {
  return state;
}
function repairRecruitingSameTeamPersonalParties(state) {
  let changed = false;
  const recruitingPosts = (state.recruitingPosts ?? []).map((post) => {
    if (!post || post.status !== "open" || post.visibility !== "public") return post;
    let postChanged = false;
    const normalizedPost = normalizeRecruitingPost(post);
    let applicants = normalizeRecruitingApplicants(normalizedPost.applicants ?? []);
    const lobby = getRecruitingLobby({ ...normalizedPost, applicants }, state);
    const roomState = normalizeRecruitingRoomState(normalizedPost.roomState ?? {});
    const capacity = getRecruitingSideCapacity(normalizedPost);
    const partyTargetsBySide = MATCH_SIDES.reduce((acc, sideName) => {
      acc[sideName] = (lobby.sides?.[sideName]?.entries ?? [])
        .filter((entry) => isRecruitingPartyEntry(entry) && entry.team?.id)
        .map((entry) => ({
          entryId: entry.id,
          teamId: entry.team.id,
          fixed: Boolean(entry.fixed),
          memberIds: new Set((entry.team.members ?? []).map((member) => member.userId)),
          playerIds: uniquePlayerIds(entry.players ?? []),
        }));
      return acc;
    }, {});
    const nextPartyReserves = { ...(roomState.partyReserves ?? {}) };

    applicants.forEach((applicant) => {
      if (
        applicant.kind !== "player" ||
        applicant.status !== "ready" ||
        !applicant.playerId ||
        applicant.sourceTeamId ||
        applicant.sourceEntryId
      ) return;

      const targets = (partyTargetsBySide[applicant.side] ?? [])
        .filter((target) => target.memberIds.has(applicant.playerId));
      if (targets.length !== 1) return;

      const target = targets[0];
      const applicantKey = getRecruitingApplicantKey(applicant);
      if (applicant.reserve) {
        const reserveIds = uniquePlayerIds([...(nextPartyReserves[target.entryId] ?? []), applicant.playerId]);
        nextPartyReserves[target.entryId] = reserveIds;
      } else if (target.fixed) {
        const currentPlayerIds = uniquePlayerIds(normalizedPost.playerIds ?? []);
        const nextPlayerIds = uniquePlayerIds([...currentPlayerIds, applicant.playerId]).slice(0, capacity);
        if (!nextPlayerIds.includes(applicant.playerId)) return;
        normalizedPost.playerIds = nextPlayerIds;
        target.playerIds = nextPlayerIds;
      } else {
        let absorbed = false;
        applicants = applicants.map((item) => {
          if (getRecruitingApplicantKey(item) !== target.entryId) return item;
          const currentPlayerIds = uniquePlayerIds(item.playerIds ?? []);
          const nextPlayerIds = uniquePlayerIds([...currentPlayerIds, applicant.playerId]).slice(0, capacity);
          if (!nextPlayerIds.includes(applicant.playerId)) return item;
          target.playerIds = nextPlayerIds;
          absorbed = true;
          return {
            ...item,
            playerId: nextPlayerIds.includes(item.playerId) ? item.playerId : nextPlayerIds[0],
            playerIds: nextPlayerIds,
          };
        });
        if (!absorbed) return;
      }

      applicants = applicants.filter((item) => getRecruitingApplicantKey(item) !== applicantKey);
      postChanged = true;
      changed = true;
    });

    return postChanged
      ? {
          ...post,
          hostJoinMode: normalizedPost.hostJoinMode,
          teamId: normalizedPost.teamId,
          playerIds: normalizedPost.playerIds,
          roomState: { ...roomState, partyReserves: nextPartyReserves },
          applicants,
        }
      : post;
  });

  return changed ? { ...state, recruitingPosts } : state;
}
export function runAutomaticStateMaintenance(state, now = new Date()) {
  return repairRecruitingSameTeamPersonalParties(applyAutomaticRecruitingConfirmations(applyExpiredRecruitingRooms(applyAutomaticMatchDecisions(state, now), now)));
}
