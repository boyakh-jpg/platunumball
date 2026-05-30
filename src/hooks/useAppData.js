import { useEffect, useMemo, useRef, useState } from "react";
import {
  approveMatch,
  createMatch,
  createTeam,
  loadRemoteState,
  loadState,
  resetState,
  saveRemoteState,
  saveState,
  submitMatchResult,
  subscribeRemoteState,
  updateProfile,
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
        console.warn("Supabase hydration failed. Local mock mode remains active.", error.message);
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
      submitMatchResult: (matchId, result) => setState((prev) => submitMatchResult(prev, matchId, result)),
      approveMatch: (matchId, sideName) => setState((prev) => approveMatch(prev, matchId, sideName)),
      updateProfile: (patch) => setState((prev) => updateProfile(prev, patch)),
      createTeam: (draft) => setState((prev) => createTeam(prev, draft)),
      reset: () => setState(resetState()),
    }),
    [],
  );

  return { state, currentUser, rankings, actions };
}
