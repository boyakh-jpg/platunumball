import { PLAYER_POSITIONS, getModeSize } from "./constants.js";
import { findUserByHashtag, getUserHashtag } from "./handles.js";

function normalizeLine(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizePosition(value = "") {
  const position = String(value ?? "").trim().toUpperCase();
  return PLAYER_POSITIONS.includes(position) && position !== "상관없음" ? position : "";
}

function getRefProfileId(ref = {}) {
  return String(ref.profileId ?? ref.id ?? "").trim();
}

export function getSoloRecordRosterLines(value = "") {
  return String(value ?? "")
    .split(/[\n,]+/)
    .map(normalizeLine)
    .filter(Boolean);
}

export function getSoloRecordUserLine(user = {}) {
  const position = normalizePosition(user.position);
  return [normalizeLine(user.name), position].filter(Boolean).join(" ");
}

export function getSoloRecordUserSearchText(user = {}) {
  return [
    user.name,
    getUserHashtag(user),
    user.position,
    user.region,
    `신뢰도 ${user.trustScore ?? ""}`,
  ].filter(Boolean).join(" ");
}

export function getSoloRecordPlayerRef(user = {}) {
  const profileId = String(user.id ?? user.profileId ?? "").trim();
  const name = normalizeLine(user.name);
  if (!profileId || !name) return null;
  return {
    profileId,
    name,
    position: normalizePosition(user.position),
  };
}

export function getSoloRecordRefLine(ref = {}) {
  return [normalizeLine(ref.name), normalizePosition(ref.position)].filter(Boolean).join(" ");
}

export function getSoloRecordRosterIdentity(line = "") {
  const text = normalizeLine(line);
  const hashtag = text.match(/#[^\s#]+/);
  if (hashtag?.[0]) return hashtag[0].toLowerCase();
  const parts = text.split(" ");
  const position = normalizePosition(parts.at(-1));
  return (position ? parts.slice(0, -1).join(" ") : text).trim().toLowerCase();
}

export function getSoloRecordUserIdentity(user = {}) {
  const profileId = String(user.id ?? user.profileId ?? "").trim();
  return profileId ? `profile:${profileId}` : getUserHashtag(user).toLowerCase();
}

function getLinkedIdentityForLine(line, refs = []) {
  const normalizedLine = normalizeLine(line).toLowerCase();
  const ref = refs.find((item) => getSoloRecordRefLine(item).toLowerCase() === normalizedLine);
  const profileId = getRefProfileId(ref);
  return profileId ? `profile:${profileId}` : getSoloRecordRosterIdentity(line);
}

export function getSoloRecordSelectedIdentitySet(
  teamAText = "",
  teamBText = "",
  teamARefs = [],
  teamBRefs = [],
) {
  const identities = [
    ...getSoloRecordRosterLines(teamAText).map((line) => getLinkedIdentityForLine(line, teamARefs)),
    ...getSoloRecordRosterLines(teamBText).map((line) => getLinkedIdentityForLine(line, teamBRefs)),
    ...teamARefs.map((ref) => {
      const profileId = getRefProfileId(ref);
      return profileId ? `profile:${profileId}` : "";
    }),
    ...teamBRefs.map((ref) => {
      const profileId = getRefProfileId(ref);
      return profileId ? `profile:${profileId}` : "";
    }),
  ].filter(Boolean);
  return new Set(identities);
}

export function getSoloRecordRosterError(
  mode = "1v1",
  teamAText = "",
  teamBText = "",
  teamARefs = [],
  teamBRefs = [],
) {
  const sideSize = getModeSize(mode, 1);
  const teamALines = getSoloRecordRosterLines(teamAText);
  const teamBLines = getSoloRecordRosterLines(teamBText);
  const teamALimit = Math.max(0, sideSize - 1);
  if (teamALines.length > teamALimit) return `우리 사이드는 본인 제외 ${teamALimit}명까지만 추가할 수 있습니다.`;
  if (teamBLines.length > sideSize) return `상대 사이드는 ${sideSize}명까지만 추가할 수 있습니다.`;
  const seen = new Set();
  for (const [line, refs] of [
    ...teamALines.map((item) => [item, teamARefs]),
    ...teamBLines.map((item) => [item, teamBRefs]),
  ]) {
    const identity = getLinkedIdentityForLine(line, refs);
    if (!identity) continue;
    if (seen.has(identity)) return "같은 선수를 우리/상대 또는 같은 사이드에 중복으로 넣을 수 없습니다.";
    seen.add(identity);
  }
  return "";
}

function stripHashtags(value = "") {
  return normalizeLine(String(value ?? "").replace(/#[^\s#]+/g, " "));
}

function getExistingRefByLine(refs = []) {
  return new Map(
    refs
      .map((ref) => [getSoloRecordRefLine(ref).toLowerCase(), getSoloRecordPlayerRef(ref)])
      .filter(([line, ref]) => line && ref),
  );
}

export function normalizeSoloRecordRosterInput(value = "", refs = [], users = []) {
  const existingRefByLine = getExistingRefByLine(refs);
  const userById = new Map(users.map((user) => [String(user?.id ?? ""), user]));
  const nextRefs = [];
  const seenProfileIds = new Set();
  const lines = getSoloRecordRosterLines(value).map((line) => {
    const hashtag = line.match(/#[^\s#]+/)?.[0] ?? "";
    const linkedUser = hashtag ? findUserByHashtag(users, hashtag) : null;
    const strippedLine = stripHashtags(line);
    const existingRef = existingRefByLine.get(strippedLine.toLowerCase()) ?? null;
    const existingUser = existingRef ? userById.get(existingRef.profileId) : null;
    const ref = linkedUser
      ? getSoloRecordPlayerRef(linkedUser)
      : existingUser
        ? getSoloRecordPlayerRef(existingUser)
        : existingRef;
    if (!ref) return strippedLine;
    if (!seenProfileIds.has(ref.profileId)) {
      nextRefs.push(ref);
      seenProfileIds.add(ref.profileId);
    }
    return getSoloRecordRefLine(ref);
  }).filter(Boolean);

  return {
    text: lines.join("\n"),
    refs: nextRefs,
  };
}

export function getSoloRecordLinkedRosterEntries(value = "", refs = [], users = []) {
  const normalized = normalizeSoloRecordRosterInput(value, refs, users);
  const refByLine = getExistingRefByLine(normalized.refs);
  return {
    ...normalized,
    entries: getSoloRecordRosterLines(normalized.text).map((line) => {
      const parts = line.split(" ");
      const position = normalizePosition(parts.at(-1));
      const name = position ? parts.slice(0, -1).join(" ").trim() : line;
      const ref = refByLine.get(line.toLowerCase()) ?? null;
      return {
        name,
        position: position || "FREE",
        ...(ref ? { linkedProfileId: ref.profileId } : {}),
      };
    }),
  };
}

export function getLinkedPersonalRecordDisplayUser(user = null, usersById = {}) {
  const linkedProfileId = String(user?.linkedProfileId ?? "").trim();
  if (!linkedProfileId) return user;
  const linkedUser = usersById[linkedProfileId] ?? null;
  return {
    ...(user ?? {}),
    ...(linkedUser ?? {}),
    id: linkedProfileId,
    name: linkedUser?.name ?? user?.name ?? "선수",
    position: linkedUser?.position ?? user?.position ?? "FREE",
    anonymous: false,
    participationLabel: "",
    linkedProfileId,
  };
}
