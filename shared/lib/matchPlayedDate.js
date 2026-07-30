import { RECORD_TYPES } from "./constants.js";
import { getMatchRecordType } from "./matchRecordTypes.js";

function getDateToken(value = "") {
  return String(value ?? "").match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
}

function getScheduledOccurrence(match = {}) {
  const date = getDateToken(match.scheduledDate ?? match.scheduled_date);
  if (date) {
    const time = String(
      match.scheduledTime ?? match.scheduled_time ?? "",
    ).match(/\d{2}:\d{2}/)?.[0] ?? "12:00";
    return `${date}T${time}:00+09:00`;
  }
  const scheduledAt = String(match.scheduledAt ?? match.scheduled_at ?? "").trim();
  return getDateToken(scheduledAt) ? scheduledAt : "";
}

export function getMatchPlayedAt(match = {}) {
  const recordType = getMatchRecordType(match);
  const authoredRecord = [
    RECORD_TYPES.matchRecord,
    RECORD_TYPES.personalRecord,
  ].includes(recordType);
  return [
    match.occurredAt,
    match.occurred_at,
    match.playedAt,
    match.played_at,
    authoredRecord ? getScheduledOccurrence(match) : "",
    match.startedAt,
    match.started_at,
    match.endedAt,
    match.ended_at,
    match.confirmedAt,
    match.confirmed_at,
    getScheduledOccurrence(match),
    match.createdAt,
    match.created_at,
  ].find((value) => String(value ?? "").trim()) ?? "";
}

export function getMatchPlayedDate(match = {}) {
  const indexedDate = getDateToken(match.recordDate ?? match.record_date);
  if (indexedDate) return indexedDate;
  const explicitDate = getDateToken(match.playedDate ?? match.played_date);
  if (explicitDate) return explicitDate;
  const recordType = getMatchRecordType(match);
  if ([RECORD_TYPES.matchRecord, RECORD_TYPES.personalRecord].includes(recordType)) {
    const authoredDate = getDateToken(
      match.scheduledDate
      ?? match.scheduled_date
      ?? match.scheduledAt
      ?? match.scheduled_at,
    );
    if (authoredDate) return authoredDate;
  }
  const occurredAt = getMatchPlayedAt(match);
  const occurredMs = Date.parse(occurredAt);
  if (Number.isFinite(occurredMs)) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(occurredMs));
  }
  return getDateToken(occurredAt);
}

export function compareMatchRecency(a = {}, b = {}) {
  const aTime = Date.parse(getMatchPlayedAt(a));
  const bTime = Date.parse(getMatchPlayedAt(b));
  if (
    Number.isFinite(aTime)
    && Number.isFinite(bTime)
    && aTime !== bTime
  ) return bTime - aTime;
  return getMatchPlayedDate(b).localeCompare(getMatchPlayedDate(a));
}
