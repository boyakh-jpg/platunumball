export const MATCH_MODES = [
  { id: "1v1", label: "1v1", size: 1 },
  { id: "2v2", label: "2v2", size: 2 },
  { id: "3v3", label: "3v3", size: 3 },
  { id: "5v5", label: "5v5", size: 5 },
];

export const MATCH_MODE_IDS = Object.freeze(MATCH_MODES.map((mode) => mode.id));

export function isSupportedMatchMode(mode = "") {
  return MATCH_MODE_IDS.includes(mode);
}

export const MODE_SIZES = MATCH_MODES.reduce((map, mode) => {
  map[mode.id] = mode.size;
  return map;
}, {});

export function getModeSize(mode = "5v5", fallback = 5) {
  const configuredSize = Number(MODE_SIZES[mode]);
  if (Number.isFinite(configuredSize)) return configuredSize;
  const parsedSize = Number(String(mode).match(/^(\d+)/)?.[1] ?? fallback);
  return Math.max(1, Math.min(5, Number.isFinite(parsedSize) ? parsedSize : fallback));
}

export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

export const DEFAULT_RATING = 1200;
export const DEFAULT_PLAYER_RATINGS = Object.freeze({
  integrated: DEFAULT_RATING,
  modes: Object.freeze(Object.fromEntries(MATCH_MODES.map((mode) => [mode.id, DEFAULT_RATING]))),
  placement: Object.freeze({
    matchCount: 0,
    target: 5,
    completed: false,
    completedAt: null,
    evidenceWeight: 0,
    modeCounts: Object.freeze({}),
  }),
});
