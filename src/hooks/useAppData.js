import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addTeamMember,
  addMatchLatePlayer,
  acceptRecruitingInvitation,
  agreeMatch,
  approveTournamentTeam,
  approveCourtRequest,
  approveMatch,
  blockUser,
  cancelMatch,
  cancelRecruitingParticipation,
  checkInMatchPlayer,
  closeRecruitingPost,
  commitAdminReviewAction,
  commitAdminAppointmentAction,
  confirmRecruitingMatch,
  confirmMatchRefereeAbsence,
  createMatch,
  createRecruitingPost,
  createTeam,
  createTournament,
  deleteTeam,
  detachRecruitingPartyPlayer,
  declineRecruitingInvitation,
  disputeMatch,
  endMatch,
  interestRecruitingPost,
  inviteRecruitingPlayers,
  joinRecruitingSideParty,
  handoffMatchRecorder,
  kickRecruitingApplicant,
  loadRemoteState,
  loadState,
  markAllNotificationsRead,
  markNotificationRead,
  reportCourtRequest,
  reportMatch,
  resetState,
  requestMatchRefereeAbsence,
  resumeMatchApproval,
  removeMatchLatePlayer,
  removeMatchRoomPlayer,
  removeRecruitingPartyPlayer,
  runAutomaticStateMaintenance,
  saveRemoteState,
  saveState,
  sendRecruitingChat,
  setRecruitingApplicantPlacement,
  setRecruitingApplicantReserve,
  setRecruitingSlotPosition,
  setMatchRoomPlayerPlacement,
  setRecruitingPartyPlayerPlacement,
  setRecruitingPartyPlayerReserve,
  setRecruitingReady,
  setRecruitingStatRecorder,
  startMatch,
  startRefereeExamAttempt,
  submitCourtRequest,
  finishRefereeExamAttempt,
  submitRefereeRequest,
  submitMatchThumbs,
  submitMatchResult,
  subscribeRemoteState,
  syncNotificationDeliveries,
  removeTeamMember,
  toggleFavoriteCourt,
  toggleFavoritePlayer,
  toggleFavoriteTeam,
  toggleMatchStar,
  updateSettings,
  updateTeamMemberRole,
  updateMatchRoomRules,
  updateTournamentMatchSchedule,
  updatePrivacySettings,
  updateProfile,
  updateRecruitingRoomRules,
  unblockUser,
  voidMatch,
} from "../data/repository.js";
import { isSupabaseConfigured } from "../lib/supabase.js";
import { readProfileBindings, writeProfileBindings } from "../lib/storage.js";
import { findDiscordConnectionOwner, getDiscordConnectionUserId } from "../lib/discord.js";
import { postServerAction } from "../lib/serverActions.js";

function sortByRating(items, selector) {
  return [...items].sort((a, b) => selector(b) - selector(a));
}

function isPersistentAuthUserId(authUserId) {
  return Boolean(authUserId && !String(authUserId).startsWith("test-"));
}

function getBoundAuthProfileId(state, authUserId, profileBindings, profileKey) {
  const users = state.users ?? [];
  if (isPersistentAuthUserId(authUserId)) {
    const ownedUser = users.find((user) => user.authUserId === authUserId);
    if (ownedUser) return ownedUser.id;

    const boundUser = users.find((user) => user.id === profileBindings[profileKey]);
    if (boundUser && (!boundUser.authUserId || boundUser.authUserId === authUserId)) return boundUser.id;

    const currentUser = users.find((user) => user.id === state.currentUserId);
    if (currentUser && !currentUser.authUserId) return currentUser.id;

    return users.find((user) => !user.authUserId)?.id ?? users[0]?.id;
  }

  return profileBindings[profileKey] ?? state.currentUserId ?? users[0]?.id;
}

function isLinkedDiscordConnection(connection) {
  return Boolean(connection?.status === "linked" && connection.userId);
}

function preserveLocalDiscordState(localState, remoteState) {
  const localUsersById = new Map((localState?.users ?? []).map((user) => [user.id, user]));
  const remoteUsers = remoteState?.users ?? [];
  const users = remoteUsers.map((remoteUser) => {
    const localConnection = localUsersById.get(remoteUser.id)?.discordConnection;
    if (!isLinkedDiscordConnection(localConnection) || isLinkedDiscordConnection(remoteUser.discordConnection)) return remoteUser;
    if (findDiscordConnectionOwner(remoteUsers, localConnection, remoteUser.id)) return remoteUser;
    return { ...remoteUser, discordConnection: localConnection, discordUserId: getDiscordConnectionUserId(localConnection) || null };
  });
  const localDiscordChannel = localState?.settings?.notificationChannels?.discord;
  const remoteDiscordChannel = remoteState?.settings?.notificationChannels?.discord;
  if (!users.some((user, index) => user !== remoteUsers[index]) && (!localDiscordChannel?.enabled || remoteDiscordChannel?.enabled)) {
    return remoteState;
  }
  return {
    ...remoteState,
    users,
    settings: {
      ...remoteState.settings,
      notificationChannels: {
        ...remoteState.settings?.notificationChannels,
        discord: localDiscordChannel?.enabled && !remoteDiscordChannel?.enabled ? localDiscordChannel : remoteDiscordChannel,
      },
    },
  };
}

export function useAppData(authUserId = null) {
  const [state, setRawState] = useState(() => syncNotificationDeliveries(loadState()));
  const setState = useCallback((updater) => {
    setRawState((prev) => syncNotificationDeliveries(typeof updater === "function" ? updater(prev) : updater));
  }, []);
  const [profileBindings, setProfileBindings] = useState(() => readProfileBindings());
  const remoteReadyRef = useRef(!isSupabaseConfigured);
  const skipNextRemoteSaveRef = useRef(false);
  const profileKey = authUserId ?? "local-demo";
  const profileLocked = isPersistentAuthUserId(authUserId);
  const currentUserId = getBoundAuthProfileId(state, authUserId, profileBindings, profileKey);

  useEffect(() => {
    saveState(state);
    if (!isSupabaseConfigured || !remoteReadyRef.current) return undefined;
    if (skipNextRemoteSaveRef.current) {
      skipNextRemoteSaveRef.current = false;
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      saveRemoteState(state);
    }, 450);

    return () => window.clearTimeout(timeout);
  }, [state]);

  useEffect(() => {
    setState((prev) => runAutomaticStateMaintenance(prev));
    const interval = window.setInterval(() => {
      setState((prev) => runAutomaticStateMaintenance(prev));
    }, 60000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;

    let mounted = true;
    loadRemoteState()
      .then((remoteState) => {
        if (!mounted) return;
        if (remoteState) {
          const maintainedState = runAutomaticStateMaintenance(remoteState);
          skipNextRemoteSaveRef.current = maintainedState === remoteState;
          setState((prev) => preserveLocalDiscordState(prev, maintainedState));
        }
        remoteReadyRef.current = true;
      })
      .catch((error) => {
        console.warn("Supabase hydration failed. Local demo mode remains active.", error.message);
        remoteReadyRef.current = true;
      });

    const unsubscribe = subscribeRemoteState((remoteState) => {
      const maintainedState = runAutomaticStateMaintenance(remoteState);
      skipNextRemoteSaveRef.current = maintainedState === remoteState;
      setState((prev) => preserveLocalDiscordState(prev, maintainedState));
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!profileLocked || !authUserId || !currentUserId) return;
    if (profileBindings[profileKey] !== currentUserId) {
      setProfileBindings((current) => {
        const next = { ...current, [profileKey]: currentUserId };
        writeProfileBindings(next);
        return next;
      });
    }
    setState((prev) => {
      const profile = prev.users.find((user) => user.id === currentUserId);
      if (!profile || profile.authUserId === authUserId || (profile.authUserId && profile.authUserId !== authUserId)) return prev;
      return updateProfile({ ...prev, currentUserId }, { authUserId }, currentUserId);
    });
  }, [authUserId, currentUserId, profileKey, profileLocked, profileBindings]);

  const currentUser = useMemo(
    () => state.users.find((user) => user.id === currentUserId) ?? state.users[0],
    [currentUserId, state.users],
  );
  const runServerAction = useCallback((path, payload) => {
    postServerAction(path, payload).catch((error) => {
      console.warn(`Server action skipped: ${path}`, error.message);
    });
  }, []);

  const rankings = useMemo(
    () => ({
      players: sortByRating(state.users, (user) => user.ratings.integrated),
      mode: (mode) => sortByRating(state.users, (user) => user.ratings.modes[mode] ?? user.ratings.integrated),
      teams: sortByRating(state.teams, (team) => team.mmr),
      affiliations: sortByRating(state.affiliations.filter((affiliation) => affiliation.type !== "club"), (affiliation) => affiliation.score),
    }),
    [state.affiliations, state.teams, state.users],
  );

  const actions = useMemo(
    () => ({
      switchUser: (userId) => {
        if (profileLocked) return false;
        setProfileBindings((current) => {
          const next = { ...current, [profileKey]: userId };
          writeProfileBindings(next);
          return next;
        });
        setState((prev) => ({ ...prev, currentUserId: userId }));
        return true;
      },
      createMatch: (draft) => {
        let createdId = null;
        setState((prev) => {
          const next = createMatch({ ...prev, currentUserId }, draft);
          createdId = next.matches[0].id;
          return next;
        });
        return createdId;
      },
      createTournament: (draft) => {
        let createdId = null;
        setState((prev) => {
          const existingIds = new Set((prev.tournaments ?? []).map((tournament) => tournament.id));
          const next = createTournament({ ...prev, currentUserId }, draft);
          createdId = (next.tournaments ?? []).find((tournament) => !existingIds.has(tournament.id))?.id ?? null;
          return next;
        });
        return createdId;
      },
      approveTournamentTeam: (tournamentId, teamId) => setState((prev) => approveTournamentTeam({ ...prev, currentUserId }, tournamentId, teamId)),
      updateTournamentMatchSchedule: (tournamentId, matchId, schedule) => {
        setState((prev) => updateTournamentMatchSchedule({ ...prev, currentUserId }, tournamentId, matchId, schedule));
      },
      agreeMatch: (matchId, sideName, playerId) => setState((prev) => agreeMatch({ ...prev, currentUserId }, matchId, sideName, playerId)),
      submitMatchResult: (matchId, result) => setState((prev) => submitMatchResult({ ...prev, currentUserId }, matchId, result)),
      handoffMatchRecorder: (matchId, sideName, nextRecorderId) => {
        setState((prev) => handoffMatchRecorder({ ...prev, currentUserId }, matchId, sideName, nextRecorderId));
      },
      approveMatch: (matchId, sideName, playerId) => setState((prev) => approveMatch({ ...prev, currentUserId }, matchId, sideName, playerId)),
      checkInMatchPlayer: (matchId, sideName, playerId) => setState((prev) => checkInMatchPlayer({ ...prev, currentUserId }, matchId, sideName, playerId)),
      requestMatchRefereeAbsence: (matchId) => setState((prev) => requestMatchRefereeAbsence({ ...prev, currentUserId }, matchId)),
      confirmMatchRefereeAbsence: (matchId) => setState((prev) => confirmMatchRefereeAbsence({ ...prev, currentUserId }, matchId)),
      toggleMatchStar: (matchId, targetUserId) => setState((prev) => toggleMatchStar({ ...prev, currentUserId }, matchId, targetUserId)),
      submitMatchThumbs: (matchId, targetUserIds) => setState((prev) => submitMatchThumbs({ ...prev, currentUserId }, matchId, targetUserIds)),
      disputeMatch: (matchId, reason) => setState((prev) => disputeMatch({ ...prev, currentUserId }, matchId, reason)),
      cancelMatch: (matchId) => setState((prev) => cancelMatch({ ...prev, currentUserId }, matchId)),
      voidMatch: (matchId) => setState((prev) => voidMatch({ ...prev, currentUserId }, matchId)),
      resumeMatchApproval: (matchId, resultDraft = null) => setState((prev) => resumeMatchApproval({ ...prev, currentUserId }, matchId, resultDraft)),
      startMatch: (matchId) => setState((prev) => startMatch({ ...prev, currentUserId }, matchId)),
      endMatch: (matchId) => setState((prev) => endMatch({ ...prev, currentUserId }, matchId)),
      addMatchLatePlayer: (matchId, draft) => setState((prev) => addMatchLatePlayer({ ...prev, currentUserId }, matchId, draft)),
      removeMatchLatePlayer: (matchId, playerId) => setState((prev) => removeMatchLatePlayer({ ...prev, currentUserId }, matchId, playerId)),
      updateSettings: (patch) => setState((prev) => updateSettings({ ...prev, currentUserId }, patch)),
      updatePrivacySettings: (patch) => setState((prev) => updatePrivacySettings({ ...prev, currentUserId }, patch)),
      blockUser: (userId) => setState((prev) => blockUser({ ...prev, currentUserId }, userId)),
      unblockUser: (userId) => setState((prev) => unblockUser({ ...prev, currentUserId }, userId)),
      reportMatch: (matchId, reason, reportedUserIds) => setState((prev) => reportMatch({ ...prev, currentUserId }, matchId, reason, reportedUserIds)),
      reportCourtRequest: (requestId, reason) => {
        setState((prev) => reportCourtRequest({ ...prev, currentUserId }, requestId, reason));
        runServerAction("/api/court-requests/report", { requestId, reason });
      },
      commitAdminReviewAction: (draft) => setState((prev) => commitAdminReviewAction({ ...prev, currentUserId }, draft)),
      commitAdminAppointmentAction: (draft) => setState((prev) => commitAdminAppointmentAction({ ...prev, currentUserId }, draft)),
      approveCourtRequest: (requestId) => {
        setState((prev) => approveCourtRequest({ ...prev, currentUserId }, requestId));
        runServerAction("/api/court-requests/approve", { requestId });
      },
      markNotificationRead: (notificationId) => setState((prev) => markNotificationRead(prev, notificationId)),
      markAllNotificationsRead: () => setState((prev) => markAllNotificationsRead(prev)),
      toggleFavoritePlayer: (userId) => setState((prev) => toggleFavoritePlayer(prev, userId)),
      toggleFavoriteTeam: (teamId) => setState((prev) => toggleFavoriteTeam(prev, teamId)),
      toggleFavoriteCourt: (courtId) => setState((prev) => toggleFavoriteCourt(prev, courtId)),
      submitCourtRequest: (draft) => setState((prev) => submitCourtRequest({ ...prev, currentUserId }, draft)),
      startRefereeExamAttempt: (draft) => setState((prev) => startRefereeExamAttempt({ ...prev, currentUserId }, draft)),
      finishRefereeExamAttempt: (attemptId, result) => setState((prev) => finishRefereeExamAttempt({ ...prev, currentUserId }, attemptId, result)),
      submitRefereeRequest: (draft) => setState((prev) => submitRefereeRequest({ ...prev, currentUserId }, draft)),
      updateProfile: (patch, targetUserId = currentUserId) => {
        const safeTargetUserId = profileLocked ? currentUserId : targetUserId;
        const safePatch = profileLocked ? { ...patch, authUserId } : patch;
        setState((prev) => updateProfile({ ...prev, currentUserId }, safePatch, safeTargetUserId));
      },
      createTeam: (draft) => setState((prev) => createTeam({ ...prev, currentUserId }, draft)),
      deleteTeam: (teamId) => setState((prev) => deleteTeam({ ...prev, currentUserId }, teamId)),
      createRecruitingPost: (draft) => setState((prev) => createRecruitingPost({ ...prev, currentUserId }, draft)),
      interestRecruitingPost: (postId, application) => setState((prev) => interestRecruitingPost({ ...prev, currentUserId }, postId, application)),
      inviteRecruitingPlayers: (postId, invite) => setState((prev) => inviteRecruitingPlayers({ ...prev, currentUserId }, postId, invite)),
      acceptRecruitingInvitation: (postId, invitationId) => setState((prev) => acceptRecruitingInvitation({ ...prev, currentUserId }, postId, invitationId)),
      declineRecruitingInvitation: (postId, invitationId) => setState((prev) => declineRecruitingInvitation({ ...prev, currentUserId }, postId, invitationId)),
      cancelRecruitingParticipation: (postId) => setState((prev) => cancelRecruitingParticipation({ ...prev, currentUserId }, postId)),
      setRecruitingReady: (postId, ready) => setState((prev) => setRecruitingReady({ ...prev, currentUserId }, postId, ready)),
      updateRecruitingRoomRules: (postId, patch) => setState((prev) => updateRecruitingRoomRules({ ...prev, currentUserId }, postId, patch)),
      updateMatchRoomRules: (matchId, patch) => setState((prev) => updateMatchRoomRules({ ...prev, currentUserId }, matchId, patch)),
      setMatchRoomPlayerPlacement: (matchId, playerId, placement) => setState((prev) => setMatchRoomPlayerPlacement({ ...prev, currentUserId }, matchId, playerId, placement)),
      removeMatchRoomPlayer: (matchId, playerId) => setState((prev) => removeMatchRoomPlayer({ ...prev, currentUserId }, matchId, playerId)),
      sendRecruitingChat: (postId, body) => setState((prev) => sendRecruitingChat({ ...prev, currentUserId }, postId, body)),
      setRecruitingApplicantReserve: (postId, playerId, reserve) => {
        setState((prev) => setRecruitingApplicantReserve({ ...prev, currentUserId }, postId, playerId, reserve));
      },
      setRecruitingApplicantPlacement: (postId, playerId, placement) => {
        setState((prev) => setRecruitingApplicantPlacement({ ...prev, currentUserId: playerId || currentUserId }, postId, playerId, placement));
      },
      joinRecruitingSideParty: (postId, teamId, sideName, entryId) => {
        setState((prev) => joinRecruitingSideParty({ ...prev, currentUserId }, postId, teamId, sideName, entryId));
      },
      setRecruitingSlotPosition: (postId, playerId, position) => {
        setState((prev) => setRecruitingSlotPosition({ ...prev, currentUserId }, postId, playerId, position));
      },
      setRecruitingPartyPlayerReserve: (postId, entryId, playerId, reserve) => {
        setState((prev) => setRecruitingPartyPlayerReserve({ ...prev, currentUserId }, postId, entryId, playerId, reserve));
      },
      setRecruitingPartyPlayerPlacement: (postId, entryId, playerId, placement) => {
        setState((prev) => setRecruitingPartyPlayerPlacement({ ...prev, currentUserId }, postId, entryId, playerId, placement));
      },
      detachRecruitingPartyPlayer: (postId, entryId, playerId, placement) => {
        setState((prev) => detachRecruitingPartyPlayer({ ...prev, currentUserId: playerId || currentUserId }, postId, entryId, playerId, placement));
      },
      removeRecruitingPartyPlayer: (postId, entryId, playerId) => {
        setState((prev) => removeRecruitingPartyPlayer({ ...prev, currentUserId }, postId, entryId, playerId));
      },
      setRecruitingStatRecorder: (postId, sideName, playerId) => {
        setState((prev) => setRecruitingStatRecorder({ ...prev, currentUserId }, postId, sideName, playerId));
      },
      kickRecruitingApplicant: (postId, playerId) => setState((prev) => kickRecruitingApplicant({ ...prev, currentUserId }, postId, playerId)),
      confirmRecruitingMatch: (postId) => {
        let createdId = null;
        setState((prev) => {
          const existingIds = new Set((prev.matches ?? []).map((match) => match.id));
          const next = confirmRecruitingMatch({ ...prev, currentUserId }, postId);
          createdId = (next.matches ?? []).find((match) => !existingIds.has(match.id))?.id ?? null;
          return next;
        });
        return createdId;
      },
      closeRecruitingPost: (postId) => setState((prev) => closeRecruitingPost({ ...prev, currentUserId }, postId)),
      addTeamMember: (teamId, draft) => setState((prev) => addTeamMember({ ...prev, currentUserId }, teamId, draft)),
      updateTeamMemberRole: (teamId, userId, role) => setState((prev) => updateTeamMemberRole({ ...prev, currentUserId }, teamId, userId, role)),
      removeTeamMember: (teamId, userId) => setState((prev) => removeTeamMember({ ...prev, currentUserId }, teamId, userId)),
      reset: () => setState(resetState()),
    }),
    [authUserId, currentUserId, profileKey, profileLocked, runServerAction],
  );

  return { state: { ...state, currentUserId }, currentUser, currentUserId, profileBound: true, profileLocked, rankings, actions };
}
