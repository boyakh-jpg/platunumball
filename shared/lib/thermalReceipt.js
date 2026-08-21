export const MATCH_RECEIPT_STYLES = Object.freeze({
  score: "boxtier-score",
  thermal: "classic-thermal",
});

export const MATCH_RECEIPT_LOCALES = Object.freeze({ ko: "ko", en: "en" });
export const THERMAL_RECEIPT_COMMENT_MAX_WEIGHT = 56;
export const THERMAL_PRINT_ROLES = Object.freeze({
  body: Object.freeze({ mask: "body", opacity: 0.84 }),
  team: Object.freeze({ mask: "team", opacity: 0.9 }),
  heavy: Object.freeze({ mask: "heavy", opacity: 0.92 }),
  photo: Object.freeze({ mask: "photo", opacity: 0.88 }),
  qr: Object.freeze({ mask: null, opacity: 1 }),
});

const CJK_CHARACTER = /[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff]/u;

export function getThermalReceiptTextWeight(value = "") {
  return Array.from(String(value)).reduce((total, character) => total + (CJK_CHARACTER.test(character) ? 2 : 1), 0);
}

export function sanitizeThermalReceiptComment(value = "") {
  const source = String(value)
    .replace(/<[^>]*>/g, "")
    .replace(/[<>\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  let result = "";
  let weight = 0;
  for (const character of Array.from(source)) {
    const nextWeight = CJK_CHARACTER.test(character) ? 2 : 1;
    if (weight + nextWeight > THERMAL_RECEIPT_COMMENT_MAX_WEIGHT) break;
    result += character;
    weight += nextWeight;
  }
  return result.trimEnd();
}

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
  const periodReduction = hasPeriods ? 0 : 188;
  const commentReduction = hasComment ? 0 : 40;
  const resultHeight = hasComment ? 248 : 208;
  const sectionOffset = hasPhoto ? 144 : 0;
  const basePaperHeight = hasPhoto ? 1872 : 1584;

  return Object.freeze({
    paper: Object.freeze({
      x: 142,
      y: hasPhoto ? 24 : 168,
      width: 796,
      height: basePaperHeight - periodReduction - commentReduction,
    }),
    content: Object.freeze({ x: 198, width: 684 }),
    brand: Object.freeze({ x: 198, y: hasPhoto ? 40 : 184, width: 684, height: 184 }),
    photo: hasPhoto ? Object.freeze({ x: 198, y: 248, width: 684, height: 288 }) : null,
    teams: Object.freeze({ x: 198, y: 392 + sectionOffset, width: 684, height: 220 }),
    score: Object.freeze({ x: 198, y: 634 + sectionOffset, width: 684, height: 224 }),
    info: Object.freeze({ x: 198, y: 840 + sectionOffset, width: 684, height: 148 }),
    periods: hasPeriods
      ? Object.freeze({ x: 198, y: 1004 + sectionOffset, width: 684, height: 170 })
      : null,
    result: Object.freeze({
      x: 198,
      y: 1192 + sectionOffset - periodReduction,
      width: 684,
      height: resultHeight,
    }),
    footer: Object.freeze({
      x: 198,
      y: 1460 + sectionOffset - periodReduction - commentReduction,
      width: 684,
      height: 218,
    }),
    hasPhoto,
    hasPeriods,
    hasComment,
  });
}
