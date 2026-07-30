export const MATCH_LIST_SCOPES = Object.freeze({
  PERSONAL: "personal",
  TEAM: "team",
  PLAY: "play",
});

export const MATCH_LIST_STATUSES = Object.freeze({
  IDLE: "idle",
  LOADING: "loading",
  READY: "ready",
  ERROR: "error",
});

const EMPTY_MATCH_LIST_SCOPE = Object.freeze({
  ids: Object.freeze([]),
  recruitingPostIds: Object.freeze([]),
  status: MATCH_LIST_STATUSES.IDLE,
  error: "",
});

function normalizeMatchListIds(ids = []) {
  return [...new Set(
    (Array.isArray(ids) ? ids : [])
      .map((id) => String(id ?? "").trim())
      .filter(Boolean),
  )];
}

export function createMatchListScope(options = {}) {
  return {
    ids: normalizeMatchListIds(options.ids),
    recruitingPostIds: normalizeMatchListIds(options.recruitingPostIds),
    status: Object.values(MATCH_LIST_STATUSES).includes(options.status)
      ? options.status
      : MATCH_LIST_STATUSES.IDLE,
    error: String(options.error ?? ""),
  };
}

export function createMatchListStore(options = {}) {
  return Object.fromEntries(
    Object.values(MATCH_LIST_SCOPES).map((scope) => [scope, createMatchListScope(options[scope])]),
  );
}

export function getMatchListScope(store = {}, scope = "") {
  return store?.[scope] ?? EMPTY_MATCH_LIST_SCOPE;
}

export function updateMatchListScope(store = {}, scope = "", patch = {}) {
  if (!Object.values(MATCH_LIST_SCOPES).includes(scope)) return store;
  const current = getMatchListScope(store, scope);
  return {
    ...store,
    [scope]: createMatchListScope({
      ...current,
      ...patch,
      ids: Object.prototype.hasOwnProperty.call(patch, "ids") ? patch.ids : current.ids,
      recruitingPostIds: Object.prototype.hasOwnProperty.call(patch, "recruitingPostIds")
        ? patch.recruitingPostIds
        : current.recruitingPostIds,
    }),
  };
}

export function getMatchEntityMap(matches = []) {
  return Object.fromEntries(
    (matches ?? [])
      .filter((match) => match?.id)
      .map((match) => [match.id, match]),
  );
}

export function selectMatchListMatches(matchEntities = {}, store = {}, scope = "") {
  return getMatchListScope(store, scope).ids
    .map((matchId) => matchEntities?.[matchId])
    .filter(Boolean);
}

export function isMatchListInitialLoading(scope = EMPTY_MATCH_LIST_SCOPE) {
  return (
    scope.status === MATCH_LIST_STATUSES.IDLE
    || (scope.status === MATCH_LIST_STATUSES.LOADING && scope.ids.length === 0)
  );
}
