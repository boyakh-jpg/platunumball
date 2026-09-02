import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getTestAccountDisplayLabel, normalizeTestLoginId, TEST_ACCOUNT_COUNT } from "../lib/constants.js";
import {
  getAuthProviderLabel,
  getEnabledAuthProviders,
  getLinkedProviderIds,
} from "../lib/authProviders.js";
import { getOAuthCallbackRedirectUrl, getOAuthCallbackState } from "../lib/authCallback.js";
import {
  clearOriginalAdminSession,
  getOriginalAdminAccount,
  ORIGINAL_ADMIN_ACCOUNT_ID,
  readOriginalAdminSession,
  shouldPreserveOriginalAdminSession,
  writeOriginalAdminSession,
} from "../lib/originalAdminSession.js";
import { getLoginPath, getSafeAppRedirect } from "../lib/profileSetup.js";
import { isSupabaseConfigured, supabase } from "../lib/supabase.js";
import { postServerAction, setClientActionSession } from "../lib/serverActions.js";

const TEST_SESSION_KEY = "rankball.auth.testSession.v1";
const DEMO_LOGIN_ENV = import.meta.env.VITE_DEMO_LOGIN;
const ENABLED_AUTH_PROVIDERS = getEnabledAuthProviders({ configured: isSupabaseConfigured });
const ENABLED_AUTH_PROVIDER_IDS = new Set(ENABLED_AUTH_PROVIDERS.map((provider) => provider.id));

const TEST_ACCOUNTS = Array.from({ length: TEST_ACCOUNT_COUNT }, (_item, index) => {
  const loginId = normalizeTestLoginId(index + 1);
  return { id: loginId, label: getTestAccountDisplayLabel(loginId) };
});

function readTestSession() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(TEST_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    try {
      window.localStorage.removeItem(TEST_SESSION_KEY);
    } catch {
      // Storage can be unavailable in private or embedded browsers.
    }
    return null;
  }
}

function writeTestSession(session) {
  if (typeof window === "undefined") return;
  try {
    if (session) window.localStorage.setItem(TEST_SESSION_KEY, JSON.stringify(session));
    else window.localStorage.removeItem(TEST_SESSION_KEY);
  } catch {
    // Storage can be unavailable in private or embedded browsers; keep the in-memory session usable.
  }
}

function clearSupabaseSessionStorage() {
  const storageKey = supabase?.auth?.storageKey;
  if (typeof window === "undefined" || !storageKey) return;
  try {
    window.localStorage.removeItem(storageKey);
    window.localStorage.removeItem(`${storageKey}-code-verifier`);
  } catch {
    // The in-memory session is still cleared when browser storage is unavailable.
  }
}

// Local demo session only. Server auth uses Supabase Auth JWT.
function makeTestSession(provider) {
  const providerName = getAuthProviderLabel(provider);
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

function isDemoLoginAllowed() {
  if (typeof window === "undefined") return false;

  const host = window.location.hostname;
  const localHost = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (!localHost || DEMO_LOGIN_ENV === "false") return false;
  return import.meta.env.DEV || DEMO_LOGIN_ENV === "true";
}

function formatAuthError(message) {
  if (!message) return "";
  const normalizedMessage = String(message).toLowerCase();
  if (
    normalizedMessage.includes("manual linking")
    && normalizedMessage.includes("disabled")
  ) {
    return "로그인 연결 기능이 아직 설정되지 않았습니다. 관리자에게 문의해 주세요.";
  }
  if (
    normalizedMessage.includes("identity_already_exists")
    || normalizedMessage.includes("already linked")
    || normalizedMessage.includes("already registered")
  ) {
    return "이미 다른 BOXTIER 계정에 연결된 로그인입니다. 기존 계정으로 로그인한 뒤 연결 상태를 확인해 주세요.";
  }
  if (message.startsWith("Unable to exchange external code")) {
    return "소셜 로그인을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  }
  return "로그인 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

export function useAuthSession() {
  const navigate = useNavigate();
  const [session, setSession] = useState(() => (isSupabaseConfigured ? null : readTestSession()));
  const [loading, setLoading] = useState(() => isSupabaseConfigured);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [authActionPending, setAuthActionPending] = useState(false);
  const authActionPendingRef = useRef(false);
  const [testLoginPending, setTestLoginPending] = useState(false);
  const testLoginPendingRef = useRef(false);
  const testLoginGenerationRef = useRef(0);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      const testSession = readTestSession();
      setClientActionSession(testSession);
      setSession(testSession);
      setLoading(false);
      return undefined;
    }

    const callbackState = getOAuthCallbackState(window.location.href);
    const { hasCallback, error: callbackError, code: authCode } = callbackState;

    const finishOAuthCallback = (nextSession) => {
      if (!hasCallback) return;
      if (callbackError && !nextSession && callbackState.pathname !== "/login") {
        navigate(getLoginPath(getSafeAppRedirect(callbackState.cleanedPath), callbackState.cleanedPath), { replace: true });
        return;
      }
      navigate(callbackState.cleanedPath, { replace: true });
    };

    if (callbackError) {
      setError(formatAuthError(callbackError));
    }

    writeTestSession(null);
    setClientActionSession(null);

    let mounted = true;
    let resolvingInitialSession = true;
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setClientActionSession(nextSession);
      setSession(nextSession ?? null);
      if (hasCallback && nextSession) finishOAuthCallback(nextSession);
      if (!resolvingInitialSession) setLoading(false);
    });

    const loadSession = supabase.auth.getSession();

    loadSession.then(({ data: sessionData, error: sessionError }) => {
      if (!mounted) return;
      resolvingInitialSession = false;
      if (sessionError) setError(formatAuthError(sessionError.message));
      setClientActionSession(sessionData.session);
      setSession(sessionData.session ?? null);
      if (hasCallback && (sessionData.session || !authCode)) finishOAuthCallback(sessionData.session);
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
  }, [navigate]);

  const actions = useMemo(() => ({
    signInWithProvider: async (provider, redirectPath = "/app") => {
      if (!ENABLED_AUTH_PROVIDER_IDS.has(provider)) {
        setError("현재 사용할 수 없는 로그인 방식입니다.");
        return null;
      }
      if (authActionPendingRef.current) return null;
      authActionPendingRef.current = true;
      setAuthActionPending(true);
      testLoginGenerationRef.current += 1;
      testLoginPendingRef.current = false;
      setTestLoginPending(false);
      setError("");
      setMessage("");
      try {
        if (isSupabaseConfigured) {
          clearOriginalAdminSession();
          const redirectTo = getOAuthCallbackRedirectUrl(
            window.location.origin,
            getSafeAppRedirect(redirectPath),
          );
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
      } catch (authError) {
        setError(formatAuthError(authError?.message) || "로그인하지 못했습니다. 다시 시도해 주세요.");
        return null;
      } finally {
        authActionPendingRef.current = false;
        setAuthActionPending(false);
      }
    },
    signOut: async () => {
      if (authActionPendingRef.current) return false;
      authActionPendingRef.current = true;
      setAuthActionPending(true);
      testLoginGenerationRef.current += 1;
      testLoginPendingRef.current = false;
      setTestLoginPending(false);
      setError("");
      setMessage("");
      try {
        let localSignOutRequired = false;
        if (isSupabaseConfigured) {
          const { error: signOutError } = await supabase.auth.signOut().catch(() => ({ error: true }));
          localSignOutRequired = Boolean(signOutError);
        }
        if (localSignOutRequired) clearSupabaseSessionStorage();
        clearOriginalAdminSession();
        writeTestSession(null);
        setClientActionSession(null);
        setSession(null);
        setLoading(false);
        return true;
      } finally {
        authActionPendingRef.current = false;
        setAuthActionPending(false);
      }
    },
    linkIdentityWithProvider: async (provider, redirectPath = "/app/settings?section=main") => {
      if (!isSupabaseConfigured || !ENABLED_AUTH_PROVIDER_IDS.has(provider)) {
        setError("현재 연결할 수 없는 로그인 방식입니다.");
        return { ok: false, error: "auth_provider_unavailable" };
      }
      if (authActionPendingRef.current) return { ok: false, error: "auth_action_pending" };
      authActionPendingRef.current = true;
      setAuthActionPending(true);
      setError("");
      setMessage("");
      try {
        const redirectTo = getOAuthCallbackRedirectUrl(
          window.location.origin,
          getSafeAppRedirect(redirectPath),
        );
        const { data: linkData, error: linkError } = await supabase.auth.linkIdentity({
          provider,
          options: { redirectTo },
        });
        if (linkError) {
          const errorCode = linkError.code || linkError.message || "identity_link_failed";
          const errorMessage = formatAuthError(errorCode);
          setError(errorMessage);
          return { ok: false, error: errorCode, message: errorMessage };
        }
        return { ok: true, data: linkData };
      } catch (linkError) {
        const errorCode = linkError?.code || linkError?.message || "identity_link_failed";
        const errorMessage = formatAuthError(errorCode);
        setError(errorMessage);
        return { ok: false, error: errorCode, message: errorMessage };
      } finally {
        authActionPendingRef.current = false;
        setAuthActionPending(false);
      }
    },
    releaseOnboardingIdentity: async (confirmation) => {
      if (authActionPendingRef.current) return { ok: false, error: "auth_action_pending" };
      authActionPendingRef.current = true;
      setAuthActionPending(true);
      setError("");
      setMessage("");
      try {
        const result = await postServerAction(
          "/api/profile/release-onboarding-identity",
          { confirmation },
          { allowWhenDisabled: true },
        );
        clearOriginalAdminSession();
        clearSupabaseSessionStorage();
        writeTestSession(null);
        setClientActionSession(null);
        setSession(null);
        setLoading(false);
        return result;
      } catch (releaseError) {
        const errorCode = releaseError?.code
          || releaseError?.message
          || "identity_release_failed";
        const errorMessage = formatAuthError(errorCode);
        setError(errorMessage);
        return { ok: false, error: errorCode, message: errorMessage };
      } finally {
        authActionPendingRef.current = false;
        setAuthActionPending(false);
      }
    },
    withdrawAccount: async (confirmation) => {
      if (authActionPendingRef.current) return { ok: false, error: "auth_action_pending" };
      authActionPendingRef.current = true;
      setAuthActionPending(true);
      setError("");
      setMessage("");
      try {
        const result = await postServerAction(
          "/api/profile/withdraw",
          { confirmation },
          { allowWhenDisabled: true },
        );
        clearOriginalAdminSession();
        clearSupabaseSessionStorage();
        writeTestSession(null);
        setClientActionSession(null);
        setSession(null);
        setLoading(false);
        return result;
      } catch (withdrawalError) {
        return { ok: false, error: withdrawalError?.code || withdrawalError?.message || "account_withdrawal_failed" };
      } finally {
        authActionPendingRef.current = false;
        setAuthActionPending(false);
      }
    },
    signInWithTestAccount: async (testLoginId, options = {}) => {
      if (testLoginPendingRef.current || authActionPendingRef.current) return null;

      const loginGeneration = testLoginGenerationRef.current + 1;
      testLoginGenerationRef.current = loginGeneration;
      testLoginPendingRef.current = true;
      setTestLoginPending(true);

      try {
        setError("");
        setMessage("");
        const settingsSwitch = options.settingsSwitch === true;
        if (!settingsSwitch && !isDemoLoginAllowed()) {
          setError("현재 환경에서는 테스트 계정 로그인을 사용할 수 없습니다.");
          return null;
        }
        const normalizedLoginId = normalizeTestLoginId(testLoginId);
        if (isSupabaseConfigured) {
          let alphaStatus = 0;
          const alphaPayload = settingsSwitch
            ? await postServerAction(
                "/api/auth/alpha-test-login",
                { testLoginId: normalizedLoginId, settingsSwitch: true },
                { allowWhenDisabled: true },
              ).catch((requestError) => {
                alphaStatus = Number(requestError?.statusCode ?? 0);
                return null;
              })
            : await fetch("/api/auth/alpha-test-login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ testLoginId: normalizedLoginId }),
              }).then(async (response) => {
                alphaStatus = response.status;
                return response.ok ? response.json().catch(() => null) : null;
              }).catch(() => null);
          if (loginGeneration !== testLoginGenerationRef.current) return null;
          if (!alphaPayload?.tokenHash) {
            setError(alphaStatus === 429
              ? "요청이 많습니다. 잠시 후 다시 시도해 주세요."
              : "선택한 테스트 계정으로 로그인하지 못했습니다.");
            return null;
          }
          if (alphaPayload.allowOriginalAdminReturn === true) {
            const { data: currentAuthData, error: currentAuthError } = await supabase.auth.getSession()
              .catch((currentAuthError) => ({ data: null, error: currentAuthError }));
            const currentAuthSession = currentAuthData?.session;
            const storedOriginalSession = readOriginalAdminSession();
            const preserveStoredOriginal = shouldPreserveOriginalAdminSession(
              storedOriginalSession,
              currentAuthSession,
            );
            if (
              currentAuthError
              || !currentAuthSession
              || (!preserveStoredOriginal && !writeOriginalAdminSession(currentAuthSession))
            ) {
              setError("관리자 원계정 복귀 정보를 보관하지 못했습니다. 다시 시도해 주세요.");
              return null;
            }
          }
          const { data: testAuthData, error: testAuthError } = await supabase.auth.verifyOtp({
            token_hash: alphaPayload.tokenHash,
            type: "magiclink",
          }).catch((testAuthError) => ({ data: null, error: testAuthError }));
          if (loginGeneration !== testLoginGenerationRef.current) return null;
          if (!testAuthData?.session || testAuthError) {
            setError("선택한 테스트 계정으로 로그인하지 못했습니다.");
            return null;
          }
          writeTestSession(null);
          setClientActionSession(testAuthData.session);
          setSession(testAuthData.session);
          return testAuthData.session;
        }
        const nextSession = makeLocalTestSession(normalizedLoginId);
        if (loginGeneration !== testLoginGenerationRef.current) return null;
        writeTestSession(nextSession);
        setClientActionSession(nextSession);
        setSession(nextSession);
        return nextSession;
      } finally {
        if (loginGeneration === testLoginGenerationRef.current) {
          testLoginPendingRef.current = false;
          setTestLoginPending(false);
        }
      }
    },
    restoreOriginalAdminSession: async () => {
      if (testLoginPendingRef.current || authActionPendingRef.current || !isSupabaseConfigured) return null;
      const storedSession = readOriginalAdminSession();
      if (!storedSession) {
        setError("관리자 원계정 복귀 정보를 찾지 못했습니다.");
        return null;
      }

      const loginGeneration = testLoginGenerationRef.current + 1;
      testLoginGenerationRef.current = loginGeneration;
      testLoginPendingRef.current = true;
      setTestLoginPending(true);
      setError("");
      setMessage("");
      try {
        const { data: restoredAuthData, error: restoreError } = await supabase.auth.setSession({
          access_token: storedSession.accessToken,
          refresh_token: storedSession.refreshToken,
        }).catch((restoreError) => ({ data: null, error: restoreError }));
        const restoredSession = restoredAuthData?.session;
        const restoredWrongUser = Boolean(
          restoredSession
          && restoredSession.user?.id !== storedSession.userId,
        );
        if (
          loginGeneration !== testLoginGenerationRef.current
          || restoreError
          || !restoredSession
          || restoredWrongUser
        ) {
          if (restoredWrongUser) {
            clearOriginalAdminSession();
            await supabase.auth.signOut().catch(() => null);
            clearSupabaseSessionStorage();
            writeTestSession(null);
            setClientActionSession(null);
            setSession(null);
          }
          setError("관리자 원계정으로 복귀하지 못했습니다. 다시 로그인해 주세요.");
          return null;
        }
        clearOriginalAdminSession();
        writeTestSession(null);
        setClientActionSession(restoredSession);
        setSession(restoredSession);
        return restoredSession;
      } finally {
        if (loginGeneration === testLoginGenerationRef.current) {
          testLoginPendingRef.current = false;
          setTestLoginPending(false);
        }
      }
    },
  }), []);

  return {
    configured: isSupabaseConfigured,
    enabledProviders: ENABLED_AUTH_PROVIDERS,
    linkedProviderIds: getLinkedProviderIds(session?.user),
    authActionPending,
    originalAdminAccount: getOriginalAdminAccount(),
    testAccounts: TEST_ACCOUNTS,
    testLoginAllowed: isDemoLoginAllowed(),
    testLoginPending,
    loading,
    session,
    user: session?.user ?? null,
    message,
    error,
    isAuthenticated: !isSupabaseConfigured || Boolean(session),
    ...actions,
    switchTestAccount: (testLoginId) => (
      testLoginId === ORIGINAL_ADMIN_ACCOUNT_ID
        ? actions.restoreOriginalAdminSession()
        : actions.signInWithTestAccount(testLoginId, { settingsSwitch: true })
    ),
  };
}
