import { useEffect, useMemo, useRef, useState } from "react";
import {
  addTeamMember,
  agreeMatch,
  approveMatch,
  blockUser,
  cancelMatch,
  createMatch,
  createTeam,
  disputeMatch,
  loadRemoteState,
  loadState,
  markAllNotificationsRead,
  markNotificationRead,
  reportMatch,
  resetState,
  resumeMatchApproval,
  saveRemoteState,
  saveState,
  submitMatchResult,
  subscribeRemoteState,
  removeTeamMember,
  switchUser,
  toggleFavoriteCourt,
  toggleFavoriteTeam,
  updateTeamMemberRole,
  updatePrivacySettings,
  updateProfile,
  unblockUser,
  voidMatch,
} from "../data/repository.js";
import { isSupabaseConfigured } from "../lib/supabase.js";

function sortByRating(items, selector) {
  return [...items].sort((a, b) => selector(b) - selector(a));
}

export function useAppData() {
  const [state, setState] = useState(() => loadState());
  const remoteReadyRef = useRef(!isSupabaseConfigured);
  const skipNextRemoteSaveRef = useRef(false);

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
    () => state.users.find((user) => user.id === state.currentUserId) ?? state.users[0],
    [state.currentUserId, state.users],
  );

  const rankings = useMemo(
    () => ({
      players: sortByRating(state.users, (user) => user.ratings.integrated),
      mode: (mode) => sortByRating(state.users, (user) => user.ratings.modes[mode] ?? user.ratings.integrated),
      teams: sortByRating(state.teams, (team) => team.mmr),
      affiliations: sortByRating(state.affiliations, (affiliation) => affiliation.score),
    }),
    [state.affiliations, state.teams, state.users],
  );

  const actions = useMemo(
    () => ({
      createMatch: (draft) => {
        let createdId = null;
        setState((prev) => {
          const next = createMatch(prev, draft);
          createdId = next.matches[0].id;
          return next;
        });
        return createdId;
      },
      agreeMatch: (matchId, sideName, playerId) => setState((prev) => agreeMatch(prev, matchId, sideName, playerId)),
      submitMatchResult: (matchId, result) => setState((prev) => submitMatchResult(prev, matchId, result)),
      approveMatch: (matchId, sideName, playerId) => setState((prev) => approveMatch(prev, matchId, sideName, playerId)),
      disputeMatch: (matchId, reason) => setState((prev) => disputeMatch(prev, matchId, reason)),
      cancelMatch: (matchId) => setState((prev) => cancelMatch(prev, matchId)),
      voidMatch: (matchId) => setState((prev) => voidMatch(prev, matchId)),
      resumeMatchApproval: (matchId) => setState((prev) => resumeMatchApproval(prev, matchId)),
      switchUser: (userId) => setState((prev) => switchUser(prev, userId)),
      updatePrivacySettings: (patch) => setState((prev) => updatePrivacySettings(prev, patch)),
      blockUser: (userId) => setState((prev) => blockUser(prev, userId)),
      unblockUser: (userId) => setState((prev) => unblockUser(prev, userId)),
      reportMatch: (matchId, reason) => setState((prev) => reportMatch(prev, matchId, reason)),
      markNotificationRead: (notificationId) => setState((prev) => markNotificationRead(prev, notificationId)),
      markAllNotificationsRead: () => setState((prev) => markAllNotificationsRead(prev)),
      toggleFavoriteTeam: (teamId) => setState((prev) => toggleFavoriteTeam(prev, teamId)),
      toggleFavoriteCourt: (courtId) => setState((prev) => toggleFavoriteCourt(prev, courtId)),
      updateProfile: (patch) => setState((prev) => updateProfile(prev, patch)),
      createTeam: (draft) => setState((prev) => createTeam(prev, draft)),
      addTeamMember: (teamId, draft) => setState((prev) => addTeamMember(prev, teamId, draft)),
      updateTeamMemberRole: (teamId, userId, role) => setState((prev) => updateTeamMemberRole(prev, teamId, userId, role)),
      removeTeamMember: (teamId, userId) => setState((prev) => removeTeamMember(prev, teamId, userId)),
      reset: () => setState(resetState()),
    }),
    [],
  );

  return { state, currentUser, rankings, actions };
}
