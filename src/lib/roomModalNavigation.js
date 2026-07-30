import { useState } from "react";

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
  const openers = createRoomModalOpeners({
    setSelectedMatchId,
    setSelectedRecruitingPostId,
    loadRecruitingPost,
  });

  return {
    selectedMatchId,
    setSelectedMatchId,
    selectedRecruitingPostId,
    setSelectedRecruitingPostId,
    ...openers,
  };
}
