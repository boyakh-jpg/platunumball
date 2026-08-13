import {
  RECORD_TYPES,
  ROOM_KINDS,
} from "./constants.js";

export function getMatchRecordType(match = {}) {
  return match?.rules?.recordType ?? match?.recordType ?? RECORD_TYPES.match;
}

export function isPersonalRecordMatch(match = {}) {
  const recordType = String(getMatchRecordType(match)).trim().toLowerCase();
  return recordType === RECORD_TYPES.personalRecord
    || recordType === ROOM_KINDS.personalRecord;
}

export function isMatchRecordMatch(match = {}) {
  return getMatchRecordType(match) === RECORD_TYPES.matchRecord;
}

export function isRecordKindMatch(match = {}) {
  return isPersonalRecordMatch(match) || isMatchRecordMatch(match);
}

export function getRoomKindFromMatch(match = {}) {
  if (isPersonalRecordMatch(match)) return ROOM_KINDS.personalRecord;
  if (isMatchRecordMatch(match)) return ROOM_KINDS.matchRecord;
  if (match.tournamentId) return ROOM_KINDS.tournament;
  return (match.visibility ?? match.rules?.visibility) === "public"
    ? ROOM_KINDS.publicRecruiting
    : ROOM_KINDS.privateInvite;
}
