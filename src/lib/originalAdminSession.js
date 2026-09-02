export const ORIGINAL_ADMIN_ACCOUNT_ID = "__original-admin-account__";
export const ORIGINAL_ADMIN_ACCOUNT_LABEL = "관리자 원계정";

const ORIGINAL_ADMIN_SESSION_KEY = "rankball.auth.originalAdminSession.v1";

function getSessionStorage(storage) {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function readOriginalAdminSession(storage) {
  const activeStorage = getSessionStorage(storage);
  if (!activeStorage) return null;
  try {
    const parsed = JSON.parse(activeStorage.getItem(ORIGINAL_ADMIN_SESSION_KEY) || "null");
    if (
      !parsed?.accessToken
      || !parsed?.refreshToken
      || !parsed?.userId
      || !parsed?.loginId
    ) return null;
    return parsed;
  } catch {
    try {
      activeStorage.removeItem(ORIGINAL_ADMIN_SESSION_KEY);
    } catch {
      // Storage can be unavailable in private or embedded browsers.
    }
    return null;
  }
}

export function writeOriginalAdminSession(session, storage) {
  const activeStorage = getSessionStorage(storage);
  const userId = String(session?.user?.id ?? "").trim();
  const loginId = String(session?.user?.email ?? userId).trim();
  if (!activeStorage || !session?.access_token || !session?.refresh_token || !userId || !loginId) return false;
  try {
    activeStorage.setItem(ORIGINAL_ADMIN_SESSION_KEY, JSON.stringify({
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      userId,
      loginId,
    }));
    return true;
  } catch {
    return false;
  }
}

export function shouldPreserveOriginalAdminSession(storedSession, currentSession) {
  return Boolean(
    storedSession?.userId
    && currentSession?.user?.id
    && storedSession.userId !== currentSession.user.id,
  );
}

export function clearOriginalAdminSession(storage) {
  const activeStorage = getSessionStorage(storage);
  if (!activeStorage) return;
  try {
    activeStorage.removeItem(ORIGINAL_ADMIN_SESSION_KEY);
  } catch {
    // The active auth session remains the source of truth when storage is unavailable.
  }
}

export function getOriginalAdminAccount(storage) {
  const storedSession = readOriginalAdminSession(storage);
  if (!storedSession) return null;
  return createOriginalAdminAccount({
    userId: storedSession.userId,
    loginId: storedSession.loginId,
  });
}

export function createOriginalAdminAccount({ userId = "", loginId = "" } = {}) {
  const resolvedLoginId = String(loginId || userId).trim();
  if (!resolvedLoginId) return null;
  return {
    id: ORIGINAL_ADMIN_ACCOUNT_ID,
    loginId: resolvedLoginId,
    label: ORIGINAL_ADMIN_ACCOUNT_LABEL,
  };
}
