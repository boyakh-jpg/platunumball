
import { mergeRemoteById } from "../../../../shared/lib/arrayValues.js";

export { mergeRemoteById };

export function mergeTeamsById(current = [], incoming = []) {
  const merged = new Map((current ?? []).filter((item) => item?.id).map((item) => [item.id, item]));
  (incoming ?? []).forEach((item) => {
    if (!item?.id) return;
    const existing = merged.get(item.id);
    if (existing && item.membersPartial) {
      const existingIsPartial = existing.membersPartial === true;
      const partialMembers = new Map([
        ...(existing.members ?? []),
        ...(item.members ?? []),
      ].filter((member) => member?.userId).map((member) => [member.userId, member]));
      merged.set(item.id, {
        ...existing,
        ...item,
        members: existingIsPartial
          ? [...partialMembers.values()]
          : existing.members ?? [],
        membersPartial: existingIsPartial,
      });
      return;
    }
    merged.set(item.id, item);
  });
  return [...merged.values()];
}
function hasItems(value) {
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value && typeof value === "object" && Object.values(value).some((item) => (
    Array.isArray(item) ? item.length > 0 : item !== null && item !== undefined && item !== ""
  )));
}
function preserveExistingWhenEmpty(incoming, existing, keys = []) {
  if (!existing) return incoming;
  const next = { ...existing, ...incoming };
  keys.forEach((key) => {
    if (!hasItems(incoming?.[key]) && hasItems(existing?.[key])) next[key] = existing[key];
  });
  return next;
}
function mergeRoomInvitations(existing = [], incoming = []) {
  return mergeRemoteById(existing, incoming);
}
function shouldUseIncomingRoomRow(incoming, existing) {
  if (!existing) return true;
  const incomingTime = new Date(incoming?.updatedAt ?? incoming?.createdAt ?? 0).getTime();
  const existingTime = new Date(existing?.updatedAt ?? existing?.createdAt ?? 0).getTime();
  if (!Number.isFinite(incomingTime) || !Number.isFinite(existingTime)) return true;
  return incomingTime >= existingTime;
}
function shouldUseIncomingMatchRow(incoming, existing) {
  if (!existing) return true;
  const incomingListOnly = incoming?.matchListOnly === true;
  const existingListOnly = existing?.matchListOnly === true;
  if (existingListOnly && !incomingListOnly) return true;
  if (incomingListOnly && !existingListOnly) return true;
  return shouldUseIncomingRoomRow(incoming, existing);
}
function shouldUseIncomingRecruitingPostRow(incoming, existing) {
  if (!existing) return true;
  const incomingListOnly = incoming?.listCardOnly === true;
  const existingListOnly = existing?.listCardOnly === true;
  if (existingListOnly && !incomingListOnly) return true;
  if (incomingListOnly && !existingListOnly) return false;
  return shouldUseIncomingRoomRow(incoming, existing);
}
function getTournamentMatchKey(match = {}) {
  if (!match?.tournamentId) return "";
  const round = Number(match.tournamentRound ?? 0);
  const fixture = Number(match.tournamentFixture ?? 0);
  return round && fixture ? `${match.tournamentId}:${round}:${fixture}` : "";
}
export function mergeMatchesById(current = [], incoming = [], forceIds = new Set()) {
  const merged = new Map((current ?? []).filter((item) => item?.id).map((item) => [item.id, item]));
  (incoming ?? []).forEach((item) => {
    if (!item?.id) return;
    const tournamentKey = getTournamentMatchKey(item);
    if (tournamentKey) {
      [...merged.entries()].forEach(([existingId, existingMatch]) => {
        if (existingId !== item.id && getTournamentMatchKey(existingMatch) === tournamentKey) merged.delete(existingId);
      });
    }
    const existing = merged.get(item.id);
    if (!forceIds.has(item.id) && !shouldUseIncomingMatchRow(item, existing)) return;
    if (item.matchListOnly === true && existing && existing.matchListOnly !== true) {
      // LEGACY READ-ONLY:
      // 과거 경기 데이터 해석 전용.
      // 신규 권한 판정 및 저장에 사용하지 않는다.
      const next = preserveExistingWhenEmpty(item, existing, [
        "agreements",
        "approvals",
        "disputes",
        "playedPlayerIds",
        "reservePlayers",
        "anonymousPlayers",
        "parties",
        "result",
        "attendance",
        "statRecorders",
      ]);
      next.teamA = {
        ...(existing.teamA ?? {}),
        ...(item.teamA ?? {}),
        players: existing.teamA?.players ?? [],
      };
      next.teamB = {
        ...(existing.teamB ?? {}),
        ...(item.teamB ?? {}),
        players: existing.teamB?.players ?? [],
      };
      next.rules = existing.rules;
      delete next.matchListOnly;
      merged.set(item.id, next);
      return;
    }
    if (item.tournamentListOnly === true && existing && existing.tournamentListOnly !== true) {
      const next = { ...existing, ...item, rules: existing.rules };
      delete next.tournamentListOnly;
      merged.set(item.id, next);
      return;
    }
    const next = preserveExistingWhenEmpty(item, existing, [
      "agreements",
      "approvals",
      "disputes",
      "playedPlayerIds",
      "reservePlayers",
      "anonymousPlayers",
      "parties",
      "result",
    ]);
    if (item.matchListOnly !== true) delete next.matchListOnly;
    if (item.tournamentListOnly !== true) delete next.tournamentListOnly;
    merged.set(item.id, next);
  });
  return [...merged.values()];
}
function mergeAttendanceBySide(incoming = {}, existing = {}) {
  return {
    teamA: Array.from(new Set([...(incoming.teamA ?? []), ...(existing.teamA ?? [])].filter(Boolean))),
    teamB: Array.from(new Set([...(incoming.teamB ?? []), ...(existing.teamB ?? [])].filter(Boolean))),
  };
}
export function preserveOptimisticMatchAttendance(incoming = {}, existing = null) {
  if (!existing) return incoming;
  return {
    ...incoming,
    attendance: mergeAttendanceBySide(incoming.attendance ?? {}, existing.attendance ?? {}),
  };
}
export function mergeRecruitingPostsById(current = [], incoming = [], forceIds = new Set()) {
  const merged = new Map((current ?? []).filter((item) => item?.id).map((item) => [item.id, item]));
  (incoming ?? []).forEach((item) => {
    if (!item?.id) return;
    const existing = merged.get(item.id);
    if (item.listCardOnly === true && existing && existing.listCardOnly !== true) {
      merged.set(item.id, {
        ...existing,
        ...(item.listCounts ? { listCounts: item.listCounts } : {}),
        ...(Array.isArray(item.__feedRelations)
          ? { __feedRelations: Array.from(new Set([...(existing.__feedRelations ?? []), ...item.__feedRelations])) }
          : {}),
      });
      return;
    }
    if (!forceIds.has(item.id) && !shouldUseIncomingRecruitingPostRow(item, existing)) return;
    const preserveKeys = Object.prototype.hasOwnProperty.call(item, "applicants") && item.listCardOnly !== true ? [] : ["applicants"];
    const next = preserveExistingWhenEmpty(item, existing, preserveKeys);
    if (item.listCardOnly !== true) {
      delete next.listCardOnly;
      delete next.listCounts;
    }
    if (item.__invitationsPartial !== true) delete next.__invitationsPartial;
    if (existing?.roomState && item?.roomState) {
      next.roomState = preserveExistingWhenEmpty(item.roomState, existing.roomState, ["chatMessages", "kickLog"]);
      if (item.__invitationsPartial === true) {
        next.roomState.invitations = mergeRoomInvitations(existing.roomState.invitations, item.roomState.invitations);
      }
    }
    merged.set(item.id, next);
  });
  return [...merged.values()];
}
