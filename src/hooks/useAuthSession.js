import { useEffect, useMemo, useState } from "react";
import { normalizeTestLoginId, TEST_ACCOUNT_COUNT } from "../lib/constants.js";
import { getSafeAppRedirect } from "../lib/profileSetup.js";
import { isSupabaseConfigured, supabase } from "../lib/supabase.js";
import { setClientActionSession } from "../lib/serverActions.js";

const TEST_SESSION_KEY = "rankball.auth.testSession.v1";
const PROVIDER_LABELS = { naver: "Naver", kakao: "Kakao", google: "Google" };
const DEMO_LOGIN_ENV = import.meta.env.VITE_DEMO_LOGIN;
const TEST_AUTH_EMAIL_DOMAIN = import.meta.env.VITE_TEST_AUTH_EMAIL_DOMAIN || "rankball.test";
const TEST_AUTH_PASSWORD = import.meta.env.VITE_TEST_AUTH_PASSWORD || "test-0000";

const TEST_ACCOUNTS = Array.from({ length: TEST_ACCOUNT_COUNT }, (_item, index) => {
  const loginId = normalizeTestLoginId(index + 1);
  return { id: loginId, label: loginId };
});

function readTestSession() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(TEST_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    window.localStorage.removeItem(TEST_SESSION_KEY);
    return null;
  }
}

function writeTestSession(session) {
  if (typeof window === "undefined") return;
  if (session) window.localStorage.setItem(TEST_SESSION_KEY, JSON.stringify(session));
  else window.localStorage.removeItem(TEST_SESSION_KEY);
}

// RANKBALL_AUTH_CLEANUP: local demo session only. Server auth must use Supabase Auth JWT.
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
    access_token: `local-demo-${provider}`,
    token_type: "bearer",
    expires_at: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
    user,
  };
}

function makeLocalTestSession(testLoginId) {
  const normalizedLoginId = normalizeTestLoginId(testLoginId);
  const providerName = `${normalizedLoginId} test`;
  const user = {
    id: `test-${normalizedLoginId}`,
    email: `${normalizedLoginId}@rankball.test`,
    app_metadata: { provider: "test" },
    user_metadata: { providerName, testLoginId: normalizedLoginId },
    aud: "authenticated",
    role: "authenticated",
  };

  return {
    access_token: `local-demo-test-${normalizedLoginId}`,
    token_type: "bearer",
    expires_at: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
    user,
  };
}

function getTestAuthEmail(testLoginId) {
  return `${normalizeTestLoginId(testLoginId)}@${TEST_AUTH_EMAIL_DOMAIN}`;
}

function isDemoLoginAllowed() {
  if (DEMO_LOGIN_ENV === "true") return true;
  if (DEMO_LOGIN_ENV === "false") return false;
  if (typeof window === "undefined") return false;

  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1";
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
  const [session, setSession] = useState(() => (isSupabaseConfigured ? null : readTestSession()));
  const [loading, setLoading] = useState(() => isSupabaseConfigured);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isSupabaseConfigured) {
      const testSession = readTestSession();
      setClientActionSession(testSession);
      setSession(testSession);
      setLoading(false);
      return undefined;
    }

    const hasCallback = hasOAuthCallbackParams();
    const callbackError = getOAuthCallbackError();
    const authCode = getOAuthCode();

    if (callbackError) {
      writeTestSession(null);
      setClientActionSession(null);
      cleanOAuthCallbackUrl();
      setError(formatAuthError(callbackError));
      setSession(null);
      setLoading(false);
      return undefined;
    }

    writeTestSession(null);
    setClientActionSession(null);

    let mounted = true;
    let resolvingInitialSession = true;
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setClientActionSession(nextSession);
      setSession(nextSession ?? null);
      if (!resolvingInitialSession) setLoading(false);
    });

    const loadSession = supabase.auth.getSession();

    loadSession.then(({ data: sessionData, error: sessionError }) => {
      if (!mounted) return;
      resolvingInitialSession = false;
      if (sessionError) setError(formatAuthError(sessionError.message));
      setClientActionSession(sessionData.session);
      setSession(sessionData.session ?? null);
      if (hasCallback && !authCode) cleanOAuthCallbackUrl();
      setLoading(false);
    }).catch((sessionError) => {
      if (!mounted) return;
      resolvingInitialSession = false;
      setClientActionSession(null);
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
    signInWithProvider: async (provider, redirectPath = "/app") => {
      setError("");
      setMessage("");
      if (isSupabaseConfigured) {
        const redirectTo = `${window.location.origin}${getSafeAppRedirect(redirectPath)}`;
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
      setClientActionSession(nextSession);
      setSession(nextSession);
      return nextSession;
    },
    signOut: async () => {
      setError("");
      setMessage("");
      writeTestSession(null);
      setClientActionSession(null);
      setSession(null);
      setLoading(false);
      if (isSupabaseConfigured) {
        const { error: signOutError } = await supabase.auth.signOut();
        if (signOutError) setError(formatAuthError(signOutError.message));
      }
    },
    signInWithTestAccount: async (testLoginId) => {
      setError("");
      setMessage("");
      if (!isDemoLoginAllowed()) {
        setError("테스트 계정 로그인은 VITE_DEMO_LOGIN=true 또는 로컬/프리뷰에서만 허용됩니다.");
        return null;
      }
      const normalizedLoginId = normalizeTestLoginId(testLoginId);
      if (isSupabaseConfigured) {
        setSession(null);
        writeTestSession(null);
        setClientActionSession(null);
        const { data: testAuthData, error: testAuthError } = await supabase.auth.signInWithPassword({
          email: getTestAuthEmail(normalizedLoginId),
          password: TEST_AUTH_PASSWORD,
        }).catch((testAuthError) => ({ data: null, error: testAuthError }));
        if (testAuthData?.session && !testAuthError) {
          setClientActionSession(testAuthData.session);
          setSession(testAuthData.session);
          return testAuthData.session;
        }
        const { error: signOutError } = await supabase.auth.signOut().catch((signOutError) => ({ error: signOutError }));
        if (signOutError) console.warn("Supabase sign-out before test login failed.", signOutError.message);
        setError(formatAuthError(testAuthError?.message) || "테스트 Auth 계정이 없습니다. seed auth-only 실행이 필요합니다.");
        return null;
      }
      const nextSession = makeLocalTestSession(normalizedLoginId);
      writeTestSession(nextSession);
      setClientActionSession(nextSession);
      setSession(nextSession);
      return nextSession;
    },
  }), []);

  return {
    configured: isSupabaseConfigured,
    testAccounts: TEST_ACCOUNTS,
    testLoginAllowed: isDemoLoginAllowed(),
    loading,
    session,
    user: session?.user ?? null,
    message,
    error,
    isAuthenticated: !isSupabaseConfigured || Boolean(session),
    ...actions,
  };
}
