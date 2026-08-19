export const AUTH_PROVIDERS = Object.freeze({
  google: Object.freeze({ id: "google", label: "Google", mark: "G" }),
  kakao: Object.freeze({ id: "kakao", label: "Kakao", mark: "K" }),
  naver: Object.freeze({ id: "naver", label: "Naver", mark: "N" }),
});

const RECOVERABLE_PROVIDER_IDS = new Set(["google", "kakao"]);

const PROVIDER_PROFILE_NAME_KEYS = Object.freeze([
  "nickname",
  "preferred_username",
  "name",
  "full_name",
  "user_name",
]);

function getKakaoAuthFlag() {
  if (typeof import.meta.env !== "object") return "";
  return import.meta.env.VITE_KAKAO_AUTH_ENABLED;
}

export function isKakaoAuthEnabled(value = getKakaoAuthFlag()) {
  return String(value ?? "").trim().toLowerCase() === "true";
}

export function getEnabledAuthProviders({
  configured = true,
  kakaoEnabled = isKakaoAuthEnabled(),
} = {}) {
  if (!configured) {
    return [AUTH_PROVIDERS.naver, AUTH_PROVIDERS.kakao, AUTH_PROVIDERS.google];
  }

  return [
    AUTH_PROVIDERS.google,
    ...(kakaoEnabled ? [AUTH_PROVIDERS.kakao] : []),
  ];
}

export function getLinkedProviderIds(user = {}) {
  const providerIds = [
    ...(user.identities ?? []).map((identity) => identity?.provider),
    ...(user.app_metadata?.providers ?? []),
    user.app_metadata?.provider,
  ];

  return [...new Set(providerIds)]
    .filter((providerId) => Object.hasOwn(AUTH_PROVIDERS, providerId));
}

export function getAuthProviderProfileName(user = {}) {
  const sources = [
    ...(Array.isArray(user.identities)
      ? user.identities.map((identity) => identity?.identity_data)
      : []),
    user.user_metadata,
  ];

  for (const source of sources) {
    for (const key of PROVIDER_PROFILE_NAME_KEYS) {
      const value = typeof source?.[key] === "string" ? source[key].trim() : "";
      if (value) return value;
    }
  }

  return "";
}

export function isKakaoTalkInAppBrowser(
  userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "",
) {
  return /KAKAOTALK/i.test(String(userAgent ?? ""));
}

export function getSingleRecoverableProviderId(user = {}) {
  const identities = Array.isArray(user.identities)
    ? user.identities.filter(Boolean)
    : [];
  if (identities.length !== 1) return "";

  const providerId = identities[0]?.provider;
  return RECOVERABLE_PROVIDER_IDS.has(providerId) ? providerId : "";
}

export function getAccountRecoveryLoginPath(providerId) {
  if (!RECOVERABLE_PROVIDER_IDS.has(providerId)) return "/login";

  const encodedProviderId = encodeURIComponent(providerId);
  const returnTo = `/app/settings?section=main&connectProvider=${encodedProviderId}&autoConnect=1`;
  return `/login?recoverAccount=1&excludeProvider=${encodedProviderId}&redirect=${encodeURIComponent(returnTo)}`;
}

export function getAccountRecoveryConnectionRequest(search = "") {
  const searchParams = new URLSearchParams(search);
  const providerId = searchParams.get("connectProvider") ?? "";
  return {
    providerId: RECOVERABLE_PROVIDER_IDS.has(providerId) ? providerId : "",
    autoConnect: searchParams.get("autoConnect") === "1",
  };
}

export function getAuthProviderLabel(providerId) {
  return AUTH_PROVIDERS[providerId]?.label ?? providerId;
}
