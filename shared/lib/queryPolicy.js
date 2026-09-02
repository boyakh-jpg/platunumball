export const DIRECTORY_KINDS = Object.freeze(["self", "players", "teams", "affiliations", "all"]);
export const DIRECTORY_PLAYER_RANKING_SORTS = Object.freeze(["integrated", "1v1", "2v2", "3v3", "5v5"]);
export const ADMIN_DIRECTORY_SECTION_IDS = Object.freeze(["operations", "reports", "courts", "players", "matches", "teams", "appointments"]);
export const ADMIN_QUEUE_MODES = Object.freeze(["pending", "history"]);
export const ADMIN_QUEUE_FOCUSES = Object.freeze(["urgent", "unassigned", "stale", "receivedToday", "processedToday", "oldest"]);
export const DEFAULT_ADMIN_SECTION = ADMIN_DIRECTORY_SECTION_IDS[0];
export const DEFAULT_ADMIN_QUEUE_MODE = ADMIN_QUEUE_MODES[0];

export const DIRECTORY_CACHE_TTL_MS = 30_000;
export const DIRECTORY_DEFAULT_PAGE_LIMIT = 100;
export const DIRECTORY_MAX_PAGE_LIMIT = 100;
export const DIRECTORY_TEAM_PAGE_LIMIT = 50;
export const DIRECTORY_PICKER_PAGE_LIMIT = 50;
export const COURT_MAP_SEARCH_LIMIT = 500;
export const COURT_MAP_SEARCH_PURPOSE = "court_map";
export const DIRECTORY_SELF_PAGE_LIMIT = 30;
export const DIRECTORY_ID_BATCH_SIZE = 150;
export const DIRECTORY_FILTER_MAX_LENGTH = 80;
export const DIRECTORY_MAX_OFFSET = 10_000;
export const ADMIN_DEFAULT_PAGE_LIMIT = 30;
export const ADMIN_MAX_PAGE_LIMIT = 60;

const DIRECTORY_KIND_SET = new Set(DIRECTORY_KINDS);
const DIRECTORY_PLAYER_RANKING_SORT_SET = new Set(DIRECTORY_PLAYER_RANKING_SORTS);
const ADMIN_DIRECTORY_SECTION_SET = new Set(ADMIN_DIRECTORY_SECTION_IDS);
const ADMIN_QUEUE_MODE_SET = new Set(ADMIN_QUEUE_MODES);
const ADMIN_QUEUE_FOCUS_SET = new Set(ADMIN_QUEUE_FOCUSES);

export function clampQueryInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

export function normalizeDirectoryKind(value = "", fallback = "all") {
  const kind = String(value ?? "").trim();
  return DIRECTORY_KIND_SET.has(kind) ? kind : fallback;
}

export function normalizeDirectoryRankingSort(value = "") {
  const sort = String(value ?? "").trim();
  return DIRECTORY_PLAYER_RANKING_SORT_SET.has(sort) ? sort : "";
}

export function normalizeAdminSection(value = "") {
  const section = String(value ?? "").trim();
  return ADMIN_DIRECTORY_SECTION_SET.has(section) ? section : DEFAULT_ADMIN_SECTION;
}

export function normalizeAdminQueueMode(value = "") {
  const queueMode = String(value ?? "").trim();
  return ADMIN_QUEUE_MODE_SET.has(queueMode) ? queueMode : DEFAULT_ADMIN_QUEUE_MODE;
}

export function normalizeAdminQueueFocus(value = "") {
  const focus = String(value ?? "").trim();
  return ADMIN_QUEUE_FOCUS_SET.has(focus) ? focus : "";
}

export function normalizeDirectoryFilter(value = "") {
  return String(value ?? "")
    .trim()
    .slice(0, DIRECTORY_FILTER_MAX_LENGTH)
    .replace(/[,:%()*"'\\.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getDirectoryPageRequest(body = {}, { admin = false, kind = "players" } = {}) {
  const fallbackLimit = admin ? ADMIN_DEFAULT_PAGE_LIMIT : DIRECTORY_DEFAULT_PAGE_LIMIT;
  const directoryKind = normalizeDirectoryKind(kind, "players");
  const maxLimit = admin
    ? ADMIN_MAX_PAGE_LIMIT
    : ["all", "teams"].includes(directoryKind)
      ? DIRECTORY_TEAM_PAGE_LIMIT
      : DIRECTORY_MAX_PAGE_LIMIT;
  return {
    limit: clampQueryInteger(body.limit, fallbackLimit, 1, maxLimit),
    offset: clampQueryInteger(body.offset, 0, 0, DIRECTORY_MAX_OFFSET),
  };
}
