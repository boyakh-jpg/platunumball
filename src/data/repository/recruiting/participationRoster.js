import { SIDE_LABEL_TEXT } from "../../../lib/constants.js";
import { getLobbyTeamEntry } from "../../../lib/recruiting.js";
import { getRecruitingApplicantKey } from "../../../lib/recruiting.js";
import { getRecruitingBenchCapacity } from "../../../lib/recruiting.js";
import { getRecruitingEntryLeaderId } from "../../../lib/recruiting.js";
import { getRecruitingEntryPlayerIds } from "../../../lib/recruiting.js";
import { getRecruitingHostEditReady } from "../../../lib/recruiting.js";
import { getRecruitingSideCapacity } from "../../../lib/recruiting.js";
import { getRecruitingSlotEditStatus } from "../../../lib/recruiting.js";
import { isRecruitingReserveLimitExceeded } from "../../../lib/recruiting.js";
import { makeId } from "../../rowUtils.js";
import { normalizeRecruitingApplicants } from "../../../lib/recruiting.js";
import { uniquePlayerIds } from "../../rowUtils.js";
import { updateManyPinnedReservePlayers } from "../../../lib/recruiting.js";
import { getRecruitingReserveLimitNotification } from "../guards.js";

export function applyTeamOnlyRosterSummon(state, post, roomState, lobby, side, reserve, playerIds, teamId) {
  const team = (state.teams ?? []).find((item) => item.id === teamId);
  const entry = getLobbyTeamEntry(lobby, side, teamId);
  const leaderId = getRecruitingEntryLeaderId(entry, roomState, post.playerId);
  if (!team || !entry || leaderId !== state.currentUserId) {
    return {
      state,
      handled: true,
      ok: false,
      notification: {
        id: makeId("n"),
        title: "팀원 소집 권한 없음",
        body: "팀전 출전/후보 명단은 해당 사이드장이 정합니다.",
        tone: "orange",
        recruitingPostId: post.id,
      },
    };
  }

  const teamMemberIds = new Set((team.members ?? []).map((member) => member.userId));
  const occupiedIds = new Set(
    (lobby.entries ?? [])
      .flatMap((item) => [item.playerId, ...(item.players ?? []), ...(item.reserves ?? [])])
      .filter(Boolean),
  );
  const targetIds = uniquePlayerIds(playerIds)
    .filter((playerId) => teamMemberIds.has(playerId))
    .filter((playerId) => !occupiedIds.has(playerId));
  if (!targetIds.length) {
    return {
      state,
      handled: true,
      ok: false,
      notification: {
        id: makeId("n"),
        title: "소집 대상 없음",
        body: "이미 방에 있거나 같은 팀원이 아닙니다.",
        tone: "team",
        recruitingPostId: post.id,
      },
    };
  }

  const capacity = getRecruitingSideCapacity(post);
  const benchCapacity = getRecruitingBenchCapacity(post);
  const applicants = normalizeRecruitingApplicants(post.applicants ?? []);
  const targetApplicant = entry.fixed
    ? null
    : applicants.find((applicant) => getRecruitingApplicantKey(applicant) === entry.id);
  if (!entry.fixed && !targetApplicant) return { state, handled: true, ok: false };

  const currentActiveIds = getRecruitingEntryPlayerIds(entry, targetApplicant, post, capacity);
  const currentReserveIds = uniquePlayerIds(roomState.partyReserves?.[entry.id] ?? []);
  const openActiveCount = Math.max(0, capacity - currentActiveIds.length);
  const nextActiveAddIds = reserve ? [] : targetIds.slice(0, openActiveCount);
  const nextReserveAddIds = [
    ...(reserve ? targetIds : targetIds.slice(openActiveCount)),
  ].slice(0, Math.max(0, benchCapacity - currentReserveIds.length));
  const nextActiveIds = uniquePlayerIds([...currentActiveIds, ...nextActiveAddIds]).slice(0, capacity);
  const nextReserveIds = uniquePlayerIds([...currentReserveIds, ...nextReserveAddIds]).filter((playerId) => !nextActiveIds.includes(playerId));
  if (nextActiveIds.length === currentActiveIds.length && nextReserveIds.length === currentReserveIds.length) {
    return {
      state,
      handled: true,
      ok: false,
      notification: {
        id: makeId("n"),
        title: "소집 자리 없음",
        body: "출전/후보 슬롯이 모두 찼습니다.",
        tone: "orange",
        recruitingPostId: post.id,
      },
    };
  }

  const nextPartyReserves = { ...roomState.partyReserves, [entry.id]: nextReserveIds };
  if (!nextReserveIds.length) delete nextPartyReserves[entry.id];
  const nextRoomState = updateManyPinnedReservePlayers(
    updateManyPinnedReservePlayers({ ...roomState, partyReserves: nextPartyReserves }, side, nextActiveAddIds, false),
    side,
    nextReserveAddIds,
    true,
  );
  const updatedAt = new Date().toISOString();
  const nextPost = entry.fixed
    ? { ...post, hostReady: getRecruitingHostEditReady(post), playerIds: nextActiveIds, roomState: nextRoomState }
    : {
        ...post,
        roomState: nextRoomState,
        applicants: applicants.map((applicant) => (
          getRecruitingApplicantKey(applicant) === entry.id
            ? { ...applicant, playerId: leaderId, reserve: false, status: getRecruitingSlotEditStatus(post), playerIds: nextActiveIds, updatedAt }
            : applicant
        )),
      };
  if (isRecruitingReserveLimitExceeded(nextPost, state, side)) {
    return {
      state,
      handled: true,
      ok: false,
      notification: getRecruitingReserveLimitNotification(post.id, side),
    };
  }

  const addedCount = nextActiveAddIds.length + nextReserveAddIds.length;
  const summonedIds = [...nextActiveAddIds, ...nextReserveAddIds].filter((playerId) => playerId !== state.currentUserId);
  return {
    state: {
      ...state,
      recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
        item.id === post.id ? nextPost : item
      )),
      notifications: [
        ...summonedIds.map((playerId) => ({
          id: makeId("n"),
          title: "팀원 소집",
          body: `${post.title} ${SIDE_LABEL_TEXT[side]} ${nextActiveAddIds.includes(playerId) ? "출전" : "후보"} 명단에 등록됐습니다.`,
          tone: "match",
          targetUserId: playerId,
          recruitingPostId: post.id,
          createdAt: updatedAt,
          updatedAt,
        })),
        {
          id: makeId("n"),
          title: "팀원 소집 완료",
          body: `${addedCount}명을 ${SIDE_LABEL_TEXT[side]} 명단에 등록했습니다.`,
          tone: "match",
          recruitingPostId: post.id,
        },
        ...state.notifications,
      ],
    },
    handled: true,
    ok: true,
  };
}
