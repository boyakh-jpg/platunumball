import {
  getThermalReceiptTextWeight,
  MATCH_RECEIPT_LOCALES,
  MATCH_RECEIPT_STYLES,
  THERMAL_RECEIPT_COMMENT_MAX_WEIGHT,
} from "../../../shared/lib/thermalReceipt.js";

const FORMATS = new Set(["1v1", "2v2", "3v3", "3x3", "5v5"]);
const MATCH_NATURES = new Set(["friendly", "competitive", "revenge", "semifinal", "final"]);
const PERIOD_LABELS = new Set(["1Q", "2Q", "3Q", "4Q", "1H", "2H", "REG", "OT"]);
export const PREPARED_EMBLEM_MAX_BASE64_LENGTH = 132_000;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const EXTERNAL_EMBLEM_FIELDS = [
  "homeEmblem",
  "awayEmblem",
  "homeEmblemUrl",
  "awayEmblemUrl",
  "emblemUrl",
  "homeEmblemKey",
  "awayEmblemKey",
  "homeEmblemBase64",
  "awayEmblemBase64",
];

function text(value) {
  return String(value ?? "").replace(/[<>\u0000-\u001f\u007f]/gu, "").replace(/\s+/gu, " ").trim();
}

function isRealIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isScore(value) {
  return Number.isInteger(value) && value >= 0 && value <= 999;
}

function issue(field, code) {
  return { field, code };
}

function parsePreparedEmblem(value, field, issues) {
  if (value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== 1 || typeof value.imageBase64 !== "string"
    || value.imageBase64.length === 0 || value.imageBase64.length > PREPARED_EMBLEM_MAX_BASE64_LENGTH
    || !BASE64_PATTERN.test(value.imageBase64)) {
    issues.push(issue(field, "prepared_webp_base64_required"));
    return null;
  }
  return { imageBase64: value.imageBase64 };
}

export function parseExternalReceiptInput(value = {}, { allowPreparedEmblems = false } = {}) {
  const issues = [];
  const style = text(value.style);
  const homeTeam = text(value.homeTeam);
  const awayTeam = text(value.awayTeam);
  const playedOn = text(value.playedOn);
  const venue = text(value.venue);
  const format = text(value.format);
  const locale = text(value.locale) || MATCH_RECEIPT_LOCALES.ko;
  const matchNature = text(value.matchNature) || "competitive";
  const tournamentName = text(value.tournamentName);
  const comment = text(value.comment);
  const playedTime = text(value.playedTime) || "20:30";

  if (!Object.values(MATCH_RECEIPT_STYLES).includes(style)) issues.push(issue("style", "required_style"));
  if (!homeTeam || homeTeam.length > 24) issues.push(issue("homeTeam", "required_team_name_max_24"));
  if (!awayTeam || awayTeam.length > 24) issues.push(issue("awayTeam", "required_team_name_max_24"));
  if (!isScore(value.homeScore)) issues.push(issue("homeScore", "required_integer_0_999"));
  if (!isScore(value.awayScore)) issues.push(issue("awayScore", "required_integer_0_999"));
  if (!isRealIsoDate(playedOn)) issues.push(issue("playedOn", "required_real_iso_date"));
  if (!venue || venue.length > 36) issues.push(issue("venue", "required_venue_max_36"));
  if (!FORMATS.has(format)) issues.push(issue("format", "required_format"));
  if (!Object.values(MATCH_RECEIPT_LOCALES).includes(locale)) issues.push(issue("locale", "unsupported_locale"));
  if (!MATCH_NATURES.has(matchNature)) issues.push(issue("matchNature", "unsupported_match_nature"));
  if (!/^([01]\d|2[0-3]):[0-5]\d$/u.test(playedTime)) issues.push(issue("playedTime", "invalid_time"));
  if (tournamentName.length > 32) issues.push(issue("tournamentName", "max_32"));
  if (style === MATCH_RECEIPT_STYLES.score && Array.from(comment).length > 11) {
    issues.push(issue("comment", "score_comment_max_11"));
  }
  if (style === MATCH_RECEIPT_STYLES.thermal
    && getThermalReceiptTextWeight(comment) > THERMAL_RECEIPT_COMMENT_MAX_WEIGHT) {
    issues.push(issue("comment", "thermal_comment_max_weight_56"));
  }
  if (value.includePhoto === true || value.photo || value.photoUrl || value.photoAssetId || value.imageUrl) {
    issues.push(issue("includePhoto", "external_photo_not_supported"));
  }
  const hasUnsupportedEmblemField = EXTERNAL_EMBLEM_FIELDS
    .filter((field) => field !== "homeEmblem" && field !== "awayEmblem")
    .some((field) => Object.hasOwn(value, field));
  if (!allowPreparedEmblems && EXTERNAL_EMBLEM_FIELDS.some((field) => Object.hasOwn(value, field))) {
    issues.push(issue("emblem", "external_emblem_not_supported"));
  } else if (allowPreparedEmblems && hasUnsupportedEmblemField) {
    issues.push(issue("emblem", "external_emblem_not_supported"));
  }
  const homeEmblem = allowPreparedEmblems ? parsePreparedEmblem(value.homeEmblem, "homeEmblem", issues) : null;
  const awayEmblem = allowPreparedEmblems ? parsePreparedEmblem(value.awayEmblem, "awayEmblem", issues) : null;
  if (value.verified === true || value.homeMmr !== undefined || value.awayMmr !== undefined) {
    issues.push(issue("verified", "canonical_fields_not_allowed"));
  }

  const periodScores = [];
  const seenLabels = new Set();
  if (value.periodScores !== undefined && !Array.isArray(value.periodScores)) {
    issues.push(issue("periodScores", "must_be_array"));
  } else if (Array.isArray(value.periodScores)) {
    if (value.periodScores.length > 5) issues.push(issue("periodScores", "max_5"));
    for (const [index, period] of value.periodScores.entries()) {
      const label = text(period?.label).toUpperCase();
      if (!PERIOD_LABELS.has(label) || seenLabels.has(label)) {
        issues.push(issue(`periodScores.${index}.label`, "invalid_or_duplicate_label"));
        continue;
      }
      if (!isScore(period?.homeScore) || !isScore(period?.awayScore)) {
        issues.push(issue(`periodScores.${index}`, "paired_integer_scores_required"));
        continue;
      }
      seenLabels.add(label);
      periodScores.push({ label, scoreA: period.homeScore, scoreB: period.awayScore });
    }
    if (periodScores.length > 0 && periodScores.length === value.periodScores.length) {
      const homeTotal = periodScores.reduce((sum, period) => sum + period.scoreA, 0);
      const awayTotal = periodScores.reduce((sum, period) => sum + period.scoreB, 0);
      if (homeTotal !== value.homeScore || awayTotal !== value.awayScore) {
        issues.push(issue("periodScores", "totals_must_match_final_score"));
      }
    }
  }

  if (issues.length > 0) return { issues, draft: null, emblems: null };
  return {
    issues: [],
    emblems: { home: homeEmblem, away: awayEmblem },
    draft: {
      homeTeam,
      awayTeam,
      homeScore: value.homeScore,
      awayScore: value.awayScore,
      playedOn,
      venue,
      format,
      matchNature,
      tournamentName,
      periodScores,
      receiptStyle: style,
      receiptLocale: locale,
      includePhoto: false,
      playedTime,
      ...(style === MATCH_RECEIPT_STYLES.thermal ? { receiptComment: comment } : { comment }),
    },
  };
}
