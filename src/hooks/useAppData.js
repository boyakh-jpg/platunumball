import { useEffect, useMemo, useRef, useState } from "react";
import {
  addTeamMember,
  agreeMatch,
  approveTournamentTeam,
  approveMatch,
  blockUser,
  cancelMatch,
  cancelRecruitingParticipation,
  closeRecruitingPost,
  confirmRecruitingMatch,
  createMatch,
  createRecruitingPost,
  createTeam,
  createTournament,
  deleteTeam,
  disputeMatch,
  interestRecruitingPost,
  kickRecruitingApplicant,
  loadRemoteState,
  loadState,
  markAllNotificationsRead,
  markNotificationRead,
  reportMatch,
  resetState,
  resumeMatchApproval,
  saveRemoteState,
  saveState,
  sendRecruitingChat,
  setRecruitingApplicantPlacement,
  setRecruitingApplicantReserve,
  setRecruitingPartyPlayerReserve,
  setRecruitingReady,
  setRecruitingStatRecorder,
  submitMatchResult,
  subscribeRemoteState,
  removeTeamMember,
  toggleFavoriteCourt,
  toggleFavoriteTeam,
  toggleMatchStar,
  updateSettings,
  updateTeamMemberRole,
  updateTournamentMatchSchedule,
  updatePrivacySettings,
  updateProfile,
  unblockUser,
  voidMatch,
} from "../data/repository.js";
import { isSupabaseConfigured } from "../lib/supabase.js";
import { readProfileBindings, writeProfileBindings } from "../lib/storage.js";

function sortByRating(items, selector) {
  return [...items].sort((a, b) => selector(b) - selector(a));
}

export function useAppData(authUserId = null) {
  const [state, setState] = useState(() => loadState());
  const [profileBindings, setProfileBindings] = useState(() => readProfileBindings());
  const remoteReadyRef = useRef(!isSupabaseConfigured);
  const skipNextRemoteSaveRef = useRef(false);
  const profileKey = authUserId ?? "local-demo";
  const currentUserId = profileBindings[profileKey] ?? state.currentUserId ?? state.users[0]?.id;

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
    if (!isSupabaseConfigured) return undefined;

    let mounted = true;
    loadRemoteState()
      .then((remoteState) => {
        if (!mounted) return;
        if (remoteState) {
          skipNextRemoteSaveRef.current = true;
          setState(remoteState);
        }
        remoteReadyRef.current = true;
      })
      .catch((error) => {
        console.warn("Supabase hydration failed. Local demo mode remains active.", error.message);
        remoteReadyRef.current = true;
      });

    const unsubscribe = subscribeRemoteState((remoteState) => {
      skipNextRemoteSaveRef.current = true;
      setState(remoteState);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const currentUser = useMemo(
    () => state.users.find((user) => user.id === currentUserId) ?? state.users[0],
    [currentUserId, state.users],
  );

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
        setProfileBindings((current) => {
          const next = { ...current, [profileKey]: userId };
          writeProfileBindings(next);
          return next;
        });
        setState((prev) => ({ ...prev, currentUserId: userId }));
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
      approveMatch: (matchId, sideName, playerId) => setState((prev) => approveMatch({ ...prev, currentUserId }, matchId, sideName, playerId)),
      toggleMatchStar: (matchId, targetUserId) => setState((prev) => toggleMatchStar({ ...prev, currentUserId }, matchId, targetUserId)),
      disputeMatch: (matchId, reason) => setState((prev) => disputeMatch({ ...prev, currentUserId }, matchId, reason)),
      cancelMatch: (matchId) => setState((prev) => cancelMatch({ ...prev, currentUserId }, matchId)),
      voidMatch: (matchId) => setState((prev) => voidMatch({ ...prev, currentUserId }, matchId)),
      resumeMatchApproval: (matchId) => setState((prev) => resumeMatchApproval({ ...prev, currentUserId }, matchId)),
      updateSettings: (patch) => setState((prev) => updateSettings({ ...prev, currentUserId }, patch)),
      updatePrivacySettings: (patch) => setState((prev) => updatePrivacySettings({ ...prev, currentUserId }, patch)),
      blockUser: (userId) => setState((prev) => blockUser({ ...prev, currentUserId }, userId)),
      unblockUser: (userId) => setState((prev) => unblockUser({ ...prev, currentUserId }, userId)),
      reportMatch: (matchId, reason) => setState((prev) => reportMatch({ ...prev, currentUserId }, matchId, reason)),
      markNotificationRead: (notificationId) => setState((prev) => markNotificationRead(prev, notificationId)),
      markAllNotificationsRead: () => setState((prev) => markAllNotificationsRead(prev)),
      toggleFavoriteTeam: (teamId) => setState((prev) => toggleFavoriteTeam(prev, teamId)),
      toggleFavoriteCourt: (courtId) => setState((prev) => toggleFavoriteCourt(prev, courtId)),
      updateProfile: (patch) => setState((prev) => updateProfile({ ...prev, currentUserId }, patch)),
      createTeam: (draft) => setState((prev) => createTeam({ ...prev, currentUserId }, draft)),
      deleteTeam: (teamId) => setState((prev) => deleteTeam({ ...prev, currentUserId }, teamId)),
      createRecruitingPost: (draft) => setState((prev) => createRecruitingPost({ ...prev, currentUserId }, draft)),
      interestRecruitingPost: (postId, application) => setState((prev) => interestRecruitingPost({ ...prev, currentUserId }, postId, application)),
      cancelRecruitingParticipation: (postId) => setState((prev) => cancelRecruitingParticipation({ ...prev, currentUserId }, postId)),
      setRecruitingReady: (postId, ready) => setState((prev) => setRecruitingReady({ ...prev, currentUserId }, postId, ready)),
      sendRecruitingChat: (postId, body) => setState((prev) => sendRecruitingChat({ ...prev, currentUserId }, postId, body)),
      setRecruitingApplicantReserve: (postId, playerId, reserve) => {
        setState((prev) => setRecruitingApplicantReserve({ ...prev, currentUserId }, postId, playerId, reserve));
      },
      setRecruitingApplicantPlacement: (postId, playerId, placement) => {
        setState((prev) => setRecruitingApplicantPlacement({ ...prev, currentUserId }, postId, playerId, placement));
      },
      setRecruitingPartyPlayerReserve: (postId, entryId, playerId, reserve) => {
        setState((prev) => setRecruitingPartyPlayerReserve({ ...prev, currentUserId }, postId, entryId, playerId, reserve));
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
    [currentUserId, profileKey],
  );

  return { state: { ...state, currentUserId }, currentUser, currentUserId, profileBound: true, rankings, actions };
}
