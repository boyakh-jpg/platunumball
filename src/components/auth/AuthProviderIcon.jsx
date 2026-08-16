export default function AuthProviderIcon({ providerId = "", className = "" }) {
  const normalizedProviderId = String(providerId).toLowerCase();
  const classes = ["auth-provider-icon", `auth-provider-icon-${normalizedProviderId}`, className]
    .filter(Boolean)
    .join(" ");

  if (normalizedProviderId === "google") {
    return (
      <span className={classes} aria-hidden="true">
        <svg viewBox="0 0 24 24" role="img">
          <path fill="#4285f4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.04H12v3.86h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.35Z" />
          <path fill="#34a853" d="M12 22c2.7 0 4.98-.9 6.63-2.42l-3.24-2.51c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.59A10 10 0 0 0 12 22Z" />
          <path fill="#fbbc05" d="M6.39 13.9A6.02 6.02 0 0 1 6.08 12c0-.66.11-1.3.31-1.9V7.51H3.04A10 10 0 0 0 2 12c0 1.61.38 3.14 1.04 4.49l3.35-2.59Z" />
          <path fill="#ea4335" d="M12 5.97c1.47 0 2.79.5 3.83 1.5l2.87-2.88A9.64 9.64 0 0 0 12 2a10 10 0 0 0-8.96 5.51l3.35 2.59C7.18 7.73 9.39 5.97 12 5.97Z" />
        </svg>
      </span>
    );
  }

  if (normalizedProviderId === "kakao") {
    return (
      <span className={classes} aria-hidden="true">
        <svg viewBox="0 0 24 24" role="img">
          <rect width="24" height="24" rx="6" fill="#fee500" />
          <path fill="#191919" d="M12 5.2c-4.04 0-7.32 2.55-7.32 5.7 0 2.03 1.38 3.81 3.45 4.82l-.88 3.24a.35.35 0 0 0 .54.37l3.85-2.56h.36c4.04 0 7.32-2.55 7.32-5.87S16.04 5.2 12 5.2Z" />
        </svg>
      </span>
    );
  }

  if (normalizedProviderId === "naver") {
    return (
      <span className={classes} aria-hidden="true">
        <svg viewBox="0 0 24 24" role="img">
          <rect width="24" height="24" rx="5" fill="#03c75a" />
          <path fill="#fff" d="M7 6.5h4.05l5.95 8.37V6.5h4v11H16.9l-5.9-8.3v8.3H7v-11Z" transform="translate(-2)" />
        </svg>
      </span>
    );
  }

  return (
    <span className={classes} aria-hidden="true">
      <svg viewBox="0 0 24 24" role="img">
        <circle cx="12" cy="8" r="4" fill="currentColor" />
        <path d="M4.5 21a7.5 7.5 0 0 1 15 0" fill="currentColor" />
      </svg>
    </span>
  );
}
