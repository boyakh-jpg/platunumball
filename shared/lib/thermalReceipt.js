export const MATCH_RECEIPT_STYLES = Object.freeze({
  score: "boxtier-score",
  thermal: "classic-thermal",
});

export const MATCH_RECEIPT_LOCALES = Object.freeze({ ko: "ko", en: "en" });
export const MATCH_RECEIPT_COMMENT_MAX_LENGTH = 22;
export const MATCH_RECEIPT_COMMENT_LINE_LENGTH = 11;
export const THERMAL_RECEIPT_COMMENT_MAX_WEIGHT = MATCH_RECEIPT_COMMENT_MAX_LENGTH;
export const THERMAL_PRINT_ROLES = Object.freeze({
  body: Object.freeze({ mask: "body", opacity: 0.84 }),
  team: Object.freeze({ mask: "team", opacity: 0.9 }),
  heavy: Object.freeze({ mask: "heavy", opacity: 0.92 }),
  photo: Object.freeze({ mask: "photo", opacity: 0.88 }),
  qr: Object.freeze({ mask: null, opacity: 1 }),
});

const MATCH_RECEIPT_FORMAT_PLAYER_COUNT = Object.freeze({
  "1v1": 2,
  "2v2": 4,
  "3v3": 6,
  "3x3": 6,
  "5v5": 10,
});

export function getMatchReceiptFormatPlayerCount(format = "") {
  return MATCH_RECEIPT_FORMAT_PLAYER_COUNT[String(format).trim().toLowerCase()] ?? 0;
}

export function sanitizeMatchReceiptComment(value = "") {
  const source = String(value)
    .replace(/<[^>]*>/g, "")
    .replace(/[<>\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(source).slice(0, MATCH_RECEIPT_COMMENT_MAX_LENGTH).join("").trimEnd();
}

export function splitMatchReceiptComment(value = "") {
  const characters = Array.from(sanitizeMatchReceiptComment(value));
  return [
    characters.slice(0, MATCH_RECEIPT_COMMENT_LINE_LENGTH).join(""),
    characters.slice(MATCH_RECEIPT_COMMENT_LINE_LENGTH, MATCH_RECEIPT_COMMENT_MAX_LENGTH).join(""),
  ].filter(Boolean);
}

export function getThermalReceiptTextWeight(value = "") {
  return Array.from(sanitizeMatchReceiptComment(value)).length;
}

export const sanitizeThermalReceiptComment = sanitizeMatchReceiptComment;
export const getMatchReceiptCommentLines = splitMatchReceiptComment;
export function suggestReceiptShortName(value = "") {
  const cleaned = String(value).replace(/[<>\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  return cleaned.split(" ")[0]?.slice(0, 12) ?? "";
}

export function createThermalSeed(value = "") {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createThermalRandom(seedValue = "") {
  let state = createThermalSeed(seedValue) || 0x9e3779b9;
  return () => {
    state += 0x6d2b79f5;
    let result = state;
    result = Math.imul(result ^ result >>> 15, result | 1);
    result ^= result + Math.imul(result ^ result >>> 7, result | 61);
    return ((result ^ result >>> 14) >>> 0) / 4294967296;
  };
}

export function getThermalScoreSlotLayout(value, options = {}) {
  const score = String(Math.max(0, Math.min(999, Math.round(Number(value) || 0))));
  const slotWidth = Number(options.slotWidth) || 284;
  const baseHeight = Number(options.digitHeight) || 158;
  const baseGap = Number(options.gap) || 6;
  const glyphAspect = Number(options.glyphAspect) || 0.61;
  const count = score.length;
  const unscaledWidth = count * baseHeight * glyphAspect + Math.max(0, count - 1) * baseGap;
  const scale = Math.min(1, slotWidth / unscaledWidth);
  const height = baseHeight * scale;
  const gap = baseGap * scale;
  const glyphWidth = height * glyphAspect;
  const totalWidth = count * glyphWidth + Math.max(0, count - 1) * gap;
  return { score, scale, height, gap, glyphWidth, totalWidth, x: (slotWidth - totalWidth) / 2 };
}

export function getThermalReceiptLayout(options = {}) {
  const hasPhoto = Boolean(options.hasPhoto);
  const hasPeriods = options.hasPeriods !== false;
  const hasComment = options.hasComment !== false;
  const baseTeamsY = hasPhoto ? 540 : 246;
  const baseScoreY = baseTeamsY + 238;
  const baseInfoY = baseScoreY + 238;
  const basePeriodsY = baseInfoY + 142;
  const baseResultY = hasPeriods ? basePeriodsY + 186 : baseInfoY + 142;
  const resultHeight = hasComment ? 270 : 230;
  const baseFooterY = baseResultY + resultHeight + 14;
  const footerHeight = 244;
  const paperY = 24;
  const paperBottomLimit = 1896;
  const photoFlowOffset = hasPhoto
    ? Math.max(0, paperBottomLimit - 24 - (baseFooterY + footerHeight))
    : 0;
  const teamsY = baseTeamsY + photoFlowOffset;
  const scoreY = baseScoreY + photoFlowOffset;
  const infoY = baseInfoY + photoFlowOffset;
  const periodsY = basePeriodsY + photoFlowOffset;
  const resultY = baseResultY + photoFlowOffset;
  const footerY = baseFooterY + photoFlowOffset;
  const paperBottom = hasPhoto
    ? paperBottomLimit
    : Math.min(paperBottomLimit, footerY + footerHeight + 64);

  return Object.freeze({
    paper: Object.freeze({ x: 142, y: paperY, width: 796, height: paperBottom - paperY }),
    content: Object.freeze({ x: 198, width: 684 }),
    brand: Object.freeze({ x: 198, y: 72, width: 684, height: 150 }),
    photo: hasPhoto ? Object.freeze({ x: 198, y: 226, width: 684, height: 288 }) : null,
    teams: Object.freeze({ x: 198, y: teamsY, width: 684, height: 220 }),
    score: Object.freeze({ x: 198, y: scoreY, width: 684, height: 224 }),
    info: Object.freeze({ x: 198, y: infoY, width: 684, height: 126 }),
    periods: hasPeriods ? Object.freeze({ x: 198, y: periodsY, width: 684, height: 170 }) : null,
    result: Object.freeze({ x: 198, y: resultY, width: 684, height: resultHeight }),
    footer: Object.freeze({ x: 198, y: footerY, width: 684, height: footerHeight }),
    hasPhoto,
    hasPeriods,
    hasComment,
  });
}
