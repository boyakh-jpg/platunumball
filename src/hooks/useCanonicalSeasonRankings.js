import { useEffect, useState } from "react";
import { postServerAction } from "../lib/serverActions.js";

export default function useCanonicalSeasonRankings(remoteReady, seasonId) {
  const [retrySequence, setRetrySequence] = useState(0);
  const [state, setState] = useState({ data: null, loading: false, error: "" });

  useEffect(() => {
    if (!remoteReady) {
      setState({ data: null, loading: false, error: "" });
      return undefined;
    }

    let active = true;
    setState((current) => ({ ...current, loading: true, error: "" }));
    postServerAction("/api/season/rankings", { seasonId }, { allowWhenDisabled: true })
      .then((result) => {
        if (active) setState({ data: result, loading: false, error: "" });
      })
      .catch((error) => {
        if (active) setState((current) => ({ ...current, loading: false, error: error.message || "season_rankings_load_failed" }));
      });
    return () => { active = false; };
  }, [remoteReady, retrySequence, seasonId]);

  return { ...state, retry: () => setRetrySequence((current) => current + 1) };
}
