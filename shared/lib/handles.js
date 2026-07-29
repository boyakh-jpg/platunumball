export function stripHandle(value, fallback = "") {
  const raw = String(value || fallback || "")
    .trim()
    .replace(/^[@#]+/, "")
    .normalize("NFKC")
    .toLowerCase();
  return raw.replace(/[^\p{L}\p{N}_-]+/gu, "");
}

export function toHashtag(value, fallback = "boxtier") {
  const slug = stripHandle(value, fallback);
  return `#${slug || stripHandle(fallback) || "boxtier"}`;
}

const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;
const HANGUL_MEDIAL_COUNT = 21;
const HANGUL_FINAL_COUNT = 28;
const HANGUL_INITIALS = ["g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj", "ch", "k", "t", "p", "h"];
const HANGUL_MEDIALS = ["a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae", "oe", "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i"];
const HANGUL_FINALS = ["", "g", "kk", "gs", "n", "nj", "nh", "d", "l", "lg", "lm", "lb", "ls", "lt", "lp", "lh", "m", "b", "bs", "s", "ss", "ng", "j", "ch", "k", "t", "p", "h"];

function romanizeHangul(value = "") {
  return Array.from(String(value)).map((char) => {
    const code = char.charCodeAt(0);
    if (code < HANGUL_BASE || code > HANGUL_LAST) return char;
    const index = code - HANGUL_BASE;
    const initialIndex = Math.floor(index / (HANGUL_MEDIAL_COUNT * HANGUL_FINAL_COUNT));
    const medialIndex = Math.floor((index % (HANGUL_MEDIAL_COUNT * HANGUL_FINAL_COUNT)) / HANGUL_FINAL_COUNT);
    const finalIndex = index % HANGUL_FINAL_COUNT;
    return `${HANGUL_INITIALS[initialIndex]}${HANGUL_MEDIALS[medialIndex]}${HANGUL_FINALS[finalIndex]}`;
  }).join("");
}

export function makeRandomDigitSuffix() {
  return String(Math.floor(Math.random() * 10000)).padStart(4, "0");
}

export function makeSuggestedHashtagBody(name = "", suffix = makeRandomDigitSuffix()) {
  const romanized = romanizeHangul(name)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const base = romanized.replace(/[^a-z0-9]+/g, "").slice(0, 8) || "boxtier";
  return `${base}${suffix}`;
}

export function getUserHashtag(user = {}) {
  return toHashtag(user.hashtag ?? user.handle ?? user.name ?? user.id, user.id ?? "player");
}

export function getTeamHashtag(team = {}) {
  return toHashtag(team.hashtag ?? team.handle ?? team.name ?? team.id, team.id ?? "team");
}

function getNumericHandle(item = {}) {
  const idDigits = String(item.id ?? "").match(/\d+/g)?.join("");
  if (idDigits) return idDigits.replace(/^0+(?=\d)/, "");

  const source = String(item.id ?? item.name ?? "0");
  const fallbackNumber = Array.from(source).reduce((sum, char, index) => sum + char.charCodeAt(0) * (index + 1), 0);
  return String(fallbackNumber || 0);
}

function getCourtFallbackHandle(court = {}) {
  const source = String(court.id ?? court.name ?? "court");
  let hash = 2166136261;
  for (const char of source) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  }
  return String(10000 + ((hash >>> 0) % 90000));
}

function normalizeCourtHashtagWidth(value, fallback = "court") {
  const hashtag = toHashtag(value, fallback);
  const body = stripHandle(hashtag);
  if (/^\d{1,4}$/.test(body)) return `#${body.padStart(5, "0")}`;
  return hashtag;
}

export function getCourtHashtag(court = {}) {
  if (court.hashtag) return normalizeCourtHashtagWidth(court.hashtag, court.id ?? "court");
  return `#${getCourtFallbackHandle(court)}`;
}

export function getMatchHashtag(match = {}) {
  if (match.hashtag) return toHashtag(match.hashtag, match.id ?? "match");
  return `#m${getNumericHandle(match)}`;
}

export function sameHashtag(query, value) {
  return Boolean(stripHandle(query) && stripHandle(query) === stripHandle(value));
}

export function findUserByHashtag(users = [], query = "") {
  return users.find((user) => (
    sameHashtag(query, user.hashtag) ||
    sameHashtag(query, user.handle) ||
    sameHashtag(query, getUserHashtag(user))
  )) ?? null;
}

export function findTeamByHashtag(teams = [], query = "") {
  return teams.find((team) => (
    sameHashtag(query, team.hashtag) ||
    sameHashtag(query, team.handle) ||
    sameHashtag(query, getTeamHashtag(team))
  )) ?? null;
}
