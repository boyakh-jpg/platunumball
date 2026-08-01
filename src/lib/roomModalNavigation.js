import { useRef, useState } from "react";

export function createRoomModalOpeners({
  setSelectedMatchId,
  setSelectedRecruitingPostId,
  loadRecruitingPost,
}) {
  const openMatchRoom = (matchId) => {
    if (!matchId) return;
    setSelectedRecruitingPostId("");
    setSelectedMatchId(matchId);
  };

  const openRecruitingRoom = (postId) => {
    if (!postId) return;
    setSelectedMatchId("");
    setSelectedRecruitingPostId(postId);
    loadRecruitingPost?.(postId);
  };

  return { openMatchRoom, openRecruitingRoom };
}

export function useRoomModalNavigation({ loadRecruitingPost } = {}) {
  const [selectedMatchId, setSelectedMatchId] = useState("");
  const [selectedRecruitingPostId, setSelectedRecruitingPostId] = useState("");
  const [recruitingRoomLoadState, setRecruitingRoomLoadState] = useState("idle");
  const recruitingRoomRequestRef = useRef(0);
  const loadRoom = async (postId, options) => {
    const requestId = recruitingRoomRequestRef.current + 1;
    recruitingRoomRequestRef.current = requestId;
    setRecruitingRoomLoadState("loading");
    try {
      const result = await loadRecruitingPost?.(postId, options);
      if (recruitingRoomRequestRef.current === requestId) setRecruitingRoomLoadState(result === false ? "error" : "loaded");
      return result;
    } catch {
      if (recruitingRoomRequestRef.current === requestId) setRecruitingRoomLoadState("error");
      return false;
    }
  };
  const openers = createRoomModalOpeners({
    setSelectedMatchId,
    setSelectedRecruitingPostId,
    loadRecruitingPost: loadRoom,
  });

  return {
    selectedMatchId,
    setSelectedMatchId,
    selectedRecruitingPostId,
    setSelectedRecruitingPostId,
    recruitingRoomLoadState,
    retryRecruitingRoom: () => loadRoom(selectedRecruitingPostId, { force: true }),
    ...openers,
  };
}
