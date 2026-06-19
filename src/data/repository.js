import {
  COURTS,
  DISPUTE_WINDOW_MINUTES,
  MAX_TEAM_MEMBERSHIPS,
  MODE_SIZES,
  PLAYER_STAT_FIELDS,
  PLAYER_POSITIONS,
  REFEREE_TRUST_MIN,
  STAT_ENTRY_WINDOW_MINUTES,
  TEAM_ROLES,
} from "../lib/constants.js";
import { initialState } from "../lib/mockData.js";
import {
  getAgreementStatus,
  getApprovalStatus,
  getAllowedStatFields,
  getMatchPlayerIds,
  getMatchRoomPhase,
  getMatchReservePlayerIds,
  getMatchSidePlayerIds,
  getMatchStartDate,
  getMatchTrustFeedbackLimit,
  getMatchTrustFeedbackParticipantIds,
  getPublicRoomTimingStatus,
  getMatchRecordWindow,
  getPlayerSideName,
  getStatRecorderSides,
  getResultPointAudit,
  getStatSubmissionStatus,
  getTeamCaptainId,
  isMatchTrustFeedbackOpen,
  isInstantRoom,
  isEligibleReferee,
  isMatchReferee,
  isMatchStatRecorder,
  normalizeStatRecorders,
  normalizePlayerStats,
} from "../lib/matchUtils.js";
import { applyMatchRating, calculateTeamDelta } from "../lib/rating.js";
import {
  getMercenaryTeamWeight,
  getRecruitingApplicantKey,
  getRecruitingApplicantKind,
  getRecruitingBestSide,
  getRecruitingFit,
  getRecruitingLobby,
  getRecruitingRatingScale,
  getRecruitingRoomOwnerId,
  getRecruitingSideCapacity,
  getSelectableTeamPlayerIds,
  getSelectedTeamPlayerIds,
  hasRecruitingApplicant,
  normalizeRecruitingMmrRangeMode,
  normalizeRecruitingApplicants,
  normalizeRecruitingPost,
  normalizeRecruitingRoomState,
} from "../lib/recruiting.js";
import { clearState, readState, writeState } from "../lib/storage.js";
import { isBulkRemoteWriteEnabled, isSupabaseConfigured, supabase } from "../lib/supabase.js";

const clone = (value) => JSON.parse(JSON.stringify(value));
const makeId = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const DEFAULT_SETTINGS = {
  theme: "dark",
  privacy: {
    regionRanking: true,
    teamHistory: true,
    statSummary: true,
  },
  blockedUserIds: [],
  favoritePlayerIds: [],
  favoriteTeamIds: [],
  favoriteCourtIds: [],
};
const REMOTE_PAGE_SIZE = 1000;
const REMOTE_WRITE_CHUNK_SIZE = 500;
const QUEUE_SCHEDULE_START_DATE = "2026-06-15";
const QUEUE_SCHEDULE_TIMES = ["10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00"];
const POST_MATCH_STATUSES = new Set(["approval", "disputed"]);
const RECORDABLE_RESERVE_SOURCES = new Set(["reserve-entry", "team-reserve"]);
const MAX_RECRUITING_RESERVES_PER_SIDE = 2;
const DAY_MS = 24 * 60 * 60 * 1000;
const SCHEDULE_MAX_DAYS = 365;
const ROOM_SCHEDULE_MAX_DAYS = 30;
const PUBLIC_ROOM_SCHEDULE_MAX_DAYS = 5;
const PUBLIC_ROOM_MIN_LEAD_HOURS = 4;
const LIFECYCLE_TITLE_PATTERN = /^(동의 대기|진행 예정|결과 승인|이의 확인|이의제기|확정|결과 입력)\s*·\s*/;
const POST_MATCH_TITLE_PATTERN = /^(결과 승인|이의 확인|이의제기|확정|결과 입력)\s*·\s*/;
const SIDE_LABEL_TEXT = { teamA: "A사이드", teamB: "B사이드" };
const HOST_TRUST_MIN = {
  rankedPrivate: 70,
  rankedPublic: 75,
  official: 80,
};

function isRecruitingRoomOwner(post = {}, userId = "") {
  return Boolean(userId && getRecruitingRoomOwnerId(post) === userId);
}
let normalizedSaveWarningShown = false;

function clampTrustScore(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value ?? 80))));
}

function adjustUserTrust(users = [], userId, delta) {
  if (!userId || !delta) return users;
  return users.map((user) => (
    user.id === userId
      ? { ...user, trustScore: clampTrustScore((user.trustScore ?? 80) + delta) }
      : user
  ));
}

function getHostTrustRequirement({ ranked = true, visibility = "private", official = false } = {}) {
  if (!ranked) return 0;
  if (official) return HOST_TRUST_MIN.official;
  return visibility === "public" ? HOST_TRUST_MIN.rankedPublic : HOST_TRUST_MIN.rankedPrivate;
}

function getHostTrustBlockNotification(state, draft = {}) {
  const ranked = draft.ranked !== false;
  const visibility = draft.visibility === "public" ? "public" : "private";
  const requiredTrust = getHostTrustRequirement({ ranked, visibility, official: Boolean(draft.official) });
  const currentUser = state.users.find((user) => user.id === state.currentUserId);
  const trustScore = Number(currentUser?.trustScore ?? 0);
  if (!requiredTrust || trustScore >= requiredTrust) return null;
  return {
    id: makeId("n"),
    title: "방장 신뢰도 부족",
    body: `${visibility === "public" ? "공개 정규전" : "정규전"} 방장은 신뢰도 ${requiredTrust}점 이상부터 가능합니다. 현재 ${trustScore}점입니다.`,
    tone: "orange",
  };
}

function getFoulTrustPenalty(stats = {}) {
  const fouls = Math.max(0, Number(stats.fouls ?? 0));
  if (fouls <= 2) return 0;
  return -Math.min(4, fouls - 2);
}

function getRoomScheduleDate(post = {}) {
  if (isInstantRoom(post)) return null;
  if (!post.scheduledDate || !post.scheduledTime) return null;
  const date = new Date(`${post.scheduledDate}T${post.scheduledTime}`);
  return Number.isFinite(date.getTime()) ? date : null;
}

function getRoomClosePenalty(post = {}, nowMs = Date.now()) {
  const applicants = normalizeRecruitingApplicants(post.applicants ?? []);
  const scheduled = getRoomScheduleDate(post);
  const hoursUntil = scheduled ? (scheduled.getTime() - nowMs) / 36e5 : Infinity;
  if (!applicants.length && hoursUntil > 24) return 0;

  let penalty = applicants.length ? 2 : 0;
  if (!post.hostReady) penalty += 2;
  if (hoursUntil < 0) penalty += 8;
  else if (hoursUntil <= 6) penalty += 5;
  else if (hoursUntil <= 24) penalty += 3;
  else if (hoursUntil <= 72) penalty += 1;

  const createdAt = post.createdAt ? new Date(post.createdAt).getTime() : null;
  const shortNotice = scheduled && Number.isFinite(createdAt) && (scheduled.getTime() - createdAt) / 36e5 <= 24;
  if (shortNotice) penalty = Math.max(0, penalty - 2);
  return Math.min(12, penalty);
}

function isRecruitingRoomMember(post = {}, userId, state = {}) {
  if (!userId) return false;
  if (isRecruitingRoomOwner(post, userId)) return true;
  const lobby = getRecruitingLobby(post, state);
  return (lobby.entries ?? []).some((entry) => (
    (entry.players ?? []).includes(userId) ||
    (entry.reserves ?? []).includes(userId)
  ));
}

function isRecruitingRoomParticipant(post = {}, userId, state = null) {
  if (!userId) return false;
  if (state) return isRecruitingRoomMember(post, userId, state);
  if (post.playerId === userId || post.playerIds?.includes(userId)) return true;
  return normalizeRecruitingApplicants(post.applicants ?? []).some((applicant) => (
    applicant.playerId === userId || applicant.playerIds?.includes(userId)
  ));
}

function getRecruitingParticipantEntry(post = {}, state = {}, userId, sideName = null) {
  const lobby = getRecruitingLobby(post, state);
  return (lobby.entries ?? []).find((entry) => (
    (!sideName || entry.side === sideName) &&
    (
      entry.playerId === userId ||
      (entry.players ?? []).includes(userId) ||
      (entry.reserves ?? []).includes(userId)
    )
  )) ?? null;
}

function inferRecruitingInvitationTeamId(post = {}, state = {}, invitation = {}) {
  return invitation.teamId || null;
}

function getExplicitInvitationTeamPlayerIds(team = {}, capacity = Infinity, playerIds = [], fallbackPlayerId = "") {
  const sourceIds = Array.isArray(playerIds) ? playerIds : [fallbackPlayerId];
  const teamPlayerSet = new Set((team?.members ?? []).map((member) => member.userId));
  return uniquePlayerIds(sourceIds).filter((playerId) => teamPlayerSet.has(playerId)).slice(0, capacity);
}

function mergeById(current = [], fallback = []) {
  const currentMap = new Map(current.map((item) => [item.id, item]));
  const mergedDefaults = fallback.map((item) => ({ ...item, ...(currentMap.get(item.id) ?? {}) }));
  const extraItems = current.filter((item) => !fallback.some((fallbackItem) => fallbackItem.id === item.id));
  return [...mergedDefaults, ...extraItems];
}

function addDateDays(dateValue, days) {
  const date = new Date(`${dateValue}T00:00:00`);
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getLocalDateValue(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function getMaxScheduleDateValue(now = new Date(), maxDays = SCHEDULE_MAX_DAYS) {
  return addDateDays(getLocalDateValue(now), maxDays);
}

function isScheduleDateInAllowedWindow(dateValue, now = new Date(), maxDays = SCHEDULE_MAX_DAYS) {
  const value = getDatePart(dateValue);
  if (!value) return false;
  const today = getLocalDateValue(now);
  const maxDate = getMaxScheduleDateValue(now, maxDays);
  return value >= today && value <= maxDate;
}

function getInvalidScheduleNotification(maxDays = SCHEDULE_MAX_DAYS) {
  return {
    id: makeId("n"),
    title: "일정 설정 불가",
    body: maxDays <= ROOM_SCHEDULE_MAX_DAYS
      ? "비공개 경기방 날짜는 오늘부터 1개월 안에서만 만들 수 있습니다."
      : "경기 날짜는 오늘부터 1년 안에서만 만들 수 있습니다.",
    tone: "orange",
  };
}

function getInvalidPublicScheduleNotification(detail = "공개 예약방은 5일 이내, 경기 4시간 이후 시간만 만들 수 있습니다.") {
  return {
    id: makeId("n"),
    title: "공개방 일정 불가",
    body: detail,
    tone: "orange",
  };
}

function getQueueScheduleStartDate(now = new Date()) {
  return [QUEUE_SCHEDULE_START_DATE, getLocalDateValue(now)].sort().at(-1);
}

function getQueueSlot(slotIndex, startDate = getQueueScheduleStartDate()) {
  const date = addDateDays(startDate, Math.floor(slotIndex / QUEUE_SCHEDULE_TIMES.length));
  const time = QUEUE_SCHEDULE_TIMES[slotIndex % QUEUE_SCHEDULE_TIMES.length];
  return {
    scheduledDate: date,
    scheduledTime: time,
    scheduledAt: `${date} ${time}`,
  };
}

function isQueueSlotAllowed(slot, now = new Date()) {
  const date = new Date(`${slot.scheduledDate}T${slot.scheduledTime}`);
  return Number.isFinite(date.getTime()) && date.getTime() > now.getTime() + PUBLIC_ROOM_MIN_LEAD_HOURS * 3600000;
}

function getDatePart(value) {
  return String(value ?? "").match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
}

function getTimePart(value) {
  return String(value ?? "").match(/\d{2}:\d{2}/)?.[0] ?? "";
}

function needsQueueSchedule(post = {}, startDate = getQueueScheduleStartDate()) {
  const date = getDatePart(post.scheduledDate || post.scheduledAt);
  const time = getTimePart(post.scheduledTime || post.scheduledAt);
  const maxDate = addDateDays(startDate, PUBLIC_ROOM_SCHEDULE_MAX_DAYS);
  if (isInstantRoom(post)) return false;
  if (!date || !time || date < startDate || date > maxDate) return true;
  if (!isQueueSlotAllowed({ scheduledDate: date, scheduledTime: time })) return true;
  return !date || !time || date < QUEUE_SCHEDULE_START_DATE || post.scheduledAt === "일정 미정";
}

function getQueueSortKey(post = {}) {
  return `${getDatePart(post.scheduledDate || post.scheduledAt) || QUEUE_SCHEDULE_START_DATE} ${post.createdAt ?? ""} ${post.id ?? ""}`;
}

function getQueueScheduleKey(post = {}) {
  return [getDatePart(post.scheduledDate || post.scheduledAt), getTimePart(post.scheduledTime || post.scheduledAt)].filter(Boolean).join(" ");
}

function isValidQueueScheduleKey(value = "") {
  return Boolean(value.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/));
}

function normalizeRecruitingSchedules(posts = []) {
  const normalizedPosts = posts.map((post) => normalizeRecruitingPost(post));
  const startDate = getQueueScheduleStartDate();
  const scheduleById = new Map();
  const used = new Set(
    normalizedPosts
      .filter((post) => post.status !== "closed" && !needsQueueSchedule(post, startDate))
      .map(getQueueScheduleKey)
      .filter(isValidQueueScheduleKey),
  );
  let slotIndex = 0;

  normalizedPosts
    .filter((post) => post.status !== "closed" && needsQueueSchedule(post, startDate))
    .sort((a, b) => getQueueSortKey(a).localeCompare(getQueueSortKey(b)))
    .forEach((post) => {
      let slot = getQueueSlot(slotIndex, startDate);
      while (used.has(slot.scheduledAt) || !isQueueSlotAllowed(slot)) {
        slotIndex += 1;
        slot = getQueueSlot(slotIndex, startDate);
      }
      scheduleById.set(post.id, slot);
      used.add(slot.scheduledAt);
      slotIndex += 1;
    });

  return normalizedPosts.map((post) => (scheduleById.has(post.id) ? { ...post, ...scheduleById.get(post.id) } : post));
}

function getNextQueueSchedule(posts = []) {
  const startDate = getQueueScheduleStartDate();
  const used = new Set(
    posts
      .filter((post) => post.status !== "closed")
      .map(getQueueScheduleKey)
      .filter(isValidQueueScheduleKey),
  );
  for (let index = 0; index < (PUBLIC_ROOM_SCHEDULE_MAX_DAYS + 1) * QUEUE_SCHEDULE_TIMES.length; index += 1) {
    const slot = getQueueSlot(index, startDate);
    if (!used.has(slot.scheduledAt) && isQueueSlotAllowed(slot)) return slot;
  }
  return getQueueSlot(posts.length, startDate);
}

function getScheduledStartMs(match = {}) {
  if (isInstantRoom(match)) return null;
  const dateText = match.scheduledDate
    ? `${match.scheduledDate}T${match.scheduledTime || "00:00"}`
    : String(match.scheduledAt ?? "").replace(" ", "T");
  const date = new Date(dateText);
  return Number.isFinite(date.getTime()) ? date.getTime() : null;
}

function isFutureScheduledMatch(match = {}) {
  const scheduledMs = getScheduledStartMs(match);
  return Number.isFinite(scheduledMs) && scheduledMs > Date.now();
}

function getPregameMatchTitle(match = {}) {
  const label = match.status === "contract" ? "동의 대기" : "진행 예정";
  const versus = [match.teamA?.name, match.teamB?.name].filter(Boolean).join(" vs ");
  return `${label} · ${versus || String(match.title ?? "").replace(POST_MATCH_TITLE_PATTERN, "") || "경기"}`;
}

function getLifecycleTitleLabel(status) {
  if (status === "contract") return "동의 대기";
  if (status === "agreed") return "진행 예정";
  if (status === "approval") return "결과 승인";
  if (status === "disputed") return "이의 확인";
  if (status === "confirmed") return "확정";
  return "";
}

function repairLifecycleTitle(match) {
  const label = getLifecycleTitleLabel(match.status);
  if (!label || !LIFECYCLE_TITLE_PATTERN.test(match.title ?? "")) return match;
  const versus = [match.teamA?.name, match.teamB?.name].filter(Boolean).join(" vs ");
  return { ...match, title: `${label} · ${versus || String(match.title ?? "").replace(LIFECYCLE_TITLE_PATTERN, "") || "경기"}` };
}

function resetFuturePostMatchState(match) {
  const repaired = { ...match, status: "agreed" };
  const nextRules = { ...(match.rules ?? {}) };
  delete nextRules.startedAt;
  return {
    ...repaired,
    status: "agreed",
    title: getPregameMatchTitle(repaired),
    approvals: { teamA: [], teamB: [] },
    disputes: [],
    result: null,
    ratingResult: null,
    teamRatingResult: null,
    startedAt: null,
    endedAt: null,
    confirmedAt: null,
    rules: nextRules,
    teamA: { ...(match.teamA ?? {}), score: 0 },
    teamB: { ...(match.teamB ?? {}), score: 0 },
  };
}

function clearFuturePregameStartState(match) {
  if (!["contract", "agreed"].includes(match.status) || !isFutureScheduledMatch(match)) return match;
  if (!match.startedAt && !match.rules?.startedAt) return match;
  const nextRules = { ...(match.rules ?? {}) };
  delete nextRules.startedAt;
  return { ...match, startedAt: null, rules: nextRules };
}

function repairFuturePregameTitle(match) {
  if (!["contract", "agreed"].includes(match.status) || !POST_MATCH_TITLE_PATTERN.test(match.title ?? "")) return match;
  return { ...match, title: getPregameMatchTitle(match) };
}

function normalizeDisputeMinutes(match) {
  const minutes = Number(match.disputeMinutes ?? DISPUTE_WINDOW_MINUTES);
  if (!Number.isFinite(minutes) || minutes <= 0) return DISPUTE_WINDOW_MINUTES;
  return Math.min(minutes, DISPUTE_WINDOW_MINUTES);
}

function normalizeMatch(match) {
  const startedStatuses = ["agreed", "approval", "confirmed", "disputed", "void", "cancelled"];
  const started = startedStatuses.includes(match.status);
  const teamAPlayers = match.teamA?.players ?? [];
  const teamBPlayers = match.teamB?.players ?? [];
  const playedPlayerIds = match.playedPlayerIds ?? match.rules?.playedPlayerIds ?? {};
  const normalizedPlayedPlayerIds = {
    teamA: uniquePlayerIds(playedPlayerIds.teamA ?? []),
    teamB: uniquePlayerIds(playedPlayerIds.teamB ?? []),
  };

  const normalized = {
    ...match,
    status: match.status ?? "contract",
    agreements: match.agreements ?? {
      teamA: started ? [...teamAPlayers] : [],
      teamB: started ? [...teamBPlayers] : [],
    },
    approvals: match.approvals ?? { teamA: [], teamB: [] },
    disputes: match.disputes ?? [],
    refereeId: match.refereeId ?? "",
    refereeTrustMin: Number(match.refereeTrustMin ?? REFEREE_TRUST_MIN),
    statRecorders: normalizeStatRecorders(match.statRecorders ?? match.rules?.statRecorders),
    statEntryMinutes: Number(match.statEntryMinutes ?? STAT_ENTRY_WINDOW_MINUTES),
    disputeMinutes: normalizeDisputeMinutes(match),
    trustFeedback: match.trustFeedback ?? {},
    playedPlayerIds: normalizedPlayedPlayerIds,
    rules: {
      ...(match.rules ?? {}),
      playedPlayerIds: normalizedPlayedPlayerIds,
    },
  };

  const pregameStartRepaired = clearFuturePregameStartState(normalized);

  if (isFutureScheduledMatch(pregameStartRepaired)) {
    if (POST_MATCH_STATUSES.has(pregameStartRepaired.status)) {
      return resetFuturePostMatchState(pregameStartRepaired);
    }
    return repairFuturePregameTitle(repairLifecycleTitle(pregameStartRepaired));
  }

  return repairLifecycleTitle(pregameStartRepaired);
}

function normalizeSettings(settings = {}) {
  const theme = settings.theme === "light" ? "light" : "dark";
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    theme,
    privacy: {
      ...DEFAULT_SETTINGS.privacy,
      ...(settings.privacy ?? {}),
    },
    blockedUserIds: settings.blockedUserIds ?? [],
    favoritePlayerIds: settings.favoritePlayerIds ?? initialState.settings?.favoritePlayerIds ?? [],
    favoriteTeamIds: settings.favoriteTeamIds ?? initialState.settings?.favoriteTeamIds ?? [],
    favoriteCourtIds: settings.favoriteCourtIds ?? initialState.settings?.favoriteCourtIds ?? [],
  };
}

function normalizeTournament(tournament = {}) {
  const teamIds = tournament.teamIds ?? [];
  const teamStatuses = {
    ...Object.fromEntries(teamIds.map((teamId) => [teamId, "invited"])),
    ...(tournament.teamStatuses ?? {}),
  };

  return {
    ...tournament,
    status: tournament.status ?? "draft",
    teamIds,
    teamStatuses,
    teamApprovals: tournament.teamApprovals ?? {},
    matchIds: tournament.matchIds ?? [],
    bracket: tournament.bracket ?? null,
  };
}

function ensureDemoRecruitingInvitation(post = {}) {
  if (post.id !== "q2" || post.status === "closed") return post;
  const alreadyApplied = hasRecruitingApplicant(post, { kind: "player", playerId: "u1" });
  if (alreadyApplied) return post;
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  if (roomState.demoInviteQ2Seeded) return { ...post, roomState };
  const hasInvite = roomState.invitations.some((invitation) => invitation.targetUserId === "u1");
  if (hasInvite) return { ...post, roomState: { ...roomState, demoInviteQ2Seeded: true } };

  return {
    ...post,
    roomState: {
      ...roomState,
      demoInviteQ2Seeded: true,
      invitations: [
        ...roomState.invitations,
        {
          id: "inv-demo-q2-u1",
          targetUserId: "u1",
          fromUserId: "u9",
          teamId: null,
          side: "teamA",
          reserve: false,
          status: "pending",
          createdAt: "2026-06-15T09:05:00.000Z",
          updatedAt: "2026-06-15T09:05:00.000Z",
        },
      ],
    },
  };
}

function normalizeState(state) {
  const notifications = state?.notifications?.length ? state.notifications : initialState.notifications;
  const deletedTeamIds = new Set(state?.deletedTeamIds ?? []);

  return {
    ...clone(initialState),
    ...state,
    deletedTeamIds: Array.from(deletedTeamIds),
    users: mergeById(state?.users, initialState.users),
    teams: mergeById(state?.teams, initialState.teams).filter((team) => !deletedTeamIds.has(team.id)),
    affiliations: mergeById(state?.affiliations, initialState.affiliations).filter((affiliation) => affiliation.type !== "club"),
    seasons: mergeById(state?.seasons, initialState.seasons ?? []),
    matches: mergeById(state?.matches, initialState.matches).map(normalizeMatch),
    tournaments: mergeById(state?.tournaments, initialState.tournaments ?? []).map(normalizeTournament),
    notifications: notifications.map((notification) => ({ readAt: null, ...notification })),
    settings: normalizeSettings(state?.settings ?? initialState.settings),
    reports: state?.reports ?? initialState.reports ?? [],
    recruitingPosts: normalizeRecruitingSchedules(mergeById(state?.recruitingPosts, initialState.recruitingPosts ?? []))
      .map(ensureDemoRecruitingInvitation)
      .map(normalizeRecruitingPost),
  };
}

export function loadState() {
  return runAutomaticStateMaintenance(normalizeState(readState(clone(initialState))));
}

export function saveState(state) {
  writeState(state);
}

async function fetchAllRows(table, select = "*", order = "id") {
  const rows = [];
  for (let from = 0; ; from += REMOTE_PAGE_SIZE) {
    const to = from + REMOTE_PAGE_SIZE - 1;
    const query = supabase.from(table).select(select).range(from, to);
    const { data, error } = order ? await query.order(order, { ascending: true }) : await query;
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < REMOTE_PAGE_SIZE) break;
  }
  return rows;
}

function groupBy(rows, key) {
  return rows.reduce((map, row) => {
    const value = row[key];
    if (!map.has(value)) map.set(value, []);
    map.get(value).push(row);
    return map;
  }, new Map());
}

function firstBy(rows, key) {
  return Object.fromEntries(rows.map((row) => [row[key], row]));
}

function toDateTime(date, time, fallback) {
  if (date && time) return `${date} ${String(time).slice(0, 5)}`;
  if (date) return date;
  return fallback ?? "일정 미정";
}

function fromRemoteProfile(row) {
  return {
    id: row.id,
    name: row.name,
    handle: row.handle,
    position: row.position,
    region: row.region,
    school: row.school,
    company: row.company,
    club: row.club,
    trustScore: row.trust_score ?? 80,
    streak: row.streak ?? 0,
    avatarColor: row.avatar_color,
    testLoginId: row.test_login_id,
    testPassword: "test-0000",
    ratings: row.ratings ?? { integrated: 1200, modes: {} },
  };
}

function fromRemoteTeam(row, memberRows) {
  return {
    id: row.id,
    name: row.name,
    homeCourt: row.home_court,
    region: row.region,
    mmr: row.mmr ?? 1200,
    wins: row.wins ?? 0,
    losses: row.losses ?? 0,
    accent: row.accent,
    members: [...(memberRows ?? [])]
      .sort((a, b) => String(a.role).localeCompare(String(b.role)) || String(a.user_id).localeCompare(String(b.user_id)))
      .map((member) => ({ userId: member.user_id, role: member.role ?? "regular" })),
  };
}

function fromRemoteMatch(row, context) {
  const teamAPlayers = [...(context.playersByMatch.get(row.id) ?? [])]
    .filter((player) => player.side === "teamA")
    .sort((a, b) => (a.slot_order ?? 0) - (b.slot_order ?? 0))
    .map((player) => player.user_id);
  const teamBPlayers = [...(context.playersByMatch.get(row.id) ?? [])]
    .filter((player) => player.side === "teamB")
    .sort((a, b) => (a.slot_order ?? 0) - (b.slot_order ?? 0))
    .map((player) => player.user_id);
  const resultRow = context.resultsByMatch[row.id];
  const statRows = context.statsByMatch.get(row.id) ?? [];
  const playerStats = Object.fromEntries(
    statRows.map((stat) => [
      stat.user_id,
      {
        points: stat.points ?? 0,
        rebounds: stat.rebounds ?? 0,
        assists: stat.assists ?? 0,
        steals: stat.steals ?? 0,
        blocks: stat.blocks ?? 0,
        fouls: stat.fouls ?? 0,
      },
    ]),
  );
  const disputes = (context.disputesByMatch.get(row.id) ?? []).map((dispute) => ({
    id: dispute.id,
    by: dispute.user_id,
    reason: dispute.reason,
    createdAt: dispute.created_at,
  }));
  const agreements = {
    teamA: (context.agreementsByMatch.get(row.id) ?? []).filter((item) => item.side === "teamA").map((item) => item.user_id),
    teamB: (context.agreementsByMatch.get(row.id) ?? []).filter((item) => item.side === "teamB").map((item) => item.user_id),
  };
  const approvals = {
    teamA: (context.approvalsByMatch.get(row.id) ?? []).filter((item) => item.side === "teamA").map((item) => item.user_id),
    teamB: (context.approvalsByMatch.get(row.id) ?? []).filter((item) => item.side === "teamB").map((item) => item.user_id),
  };
  const teamA = context.teamById[row.team_a_id];
  const teamB = context.teamById[row.team_b_id];
  const rawScheduledAt = toDateTime(row.scheduled_date, row.scheduled_time, row.scheduled_at);
  const timingType = row.rules?.timingType === "instant" || rawScheduledAt === "즉시" ? "instant" : "scheduled";
  const scheduledAt = timingType === "instant" ? "즉시" : rawScheduledAt;

  return {
    id: row.id,
    title: row.title,
    mode: row.mode,
    court: row.court_name ?? context.courtById[row.court_id]?.name ?? "미정",
    scheduledDate: row.scheduled_date,
    scheduledTime: row.scheduled_time ? String(row.scheduled_time).slice(0, 5) : "",
    scheduledAt,
    timingType,
    status: row.status ?? "contract",
    official: Boolean(row.official),
    preRegistered: Boolean(row.pre_registered),
    rules: row.rules ?? {},
    memo: row.memo,
    stakes: row.stakes,
    ranked: row.ranked !== false,
    mmrLimitMode: row.mmr_limit_mode ?? "block",
    mmrRangeMode: row.rules?.mmrRangeMode,
    ratingScale: row.rules?.ratingScale,
    trustFeedback: row.trust_feedback ?? {},
    refereeId: row.referee_id ?? "",
    refereeTrustMin: row.referee_trust_min ?? REFEREE_TRUST_MIN,
    statRecorders: normalizeStatRecorders(row.stat_recorders ?? row.rules?.statRecorders),
    statEntryMinutes: row.stat_entry_minutes ?? STAT_ENTRY_WINDOW_MINUTES,
    disputeMinutes: row.dispute_minutes ?? DISPUTE_WINDOW_MINUTES,
    tournamentId: row.tournament_id,
    tournamentFormat: row.tournament_format,
    tournamentRound: row.tournament_round,
    tournamentFixture: row.tournament_fixture,
    tournamentMmrPolicy: row.tournament_mmr_policy,
    objectionWindow: row.objection_window,
    evidence: row.evidence ?? [],
    teamA: { name: teamA?.name ?? "Team A", teamId: row.team_a_id, players: teamAPlayers, score: row.score_a ?? 0 },
    teamB: { name: teamB?.name ?? "Team B", teamId: row.team_b_id, players: teamBPlayers, score: row.score_b ?? 0 },
    agreements,
    approvals,
    disputes,
    result: resultRow
      ? {
          scoreA: resultRow.score_a,
          scoreB: resultRow.score_b,
          playerStats,
          statSubmissions: resultRow.stat_submissions ?? {},
          submittedBy: resultRow.submitted_by,
          submittedAt: resultRow.submitted_at,
        }
      : null,
    ratingResult: Array.isArray(row.rating_result) ? row.rating_result : null,
    teamRatingResult: row.team_rating_result && !Array.isArray(row.team_rating_result) ? row.team_rating_result : null,
    createdAt: row.created_at,
    agreedAt: row.agreed_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    confirmedAt: row.confirmed_at,
    cancelledAt: row.cancelled_at,
    voidedAt: row.voided_at,
  };
}

function getMaxUpdatedAt(rows) {
  const timestamps = rows
    .map((row) => row.updated_at ?? row.created_at)
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter((value) => !Number.isNaN(value));
  return timestamps.length ? Math.max(...timestamps) : 0;
}

async function loadNormalizedRemoteState() {
  const [
    profiles,
    teams,
    teamMembers,
    courts,
    matches,
    matchPlayers,
    matchResults,
    playerStats,
    agreements,
    approvals,
    disputes,
    favorites,
    recruitingPosts,
    recruitingApplications,
    tournaments,
    tournamentTeams,
    seasons,
    affiliations,
    notifications,
    reports,
  ] = await Promise.all([
    fetchAllRows("profiles"),
    fetchAllRows("teams"),
    fetchAllRows("team_members", "*", null),
    fetchAllRows("courts"),
    fetchAllRows("matches", "*", "created_at"),
    fetchAllRows("match_players", "*", null),
    fetchAllRows("match_results", "*", null),
    fetchAllRows("player_match_stats", "*", null),
    fetchAllRows("match_agreements", "*", null),
    fetchAllRows("match_approvals", "*", null),
    fetchAllRows("match_disputes", "*", null),
    fetchAllRows("favorites", "*", null),
    fetchAllRows("recruiting_posts", "*", "created_at"),
    fetchAllRows("recruiting_applications", "*", null),
    fetchAllRows("tournaments", "*", "created_at"),
    fetchAllRows("tournament_teams", "*", null),
    fetchAllRows("seasons"),
    fetchAllRows("affiliations"),
    fetchAllRows("notifications", "*", "created_at"),
    fetchAllRows("reports", "*", "created_at"),
  ]);

  if (!profiles.length || !matches.length) return null;

  const currentUserId = initialState.currentUserId;
  const teamMembersByTeam = groupBy(teamMembers, "team_id");
  const teamById = firstBy(teams, "id");
  const courtById = firstBy(courts, "id");
  const context = {
    teamById,
    courtById,
    playersByMatch: groupBy(matchPlayers, "match_id"),
    resultsByMatch: firstBy(matchResults, "match_id"),
    statsByMatch: groupBy(playerStats, "match_id"),
    agreementsByMatch: groupBy(agreements, "match_id"),
    approvalsByMatch: groupBy(approvals, "match_id"),
    disputesByMatch: groupBy(disputes, "match_id"),
  };
  const deletedTeamIds = teams.filter((team) => team.deleted_at).map((team) => team.id);
  const remoteTeams = teams
    .filter((team) => !team.deleted_at)
    .map((team) => fromRemoteTeam(team, teamMembersByTeam.get(team.id)));
  const remoteMatches = matches.map((match) => fromRemoteMatch(match, context)).sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
  const favoriteRows = favorites.filter((favorite) => favorite.user_id === currentUserId);
  const applicationsByPost = groupBy(recruitingApplications, "post_id");
  const tournamentTeamsByTournament = groupBy(tournamentTeams, "tournament_id");

  const normalizedState = normalizeState({
    currentUserId,
    deletedTeamIds,
    users: profiles.map(fromRemoteProfile),
    teams: remoteTeams,
    matches: remoteMatches,
    affiliations: affiliations
      .filter((affiliation) => affiliation.type !== "club")
      .map((affiliation) => ({
        id: affiliation.id,
        type: affiliation.type,
        name: affiliation.name,
        score: affiliation.score ?? 0,
        wins: affiliation.wins ?? 0,
        losses: affiliation.losses ?? 0,
      })),
    seasons: seasons.map((season) => ({
      id: season.id,
      name: season.name,
      subtitle: season.subtitle,
      startsAt: season.starts_at,
      endsAt: season.ends_at,
      active: Boolean(season.active),
      regions: season.regions ?? [],
      promotionLine: season.promotion_line ?? 0,
      rules: season.rules ?? [],
    })),
    notifications: notifications
      .filter((notification) => !notification.user_id || notification.user_id === currentUserId)
      .map((notification) => ({
        id: notification.id,
        title: notification.title,
        body: notification.body,
        tone: notification.tone,
        matchId: notification.match_id,
        readAt: notification.read_at,
      })),
    reports: reports.map((report) => ({
      id: report.id,
      type: report.type,
      targetId: report.target_id,
      by: report.user_id,
      reason: report.reason,
      status: report.status,
      createdAt: report.created_at,
    })),
    recruitingPosts: recruitingPosts.map((post) => {
      const rawScheduledAt = toDateTime(post.scheduled_date, post.scheduled_time, post.scheduled_at);
      const roomState = normalizeRecruitingRoomState(post.room_state ?? {});
      const timingType = roomState.timingType === "instant" || rawScheduledAt === "즉시" ? "instant" : "scheduled";
      const scheduledAt = timingType === "instant" ? "즉시" : rawScheduledAt;
      return {
        id: post.id,
        type: post.type,
        title: post.title,
        region: post.region,
        court: post.court_name ?? courtById[post.court_id]?.name ?? "미정",
        mode: post.mode,
        scheduledDate: post.scheduled_date,
        scheduledTime: post.scheduled_time ? String(post.scheduled_time).slice(0, 5) : "",
        scheduledAt,
        timingType,
        ranked: post.ranked,
        spots: post.spots,
        teamId: post.team_id,
        targetTeamId: post.target_team_id,
        refereeId: post.referee_id ?? "",
        refereeTrustMin: post.referee_trust_min ?? REFEREE_TRUST_MIN,
        statEntryMinutes: post.stat_entry_minutes ?? STAT_ENTRY_WINDOW_MINUTES,
        disputeMinutes: post.dispute_minutes ?? DISPUTE_WINDOW_MINUTES,
        roomState,
        teamOnly: roomState.teamOnly === true,
        hostJoinMode: post.host_join_mode,
        hostSide: post.host_side,
        hostReady: post.host_ready,
        sideCapacity: post.side_capacity,
        playerIds: post.player_ids ?? [],
        position: post.position,
        playerId: post.player_id,
        memo: post.memo,
        status: post.status,
        confirmedAt: post.confirmed_at,
        createdAt: post.created_at,
        applicants: (applicationsByPost.get(post.id) ?? []).map((application) => ({
          kind: application.kind,
          joinMode: application.kind,
          teamId: application.team_id,
          playerId: application.player_id,
          side: application.side,
          status: application.status,
          reserve: application.reserve,
          position: application.position,
          playerIds: application.player_ids ?? [],
          createdAt: application.created_at,
          updatedAt: application.updated_at,
        })),
      };
    }),
    tournaments: tournaments.map((tournament) => {
      const teamRows = [...(tournamentTeamsByTournament.get(tournament.id) ?? [])]
        .sort((a, b) => (a.seed_order ?? 0) - (b.seed_order ?? 0));
      const rowTeamStatuses = Object.fromEntries(teamRows.map((team) => [team.team_id, team.status ?? "invited"]));
      const rowTeamApprovals = Object.fromEntries(
        teamRows
          .filter((team) => team.approved_by || team.approved_at)
          .map((team) => [team.team_id, { by: team.approved_by, approvedAt: team.approved_at }]),
      );
      return {
        id: tournament.id,
        title: tournament.title,
        format: tournament.format,
        visibility: tournament.visibility,
        status: tournament.status,
        region: tournament.region,
        court: tournament.court_name,
        mode: tournament.mode,
        ranked: tournament.ranked,
        official: tournament.official,
        startDate: tournament.start_date,
        endDate: tournament.end_date,
        schedulePolicy: tournament.schedule_policy,
        scheduleNote: tournament.schedule_note,
        mmrLimitMode: tournament.mmr_limit_mode,
        maxMmrGap: tournament.max_mmr_gap,
        mmrPolicy: tournament.mmr_policy,
        rules: tournament.rules ?? {},
        memo: tournament.memo,
        createdBy: tournament.created_by,
        createdAt: tournament.created_at,
        startedAt: tournament.started_at,
        matchIds: tournament.match_ids ?? [],
        teamStatuses: { ...rowTeamStatuses, ...(tournament.team_statuses ?? {}) },
        teamApprovals: { ...rowTeamApprovals, ...(tournament.team_approvals ?? {}) },
        bracket: tournament.bracket ?? null,
        teamIds: teamRows.map((team) => team.team_id),
      };
    }),
    settings: {
      ...DEFAULT_SETTINGS,
      ...(initialState.settings ?? {}),
      favoritePlayerIds: favoriteRows.filter((favorite) => favorite.target_type === "player").map((favorite) => favorite.target_id),
      favoriteTeamIds: favoriteRows.filter((favorite) => favorite.target_type === "team").map((favorite) => favorite.target_id),
      favoriteCourtIds: favoriteRows.filter((favorite) => favorite.target_type === "court").map((favorite) => favorite.target_id),
    },
  });
  return {
    state: normalizedState,
    updatedAt: Math.max(
      getMaxUpdatedAt(profiles),
      getMaxUpdatedAt(teams),
      getMaxUpdatedAt(matches),
      getMaxUpdatedAt(recruitingPosts),
      getMaxUpdatedAt(tournaments),
    ),
  };
}

export async function loadRemoteState() {
  if (!isSupabaseConfigured) return null;

  try {
    const normalizedRemote = await loadNormalizedRemoteState();
    return normalizedRemote?.state ? runAutomaticStateMaintenance(normalizedRemote.state) : null;
  } catch (error) {
    console.warn("Supabase normalized state load failed. Local demo mode remains active.", error.message);
    return null;
  }
}

function chunkRows(rows, size = REMOTE_WRITE_CHUNK_SIZE) {
  const chunks = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

async function upsertRemoteRows(table, rows, onConflict) {
  if (!rows.length) return;
  for (const chunk of chunkRows(rows)) {
    const { error } = await supabase.from(table).upsert(chunk, onConflict ? { onConflict } : undefined);
    if (error) throw error;
  }
}

async function softDeleteRemoteTeams(teamIds = []) {
  if (!teamIds.length) return;
  for (const chunk of chunkRows(teamIds)) {
    const deletedAt = new Date().toISOString();
    let response = await supabase.from("team_members").delete().in("team_id", chunk);
    if (response.error) throw response.error;

    response = await supabase.from("favorites").delete().eq("target_type", "team").in("target_id", chunk);
    if (response.error) throw response.error;

    response = await supabase.from("recruiting_posts").update({ status: "closed", updated_at: deletedAt }).in("team_id", chunk);
    if (response.error) throw response.error;

    response = await supabase.from("teams").update({ deleted_at: deletedAt, updated_at: deletedAt }).in("id", chunk);
    if (response.error) throw response.error;
  }
}

async function replaceRemoteRecruitingApplications(postIds = [], applicationRows = []) {
  for (const chunk of chunkRows(postIds)) {
    const { error } = await supabase.from("recruiting_applications").delete().in("post_id", chunk);
    if (error) throw error;
  }

  await upsertRemoteRows("recruiting_applications", applicationRows, "post_id,player_id,kind");
}

function courtIdByName(courtName) {
  return COURTS.find((court) => court.name === courtName)?.id ?? null;
}

function toDbTime(value) {
  return value ? String(value).slice(0, 5) : null;
}

async function saveNormalizedRemoteState(state) {
  const currentUserId = state.currentUserId ?? initialState.currentUserId;
  const deletedTeamIds = state.deletedTeamIds ?? [];
  const profileRows = state.users.map((user) => ({
    id: user.id,
    name: user.name,
    handle: user.handle,
    region: user.region,
    position: user.position,
    avatar_color: user.avatarColor,
    trust_score: user.trustScore ?? 80,
    ratings: user.ratings ?? {},
    school: user.school,
    company: user.company,
    club: user.club,
    streak: user.streak ?? 0,
    test_login_id: user.testLoginId,
    updated_at: new Date().toISOString(),
  }));
  const teamRows = state.teams.map((team) => ({
    id: team.id,
    name: team.name,
    region: team.region,
    home_court: team.homeCourt,
    mmr: team.mmr ?? 1200,
    wins: team.wins ?? 0,
    losses: team.losses ?? 0,
    accent: team.accent,
    updated_at: new Date().toISOString(),
  }));
  const teamMemberRows = state.teams.flatMap((team) =>
    team.members.map((member) => ({
      team_id: team.id,
      user_id: member.userId,
      role: member.role ?? "regular",
    })),
  );
  const matchRows = state.matches.map((match) => ({
    id: match.id,
    title: match.title,
    mode: match.mode,
    court_id: courtIdByName(match.court),
    court_name: match.court,
    status: match.status ?? "contract",
    ranked: match.ranked !== false,
    mmr_limit_mode: match.mmrLimitMode ?? "block",
    trust_feedback: match.trustFeedback ?? {},
    referee_id: match.refereeId || null,
    referee_trust_min: Number(match.refereeTrustMin ?? REFEREE_TRUST_MIN),
    stat_entry_minutes: Number(match.statEntryMinutes ?? STAT_ENTRY_WINDOW_MINUTES),
    dispute_minutes: Number(match.disputeMinutes ?? DISPUTE_WINDOW_MINUTES),
    tournament_id: match.tournamentId ?? null,
    tournament_format: match.tournamentFormat ?? null,
    tournament_round: match.tournamentRound ?? null,
    tournament_fixture: match.tournamentFixture ?? null,
    tournament_mmr_policy: match.tournamentMmrPolicy ?? null,
    official: Boolean(match.official),
    pre_registered: Boolean(match.preRegistered),
    scheduled_at: match.scheduledAt && !["일정 미정", "즉시"].includes(match.scheduledAt) ? match.scheduledAt : null,
    scheduled_date: match.scheduledDate || null,
    scheduled_time: toDbTime(match.scheduledTime),
    team_a_id: match.teamA?.teamId,
    team_b_id: match.teamB?.teamId,
    score_a: Number(match.result?.scoreA ?? match.teamA?.score ?? 0),
    score_b: Number(match.result?.scoreB ?? match.teamB?.score ?? 0),
    rules: { ...(match.rules ?? {}), timingType: match.timingType ?? match.rules?.timingType ?? "scheduled", statRecorders: normalizeStatRecorders(match.statRecorders ?? match.rules?.statRecorders) },
    memo: match.memo,
    stakes: match.stakes,
    objection_window: match.objectionWindow,
    evidence: match.evidence ?? [],
    created_by: match.teamA?.players?.[0] ?? currentUserId,
    created_at: match.createdAt,
    agreed_at: match.agreedAt,
    started_at: match.startedAt ?? null,
    ended_at: match.endedAt ?? null,
    confirmed_at: match.confirmedAt,
    cancelled_at: match.cancelledAt,
    voided_at: match.voidedAt,
    rating_result: match.ratingResult ?? null,
    team_rating_result: match.teamRatingResult ?? null,
    updated_at: new Date().toISOString(),
  }));
  const matchPlayerRows = state.matches.flatMap((match) => [
    ...(match.teamA?.players ?? []).map((userId, index) => ({
      match_id: match.id,
      team_id: match.teamA.teamId,
      user_id: userId,
      side: "teamA",
      slot_order: index,
    })),
    ...(match.teamB?.players ?? []).map((userId, index) => ({
      match_id: match.id,
      team_id: match.teamB.teamId,
      user_id: userId,
      side: "teamB",
      slot_order: index,
    })),
  ]);
  const resultRows = state.matches
    .filter((match) => match.result)
    .map((match) => ({
      match_id: match.id,
      submitted_by: match.result.submittedBy ?? match.refereeId ?? match.teamA?.players?.[0] ?? currentUserId,
      score_a: Number(match.result.scoreA ?? match.teamA?.score ?? 0),
      score_b: Number(match.result.scoreB ?? match.teamB?.score ?? 0),
      stat_submissions: match.result.statSubmissions ?? {},
      submitted_at: match.result.submittedAt,
    }));
  const statRows = state.matches.flatMap((match) =>
    Object.entries(match.result?.playerStats ?? {}).map(([userId, stat]) => ({
      match_id: match.id,
      user_id: userId,
      recorded_by: match.result?.statSubmissions?.[userId]?.by ?? null,
      record_source: match.result?.statSubmissions?.[userId]?.source ?? "player",
      points: Number(stat.points ?? 0),
      rebounds: Number(stat.rebounds ?? 0),
      assists: Number(stat.assists ?? 0),
      steals: Number(stat.steals ?? 0),
      blocks: Number(stat.blocks ?? 0),
      fouls: Number(stat.fouls ?? 0),
      updated_at: new Date().toISOString(),
    })),
  );
  const agreementRows = state.matches.flatMap((match) => [
    ...(match.agreements?.teamA ?? []).map((userId) => ({ match_id: match.id, user_id: userId, side: "teamA" })),
    ...(match.agreements?.teamB ?? []).map((userId) => ({ match_id: match.id, user_id: userId, side: "teamB" })),
  ]);
  const approvalRows = state.matches.flatMap((match) => [
    ...(match.approvals?.teamA ?? []).map((userId) => ({ match_id: match.id, user_id: userId, side: "teamA" })),
    ...(match.approvals?.teamB ?? []).map((userId) => ({ match_id: match.id, user_id: userId, side: "teamB" })),
  ]);
  const favoriteRows = [
    ...(state.settings?.favoritePlayerIds ?? []).map((targetId) => ({ user_id: currentUserId, target_type: "player", target_id: targetId })),
    ...(state.settings?.favoriteTeamIds ?? []).map((targetId) => ({ user_id: currentUserId, target_type: "team", target_id: targetId })),
    ...(state.settings?.favoriteCourtIds ?? []).map((targetId) => ({ user_id: currentUserId, target_type: "court", target_id: targetId })),
  ];
  const recruitingRows = (state.recruitingPosts ?? []).map((post) => ({
    id: post.id,
    type: post.type,
    player_id: post.playerId,
    team_id: post.teamId,
    region: post.region,
    court_id: courtIdByName(post.court),
    court_name: post.court,
    mode: post.mode,
    scheduled_date: post.scheduledDate || null,
    scheduled_time: toDbTime(post.scheduledTime),
    scheduled_at: post.scheduledAt && !["일정 미정", "즉시"].includes(post.scheduledAt) ? post.scheduledAt : null,
    ranked: post.ranked !== false,
    spots: post.spots ?? 1,
    target_team_id: post.targetTeamId ?? null,
    referee_id: post.refereeId || null,
    referee_trust_min: Number(post.refereeTrustMin ?? REFEREE_TRUST_MIN),
    stat_entry_minutes: Number(post.statEntryMinutes ?? STAT_ENTRY_WINDOW_MINUTES),
    dispute_minutes: Number(post.disputeMinutes ?? DISPUTE_WINDOW_MINUTES),
    room_state: { ...normalizeRecruitingRoomState(post.roomState ?? {}), ownerId: getRecruitingRoomOwnerId(post), timingType: post.timingType ?? post.roomState?.timingType ?? "scheduled" },
    host_join_mode: post.hostJoinMode ?? (post.teamId ? "team" : "player"),
    host_side: post.hostSide ?? "teamA",
    host_ready: Boolean(post.hostReady),
    side_capacity: getRecruitingSideCapacity(post),
    player_ids: post.playerIds ?? [],
    position: post.position,
    memo: post.memo,
    status: post.status ?? "open",
    confirmed_at: post.confirmedAt ?? null,
    created_at: post.createdAt,
    updated_at: new Date().toISOString(),
  }));
  const applicationRows = (state.recruitingPosts ?? []).flatMap((post) =>
    (post.applicants ?? []).map((application) => ({
      post_id: post.id,
      player_id: application.playerId,
      team_id: application.teamId,
      kind: application.kind ?? "player",
      side: application.side ?? "teamB",
      status: application.status ?? "waiting",
      reserve: Boolean(application.reserve),
      position: application.position ?? null,
      player_ids: application.playerIds ?? [],
      created_at: application.createdAt,
      updated_at: application.updatedAt ?? application.createdAt,
    })),
  ).filter((application) => application.player_id);
  const recruitingPostIds = (state.recruitingPosts ?? []).map((post) => post.id).filter(Boolean);
  const tournamentRows = (state.tournaments ?? []).map((tournament) => ({
    id: tournament.id,
    title: tournament.title,
    format: tournament.format ?? "league",
    visibility: tournament.visibility ?? "private",
    status: tournament.status ?? "draft",
    region: tournament.region,
    court_name: tournament.court,
    mode: tournament.mode,
    ranked: tournament.ranked !== false,
    official: Boolean(tournament.official),
    start_date: tournament.startDate || null,
    end_date: tournament.endDate || null,
    schedule_policy: tournament.schedulePolicy ?? "weekly",
    schedule_note: tournament.scheduleNote,
    mmr_limit_mode: tournament.mmrLimitMode ?? "warn",
    max_mmr_gap: Number(tournament.maxMmrGap ?? 250),
    mmr_policy: tournament.mmrPolicy ?? "gap_adjusted",
    rules: tournament.rules ?? {},
    memo: tournament.memo,
    created_by: tournament.createdBy ?? currentUserId,
    created_at: tournament.createdAt,
    started_at: tournament.startedAt ?? null,
    match_ids: tournament.matchIds ?? [],
    team_statuses: tournament.teamStatuses ?? {},
    team_approvals: tournament.teamApprovals ?? {},
    bracket: tournament.bracket ?? {},
    updated_at: new Date().toISOString(),
  }));
  const tournamentTeamRows = (state.tournaments ?? []).flatMap((tournament) =>
    (tournament.teamIds ?? []).map((teamId, index) => ({
      tournament_id: tournament.id,
      team_id: teamId,
      seed_order: index + 1,
      status: tournament.teamStatuses?.[teamId] ?? "invited",
      approved_by: tournament.teamApprovals?.[teamId]?.by ?? null,
      approved_at: tournament.teamApprovals?.[teamId]?.approvedAt ?? null,
    })),
  );

  await softDeleteRemoteTeams(deletedTeamIds);
  await upsertRemoteRows("profiles", profileRows, "id");
  await upsertRemoteRows("teams", teamRows, "id");
  await upsertRemoteRows("team_members", teamMemberRows, "team_id,user_id");
  await upsertRemoteRows("matches", matchRows, "id");
  await upsertRemoteRows("match_players", matchPlayerRows, "match_id,user_id");
  await upsertRemoteRows("match_results", resultRows, "match_id");
  await upsertRemoteRows("player_match_stats", statRows, "match_id,user_id");
  await upsertRemoteRows("match_agreements", agreementRows, "match_id,user_id");
  await upsertRemoteRows("match_approvals", approvalRows, "match_id,user_id");

  await supabase.from("favorites").delete().eq("user_id", currentUserId);
  await upsertRemoteRows("favorites", favoriteRows, "user_id,target_type,target_id");
  await upsertRemoteRows("recruiting_posts", recruitingRows, "id");
  await replaceRemoteRecruitingApplications(recruitingPostIds, applicationRows);
  await upsertRemoteRows("tournaments", tournamentRows, "id");
  await upsertRemoteRows("tournament_teams", tournamentTeamRows, "tournament_id,team_id");
}

export async function saveRemoteState(state) {
  if (!isSupabaseConfigured) return;
  if (!isBulkRemoteWriteEnabled) return;

  const sharedState = { ...state, currentUserId: initialState.currentUserId };
  try {
    await saveNormalizedRemoteState(sharedState);
  } catch (normalizedError) {
    if (!normalizedSaveWarningShown) {
      normalizedSaveWarningShown = true;
      console.warn("Supabase normalized save failed. Local state remains available.", normalizedError.message);
    }
  }
}

export function subscribeRemoteState() {
  return () => {};
}

export function resetState() {
  clearState();
  return clone(initialState);
}

function getTeamPlayers(team, size) {
  return team.members.slice(0, size).map((member) => member.userId);
}

function getTrustedRefereeId(state, refereeId, playerIds = []) {
  if (!refereeId || playerIds.includes(refereeId)) return "";
  const user = state.users.find((item) => item.id === refereeId);
  return isEligibleReferee(user, REFEREE_TRUST_MIN) ? refereeId : "";
}

function getValidRecruitingRecorder(post, state, sideName, playerId) {
  if (!playerId || post.refereeId) return "";
  const lobby = getRecruitingLobby(post, state);
  const playingIds = new Set([...lobby.sides.teamA.projectedPlayers, ...lobby.sides.teamB.projectedPlayers]);
  const candidate = (lobby.sides[sideName]?.reserveCandidates ?? []).find((item) => (
    item.playerId === playerId &&
    RECORDABLE_RESERVE_SOURCES.has(item.source) &&
    item.status === "ready" &&
    !playingIds.has(item.playerId)
  ));
  return candidate ? playerId : "";
}

function getRecruitingRoomStatRecorders(post, state) {
  const lobby = getRecruitingLobby(post, state);
  const playingIds = new Set([...lobby.sides.teamA.projectedPlayers, ...lobby.sides.teamB.projectedPlayers]);
  const getRecorder = (sideName) => {
    const candidate = (lobby.sides[sideName]?.reserveCandidates ?? []).find((item) => (
      RECORDABLE_RESERVE_SOURCES.has(item.source) &&
      item.status === "ready" &&
      !playingIds.has(item.playerId)
    ));
    return candidate?.playerId ?? "";
  };
  return {
    teamA: getRecorder("teamA"),
    teamB: getRecorder("teamB"),
  };
}

function getPendingReserveInvitationCount(roomState, sideName) {
  return (roomState.invitations ?? []).filter((invitation) => (
    invitation.status === "pending" &&
    invitation.reserve &&
    invitation.side === sideName
  )).length;
}

function updatePinnedReservePlayers(roomState = {}, sideName, playerId, reserve = true) {
  if (!["teamA", "teamB"].includes(sideName) || !playerId) return roomState;
  const currentPinned = roomState.pinnedReservePlayers && typeof roomState.pinnedReservePlayers === "object"
    ? roomState.pinnedReservePlayers
    : {};
  const nextPinned = {};
  ["teamA", "teamB"].forEach((currentSideName) => {
    const ids = new Set(Array.isArray(currentPinned[currentSideName]) ? currentPinned[currentSideName] : []);
    ids.delete(playerId);
    if (reserve && currentSideName === sideName) ids.add(playerId);
    if (ids.size) nextPinned[currentSideName] = Array.from(ids);
  });
  return { ...roomState, pinnedReservePlayers: nextPinned };
}

function updateManyPinnedReservePlayers(roomState = {}, sideName, playerIds = [], reserve = true) {
  return playerIds.reduce(
    (nextRoomState, playerId) => updatePinnedReservePlayers(nextRoomState, sideName, playerId, reserve),
    roomState,
  );
}

function isRecruitingReserveLimitExceeded(post, state, sideName) {
  if (!["teamA", "teamB"].includes(sideName)) return true;
  const lobby = getRecruitingLobby(post, state);
  return (lobby.sides[sideName]?.reserveCandidates?.length ?? 0) > MAX_RECRUITING_RESERVES_PER_SIDE;
}

function getRecruitingReserveLimitNotification(postId, sideName) {
  return {
    id: makeId("n"),
    title: "후보 슬롯 초과",
    body: `${SIDE_LABEL_TEXT[sideName] ?? "해당 사이드"} 후보는 최대 ${MAX_RECRUITING_RESERVES_PER_SIDE}명까지 가능합니다.`,
    tone: "orange",
    recruitingPostId: postId,
  };
}

function cleanRecruitingRoomStatRecorders(post, state) {
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  return {
    ...post,
    roomState: {
      ...roomState,
      statRecorders: getRecruitingRoomStatRecorders({ ...post, roomState }, state),
    },
  };
}

function getScheduleText(date, time) {
  return [date, time].filter(Boolean).join(" ") || "일정 미정";
}

function shuffleItems(items = []) {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function getTournamentTeamStatuses(tournament = {}) {
  return {
    ...Object.fromEntries((tournament.teamIds ?? []).map((teamId) => [teamId, "invited"])),
    ...(tournament.teamStatuses ?? {}),
  };
}

function buildLeaguePairings(teamIds = []) {
  const pairings = [];
  for (let homeIndex = 0; homeIndex < teamIds.length; homeIndex += 1) {
    for (let awayIndex = homeIndex + 1; awayIndex < teamIds.length; awayIndex += 1) {
      pairings.push({
        round: 1,
        fixture: pairings.length + 1,
        teamAId: teamIds[homeIndex],
        teamBId: teamIds[awayIndex],
      });
    }
  }
  return pairings;
}

function getByeMatchIndexes(matchCount, byeCount) {
  const indexes = [];
  let left = 0;
  let right = matchCount - 1;
  while (indexes.length < byeCount && left <= right) {
    indexes.push(left);
    if (indexes.length < byeCount && right !== left) indexes.push(right);
    left += 1;
    right -= 1;
  }
  return new Set(indexes);
}

function buildTournamentPairings(teamIds = []) {
  const seedOrder = shuffleItems(teamIds);
  const bracketSize = 2 ** Math.ceil(Math.log2(Math.max(seedOrder.length, 2)));
  const matchCount = bracketSize / 2;
  const byeCount = Math.max(0, bracketSize - seedOrder.length);
  const byeMatchIndexes = getByeMatchIndexes(matchCount, byeCount);
  let seedIndex = 0;
  const firstRound = Array.from({ length: matchCount }, (_item, index) => {
    if (byeMatchIndexes.has(index)) {
      const teamAId = seedOrder[seedIndex++] ?? null;
      return {
        id: `r1-${index + 1}`,
        round: 1,
        fixture: index + 1,
        teamAId,
        teamBId: null,
        byeTeamId: teamAId,
      };
    }
    const teamAId = seedOrder[seedIndex++] ?? null;
    const teamBId = seedOrder[seedIndex++] ?? null;
    return {
      id: `r1-${index + 1}`,
      round: 1,
      fixture: index + 1,
      teamAId,
      teamBId,
      byeTeamId: !teamBId ? teamAId : null,
    };
  });
  const pairings = firstRound
    .filter((row) => row.teamAId && row.teamBId)
    .map((row) => ({
      round: row.round,
      fixture: row.fixture,
      bracketMatch: row.fixture,
      teamAId: row.teamAId,
      teamBId: row.teamBId,
    }));
  const byes = firstRound.filter((row) => row.byeTeamId).map((row) => row.byeTeamId);
  const slots = firstRound.flatMap((row) => [row.teamAId, row.teamBId]);
  return { seedOrder, bracketSize, slots, firstRound, pairings, byes };
}

function makeTournamentMatch(tournament, teamA, teamB, pairing, now) {
  const mode = tournament.mode || "5v5";
  const size = MODE_SIZES[mode] ?? 5;
  const roundLabel = tournament.format === "tournament" ? `${pairing.round}R-${pairing.fixture}` : `L-${pairing.fixture}`;
  const teamAPlayers = getTeamPlayers(teamA, size);
  const teamBPlayers = getTeamPlayers(teamB, size);

  return {
    id: makeId("m"),
    title: `${tournament.title} ${roundLabel} · ${teamA.name} vs ${teamB.name}`,
    mode,
    court: tournament.court || "미정",
    scheduledDate: "",
    scheduledTime: "",
    scheduledAt: "일정 미정",
    status: "agreed",
    ranked: tournament.ranked !== false,
    official: Boolean(tournament.official),
    preRegistered: true,
    refereeId: "",
    refereeTrustMin: REFEREE_TRUST_MIN,
    statEntryMinutes: STAT_ENTRY_WINDOW_MINUTES,
    disputeMinutes: DISPUTE_WINDOW_MINUTES,
    tournamentId: tournament.id,
    tournamentFormat: tournament.format,
    tournamentRound: pairing.round,
    tournamentFixture: pairing.fixture,
    tournamentBracketMatch: pairing.bracketMatch ?? pairing.fixture,
    tournamentMmrPolicy: tournament.mmrPolicy,
    rules: tournament.rules ?? {},
    memo: tournament.memo || "대회 경기입니다.",
    stakes: "대회 경기 MMR 가중치가 적용됩니다.",
    mmrLimitMode: tournament.mmrLimitMode ?? "warn",
    objectionWindow: "30분",
    evidence: [],
    teamA: { name: teamA.name, teamId: teamA.id, players: teamAPlayers, score: 0 },
    teamB: { name: teamB.name, teamId: teamB.id, players: teamBPlayers, score: 0 },
    agreements: { teamA: teamAPlayers, teamB: teamBPlayers },
    approvals: { teamA: [], teamB: [] },
    disputes: [],
    result: null,
    ratingResult: null,
    agreedAt: now,
    createdAt: now,
  };
}

function generateTournamentMatches(state, tournament) {
  if (tournament.matchIds?.length) return { matches: [], tournament };

  const teamById = Object.fromEntries(state.teams.map((team) => [team.id, team]));
  const now = new Date().toISOString();
  const pairSource = tournament.format === "tournament"
    ? buildTournamentPairings(tournament.teamIds ?? [])
    : { seedOrder: tournament.teamIds ?? [], pairings: buildLeaguePairings(tournament.teamIds ?? []), byes: [] };
  const matches = pairSource.pairings
    .map((pairing) => {
      const teamA = teamById[pairing.teamAId];
      const teamB = teamById[pairing.teamBId];
      if (!teamA || !teamB) return null;
      return makeTournamentMatch(tournament, teamA, teamB, pairing, now);
    })
    .filter(Boolean);
  const matchIds = matches.map((match) => match.id);
  const fixtureRows = matches.map((match) => ({
    matchId: match.id,
    round: match.tournamentRound,
    fixture: match.tournamentFixture,
    bracketMatch: match.tournamentBracketMatch ?? match.tournamentFixture,
    teamAId: match.teamA.teamId,
    teamBId: match.teamB.teamId,
  }));
  const bracket = tournament.format === "tournament"
    ? {
        format: "tournament",
        generatedAt: now,
        seedOrder: pairSource.seedOrder,
        bracketSize: pairSource.bracketSize,
        slots: pairSource.slots,
        firstRound: pairSource.firstRound,
        rounds: [{ id: "round-1", name: "1라운드", pairings: fixtureRows, byes: pairSource.byes }],
      }
    : {
        format: "league",
        generatedAt: now,
        fixtures: fixtureRows,
      };

  return {
    matches,
    tournament: {
      ...tournament,
      status: "active",
      startedAt: now,
      matchIds,
      bracket,
    },
  };
}

function isTournamentManager(state, tournament) {
  return tournament.createdBy === state.currentUserId;
}

function teamRegularRatio(team, playerIds, users = []) {
  if (!team) return 1;
  const userById = Object.fromEntries(users.map((user) => [user.id, user]));
  const selected = team.members.filter((member) => playerIds.includes(member.userId));
  if (!selected.length) return 1;
  const weighted = selected.reduce((sum, member) => {
    const memberMmr = userById[member.userId]?.ratings?.integrated ?? team.mmr;
    return sum + getMercenaryTeamWeight(memberMmr, team.mmr, member.role);
  }, 0);
  return weighted / selected.length;
}

function averageTeamMmr(groups = []) {
  if (!groups.length) return 1200;
  return groups.reduce((sum, group) => sum + Number(group.team?.mmr ?? 1200), 0) / groups.length;
}

function getMatchSideTeamGroups(state, match, sideName) {
  const side = match[sideName] ?? {};
  const playerTeams = side.playerTeams ?? {};
  const excludedIds = new Set(match.mmrExcludedPlayerIds ?? match.rules?.mmrExcludedPlayerIds ?? []);
  const groups = new Map();
  getMatchSidePlayerIds(match, sideName).forEach((playerId) => {
    if (excludedIds.has(playerId)) return;
    const teamId = playerTeams[playerId] ?? side.teamId;
    if (!teamId) return;
    if (!groups.has(teamId)) groups.set(teamId, []);
    groups.get(teamId).push(playerId);
  });
  return Array.from(groups.entries())
    .map(([teamId, playerIds]) => ({
      team: state.teams.find((team) => team.id === teamId),
      playerIds,
    }))
    .filter((group) => group.team);
}

function updateAffiliationScores(state) {
  const users = state.users;
  return state.affiliations.filter((affiliation) => affiliation.type !== "club").map((affiliation) => {
    const members = users.filter((user) => {
      if (affiliation.type === "region") return user.region === affiliation.name;
      if (affiliation.type === "school") return user.school === affiliation.name;
      if (affiliation.type === "company") return user.company === affiliation.name;
      return false;
    });
    if (!members.length) return affiliation;
    const average = members.reduce((sum, user) => sum + user.ratings.integrated, 0) / members.length;
    return { ...affiliation, score: Math.round(average + affiliation.wins * 2 - affiliation.losses) };
  });
}

function finalizeMatch(state, targetMatch) {
  const ratings = Object.fromEntries(state.users.map((user) => [user.id, clone(user.ratings)]));
  const ratingResult = applyMatchRating(targetMatch, state.users, ratings, state.matches, state.teams);
  const scoreA = Number(targetMatch.result.scoreA);
  const scoreB = Number(targetMatch.result.scoreB);
  const actualA = scoreA === scoreB ? 0.5 : scoreA > scoreB ? 1 : 0;
  const actualB = 1 - actualA;
  const teamAGroups = getMatchSideTeamGroups(state, targetMatch, "teamA");
  const teamBGroups = getMatchSideTeamGroups(state, targetMatch, "teamB");
  const teamAMmr = averageTeamMmr(teamAGroups);
  const teamBMmr = averageTeamMmr(teamBGroups);
  const teamDeltaEntries = [
    ...teamAGroups.map((group) => ({
      teamId: group.team.id,
      side: "teamA",
      actual: actualA,
      delta: calculateTeamDelta({
        teamMmr: group.team.mmr,
        opponentTeamMmr: teamBMmr,
        actual: actualA,
        match: targetMatch,
        regularRatio: teamRegularRatio(group.team, group.playerIds, state.users),
      }),
    })),
    ...teamBGroups.map((group) => ({
      teamId: group.team.id,
      side: "teamB",
      actual: actualB,
      delta: calculateTeamDelta({
        teamMmr: group.team.mmr,
        opponentTeamMmr: teamAMmr,
        actual: actualB,
        match: targetMatch,
        regularRatio: teamRegularRatio(group.team, group.playerIds, state.users),
      }),
    })),
  ];
  const teamDeltaById = teamDeltaEntries.reduce((acc, entry) => {
    acc[entry.teamId] = entry;
    return acc;
  }, {});
  const teamADelta = teamDeltaEntries
    .filter((entry) => entry.side === "teamA")
    .reduce((sum, entry) => sum + entry.delta, 0);
  const teamBDelta = teamDeltaEntries
    .filter((entry) => entry.side === "teamB")
    .reduce((sum, entry) => sum + entry.delta, 0);
  const trustRewards = new Map();
  Object.values(targetMatch.result?.statSubmissions ?? {}).forEach((submission) => {
    if (submission?.source === "candidate_recorder" && submission.by) {
      trustRewards.set(submission.by, (trustRewards.get(submission.by) ?? 0) + 2);
    }
  });
  if (targetMatch.refereeId) {
    trustRewards.set(targetMatch.refereeId, (trustRewards.get(targetMatch.refereeId) ?? 0) + 1);
  }

  const users = state.users.map((user) => {
    const nextRatings = ratingResult.ratings[user.id];
    const trustReward = trustRewards.get(user.id) ?? 0;
    if (!nextRatings && !trustReward) return user;
    const change = ratingResult.changes.find((item) => item.playerId === user.id);
    const foulPenalty = getFoulTrustPenalty(targetMatch.result?.playerStats?.[user.id]);
    return {
      ...user,
      trustScore: clampTrustScore((user.trustScore ?? 80) + (nextRatings ? 1 : 0) + trustReward + foulPenalty),
      streak: nextRatings
        ? change?.result === "win"
          ? Math.max(1, user.streak + 1)
          : change?.result === "loss"
            ? Math.min(-1, user.streak - 1)
            : user.streak
        : user.streak,
      ratings: nextRatings ?? user.ratings,
    };
  });

  const teams = state.teams.map((team) => {
    const teamDelta = teamDeltaById[team.id];
    if (teamDelta) {
      return {
        ...team,
        mmr: Math.round(team.mmr + teamDelta.delta),
        wins: team.wins + (teamDelta.actual === 1 ? 1 : 0),
        losses: team.losses + (teamDelta.actual === 0 ? 1 : 0),
      };
    }
    return team;
  });

  const confirmedMatch = {
    ...targetMatch,
    status: "confirmed",
    ratingResult: ratingResult.changes,
    teamRatingResult: {
      teamA: teamADelta,
      teamB: teamBDelta,
      teams: Object.fromEntries(teamDeltaEntries.map((entry) => [entry.teamId, entry.delta])),
    },
    confirmedAt: new Date().toISOString(),
  };
  const nextState = {
    ...state,
    users,
    teams,
    matches: state.matches.map((match) => (match.id === targetMatch.id ? confirmedMatch : match)),
    notifications: [
      {
        id: makeId("n"),
        title: "경기 확정",
        body: `${targetMatch.title} 결과가 티어와 랭킹에 반영됐습니다.`,
        tone: "tier",
        matchId: targetMatch.id,
      },
      ...state.notifications,
    ],
  };

  return { ...nextState, affiliations: updateAffiliationScores(nextState) };
}

function fillMatchDecision(match, decisionKey) {
  return {
    ...(match[decisionKey] ?? { teamA: [], teamB: [] }),
    teamA: [...new Set([...(match[decisionKey]?.teamA ?? []), ...(match.teamA?.players ?? [])])],
    teamB: [...new Set([...(match[decisionKey]?.teamB ?? []), ...(match.teamB?.players ?? [])])],
  };
}

function isAutoDecisionDue(match, nowMs = Date.now()) {
  const recordWindow = getMatchRecordWindow(match, nowMs);
  return Boolean(recordWindow.endAt && nowMs >= recordWindow.endAt.getTime() + DAY_MS);
}

function applyAutomaticMatchDecisions(state, now = new Date()) {
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  let nextState = state;

  for (const match of state.matches ?? []) {
    const current = nextState.matches.find((item) => item.id === match.id);
    if (!current) continue;

    if ((current.status === "approval" || current.status === "disputed") && current.result) {
      const recordWindow = getMatchRecordWindow(current, nowMs);
      if (!recordWindow.disputeExpired) continue;
      const nextMatch = {
        ...current,
        disputeMinutes: DISPUTE_WINDOW_MINUTES,
        approvals: fillMatchDecision(current, "approvals"),
        autoConfirmedAt: current.autoConfirmedAt ?? nowIso,
      };
      nextState = finalizeMatch(
        {
          ...nextState,
          matches: nextState.matches.map((item) => (item.id === current.id ? nextMatch : item)),
        },
        nextMatch,
      );
      continue;
    }

    if (!isAutoDecisionDue(current, nowMs)) continue;

    if (current.status === "contract") {
      const nextMatch = {
        ...current,
        status: "agreed",
        agreements: fillMatchDecision(current, "agreements"),
        agreedAt: current.agreedAt ?? nowIso,
        autoAgreedAt: current.autoAgreedAt ?? nowIso,
      };
      nextState = {
        ...nextState,
        matches: nextState.matches.map((item) => (item.id === current.id ? nextMatch : item)),
        notifications: [
          {
            id: makeId("n"),
            title: "동의 자동 처리",
            body: `${current.title} 동의가 24시간 안에 처리되지 않아 자동 동의 처리됐습니다.`,
            tone: "match",
            matchId: current.id,
          },
          ...nextState.notifications,
        ],
      };
      continue;
    }

    if (current.status === "approval" && current.result) {
      const statStatus = getStatSubmissionStatus(current);
      const pointAudit = getResultPointAudit(current);
      if (!statStatus.complete || !pointAudit.matched) continue;
      const nextMatch = {
        ...current,
        approvals: fillMatchDecision(current, "approvals"),
        autoApprovedAt: current.autoApprovedAt ?? nowIso,
      };
      nextState = finalizeMatch(
        {
          ...nextState,
          matches: nextState.matches.map((item) => (item.id === current.id ? nextMatch : item)),
        },
        nextMatch,
      );
    }

  }

  return nextState;
}

function applyExpiredRecruitingRooms(state, now = new Date()) {
  const expiredRows = (state.recruitingPosts ?? []).map((post) => {
    if (post.status !== "open") return false;
    const lobby = getRecruitingLobby(post, state);
    const timing = getPublicRoomTimingStatus(post, now);
    if (timing.expired) return { post, lobby, penalizeHost: lobby.projectedFull };
    const deadlineMs = getScheduledStartMs(post);
    if (!Number.isFinite(deadlineMs) || now.getTime() <= deadlineMs || lobby.projectedFull) return false;
    return { post, lobby, penalizeHost: false };
  }).filter(Boolean);
  if (!expiredRows.length) return state;

  const expiredPosts = expiredRows.map((row) => row.post);
  const expiredIds = new Set(expiredPosts.map((post) => post.id));
  const penalizedHostIds = expiredRows.filter((row) => row.penalizeHost).map((row) => getRecruitingRoomOwnerId(row.post) || row.post.playerId);
  const nowIso = now.toISOString();

  return {
    ...state,
    users: penalizedHostIds.reduce((users, userId) => adjustUserTrust(users, userId, -4), state.users),
    recruitingPosts: (state.recruitingPosts ?? []).map((post) => {
      if (!expiredIds.has(post.id)) return post;
      const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
      return {
        ...post,
        status: "cancelled",
        cancelledAt: post.cancelledAt ?? nowIso,
        roomState: {
          ...roomState,
          invitations: roomState.invitations.map((invitation) => (
            invitation.status === "pending" ? { ...invitation, status: "expired", updatedAt: nowIso } : invitation
          )),
        },
      };
    }),
    notifications: [
      ...expiredPosts.map((post) => ({
        id: makeId("n"),
        title: "매칭방 자동 취소",
        body: `${post.title} 인원이 제한시간 안에 차지 않아 취소됐습니다.`,
        tone: "orange",
        recruitingPostId: post.id,
      })),
      ...state.notifications,
    ],
  };
}

function applyAutomaticRecruitingConfirmations(state) {
  return state;
}

export function runAutomaticStateMaintenance(state, now = new Date()) {
  return applyAutomaticRecruitingConfirmations(applyExpiredRecruitingRooms(applyAutomaticMatchDecisions(state, now), now));
}

export function createMatch(state, draft) {
  const hostTrustBlock = getHostTrustBlockNotification(state, { ...draft, visibility: "private" });
  if (hostTrustBlock) return { ...state, notifications: [hostTrustBlock, ...state.notifications] };
  const mode = draft.mode ?? "5v5";
  const size = MODE_SIZES[mode] ?? 5;
  const timingType = draft.timingType === "instant" ? "instant" : "scheduled";
  const scheduledAt = timingType === "instant" ? "즉시" : `${draft.scheduledDate ?? ""} ${draft.scheduledTime ?? ""}`.trim();
  if (timingType !== "instant" && !isScheduleDateInAllowedWindow(draft.scheduledDate, new Date(), ROOM_SCHEDULE_MAX_DAYS)) {
    return { ...state, notifications: [getInvalidScheduleNotification(ROOM_SCHEDULE_MAX_DAYS), ...state.notifications] };
  }
  const teams = state.teams;
  const teamA = teams.find((team) => team.id === draft.teamAId) ?? teams[0];
  const teamB = teams.find((team) => team.id === draft.teamBId && team.id !== teamA.id) ?? teams.find((team) => team.id !== teamA.id) ?? teams[1];
  const evidence = (draft.evidence ?? []).map((item) => ({ id: item.id, label: item.label }));
  const teamAPlayers = getTeamPlayers(teamA, size);
  const teamBPlayers = getTeamPlayers(teamB, size);
  const refereeId = getTrustedRefereeId(state, draft.refereeId, [...teamAPlayers, ...teamBPlayers]);
  const mmrRangeMode = normalizeRecruitingMmrRangeMode(draft.mmrRangeMode);
  const ranked = draft.ranked !== false;
  const ratingScale = ranked ? getRecruitingRatingScale({ ranked, mmrRangeMode }) : 1;
  const match = {
    id: makeId("m"),
    title: draft.title || `${draft.court} ${mode} 판`,
    mode,
    court: draft.court,
    scheduledDate: timingType === "instant" ? "" : draft.scheduledDate,
    scheduledTime: timingType === "instant" ? "" : draft.scheduledTime,
    scheduledAt: scheduledAt || "일정 미정",
    timingType,
    status: "agreed",
    ranked,
    official: ranked && Boolean(draft.official),
    preRegistered: Boolean(draft.preRegistered),
    refereeId,
    refereeTrustMin: REFEREE_TRUST_MIN,
    statEntryMinutes: STAT_ENTRY_WINDOW_MINUTES,
    disputeMinutes: DISPUTE_WINDOW_MINUTES,
    rules: {
      targetScore: Number(draft.targetScore ?? 21),
      timeLimit: Number(draft.timeLimit ?? 12),
      winByTwo: Boolean(draft.winByTwo),
      ball: draft.ball || "7호 공",
      attackRule: draft.attackRule || "공격권은 득점 후 교대",
      foulRule: draft.foulRule || "파울은 콜한 쪽 기준으로 즉시 중단",
      mmrRangeMode,
      ratingScale,
    },
    memo: draft.memo || "결과 승인 대기.",
    stakes: draft.stakes || "다음 경기 우선권.",
    mmrLimitMode: draft.mmrLimitMode ?? "block",
    mmrRangeMode,
    ratingScale,
    objectionWindow: "30분",
    evidence,
    teamA: { name: teamA.name, teamId: teamA.id, players: teamAPlayers, score: 0 },
    teamB: { name: teamB.name, teamId: teamB.id, players: teamBPlayers, score: 0 },
    agreements: { teamA: [], teamB: [] },
    approvals: { teamA: [], teamB: [] },
    disputes: [],
    result: null,
    ratingResult: null,
    agreedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };

  return {
    ...state,
    matches: [match, ...state.matches],
    notifications: [
      { id: makeId("n"), title: "새 경기방", body: `${match.title} 확정방이 만들어졌습니다.`, tone: "match", matchId: match.id },
      ...state.notifications,
    ],
  };
}

export function createTournament(state, draft) {
  const tournamentStartDate = draft.scheduledDate || draft.tournamentStartDate || "";
  const tournamentEndDate = draft.tournamentEndDate || tournamentStartDate;
  if (!isScheduleDateInAllowedWindow(tournamentStartDate) || !isScheduleDateInAllowedWindow(tournamentEndDate)) {
    return { ...state, notifications: [getInvalidScheduleNotification(), ...state.notifications] };
  }
  const teamIds = [...new Set(draft.teamIds ?? draft.tournamentTeamIds ?? [])]
    .filter((teamId) => state.teams.some((team) => team.id === teamId));
  const invitedTeams = teamIds.map((teamId) => state.teams.find((team) => team.id === teamId)).filter(Boolean);
  const mmrs = invitedTeams.map((team) => Number(team.mmr ?? 1200));
  const mmrSpread = mmrs.length ? Math.max(...mmrs) - Math.min(...mmrs) : 0;
  const maxMmrGap = Number(draft.tournamentMaxMmrGap ?? draft.maxMmrGap ?? 250);
  const mmrLimitMode = draft.mmrLimitMode ?? "warn";

  if (teamIds.length < 2) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "대회 생성 불가",
          body: "비공개 대회는 최소 2개 팀을 초대해야 합니다.",
          tone: "match",
        },
        ...state.notifications,
      ],
    };
  }

  if (draft.ranked !== false && mmrLimitMode === "block" && mmrSpread > maxMmrGap) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "MMR 제한",
          body: `초대 팀 MMR 차이 ${mmrSpread}점이 제한 ${maxMmrGap}점을 넘었습니다.`,
          tone: "match",
        },
        ...state.notifications,
      ],
    };
  }

  const createdAt = new Date().toISOString();
  const ranked = draft.ranked !== false;
  const teamStatuses = Object.fromEntries(
    teamIds.map((teamId) => [
      teamId,
      getTeamCaptainId(state.teams, teamId) === state.currentUserId ? "accepted" : "invited",
    ]),
  );
  const teamApprovals = Object.fromEntries(
    teamIds
      .filter((teamId) => teamStatuses[teamId] === "accepted")
      .map((teamId) => [teamId, { by: state.currentUserId, approvedAt: createdAt }]),
  );
  const tournament = {
    id: makeId("trn"),
    title: draft.title?.trim() || `${draft.mode || "5v5"} 비공개 대회`,
    format: draft.tournamentFormat ?? "league",
    visibility: "private",
    status: "draft",
    region: draft.region || state.users.find((user) => user.id === state.currentUserId)?.region || "전체",
    court: draft.court || "미정",
    mode: draft.mode || "5v5",
    ranked,
    official: ranked && Boolean(draft.official),
    startDate: tournamentStartDate,
    endDate: tournamentEndDate,
    schedulePolicy: draft.tournamentSchedulePolicy ?? "weekly",
    scheduleNote: draft.tournamentScheduleNote?.trim() || "초대팀 확정 후 경기별 일정을 배정합니다.",
    mmrLimitMode,
    maxMmrGap,
    mmrPolicy: draft.tournamentMmrPolicy ?? "gap_adjusted",
    rules: {
      targetScore: Number(draft.targetScore ?? 21),
      timeLimit: Number(draft.timeLimit ?? 12),
      winByTwo: Boolean(draft.winByTwo),
      ball: draft.ball || "7호 공",
      attackRule: draft.attackRule || "공격권은 득점 후 교대",
      foulRule: draft.foulRule || "파울은 콜한 쪽 기준으로 즉시 중단",
    },
    memo: draft.memo || "비공개 초대 대회입니다.",
    createdBy: state.currentUserId,
    createdAt,
    teamIds,
    teamStatuses,
    teamApprovals,
    matchIds: [],
    bracket: null,
  };
  const allAccepted = teamIds.every((teamId) => teamStatuses[teamId] === "accepted");
  const generated = allAccepted ? generateTournamentMatches(state, tournament) : { matches: [], tournament };

  return {
    ...state,
    matches: generated.matches.length ? [...generated.matches, ...state.matches] : state.matches,
    tournaments: [generated.tournament, ...(state.tournaments ?? [])],
    notifications: [
      {
        id: makeId("n"),
        title: allAccepted ? "대회 시작" : "대회 생성",
        body: allAccepted
          ? `${tournament.title} 대회가 시작됐습니다. 경기 ${generated.matches.length}개 생성.`
          : `${tournament.title} 대회방을 만들었습니다. 초대팀 ${teamIds.length}개.`,
        tone: "match",
      },
      ...state.notifications,
    ],
  };
}

export function approveTournamentTeam(state, tournamentId, teamId) {
  const tournament = (state.tournaments ?? []).find((item) => item.id === tournamentId);
  if (!tournament || tournament.status !== "draft" || !(tournament.teamIds ?? []).includes(teamId)) return state;

  const captainId = getTeamCaptainId(state.teams, teamId);
  if (captainId !== state.currentUserId) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "대회 승인 불가",
          body: "해당 팀 주장만 대회 참가를 승인할 수 있습니다.",
          tone: "match",
        },
        ...state.notifications,
      ],
    };
  }

  const now = new Date().toISOString();
  const teamStatuses = { ...getTournamentTeamStatuses(tournament), [teamId]: "accepted" };
  const teamApprovals = {
    ...(tournament.teamApprovals ?? {}),
    [teamId]: { by: state.currentUserId, approvedAt: now },
  };
  const approvedTournament = { ...tournament, teamStatuses, teamApprovals };
  const allAccepted = (approvedTournament.teamIds ?? []).every((id) => teamStatuses[id] === "accepted");
  const generated = allAccepted ? generateTournamentMatches(state, approvedTournament) : { matches: [], tournament: approvedTournament };

  return {
    ...state,
    matches: generated.matches.length ? [...generated.matches, ...state.matches] : state.matches,
    tournaments: (state.tournaments ?? []).map((item) => (item.id === tournamentId ? generated.tournament : item)),
    notifications: [
      {
        id: makeId("n"),
        title: allAccepted ? "대회 시작" : "대회 참가 승인",
        body: allAccepted
          ? `${tournament.title} 대회가 시작됐습니다. 경기 ${generated.matches.length}개 생성.`
          : `${tournament.title} 참가 승인 완료. 남은 팀 승인을 기다립니다.`,
        tone: "match",
      },
      ...state.notifications,
    ],
  };
}

export function updateTournamentMatchSchedule(state, tournamentId, matchId, schedule = {}) {
  const tournament = (state.tournaments ?? []).find((item) => item.id === tournamentId);
  const match = state.matches.find((item) => item.id === matchId && item.tournamentId === tournamentId);
  if (!tournament || !match) return state;

  if (!isTournamentManager(state, tournament)) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "일정 수정 불가",
          body: "대회 생성자만 경기 일정을 수정할 수 있습니다.",
          tone: "match",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }

  const scheduledDate = String(schedule.scheduledDate ?? "").slice(0, 10);
  const scheduledTime = String(schedule.scheduledTime ?? "").slice(0, 5);
  const maxDays = match.tournamentId ? SCHEDULE_MAX_DAYS : ROOM_SCHEDULE_MAX_DAYS;
  if (!isScheduleDateInAllowedWindow(scheduledDate, new Date(), maxDays)) {
    return { ...state, notifications: [getInvalidScheduleNotification(maxDays), ...state.notifications] };
  }
  const updatedMatch = {
    ...match,
    scheduledDate,
    scheduledTime,
    scheduledAt: getScheduleText(scheduledDate, scheduledTime),
  };

  return {
    ...state,
    matches: state.matches.map((item) => (item.id === matchId ? updatedMatch : item)),
    notifications: [
      {
        id: makeId("n"),
        title: "대회 일정 수정",
        body: `${match.title} 일정이 ${updatedMatch.scheduledAt}(으)로 바뀌었습니다.`,
        tone: "match",
        matchId,
      },
      ...state.notifications,
    ],
  };
}

function getSelfDecisionId(state, match, sideName, decisionKey, playerId) {
  const currentUserId = state.currentUserId;
  if (!currentUserId || playerId !== currentUserId) return null;
  const sidePlayers = match[sideName]?.players ?? [];
  const sideTeamId = match[sideName]?.teamId;
  const captainId = decisionKey === "agreements" && sideTeamId
    ? getTeamCaptainId(state.teams, sideTeamId)
    : "";
  if (captainId) {
    if (currentUserId !== captainId) return null;
  } else if (!sidePlayers.includes(currentUserId)) {
    return null;
  }
  if ((match[decisionKey]?.[sideName] ?? []).includes(currentUserId)) return null;
  return currentUserId;
}

function uniquePlayerIds(playerIds = []) {
  return [...new Set(playerIds.filter(Boolean))];
}

function ensureTeamPartyLeader(team = {}, playerIds = [], leaderId = "", capacity = Infinity) {
  const selectableIds = new Set(getSelectableTeamPlayerIds(team));
  const safePlayerIds = uniquePlayerIds(playerIds).filter((playerId) => selectableIds.has(playerId));
  if (!leaderId || !selectableIds.has(leaderId)) return safePlayerIds.slice(0, capacity);
  return [leaderId, ...safePlayerIds.filter((playerId) => playerId !== leaderId)].slice(0, capacity);
}

function getAveragePlayerMmr(state = {}, playerIds = [], fallback = 1200) {
  const values = uniquePlayerIds(playerIds)
    .map((playerId) => Number(state.users?.find((user) => user.id === playerId)?.ratings?.integrated))
    .filter((value) => Number.isFinite(value));
  if (!values.length) return fallback;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function getSelectedReservePlayerIds(team = {}, activeIds = [], reserveIds = []) {
  if (!team || !Array.isArray(reserveIds) || !reserveIds.length) return [];
  const activeSet = new Set(activeIds);
  const teamPlayerIds = new Set((team.members ?? []).map((member) => member.userId));
  return uniquePlayerIds(reserveIds)
    .filter((playerId) => teamPlayerIds.has(playerId) && !activeSet.has(playerId))
    .slice(0, MAX_RECRUITING_RESERVES_PER_SIDE);
}

function getMatchPlayerTeamId(match = {}, sideName, playerId) {
  const side = match[sideName] ?? {};
  if (side.playerTeams?.[playerId]) return side.playerTeams[playerId];
  const party = (match.parties ?? []).find((item) => (
    item.side === sideName &&
    [...(item.players ?? []), ...(item.reserves ?? [])].includes(playerId)
  ));
  return party?.teamId ?? side.teamId ?? null;
}

function getRecorderHandoffPatch(match, sideName, currentRecorderId, nextRecorderId) {
  const side = match[sideName] ?? {};
  const sidePlayers = side.players ?? [];
  const reserveIds = getMatchReservePlayerIds(match, sideName);
  const currentIsPlayer = sidePlayers.includes(currentRecorderId);
  const currentIsReserve = reserveIds.includes(currentRecorderId);
  const nextIsPlayer = sidePlayers.includes(nextRecorderId);
  const nextIsReserve = reserveIds.includes(nextRecorderId);
  if (!nextIsPlayer && !nextIsReserve) return { valid: false, match, swapped: false };

  const recordWindow = getMatchRecordWindow(match);
  const shouldSwap = recordWindow.beforeEnd && (
    (currentIsReserve && nextIsPlayer) ||
    (currentIsPlayer && nextIsReserve)
  );
  if (!shouldSwap) return { valid: true, match, swapped: false };

  const activeInId = currentIsReserve ? currentRecorderId : nextRecorderId;
  const benchedId = currentIsReserve ? nextRecorderId : currentRecorderId;
  const nextPlayers = sidePlayers.map((playerId) => (playerId === benchedId ? activeInId : playerId));
  const currentReservePlayers = match.reservePlayers?.[sideName] ?? [];
  const nextReservePlayers = uniquePlayerIds([
    ...currentReservePlayers.filter((playerId) => playerId !== activeInId),
    benchedId,
  ]);
  const playedPlayerIds = match.playedPlayerIds ?? match.rules?.playedPlayerIds ?? {};
  const nextPlayedPlayerIds = {
    ...playedPlayerIds,
    [sideName]: uniquePlayerIds([...(playedPlayerIds[sideName] ?? []), ...sidePlayers, activeInId, benchedId]),
  };
  const playerTeams = { ...(side.playerTeams ?? {}) };
  [activeInId, benchedId].forEach((playerId) => {
    const teamId = getMatchPlayerTeamId(match, sideName, playerId);
    if (teamId) playerTeams[playerId] = teamId;
  });

  return {
    valid: true,
    swapped: true,
    activeInId,
    benchedId,
    match: {
      ...match,
      [sideName]: {
        ...side,
        players: uniquePlayerIds(nextPlayers),
        playerTeams,
      },
      reservePlayers: {
        ...(match.reservePlayers ?? {}),
        [sideName]: nextReservePlayers,
      },
      playedPlayerIds: nextPlayedPlayerIds,
      rules: {
        ...(match.rules ?? {}),
        playedPlayerIds: nextPlayedPlayerIds,
      },
    },
  };
}

export function agreeMatch(state, matchId, sideName, playerId) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match || !["contract", "agreed"].includes(match.status)) return state;

  const agreementId = getSelfDecisionId(state, match, sideName, "agreements", playerId);
  if (!agreementId) return state;

  const updatedMatch = {
    ...match,
    agreements: {
      ...(match.agreements ?? { teamA: [], teamB: [] }),
      [sideName]: Array.from(new Set([...(match.agreements?.[sideName] ?? []), agreementId])),
    },
  };
  const ready =
    match.status !== "agreed" &&
    getAgreementStatus(updatedMatch, state.teams, "teamA").approved &&
    getAgreementStatus(updatedMatch, state.teams, "teamB").approved;
  const nextMatch = ready
    ? { ...updatedMatch, status: "agreed", agreedAt: updatedMatch.agreedAt ?? new Date().toISOString() }
    : updatedMatch;

  return {
    ...state,
    matches: state.matches.map((item) => (item.id === matchId ? nextMatch : item)),
    notifications: ready
      ? [
          {
            id: makeId("n"),
            title: "경기 전 동의 완료",
            body: `${match.title} 경기 결과를 입력할 수 있습니다.`,
            tone: "match",
            matchId,
          },
          ...state.notifications,
        ]
      : state.notifications,
  };
}

export function submitMatchResult(state, matchId, result) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match) return state;
  const currentUserId = state.currentUserId;
  const playerIds = getMatchPlayerIds(match);
  const currentSideName = getPlayerSideName(match, currentUserId);
  const hasReferee = Boolean(match.refereeId);
  const currentUser = state.users.find((user) => user.id === currentUserId);
  const currentUserIsReferee = isMatchReferee(match, currentUserId);
  const currentUserIsEligibleReferee = currentUserIsReferee && isEligibleReferee(currentUser, match.refereeTrustMin);
  const recorderSides = getStatRecorderSides(match, currentUserId);
  const hostPlayerId = getMatchHostPlayerId(state, match);
  const currentUserIsHost = Boolean(hostPlayerId && hostPlayerId === currentUserId);
  const roomPhase = getMatchRoomPhase(match).phase;
  const currentUserCanPostgameScore = currentUserIsHost && roomPhase === "postgame" && !["confirmed", "disputed"].includes(match.status);
  const currentUserCanRecord = currentUserIsEligibleReferee || currentUserCanPostgameScore || (!hasReferee && (recorderSides.length > 0 || Boolean(currentSideName)));

  if (hasReferee && !currentUserIsEligibleReferee) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "심판 기록 전용",
          body: "심판이 초대된 경기는 해당 심판만 스코어와 개인 활약을 입력할 수 있습니다.",
          tone: "match",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }

  if (!hasReferee && !currentUserCanRecord) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "결과 입력 권한 없음",
          body: "경기 참가자 또는 후보 기록자만 스코어와 개인 활약을 입력할 수 있습니다.",
          tone: "match",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }
  if (match.status === "contract") {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "경기 전 동의 필요",
          body: `${match.title}는 양팀 동의가 끝나야 결과를 입력할 수 있습니다.`,
          tone: "match",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }
  if (["confirmed", "void", "cancelled", "disputed"].includes(match.status)) return state;
  const recordWindow = getMatchRecordWindow(match);
  const matchStartsAt = getMatchStartDate(match);
  const beforeStart = !matchStartsAt || (Number.isFinite(matchStartsAt.getTime()) && Date.now() < matchStartsAt.getTime());
  const liveRecordAllowed = recordWindow.beforeEnd && !beforeStart && (currentUserIsEligibleReferee || (!hasReferee && (recorderSides.length > 0 || Boolean(currentSideName))));
  if ((recordWindow.beforeEnd && !liveRecordAllowed) || (!recordWindow.beforeEnd && !recordWindow.statOpen)) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: beforeStart ? "경기 시작 전" : recordWindow.beforeEnd ? "실시간 기록 권한 없음" : "기록 입력 마감",
          body: beforeStart
            ? "경기 시작 후 심판이 있으면 심판만, 심판이 없으면 배정 기록자만 실시간 기록을 저장할 수 있습니다."
            : recordWindow.beforeEnd
              ? "경기 중 실시간 기록은 심판이 있으면 심판만 저장할 수 있습니다."
            : "경기 종료 후 1시간이 지나 개인 기록 입력이 마감됐습니다.",
          tone: "match",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }

  const now = new Date().toISOString();
  const existingStats = normalizePlayerStats(match.result?.playerStats ?? {}, playerIds);
  const liveEntry = recordWindow.beforeEnd && liveRecordAllowed;
  const endedAt = liveEntry ? match.endedAt : match.endedAt ?? recordWindow.endAt?.toISOString() ?? now;
  const recorderPlayerIds = recorderSides.flatMap((sideName) => getMatchSidePlayerIds(match, sideName));
  const selfPlayerIds = currentSideName ? [currentUserId] : [];
  const hostPostgamePlayerIds = currentUserCanPostgameScore ? playerIds : [];
  const targetPlayerIds = currentUserIsEligibleReferee ? playerIds : [...new Set([...recorderPlayerIds, ...selfPlayerIds, ...hostPostgamePlayerIds])]
    .filter((playerId) => getAllowedResultFieldIds(match, currentUserId, playerId, currentUserCanPostgameScore).length > 0);
  if (!hasReferee && !targetPlayerIds.length) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "후보 기록자 배정됨",
          body: "이 팀은 후보 기록자가 개인 활약을 입력합니다.",
          tone: "match",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }
  const submittedStatPatch = getSubmittedStatPatch(result.playerStats ?? {}, targetPlayerIds);
  const touchedPlayerIds = Object.keys(submittedStatPatch);
  const nextPlayerStats = { ...existingStats };
  touchedPlayerIds.forEach((playerId) => {
    const allowedFieldIds = new Set(
      getAllowedResultFieldIds(match, currentUserId, playerId, currentUserCanPostgameScore).map((field) => field.id),
    );
    const currentStats = nextPlayerStats[playerId] ?? {};
    nextPlayerStats[playerId] = {
      ...currentStats,
      ...Object.fromEntries(
        Object.entries(submittedStatPatch[playerId])
          .filter(([fieldId]) => currentUserIsEligibleReferee || allowedFieldIds.has(fieldId)),
      ),
    };
  });
  const nextSubmissions = {
    ...(match.result?.statSubmissions ?? {}),
    ...Object.fromEntries(touchedPlayerIds.map((playerId) => {
      const sideName = getPlayerSideName(match, playerId);
      const source = currentUserIsEligibleReferee
        ? "referee"
        : isMatchStatRecorder(match, currentUserId, sideName)
          ? "candidate_recorder"
          : currentUserCanPostgameScore && playerId !== currentUserId
            ? "host_postgame"
        : "player";
      return [playerId, { by: currentUserId, side: sideName, source, submittedAt: now }];
    })),
  };
  const nextScoreA = getMergedResultScore(match, nextPlayerStats, "teamA", result.scoreA);
  const nextScoreB = getMergedResultScore(match, nextPlayerStats, "teamB", result.scoreB);
  const nextResult = {
    scoreA: nextScoreA,
    scoreB: nextScoreB,
    playerStats: nextPlayerStats,
    statSubmissions: nextSubmissions,
    submittedBy: currentUserId,
    submittedAt: match.result?.submittedAt ?? now,
    updatedAt: now,
  };

  return {
    ...state,
    matches: state.matches.map((item) =>
      item.id === matchId
        ? {
            ...item,
            status: liveEntry ? item.status : "approval",
            teamA: { ...item.teamA, score: nextResult.scoreA },
            teamB: { ...item.teamB, score: nextResult.scoreB },
            approvals: liveEntry ? item.approvals : { teamA: [], teamB: [] },
            result: nextResult,
            endedAt,
          }
        : item,
    ),
    notifications: [
      {
        id: makeId("n"),
        title: currentUserIsEligibleReferee ? "심판 기록 제출" : recorderSides.length ? "후보 기록 제출" : "내 득점 제출",
        body: currentUserIsEligibleReferee
          ? `${match.title} 스코어와 전체 개인 활약이 저장됐습니다.`
          : recorderSides.length
            ? `${match.title} 후보 기록자가 팀 개인 활약을 저장했습니다.`
          : `${match.title} 스코어와 내 득점이 저장됐습니다. 전원 제출 후 결과 승인이 가능합니다.`,
        tone: "match",
        matchId,
      },
      ...state.notifications,
    ],
  };
}

export function handoffMatchRecorder(state, matchId, sideName, nextRecorderId) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match || match.refereeId || !["agreed", "approval"].includes(match.status)) return state;
  if (!["teamA", "teamB"].includes(sideName)) return state;

  const currentRecorders = normalizeStatRecorders(match.statRecorders ?? match.rules?.statRecorders);
  const currentRecorderId = currentRecorders[sideName];
  if (!currentRecorderId || currentRecorderId !== state.currentUserId) return state;

  const handoffPatch = getRecorderHandoffPatch(match, sideName, currentRecorderId, nextRecorderId);
  if (!handoffPatch.valid) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "인수인계 불가",
          body: "같은 팀 출전선수 또는 후보에게만 기록 권한을 넘길 수 있습니다.",
          tone: "orange",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }

  const nextRecorders = { ...currentRecorders, [sideName]: nextRecorderId };
  const nextUser = state.users.find((user) => user.id === nextRecorderId);
  const activeInUser = state.users.find((user) => user.id === handoffPatch.activeInId);
  const benchedUser = state.users.find((user) => user.id === handoffPatch.benchedId);

  return {
    ...state,
    matches: state.matches.map((item) => (
      item.id === matchId
        ? (() => {
            const patched = getRecorderHandoffPatch(item, sideName, currentRecorderId, nextRecorderId).match;
            return {
              ...patched,
            statRecorders: nextRecorders,
            rules: {
              ...(patched.rules ?? {}),
              statRecorders: nextRecorders,
            },
            recorderHandoffs: [
              {
                id: makeId("handoff"),
                side: sideName,
                from: currentRecorderId,
                to: nextRecorderId,
                createdAt: new Date().toISOString(),
              },
              ...(patched.recorderHandoffs ?? []),
            ],
          };
        })()
        : item
    )),
    notifications: [
      {
        id: makeId("n"),
        title: "기록자 인수인계",
        body: handoffPatch.swapped
          ? `${match.title} ${SIDE_LABEL_TEXT[sideName]} 기록 권한이 ${nextUser?.name ?? "후보"}에게 넘어갔습니다. ${activeInUser?.name ?? "후보"} 출전, ${benchedUser?.name ?? "선수"} 후보 전환.`
          : `${match.title} ${SIDE_LABEL_TEXT[sideName]} 기록 권한이 ${nextUser?.name ?? "후보"}에게 넘어갔습니다.`,
        tone: "match",
        matchId,
      },
      ...state.notifications,
    ],
  };
}

export function approveMatch(state, matchId, sideName, playerId) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match?.result || ["confirmed", "void", "cancelled", "disputed"].includes(match.status)) return state;

  const approvalId = getSelfDecisionId(state, match, sideName, "approvals", playerId);
  if (!approvalId) return state;
  const statStatus = getStatSubmissionStatus(match);
  const pointAudit = getResultPointAudit(match);
  if (!statStatus.complete || !pointAudit.matched) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "결과 승인 보류",
          body: !statStatus.complete
            ? `개인 기록 ${statStatus.submitted}/${statStatus.total}명 제출 상태입니다. 전원 제출 후 승인할 수 있습니다.`
            : `득점 합계가 팀 스코어와 맞지 않습니다. A ${pointAudit.teamA.statPoints}/${pointAudit.teamA.teamScore}, B ${pointAudit.teamB.statPoints}/${pointAudit.teamB.teamScore}.`,
          tone: "match",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }

  const updatedMatch = {
    ...match,
    approvals: {
      ...(match.approvals ?? { teamA: [], teamB: [] }),
      [sideName]: Array.from(new Set([...(match.approvals?.[sideName] ?? []), approvalId])),
    },
  };
  const stateWithApproval = {
    ...state,
    matches: state.matches.map((item) => (item.id === matchId ? updatedMatch : item)),
  };

  if (getApprovalStatus(updatedMatch, state.teams, "teamA").approved && getApprovalStatus(updatedMatch, state.teams, "teamB").approved) {
    return finalizeMatch(stateWithApproval, updatedMatch);
  }

  return stateWithApproval;
}

export function disputeMatch(state, matchId, reason = "") {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match?.result || match.status !== "approval") return state;
  const recordWindow = getMatchRecordWindow(match);
  if (!recordWindow.disputeOpen) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "이의제기 마감",
          body: "경기 종료 후 30분이 지나 이의제기를 접수할 수 없습니다.",
          tone: "match",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }

  const dispute = {
    id: makeId("d"),
    by: state.currentUserId,
    reason: reason.trim() || "스코어 또는 개인 기록 확인이 필요합니다.",
    createdAt: new Date().toISOString(),
  };

  return {
    ...state,
    matches: state.matches.map((item) =>
      item.id === matchId
        ? { ...item, status: "disputed", disputes: [dispute, ...(item.disputes ?? [])] }
        : item,
    ),
    notifications: [
      {
        id: makeId("n"),
        title: "이의제기 접수",
        body: `${match.title} 결과가 보류됐습니다. 양팀 확인 후 재승인하거나 무효 처리하세요.`,
        tone: "match",
        matchId,
      },
      ...state.notifications,
    ],
  };
}

function getMatchHostPlayerId(state, match) {
  const sourcePost = match?.recruitingPostId
    ? state.recruitingPosts?.find((post) => post.id === match.recruitingPostId)
    : null;
  return getRecruitingRoomOwnerId(sourcePost) || match?.createdBy || match?.hostPlayerId || match?.createdPlayerId || match?.teamA?.players?.[0] || "";
}

function getAllowedResultFieldIds(match, currentUserId, playerId, hostPostgameScore = false) {
  const fields = getAllowedStatFields(match, currentUserId, playerId);
  if (!hostPostgameScore) return fields;
  const fieldById = Object.fromEntries(fields.map((field) => [field.id, field]));
  const pointsField = PLAYER_STAT_FIELDS.find((field) => field.id === "points");
  if (pointsField) fieldById.points = pointsField;
  return Object.values(fieldById);
}

function getSubmittedStatPatch(playerStats = {}, targetPlayerIds = []) {
  const targetSet = new Set(targetPlayerIds);
  const validFieldIds = new Set(PLAYER_STAT_FIELDS.map((field) => field.id));
  return Object.fromEntries(
    Object.entries(playerStats ?? {})
      .filter(([playerId]) => targetSet.has(playerId))
      .map(([playerId, stats]) => [
        playerId,
        Object.fromEntries(
          Object.entries(stats ?? {})
            .filter(([fieldId]) => validFieldIds.has(fieldId))
            .map(([fieldId, value]) => [fieldId, Math.max(0, Number(value ?? 0))]),
        ),
      ])
      .filter(([, stats]) => Object.keys(stats).length),
  );
}

function getMergedResultScore(match, playerStats, sideName, fallbackScore = 0) {
  const sidePlayerIds = getMatchSidePlayerIds(match, sideName);
  if (!sidePlayerIds.some((playerId) => playerStats[playerId])) return Number(fallbackScore ?? match[sideName]?.score ?? 0);
  return sidePlayerIds.reduce((sum, playerId) => sum + Number(playerStats[playerId]?.points ?? 0), 0);
}

function getMatchAttendance(match = {}) {
  return {
    teamA: uniquePlayerIds(match.attendance?.teamA ?? []),
    teamB: uniquePlayerIds(match.attendance?.teamB ?? []),
  };
}

function getMissingActiveAttendance(match = {}) {
  const attendance = getMatchAttendance(match);
  return ["teamA", "teamB"].flatMap((sideName) => (
    uniquePlayerIds(match[sideName]?.players ?? [])
      .filter((playerId) => !attendance[sideName].includes(playerId))
      .map((playerId) => ({ sideName, playerId }))
  ));
}

export function checkInMatchPlayer(state, matchId, sideName, playerId) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match || !playerId || playerId !== state.currentUserId) return state;
  if (getMatchRoomPhase(match).phase !== "checkin" || match.startedAt || match.endedAt || match.result) return state;
  const placement = getMatchPlayerPlacement(match, playerId);
  if (!placement || placement.side !== sideName) return state;

  const attendance = getMatchAttendance(match);
  const nextMatch = {
    ...match,
    attendance: {
      ...attendance,
      [sideName]: uniquePlayerIds([...attendance[sideName], playerId]),
    },
  };

  return {
    ...state,
    matches: state.matches.map((item) => (item.id === matchId ? nextMatch : item)),
    notifications: [
      { id: makeId("n"), title: "출석 완료", body: "경기준비방 출석체크가 완료됐습니다.", tone: "match", matchId },
      ...state.notifications,
    ],
  };
}

export function startMatch(state, matchId) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match || !["contract", "agreed"].includes(match.status) || match.result || match.endedAt) return state;
  const hostPlayerId = getMatchHostPlayerId(state, match);
  if (hostPlayerId && hostPlayerId !== state.currentUserId) return state;
  if (getMatchRoomPhase(match).phase !== "checkin") return state;
  const missingAttendance = getMissingActiveAttendance(match);
  if (missingAttendance.length) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "출석체크 필요",
          body: "출전선수 전원이 출석체크해야 경기 시작이 가능합니다.",
          tone: "orange",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }
  const now = new Date().toISOString();
  const nextMatch = {
    ...match,
    status: "agreed",
    agreedAt: match.agreedAt ?? now,
    startedAt: match.startedAt ?? now,
    rules: {
      ...(match.rules ?? {}),
      startedAt: match.rules?.startedAt ?? now,
    },
  };
  return {
    ...state,
    matches: state.matches.map((item) => (item.id === matchId ? nextMatch : item)),
    notifications: [
      { id: makeId("n"), title: "경기 시작", body: `${match.title} 경기가 시작됐습니다.`, tone: "match", matchId },
      ...state.notifications,
    ],
  };
}

export function endMatch(state, matchId) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match || match.status !== "agreed" || match.result || match.endedAt) return state;
  const hostPlayerId = getMatchHostPlayerId(state, match);
  if (hostPlayerId && hostPlayerId !== state.currentUserId) return state;
  const now = new Date().toISOString();
  const nextMatch = {
    ...match,
    startedAt: match.startedAt ?? match.rules?.startedAt ?? now,
    endedAt: now,
    rules: {
      ...(match.rules ?? {}),
      startedAt: match.rules?.startedAt ?? match.startedAt ?? now,
    },
  };
  return {
    ...state,
    matches: state.matches.map((item) => (item.id === matchId ? nextMatch : item)),
    notifications: [
      { id: makeId("n"), title: "경기 종료", body: `${match.title} 경기가 종료됐습니다. 결과 입력이 열렸습니다.`, tone: "match", matchId },
      ...state.notifications,
    ],
  };
}

function canEditPostgameRoster(state, match) {
  if (!match || ["confirmed", "void", "cancelled", "disputed"].includes(match.status) || match.result) return false;
  if (getMatchRoomPhase(match).phase !== "postgame") return false;
  if (getMatchRecordWindow(match).statExpired) return false;
  const hostPlayerId = getMatchHostPlayerId(state, match);
  return !hostPlayerId || hostPlayerId === state.currentUserId;
}

function makeAnonymousMatchPlayer(playerId, name) {
  return {
    id: playerId,
    name: String(name || "").trim() || "무기명 선수",
    position: "-",
    avatarColor: "#64748b",
    trustScore: "-",
    ratings: { integrated: 0, modes: {} },
  };
}

export function addMatchLatePlayer(state, matchId, draft = {}) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!canEditPostgameRoster(state, match)) return state;
  const sideName = ["teamA", "teamB"].includes(draft.sideName) ? draft.sideName : "teamA";
  const registeredUserId = state.users.some((user) => user.id === draft.userId) ? draft.userId : "";
  const anonymousName = String(draft.name ?? "").trim();
  if (!registeredUserId && !anonymousName) return state;

  const playerId = registeredUserId || makeId("anon");
  if (getPlayerSideName(match, playerId)) {
    return {
      ...state,
      notifications: [
        { id: makeId("n"), title: "이미 기록 대상", body: "이미 출전 또는 교체 출전 기록에 포함된 선수입니다.", tone: "orange", matchId },
        ...state.notifications,
      ],
    };
  }

  const playedPlayerIds = match.playedPlayerIds ?? match.rules?.playedPlayerIds ?? {};
  const nextPlayedPlayerIds = {
    ...playedPlayerIds,
    [sideName]: uniquePlayerIds([...(playedPlayerIds[sideName] ?? []), playerId]),
  };
  const nextReservePlayers = {
    teamA: getMatchReservePlayerIds(match, "teamA").filter((id) => id !== playerId),
    teamB: getMatchReservePlayerIds(match, "teamB").filter((id) => id !== playerId),
  };
  const nextExcludedIds = uniquePlayerIds([...(match.mmrExcludedPlayerIds ?? match.rules?.mmrExcludedPlayerIds ?? []), playerId]);
  const nextAnonymousPlayers = registeredUserId
    ? match.anonymousPlayers ?? {}
    : { ...(match.anonymousPlayers ?? {}), [playerId]: makeAnonymousMatchPlayer(playerId, anonymousName) };
  const nextMatch = {
    ...match,
    playedPlayerIds: nextPlayedPlayerIds,
    reservePlayers: nextReservePlayers,
    anonymousPlayers: nextAnonymousPlayers,
    mmrExcludedPlayerIds: nextExcludedIds,
    rules: {
      ...(match.rules ?? {}),
      playedPlayerIds: nextPlayedPlayerIds,
      mmrExcludedPlayerIds: nextExcludedIds,
    },
  };

  return {
    ...state,
    matches: state.matches.map((item) => (item.id === matchId ? nextMatch : item)),
    notifications: [
      { id: makeId("n"), title: "경기 후 선수 추가", body: `${SIDE_LABEL_TEXT[sideName]} 기록 대상에 추가했습니다. MMR에는 반영되지 않습니다.`, tone: "match", matchId },
      ...state.notifications,
    ],
  };
}

export function removeMatchLatePlayer(state, matchId, playerId) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!canEditPostgameRoster(state, match) || !playerId) return state;
  const excludedIds = new Set(match.mmrExcludedPlayerIds ?? match.rules?.mmrExcludedPlayerIds ?? []);
  if (!excludedIds.has(playerId)) return state;
  const playedPlayerIds = match.playedPlayerIds ?? match.rules?.playedPlayerIds ?? {};
  const nextPlayedPlayerIds = {
    teamA: uniquePlayerIds(playedPlayerIds.teamA ?? []).filter((id) => id !== playerId),
    teamB: uniquePlayerIds(playedPlayerIds.teamB ?? []).filter((id) => id !== playerId),
  };
  const nextExcludedIds = [...excludedIds].filter((id) => id !== playerId);
  const nextAnonymousPlayers = { ...(match.anonymousPlayers ?? {}) };
  delete nextAnonymousPlayers[playerId];

  return {
    ...state,
    matches: state.matches.map((item) =>
      item.id === matchId
        ? {
            ...item,
            playedPlayerIds: nextPlayedPlayerIds,
            anonymousPlayers: nextAnonymousPlayers,
            mmrExcludedPlayerIds: nextExcludedIds,
            rules: {
              ...(item.rules ?? {}),
              playedPlayerIds: nextPlayedPlayerIds,
              mmrExcludedPlayerIds: nextExcludedIds,
            },
          }
        : item,
    ),
    notifications: [
      { id: makeId("n"), title: "경기 후 선수 제거", body: "기록 전용 추가 선수를 제거했습니다.", tone: "match", matchId },
      ...state.notifications,
    ],
  };
}

export function cancelMatch(state, matchId) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match || !["contract", "agreed"].includes(match.status)) return state;
  const hostPlayerId = getMatchHostPlayerId(state, match);
  if (hostPlayerId && hostPlayerId !== state.currentUserId) return state;

  return {
    ...state,
    matches: state.matches.map((item) =>
      item.id === matchId
        ? { ...item, status: "cancelled", cancelledAt: new Date().toISOString() }
        : item,
    ),
    notifications: [
      { id: makeId("n"), title: "경기 취소", body: `${match.title} 경기방이 취소됐습니다.`, tone: "match", matchId },
      ...state.notifications,
    ],
  };
}

export function voidMatch(state, matchId) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match || match.status !== "disputed") return state;

  return {
    ...state,
    matches: state.matches.map((item) =>
      item.id === matchId
        ? { ...item, status: "void", ranked: false, voidedAt: new Date().toISOString() }
        : item,
    ),
    notifications: [
      { id: makeId("n"), title: "결과 무효", body: `${match.title} 결과가 랭킹 반영에서 제외됐습니다.`, tone: "match", matchId },
      ...state.notifications,
    ],
  };
}

export function resumeMatchApproval(state, matchId) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match || match.status !== "disputed") return state;

  return {
    ...state,
    matches: state.matches.map((item) =>
      item.id === matchId
        ? { ...item, status: "approval", approvals: { teamA: [], teamB: [] }, reviewResumedAt: new Date().toISOString() }
        : item,
    ),
    notifications: [
      { id: makeId("n"), title: "승인 재개", body: `${match.title} 결과 승인을 다시 시작합니다.`, tone: "match", matchId },
      ...state.notifications,
    ],
  };
}

export function toggleMatchStar(state, matchId, targetUserId) {
  const match = state.matches.find((item) => item.id === matchId);
  const feedbackIds = match ? getMatchTrustFeedbackParticipantIds(match) : [];
  if (!match || !isMatchTrustFeedbackOpen(match)) return state;
  if (!feedbackIds.includes(state.currentUserId) || !feedbackIds.includes(targetUserId) || targetUserId === state.currentUserId) return state;

  const maxStars = getMatchTrustFeedbackLimit(match);
  const trustFeedback = match.trustFeedback ?? {};
  const stars = trustFeedback.stars ?? {};
  const myStars = stars[state.currentUserId] ?? [];
  const alreadyStarred = myStars.includes(targetUserId);
  if (!alreadyStarred && myStars.length >= maxStars) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "따봉 한도 도달",
          body: `한 경기에서 최대 ${maxStars}명에게 따봉을 줄 수 있습니다.`,
          tone: "match",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }

  const nextMyStars = alreadyStarred
    ? myStars.filter((userId) => userId !== targetUserId)
    : [...myStars, targetUserId];
  const nextStars = { ...stars, [state.currentUserId]: nextMyStars };

  return {
    ...state,
    users: adjustUserTrust(state.users, targetUserId, alreadyStarred ? -1 : 1),
    matches: state.matches.map((item) => (
      item.id === matchId
        ? {
            ...item,
            trustFeedback: {
              ...trustFeedback,
              stars: nextStars,
              updatedAt: new Date().toISOString(),
            },
          }
        : item
    )),
  };
}

export function submitMatchThumbs(state, matchId, targetUserIds = []) {
  const match = state.matches.find((item) => item.id === matchId);
  const feedbackIds = match ? getMatchTrustFeedbackParticipantIds(match) : [];
  if (!match || !isMatchTrustFeedbackOpen(match)) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "따봉 제출 마감",
          body: "따봉은 기록확정 후 24시간 안에만 제출할 수 있습니다.",
          tone: "orange",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }
  if (!feedbackIds.includes(state.currentUserId)) return state;

  const userIds = new Set(state.users.map((user) => user.id));
  const maxThumbs = getMatchTrustFeedbackLimit(match);
  const nextMyThumbs = Array.from(new Set(targetUserIds))
    .filter((targetUserId) => feedbackIds.includes(targetUserId) && userIds.has(targetUserId) && targetUserId !== state.currentUserId)
    .slice(0, maxThumbs);
  const trustFeedback = match.trustFeedback ?? {};
  const thumbs = trustFeedback.stars ?? {};
  const previousThumbs = thumbs[state.currentUserId] ?? [];
  const previousSet = new Set(previousThumbs);
  const nextSet = new Set(nextMyThumbs);
  const adjustedUsers = state.users.map((user) => {
    if (!feedbackIds.includes(user.id) || user.id === state.currentUserId) return user;
    const gained = nextSet.has(user.id) && !previousSet.has(user.id);
    const lost = previousSet.has(user.id) && !nextSet.has(user.id);
    if (!gained && !lost) return user;
    return {
      ...user,
      trustScore: Math.max(0, Math.min(100, Number(user.trustScore ?? 70) + (gained ? 1 : -1))),
    };
  });

  return {
    ...state,
    users: adjustedUsers,
    matches: state.matches.map((item) => (
      item.id === matchId
        ? {
            ...item,
            trustFeedback: {
              ...trustFeedback,
              stars: { ...thumbs, [state.currentUserId]: nextMyThumbs },
              updatedAt: new Date().toISOString(),
            },
          }
        : item
    )),
    notifications: [
      {
        id: makeId("n"),
        title: "따봉 제출 완료",
        body: `${nextMyThumbs.length}명에게 따봉을 제출했습니다.`,
        tone: "match",
        matchId,
      },
      ...state.notifications,
    ],
  };
}

export function switchUser(state, userId) {
  if (!state.users.some((user) => user.id === userId)) return state;
  return { ...state, currentUserId: userId };
}

export function updatePrivacySettings(state, patch) {
  return {
    ...state,
    settings: normalizeSettings({
      ...(state.settings ?? {}),
      privacy: {
        ...(state.settings?.privacy ?? DEFAULT_SETTINGS.privacy),
        ...patch,
      },
    }),
  };
}

export function updateSettings(state, patch) {
  return {
    ...state,
    settings: normalizeSettings({
      ...(state.settings ?? {}),
      ...patch,
    }),
  };
}

export function blockUser(state, userId) {
  if (!state.users.some((user) => user.id === userId) || userId === state.currentUserId) return state;
  const blockedUserIds = Array.from(new Set([...(state.settings?.blockedUserIds ?? []), userId]));
  const blockedUser = state.users.find((user) => user.id === userId);

  return {
    ...state,
    settings: normalizeSettings({ ...(state.settings ?? {}), blockedUserIds }),
    notifications: [
      {
        id: makeId("n"),
        title: "플레이어 차단",
        body: `${blockedUser?.name ?? "선택한 플레이어"}가 홈 검색과 추천 목록에서 숨겨집니다.`,
        tone: "team",
      },
      ...state.notifications,
    ],
  };
}

export function unblockUser(state, userId) {
  return {
    ...state,
    settings: normalizeSettings({
      ...(state.settings ?? {}),
      blockedUserIds: (state.settings?.blockedUserIds ?? []).filter((id) => id !== userId),
    }),
  };
}

function toggleId(list = [], id) {
  return list.includes(id) ? list.filter((item) => item !== id) : [id, ...list];
}

export function toggleFavoritePlayer(state, userId) {
  if (!state.users.some((user) => user.id === userId)) return state;
  return {
    ...state,
    settings: normalizeSettings({
      ...(state.settings ?? {}),
      favoritePlayerIds: toggleId(state.settings?.favoritePlayerIds, userId),
    }),
  };
}

export function toggleFavoriteTeam(state, teamId) {
  if (!state.teams.some((team) => team.id === teamId)) return state;
  return {
    ...state,
    settings: normalizeSettings({
      ...(state.settings ?? {}),
      favoriteTeamIds: toggleId(state.settings?.favoriteTeamIds, teamId),
    }),
  };
}

export function toggleFavoriteCourt(state, courtId) {
  return {
    ...state,
    settings: normalizeSettings({
      ...(state.settings ?? {}),
      favoriteCourtIds: toggleId(state.settings?.favoriteCourtIds, courtId),
    }),
  };
}

export function reportMatch(state, matchId, reason = "", reportedUserIds = []) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match) return state;
  const matchPlayerIds = new Set(getMatchPlayerIds(match));
  const safeReportedUserIds = Array.from(new Set((reportedUserIds ?? []).filter((userId) => matchPlayerIds.has(userId))));
  const report = {
    id: makeId("r"),
    type: "match",
    targetId: matchId,
    by: state.currentUserId,
    reportedUserIds: safeReportedUserIds,
    reason: reason.trim() || "기타 운영 확인 필요",
    status: "open",
    createdAt: new Date().toISOString(),
  };

  return {
    ...state,
    reports: [report, ...(state.reports ?? [])],
    notifications: [
      {
        id: makeId("n"),
        title: "신고 접수",
        body: `${match.title} 신고가 접수됐습니다. 운영 검토 목록에 남겼습니다.`,
        tone: "match",
        matchId,
      },
      ...state.notifications,
    ],
  };
}

function legacyCreateRecruitingPost(state, draft) {
  const postType = ["find_team", "need_team"].includes(draft.type) ? draft.type : "need_player";
  const userTeamIds = new Set(
    state.teams
      .filter((team) => team.members.some((member) => member.userId === state.currentUserId))
      .map((team) => team.id),
  );
  if (["need_player", "need_team"].includes(postType) && !userTeamIds.has(draft.teamId)) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "소속팀 필요",
          body: "팀 단위 모집은 내 소속팀으로만 올릴 수 있습니다.",
          tone: "team",
        },
        ...state.notifications,
      ],
    };
  }
  const post = {
    id: makeId("q"),
    type: postType,
    title: draft.title?.trim()
      || (postType === "find_team" ? "오늘 뛸 팀 구해요" : postType === "need_team" ? "오늘 경기 상대팀 구해요" : "오늘 경기 용병 1명"),
    region: draft.region || state.users.find((user) => user.id === state.currentUserId)?.region || "전체",
    court: draft.court || "미정",
    mode: draft.mode || "5v5",
    ranked: draft.ranked !== false,
    spots: Math.max(1, Number(draft.spots ?? 1)),
    teamId: ["need_player", "need_team"].includes(postType) ? draft.teamId : null,
    ownerId: state.currentUserId,
    position: draft.position || "상관없음",
    playerId: state.currentUserId,
    memo: draft.memo?.trim() || "같이 뛸 사람을 찾고 있습니다.",
    status: "open",
    applicants: [],
    createdAt: new Date().toISOString(),
  };

  return {
    ...state,
    recruitingPosts: [post, ...(state.recruitingPosts ?? [])],
    notifications: [
      {
        id: makeId("n"),
        title: "모집글 등록",
        body: `${post.title} 모집글이 올라갔습니다.`,
        tone: "team",
      },
      ...state.notifications,
    ],
  };
}

function legacyInterestRecruitingPost(state, postId, application = {}) {
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!post || post.status !== "open") return state;
  if (isRecruitingRoomOwner(post, state.currentUserId) || post.playerId === state.currentUserId) return state;
  const user = state.users.find((item) => item.id === state.currentUserId);
  const applicantKind = getRecruitingApplicantKind(post);
  const myTeams = state.teams.filter((team) => team.members.some((member) => member.userId === state.currentUserId));
  const team = applicantKind === "team"
    ? myTeams.find((item) => item.id === application.teamId) ?? myTeams[0]
    : null;

  if (applicantKind === "team" && !team) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "소속팀 필요",
          body: "이 모집글은 팀으로 참여해야 합니다. 먼저 팀을 만들거나 소속팀을 선택하세요.",
          tone: "team",
        },
        ...state.notifications,
      ],
    };
  }

  const candidateMmr = applicantKind === "team" ? team.mmr : user?.ratings?.integrated ?? 1200;
  const fit = getRecruitingFit(post, candidateMmr, state);
  if (!fit.allowed) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "티어 구간 제한",
          body: `${post.title}은 정규전이라 ${fit.range.label} 구간만 신청할 수 있습니다.`,
          tone: "team",
        },
        ...state.notifications,
      ],
    };
  }
  const nextApplicant = applicantKind === "team"
    ? { kind: "team", teamId: team.id, playerId: state.currentUserId, createdAt: new Date().toISOString() }
    : { kind: "player", playerId: state.currentUserId, createdAt: new Date().toISOString() };
  if (hasRecruitingApplicant(post, nextApplicant)) return state;
  const applicants = [...normalizeRecruitingApplicants(post.applicants ?? []), nextApplicant];

  return {
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (item.id === postId ? { ...item, applicants } : item)),
  };
}

export function createRecruitingPost(state, draft) {
  const hostJoinMode = draft.hostJoinMode === "player" ? "player" : "team";
  const visibility = draft.visibility === "private" ? "private" : "public";
  const teamOnly = visibility === "public" && hostJoinMode === "team" && draft.teamOnly === true;
  const postType = teamOnly ? "need_team" : hostJoinMode === "team" ? "need_player" : "find_team";
  const hostTrustBlock = getHostTrustBlockNotification(state, { ...draft, visibility });
  if (hostTrustBlock) return { ...state, notifications: [hostTrustBlock, ...state.notifications] };
  const userTeamIds = new Set(
    state.teams
      .filter((team) => team.members.some((member) => member.userId === state.currentUserId))
      .map((team) => team.id),
  );

  if (hostJoinMode === "team" && !userTeamIds.has(draft.teamId)) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "소속 팀 필요",
          body: "팀으로 방을 열려면 내 팀을 먼저 선택해야 합니다.",
          tone: "team",
        },
        ...state.notifications,
      ],
    };
  }

  const sideCapacity = Math.max(1, Number(draft.sideCapacity ?? MODE_SIZES[draft.mode] ?? 5));
  const hostTeam = hostJoinMode === "team" ? state.teams.find((team) => team.id === draft.teamId) : null;
  const rawHostPlayerIds = hostJoinMode === "team" ? getSelectedTeamPlayerIds(hostTeam, sideCapacity, draft.playerIds) : [];
  const hostPlayerIds = hostJoinMode === "team" ? ensureTeamPartyLeader(hostTeam, rawHostPlayerIds, state.currentUserId, sideCapacity) : [];
  const hostReservePlayerIds = hostJoinMode === "team" ? getSelectedReservePlayerIds(hostTeam, hostPlayerIds, draft.reservePlayerIds) : [];
  const opponentTeam = visibility === "private" && hostJoinMode === "team"
    ? state.teams.find((team) => team.id === (draft.opponentTeamId ?? draft.targetTeamId))
    : null;
  const hostSidePlayerIds = new Set([...hostPlayerIds, ...hostReservePlayerIds]);
  const opponentPlayerIds = opponentTeam
    ? getSelectedTeamPlayerIds(opponentTeam, sideCapacity, draft.opponentPlayerIds).filter((playerId) => !hostSidePlayerIds.has(playerId))
    : [];
  const opponentLeaderId = opponentPlayerIds.includes(draft.opponentLeaderId) ? draft.opponentLeaderId : opponentPlayerIds[0] ?? "";
  const orderedOpponentPlayerIds = opponentTeam
    ? ensureTeamPartyLeader(opponentTeam, opponentPlayerIds, opponentLeaderId, sideCapacity)
    : [];
  const opponentReservePlayerIds = opponentTeam
    ? getSelectedReservePlayerIds(opponentTeam, orderedOpponentPlayerIds, draft.opponentReservePlayerIds).filter((playerId) => !hostSidePlayerIds.has(playerId))
    : [];
  const hostPlayerId = state.currentUserId;
  if (hostJoinMode === "team" && (!hostPlayerIds.length || (teamOnly && hostPlayerIds.length < sideCapacity))) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "참여 팀원 필요",
          body: teamOnly ? "팀으로만 참여 공개방은 방장 사이드 출전 슬롯을 모두 채워야 합니다." : "팀으로 방을 열려면 실제 참여할 팀원을 1명 이상 선택해야 합니다.",
          tone: "team",
        },
        ...state.notifications,
      ],
    };
  }
  if (visibility === "private" && hostJoinMode === "team" && (!opponentTeam || opponentTeam.id === hostTeam?.id || orderedOpponentPlayerIds.length < sideCapacity)) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "상대 사이드 필요",
          body: "비공개 팀전은 A/B사이드 출전 슬롯이 모두 채워져야 방을 만들 수 있습니다.",
          tone: "team",
        },
        ...state.notifications,
      ],
    };
  }
  const hostSize = hostJoinMode === "team" ? hostPlayerIds.length : 1;
  const opponentSize = orderedOpponentPlayerIds.length;
  const refereeId = getTrustedRefereeId(state, draft.refereeId, [state.currentUserId, ...hostPlayerIds, ...orderedOpponentPlayerIds]);
  const timingType = draft.timingType === "instant" ? "instant" : "scheduled";
  const fallbackSchedule = timingType === "instant" ? null : getNextQueueSchedule(state.recruitingPosts ?? []);
  const scheduledDate = timingType === "instant" ? "" : (draft.scheduledDate || fallbackSchedule.scheduledDate);
  const scheduledTime = timingType === "instant" ? "" : (draft.scheduledTime || fallbackSchedule.scheduledTime);
  const scheduledAt = timingType === "instant" ? "즉시" : `${scheduledDate} ${scheduledTime}`;
  const scheduleMaxDays = visibility === "public" ? PUBLIC_ROOM_SCHEDULE_MAX_DAYS : ROOM_SCHEDULE_MAX_DAYS;
  if (timingType !== "instant" && !isScheduleDateInAllowedWindow(scheduledDate, new Date(), scheduleMaxDays)) {
    return { ...state, notifications: [getInvalidScheduleNotification(scheduleMaxDays), ...state.notifications] };
  }
  const timingStatus = getPublicRoomTimingStatus({ visibility, timingType, scheduledDate, scheduledTime, scheduledAt, createdAt: new Date().toISOString() });
  if (visibility === "public" && !timingStatus.canCreate) {
    return { ...state, notifications: [getInvalidPublicScheduleNotification(timingStatus.detail), ...state.notifications] };
  }
  const mmrRangeMode = normalizeRecruitingMmrRangeMode(draft.mmrRangeMode);
  const ratingScale = draft.ranked === false ? 1 : getRecruitingRatingScale({ ranked: draft.ranked !== false, mmrRangeMode });
  const createdAt = new Date().toISOString();
  const partyReserves = {};
  if (hostReservePlayerIds.length) partyReserves.host = hostReservePlayerIds;
  if (opponentTeam && opponentReservePlayerIds.length) partyReserves[`team:${opponentTeam.id}`] = opponentReservePlayerIds;
  const invitationTargets = visibility === "private" && hostJoinMode === "team" && opponentTeam && opponentLeaderId
    ? [opponentLeaderId]
    : [];
  const initialInvitations = invitationTargets.map((targetUserId) => ({
    id: makeId("inv"),
    targetUserId,
    fromUserId: state.currentUserId,
    teamId: opponentTeam.id,
    side: "teamB",
    reserve: false,
    status: "pending",
    createdAt,
    updatedAt: createdAt,
  }));
  const applicants = opponentTeam && orderedOpponentPlayerIds.length
    ? [
        {
          kind: "team",
          joinMode: "team",
          teamId: opponentTeam.id,
          playerId: opponentLeaderId || orderedOpponentPlayerIds[0],
          side: "teamB",
          status: "waiting",
          reserve: false,
          playerIds: orderedOpponentPlayerIds,
          createdAt,
          updatedAt: createdAt,
        },
      ]
    : [];
  const post = {
    id: makeId("q"),
    type: postType,
    title: draft.title?.trim() || `${draft.ranked === false ? "친선전" : "정규전"} ${draft.mode || "5v5"} 매치 큐`,
    region: draft.region || state.users.find((user) => user.id === state.currentUserId)?.region || "전체",
    court: draft.court || "미정",
    mode: draft.mode || "5v5",
    scheduledDate,
    scheduledTime,
    scheduledAt,
    timingType,
    ranked: draft.ranked !== false,
    mmrRangeMode,
    ratingScale,
    spots: Math.max(0, sideCapacity * 2 - hostSize - opponentSize),
    teamId: hostJoinMode === "team" ? draft.teamId : null,
    targetTeamId: draft.targetTeamId ?? null,
    refereeId,
    refereeTrustMin: REFEREE_TRUST_MIN,
    statEntryMinutes: STAT_ENTRY_WINDOW_MINUTES,
    disputeMinutes: DISPUTE_WINDOW_MINUTES,
    ownerId: state.currentUserId,
    hostJoinMode,
    teamOnly,
    hostSide: "teamA",
    hostReady: true,
    visibility,
    roomState: {
      ownerId: state.currentUserId,
      mmrRangeMode,
      timingType,
      ruleRevision: 1,
      teamOnly,
      approvalModeA: draft.approvalModeA === "all" ? "all" : "leader",
      approvalModeB: draft.approvalModeB === "all" ? "all" : "leader",
      partyReserves,
      partyLeaders: {
        host: state.currentUserId,
        ...(opponentTeam && opponentLeaderId ? { [`team:${opponentTeam.id}`]: opponentLeaderId } : {}),
      },
      invitations: initialInvitations,
    },
    sideCapacity,
    playerIds: hostPlayerIds,
    position: hostJoinMode === "player" ? draft.position || "포지션 자유" : "포지션 자유",
    playerId: hostPlayerId,
    rules: draft.rules ?? {},
    official: Boolean(draft.official),
    preRegistered: draft.preRegistered !== false,
    stakes: draft.stakes ?? "",
    courtReserved: Boolean(draft.courtReserved),
    courtFee: draft.courtFee ?? "",
    memo: draft.memo?.trim() || "개인이나 팀 파티로 빈자리에 들어올 수 있습니다.",
    status: "open",
    applicants,
    createdAt,
  };

  return {
    ...state,
    recruitingPosts: [post, ...(state.recruitingPosts ?? [])],
    notifications: [
      ...initialInvitations.map((invitation) => ({
        id: makeId("n"),
        title: "매치방 초대",
        body: `${post.title} B사이드 파티장 초대장이 도착했습니다. 수락하면 B사이드가 READY가 됩니다.`,
        tone: "match",
        targetUserId: invitation.targetUserId,
        recruitingPostId: post.id,
      })),
      {
        id: makeId("n"),
        title: "매치 큐 등록",
        body: `${post.title} 방이 열렸습니다.`,
        tone: "team",
      },
      ...state.notifications,
    ],
  };
}

export function interestRecruitingPost(state, postId, application = {}) {
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!post || post.status !== "open") return state;
  if (isRecruitingRoomOwner(post, state.currentUserId) || post.playerId === state.currentUserId) return state;
  const user = state.users.find((item) => item.id === state.currentUserId);
  const teamOnly = post.teamOnly === true || post.roomState?.teamOnly === true;
  const requestedJoinMode = application.joinMode === "team" || application.teamId
    ? "team"
    : application.joinMode === "player"
      ? (teamOnly ? "team" : "player")
      : getRecruitingApplicantKind(post);
  const applicantKind = requestedJoinMode === "team" ? "team" : "player";
  const myTeams = state.teams.filter((team) => team.members.some((member) => member.userId === state.currentUserId));
  const team = applicantKind === "team"
    ? myTeams.find((item) => item.id === application.teamId) ?? myTeams[0]
    : null;

  if (applicantKind === "team" && !team) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "소속 팀 필요",
          body: "팀으로 들어가려면 내 팀이 필요합니다.",
          tone: "team",
        },
        ...state.notifications,
      ],
    };
  }

  const sideCapacity = getRecruitingSideCapacity(post);
  const selectedPlayerIds = applicantKind === "team"
    ? ensureTeamPartyLeader(team, getSelectedTeamPlayerIds(team, sideCapacity, application.playerIds), state.currentUserId, sideCapacity)
    : [];
  const selectedReservePlayerIds = applicantKind === "team"
    ? getSelectedReservePlayerIds(team, selectedPlayerIds, application.reservePlayerIds)
    : [];
  const candidateMmr = applicantKind === "team"
    ? getAveragePlayerMmr(state, selectedPlayerIds, team?.mmr ?? user?.ratings?.integrated ?? 1200)
    : user?.ratings?.integrated ?? 1200;
  const fit = getRecruitingFit(post, candidateMmr, state);
  if (!fit.allowed) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "티어 구간 제한",
          body: `${post.title} 정규전은 ${fit.range.label} 구간만 대기할 수 있습니다.`,
          tone: "team",
        },
        ...state.notifications,
      ],
    };
  }

  const side = ["teamA", "teamB"].includes(application.side) ? application.side : getRecruitingBestSide(post, state);
  const lobby = getRecruitingLobby(post, state);
  if (applicantKind === "team" && (!selectedPlayerIds.length || (teamOnly && selectedPlayerIds.length < sideCapacity))) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "참여 팀원 필요",
          body: teamOnly ? "팀으로만 참여 방은 출전 슬롯을 모두 채울 팀 파티로만 들어갈 수 있습니다." : "팀으로 대기하려면 실제 참여할 팀원을 1명 이상 선택해야 합니다.",
          tone: "team",
        },
        ...state.notifications,
      ],
    };
  }
  const partySize = applicantKind === "team" ? selectedPlayerIds.length : 1;
  const reserve = Boolean(application.reserve) || lobby.sides[side].filled + partySize > lobby.sides[side].capacity;
  const now = new Date().toISOString();
  const nextApplicant = applicantKind === "team"
    ? {
        kind: "team",
        joinMode: "team",
        teamId: team.id,
        playerId: state.currentUserId,
        side,
        status: "ready",
        reserve,
        position: application.position ?? null,
        playerIds: selectedPlayerIds,
        createdAt: now,
        updatedAt: now,
      }
    : {
        kind: "player",
        joinMode: "player",
        playerId: state.currentUserId,
        teamId: null,
        side,
        status: "ready",
        reserve,
        position: application.position ?? user?.position ?? null,
        createdAt: now,
        updatedAt: now,
      };
  if (hasRecruitingApplicant(post, nextApplicant)) return state;
  const applicants = [...normalizeRecruitingApplicants(post.applicants ?? []), nextApplicant];
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const applicantKey = getRecruitingApplicantKey(nextApplicant);
  const nextPartyReserves = { ...roomState.partyReserves };
  if (applicantKind === "team" && selectedReservePlayerIds.length) {
    nextPartyReserves[applicantKey] = selectedReservePlayerIds;
  } else {
    delete nextPartyReserves[applicantKey];
  }
  const nextPartyLeaders = { ...(roomState.partyLeaders ?? {}) };
  if (applicantKind === "team") nextPartyLeaders[applicantKey] = state.currentUserId;
  const reservePinnedIds = applicantKind === "team" ? selectedPlayerIds : [state.currentUserId];
  const nextRoomState = updateManyPinnedReservePlayers(
    updateManyPinnedReservePlayers(
      { ...roomState, partyReserves: nextPartyReserves, partyLeaders: nextPartyLeaders },
      side,
      reservePinnedIds,
      reserve,
    ),
    side,
    selectedReservePlayerIds,
    true,
  );
  const nextPost = { ...post, applicants, roomState: nextRoomState };
  if (reserve && isRecruitingReserveLimitExceeded(nextPost, state, side)) {
    return {
      ...state,
      notifications: [getRecruitingReserveLimitNotification(postId, side), ...state.notifications],
    };
  }

  return applyAutomaticRecruitingConfirmations({
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (item.id === postId ? nextPost : item)),
  });
}

function getLobbySideName(lobby, sideName) {
  const names = lobby.sides[sideName].entries
    .map((entry) => entry.team?.name ?? entry.user?.name)
    .filter(Boolean);
  if (!names.length) return sideName === "teamA" ? "A사이드" : "B사이드";
  return names.slice(0, 3).join(" + ");
}

function getLobbyPrimaryTeamId(lobby, sideName) {
  return getLobbyEntryTeamId(lobby.sides[sideName].entries.find((entry) => getLobbyEntryTeamId(entry))) ?? null;
}

function getLobbyEntryTeamId(entry = {}) {
  if (!entry.fixed && entry.kind !== "team") return null;
  return entry.team?.id ?? entry.teamId ?? null;
}

function getLobbySidePlayerTeamIds(lobby, sideName) {
  return Object.fromEntries(
    lobby.sides[sideName].entries
      .flatMap((entry) => {
        const teamId = getLobbyEntryTeamId(entry);
        if (!teamId) return [];
        return (entry.players ?? []).map((playerId) => [playerId, teamId]);
      }),
  );
}

export function setRecruitingReady(state, postId, ready = true) {
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!post || post.status !== "open") return state;
  const updatedAt = new Date().toISOString();
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const lobby = getRecruitingLobby(post, state);
  const applicants = normalizeRecruitingApplicants(post.applicants ?? []);
  const currentApplicant = applicants.find((applicant) => (
    applicant.playerId === state.currentUserId || (applicant.playerIds ?? []).includes(state.currentUserId)
  ));
  const hostEntry = (lobby.entries ?? []).find((entry) => entry.id === "host");
  const hostPartyUser = !currentApplicant && (
    (hostEntry?.players ?? []).includes(state.currentUserId) ||
    (hostEntry?.reserves ?? []).includes(state.currentUserId) ||
    (post.hostJoinMode === "player" && post.playerId === state.currentUserId)
  );
  const activePlayerIds = new Set([...lobby.sides.teamA.projectedPlayers, ...lobby.sides.teamB.projectedPlayers]);
  const reserveCandidate = [...lobby.sides.teamA.reserveCandidates, ...lobby.sides.teamB.reserveCandidates]
    .find((candidate) => candidate.playerId === state.currentUserId && !activePlayerIds.has(candidate.playerId));
  const nextReserveReady = { ...(roomState.reserveReady ?? {}) };
  if (reserveCandidate) {
    if (ready) nextReserveReady[state.currentUserId] = true;
    else delete nextReserveReady[state.currentUserId];
  }
  const nextRoomState = reserveCandidate
    ? { ...roomState, reserveReady: nextReserveReady }
    : roomState;

  return applyAutomaticRecruitingConfirmations({
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => {
      if (item.id !== postId) return item;
      if (hostPartyUser) {
        return { ...item, hostReady: Boolean(ready), roomState: nextRoomState };
      }
      return cleanRecruitingRoomStatRecorders({
        ...item,
        roomState: nextRoomState,
        applicants: normalizeRecruitingApplicants(item.applicants ?? []).map((applicant) => (
          getRecruitingApplicantKey(applicant) === getRecruitingApplicantKey(currentApplicant)
            ? { ...applicant, status: ready ? "ready" : "waiting", updatedAt }
            : applicant
        )),
      }, state);
    }),
  });
}

export function updateRecruitingRoomRules(state, postId, patch = {}) {
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!post || post.status !== "open" || !isRecruitingRoomOwner(post, state.currentUserId)) return state;

  const currentCapacity = getRecruitingSideCapacity(post);
  const sideCapacity = Math.max(1, Math.min(5, Number(patch.sideCapacity ?? currentCapacity)));
  const currentLobby = getRecruitingLobby(post, state);
  if (currentLobby.sides.teamA.projectedFilled > sideCapacity || currentLobby.sides.teamB.projectedFilled > sideCapacity) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "정원 변경 불가",
          body: "현재 출전 인원이 새 정원보다 많습니다. 먼저 후보로 빼고 다시 변경하세요.",
          tone: "orange",
          recruitingPostId: postId,
        },
        ...state.notifications,
      ],
    };
  }
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const nextMmrRangeMode = normalizeRecruitingMmrRangeMode(patch.mmrRangeMode ?? post.mmrRangeMode ?? roomState.mmrRangeMode);
  const nextRules = {
    targetScore: Math.max(7, Math.min(31, Number(patch.targetScore ?? post.rules?.targetScore ?? 21))),
    timeLimit: Math.max(5, Math.min(60, Number(patch.timeLimit ?? post.rules?.timeLimit ?? 12))),
    winByTwo: Boolean(patch.winByTwo ?? post.rules?.winByTwo ?? true),
    ball: patch.ball ?? post.rules?.ball ?? "7호 공",
    attackRule: String(patch.attackRule ?? post.rules?.attackRule ?? "득점 후 공격권 교대").slice(0, 120),
    foulRule: String(patch.foulRule ?? post.rules?.foulRule ?? "파울 콜 즉시 중단, 공격권 유지").slice(0, 120),
  };
  const updatedAt = new Date().toISOString();
  const nextPost = cleanRecruitingRoomStatRecorders({
    ...post,
    mode: `${sideCapacity}v${sideCapacity}`,
    sideCapacity,
    mmrRangeMode: nextMmrRangeMode,
    ratingScale: post.ranked === false ? 1 : getRecruitingRatingScale({ ...post, mmrRangeMode: nextMmrRangeMode }),
    rules: {
      ...(post.rules ?? {}),
      ...nextRules,
      mmrRangeMode: nextMmrRangeMode,
      ratingScale: post.ranked === false ? 1 : getRecruitingRatingScale({ ...post, mmrRangeMode: nextMmrRangeMode }),
    },
    memo: patch.memo === undefined ? post.memo : String(patch.memo ?? "").slice(0, 500),
    hostReady: true,
    applicants: normalizeRecruitingApplicants(post.applicants ?? []).map((applicant) => ({
      ...applicant,
      status: "waiting",
      updatedAt,
    })),
    roomState: {
      ...roomState,
      mmrRangeMode: nextMmrRangeMode,
      ruleRevision: Number(roomState.ruleRevision ?? 0) + 1,
      ruleChangedAt: updatedAt,
    },
  }, state);
  return {
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (item.id === postId ? nextPost : item)),
    notifications: [
      {
        id: makeId("n"),
        title: "매칭방 룰 변경",
        body: `${post.title} 룰이 바뀌어 참여자 재확인이 필요합니다.`,
        tone: "match",
        recruitingPostId: postId,
      },
      ...state.notifications,
    ],
  };
}

export function updateMatchRoomRules(state, matchId, patch = {}) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match || !["contract", "agreed"].includes(match.status) || match.result || match.endedAt) return state;
  const hostPlayerId = getMatchHostPlayerId(state, match);
  if (hostPlayerId && hostPlayerId !== state.currentUserId) return state;
  const sideCapacity = Math.max(1, Math.min(5, Number(patch.sideCapacity ?? getRecruitingSideCapacity(match))));
  const teamAActiveCount = uniquePlayerIds(match.teamA?.players ?? []).length;
  const teamBActiveCount = uniquePlayerIds(match.teamB?.players ?? []).length;
  if (teamAActiveCount > sideCapacity || teamBActiveCount > sideCapacity) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "정원 변경 불가",
          body: "현재 출전 인원이 새 정원보다 많습니다. 먼저 미출석 인원을 후보로 내리거나 강퇴하세요.",
          tone: "orange",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }
  const convertToPlayerMatch = patch.matchJoinMode === "player";
  const nextRules = {
    ...(match.rules ?? {}),
    sideCapacity,
    targetScore: Math.max(7, Math.min(31, Number(patch.targetScore ?? match.rules?.targetScore ?? 21))),
    timeLimit: Math.max(5, Math.min(60, Number(patch.timeLimit ?? match.rules?.timeLimit ?? 12))),
    winByTwo: Boolean(patch.winByTwo ?? match.rules?.winByTwo ?? true),
    ball: patch.ball ?? match.rules?.ball ?? "7호 공",
    attackRule: String(patch.attackRule ?? match.rules?.attackRule ?? "득점 후 공격권 교대").slice(0, 120),
    foulRule: String(patch.foulRule ?? match.rules?.foulRule ?? "파울 콜 즉시 중단, 공격권 유지").slice(0, 120),
  };
  delete nextRules.startedAt;
  const nextMatch = {
    ...match,
    mode: `${sideCapacity}v${sideCapacity}`,
    status: "agreed",
    rules: nextRules,
    sideCapacity,
    memo: patch.memo === undefined ? match.memo : String(patch.memo ?? "").slice(0, 500),
    stakes: patch.stakes === undefined ? match.stakes : String(patch.stakes ?? "").slice(0, 500),
    teamA: {
      ...(match.teamA ?? {}),
      teamId: convertToPlayerMatch ? null : match.teamA?.teamId ?? null,
      playerTeams: convertToPlayerMatch ? {} : match.teamA?.playerTeams ?? {},
    },
    teamB: {
      ...(match.teamB ?? {}),
      teamId: convertToPlayerMatch ? null : match.teamB?.teamId ?? null,
      playerTeams: convertToPlayerMatch ? {} : match.teamB?.playerTeams ?? {},
    },
    parties: convertToPlayerMatch ? [] : match.parties ?? [],
    agreements: { teamA: [], teamB: [] },
    attendance: { teamA: [], teamB: [] },
    agreedAt: null,
    startedAt: null,
  };
  return {
    ...state,
    matches: state.matches.map((item) => (item.id === matchId ? nextMatch : item)),
    notifications: [
      {
        id: makeId("n"),
        title: "경기 룰 변경",
        body: `${match.title} 룰이 바뀌어 재확인이 필요합니다.`,
        tone: "match",
        matchId,
      },
      ...state.notifications,
    ],
  };
}

function canEditMatchPreparation(state, match) {
  if (!match || !["contract", "agreed"].includes(match.status) || match.result || match.endedAt || match.startedAt) return false;
  const hostPlayerId = getMatchHostPlayerId(state, match);
  return !hostPlayerId || hostPlayerId === state.currentUserId;
}

function getMatchPlayerPlacement(match = {}, playerId = "") {
  for (const sideName of ["teamA", "teamB"]) {
    if ((match[sideName]?.players ?? []).includes(playerId)) return { side: sideName, reserve: false };
    if (getMatchReservePlayerIds(match, sideName).includes(playerId)) return { side: sideName, reserve: true };
  }
  return null;
}

function updateMatchPartiesForPlayer(match = {}, playerId = "", sideName = "", reserve = false, remove = false) {
  return (match.parties ?? [])
    .map((party) => {
      const hadPlayer = (party.players ?? []).includes(playerId) || (party.reserves ?? []).includes(playerId);
      const nextPlayers = uniquePlayerIds(party.players ?? []).filter((id) => id !== playerId);
      const nextReserves = uniquePlayerIds(party.reserves ?? []).filter((id) => id !== playerId);
      if (!remove && hadPlayer && party.side === sideName) {
        if (reserve) nextReserves.push(playerId);
        else nextPlayers.push(playerId);
      }
      return {
        ...party,
        players: uniquePlayerIds(nextPlayers),
        reserves: uniquePlayerIds(nextReserves),
        reserve: party.reserve && !nextPlayers.length,
      };
    })
    .filter((party) => (party.players ?? []).length || (party.reserves ?? []).length);
}

function clearMatchPlayerDecision(nextMatch, playerId) {
  const attendance = getMatchAttendance(nextMatch);
  return {
    ...nextMatch,
    agreements: {
      teamA: (nextMatch.agreements?.teamA ?? []).filter((id) => id !== playerId),
      teamB: (nextMatch.agreements?.teamB ?? []).filter((id) => id !== playerId),
    },
    approvals: {
      teamA: (nextMatch.approvals?.teamA ?? []).filter((id) => id !== playerId),
      teamB: (nextMatch.approvals?.teamB ?? []).filter((id) => id !== playerId),
    },
    attendance: {
      teamA: attendance.teamA.filter((id) => id !== playerId),
      teamB: attendance.teamB.filter((id) => id !== playerId),
    },
  };
}

export function setMatchRoomPlayerPlacement(state, matchId, playerId, placement = {}) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!canEditMatchPreparation(state, match) || !playerId) return state;
  const currentPlacement = getMatchPlayerPlacement(match, playerId);
  if (!currentPlacement) return state;
  const targetSide = ["teamA", "teamB"].includes(placement.side) ? placement.side : currentPlacement.side;
  const targetReserve = Boolean(placement.reserve);
  const sideCapacity = getRecruitingSideCapacity(match);
  const teamMatchLocked = Boolean(match.teamA?.teamId || match.teamB?.teamId || (match.parties ?? []).some((party) => party.teamId));
  if (teamMatchLocked && targetSide !== currentPlacement.side) return state;

  const baseTeamAPlayers = uniquePlayerIds(match.teamA?.players ?? []).filter((id) => id !== playerId);
  const baseTeamBPlayers = uniquePlayerIds(match.teamB?.players ?? []).filter((id) => id !== playerId);
  const nextReservePlayers = {
    teamA: getMatchReservePlayerIds(match, "teamA").filter((id) => id !== playerId),
    teamB: getMatchReservePlayerIds(match, "teamB").filter((id) => id !== playerId),
  };
  const nextTeamAPlayers = targetSide === "teamA" && !targetReserve ? uniquePlayerIds([...baseTeamAPlayers, playerId]) : baseTeamAPlayers;
  const nextTeamBPlayers = targetSide === "teamB" && !targetReserve ? uniquePlayerIds([...baseTeamBPlayers, playerId]) : baseTeamBPlayers;
  if (targetReserve) nextReservePlayers[targetSide] = uniquePlayerIds([...nextReservePlayers[targetSide], playerId]);
  if (nextTeamAPlayers.length > sideCapacity || nextTeamBPlayers.length > sideCapacity) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "출전 이동 불가",
          body: "해당 사이드 출전 슬롯이 가득 찼습니다.",
          tone: "orange",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }

  const nextMatch = clearMatchPlayerDecision({
    ...match,
    status: "agreed",
    teamA: { ...(match.teamA ?? {}), players: nextTeamAPlayers },
    teamB: { ...(match.teamB ?? {}), players: nextTeamBPlayers },
    reservePlayers: nextReservePlayers,
    parties: updateMatchPartiesForPlayer(match, playerId, targetSide, targetReserve),
    agreedAt: null,
  }, playerId);

  return {
    ...state,
    matches: state.matches.map((item) => (item.id === matchId ? nextMatch : item)),
  };
}

export function removeMatchRoomPlayer(state, matchId, playerId) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!canEditMatchPreparation(state, match) || !playerId || playerId === state.currentUserId) return state;
  const placement = getMatchPlayerPlacement(match, playerId);
  if (!placement) return state;

  const nextReservePlayers = {
    teamA: getMatchReservePlayerIds(match, "teamA").filter((id) => id !== playerId),
    teamB: getMatchReservePlayerIds(match, "teamB").filter((id) => id !== playerId),
  };
  const nextMatch = clearMatchPlayerDecision({
    ...match,
    status: "agreed",
    teamA: { ...(match.teamA ?? {}), players: uniquePlayerIds(match.teamA?.players ?? []).filter((id) => id !== playerId) },
    teamB: { ...(match.teamB ?? {}), players: uniquePlayerIds(match.teamB?.players ?? []).filter((id) => id !== playerId) },
    reservePlayers: nextReservePlayers,
    parties: updateMatchPartiesForPlayer(match, playerId, placement.side, placement.reserve, true),
    agreedAt: null,
  }, playerId);

  return {
    ...state,
    matches: state.matches.map((item) => (item.id === matchId ? nextMatch : item)),
    notifications: [
      {
        id: makeId("n"),
        title: "미출석 인원 강퇴",
        body: "경기준비방에서 미출석 인원을 정리했습니다.",
        tone: "match",
        matchId,
      },
      ...state.notifications,
    ],
  };
}

export function cancelRecruitingParticipation(state, postId) {
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!post || post.status !== "open" || isRecruitingRoomOwner(post, state.currentUserId) || post.playerId === state.currentUserId) return state;
  const currentUserId = state.currentUserId;
  const removeUserFromRoomState = (roomState = {}) => {
    const normalizedRoomState = normalizeRecruitingRoomState(roomState);
    const nextPartyReserves = Object.fromEntries(
      Object.entries(normalizedRoomState.partyReserves ?? {})
        .map(([key, ids]) => [key, ids.filter((playerId) => playerId !== currentUserId)])
        .filter(([, ids]) => ids.length),
    );
    const nextPinnedReservePlayers = Object.fromEntries(
      Object.entries(normalizedRoomState.pinnedReservePlayers ?? {})
        .map(([sideName, ids]) => [sideName, ids.filter((playerId) => playerId !== currentUserId)])
        .filter(([, ids]) => ids.length),
    );
    const nextReserveReady = { ...(normalizedRoomState.reserveReady ?? {}) };
    const nextSlotPositions = { ...(normalizedRoomState.slotPositions ?? {}) };
    delete nextReserveReady[currentUserId];
    delete nextSlotPositions[currentUserId];
    return {
      ...normalizedRoomState,
      partyReserves: nextPartyReserves,
      pinnedReservePlayers: nextPinnedReservePlayers,
      reserveReady: nextReserveReady,
      slotPositions: nextSlotPositions,
    };
  };

  return {
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => {
      if (item.id !== postId) return item;
      const applicants = normalizeRecruitingApplicants(item.applicants ?? [])
        .map((applicant) => {
          if (applicant.playerId === currentUserId) return null;
          if (applicant.kind !== "team") return applicant;
          const nextPlayerIds = (applicant.playerIds ?? []).filter((playerId) => playerId !== currentUserId);
          if (!nextPlayerIds.length) return null;
          return {
            ...applicant,
            playerIds: nextPlayerIds,
            playerId: applicant.playerId && applicant.playerId !== currentUserId ? applicant.playerId : nextPlayerIds[0],
          };
        })
        .filter(Boolean);
      const playerIds = Array.isArray(item.playerIds)
        ? item.playerIds.filter((playerId) => playerId !== currentUserId)
        : item.playerIds;
      return cleanRecruitingRoomStatRecorders({
        ...item,
        playerIds,
        roomState: removeUserFromRoomState(item.roomState ?? {}),
        applicants,
      }, state);
    }),
  };
}

export function sendRecruitingChat(state, postId, body = "") {
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  const text = String(body).trim().slice(0, 500);
  if (!post || !text || !isRecruitingRoomMember(post, state.currentUserId, state)) return state;
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const message = {
    id: makeId("chat"),
    userId: state.currentUserId,
    body: text,
    createdAt: new Date().toISOString(),
  };

  return {
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
      item.id === postId
        ? { ...item, roomState: { ...roomState, chatMessages: [...roomState.chatMessages, message] } }
        : item
    )),
  };
}

export function inviteRecruitingPlayers(state, postId, invite = {}) {
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!post || post.status !== "open") return state;
  if (!isRecruitingRoomParticipant(post, state.currentUserId, state)) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "초대 권한 없음",
          body: "방에 참여한 사람만 빈 슬롯이나 후보를 초대할 수 있습니다.",
          tone: "orange",
          recruitingPostId: postId,
        },
        ...state.notifications,
      ],
    };
  }

  const side = ["teamA", "teamB"].includes(invite.side) ? invite.side : "teamB";
  const reserve = Boolean(invite.reserve);
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const lobby = getRecruitingLobby(post, state);
  const teamOnly = post.teamOnly === true || roomState.teamOnly === true;
  const sideTeamId = getLobbyPrimaryTeamId(lobby, side);
  if (teamOnly) {
    if (!sideTeamId) {
      return {
        ...state,
        notifications: [
          {
            id: makeId("n"),
            title: "초대 제한",
            body: "팀으로만 참여 방은 해당 사이드가 팀으로 점유된 뒤 같은 팀원만 초대할 수 있습니다.",
            tone: "orange",
            recruitingPostId: postId,
          },
          ...state.notifications,
        ],
      };
    }
    const sideTeam = state.teams.find((team) => team.id === sideTeamId);
    const sideTeamMemberIds = new Set((sideTeam?.members ?? []).map((member) => member.userId));
    const targetIds = Array.from(new Set(invite.playerIds ?? [invite.playerId])).filter(Boolean);
    const inviterInSideTeam = sideTeamMemberIds.has(state.currentUserId);
    const targetsInSideTeam = targetIds.every((playerId) => sideTeamMemberIds.has(playerId));
    const inviteTeamMatches = !invite.teamId || invite.teamId === sideTeamId;
    if (!inviterInSideTeam || !targetsInSideTeam || !inviteTeamMatches) {
      return {
        ...state,
        notifications: [
          {
            id: makeId("n"),
            title: "초대 제한",
            body: "팀으로만 참여 방은 해당 사이드를 점유한 팀원만 같은 팀원을 초대할 수 있습니다.",
            tone: "orange",
            recruitingPostId: postId,
          },
          ...state.notifications,
        ],
      };
    }
  }
  const existingPlayerIds = new Set([
    post.playerId,
    ...lobby.entries.flatMap((entry) => [entry.playerId, ...(entry.players ?? []), ...(entry.reserves ?? [])]),
    ...roomState.invitations
      .filter((invitation) => invitation.status === "pending")
      .map((invitation) => invitation.targetUserId),
  ].filter(Boolean));
  const targetUserIds = Array.from(new Set(invite.playerIds ?? [invite.playerId]))
    .filter((playerId) => state.users.some((user) => user.id === playerId))
    .filter((playerId) => !existingPlayerIds.has(playerId));

  if (!targetUserIds.length) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "초대 대상 없음",
          body: "이미 방에 있거나 초대된 선수입니다.",
          tone: "team",
        },
        ...state.notifications,
      ],
    };
  }

  const outOfRangeUser = targetUserIds
    .map((playerId) => state.users.find((user) => user.id === playerId))
    .find((targetUser) => targetUser && !getRecruitingFit(post, targetUser.ratings?.integrated ?? 1200, state).allowed);
  if (outOfRangeUser) {
    const fit = getRecruitingFit(post, outOfRangeUser.ratings?.integrated ?? 1200, state);
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "티어 구간 제한",
          body: `${outOfRangeUser.name} 선수는 ${fit.range.label} 구간 밖이라 초대할 수 없습니다.`,
          tone: "orange",
          recruitingPostId: postId,
        },
        ...state.notifications,
      ],
    };
  }

  if (reserve) {
    const reserveCount = lobby.sides[side]?.reserveCandidates?.length ?? 0;
    const pendingReserveCount = getPendingReserveInvitationCount(roomState, side);
    if (reserveCount + pendingReserveCount + targetUserIds.length > MAX_RECRUITING_RESERVES_PER_SIDE) {
      return {
        ...state,
        notifications: [getRecruitingReserveLimitNotification(postId, side), ...state.notifications],
      };
    }
  }

  const now = new Date().toISOString();
  const invitations = [
    ...roomState.invitations,
    ...targetUserIds.map((targetUserId) => ({
      id: makeId("inv"),
      targetUserId,
      fromUserId: state.currentUserId,
      teamId: invite.teamId ?? null,
      side,
      reserve,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    })),
  ];

  return {
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
      item.id === postId ? { ...item, roomState: { ...roomState, invitations } } : item
    )),
    notifications: [
      ...targetUserIds.map((targetUserId) => ({
        id: makeId("n"),
        title: "매치방 초대",
        body: `${post.title} ${SIDE_LABEL_TEXT[side]} ${reserve ? "후보" : "빈 슬롯"} 초대장이 도착했습니다.`,
        tone: "match",
        targetUserId,
        recruitingPostId: postId,
      })),
      {
        id: makeId("n"),
        title: "초대장 발송",
        body: `${post.title} ${SIDE_LABEL_TEXT[side]} ${reserve ? "후보" : "빈 슬롯"}에 ${targetUserIds.length}명 초대장을 보냈습니다.`,
        tone: "match",
      },
      ...state.notifications,
    ],
  };
}

export function acceptRecruitingInvitation(state, postId, invitationId) {
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!post || post.status !== "open" || isRecruitingRoomOwner(post, state.currentUserId) || post.playerId === state.currentUserId) return state;
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const invitation = roomState.invitations.find((item) => (
    item.id === invitationId &&
    item.targetUserId === state.currentUserId &&
    item.status === "pending"
  ));
  if (!invitation) return state;

  const user = state.users.find((item) => item.id === state.currentUserId);
  const invitationTeamId = inferRecruitingInvitationTeamId(post, state, invitation);
  const invitedTeam = invitationTeamId
    ? state.teams.find((team) => team.id === invitationTeamId && team.members.some((member) => member.userId === state.currentUserId))
    : null;
  const fit = getRecruitingFit(post, user?.ratings?.integrated ?? 1200, state);
  const expireInvitation = (body) => ({
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
      item.id === postId
        ? {
            ...item,
            roomState: {
              ...roomState,
              invitations: roomState.invitations.map((candidate) => (
                candidate.id === invitationId ? { ...candidate, status: "expired", updatedAt: new Date().toISOString() } : candidate
              )),
            },
          }
        : item
    )),
    notifications: [
      {
        id: makeId("n"),
        title: "초대 수락 실패",
        body,
        tone: "orange",
      },
      ...state.notifications,
    ],
  });

  if (!fit.allowed) {
    return expireInvitation(`${post.title} 정규전은 ${fit.range.label} 구간만 대기할 수 있습니다.`);
  }

  const lobby = getRecruitingLobby(post, state);
  const side = ["teamA", "teamB"].includes(invitation.side) ? invitation.side : getRecruitingBestSide(post, state);
  const reserve = Boolean(invitation.reserve);
  const invitedTeamCapacity = getRecruitingSideCapacity(post);
  const invitedTeamKey = invitedTeam ? `team:${invitedTeam.id}` : "";
  const existingInvitedTeamApplicant = invitedTeam
    ? normalizeRecruitingApplicants(post.applicants ?? []).find((applicant) => getRecruitingApplicantKey(applicant) === invitedTeamKey)
    : null;
  const alreadyInInvitedTeamSlot = existingInvitedTeamApplicant
    ? getExplicitInvitationTeamPlayerIds(
      invitedTeam,
      invitedTeamCapacity,
      existingInvitedTeamApplicant.playerIds,
      existingInvitedTeamApplicant.playerId,
    ).includes(state.currentUserId)
    : false;
  if (reserve && (lobby.sides[side]?.reserveCandidates?.length ?? 0) >= MAX_RECRUITING_RESERVES_PER_SIDE) {
    return expireInvitation(`${SIDE_LABEL_TEXT[side]} 후보가 이미 ${MAX_RECRUITING_RESERVES_PER_SIDE}명입니다.`);
  }
  if (!reserve && lobby.sides[side].filled >= lobby.sides[side].capacity && !alreadyInInvitedTeamSlot) {
    return expireInvitation("방이 꽉 찼습니다. 먼저 수락한 선수만 들어갑니다.");
  }

  const now = new Date().toISOString();
  if (invitedTeam) {
    const capacity = invitedTeamCapacity;
    const applicants = normalizeRecruitingApplicants(post.applicants ?? []);
    const teamKey = invitedTeamKey;
    const isHostParty = post.teamId === invitedTeam.id && post.hostJoinMode !== "player";
    const existingApplicant = existingInvitedTeamApplicant;
    const currentPlayerIds = isHostParty
      ? getExplicitInvitationTeamPlayerIds(invitedTeam, capacity, post.playerIds, post.playerId)
      : existingApplicant
        ? getExplicitInvitationTeamPlayerIds(invitedTeam, capacity, existingApplicant.playerIds, existingApplicant.playerId)
          : [];
    const nextPlayerIds = Array.from(new Set([...currentPlayerIds, state.currentUserId])).slice(0, capacity);
    if (!reserve && !nextPlayerIds.includes(state.currentUserId)) {
      return expireInvitation("방이 꽉 찼습니다. 먼저 수락한 선수만 들어갑니다.");
    }

    const reserveKey = isHostParty ? "host" : teamKey;
    const currentReserveIds = roomState.partyReserves?.[reserveKey] ?? [];
    const nextReserveIds = reserve
      ? Array.from(new Set([...currentReserveIds, state.currentUserId]))
      : currentReserveIds.filter((playerId) => playerId !== state.currentUserId);
    const nextPartyReserves = { ...roomState.partyReserves, [reserveKey]: nextReserveIds };
    if (!nextReserveIds.length) delete nextPartyReserves[reserveKey];
    const nextRoomState = {
      ...updatePinnedReservePlayers(
        { ...roomState, partyReserves: nextPartyReserves },
        side,
        state.currentUserId,
        reserve,
      ),
      invitations: roomState.invitations.filter((candidate) => candidate.id !== invitationId),
    };
    const nextApplicant = existingApplicant
      ? null
      : {
          kind: "team",
          joinMode: "team",
          teamId: invitedTeam.id,
          playerId: state.currentUserId,
          side,
          status: "ready",
          reserve: reserve && !nextPlayerIds.length,
          position: null,
          playerIds: reserve && !nextPlayerIds.length ? [state.currentUserId] : nextPlayerIds,
          createdAt: now,
          updatedAt: now,
        };
    const nextApplicants = isHostParty
      ? applicants
        : existingApplicant
          ? applicants
          .map((applicant) => (
            getRecruitingApplicantKey(applicant) === teamKey
              ? {
                  ...applicant,
                  side: applicant.side ?? side,
                  reserve: reserve ? applicant.reserve : false,
                  status: "ready",
                  playerIds: reserve ? currentPlayerIds : nextPlayerIds,
                  updatedAt: now,
                }
              : applicant
          ))
        : [
            ...applicants,
            nextApplicant,
          ];
    const nextPost = isHostParty
      ? {
          ...post,
          hostReady: true,
          playerIds: reserve ? currentPlayerIds : nextPlayerIds,
          roomState: nextRoomState,
          applicants: nextApplicants,
        }
      : { ...post, applicants: nextApplicants, roomState: nextRoomState };
    if (reserve && isRecruitingReserveLimitExceeded(nextPost, state, side)) {
      return expireInvitation(`${SIDE_LABEL_TEXT[side]} 후보가 이미 ${MAX_RECRUITING_RESERVES_PER_SIDE}명입니다.`);
    }
    if (!reserve) {
      const nextLobby = getRecruitingLobby(nextPost, state);
      if (nextLobby.sides[side].filled > nextLobby.sides[side].capacity) {
        return expireInvitation("방이 꽉 찼습니다. 먼저 수락한 선수만 들어갑니다.");
      }
    }

    return applyAutomaticRecruitingConfirmations({
      ...state,
      recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
        item.id === postId ? cleanRecruitingRoomStatRecorders(nextPost, state) : item
      )),
      notifications: [
        {
          id: makeId("n"),
          title: "초대 수락",
          body: `${post.title} ${SIDE_LABEL_TEXT[side]} ${reserve ? "후보" : "출전"}으로 팀 파티 등록됐습니다.`,
          tone: "match",
        },
        ...state.notifications,
      ],
    });
  }

  const nextApplicant = {
    kind: "player",
    joinMode: "player",
    playerId: state.currentUserId,
    teamId: null,
    side,
    status: "ready",
    reserve,
    position: user?.position ?? null,
    createdAt: now,
    updatedAt: now,
  };
  if (hasRecruitingApplicant(post, nextApplicant)) return state;

  return applyAutomaticRecruitingConfirmations({
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
      item.id === postId
        ? {
            ...item,
            applicants: [...normalizeRecruitingApplicants(item.applicants ?? []), nextApplicant],
            roomState: {
              ...updatePinnedReservePlayers(roomState, side, state.currentUserId, reserve),
              invitations: roomState.invitations.filter((candidate) => candidate.id !== invitationId),
            },
          }
        : item
    )),
    notifications: [
      {
        id: makeId("n"),
        title: "초대 수락",
        body: `${post.title} ${SIDE_LABEL_TEXT[side]} ${reserve ? "후보" : "출전"}으로 대기 등록됐습니다.`,
        tone: "match",
      },
      ...state.notifications,
    ],
  });
}

export function declineRecruitingInvitation(state, postId, invitationId) {
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!post || post.status !== "open") return state;
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const invitation = roomState.invitations.find((item) => item.id === invitationId && item.targetUserId === state.currentUserId);
  if (!invitation) return state;

  return {
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
      item.id === postId
        ? { ...item, roomState: { ...roomState, invitations: roomState.invitations.filter((candidate) => candidate.id !== invitationId) } }
        : item
    )),
  };
}

function buildRecruitingTeamAbsorbPost(post, state, applicants, roomState, playerId, sourceTeamId, sourceEntryId = null, placement = {}, updatedAt) {
  if (!sourceTeamId || !playerId) return null;
  const side = ["teamA", "teamB"].includes(placement.side) ? placement.side : null;
  if (!side) return null;
  const reserve = Boolean(placement.reserve);
  const team = state.teams.find((item) => item.id === sourceTeamId && item.members.some((member) => member.userId === playerId));
  if (!team) return null;

  const capacity = getRecruitingSideCapacity(post);
  const teamKey = `team:${sourceTeamId}`;
  const hostPlayerInTeam = team.members.some((member) => member.userId === post.playerId);
  const isHostParty = post.teamId === sourceTeamId && post.hostJoinMode !== "player" && (post.hostSide ?? "teamA") === side;
  const canPromoteHostPlayerParty = post.hostJoinMode === "player" && hostPlayerInTeam && (post.hostSide ?? "teamA") === side;
  const targetApplicant = applicants.find((applicant) => getRecruitingApplicantKey(applicant) === teamKey && applicant.side === side);
  const canUseHostParty = sourceEntryId ? sourceEntryId === "host" && (isHostParty || canPromoteHostPlayerParty) : (isHostParty || canPromoteHostPlayerParty);
  const canUseTeamParty = Boolean(targetApplicant) && (!sourceEntryId || sourceEntryId === teamKey || targetApplicant.teamId === sourceTeamId);
  if (!canUseHostParty && !canUseTeamParty) return null;

  const currentPlayerIds = canUseHostParty
    ? canPromoteHostPlayerParty
      ? [post.playerId].filter(Boolean)
      : getSelectedTeamPlayerIds(team, capacity, post.playerIds)
    : getSelectedTeamPlayerIds(team, capacity, targetApplicant.playerIds);
  const nextPlayerIds = reserve
    ? currentPlayerIds.filter((id) => id !== playerId)
    : Array.from(new Set([...currentPlayerIds, playerId])).slice(0, capacity);
  if (!reserve && !nextPlayerIds.includes(playerId)) return null;

  const reserveKey = canUseHostParty ? "host" : teamKey;
  const currentReserveIds = roomState.partyReserves?.[reserveKey] ?? [];
  const nextReserveIds = reserve
    ? Array.from(new Set([...currentReserveIds, playerId]))
    : currentReserveIds.filter((id) => id !== playerId);
  const nextPartyReserves = { ...roomState.partyReserves, [reserveKey]: nextReserveIds };
  if (!nextReserveIds.length) delete nextPartyReserves[reserveKey];
  const nextRoomState = updatePinnedReservePlayers(
    { ...roomState, partyReserves: nextPartyReserves },
    side,
    playerId,
    reserve,
  );
  const nextApplicants = applicants
    .filter((applicant) => getRecruitingApplicantKey(applicant) !== `player:${playerId}`)
    .map((applicant) => (
      !canUseHostParty && getRecruitingApplicantKey(applicant) === teamKey
        ? {
            ...applicant,
            reserve: reserve ? applicant.reserve : false,
            status: "waiting",
            playerIds: reserve ? currentPlayerIds : nextPlayerIds,
            updatedAt,
          }
        : applicant
    ));

  return canUseHostParty
    ? {
        ...post,
        teamId: sourceTeamId,
        hostJoinMode: "team",
        hostReady: false,
        playerIds: reserve ? currentPlayerIds : nextPlayerIds,
        roomState: nextRoomState,
        applicants: nextApplicants,
      }
    : { ...post, roomState: nextRoomState, applicants: nextApplicants };
}

function isRecruitingTeamPartyEntry(entry) {
  return entry?.kind === "team";
}

function isMutableRecruitingRoom(post) {
  return Boolean(post && post.status !== "closed");
}

function isRecruitingEntryMember(entry, playerId) {
  if (!entry || !playerId) return false;
  return (entry.players ?? []).includes(playerId) || (entry.reserves ?? []).includes(playerId);
}

function getRecruitingEntryPlayerIds(entry, targetApplicant, post, capacity) {
  const storedPlayerIds = uniquePlayerIds(entry.fixed ? post.playerIds : targetApplicant?.playerIds);
  return (storedPlayerIds.length ? storedPlayerIds : uniquePlayerIds(entry.players ?? [])).slice(0, capacity);
}

export function setRecruitingApplicantPlacement(state, postId, playerId, placement = {}) {
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!isMutableRecruitingRoom(post) || !playerId) return state;
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const applicants = normalizeRecruitingApplicants(post.applicants ?? []);
  const targetApplicant = applicants.find((applicant) => getRecruitingApplicantKey(applicant) === `player:${playerId}`);
  const hostTarget = playerId === post.playerId && !targetApplicant;
  const target = targetApplicant ?? (hostTarget
    ? { side: post.hostSide ?? "teamA", reserve: roomState.hostReserve }
    : null);
  if (!target) return state;
  const requesterControlsTarget = hostTarget
    ? post.playerId === state.currentUserId
    : target.playerId === state.currentUserId || (target.playerIds ?? []).includes(state.currentUserId);
  if (!requesterControlsTarget) return state;

  const side = ["teamA", "teamB"].includes(placement.side) ? placement.side : target.side;
  const reserve = Boolean(placement.reserve);
  const updatedAt = new Date().toISOString();
  const nextApplicants = hostTarget
    ? applicants
    : applicants.map((applicant) => (
      getRecruitingApplicantKey(applicant) === getRecruitingApplicantKey(targetApplicant)
        ? { ...applicant, side, reserve, status: "waiting", updatedAt }
        : applicant
    ));
  const nextRoomState = updatePinnedReservePlayers(roomState, side, playerId, reserve);
  const nextPost = hostTarget
    ? {
      ...post,
      hostSide: side,
      hostReady: false,
      roomState: { ...nextRoomState, hostReserve: reserve },
      applicants: nextApplicants,
    }
    : { ...post, roomState: nextRoomState, applicants: nextApplicants };

  if (reserve && isRecruitingReserveLimitExceeded(nextPost, state, side)) {
    return {
      ...state,
      notifications: [getRecruitingReserveLimitNotification(postId, side), ...state.notifications],
    };
  }

  if (!reserve) {
    const lobby = getRecruitingLobby(nextPost, state);
    const activePlayerCount = new Set(lobby.sides[side].entries.flatMap((entry) => entry.players)).size;
    if (activePlayerCount > lobby.sides[side].capacity) return state;
  }

  return {
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
      item.id === postId ? cleanRecruitingRoomStatRecorders(nextPost, state) : item
    )),
  };
}

export function setRecruitingApplicantReserve(state, postId, playerId, reserve = true) {
  return setRecruitingApplicantPlacement(state, postId, playerId, { reserve });
}

export function setRecruitingSlotPosition(state, postId, playerId, position = "") {
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!isMutableRecruitingRoom(post) || !playerId || playerId !== state.currentUserId) return state;

  const lobby = getRecruitingLobby(post, state);
  const isRoomMember = (lobby.entries ?? []).some((entry) => isRecruitingEntryMember(entry, playerId));
  if (!isRoomMember) return state;

  const normalizedPosition = PLAYER_POSITIONS.includes(position) ? position : "";
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const nextSlotPositions = { ...(roomState.slotPositions ?? {}) };
  if (normalizedPosition) nextSlotPositions[playerId] = normalizedPosition;
  else delete nextSlotPositions[playerId];

  const nextRoomState = { ...roomState, slotPositions: nextSlotPositions };
  return {
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
      item.id === postId ? { ...item, roomState: nextRoomState } : item
    )),
  };
}

export function joinRecruitingSideParty(state, postId, teamId, sideName = "", entryId = "") {
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!isMutableRecruitingRoom(post) || !teamId) return state;

  const team = state.teams.find((item) => item.id === teamId && item.members.some((member) => member.userId === state.currentUserId));
  if (!team) return state;

  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const applicants = normalizeRecruitingApplicants(post.applicants ?? []);
  const currentApplicant = applicants.find((applicant) => (
    applicant.kind === "player" &&
    applicant.playerId === state.currentUserId &&
    team.members.some((member) => member.userId === applicant.playerId)
  ));
  const lobby = getRecruitingLobby(post, state);
  const teamMemberIds = new Set((team.members ?? []).map((member) => member.userId));
  const requestedSide = ["teamA", "teamB"].includes(sideName) ? sideName : "";
  const joinableSide = requestedSide || ["teamA", "teamB"].find((candidateSide) => (
    (lobby.sides[candidateSide]?.entries ?? []).some((entry) => (
      entry.team?.id === teamId ||
      (entry.kind === "player" && teamMemberIds.has(entry.playerId))
    ))
  ));
  if (!currentApplicant && !joinableSide) return state;

  const side = joinableSide || currentApplicant.side;
  const sideEntries = lobby.sides[side]?.entries ?? [];
  const targetEntry = entryId ? sideEntries.find((entry) => entry.id === entryId) : null;
  const targetEntryIsSameTeamPlayer = Boolean(
    targetEntry?.kind === "player" &&
    targetEntry.playerId &&
    teamMemberIds.has(targetEntry.playerId),
  );
  const partyEntries = sideEntries.filter((entry) => (
    entry.team?.id === teamId &&
    isRecruitingTeamPartyEntry(entry)
  ));
  const partyEntry = partyEntries.find((entry) => entry.id === entryId) ?? partyEntries[0] ?? null;
  const updatedAt = new Date().toISOString();
  const capacity = getRecruitingSideCapacity(post);
  const sideProjectedFilled = lobby.sides[side]?.projectedFilled ?? 0;
  const currentUserReserve = currentApplicant
    ? Boolean(currentApplicant.reserve && sideProjectedFilled >= capacity)
    : sideProjectedFilled >= capacity;

  if (partyEntry) {
    if ((partyEntry.reserves ?? []).includes(state.currentUserId)) {
      return setRecruitingPartyPlayerReserve(state, postId, partyEntry.id, state.currentUserId, false);
    }
    const absorbedPost = buildRecruitingTeamAbsorbPost(
      post,
      state,
      applicants,
      roomState,
      state.currentUserId,
      teamId,
      partyEntry.id,
      { side, reserve: currentUserReserve },
      updatedAt,
    );
    if (!absorbedPost) return state;
    const nextLobby = getRecruitingLobby(absorbedPost, state);
    if (nextLobby.sides[side].projectedFilled > nextLobby.sides[side].capacity) return state;
    if (isRecruitingReserveLimitExceeded(absorbedPost, state, side)) {
      return {
        ...state,
        notifications: [getRecruitingReserveLimitNotification(postId, side), ...state.notifications],
      };
    }
    return {
      ...state,
      recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
        item.id === postId ? cleanRecruitingRoomStatRecorders(absorbedPost, state) : item
      )),
    };
  }

  if (targetEntry?.fixed && targetEntryIsSameTeamPlayer) {
    const absorbedPost = buildRecruitingTeamAbsorbPost(
      post,
      state,
      applicants,
      roomState,
      state.currentUserId,
      teamId,
      targetEntry.id,
      { side, reserve: currentUserReserve },
      updatedAt,
    );
    if (!absorbedPost) return state;
    const nextLobby = getRecruitingLobby(absorbedPost, state);
    if (nextLobby.sides[side].projectedFilled > nextLobby.sides[side].capacity) return state;
    if (isRecruitingReserveLimitExceeded(absorbedPost, state, side)) {
      return {
        ...state,
        notifications: [getRecruitingReserveLimitNotification(postId, side), ...state.notifications],
      };
    }
    return {
      ...state,
      recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
        item.id === postId ? cleanRecruitingRoomStatRecorders(absorbedPost, state) : item
      )),
    };
  }

  const currentUser = state.users.find((user) => user.id === state.currentUserId);
  const mergeApplicants = currentApplicant
    ? applicants
    : [
        ...applicants,
        {
          kind: "player",
          joinMode: "player",
          playerId: state.currentUserId,
          teamId: null,
          side,
          status: "ready",
          reserve: currentUserReserve,
          position: currentUser?.position ?? null,
          createdAt: updatedAt,
          updatedAt,
        },
      ];
  const sameTeamApplicants = mergeApplicants.filter((applicant) => (
    applicant.kind === "player" &&
    applicant.side === side &&
    team.members.some((member) => member.userId === applicant.playerId)
  ));
  if (sameTeamApplicants.length < 2) return state;

  const activePlayerIds = sameTeamApplicants
    .filter((applicant) => !applicant.reserve)
    .map((applicant) => applicant.playerId)
    .slice(0, capacity);
  if (!activePlayerIds.length) return state;

  const reservePlayerIds = sameTeamApplicants
    .filter((applicant) => applicant.reserve || !activePlayerIds.includes(applicant.playerId))
    .map((applicant) => applicant.playerId);
  const teamKey = `team:${teamId}`;
  const nextPartyReserves = { ...roomState.partyReserves, [teamKey]: Array.from(new Set(reservePlayerIds)) };
  if (!nextPartyReserves[teamKey].length) delete nextPartyReserves[teamKey];
  const sameTeamPlayerSet = new Set(sameTeamApplicants.map((applicant) => applicant.playerId));
  const nextRoomState = updateManyPinnedReservePlayers(
    updateManyPinnedReservePlayers({ ...roomState, partyReserves: nextPartyReserves }, side, activePlayerIds, false),
    side,
    reservePlayerIds,
    true,
  );
  const nextApplicant = {
    kind: "team",
    joinMode: "team",
    teamId,
    playerId: activePlayerIds[0],
    side,
    status: sameTeamApplicants.every((applicant) => applicant.status === "ready") ? "ready" : "waiting",
    reserve: false,
    position: null,
    playerIds: activePlayerIds,
    createdAt: updatedAt,
    updatedAt,
  };
  const nextPost = {
    ...post,
    applicants: [
      ...mergeApplicants.filter((applicant) => !sameTeamPlayerSet.has(applicant.playerId)),
      nextApplicant,
    ],
    roomState: nextRoomState,
  };
  const nextLobby = getRecruitingLobby(nextPost, state);
  if (nextLobby.sides[side].projectedFilled > nextLobby.sides[side].capacity) return state;
  if (isRecruitingReserveLimitExceeded(nextPost, state, side)) {
    return {
      ...state,
      notifications: [getRecruitingReserveLimitNotification(postId, side), ...state.notifications],
    };
  }

  return {
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
      item.id === postId ? cleanRecruitingRoomStatRecorders(nextPost, state) : item
    )),
  };
}

export function setRecruitingPartyPlayerReserve(state, postId, entryId, playerId, reserve = true) {
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!isMutableRecruitingRoom(post) || !entryId || !playerId) return state;
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});

  const lobby = getRecruitingLobby(post, state);
  const entry = (lobby.entries ?? []).find((item) => item.id === entryId);
  if (!isRecruitingTeamPartyEntry(entry) || !entry?.team || !isRecruitingEntryMember(entry, playerId)) return state;
  const partyLeaderId = roomState.partyLeaders?.[entryId] ?? (entry.fixed ? post.playerId : entry.playerId) ?? "";
  if (partyLeaderId !== state.currentUserId && playerId !== state.currentUserId) return state;

  const capacity = getRecruitingSideCapacity(post);
  const applicants = normalizeRecruitingApplicants(post.applicants ?? []);
  const targetApplicant = entry.fixed
    ? null
    : applicants.find((applicant) => getRecruitingApplicantKey(applicant) === entry.id);
  if (!entry.fixed && !targetApplicant) return state;

  const currentPlayerIds = getRecruitingEntryPlayerIds(entry, targetApplicant, post, capacity);
  const currentReserveIds = uniquePlayerIds(roomState.partyReserves?.[entry.id] ?? []);
  if (!reserve && currentPlayerIds.includes(playerId)) return state;
  if (reserve && currentReserveIds.includes(playerId) && !currentPlayerIds.includes(playerId)) return state;
  const swapInPlayerId = reserve && currentReserveIds.length >= MAX_RECRUITING_RESERVES_PER_SIDE
    ? currentReserveIds.find((id) => id !== playerId)
    : "";
  const swapOutPlayerId = !reserve && currentPlayerIds.length >= capacity
    ? [...currentPlayerIds].reverse().find((id) => id !== playerId)
    : "";
  const nextPlayerIds = reserve
    ? uniquePlayerIds([...currentPlayerIds.filter((id) => id !== playerId), swapInPlayerId].filter(Boolean))
    : uniquePlayerIds([...currentPlayerIds.filter((id) => id !== swapOutPlayerId), playerId]);
  const partyBecomesReserve = reserve && !entry.fixed && currentPlayerIds.length === 1 && currentPlayerIds[0] === playerId && !swapInPlayerId;
  const fixedPartyBecomesReserve = reserve && entry.fixed && currentPlayerIds.length === 1 && currentPlayerIds[0] === playerId && !swapInPlayerId;
  if ((!partyBecomesReserve && !fixedPartyBecomesReserve && !nextPlayerIds.length) || nextPlayerIds.length > capacity) return state;

  const updatedAt = new Date().toISOString();
  const baseReserveIds = currentReserveIds.filter((id) => id !== playerId && id !== swapInPlayerId);
  const nextReserveIds = partyBecomesReserve
    ? currentReserveIds.filter((id) => id !== playerId)
    : reserve
      ? uniquePlayerIds([...baseReserveIds, playerId])
      : uniquePlayerIds([...baseReserveIds, swapOutPlayerId].filter(Boolean));
  if (nextReserveIds.length > MAX_RECRUITING_RESERVES_PER_SIDE) return state;
  const nextPartyReserves = { ...roomState.partyReserves, [entry.id]: nextReserveIds };
  if (!nextReserveIds.length) delete nextPartyReserves[entry.id];
  const nextRoomState = updatePinnedReservePlayers(
    { ...roomState, partyReserves: nextPartyReserves },
    entry.side,
    playerId,
    reserve,
  );
  const nextPost = entry.fixed
    ? { ...post, hostReady: false, playerIds: nextPlayerIds, roomState: nextRoomState }
    : {
      ...post,
      roomState: nextRoomState,
      applicants: applicants.map((applicant) => (
        getRecruitingApplicantKey(applicant) === entry.id
          ? {
              ...applicant,
              reserve: partyBecomesReserve ? true : false,
              playerIds: partyBecomesReserve ? currentPlayerIds : nextPlayerIds,
              status: "waiting",
              updatedAt,
            }
          : applicant
      )),
    };

  if (reserve && isRecruitingReserveLimitExceeded(nextPost, state, entry.side)) {
    return {
      ...state,
      notifications: [getRecruitingReserveLimitNotification(postId, entry.side), ...state.notifications],
    };
  }

  if (!reserve) {
    const nextLobby = getRecruitingLobby(nextPost, state);
    const activePlayerCount = new Set(nextLobby.sides[entry.side].entries.flatMap((item) => item.players)).size;
    if (activePlayerCount > nextLobby.sides[entry.side].capacity) return state;
  }

  return {
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
      item.id === postId ? cleanRecruitingRoomStatRecorders(nextPost, state) : item
    )),
  };
}

export function setRecruitingPartyPlayerPlacement(state, postId, entryId, playerId, placement = {}) {
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!isMutableRecruitingRoom(post) || !entryId || !playerId) return state;
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});

  const lobby = getRecruitingLobby(post, state);
  const entry = (lobby.entries ?? []).find((item) => item.id === entryId);
  if (!isRecruitingTeamPartyEntry(entry) || !entry?.team || !isRecruitingEntryMember(entry, playerId)) return state;
  const partyLeaderId = roomState.partyLeaders?.[entryId] ?? (entry.fixed ? post.playerId : entry.playerId) ?? "";
  if (partyLeaderId !== state.currentUserId && playerId !== state.currentUserId) return state;

  const side = ["teamA", "teamB"].includes(placement.side) ? placement.side : entry.side;
  const reserve = Boolean(placement.reserve);
  const applicants = normalizeRecruitingApplicants(post.applicants ?? []);
  const targetApplicant = entry.fixed
    ? null
    : applicants.find((applicant) => getRecruitingApplicantKey(applicant) === entry.id);
  if (!entry.fixed && !targetApplicant) return state;

  if (side !== entry.side) return state;
  return setRecruitingPartyPlayerReserve(state, postId, entryId, playerId, reserve);
}

export function detachRecruitingPartyPlayer(state, postId, entryId, playerId, placement = {}) {
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!isMutableRecruitingRoom(post) || !entryId || !playerId) return state;
  if (post.playerId !== state.currentUserId && playerId !== state.currentUserId) return state;

  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const lobby = getRecruitingLobby(post, state);
  const entry = (lobby.entries ?? []).find((item) => item.id === entryId);
  if (!isRecruitingTeamPartyEntry(entry) || !entry?.team) return state;
  if (!isRecruitingEntryMember(entry, playerId)) return state;

  const capacity = getRecruitingSideCapacity(post);
  const applicants = normalizeRecruitingApplicants(post.applicants ?? []);
  const targetApplicant = entry.fixed
    ? null
    : applicants.find((applicant) => getRecruitingApplicantKey(applicant) === entry.id);
  if (!entry.fixed && !targetApplicant) return state;

  const currentPlayerIds = getRecruitingEntryPlayerIds(entry, targetApplicant, post, capacity);
  const reserveKey = entry.id;
  const currentReserveIds = roomState.partyReserves?.[reserveKey] ?? [];
  const wasActive = !entry.reserve && currentPlayerIds.includes(playerId);
  const wasReserve = Boolean(entry.reserve) || currentReserveIds.includes(playerId);
  if (!wasActive && !wasReserve) return state;
  const targetSide = ["teamA", "teamB"].includes(placement.side) ? placement.side : entry.side;
  const targetReserve = placement.reserve === undefined ? (!wasActive && wasReserve) : Boolean(placement.reserve);

  const nextPlayerIds = currentPlayerIds.filter((id) => id !== playerId);

  const nextReserveIds = currentReserveIds.filter((id) => id !== playerId);
  const nextPartyReserves = { ...roomState.partyReserves, [reserveKey]: nextReserveIds };
  if (!nextReserveIds.length) delete nextPartyReserves[reserveKey];
  const nextRoomState = updatePinnedReservePlayers(
    { ...roomState, partyReserves: nextPartyReserves },
    targetSide,
    playerId,
    targetReserve,
  );
  const updatedAt = new Date().toISOString();
  const movedUser = state.users.find((user) => user.id === playerId);
  const movedApplicant = {
    kind: "player",
    joinMode: "player",
    playerId,
    teamId: null,
    sourceTeamId: entry.team?.id ?? entry.teamId ?? null,
    sourceEntryId: entry.id,
    side: targetSide,
    status: "waiting",
    reserve: targetReserve,
    position: movedUser?.position ?? null,
    createdAt: updatedAt,
    updatedAt,
  };
  let nextApplicants = applicants
    .filter((applicant) => getRecruitingApplicantKey(applicant) !== `player:${playerId}`)
    .map((applicant) => {
      if (getRecruitingApplicantKey(applicant) === entry.id || applicant.kind !== "team") return applicant;
      const remainingPlayerIds = uniquePlayerIds(applicant.playerIds ?? []).filter((id) => id !== playerId);
      if (!remainingPlayerIds.length) return null;
      if (remainingPlayerIds.length === (applicant.playerIds ?? []).length) return applicant;
      return {
        ...applicant,
        playerId: remainingPlayerIds.includes(applicant.playerId) ? applicant.playerId : remainingPlayerIds[0],
        playerIds: remainingPlayerIds,
        status: "waiting",
        updatedAt,
      };
    })
    .filter(Boolean);
  if (!entry.fixed) {
    nextApplicants = nextApplicants
      .map((applicant) => {
        if (getRecruitingApplicantKey(applicant) !== entry.id) return applicant;
        return nextPlayerIds.length
          ? { ...applicant, playerId: nextPlayerIds[0] ?? applicant.playerId, playerIds: nextPlayerIds, status: "waiting", updatedAt }
          : null;
      })
      .filter(Boolean);
  }
  nextApplicants = [...nextApplicants, movedApplicant];

  const nextPost = entry.fixed
    ? { ...post, hostReady: false, playerIds: nextPlayerIds, roomState: nextRoomState, applicants: nextApplicants }
    : { ...post, roomState: nextRoomState, applicants: nextApplicants };

  if (targetReserve && isRecruitingReserveLimitExceeded(nextPost, state, targetSide)) {
    return {
      ...state,
      notifications: [getRecruitingReserveLimitNotification(postId, targetSide), ...state.notifications],
    };
  }
  if (!targetReserve) {
    const nextLobby = getRecruitingLobby(nextPost, state);
    const activePlayerCount = new Set(nextLobby.sides[targetSide].entries.flatMap((item) => item.players)).size;
    if (activePlayerCount > nextLobby.sides[targetSide].capacity) return state;
  }

  return {
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
      item.id === postId ? cleanRecruitingRoomStatRecorders(nextPost, state) : item
    )),
    notifications: [
      {
        id: makeId("n"),
        title: "파티에서 나감",
        body: `${entry.team.name} 파티에서 빠져 개인 참여로 전환되었습니다.`,
        tone: "team",
      },
      ...(state.notifications ?? []),
    ],
  };
}

export function removeRecruitingPartyPlayer(state, postId, entryId, playerId) {
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!post || post.status !== "open" || !isRecruitingRoomOwner(post, state.currentUserId) || !entryId || !playerId) return state;

  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const lobby = getRecruitingLobby(post, state);
  const entry = (lobby.entries ?? []).find((item) => item.id === entryId);
  if (!isRecruitingTeamPartyEntry(entry) || !entry?.team || !isRecruitingEntryMember(entry, playerId)) return state;
  if (entry.fixed && playerId === post.playerId) return state;

  const capacity = getRecruitingSideCapacity(post);
  const applicants = normalizeRecruitingApplicants(post.applicants ?? []);
  const targetApplicant = entry.fixed
    ? null
    : applicants.find((applicant) => getRecruitingApplicantKey(applicant) === entry.id);
  if (!entry.fixed && !targetApplicant) return state;

  const currentPlayerIds = getRecruitingEntryPlayerIds(entry, targetApplicant, post, capacity);
  const nextPlayerIds = currentPlayerIds.filter((id) => id !== playerId);
  const reserveKey = entry.id;
  const nextReserveIds = (roomState.partyReserves?.[reserveKey] ?? []).filter((id) => id !== playerId);
  const nextPartyReserves = { ...roomState.partyReserves, [reserveKey]: nextReserveIds };
  if (!nextReserveIds.length) delete nextPartyReserves[reserveKey];
  if (entry.fixed && !nextPlayerIds.length) return state;
  const nextRoomState = updatePinnedReservePlayers(
    { ...roomState, partyReserves: nextPartyReserves },
    entry.side,
    playerId,
    false,
  );

  const updatedAt = new Date().toISOString();
  let nextApplicants = applicants.filter((applicant) => getRecruitingApplicantKey(applicant) !== `player:${playerId}`);
  if (!entry.fixed) {
    nextApplicants = nextApplicants
      .map((applicant) => {
        if (getRecruitingApplicantKey(applicant) !== entry.id) return applicant;
        return nextPlayerIds.length
          ? { ...applicant, playerId: nextPlayerIds[0] ?? applicant.playerId, playerIds: nextPlayerIds, status: "waiting", updatedAt }
          : null;
      })
      .filter(Boolean);
  }

  const hostKickCount = roomState.kickLog.filter((item) => item.by === state.currentUserId).length + 1;
  const hostPenalty = hostKickCount >= 3 ? 1 : 0;
  const kickLog = [
    ...roomState.kickLog,
    { id: makeId("kick"), targetUserId: playerId, by: state.currentUserId, penalty: hostPenalty, createdAt: updatedAt },
  ];
  const nextPost = entry.fixed
    ? {
        ...post,
        hostReady: false,
        playerIds: nextPlayerIds,
        roomState: { ...nextRoomState, kickLog },
        applicants: nextApplicants,
      }
    : {
        ...post,
        roomState: { ...nextRoomState, kickLog },
        applicants: nextApplicants,
      };

  return {
    ...state,
    users: adjustUserTrust(state.users, state.currentUserId, -hostPenalty),
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
      item.id === postId ? cleanRecruitingRoomStatRecorders(nextPost, state) : item
    )),
    notifications: [
      {
        id: makeId("n"),
        title: hostPenalty ? "강퇴 남발 패널티" : "참가자 강퇴",
        body: hostPenalty
          ? "한 방에서 강퇴가 3회 이상 발생해 방장 신뢰도가 감소했습니다."
          : "선택한 팀원을 방에서 내보냈습니다.",
        tone: hostPenalty ? "orange" : "team",
      },
      ...state.notifications,
    ],
  };
}

export function setRecruitingStatRecorder(state, postId, sideName, playerId = "") {
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!post || post.status !== "open" || !isRecruitingRoomOwner(post, state.currentUserId) || post.refereeId) return state;
  if (!["teamA", "teamB"].includes(sideName)) return state;

  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const currentRecorders = normalizeStatRecorders(roomState.statRecorders);
  const nextPlayerId = playerId && currentRecorders[sideName] !== playerId
    ? getValidRecruitingRecorder(post, state, sideName, playerId)
    : "";
  if (playerId && !nextPlayerId) return state;

  const nextRecorders = normalizeStatRecorders({
    ...currentRecorders,
    [sideName]: nextPlayerId,
  });
  const otherSideName = sideName === "teamA" ? "teamB" : "teamA";
  if (nextPlayerId && nextRecorders[otherSideName] === nextPlayerId) {
    nextRecorders[otherSideName] = "";
  }

  return {
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
      item.id === postId
        ? { ...item, roomState: { ...roomState, statRecorders: nextRecorders } }
        : item
    )),
  };
}

export function kickRecruitingApplicant(state, postId, playerId) {
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!post || post.status !== "open" || !isRecruitingRoomOwner(post, state.currentUserId) || playerId === state.currentUserId) return state;
  const applicants = normalizeRecruitingApplicants(post.applicants ?? []);
  const target = applicants.find((applicant) => applicant.playerId === playerId);
  if (!target) return state;
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const targetSide = target.side ?? "teamB";
  const nextRoomState = updatePinnedReservePlayers(roomState, targetSide, playerId, false);
  const hostKickCount = roomState.kickLog.filter((item) => item.by === state.currentUserId).length + 1;
  const hostPenalty = hostKickCount >= 3 ? 1 : 0;
  const now = new Date().toISOString();
  const kickLog = [
    ...roomState.kickLog,
    { id: makeId("kick"), targetUserId: playerId, by: state.currentUserId, penalty: hostPenalty, createdAt: now },
  ];

  return {
    ...state,
    users: adjustUserTrust(state.users, state.currentUserId, -hostPenalty),
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
      item.id === postId
        ? cleanRecruitingRoomStatRecorders({
            ...item,
            roomState: { ...nextRoomState, kickLog },
            applicants: applicants.filter((applicant) => applicant.playerId !== playerId),
          }, state)
        : item
    )),
    notifications: [
      {
        id: makeId("n"),
        title: hostPenalty ? "강퇴 남발 패널티" : "참가자 강퇴",
        body: hostPenalty
          ? "한 방에서 강퇴가 3회 이상 발생해 방장 신뢰도가 감소했습니다."
          : "참가자를 방에서 내보냈습니다.",
        tone: hostPenalty ? "orange" : "team",
      },
      ...state.notifications,
    ],
  };
}

function promoteRecruitingReservesForConfirmation(post, state, lobby) {
  const fillSlots = ["teamA", "teamB"].flatMap((sideName) => (
    [...(lobby.sides[sideName]?.fillSlots ?? []), ...(lobby.sides[sideName]?.reserveCandidates ?? [])]
      .filter((candidate, index, candidates) => (
        candidate.status === "ready" &&
        candidates.findIndex((item) => item.playerId === candidate.playerId) === index
      ))
      .slice(0, Math.max(0, (lobby.sides[sideName]?.capacity ?? 0) - (lobby.sides[sideName]?.filled ?? 0)))
      .map((candidate) => ({ ...candidate, side: sideName }))
  ));
  const promotedIdsBySide = {
    teamA: fillSlots.filter((candidate) => candidate.side === "teamA").map((candidate) => candidate.playerId),
    teamB: fillSlots.filter((candidate) => candidate.side === "teamB").map((candidate) => candidate.playerId),
  };
  if (!fillSlots.length) return { post, promotedIdsBySide };

  const capacity = getRecruitingSideCapacity(post);
  const updatedAt = new Date().toISOString();
  const byEntry = fillSlots.reduce((acc, candidate) => {
    if (!candidate.entryId || !candidate.playerId) return acc;
    const current = acc.get(candidate.entryId) ?? { side: candidate.side, playerIds: [] };
    current.playerIds = uniquePlayerIds([...current.playerIds, candidate.playerId]);
    acc.set(candidate.entryId, current);
    return acc;
  }, new Map());

  let nextPost = { ...post };
  let nextRoomState = normalizeRecruitingRoomState(post.roomState ?? {});
  let nextApplicants = normalizeRecruitingApplicants(post.applicants ?? []);
  const nextPartyReserves = { ...(nextRoomState.partyReserves ?? {}) };
  const promotedPlayerIds = [];

  byEntry.forEach(({ playerIds }, entryId) => {
    const entry = (lobby.entries ?? []).find((item) => item.id === entryId);
    if (!entry) return;
    const promotedIds = uniquePlayerIds(playerIds).filter((playerId) => (
      (entry.players ?? []).includes(playerId) || (entry.reserves ?? []).includes(playerId)
    ));
    if (!promotedIds.length) return;
    promotedPlayerIds.push(...promotedIds);

    const reserveKey = entry.fixed ? "host" : entry.id;
    const existingReserveIds = uniquePlayerIds(nextPartyReserves[reserveKey] ?? []);
    const entryWasReserve = Boolean(entry.reserve);
    const remainingReserveIds = entryWasReserve
      ? uniquePlayerIds(entry.players ?? []).filter((playerId) => !promotedIds.includes(playerId))
      : uniquePlayerIds([...(entry.reserves ?? []), ...existingReserveIds]).filter((playerId) => !promotedIds.includes(playerId));

    if (entry.fixed) {
      if (entry.kind === "team") {
        const activeIds = entryWasReserve
          ? promotedIds.slice(0, capacity)
          : uniquePlayerIds([...(nextPost.playerIds ?? []), ...promotedIds]).slice(0, capacity);
        nextPost = {
          ...nextPost,
          playerIds: activeIds,
          hostReady: true,
        };
        const reserveIds = uniquePlayerIds([...existingReserveIds, ...remainingReserveIds]).filter((playerId) => !activeIds.includes(playerId));
        if (reserveIds.length) nextPartyReserves[reserveKey] = reserveIds;
        else delete nextPartyReserves[reserveKey];
      } else {
        nextPost = { ...nextPost, hostReady: true };
      }
      if (entryWasReserve) nextRoomState = { ...nextRoomState, hostReserve: false };
      return;
    }

    nextApplicants = nextApplicants.map((applicant) => {
      if (getRecruitingApplicantKey(applicant) !== entry.id) return applicant;
      if (applicant.kind === "team") {
        const activeIds = entryWasReserve
          ? promotedIds.slice(0, capacity)
          : uniquePlayerIds([...(applicant.playerIds ?? []), ...promotedIds]).slice(0, capacity);
        const reserveIds = uniquePlayerIds([...existingReserveIds, ...remainingReserveIds]).filter((playerId) => !activeIds.includes(playerId));
        if (reserveIds.length) nextPartyReserves[reserveKey] = reserveIds;
        else delete nextPartyReserves[reserveKey];
        return {
          ...applicant,
          reserve: false,
          status: "ready",
          playerId: activeIds[0] ?? applicant.playerId,
          playerIds: activeIds,
          updatedAt,
        };
      }
      return {
        ...applicant,
        reserve: false,
        status: "ready",
        updatedAt,
      };
    });
  });

  nextRoomState = updateManyPinnedReservePlayers(
    { ...nextRoomState, partyReserves: nextPartyReserves },
    "teamA",
    promotedPlayerIds,
    false,
  );
  nextRoomState = updateManyPinnedReservePlayers(nextRoomState, "teamB", promotedPlayerIds, false);

  return {
    post: {
      ...nextPost,
      roomState: nextRoomState,
      applicants: nextApplicants,
    },
    promotedIdsBySide,
  };
}

export function confirmRecruitingMatch(state, postId) {
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!post || post.status !== "open" || !isRecruitingRoomOwner(post, state.currentUserId)) return state;
  const promotion = promoteRecruitingReservesForConfirmation(post, state, getRecruitingLobby(post, state));
  const promotedPost = promotion.post;
  const lobby = getRecruitingLobby(promotedPost, state);

  if (!lobby.canConfirm) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "매치 확정 불가",
          body: "양쪽 슬롯이 채워지고 필요한 수락이 끝나야 합니다.",
          tone: "match",
          matchId: null,
        },
        ...state.notifications,
      ],
    };
  }
  const timingStatus = getPublicRoomTimingStatus(promotedPost);
  if (!timingStatus.canConfirm) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "매치 확정 불가",
          body: timingStatus.detail,
          tone: "match",
          matchId: null,
        },
        ...state.notifications,
      ],
    };
  }

  const timingType = promotedPost.timingType === "instant" || promotedPost.roomState?.timingType === "instant" ? "instant" : "scheduled";
  const scheduledAt = timingType === "instant" ? "즉시" : (promotedPost.scheduledDate && promotedPost.scheduledTime ? `${promotedPost.scheduledDate} ${promotedPost.scheduledTime}` : "일정 미정");
  const now = new Date().toISOString();
  const teamAPlayers = lobby.sides.teamA.projectedPlayers.slice(0, lobby.sides.teamA.capacity);
  const teamBPlayers = lobby.sides.teamB.projectedPlayers.slice(0, lobby.sides.teamB.capacity);
  const teamAPlayerTeams = getLobbySidePlayerTeamIds(lobby, "teamA");
  const teamBPlayerTeams = getLobbySidePlayerTeamIds(lobby, "teamB");
  const playerIds = [...teamAPlayers, ...teamBPlayers];
  const teamAReservePlayers = uniquePlayerIds(lobby.sides.teamA.reserveCandidates.map((candidate) => candidate.playerId))
    .filter((playerId) => !teamAPlayers.includes(playerId))
    .slice(0, MAX_RECRUITING_RESERVES_PER_SIDE);
  const teamBReservePlayers = uniquePlayerIds(lobby.sides.teamB.reserveCandidates.map((candidate) => candidate.playerId))
    .filter((playerId) => !teamBPlayers.includes(playerId))
    .slice(0, MAX_RECRUITING_RESERVES_PER_SIDE);
  const confirmedReserveIds = new Set([...teamAReservePlayers, ...teamBReservePlayers]);
  const refereeId = getTrustedRefereeId(state, promotedPost.refereeId, playerIds);
  const statRecorders = refereeId ? normalizeStatRecorders({}) : getRecruitingRoomStatRecorders(promotedPost, state);
  const mmrRangeMode = normalizeRecruitingMmrRangeMode(promotedPost.mmrRangeMode ?? promotedPost.roomState?.mmrRangeMode);
  const ranked = promotedPost.ranked !== false;
  const ratingScale = getRecruitingRatingScale({ ranked, mmrRangeMode });
  const defaultRules = {
    targetScore: 21,
    timeLimit: 12,
    winByTwo: true,
    ball: "7호 공",
    attackRule: "득점 후 공격권 교대",
    foulRule: "파울 콜 즉시 중단, 공격권 유지",
  };
  const match = {
    id: makeId("m"),
    title: promotedPost.title,
    mode: promotedPost.mode,
    court: promotedPost.court,
    scheduledDate: timingType === "instant" ? "" : (promotedPost.scheduledDate ?? ""),
    scheduledTime: timingType === "instant" ? "" : (promotedPost.scheduledTime ?? ""),
    scheduledAt,
    timingType,
    status: "agreed",
    official: ranked && Boolean(promotedPost.official),
    preRegistered: true,
    refereeId,
    refereeTrustMin: REFEREE_TRUST_MIN,
    statRecorders,
    statEntryMinutes: STAT_ENTRY_WINDOW_MINUTES,
    disputeMinutes: DISPUTE_WINDOW_MINUTES,
    rules: {
      ...defaultRules,
      ...(promotedPost.rules ?? {}),
      timingType,
      mmrRangeMode,
      ratingScale,
    },
    memo: promotedPost.memo,
    stakes: "매치 큐에서 확정된 경기입니다.",
    ranked,
    mmrRangeMode,
    ratingScale,
    objectionWindow: "2시간",
    evidence: [],
    teamA: {
      name: getLobbySideName(lobby, "teamA"),
      teamId: getLobbyPrimaryTeamId(lobby, "teamA"),
      playerTeams: teamAPlayerTeams,
      players: teamAPlayers,
      score: 0,
    },
    teamB: {
      name: getLobbySideName(lobby, "teamB"),
      teamId: getLobbyPrimaryTeamId(lobby, "teamB"),
      playerTeams: teamBPlayerTeams,
      players: teamBPlayers,
      score: 0,
    },
    parties: lobby.entries
      .map((entry) => ({
        kind: entry.kind,
        side: entry.side,
        teamId: getLobbyEntryTeamId(entry),
        playerId: entry.playerId,
        players: entry.reserve && entry.status !== "ready" ? [] : entry.players,
        reserves: (entry.reserves ?? []).filter((playerId) => confirmedReserveIds.has(playerId)),
        reserve: entry.reserve,
      }))
      .filter((entry) => entry.players.length || entry.reserves.length),
    reservePlayers: {
      teamA: teamAReservePlayers,
      teamB: teamBReservePlayers,
    },
    promotedReserveIds: {
      teamA: promotion.promotedIdsBySide.teamA,
      teamB: promotion.promotedIdsBySide.teamB,
    },
    agreements: { teamA: teamAPlayers, teamB: teamBPlayers },
    attendance: { teamA: [], teamB: [] },
    approvals: { teamA: [], teamB: [] },
    disputes: [],
    result: null,
    ratingResult: null,
    teamRatingResult: null,
    recruitingPostId: promotedPost.id,
    createdBy: getRecruitingRoomOwnerId(promotedPost) || promotedPost.playerId,
    agreedAt: now,
    createdAt: now,
  };

  return {
    ...state,
    matches: [match, ...state.matches],
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
      item.id === postId
        ? { ...promotedPost, status: "closed", confirmedAt: now, roomState: { ...normalizeRecruitingRoomState(promotedPost.roomState ?? {}), invitations: [] } }
        : item
    )),
    notifications: [
      {
        id: makeId("n"),
        title: "매치 확정",
        body: `${match.title} 경기방이 생성됐습니다.`,
        tone: "match",
        matchId: match.id,
      },
      ...state.notifications,
    ],
  };
}

export function closeRecruitingPost(state, postId) {
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!post || !isRecruitingRoomOwner(post, state.currentUserId)) return state;
  const penalty = getRoomClosePenalty(post);
  const now = new Date().toISOString();
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const hostPenalties = penalty
    ? [
        ...roomState.hostPenalties,
        { id: makeId("penalty"), by: state.currentUserId, penalty, reason: "room_closed", createdAt: now },
      ]
    : roomState.hostPenalties;

  return {
    ...state,
    users: adjustUserTrust(state.users, state.currentUserId, -penalty),
    recruitingPosts: (state.recruitingPosts ?? []).map((post) => (
      post.id === postId && isRecruitingRoomOwner(post, state.currentUserId)
        ? { ...post, status: "closed", roomState: { ...roomState, hostPenalties, invitations: [] } }
        : post
    )),
    notifications: penalty
      ? [
          {
            id: makeId("n"),
            title: "방 닫기 패널티",
            body: `대기 인원과 경기 일정이 가까운 상태에서 방을 닫아 신뢰도 ${penalty}점이 감소했습니다.`,
            tone: "orange",
          },
          ...state.notifications,
        ]
      : state.notifications,
  };
}

export function markNotificationRead(state, notificationId) {
  const readAt = new Date().toISOString();
  return {
    ...state,
    notifications: state.notifications.map((notification) =>
      notification.id === notificationId ? { ...notification, readAt: notification.readAt ?? readAt } : notification,
    ),
  };
}

export function markAllNotificationsRead(state) {
  const readAt = new Date().toISOString();
  return {
    ...state,
    notifications: state.notifications.map((notification) => ({ ...notification, readAt: notification.readAt ?? readAt })),
  };
}

export function updateProfile(state, patch) {
  return {
    ...state,
    users: state.users.map((user) => (user.id === state.currentUserId ? { ...user, ...patch } : user)),
  };
}

export function createTeam(state, teamDraft) {
  const captainId = teamDraft.captainId || state.currentUserId;
  const captainTeamCount = state.teams.filter((team) => team.members.some((member) => member.userId === captainId)).length;
  if (captainTeamCount >= MAX_TEAM_MEMBERSHIPS) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "팀 생성 제한",
          body: `팀 한도 ${MAX_TEAM_MEMBERSHIPS}/${MAX_TEAM_MEMBERSHIPS}`,
          tone: "team",
        },
        ...state.notifications,
      ],
    };
  }

  const team = {
    id: makeId("t"),
    name: teamDraft.name,
    homeCourt: teamDraft.homeCourt,
    region: teamDraft.region,
    mmr: 1200,
    wins: 0,
    losses: 0,
    accent: teamDraft.accent || "#58d2c0",
    members: [{ userId: captainId, role: "captain" }],
  };

  return {
    ...state,
    teams: [team, ...state.teams],
    notifications: [{ id: makeId("n"), title: "팀 생성", body: `${team.name} 팀이 등록됐습니다.`, tone: "team" }, ...state.notifications],
  };
}

export function deleteTeam(state, teamId) {
  const team = state.teams.find((item) => item.id === teamId);
  if (!team) return state;

  const captain = team.members.find((member) => member.role === "captain");
  if (captain?.userId !== state.currentUserId) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "팀 삭제 권한 없음",
          body: "주장만 팀을 삭제할 수 있습니다.",
          tone: "team",
        },
        ...state.notifications,
      ],
    };
  }

  return {
    ...state,
    deletedTeamIds: Array.from(new Set([...(state.deletedTeamIds ?? []), teamId])),
    teams: state.teams.filter((item) => item.id !== teamId),
    settings: {
      ...state.settings,
      favoriteTeamIds: (state.settings?.favoriteTeamIds ?? []).filter((id) => id !== teamId),
    },
    recruitingPosts: (state.recruitingPosts ?? []).map((post) => (
      post.teamId === teamId ? { ...post, teamId: null, status: "closed" } : post
    )),
    notifications: [
      {
        id: makeId("n"),
        title: "팀 삭제",
        body: `${team.name} 팀을 삭제했습니다. 기존 경기 기록은 유지됩니다.`,
        tone: "team",
      },
      ...state.notifications,
    ],
  };
}

export function addTeamMember(state, teamId, memberDraft) {
  const userId = memberDraft.userId;
  const team = state.teams.find((item) => item.id === teamId);
  if (!team || team.members.some((member) => member.userId === userId)) return state;

  const membershipCount = state.teams.filter((item) => item.members.some((member) => member.userId === userId)).length;
  if (membershipCount >= MAX_TEAM_MEMBERSHIPS) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "팀원 추가 제한",
          body: `팀 한도 ${MAX_TEAM_MEMBERSHIPS}/${MAX_TEAM_MEMBERSHIPS}`,
          tone: "team",
        },
        ...state.notifications,
      ],
    };
  }

  return {
    ...state,
    teams: state.teams.map((item) =>
      item.id === teamId
        ? { ...item, members: [...item.members, { userId, role: memberDraft.role || "regular" }] }
        : item,
    ),
  };
}

export function updateTeamMemberRole(state, teamId, userId, role) {
  return {
    ...state,
    teams: state.teams.map((team) => {
      if (team.id !== teamId) return team;
      const nextMembers = team.members.map((member) => (
        member.userId === userId ? { ...member, role } : member
      ));
      const hasCaptain = nextMembers.some((member) => member.role === "captain");
      return {
        ...team,
        members: hasCaptain ? nextMembers : nextMembers.map((member, index) => (index === 0 ? { ...member, role: "captain" } : member)),
      };
    }),
  };
}

export function removeTeamMember(state, teamId, userId) {
  return {
    ...state,
    teams: state.teams.map((team) => {
      if (team.id !== teamId) return team;
      const nextMembers = team.members.filter((member) => member.userId !== userId);
      const hasCaptain = nextMembers.some((member) => member.role === "captain");
      return {
        ...team,
        members: hasCaptain ? nextMembers : nextMembers.map((member, index) => (index === 0 ? { ...member, role: "captain" } : member)),
      };
    }),
  };
}

export function getMemberRoleLabel(role) {
  return TEAM_ROLES[role] ?? role;
}
