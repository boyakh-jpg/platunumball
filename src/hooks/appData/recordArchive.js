import { MINUTE_MS } from "../../lib/constants.js";
import { REMOTE_CLIENT_RECORD_LIST_YEARS } from "../../lib/constants.js";
import { REMOTE_CLIENT_RECORD_MONTHS } from "../../lib/constants.js";

const LOCAL_MAINTENANCE_INTERVAL_MS = MINUTE_MS;

const EMPTY_RECORD_ARCHIVE = Object.freeze({
  rows: [],
  personalSummary: null,
  page: {
    detailNextOffset: null,
    detailExhausted: true,
    archiveNextOffset: null,
    archiveExhausted: true,
  },
  windows: {
    detailMonths: REMOTE_CLIENT_RECORD_MONTHS,
    listYears: REMOTE_CLIENT_RECORD_LIST_YEARS,
  },
  loaded: false,
  loading: false,
  error: "",
});

function mergeRecordArchiveRows(existing = [], incoming = [], replace = false) {
  const rows = replace ? [] : [...existing];
  const indexById = new Map(rows.map((row, index) => [row.matchId, index]));
  (incoming ?? []).forEach((row) => {
    if (!row?.matchId) return;
    const index = indexById.get(row.matchId);
    if (index === undefined) {
      indexById.set(row.matchId, rows.length);
      rows.push(row);
    } else {
      rows[index] = { ...rows[index], ...row };
    }
  });
  return rows;
}

function normalizeRecordArchiveOffset(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function mergeRecordPage(existing = EMPTY_RECORD_ARCHIVE.page, incoming = {}) {
  const next = { ...existing };
  if (incoming.detailIncluded === true) {
    next.detailNextOffset = incoming.detailNextOffset ?? null;
    next.detailExhausted = incoming.detailExhausted !== false;
  }
  if (incoming.archiveIncluded === true) {
    next.archiveNextOffset = incoming.archiveNextOffset ?? null;
    next.archiveExhausted = incoming.archiveExhausted !== false;
  }
  return next;
}

export {
  EMPTY_RECORD_ARCHIVE,
  LOCAL_MAINTENANCE_INTERVAL_MS,
  mergeRecordArchiveRows,
  mergeRecordPage,
  normalizeRecordArchiveOffset,
};
