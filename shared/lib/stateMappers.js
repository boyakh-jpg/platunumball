import { EMPTY_STATE } from "./repositoryDefaults.js";
import { createProfileShell, normalizeRatings } from "./profileMappers.js";

const clone = (value) => JSON.parse(JSON.stringify(value));

export function normalizeUser(user = {}) {
  return { ...user, ratings: normalizeRatings(user.ratings) };
}

export function normalizeTeam(team = {}) {
  const source = team && typeof team === "object" ? team : {};
  const members = Array.isArray(source.members) ? source.members : [];
  return {
    ...source,
    members: members
      .filter((member) => member && typeof member === "object" && member.userId)
      .map((member) => ({ ...member, role: member.role ?? "regular" })),
  };
}

export function createEmptyState({ authUserId = "", email = "" } = {}) {
  const shellUser = authUserId ? createProfileShell(authUserId, email) : null;
  return {
    ...clone(EMPTY_STATE),
    currentUserId: shellUser?.id ?? "",
    users: shellUser ? [shellUser] : [],
  };
}

export function mergeDemoDefaultsById(current = [], fallback = []) {
  const currentMap = new Map(current.map((item) => [item.id, item]));
  const mergedDefaults = fallback.map((item) => ({ ...item, ...(currentMap.get(item.id) ?? {}) }));
  const extraItems = current.filter((item) => !fallback.some((fallbackItem) => fallbackItem.id === item.id));
  return [...mergedDefaults, ...extraItems];
}
