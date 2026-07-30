import {
  MODE_SIZES,
} from "../constants.js";

// P-DEMO-CLEANUP: seed/local-dev only. Production app must not import this module.
export const DEMO_TODAY = "2026-06-18";
export const DEMO_NOW = "2026-06-18T12:00:00";
export const DEMO_QUEUE_START = "2026-06-18";
export const DEMO_QUEUE_TIMES = ["18:00", "19:30", "21:00"];
export const DEMO_PRACTICE_COURT = Object.freeze({
  id: "practice-court",
  name: "연습 경기 구장",
});
export const DELETED_SYNTHETIC_COURT_IDS = new Set(
  Array.from({ length: 12 }, (_item, index) => `c${index + 1}`),
);

export function getDemoQueueSlot(slotIndex) {
  const date = new Date(`${DEMO_QUEUE_START}T00:00:00`);
  date.setDate(date.getDate() + Math.floor(slotIndex / DEMO_QUEUE_TIMES.length));
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const scheduledDate = `${year}-${month}-${day}`;
  const scheduledTime = DEMO_QUEUE_TIMES[slotIndex % DEMO_QUEUE_TIMES.length];
  return {
    scheduledDate,
    scheduledTime,
    scheduledAt: `${scheduledDate} ${scheduledTime}`,
  };
}

export function makeDemoTimestamp(scheduledDate, scheduledTime, extraMinutes = 0) {
  const date = new Date(`${scheduledDate}T${scheduledTime}`);
  date.setMinutes(date.getMinutes() + extraMinutes);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}:00.000Z`;
}

export function makeRelativeDemoDateTime(extraMinutes = 0) {
  const date = new Date();
  date.setSeconds(0, 0);
  date.setMinutes(date.getMinutes() + extraMinutes);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const scheduledDate = `${year}-${month}-${day}`;
  const scheduledTime = `${hours}:${minutes}`;
  return {
    scheduledDate,
    scheduledTime,
    scheduledAt: `${scheduledDate} ${scheduledTime}`,
    iso: `${scheduledDate}T${scheduledTime}:00.000`,
  };
}

export function getDemoModeSize(mode) {
  return MODE_SIZES[mode] ?? 5;
}

export function getTeamDemoPlayerIds(team = {}, capacity = 5) {
  return (team.members ?? [])
    .map((member) => member.userId)
    .slice(0, capacity);
}

export function makeTrustFeedback(stars = {}) {
  return { stars, updatedAt: null };
}

export function makeDefaultRoomState(chatMessages = []) {
  return {
    chatMessages,
    kickLog: [],
    hostPenalties: [],
    invitations: [],
    partyReserves: {},
    reserveReady: {},
    pinnedReservePlayers: {},
    slotPositions: {},
    ruleRevision: 1,
    approvalModeA: "leader",
    approvalModeB: "leader",
  };
}

export function makeDemoStatSubmissions(teamAPlayers = [], teamBPlayers = [], submittedAt, source = "player", by = null) {
  const rows = [
    ...teamAPlayers.map((playerId) => [playerId, { by: by ?? playerId, side: "teamA", source, submittedAt }]),
    ...teamBPlayers.map((playerId) => [playerId, { by: by ?? playerId, side: "teamB", source, submittedAt }]),
  ];
  return Object.fromEntries(rows);
}

export function makeDemoApplicant({
  kind = "player",
  playerId = null,
  teamId = null,
  side = "teamB",
  status = "waiting",
  reserve = false,
  position = null,
  playerIds = [],
  createdAt = "2026-06-15T09:00:00.000Z",
} = {}) {
  const joinMode = kind === "team" || teamId ? "team" : "player";
  return {
    kind: joinMode,
    joinMode,
    playerId,
    teamId: joinMode === "team" ? teamId : null,
    side,
    status,
    reserve,
    position,
    playerIds: joinMode === "team" ? playerIds : [],
    createdAt,
    updatedAt: createdAt,
  };
}
