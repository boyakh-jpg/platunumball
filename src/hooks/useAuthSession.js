import { useEffect, useMemo, useState } from "react";
import { isSupabaseConfigured, supabase } from "../lib/supabase.js";

const TEST_SESSION_KEY = "rankball.auth.testSession.v1";
const PROVIDER_LABELS = { naver: "Naver", kakao: "Kakao", google: "Google" };
const DEMO_LOGIN_ENV = import.meta.env.VITE_DEMO_LOGIN;

function readTestSession() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(TEST_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeTestSession(session) {
  if (typeof window === "undefined") return;
  if (session) window.localStorage.setItem(TEST_SESSION_KEY, JSON.stringify(session));
  else window.localStorage.removeItem(TEST_SESSION_KEY);
}

function makeTestSession(provider) {
  const providerName = PROVIDER_LABELS[provider] ?? provider;
  const user = {
    id: `test-${provider}`,
    email: `${provider}@rankball.test`,
    app_metadata: { provider },
    user_metadata: { providerName },
    aud: "authenticated",
    role: "authenticated",
  };

  return {
    access_token: `test-token-${provider}`,
    token_type: "bearer",
    expires_at: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
    user,
  };
}

function isDemoLoginAllowed() {
  if (DEMO_LOGIN_ENV === "true") return true;
  if (DEMO_LOGIN_ENV === "false") return false;
  if (typeof window === "undefined") return false;

  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1" || host.endsWith("boyakh-jpgs-projects.vercel.app");
}

export function useAuthSession() {
  const [session, setSession] = useState(() => readTestSession());
  const [loading, setLoading] = useState(() => isSupabaseConfigured && !readTestSession());
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setSession(readTestSession());
      setLoading(false);
      return undefined;
    }

    const previewSession = readTestSession();
    if (previewSession && isDemoLoginAllowed()) {
      setSession(previewSession);
      setLoading(false);
      return undefined;
    }

    writeTestSession(null);

    let mounted = true;
    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!mounted) return;
      if (sessionError) setError(sessionError.message);
      setSession(data.session ?? null);
      setLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession ?? null);
      setLoading(false);
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const actions = useMemo(() => ({
    signInWithProvider: async (provider) => {
      setError("");
      setMessage("");
      if (isSupabaseConfigured) {
        const redirectTo = `${window.location.origin}/app`;
        const { error: authError } = await supabase.auth.signInWithOAuth({
          provider,
          options: {
            redirectTo,
          },
        });
        if (authError) {
          setError(authError.message);
          return null;
        }
        return null;
      }

      const nextSession = makeTestSession(provider);
      writeTestSession(nextSession);
      setSession(nextSession);
      return nextSession;
    },
    signOut: async () => {
      setError("");
      setMessage("");
      writeTestSession(null);
      if (isSupabaseConfigured) await supabase.auth.signOut();
      setSession(null);
    },
  }), []);

  return {
    configured: isSupabaseConfigured,
    loading,
    session,
    user: session?.user ?? null,
    message,
    error,
    isAuthenticated: !isSupabaseConfigured || Boolean(session),
    ...actions,
  };
}
