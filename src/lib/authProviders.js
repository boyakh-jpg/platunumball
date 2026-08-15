export const AUTH_PROVIDERS = Object.freeze({
  google: Object.freeze({ id: "google", label: "Google", mark: "G" }),
  kakao: Object.freeze({ id: "kakao", label: "Kakao", mark: "K" }),
  naver: Object.freeze({ id: "naver", label: "Naver", mark: "N" }),
});

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

export function getAuthProviderLabel(providerId) {
  return AUTH_PROVIDERS[providerId]?.label ?? providerId;
}
