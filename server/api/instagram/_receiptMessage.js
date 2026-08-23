import { parseExternalReceiptInput } from "../match-receipts/_createInput.js";
import { MATCH_RECEIPT_RENDER_PRESETS } from "../match-receipts/_pngRenderer.js";
import { MATCH_RECEIPT_LOCALES, MATCH_RECEIPT_STYLES } from "../../../shared/lib/thermalReceipt.js";

const FIELD_MAP = Object.freeze({
  "홈팀": "homeTeam", "원정팀": "awayTeam", "점수": "score", "날짜": "playedOn",
  "장소": "venue", "방식": "format", "스타일": "style", "비율": "preset",
  "시간": "playedTime", "대회": "tournamentName", "한줄평": "comment",
  "경기성격": "matchNature", "언어": "locale",
});
const REQUIRED = Object.freeze(["homeTeam", "awayTeam", "score", "playedOn", "venue", "format", "style", "preset"]);
const STYLE_MAP = Object.freeze({
  "감열": MATCH_RECEIPT_STYLES.thermal, thermal: MATCH_RECEIPT_STYLES.thermal,
  [MATCH_RECEIPT_STYLES.thermal]: MATCH_RECEIPT_STYLES.thermal,
  "스코어": MATCH_RECEIPT_STYLES.score, score: MATCH_RECEIPT_STYLES.score,
  [MATCH_RECEIPT_STYLES.score]: MATCH_RECEIPT_STYLES.score,
});
const PRESET_MAP = Object.freeze({
  "스토리": MATCH_RECEIPT_RENDER_PRESETS.story, story: MATCH_RECEIPT_RENDER_PRESETS.story,
  "피드": MATCH_RECEIPT_RENDER_PRESETS.feed, feed: MATCH_RECEIPT_RENDER_PRESETS.feed,
});
const NATURE_MAP = Object.freeze({
  "친선": "friendly", "경쟁": "competitive", "리벤지": "revenge",
  "준결승": "semifinal", "결승": "final",
  friendly: "friendly", competitive: "competitive", revenge: "revenge", semifinal: "semifinal", final: "final",
});
const LOCALE_MAP = Object.freeze({ "한국어": MATCH_RECEIPT_LOCALES.ko, ko: MATCH_RECEIPT_LOCALES.ko, "영어": MATCH_RECEIPT_LOCALES.en, en: MATCH_RECEIPT_LOCALES.en });

export const INSTAGRAM_RECEIPT_USAGE = [
  "영수증", "홈팀: A팀", "원정팀: B팀", "점수: 80-72", "날짜: 2026-08-23",
  "장소: BOXTIER COURT", "방식: 5v5", "스타일: 감열", "비율: 스토리",
].join("\n");

function invalid(fields = []) {
  return { input: null, preset: "", issues: fields.length ? fields : [{ field: "message", code: "invalid_format" }] };
}

export function normalizeInstagramMessage(value = "") {
  return String(value).normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase();
}

export function parseInstagramReceiptMessage(value = "") {
  const lines = String(value).normalize("NFKC").split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  if (lines.shift()?.toLowerCase() !== "영수증") return invalid();
  const fields = {};
  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator < 1) return invalid();
    const key = FIELD_MAP[line.slice(0, separator).trim()];
    const fieldValue = line.slice(separator + 1).trim();
    if (!key || !fieldValue || Object.hasOwn(fields, key)) return invalid();
    fields[key] = fieldValue;
  }
  const missing = REQUIRED.filter((field) => !fields[field]).map((field) => ({ field, code: "required" }));
  if (missing.length) return invalid(missing);
  const score = fields.score.match(/^(\d{1,3})\s*[-:]\s*(\d{1,3})$/u);
  if (!score) return invalid([{ field: "score", code: "invalid_score" }]);
  const style = STYLE_MAP[fields.style.toLowerCase()];
  const preset = PRESET_MAP[fields.preset.toLowerCase()];
  const matchNature = fields.matchNature ? NATURE_MAP[fields.matchNature.toLowerCase()] : "competitive";
  const locale = fields.locale ? LOCALE_MAP[fields.locale.toLowerCase()] : MATCH_RECEIPT_LOCALES.ko;
  if (!style || !preset || !matchNature || !locale) return invalid();
  const input = {
    style, homeTeam: fields.homeTeam, awayTeam: fields.awayTeam,
    homeScore: Number(score[1]), awayScore: Number(score[2]), playedOn: fields.playedOn,
    venue: fields.venue, format: fields.format, matchNature, locale,
    ...(fields.playedTime ? { playedTime: fields.playedTime } : {}),
    ...(fields.tournamentName ? { tournamentName: fields.tournamentName } : {}),
    ...(fields.comment ? { comment: fields.comment } : {}),
  };
  const parsed = parseExternalReceiptInput(input);
  return parsed.issues.length ? invalid(parsed.issues) : { input, preset, issues: [] };
}
