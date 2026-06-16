import {
  COURTS,
  DISPUTE_WINDOW_MINUTES,
  MAX_TEAM_MEMBERSHIPS,
  MODE_SIZES,
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
  getMatchRecordWindow,
  getPlayerSideName,
  getStatRecorderSides,
  getResultPointAudit,
  getStatSubmissionStatus,
  getTeamCaptainId,
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
  getRecruitingSideCapacity,
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
const QUEUE_SCHEDULE_TIMES = ["18:00", "19:30", "21:00"];
const POST_MATCH_STATUSES = new Set(["approval", "disputed"]);
const RECORDABLE_RESERVE_SOURCES = new Set(["reserve-entry", "team-reserve"]);
const LIFECYCLE_TITLE_PATTERN = /^(동의 대기|진행 예정|결과 승인|이의 확인|이의제기|확정|결과 입력)\s*·\s*/;
const POST_MATCH_TITLE_PATTERN = /^(결과 승인|이의 확인|이의제기|확정|결과 입력)\s*·\s*/;
const SIDE_LABEL_TEXT = { teamA: "A팀", teamB: "B팀" };
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

function getRoomScheduleDate(post = {}) {
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
  if (post.playerId === userId) return true;
  const teamIds = new Set(
    (state.teams ?? [])
      .filter((team) => team.members?.some((member) => member.userId === userId))
      .map((team) => team.id),
  );
  return normalizeRecruitingApplicants(post.applicants ?? []).some((applicant) => (
    applicant.playerId === userId ||
    applicant.playerIds?.includes(userId) ||
    (applicant.teamId && teamIds.has(applicant.teamId))
  )) || normalizeRecruitingRoomState(post.roomState ?? {}).invitations.some((invitation) => (
    invitation.targetUserId === userId && invitation.status === "pending"
  ));
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

function getQueueSlot(slotIndex) {
  const date = addDateDays(QUEUE_SCHEDULE_START_DATE, Math.floor(slotIndex / QUEUE_SCHEDULE_TIMES.length));
  const time = QUEUE_SCHEDULE_TIMES[slotIndex % QUEUE_SCHEDULE_TIMES.length];
  return {
    scheduledDate: date,
    scheduledTime: time,
    scheduledAt: `${date} ${time}`,
  };
}

function getDatePart(value) {
  return String(value ?? "").match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
}

function getTimePart(value) {
  return String(value ?? "").match(/\d{2}:\d{2}/)?.[0] ?? "";
}

function needsQueueSchedule(post = {}) {
  const date = getDatePart(post.scheduledDate || post.scheduledAt);
  const time = getTimePart(post.scheduledTime || post.scheduledAt);
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
  const scheduleById = new Map();
  const used = new Set(
    posts
      .filter((post) => !needsQueueSchedule(post))
      .map(getQueueScheduleKey)
      .filter(isValidQueueScheduleKey),
  );
  let slotIndex = 0;

  posts
    .filter((post) => needsQueueSchedule(post))
    .sort((a, b) => getQueueSortKey(a).localeCompare(getQueueSortKey(b)))
    .forEach((post) => {
      let slot = getQueueSlot(slotIndex);
      while (used.has(slot.scheduledAt)) {
        slotIndex += 1;
        slot = getQueueSlot(slotIndex);
      }
      scheduleById.set(post.id, slot);
      used.add(slot.scheduledAt);
      slotIndex += 1;
    });

  return posts.map((post) => (scheduleById.has(post.id) ? { ...post, ...scheduleById.get(post.id) } : post));
}

function getNextQueueSchedule(posts = []) {
  const used = new Set(
    posts
      .filter((post) => post.status !== "closed")
      .map(getQueueScheduleKey)
      .filter(isValidQueueScheduleKey),
  );
  for (let index = 0; index < 365 * QUEUE_SCHEDULE_TIMES.length; index += 1) {
    const slot = getQueueSlot(index);
    if (!used.has(slot.scheduledAt)) return slot;
  }
  return getQueueSlot(posts.length);
}

function getScheduledStartMs(match = {}) {
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
  return {
    ...repaired,
    status: "agreed",
    title: getPregameMatchTitle(repaired),
    approvals: { teamA: [], teamB: [] },
    disputes: [],
    result: null,
    ratingResult: null,
    teamRatingResult: null,
    endedAt: null,
    confirmedAt: null,
    teamA: { ...(match.teamA ?? {}), score: 0 },
    teamB: { ...(match.teamB ?? {}), score: 0 },
  };
}

function repairFuturePregameTitle(match) {
  if (!["contract", "agreed"].includes(match.status) || !POST_MATCH_TITLE_PATTERN.test(match.title ?? "")) return match;
  return { ...match, title: getPregameMatchTitle(match) };
}

function normalizeMatch(match) {
  const startedStatuses = ["agreed", "approval", "confirmed", "disputed", "void", "cancelled"];
  const started = startedStatuses.includes(match.status);
  const teamAPlayers = match.teamA?.players ?? [];
  const teamBPlayers = match.teamB?.players ?? [];

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
    disputeMinutes: Number(match.disputeMinutes ?? DISPUTE_WINDOW_MINUTES),
    trustFeedback: match.trustFeedback ?? {},
  };

  if (isFutureScheduledMatch(normalized)) {
    if (POST_MATCH_STATUSES.has(normalized.status)) {
      return resetFuturePostMatchState(normalized);
    }
    return repairFuturePregameTitle(repairLifecycleTitle(normalized));
  }

  return repairLifecycleTitle(normalized);
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
    recruitingPosts: normalizeRecruitingSchedules(mergeById(state?.recruitingPosts, initialState.recruitingPosts ?? [])).map(normalizeRecruitingPost),
  };
}

export function loadState() {
  return normalizeState(readState(clone(initialState)));
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
  const scheduledAt = toDateTime(row.scheduled_date, row.scheduled_time, row.scheduled_at);

  return {
    id: row.id,
    title: row.title,
    mode: row.mode,
    court: row.court_name ?? context.courtById[row.court_id]?.name ?? "미정",
    scheduledDate: row.scheduled_date,
    scheduledTime: row.scheduled_time ? String(row.scheduled_time).slice(0, 5) : "",
    scheduledAt,
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
    recruitingPosts: recruitingPosts.map((post) => ({
      id: post.id,
      type: post.type,
      title: post.title,
      region: post.region,
      court: post.court_name ?? courtById[post.court_id]?.name ?? "미정",
      mode: post.mode,
      scheduledDate: post.scheduled_date,
      scheduledTime: post.scheduled_time ? String(post.scheduled_time).slice(0, 5) : "",
      scheduledAt: toDateTime(post.scheduled_date, post.scheduled_time, post.scheduled_at),
      ranked: post.ranked,
      spots: post.spots,
      teamId: post.team_id,
      targetTeamId: post.target_team_id,
      refereeId: post.referee_id ?? "",
      refereeTrustMin: post.referee_trust_min ?? REFEREE_TRUST_MIN,
      statEntryMinutes: post.stat_entry_minutes ?? STAT_ENTRY_WINDOW_MINUTES,
      disputeMinutes: post.dispute_minutes ?? DISPUTE_WINDOW_MINUTES,
      roomState: normalizeRecruitingRoomState(post.room_state ?? {}),
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
    })),
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
      ...(legacyState?.settings ?? DEFAULT_SETTINGS),
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
    return normalizedRemote?.state ?? null;
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
    scheduled_at: match.scheduledAt && match.scheduledAt !== "일정 미정" ? match.scheduledAt : null,
    scheduled_date: match.scheduledDate || null,
    scheduled_time: toDbTime(match.scheduledTime),
    team_a_id: match.teamA?.teamId,
    team_b_id: match.teamB?.teamId,
    score_a: Number(match.result?.scoreA ?? match.teamA?.score ?? 0),
    score_b: Number(match.result?.scoreB ?? match.teamB?.score ?? 0),
    rules: { ...(match.rules ?? {}), statRecorders: normalizeStatRecorders(match.statRecorders ?? match.rules?.statRecorders) },
    memo: match.memo,
    stakes: match.stakes,
    objection_window: match.objectionWindow,
    evidence: match.evidence ?? [],
    created_by: match.teamA?.players?.[0] ?? currentUserId,
    created_at: match.createdAt,
    agreed_at: match.agreedAt,
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
    scheduled_at: post.scheduledAt && post.scheduledAt !== "일정 미정" ? post.scheduledAt : null,
    ranked: post.ranked !== false,
    spots: post.spots ?? 1,
    target_team_id: post.targetTeamId ?? null,
    referee_id: post.refereeId || null,
    referee_trust_min: Number(post.refereeTrustMin ?? REFEREE_TRUST_MIN),
    stat_entry_minutes: Number(post.statEntryMinutes ?? STAT_ENTRY_WINDOW_MINUTES),
    dispute_minutes: Number(post.disputeMinutes ?? DISPUTE_WINDOW_MINUTES),
    room_state: normalizeRecruitingRoomState(post.roomState ?? {}),
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
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const recorders = normalizeStatRecorders(roomState.statRecorders);
  return {
    teamA: getValidRecruitingRecorder(post, state, "teamA", recorders.teamA),
    teamB: getValidRecruitingRecorder(post, state, "teamB", recorders.teamB),
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

  return {
    id: makeId("m"),
    title: `${tournament.title} ${roundLabel} · ${teamA.name} vs ${teamB.name}`,
    mode,
    court: tournament.court || "미정",
    scheduledDate: "",
    scheduledTime: "",
    scheduledAt: "일정 미정",
    status: "contract",
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
    objectionWindow: "2시간",
    evidence: [
      { id: "captain", label: "양팀 주장 확인" },
      { id: "tournament_bracket", label: "대회 대진표" },
    ],
    teamA: { name: teamA.name, teamId: teamA.id, players: getTeamPlayers(teamA, size), score: 0 },
    teamB: { name: teamB.name, teamId: teamB.id, players: getTeamPlayers(teamB, size), score: 0 },
    agreements: { teamA: [], teamB: [] },
    approvals: { teamA: [], teamB: [] },
    disputes: [],
    result: null,
    ratingResult: null,
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
  const teamA = state.teams.find((team) => team.id === targetMatch.teamA.teamId);
  const teamB = state.teams.find((team) => team.id === targetMatch.teamB.teamId);
  const teamADelta = teamA
    ? calculateTeamDelta({
        teamMmr: teamA.mmr,
        opponentTeamMmr: teamB?.mmr ?? 1200,
        actual: actualA,
        match: targetMatch,
        regularRatio: teamRegularRatio(teamA, targetMatch.teamA.players, state.users),
      })
    : 0;
  const teamBDelta = teamB
    ? calculateTeamDelta({
        teamMmr: teamB.mmr,
        opponentTeamMmr: teamA?.mmr ?? 1200,
        actual: actualB,
        match: targetMatch,
        regularRatio: teamRegularRatio(teamB, targetMatch.teamB.players, state.users),
      })
    : 0;
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
    return {
      ...user,
      trustScore: clampTrustScore((user.trustScore ?? 80) + (nextRatings ? 1 : 0) + trustReward),
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
    if (team.id === targetMatch.teamA.teamId) {
      return {
        ...team,
        mmr: Math.round(team.mmr + teamADelta),
        wins: team.wins + (actualA === 1 ? 1 : 0),
        losses: team.losses + (actualA === 0 ? 1 : 0),
      };
    }
    if (team.id === targetMatch.teamB.teamId) {
      return {
        ...team,
        mmr: Math.round(team.mmr + teamBDelta),
        wins: team.wins + (actualB === 1 ? 1 : 0),
        losses: team.losses + (actualB === 0 ? 1 : 0),
      };
    }
    return team;
  });

  const confirmedMatch = {
    ...targetMatch,
    status: "confirmed",
    ratingResult: ratingResult.changes,
    teamRatingResult: { teamA: teamADelta, teamB: teamBDelta },
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

export function createMatch(state, draft) {
  const mode = draft.mode ?? "5v5";
  const size = MODE_SIZES[mode] ?? 5;
  const scheduledAt = `${draft.scheduledDate ?? ""} ${draft.scheduledTime ?? ""}`.trim();
  const teams = state.teams;
  const teamA = teams.find((team) => team.id === draft.teamAId) ?? teams[0];
  const teamB = teams.find((team) => team.id === draft.teamBId && team.id !== teamA.id) ?? teams.find((team) => team.id !== teamA.id) ?? teams[1];
  const evidence = (draft.evidence ?? []).map((item) => ({ id: item.id, label: item.label }));
  const teamAPlayers = getTeamPlayers(teamA, size);
  const teamBPlayers = getTeamPlayers(teamB, size);
  const refereeId = getTrustedRefereeId(state, draft.refereeId, [...teamAPlayers, ...teamBPlayers]);
  const mmrRangeMode = normalizeRecruitingMmrRangeMode(draft.mmrRangeMode);
  const ratingScale = draft.ranked === false ? 1 : getRecruitingRatingScale({ ranked: draft.ranked !== false, mmrRangeMode });
  const match = {
    id: makeId("m"),
    title: draft.title || `${draft.court} ${mode} 판`,
    mode,
    court: draft.court,
    scheduledDate: draft.scheduledDate,
    scheduledTime: draft.scheduledTime,
    scheduledAt: scheduledAt || "일정 미정",
    status: "contract",
    ranked: draft.ranked !== false,
    official: Boolean(draft.official),
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
    objectionWindow: "2시간",
    evidence,
    teamA: { name: teamA.name, teamId: teamA.id, players: teamAPlayers, score: 0 },
    teamB: { name: teamB.name, teamId: teamB.id, players: teamBPlayers, score: 0 },
    agreements: { teamA: [], teamB: [] },
    approvals: { teamA: [], teamB: [] },
    disputes: [],
    result: null,
    ratingResult: null,
    createdAt: new Date().toISOString(),
  };

  return {
    ...state,
    matches: [match, ...state.matches],
    notifications: [
      { id: makeId("n"), title: "새 경기방", body: `${match.title} 경기 전 동의를 기다립니다.`, tone: "match", matchId: match.id },
      ...state.notifications,
    ],
  };
}

export function createTournament(state, draft) {
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
    ranked: draft.ranked !== false,
    official: Boolean(draft.official),
    startDate: draft.scheduledDate || draft.tournamentStartDate || "",
    endDate: draft.tournamentEndDate || draft.scheduledDate || "",
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
  if (!sidePlayers.includes(currentUserId)) return null;
  if ((match[decisionKey]?.[sideName] ?? []).includes(currentUserId)) return null;
  return currentUserId;
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
  const currentUserCanRecord = currentUserIsEligibleReferee || (!hasReferee && (recorderSides.length > 0 || Boolean(currentSideName)));

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
          body: "경기 참가자 또는 팀 후보 기록자만 스코어와 개인 활약을 입력할 수 있습니다.",
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
  const matchStartsAt = match.scheduledDate && match.scheduledTime ? new Date(`${match.scheduledDate}T${match.scheduledTime}`) : null;
  const beforeStart = matchStartsAt && Number.isFinite(matchStartsAt.getTime()) && Date.now() < matchStartsAt.getTime();
  const liveRecordAllowed = recordWindow.beforeEnd && !beforeStart && (currentUserIsEligibleReferee || (!hasReferee && recorderSides.length > 0));
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
  const recorderPlayerIds = recorderSides.flatMap((sideName) => match[sideName]?.players ?? []);
  const selfPlayerIds = currentSideName ? [currentUserId] : [];
  const targetPlayerIds = currentUserIsEligibleReferee ? playerIds : [...new Set([...recorderPlayerIds, ...selfPlayerIds])]
    .filter((playerId) => getAllowedStatFields(match, currentUserId, playerId).length > 0);
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
  const submittedStats = normalizePlayerStats(result.playerStats ?? {}, targetPlayerIds);
  const nextPlayerStats = currentUserIsEligibleReferee ? submittedStats : { ...existingStats };
  if (!currentUserIsEligibleReferee) {
    targetPlayerIds.forEach((playerId) => {
      const allowedFieldIds = new Set(getAllowedStatFields(match, currentUserId, playerId).map((field) => field.id));
      nextPlayerStats[playerId] = Object.fromEntries(
        Object.entries(submittedStats[playerId]).map(([fieldId, value]) => [
          fieldId,
          allowedFieldIds.has(fieldId) ? value : existingStats[playerId]?.[fieldId] ?? 0,
        ]),
      );
    });
  }
  const nextSubmissions = currentUserIsEligibleReferee
    ? Object.fromEntries(playerIds.map((playerId) => [playerId, { by: currentUserId, side: "referee", source: "referee", submittedAt: now }]))
    : {
        ...(match.result?.statSubmissions ?? {}),
        ...Object.fromEntries(targetPlayerIds.map((playerId) => {
          const sideName = getPlayerSideName(match, playerId);
          const source = isMatchStatRecorder(match, currentUserId, sideName) ? "candidate_recorder" : "player";
          return [playerId, { by: currentUserId, side: sideName, source, submittedAt: now }];
        })),
      };
  const nextResult = {
    scoreA: Number(result.scoreA),
    scoreB: Number(result.scoreB),
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
          body: "경기 종료 후 2시간이 지나 이의제기를 접수할 수 없습니다.",
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

export function cancelMatch(state, matchId) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match || !["contract", "agreed"].includes(match.status)) return state;

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
  const playerIds = match ? getMatchPlayerIds(match) : [];
  if (!match || !["approval", "confirmed"].includes(match.status)) return state;
  if (!playerIds.includes(state.currentUserId) || !playerIds.includes(targetUserId) || targetUserId === state.currentUserId) return state;

  const maxStars = Math.max(1, Math.floor(playerIds.length / 2));
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
          title: "별 한도 도달",
          body: `한 경기에서 최대 ${maxStars}명에게 별을 줄 수 있습니다.`,
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

export function reportMatch(state, matchId, reason = "") {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match) return state;
  const report = {
    id: makeId("r"),
    type: "match",
    targetId: matchId,
    by: state.currentUserId,
    reason: reason.trim() || "경기 기록 확인이 필요합니다.",
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
  if (post.playerId === state.currentUserId) return state;
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
  const postType = hostJoinMode === "team" ? "need_player" : "find_team";
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
  const hostPlayerIds = hostJoinMode === "team" ? getSelectedTeamPlayerIds(hostTeam, sideCapacity, draft.playerIds) : [];
  if (hostJoinMode === "team" && !hostPlayerIds.length) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "참여 팀원 필요",
          body: "팀으로 방을 열려면 실제 참여할 팀원을 1명 이상 선택해야 합니다.",
          tone: "team",
        },
        ...state.notifications,
      ],
    };
  }
  const hostSize = hostJoinMode === "team" ? hostPlayerIds.length : 1;
  const refereeId = getTrustedRefereeId(state, draft.refereeId, [state.currentUserId, ...hostPlayerIds]);
  const fallbackSchedule = getNextQueueSchedule(state.recruitingPosts ?? []);
  const scheduledDate = draft.scheduledDate || fallbackSchedule.scheduledDate;
  const scheduledTime = draft.scheduledTime || fallbackSchedule.scheduledTime;
  const scheduledAt = `${scheduledDate} ${scheduledTime}`;
  const mmrRangeMode = normalizeRecruitingMmrRangeMode(draft.mmrRangeMode);
  const ratingScale = draft.ranked === false ? 1 : getRecruitingRatingScale({ ranked: draft.ranked !== false, mmrRangeMode });
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
    ranked: draft.ranked !== false,
    mmrRangeMode,
    ratingScale,
    spots: Math.max(1, sideCapacity * 2 - hostSize),
    teamId: hostJoinMode === "team" ? draft.teamId : null,
    targetTeamId: draft.targetTeamId ?? null,
    refereeId,
    refereeTrustMin: REFEREE_TRUST_MIN,
    statEntryMinutes: STAT_ENTRY_WINDOW_MINUTES,
    disputeMinutes: DISPUTE_WINDOW_MINUTES,
    hostJoinMode,
    hostSide: "teamA",
    hostReady: false,
    roomState: { mmrRangeMode },
    sideCapacity,
    playerIds: hostPlayerIds,
    position: hostJoinMode === "player" ? draft.position || "포지션 자유" : "포지션 자유",
    playerId: state.currentUserId,
    memo: draft.memo?.trim() || "개인이나 팀 파티로 빈자리에 들어올 수 있습니다.",
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
  if (post.playerId === state.currentUserId) return state;
  const user = state.users.find((item) => item.id === state.currentUserId);
  const requestedJoinMode = application.joinMode === "team" || application.teamId
    ? "team"
    : application.joinMode === "player"
      ? "player"
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

  const candidateMmr = applicantKind === "team" ? team.mmr : user?.ratings?.integrated ?? 1200;
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
  const selectedPlayerIds = applicantKind === "team" ? getSelectedTeamPlayerIds(team, getRecruitingSideCapacity(post), application.playerIds) : [];
  if (applicantKind === "team" && !selectedPlayerIds.length) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "참여 팀원 필요",
          body: "팀으로 대기하려면 실제 참여할 팀원을 1명 이상 선택해야 합니다.",
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
        status: "waiting",
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
        status: "waiting",
        reserve,
        position: application.position ?? user?.position ?? null,
        createdAt: now,
        updatedAt: now,
      };
  if (hasRecruitingApplicant(post, nextApplicant)) return state;
  const applicants = [...normalizeRecruitingApplicants(post.applicants ?? []), nextApplicant];

  return {
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (item.id === postId ? { ...item, applicants } : item)),
  };
}

function getLobbySideName(lobby, sideName) {
  const names = lobby.sides[sideName].entries
    .map((entry) => entry.team?.name ?? entry.user?.name)
    .filter(Boolean);
  if (!names.length) return sideName === "teamA" ? "A팀" : "B팀";
  return names.slice(0, 3).join(" + ");
}

function getLobbyPrimaryTeamId(lobby, sideName) {
  return lobby.sides[sideName].entries.find((entry) => entry.team?.id)?.team.id ?? null;
}

export function setRecruitingReady(state, postId, ready = true) {
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!post || post.status !== "open") return state;
  const updatedAt = new Date().toISOString();

  return {
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => {
      if (item.id !== postId) return item;
      if (item.playerId === state.currentUserId) {
        return { ...item, hostReady: Boolean(ready) };
      }
      return cleanRecruitingRoomStatRecorders({
        ...item,
        applicants: normalizeRecruitingApplicants(item.applicants ?? []).map((applicant) => (
          applicant.playerId === state.currentUserId
            ? { ...applicant, status: ready ? "ready" : "waiting", updatedAt }
            : applicant
        )),
      }, state);
    }),
  };
}

export function cancelRecruitingParticipation(state, postId) {
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!post || post.status !== "open" || post.playerId === state.currentUserId) return state;

  return {
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => {
      if (item.id !== postId) return item;
      return cleanRecruitingRoomStatRecorders({
        ...item,
        applicants: normalizeRecruitingApplicants(item.applicants ?? []).filter(
          (applicant) => applicant.playerId !== state.currentUserId,
        ),
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
  if (!post || post.status !== "open" || post.playerId !== state.currentUserId) return state;

  const side = ["teamA", "teamB"].includes(invite.side) ? invite.side : "teamB";
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const lobby = getRecruitingLobby(post, state);
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

  const now = new Date().toISOString();
  const invitations = [
    ...roomState.invitations,
    ...targetUserIds.map((targetUserId) => ({
      id: makeId("inv"),
      targetUserId,
      fromUserId: state.currentUserId,
      teamId: invite.teamId ?? null,
      side,
      reserve: false,
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
      {
        id: makeId("n"),
        title: "초대장 발송",
        body: `${post.title} ${SIDE_LABEL_TEXT[side]} 빈 슬롯에 ${targetUserIds.length}명 초대장을 보냈습니다.`,
        tone: "match",
      },
      ...state.notifications,
    ],
  };
}

export function acceptRecruitingInvitation(state, postId, invitationId) {
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!post || post.status !== "open" || post.playerId === state.currentUserId) return state;
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const invitation = roomState.invitations.find((item) => (
    item.id === invitationId &&
    item.targetUserId === state.currentUserId &&
    item.status === "pending"
  ));
  if (!invitation) return state;

  const user = state.users.find((item) => item.id === state.currentUserId);
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
  if (lobby.sides[side].filled >= lobby.sides[side].capacity) {
    return expireInvitation("방이 꽉 찼습니다. 먼저 수락한 선수만 들어갑니다.");
  }

  const now = new Date().toISOString();
  const nextApplicant = {
    kind: "player",
    joinMode: "player",
    playerId: state.currentUserId,
    teamId: null,
    side,
    status: "waiting",
    reserve: false,
    position: user?.position ?? null,
    createdAt: now,
    updatedAt: now,
  };
  if (hasRecruitingApplicant(post, nextApplicant)) return state;

  return {
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
      item.id === postId
        ? {
            ...item,
            applicants: [...normalizeRecruitingApplicants(item.applicants ?? []), nextApplicant],
            roomState: {
              ...roomState,
              invitations: roomState.invitations.filter((candidate) => candidate.id !== invitationId),
            },
          }
        : item
    )),
    notifications: [
      {
        id: makeId("n"),
        title: "초대 수락",
        body: `${post.title} ${SIDE_LABEL_TEXT[side]}에 대기 등록됐습니다.`,
        tone: "match",
      },
      ...state.notifications,
    ],
  };
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

export function setRecruitingApplicantPlacement(state, postId, playerId, placement = {}) {
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!post || post.status !== "open" || post.playerId !== state.currentUserId) return state;
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const hostTarget = playerId === post.playerId;
  const applicants = normalizeRecruitingApplicants(post.applicants ?? []);
  const target = hostTarget
    ? { side: post.hostSide ?? "teamA", reserve: roomState.hostReserve }
    : applicants.find((applicant) => applicant.playerId === playerId);
  if (!target) return state;

  const side = ["teamA", "teamB"].includes(placement.side) ? placement.side : target.side;
  const reserve = Boolean(placement.reserve);
  const updatedAt = new Date().toISOString();
  const nextApplicants = hostTarget
    ? applicants
    : applicants.map((applicant) => (
      applicant.playerId === playerId
        ? { ...applicant, side, reserve, status: "waiting", updatedAt }
        : applicant
    ));
  const nextPost = hostTarget
    ? {
      ...post,
      hostSide: side,
      hostReady: false,
      roomState: { ...roomState, hostReserve: reserve },
      applicants: nextApplicants,
    }
    : { ...post, applicants: nextApplicants };

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

export function setRecruitingPartyPlayerReserve(state, postId, entryId, playerId, reserve = true) {
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!post || post.status !== "open" || post.playerId !== state.currentUserId || !entryId || !playerId) return state;

  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const lobby = getRecruitingLobby(post, state);
  const entry = (lobby.entries ?? []).find((item) => item.id === entryId);
  if (!entry?.team || !entry.team.members?.some((member) => member.userId === playerId)) return state;

  const capacity = getRecruitingSideCapacity(post);
  const applicants = normalizeRecruitingApplicants(post.applicants ?? []);
  const targetApplicant = entry.fixed
    ? null
    : applicants.find((applicant) => getRecruitingApplicantKey(applicant) === entry.id);
  if (!entry.fixed && !targetApplicant) return state;

  const storedPlayerIds = getSelectedTeamPlayerIds(entry.team, capacity, entry.fixed ? post.playerIds : targetApplicant.playerIds);
  const currentPlayerIds = storedPlayerIds.length ? storedPlayerIds : (entry.players ?? []);
  const nextPlayerIds = reserve
    ? currentPlayerIds.filter((id) => id !== playerId)
    : Array.from(new Set([...currentPlayerIds, playerId]));
  if (!nextPlayerIds.length || nextPlayerIds.length > capacity) return state;

  const updatedAt = new Date().toISOString();
  const currentReserveIds = roomState.partyReserves?.[entry.id] ?? [];
  const nextReserveIds = reserve
    ? Array.from(new Set([...currentReserveIds, playerId]))
    : currentReserveIds.filter((id) => id !== playerId);
  const nextPartyReserves = { ...roomState.partyReserves, [entry.id]: nextReserveIds };
  if (!nextReserveIds.length) delete nextPartyReserves[entry.id];
  const nextRoomState = { ...roomState, partyReserves: nextPartyReserves };
  const nextPost = entry.fixed
    ? { ...post, hostReady: false, playerIds: nextPlayerIds, roomState: nextRoomState }
    : {
      ...post,
      roomState: nextRoomState,
      applicants: applicants.map((applicant) => (
        getRecruitingApplicantKey(applicant) === entry.id
          ? { ...applicant, playerIds: nextPlayerIds, status: "waiting", updatedAt }
          : applicant
      )),
    };

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

export function setRecruitingStatRecorder(state, postId, sideName, playerId = "") {
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!post || post.status !== "open" || post.playerId !== state.currentUserId || post.refereeId) return state;
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
  if (!post || post.status !== "open" || post.playerId !== state.currentUserId || playerId === state.currentUserId) return state;
  const applicants = normalizeRecruitingApplicants(post.applicants ?? []);
  const target = applicants.find((applicant) => applicant.playerId === playerId);
  if (!target) return state;
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
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
            roomState: { ...roomState, kickLog },
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

export function confirmRecruitingMatch(state, postId) {
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!post || post.status !== "open" || post.playerId !== state.currentUserId) return state;
  const lobby = getRecruitingLobby(post, state);

  if (!lobby.canConfirm) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "매치 확정 불가",
          body: "양쪽 인원이 꽉 차고 모든 참가자가 대기 완료 상태여야 합니다.",
          tone: "match",
          matchId: null,
        },
        ...state.notifications,
      ],
    };
  }

  const scheduledAt = post.scheduledDate && post.scheduledTime ? `${post.scheduledDate} ${post.scheduledTime}` : "일정 미정";
  const now = new Date().toISOString();
  const teamAPlayers = lobby.sides.teamA.projectedPlayers.slice(0, lobby.sides.teamA.capacity);
  const teamBPlayers = lobby.sides.teamB.projectedPlayers.slice(0, lobby.sides.teamB.capacity);
  const playerIds = [...teamAPlayers, ...teamBPlayers];
  const refereeId = getTrustedRefereeId(state, post.refereeId, playerIds);
  const statRecorders = refereeId ? normalizeStatRecorders({}) : getRecruitingRoomStatRecorders(post, state);
  const mmrRangeMode = normalizeRecruitingMmrRangeMode(post.mmrRangeMode ?? post.roomState?.mmrRangeMode);
  const ratingScale = getRecruitingRatingScale({ ranked: post.ranked !== false, mmrRangeMode });
  const match = {
    id: makeId("m"),
    title: post.title,
    mode: post.mode,
    court: post.court,
    scheduledDate: post.scheduledDate ?? "",
    scheduledTime: post.scheduledTime ?? "",
    scheduledAt,
    status: "contract",
    official: Boolean(post.official),
    preRegistered: true,
    refereeId,
    refereeTrustMin: REFEREE_TRUST_MIN,
    statRecorders,
    statEntryMinutes: STAT_ENTRY_WINDOW_MINUTES,
    disputeMinutes: DISPUTE_WINDOW_MINUTES,
    rules: {
      ...(post.rules ?? { targetScore: 21, timeLimit: 12, winByTwo: true, ball: "7호 공" }),
      mmrRangeMode,
      ratingScale,
    },
    memo: post.memo,
    stakes: "매치 큐에서 확정된 경기입니다.",
    ranked: post.ranked !== false,
    mmrRangeMode,
    ratingScale,
    objectionWindow: "2시간",
    evidence: [{ id: "captain", label: "양측 주장 확인" }],
    teamA: {
      name: getLobbySideName(lobby, "teamA"),
      teamId: getLobbyPrimaryTeamId(lobby, "teamA"),
      players: teamAPlayers,
      score: 0,
    },
    teamB: {
      name: getLobbySideName(lobby, "teamB"),
      teamId: getLobbyPrimaryTeamId(lobby, "teamB"),
      players: teamBPlayers,
      score: 0,
    },
    parties: lobby.entries.map((entry) => ({
      kind: entry.kind,
      side: entry.side,
      teamId: entry.teamId,
      playerId: entry.playerId,
      players: entry.players,
      reserve: entry.reserve,
    })),
    promotedReserveIds: {
      teamA: lobby.sides.teamA.fillSlots.map((candidate) => candidate.playerId),
      teamB: lobby.sides.teamB.fillSlots.map((candidate) => candidate.playerId),
    },
    agreements: { teamA: [], teamB: [] },
    approvals: { teamA: [], teamB: [] },
    disputes: [],
    result: null,
    ratingResult: null,
    teamRatingResult: null,
    recruitingPostId: post.id,
    createdAt: now,
  };

  return {
    ...state,
    matches: [match, ...state.matches],
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
      item.id === postId
        ? { ...item, status: "closed", confirmedAt: now, roomState: { ...normalizeRecruitingRoomState(item.roomState ?? {}), invitations: [] } }
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
  if (!post || post.playerId !== state.currentUserId) return state;
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
      post.id === postId && post.playerId === state.currentUserId
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
