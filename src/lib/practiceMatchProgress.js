import {
  getMatchRoomPhase,
} from "./matchUtils.js";
import {
  getRecruitingBenchCapacity,
  getRecruitingLobby,
  getRecruitingSideCapacity,
} from "./recruiting.js";
import { getPickupParticipantCapacity, getPickupParticipantIds } from "./roomFlow.js";

export function getPracticeProgress(state, postId = "", matchId = "") {
  if (matchId) {
    const match = state.matches.find((item) => item.id === matchId);
    const phase = getMatchRoomPhase(match).phase;
    if (phase === "checkin") return { step: 3, label: "연습 선수 출석", phase };
    if (phase === "live") return { step: 4, label: "경기 진행", phase };
    if (["postgame", "dispute"].includes(phase)) return { step: 5, label: "기록 확인", phase };
    if (match?.status === "confirmed") return { step: 5, label: "연습 완료", phase: "completed" };
  }
  if (postId) {
    const post = state.recruitingPosts.find((item) => item.id === postId);
    const pendingCount = post?.roomState?.invitations
      ?.filter((invitation) => invitation.status === "pending")
      .length ?? 0;
    const lobby = getRecruitingLobby(post, state);
    const participantCount = getPickupParticipantIds(lobby).length;
    const participantCapacity = getPickupParticipantCapacity({
      sideCapacity: getRecruitingSideCapacity(post),
      benchCapacity: getRecruitingBenchCapacity(post),
    });
    const needsInvite = Boolean(post && participantCount < participantCapacity && pendingCount === 0);
    const tutorialInvite = post?.roomState?.practiceInviteTutorial ?? null;
    const inviteTarget = state.users.find((user) => user.id === tutorialInvite?.targetPlayerId);
    return {
      step: 2,
      label: needsInvite ? "빈 슬롯 초대" : pendingCount ? "초대 응답 대기" : "매치 확정",
      phase: "recruiting",
      pendingCount,
      needsInvite,
      participantCount,
      participantCapacity,
      inviteTargetName: inviteTarget?.name ?? "",
      inviteSide: tutorialInvite?.side ?? "",
      inviteReserve: Boolean(tutorialInvite?.reserve),
    };
  }
  return { step: 1, label: "연습방 만들기", phase: "create" };
}
