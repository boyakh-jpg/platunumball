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

function getOAuthCode() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("code") ?? "";
}

function getOAuthCallbackError() {
  if (typeof window === "undefined") return "";
  const search = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return search.get("error_description")
    ?? search.get("error")
    ?? hash.get("error_description")
    ?? hash.get("error")
    ?? "";
}

function formatAuthError(message) {
  if (!message) return "";
  if (message.startsWith("Unable to exchange external code")) {
    return "Google OAuth 설정 오류입니다. Google Cloud Console의 Authorized redirect URI와 Supabase Google Provider의 Client ID/Secret을 확인하세요.";
  }
  return message;
}

function hasOAuthCallbackParams() {
  if (typeof window === "undefined") return false;
  const search = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return search.has("code")
    || search.has("error")
    || search.has("error_description")
    || hash.has("access_token")
    || hash.has("refresh_token")
    || hash.has("error")
    || hash.has("error_description");
}

function cleanOAuthCallbackUrl() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  ["code", "error", "error_description"].forEach((key) => url.searchParams.delete(key));
  if (window.location.hash) url.hash = "";
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

export function useAuthSession() {
  const hasInitialOAuthCallback = hasOAuthCallbackParams();
  const [session, setSession] = useState(() => (isSupabaseConfigured && hasInitialOAuthCallback ? null : readTestSession()));
  const [loading, setLoading] = useState(() => isSupabaseConfigured && (hasInitialOAuthCallback || !readTestSession()));
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setSession(readTestSession());
      setLoading(false);
      return undefined;
    }

    const hasCallback = hasOAuthCallbackParams();
    const callbackError = getOAuthCallbackError();
    const authCode = getOAuthCode();

    if (callbackError) {
      writeTestSession(null);
      cleanOAuthCallbackUrl();
      setError(formatAuthError(callbackError));
      setSession(null);
      setLoading(false);
      return undefined;
    }

    const previewSession = readTestSession();
    if (!hasCallback && previewSession && isDemoLoginAllowed()) {
      setSession(previewSession);
      setLoading(false);
      return undefined;
    }

    writeTestSession(null);

    let mounted = true;
    let resolvingInitialSession = true;
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession ?? null);
      if (!resolvingInitialSession) setLoading(false);
    });

    const loadSession = supabase.auth.getSession();

    loadSession.then(({ data: sessionData, error: sessionError }) => {
      if (!mounted) return;
      resolvingInitialSession = false;
      if (sessionError) setError(formatAuthError(sessionError.message));
      setSession(sessionData.session ?? null);
      if (hasCallback && !authCode) cleanOAuthCallbackUrl();
      setLoading(false);
    }).catch((sessionError) => {
      if (!mounted) return;
      resolvingInitialSession = false;
      setError(formatAuthError(sessionError?.message) || "OAuth 세션 확인에 실패했습니다.");
      setSession(null);
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
          setError(formatAuthError(authError.message));
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
