import {
  getRecruitingChatLastSeq,
  mergeRecruitingChatMessageBatch,
} from "../remoteMerge.js";
import { isSyntheticMatchRoomId } from "../../../lib/recruiting.js";

export function buildRecruitingActions(context) {
  const {
    ROOM_CHAT_HISTORY_LIMIT,
    ROOM_CHAT_MESSAGE_COLUMNS,
    ROOM_CHAT_POLL_BATCH_LIMIT,
    ROOM_CHAT_POLL_INTERVAL_MS,
    acceptRecruitingInvitation,
    acknowledgeMatchRoomRules,
    acknowledgeRecruitingRoomRules,
    applyMatchMutation,
    applyRecruitingPostMutation,
    cancelMatchParticipation,
    cancelRecruitingParticipation,
    closeRecruitingPost,
    createRecruitingPost,
    currentUserId,
    declineRecruitingInvitation,
    detachRecruitingPartyPlayer,
    ensureRemoteReady,
    ensureServerActionAvailable,
    getActionActorDebug,
    getNewItems,
    interestRecruitingPost,
    inviteRecruitingPlayers,
    inviteRecruitingReferee,
    isSupabaseConfigured,
    joinRecruitingSideParty,
    kickRecruitingApplicant,
    removeMatchRoomPlayer,
    removeRecruitingPartyPlayer,
    respondMatchScheduleProposal,
    respondRecruitingScheduleProposal,
    rollbackIfServerFailed,
    sendRecruitingChat,
    setMatchRecordParticipants,
    setMatchRecordTeamRoster,
    setMatchRoomPlayerPlacement,
    setRecruitingApplicantPlacement,
    setRecruitingApplicantReserve,
    setRecruitingPartyPlayerPlacement,
    setRecruitingPartyPlayerReserve,
    setRecruitingRoomTeam,
    setRecruitingSlotPosition,
    setRecruitingTeamPartyRoster,
    setState,
    stateRef,
    supabase,
    swapPickupMatchPlayers,
    syncRecruitingPostServer,
    updateMatchRoomRules,
    updateRecruitingRoomRules,
  } = context;

  return ({
createRecruitingPost: async (draft) => {
    const serverReady = await ensureServerActionAvailable("/api/recruiting/sync-post", "방 생성");
    if (serverReady !== true) return serverReady;
    if (!ensureRemoteReady("방 생성")) return Promise.resolve(null);
    if (isSupabaseConfigured) {
      return syncRecruitingPostServer(null, [], { action: "createRecruitingPost", draft }).then((result) => {
        if (!result || result?.ok === false) return result;
        return result?.post?.id ?? result?.postId ?? null;
      });
    }
    const previousState = stateRef.current;
    const existingIds = new Set((previousState.recruitingPosts ?? []).map((post) => post.id));
    const next = createRecruitingPost({ ...previousState, currentUserId }, draft);
    const createdPost = (next.recruitingPosts ?? []).find((post) => !existingIds.has(post.id)) ?? null;
    stateRef.current = next;
    setState(next);
    if (!createdPost) {
      const localBlockNotification = getNewItems(previousState.notifications ?? [], next.notifications ?? [])[0] ?? null;
      return Promise.resolve({
        ok: false,
        error: "local_reducer_blocked",
        details: getActionActorDebug(previousState, currentUserId),
        message: localBlockNotification ? `${localBlockNotification.title}: ${localBlockNotification.body}` : "방 생성 조건을 통과하지 못했습니다.",
      });
    }
    return createdPost.id;
  },
  setRecruitingRoomTeam: (postId, side, teamId, contextMessage = "") => applyRecruitingPostMutation(
    postId,
    (prev) => setRecruitingRoomTeam({ ...prev, currentUserId }, postId, side, teamId, contextMessage),
    { action: "setRecruitingRoomTeam", side, teamId, contextMessage },
  ),
  interestRecruitingPost: (postId, application) => applyRecruitingPostMutation(postId, (prev) => interestRecruitingPost({ ...prev, currentUserId }, postId, application), { action: "interestRecruitingPost", application, joinMode: application?.joinMode }),
  inviteRecruitingReferee: (postId, refereeId) => applyRecruitingPostMutation(postId, (prev) => inviteRecruitingReferee({ ...prev, currentUserId }, postId, refereeId), { action: "inviteRecruitingReferee", refereeId }),
  inviteRecruitingPlayers: (postId, invite) => applyRecruitingPostMutation(postId, (prev) => inviteRecruitingPlayers({ ...prev, currentUserId }, postId, invite), { action: "inviteRecruitingPlayers", invite }),
  acceptRecruitingInvitation: (postId, invitationId) => applyRecruitingPostMutation(postId, (prev) => acceptRecruitingInvitation({ ...prev, currentUserId }, postId, invitationId), { action: "acceptRecruitingInvitation", invitationId, optimisticBeforeServerCheck: true }),
  declineRecruitingInvitation: (postId, invitationId) => applyRecruitingPostMutation(postId, (prev) => declineRecruitingInvitation({ ...prev, currentUserId }, postId, invitationId), { action: "declineRecruitingInvitation", invitationId, optimisticBeforeServerCheck: true }),
  cancelRecruitingParticipation: (postId) => applyRecruitingPostMutation(postId, (prev) => cancelRecruitingParticipation({ ...prev, currentUserId }, postId), { action: "cancelRecruitingParticipation" }),
  cancelMatchParticipation: (matchId, reason) => applyMatchMutation(matchId, (prev) => cancelMatchParticipation({ ...prev, currentUserId }, matchId, reason), { action: "cancelMatchParticipation", reason }),
  updateRecruitingRoomRules: (postId, patch) => applyRecruitingPostMutation(postId, (prev) => updateRecruitingRoomRules({ ...prev, currentUserId }, postId, patch), { action: "updateRecruitingRoomRules", patch }),
  updateMatchRoomRules: (matchId, patch) => applyMatchMutation(matchId, (prev) => updateMatchRoomRules({ ...prev, currentUserId }, matchId, patch), { action: "updateMatchRoomRules", patch }),
  acknowledgeRecruitingRoomRules: (postId, revision) => applyRecruitingPostMutation(postId, (prev) => acknowledgeRecruitingRoomRules({ ...prev, currentUserId }, postId, revision), { action: "acknowledgeRecruitingRoomRules", revision }),
  respondRecruitingScheduleProposal: (postId, proposalId, decision) => applyRecruitingPostMutation(postId, (prev) => respondRecruitingScheduleProposal({ ...prev, currentUserId }, postId, proposalId, decision), { action: "respondRecruitingScheduleProposal", proposalId, decision }),
  acknowledgeMatchRoomRules: (matchId, revision) => applyMatchMutation(matchId, (prev) => acknowledgeMatchRoomRules({ ...prev, currentUserId }, matchId, revision), { action: "acknowledgeMatchRoomRules", revision }),
  respondMatchScheduleProposal: (matchId, proposalId, decision) => applyMatchMutation(matchId, (prev) => respondMatchScheduleProposal({ ...prev, currentUserId }, matchId, proposalId, decision), { action: "respondMatchScheduleProposal", proposalId, decision }),
  setMatchRoomPlayerPlacement: (matchId, playerId, placement) => applyMatchMutation(matchId, (prev) => setMatchRoomPlayerPlacement({ ...prev, currentUserId }, matchId, playerId, placement), { action: "setMatchRoomPlayerPlacement", playerId, placement }),
  swapPickupMatchPlayers: (matchId, firstPlayerId, secondPlayerId) => applyMatchMutation(matchId, (prev) => swapPickupMatchPlayers({ ...prev, currentUserId }, matchId, firstPlayerId, secondPlayerId), { action: "swapPickupMatchPlayers", firstPlayerId, secondPlayerId }),
  setMatchRecordParticipants: (matchId, setup) => applyMatchMutation(matchId, (prev) => setMatchRecordParticipants({ ...prev, currentUserId }, matchId, setup), { action: "setMatchRecordParticipants", setup }),
  setMatchRecordTeamRoster: (matchId, sideName, roster) => applyMatchMutation(matchId, (prev) => setMatchRecordTeamRoster({ ...prev, currentUserId }, matchId, sideName, roster), { action: "setMatchRecordTeamRoster", sideName, roster }),
  removeMatchRoomPlayer: (matchId, playerId, reason) => applyMatchMutation(matchId, (prev) => removeMatchRoomPlayer({ ...prev, currentUserId }, matchId, playerId, reason), { action: "removeMatchRoomPlayer", playerId, reason }),
  sendRecruitingChat: (postId, body) => applyRecruitingPostMutation(postId, (prev) => sendRecruitingChat({ ...prev, currentUserId }, postId, body), { action: "sendRecruitingChat", body, optimisticBeforeServerCheck: true }),
  pollRecruitingChat: (postId) => {
    const roomId = String(postId ?? "").trim();
    if (!isSupabaseConfigured || !supabase || !roomId || isSyntheticMatchRoomId(roomId) || typeof window === "undefined" || typeof document === "undefined") return () => {};
    let stopped = false;
    let intervalId = null;
    let fetching = false;
    const fetchMessages = async () => {
      if (stopped || fetching || document.hidden) return;
      fetching = true;
      try {
        const lastSeq = getRecruitingChatLastSeq(stateRef.current, roomId);
        let query = supabase
          .from("room_chat_messages")
          .select(ROOM_CHAT_MESSAGE_COLUMNS)
          .eq("room_type", "recruiting")
          .eq("room_id", roomId);
        if (lastSeq > 0) {
          query = query.gt("message_seq", lastSeq).order("message_seq", { ascending: true }).limit(ROOM_CHAT_POLL_BATCH_LIMIT);
        } else {
          query = query.order("message_seq", { ascending: false }).limit(ROOM_CHAT_HISTORY_LIMIT);
        }
        const { data, error } = await query;
        if (error) throw error;
        const rows = lastSeq > 0 ? (data ?? []) : [...(data ?? [])].reverse();
        if (!rows.length) return;
        setState((prev) => mergeRecruitingChatMessageBatch(prev, roomId, rows));
      } catch (error) {
        console.warn("Recruiting chat polling skipped.", error.message);
      } finally {
        fetching = false;
      }
    };
    const start = () => {
      if (stopped || intervalId || document.hidden) return;
      void fetchMessages();
      intervalId = window.setInterval(fetchMessages, ROOM_CHAT_POLL_INTERVAL_MS);
    };
    const stop = () => {
      if (!intervalId) return;
      window.clearInterval(intervalId);
      intervalId = null;
    };
    const handleVisibilityChange = () => {
      if (document.hidden) {
        stop();
        return;
      }
      start();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    start();
    return () => {
      stopped = true;
      stop();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  },
  setRecruitingApplicantReserve: (postId, playerId, reserve) => applyRecruitingPostMutation(postId, (prev) => setRecruitingApplicantReserve({ ...prev, currentUserId }, postId, playerId, reserve), { action: "setRecruitingApplicantReserve", playerId, reserve }),
  setRecruitingApplicantPlacement: (postId, playerId, placement) => applyRecruitingPostMutation(postId, (prev) => setRecruitingApplicantPlacement({ ...prev, currentUserId }, postId, playerId, placement), { action: "setRecruitingApplicantPlacement", playerId, placement }),
  joinRecruitingSideParty: (postId, teamId, sideName, entryId) => {
    return applyRecruitingPostMutation(postId, (prev) => joinRecruitingSideParty({ ...prev, currentUserId }, postId, teamId, sideName, entryId), { action: "joinRecruitingSideParty", teamId, sideName, entryId });
  },
  setRecruitingSlotPosition: (postId, playerId, position) => applyRecruitingPostMutation(postId, (prev) => setRecruitingSlotPosition({ ...prev, currentUserId }, postId, playerId, position), { action: "setRecruitingSlotPosition", playerId, position }),
  setRecruitingPartyPlayerReserve: (postId, entryId, playerId, reserve) => applyRecruitingPostMutation(postId, (prev) => setRecruitingPartyPlayerReserve({ ...prev, currentUserId }, postId, entryId, playerId, reserve), { action: "setRecruitingPartyPlayerReserve", entryId, playerId, reserve }),
  setRecruitingPartyPlayerPlacement: (postId, entryId, playerId, placement) => applyRecruitingPostMutation(postId, (prev) => setRecruitingPartyPlayerPlacement({ ...prev, currentUserId }, postId, entryId, playerId, placement), { action: "setRecruitingPartyPlayerPlacement", entryId, playerId, placement }),
  setRecruitingTeamPartyRoster: (postId, entryId, roster) => applyRecruitingPostMutation(postId, (prev) => setRecruitingTeamPartyRoster({ ...prev, currentUserId }, postId, entryId, roster), { action: "setRecruitingTeamPartyRoster", entryId, roster }),
  detachRecruitingPartyPlayer: (postId, entryId, playerId, placement) => applyRecruitingPostMutation(postId, (prev) => detachRecruitingPartyPlayer({ ...prev, currentUserId }, postId, entryId, playerId, placement), { action: "detachRecruitingPartyPlayer", entryId, playerId, placement }),
  removeRecruitingPartyPlayer: (postId, entryId, playerId, reason) => applyRecruitingPostMutation(postId, (prev) => removeRecruitingPartyPlayer({ ...prev, currentUserId }, postId, entryId, playerId, reason), { action: "removeRecruitingPartyPlayer", entryId, playerId, reason }),
  kickRecruitingApplicant: (postId, playerId, reason) => applyRecruitingPostMutation(postId, (prev) => kickRecruitingApplicant({ ...prev, currentUserId }, postId, playerId, reason), { action: "kickRecruitingApplicant", playerId, reason }),
  confirmRecruitingMatch: async (postId) => {
    const serverReady = await ensureServerActionAvailable("/api/recruiting/sync-post", "방 확정");
    if (serverReady !== true) return null;
    if (!ensureRemoteReady("방 확정")) return null;
    let rollbackState = null;
    setState((prev) => {
      rollbackState = prev;
      return prev;
    });
    return rollbackIfServerFailed(
      syncRecruitingPostServer(null, [], { action: "confirmRecruitingMatch", postId }),
      rollbackState,
      "방 확정",
      { action: "confirmRecruitingMatch", postId },
    ).then((result) => (result?.ok === false ? null : result?.matchId ?? result?.createdMatch?.id ?? result?.match?.id ?? null));
  },
  closeRecruitingPost: (postId, reason = "") => applyRecruitingPostMutation(
    postId,
    (prev) => closeRecruitingPost({ ...prev, currentUserId }, postId, reason),
    { action: "closeRecruitingPost", reason },
  )
  });
}
