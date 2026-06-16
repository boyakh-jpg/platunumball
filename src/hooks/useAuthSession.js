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

async function readOAuthStartError(response, provider) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  const message = payload?.msg ?? payload?.message ?? payload?.error_description ?? "";
  if (payload?.error_code === "validation_failed" && message.toLowerCase().includes("provider is not enabled")) {
    const providerName = PROVIDER_LABELS[provider] ?? provider;
    return {
      providerDisabled: true,
      message: `Supabase에서 ${providerName} OAuth provider가 꺼져 있습니다. Authentication > Providers에서 ${providerName}을 켜고 Client ID/Secret을 넣어야 합니다.`,
    };
  }
  return {
    providerDisabled: false,
    message: message || `OAuth 시작 실패 (${response.status})`,
  };
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
        const enterPreviewSession = () => {
          const nextSession = makeTestSession(provider);
          writeTestSession(nextSession);
          setSession(nextSession);
          setMessage("OAuth 설정 전이라 preview/dev 로그인으로 임시 입장했습니다.");
          return nextSession;
        };
        const { data, error: authError } = await supabase.auth.signInWithOAuth({
          provider,
          options: {
            redirectTo,
            skipBrowserRedirect: true,
          },
        });
        if (authError) {
          setError(authError.message);
          return null;
        }
        if (!data?.url) {
          setError("OAuth 시작 URL을 만들지 못했습니다.");
          return null;
        }

        try {
          const response = await fetch(data.url, { redirect: "manual" });
          if (response.status === 0) {
            if (isDemoLoginAllowed()) return enterPreviewSession();
            window.location.assign(data.url);
            return null;
          }
          if (!response.ok) {
            const startError = await readOAuthStartError(response, provider);
            if (startError.providerDisabled && isDemoLoginAllowed()) {
              return enterPreviewSession();
            }
            setError(startError.message);
            return null;
          }
          const payload = await response.json().catch(() => null);
          const nextUrl = payload?.url;
          if (!nextUrl) {
            setError("OAuth 제공자 이동 URL을 받지 못했습니다.");
            return null;
          }
          window.location.assign(nextUrl);
        } catch {
          if (isDemoLoginAllowed()) return enterPreviewSession();
          setError("OAuth 설정 확인에 실패했습니다. Supabase Auth provider와 Redirect URL을 확인하세요.");
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
