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
  createProfileShell,
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
  submitCourtReview,
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

export function useAppData(authUser = null) {
  const authUserId = typeof authUser === "string" ? authUser : authUser?.id ?? null;
  const authEmail = typeof authUser === "object" ? authUser?.email ?? authUser?.user_metadata?.email ?? "" : "";
  const [state, setRawState] = useState(() => syncNotificationDeliveries(loadState({ includeDemo: !isSupabaseConfigured, authUserId, email: authEmail })));
  const setState = useCallback((updater) => {
    setRawState((prev) => syncNotificationDeliveries(typeof updater === "function" ? updater(prev) : updater));
  }, []);
  const [profileBindings, setProfileBindings] = useState(() => readProfileBindings());
  const remoteReadyRef = useRef(!isSupabaseConfigured);
  const skipNextRemoteSaveRef = useRef(false);
  const profileKey = authUserId ?? "local-demo";
  const profileLocked = isPersistentAuthUserId(authUserId);
  const effectiveProfileBindings = isSupabaseConfigured ? {} : profileBindings;
  const currentUserId = getBoundAuthProfileId(state, authUserId, effectiveProfileBindings, profileKey);

  useEffect(() => {
    if (!isSupabaseConfigured || !authUserId) return;
    setState((prev) => {
      if (prev.users.some((user) => user.authUserId === authUserId)) return prev;
      const shellUser = createProfileShell(authUserId, authEmail);
      return { ...prev, currentUserId: shellUser.id, users: [shellUser, ...prev.users] };
    });
  }, [authEmail, authUserId, setState]);

  useEffect(() => {
    if (!isSupabaseConfigured) saveState(state);
    if (!isSupabaseConfigured || !remoteReadyRef.current) return undefined;
    if (skipNextRemoteSaveRef.current) {
      skipNextRemoteSaveRef.current = false;
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      saveRemoteState(state, currentUserId);
    }, 450);

    return () => window.clearTimeout(timeout);
  }, [currentUserId, state]);

  useEffect(() => {
    setState((prev) => runAutomaticStateMaintenance(prev));
    const interval = window.setInterval(() => {
      setState((prev) => runAutomaticStateMaintenance(prev));
    }, 60000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !authUserId) return undefined;

    let mounted = true;
    loadRemoteState(authUserId, authEmail)
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
        console.warn("Supabase hydration failed. Remote state remains empty.", error.message);
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
  }, [authEmail, authUserId]);

  useEffect(() => {
    if (!profileLocked || !authUserId || !currentUserId || isSupabaseConfigured) return;
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
    () => state.users.find((user) => user.id === currentUserId) ?? state.users[0] ?? (profileLocked ? createProfileShell(authUserId, authEmail) : null),
    [authEmail, authUserId, currentUserId, profileLocked, state.users],
  );
  const runServerAction = useCallback((path, payload) => {
    postServerAction(path, payload).catch((error) => {
      console.warn(`Server action skipped: ${path}`, error.message);
    });
  }, []);
  const persistProfileServer = useCallback((profile) => {
    const promise = postServerAction("/api/profile/upsert", { profile });
    promise.catch((error) => {
      console.warn("Profile server action failed.", error.message);
    });
    return promise;
  }, []);
  const syncRecruitingPostServer = useCallback((post, notifications = []) => {
    if (!post?.id) return;
    runServerAction("/api/recruiting/sync-post", { post, notifications });
  }, [runServerAction]);
  const syncMatchServer = useCallback((match, notifications = []) => {
    if (!match?.id) return;
    runServerAction("/api/matches/sync-match", { match, notifications });
  }, [runServerAction]);
  const submitReportServer = useCallback((report, notifications = []) => {
    if (!report?.id) return;
    runServerAction("/api/reports/submit", { report, notifications });
  }, [runServerAction]);
  const syncTeamServer = useCallback((team, notifications = []) => {
    if (!team?.id) return;
    runServerAction("/api/teams/sync-team", { team, notifications });
  }, [runServerAction]);
  const deleteTeamServer = useCallback((deletedTeamId, notifications = []) => {
    if (!deletedTeamId) return;
    runServerAction("/api/teams/sync-team", { deletedTeamId, notifications });
  }, [runServerAction]);
  const syncTournamentServer = useCallback((tournament, notifications = [], meta = {}) => {
    if (!tournament?.id) return;
    runServerAction("/api/tournaments/sync-tournament", { tournament, notifications, ...meta });
  }, [runServerAction]);
  const syncRefereeServer = useCallback((action, payload = {}) => {
    if (!action) return;
    runServerAction("/api/referee/sync", { action, ...payload });
  }, [runServerAction]);

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
    () => {
      const getNewRecruitingNotifications = (prev, next, postId) => {
        const beforeIds = new Set((prev.notifications ?? []).map((notification) => notification.id));
        return (next.notifications ?? []).filter((notification) => (
          !beforeIds.has(notification.id) &&
          (notification.recruitingPostId === postId || notification.invitationId)
        ));
      };
      const getNewMatchNotifications = (prev, next, matchId) => {
        const beforeIds = new Set((prev.notifications ?? []).map((notification) => notification.id));
        return (next.notifications ?? []).filter((notification) => !beforeIds.has(notification.id) && notification.matchId === matchId);
      };
      const getNewReportNotifications = (prev, next, report) => {
        const beforeIds = new Set((prev.notifications ?? []).map((notification) => notification.id));
        return (next.notifications ?? []).filter((notification) => (
          !beforeIds.has(notification.id) &&
          (notification.matchId === report?.targetId || notification.type === "report" || !notification.targetUserId)
        ));
      };
      const getNewTeamNotifications = (prev, next) => {
        const beforeIds = new Set((prev.notifications ?? []).map((notification) => notification.id));
        return (next.notifications ?? []).filter((notification) => (
          !beforeIds.has(notification.id) &&
          (notification.tone === "team" || notification.type === "team" || !notification.targetUserId)
        ));
      };
      const getNewTournamentNotifications = (prev, next) => {
        const beforeIds = new Set((prev.notifications ?? []).map((notification) => notification.id));
        return (next.notifications ?? []).filter((notification) => (
          !beforeIds.has(notification.id) &&
          !notification.matchId &&
          (notification.type === "tournament" || notification.tone === "match" || !notification.targetUserId)
        ));
      };
      const getNewRefereeNotifications = (prev, next) => {
        const beforeIds = new Set((prev.notifications ?? []).map((notification) => notification.id));
        return (next.notifications ?? []).filter((notification) => (
          !beforeIds.has(notification.id) &&
          (notification.type === "referee" || notification.tone === "team" || !notification.targetUserId)
        ));
      };
      const applyRecruitingPostMutation = (postId, reducer) => {
        let syncedPost = null;
        let syncedNotifications = [];
        setState((prev) => {
          const next = reducer(prev);
          syncedPost = (next.recruitingPosts ?? []).find((post) => post.id === postId) ?? null;
          syncedNotifications = syncedPost ? getNewRecruitingNotifications(prev, next, postId) : [];
          return next;
        });
        if (syncedPost) syncRecruitingPostServer(syncedPost, syncedNotifications);
      };
      const applyMatchMutation = (matchId, reducer) => {
        let syncedMatch = null;
        let syncedNotifications = [];
        setState((prev) => {
          const next = reducer(prev);
          syncedMatch = (next.matches ?? []).find((match) => match.id === matchId) ?? null;
          syncedNotifications = syncedMatch ? getNewMatchNotifications(prev, next, matchId) : [];
          return next;
        });
        if (syncedMatch) syncMatchServer(syncedMatch, syncedNotifications);
      };
      const applyTeamMutation = (teamId, reducer) => {
        let syncedTeam = null;
        let syncedNotifications = [];
        setState((prev) => {
          const next = reducer(prev);
          syncedTeam = (next.teams ?? []).find((team) => team.id === teamId) ?? null;
          syncedNotifications = syncedTeam ? getNewTeamNotifications(prev, next) : [];
          return next;
        });
        if (syncedTeam) syncTeamServer(syncedTeam, syncedNotifications);
      };

      return ({
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
        let createdMatch = null;
        let syncedNotifications = [];
        setState((prev) => {
          const next = createMatch({ ...prev, currentUserId }, draft);
          createdId = next.matches[0].id;
          createdMatch = next.matches[0] ?? null;
          syncedNotifications = createdMatch ? getNewMatchNotifications(prev, next, createdMatch.id) : [];
          return next;
        });
        if (createdMatch) syncMatchServer(createdMatch, syncedNotifications);
        return createdId;
      },
      createTournament: (draft) => {
        let createdId = null;
        let createdTournament = null;
        let createdMatches = [];
        let syncedNotifications = [];
        setState((prev) => {
          const existingIds = new Set((prev.tournaments ?? []).map((tournament) => tournament.id));
          const existingMatchIds = new Set((prev.matches ?? []).map((match) => match.id));
          const next = createTournament({ ...prev, currentUserId }, draft);
          createdTournament = (next.tournaments ?? []).find((tournament) => !existingIds.has(tournament.id)) ?? null;
          createdId = createdTournament?.id ?? null;
          createdMatches = (next.matches ?? []).filter((match) => !existingMatchIds.has(match.id));
          syncedNotifications = createdTournament ? getNewTournamentNotifications(prev, next) : [];
          return next;
        });
        if (createdTournament) syncTournamentServer(createdTournament, syncedNotifications, { action: "create" });
        createdMatches.forEach((match) => syncMatchServer(match, []));
        return createdId;
      },
      approveTournamentTeam: (tournamentId, teamId) => {
        let syncedTournament = null;
        let createdMatches = [];
        let syncedNotifications = [];
        setState((prev) => {
          const existingMatchIds = new Set((prev.matches ?? []).map((match) => match.id));
          const next = approveTournamentTeam({ ...prev, currentUserId }, tournamentId, teamId);
          syncedTournament = (next.tournaments ?? []).find((tournament) => tournament.id === tournamentId) ?? null;
          createdMatches = (next.matches ?? []).filter((match) => !existingMatchIds.has(match.id));
          syncedNotifications = syncedTournament ? getNewTournamentNotifications(prev, next) : [];
          return next;
        });
        if (syncedTournament) syncTournamentServer(syncedTournament, syncedNotifications, { action: "approveTeam", teamId });
        createdMatches.forEach((match) => syncMatchServer(match, []));
      },
      updateTournamentMatchSchedule: (tournamentId, matchId, schedule) => {
        applyMatchMutation(matchId, (prev) => updateTournamentMatchSchedule({ ...prev, currentUserId }, tournamentId, matchId, schedule));
      },
      agreeMatch: (matchId, sideName, playerId) => applyMatchMutation(matchId, (prev) => agreeMatch({ ...prev, currentUserId }, matchId, sideName, playerId)),
      submitMatchResult: (matchId, result) => applyMatchMutation(matchId, (prev) => submitMatchResult({ ...prev, currentUserId }, matchId, result)),
      handoffMatchRecorder: (matchId, sideName, nextRecorderId) => {
        applyMatchMutation(matchId, (prev) => handoffMatchRecorder({ ...prev, currentUserId }, matchId, sideName, nextRecorderId));
      },
      approveMatch: (matchId, sideName, playerId) => applyMatchMutation(matchId, (prev) => approveMatch({ ...prev, currentUserId }, matchId, sideName, playerId)),
      checkInMatchPlayer: (matchId, sideName, playerId) => applyMatchMutation(matchId, (prev) => checkInMatchPlayer({ ...prev, currentUserId }, matchId, sideName, playerId)),
      requestMatchRefereeAbsence: (matchId) => applyMatchMutation(matchId, (prev) => requestMatchRefereeAbsence({ ...prev, currentUserId }, matchId)),
      confirmMatchRefereeAbsence: (matchId) => applyMatchMutation(matchId, (prev) => confirmMatchRefereeAbsence({ ...prev, currentUserId }, matchId)),
      toggleMatchStar: (matchId, targetUserId) => applyMatchMutation(matchId, (prev) => toggleMatchStar({ ...prev, currentUserId }, matchId, targetUserId)),
      submitMatchThumbs: (matchId, targetUserIds) => applyMatchMutation(matchId, (prev) => submitMatchThumbs({ ...prev, currentUserId }, matchId, targetUserIds)),
      disputeMatch: (matchId, reason) => applyMatchMutation(matchId, (prev) => disputeMatch({ ...prev, currentUserId }, matchId, reason)),
      cancelMatch: (matchId) => applyMatchMutation(matchId, (prev) => cancelMatch({ ...prev, currentUserId }, matchId)),
      voidMatch: (matchId) => applyMatchMutation(matchId, (prev) => voidMatch({ ...prev, currentUserId }, matchId)),
      resumeMatchApproval: (matchId, resultDraft = null) => applyMatchMutation(matchId, (prev) => resumeMatchApproval({ ...prev, currentUserId }, matchId, resultDraft)),
      startMatch: (matchId) => applyMatchMutation(matchId, (prev) => startMatch({ ...prev, currentUserId }, matchId)),
      endMatch: (matchId) => applyMatchMutation(matchId, (prev) => endMatch({ ...prev, currentUserId }, matchId)),
      addMatchLatePlayer: (matchId, draft) => applyMatchMutation(matchId, (prev) => addMatchLatePlayer({ ...prev, currentUserId }, matchId, draft)),
      removeMatchLatePlayer: (matchId, playerId) => applyMatchMutation(matchId, (prev) => removeMatchLatePlayer({ ...prev, currentUserId }, matchId, playerId)),
      updateSettings: (patch) => setState((prev) => updateSettings({ ...prev, currentUserId }, patch)),
      updatePrivacySettings: (patch) => setState((prev) => updatePrivacySettings({ ...prev, currentUserId }, patch)),
      blockUser: (userId) => setState((prev) => blockUser({ ...prev, currentUserId }, userId)),
      unblockUser: (userId) => setState((prev) => unblockUser({ ...prev, currentUserId }, userId)),
      reportMatch: (matchId, reason, reportedUserIds) => {
        let createdReport = null;
        let syncedNotifications = [];
        setState((prev) => {
          const existingIds = new Set((prev.reports ?? []).map((report) => report.id));
          const next = reportMatch({ ...prev, currentUserId }, matchId, reason, reportedUserIds);
          createdReport = (next.reports ?? []).find((report) => !existingIds.has(report.id)) ?? null;
          syncedNotifications = createdReport ? getNewReportNotifications(prev, next, createdReport) : [];
          return next;
        });
        if (createdReport) submitReportServer(createdReport, syncedNotifications);
      },
      reportCourtRequest: (requestId, reason) => {
        setState((prev) => reportCourtRequest({ ...prev, currentUserId }, requestId, reason));
        runServerAction("/api/court-requests/report", { requestId, reason });
      },
      commitAdminReviewAction: (draft) => {
        setState((prev) => commitAdminReviewAction({ ...prev, currentUserId }, draft));
        runServerAction("/api/admin/review-action", draft);
      },
      commitAdminAppointmentAction: (draft) => {
        setState((prev) => commitAdminAppointmentAction({ ...prev, currentUserId }, draft));
        runServerAction("/api/admin/appointment-action", draft);
      },
      approveCourtRequest: (requestId) => {
        setState((prev) => approveCourtRequest({ ...prev, currentUserId }, requestId));
        runServerAction("/api/court-requests/approve", { requestId });
      },
      markNotificationRead: (notificationId) => setState((prev) => markNotificationRead(prev, notificationId)),
      markAllNotificationsRead: () => setState((prev) => markAllNotificationsRead(prev)),
      toggleFavoritePlayer: (userId) => setState((prev) => toggleFavoritePlayer(prev, userId)),
      toggleFavoriteTeam: (teamId) => setState((prev) => toggleFavoriteTeam(prev, teamId)),
      toggleFavoriteCourt: (courtId) => setState((prev) => toggleFavoriteCourt(prev, courtId)),
      submitCourtRequest: (draft) => {
        let createdRequest = null;
        setState((prev) => {
          const existingIds = new Set((prev.settings?.courtRequests ?? []).map((request) => request.id));
          const next = submitCourtRequest({ ...prev, currentUserId }, draft);
          createdRequest = (next.settings?.courtRequests ?? []).find((request) => !existingIds.has(request.id)) ?? null;
          return next;
        });
        if (createdRequest) runServerAction("/api/court-requests/submit", { request: createdRequest });
      },
      submitCourtReview: (matchId, draft) => {
        let submittedReview = null;
        setState((prev) => {
          const next = submitCourtReview({ ...prev, currentUserId }, matchId, draft);
          submittedReview = (next.settings?.courtReviews ?? []).find((review) => review.matchId === matchId && review.reviewerId === currentUserId) ?? null;
          return next;
        });
        if (submittedReview) runServerAction("/api/courts/submit-review", { review: submittedReview });
      },
      startRefereeExamAttempt: (draft) => {
        let createdAttempt = null;
        setState((prev) => {
          const existingIds = new Set((prev.settings?.refereeExamAttempts ?? []).map((attempt) => attempt.id));
          const next = startRefereeExamAttempt({ ...prev, currentUserId }, draft);
          createdAttempt = (next.settings?.refereeExamAttempts ?? []).find((attempt) => !existingIds.has(attempt.id)) ?? null;
          return next;
        });
        if (createdAttempt) syncRefereeServer("startExam", { attempt: createdAttempt });
      },
      finishRefereeExamAttempt: (attemptId, result) => {
        let syncedAttempt = null;
        setState((prev) => {
          const beforeAttempt = (prev.settings?.refereeExamAttempts ?? []).find((attempt) => attempt.id === attemptId);
          const next = finishRefereeExamAttempt({ ...prev, currentUserId }, attemptId, result);
          const nextAttempt = (next.settings?.refereeExamAttempts ?? []).find((attempt) => attempt.id === attemptId) ?? null;
          syncedAttempt = beforeAttempt && nextAttempt !== beforeAttempt ? nextAttempt : null;
          return next;
        });
        if (syncedAttempt) syncRefereeServer("finishExam", { attempt: syncedAttempt });
      },
      submitRefereeRequest: (draft) => {
        let createdRequest = null;
        let syncedNotifications = [];
        setState((prev) => {
          const existingIds = new Set((prev.settings?.refereeRequests ?? []).map((request) => request.id));
          const next = submitRefereeRequest({ ...prev, currentUserId }, draft);
          createdRequest = (next.settings?.refereeRequests ?? []).find((request) => !existingIds.has(request.id)) ?? null;
          syncedNotifications = createdRequest ? getNewRefereeNotifications(prev, next) : [];
          return next;
        });
        if (createdRequest) syncRefereeServer("submitRequest", { request: createdRequest, notifications: syncedNotifications });
      },
      updateProfile: (patch, targetUserId = currentUserId) => {
        const safeTargetUserId = profileLocked ? currentUserId : targetUserId;
        const safePatch = profileLocked ? { ...patch, authUserId } : patch;
        let nextProfile = null;
        setState((prev) => {
          const next = updateProfile({ ...prev, currentUserId }, safePatch, safeTargetUserId);
          nextProfile = next.users.find((user) => user.id === safeTargetUserId) ?? null;
          return next;
        });
        return profileLocked && nextProfile ? persistProfileServer(nextProfile) : Promise.resolve({ ok: true });
      },
      createTeam: (draft) => {
        let createdTeam = null;
        let syncedNotifications = [];
        setState((prev) => {
          const existingIds = new Set((prev.teams ?? []).map((team) => team.id));
          const next = createTeam({ ...prev, currentUserId }, draft);
          createdTeam = (next.teams ?? []).find((team) => !existingIds.has(team.id)) ?? null;
          syncedNotifications = createdTeam ? getNewTeamNotifications(prev, next) : [];
          return next;
        });
        if (createdTeam) syncTeamServer(createdTeam, syncedNotifications);
      },
      deleteTeam: (teamId) => {
        let deleted = false;
        let syncedNotifications = [];
        setState((prev) => {
          const hadTeam = (prev.teams ?? []).some((team) => team.id === teamId);
          const next = deleteTeam({ ...prev, currentUserId }, teamId);
          deleted = hadTeam && !(next.teams ?? []).some((team) => team.id === teamId);
          syncedNotifications = deleted ? getNewTeamNotifications(prev, next) : [];
          return next;
        });
        if (deleted) deleteTeamServer(teamId, syncedNotifications);
      },
      createRecruitingPost: (draft) => {
        let createdPost = null;
        let syncedNotifications = [];
        setState((prev) => {
          const existingIds = new Set((prev.recruitingPosts ?? []).map((post) => post.id));
          const next = createRecruitingPost({ ...prev, currentUserId }, draft);
          createdPost = (next.recruitingPosts ?? []).find((post) => !existingIds.has(post.id)) ?? null;
          syncedNotifications = createdPost ? getNewRecruitingNotifications(prev, next, createdPost.id) : [];
          return next;
        });
        if (createdPost) syncRecruitingPostServer(createdPost, syncedNotifications);
      },
      interestRecruitingPost: (postId, application) => applyRecruitingPostMutation(postId, (prev) => interestRecruitingPost({ ...prev, currentUserId }, postId, application)),
      inviteRecruitingPlayers: (postId, invite) => applyRecruitingPostMutation(postId, (prev) => inviteRecruitingPlayers({ ...prev, currentUserId }, postId, invite)),
      acceptRecruitingInvitation: (postId, invitationId) => applyRecruitingPostMutation(postId, (prev) => acceptRecruitingInvitation({ ...prev, currentUserId }, postId, invitationId)),
      declineRecruitingInvitation: (postId, invitationId) => applyRecruitingPostMutation(postId, (prev) => declineRecruitingInvitation({ ...prev, currentUserId }, postId, invitationId)),
      cancelRecruitingParticipation: (postId) => applyRecruitingPostMutation(postId, (prev) => cancelRecruitingParticipation({ ...prev, currentUserId }, postId)),
      setRecruitingReady: (postId, ready) => applyRecruitingPostMutation(postId, (prev) => setRecruitingReady({ ...prev, currentUserId }, postId, ready)),
      updateRecruitingRoomRules: (postId, patch) => applyRecruitingPostMutation(postId, (prev) => updateRecruitingRoomRules({ ...prev, currentUserId }, postId, patch)),
      updateMatchRoomRules: (matchId, patch) => applyMatchMutation(matchId, (prev) => updateMatchRoomRules({ ...prev, currentUserId }, matchId, patch)),
      setMatchRoomPlayerPlacement: (matchId, playerId, placement) => applyMatchMutation(matchId, (prev) => setMatchRoomPlayerPlacement({ ...prev, currentUserId }, matchId, playerId, placement)),
      removeMatchRoomPlayer: (matchId, playerId) => applyMatchMutation(matchId, (prev) => removeMatchRoomPlayer({ ...prev, currentUserId }, matchId, playerId)),
      sendRecruitingChat: (postId, body) => applyRecruitingPostMutation(postId, (prev) => sendRecruitingChat({ ...prev, currentUserId }, postId, body)),
      setRecruitingApplicantReserve: (postId, playerId, reserve) => {
        applyRecruitingPostMutation(postId, (prev) => setRecruitingApplicantReserve({ ...prev, currentUserId }, postId, playerId, reserve));
      },
      setRecruitingApplicantPlacement: (postId, playerId, placement) => {
        applyRecruitingPostMutation(postId, (prev) => setRecruitingApplicantPlacement({ ...prev, currentUserId: playerId || currentUserId }, postId, playerId, placement));
      },
      joinRecruitingSideParty: (postId, teamId, sideName, entryId) => {
        applyRecruitingPostMutation(postId, (prev) => joinRecruitingSideParty({ ...prev, currentUserId }, postId, teamId, sideName, entryId));
      },
      setRecruitingSlotPosition: (postId, playerId, position) => {
        applyRecruitingPostMutation(postId, (prev) => setRecruitingSlotPosition({ ...prev, currentUserId }, postId, playerId, position));
      },
      setRecruitingPartyPlayerReserve: (postId, entryId, playerId, reserve) => {
        applyRecruitingPostMutation(postId, (prev) => setRecruitingPartyPlayerReserve({ ...prev, currentUserId }, postId, entryId, playerId, reserve));
      },
      setRecruitingPartyPlayerPlacement: (postId, entryId, playerId, placement) => {
        applyRecruitingPostMutation(postId, (prev) => setRecruitingPartyPlayerPlacement({ ...prev, currentUserId }, postId, entryId, playerId, placement));
      },
      detachRecruitingPartyPlayer: (postId, entryId, playerId, placement) => {
        applyRecruitingPostMutation(postId, (prev) => detachRecruitingPartyPlayer({ ...prev, currentUserId: playerId || currentUserId }, postId, entryId, playerId, placement));
      },
      removeRecruitingPartyPlayer: (postId, entryId, playerId) => {
        applyRecruitingPostMutation(postId, (prev) => removeRecruitingPartyPlayer({ ...prev, currentUserId }, postId, entryId, playerId));
      },
      setRecruitingStatRecorder: (postId, sideName, playerId) => {
        applyRecruitingPostMutation(postId, (prev) => setRecruitingStatRecorder({ ...prev, currentUserId }, postId, sideName, playerId));
      },
      kickRecruitingApplicant: (postId, playerId) => applyRecruitingPostMutation(postId, (prev) => kickRecruitingApplicant({ ...prev, currentUserId }, postId, playerId)),
      confirmRecruitingMatch: (postId) => {
        let createdId = null;
        let createdMatch = null;
        let syncedPost = null;
        let syncedNotifications = [];
        let syncedMatchNotifications = [];
        setState((prev) => {
          const existingIds = new Set((prev.matches ?? []).map((match) => match.id));
          const next = confirmRecruitingMatch({ ...prev, currentUserId }, postId);
          createdId = (next.matches ?? []).find((match) => !existingIds.has(match.id))?.id ?? null;
          createdMatch = createdId ? (next.matches ?? []).find((match) => match.id === createdId) ?? null : null;
          syncedPost = (next.recruitingPosts ?? []).find((post) => post.id === postId) ?? null;
          syncedNotifications = syncedPost ? getNewRecruitingNotifications(prev, next, postId) : [];
          syncedMatchNotifications = createdMatch ? getNewMatchNotifications(prev, next, createdMatch.id) : [];
          return next;
        });
        if (syncedPost) syncRecruitingPostServer(syncedPost, syncedNotifications);
        if (createdMatch) syncMatchServer(createdMatch, syncedMatchNotifications);
        return createdId;
      },
      closeRecruitingPost: (postId) => applyRecruitingPostMutation(postId, (prev) => closeRecruitingPost({ ...prev, currentUserId }, postId)),
      addTeamMember: (teamId, draft) => applyTeamMutation(teamId, (prev) => addTeamMember({ ...prev, currentUserId }, teamId, draft)),
      updateTeamMemberRole: (teamId, userId, role) => applyTeamMutation(teamId, (prev) => updateTeamMemberRole({ ...prev, currentUserId }, teamId, userId, role)),
      removeTeamMember: (teamId, userId) => applyTeamMutation(teamId, (prev) => removeTeamMember({ ...prev, currentUserId }, teamId, userId)),
      reset: () => setState(resetState({ includeDemo: !isSupabaseConfigured, authUserId, email: authEmail })),
      });
    },
    [authEmail, authUserId, currentUserId, deleteTeamServer, persistProfileServer, profileKey, profileLocked, runServerAction, submitReportServer, syncMatchServer, syncRecruitingPostServer, syncRefereeServer, syncTeamServer, syncTournamentServer],
  );

  const safeCurrentUserId = currentUserId ?? currentUser?.id ?? "";
  return { state: { ...state, currentUserId: safeCurrentUserId }, currentUser, currentUserId: safeCurrentUserId, profileBound: true, profileLocked, rankings, actions };
}
