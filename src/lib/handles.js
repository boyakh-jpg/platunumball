export function stripHandle(value, fallback = "") {
  const raw = String(value || fallback || "")
    .trim()
    .replace(/^[@#]+/, "")
    .normalize("NFKC")
    .toLowerCase();
  return raw.replace(/[^\p{L}\p{N}_-]+/gu, "");
}

export function toHashtag(value, fallback = "rankball") {
  const slug = stripHandle(value, fallback);
  return `#${slug || stripHandle(fallback) || "rankball"}`;
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

export function getCourtHashtag(court = {}) {
  if (court.hashtag) return toHashtag(court.hashtag, court.id ?? "court");
  return `#${getNumericHandle(court)}`;
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

export function findCourtByHashtag(courts = [], query = "") {
  return courts.find((court) => (
    sameHashtag(query, getCourtHashtag(court))
  )) ?? null;
}

export function findMatchByHashtag(matches = [], query = "") {
  return matches.find((match) => (
    sameHashtag(query, getMatchHashtag(match))
  )) ?? null;
}
