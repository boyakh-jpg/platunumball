import {
  getAdminLevel,
  getRowsMaxUpdatedAt,
  groupRowsBy,
  uniqueValues,
} from "../_supabaseAdmin.js";
import { fromRemoteMatch } from "../../../shared/lib/matchMappers.js";
import { fromRemoteAffiliation } from "../../../shared/lib/affiliationMappers.js";
import { createProfileShell, fromRemoteProfile, getRemoteAppSettings } from "../../../shared/lib/profileMappers.js";
import {
  fromRemoteApprovedCourt,
  fromRemoteCourtRequest,
  fromRemoteCourtReview,
  fromRemotePayloadRow,
  fromRemoteReport,
} from "../../../shared/lib/remotePayloadMappers.js";
import { normalizeState } from "../../../shared/lib/stateNormalizer.js";
import {
  ADMIN_DISCIPLINARY_COLUMNS,
  AFFILIATION_COLUMNS,
  APPOINTMENT_COLUMNS,
  APPROVED_COURT_COLUMNS,
  COURT_REQUEST_COLUMNS,
  COURT_REVIEW_COLUMNS,
  MATCH_LIST_COLUMNS,
  MATCH_PLAYER_COLUMNS,
  PUBLIC_PROFILE_COLUMNS,
  REFEREE_REQUEST_COLUMNS,
  REPORT_COLUMNS,
  TEAM_COLUMNS,
} from "../../../shared/lib/repositoryColumns.js";
import { DEFAULT_SETTINGS } from "../../../shared/lib/repositoryDefaults.js";
import { fromRemoteTeam } from "../../../shared/lib/teamMappers.js";
import {
  DIRECTORY_ID_BATCH_SIZE,
  getDirectoryPageRequest,
  normalizeAdminQueueMode,
  normalizeAdminSection,
  normalizeDirectoryFilter,
} from "../../../shared/lib/queryPolicy.js";

export const ADMIN_REPORT_TYPES = {
  courts: ["court", "court_review", "court_request"],
  players: ["player"],
  matches: ["match"],
  teams: ["team_emblem", "team_name", "affiliation_name"],
};

export function getPageRequest(body = {}, { admin = false, kind = "" } = {}) {
  return getDirectoryPageRequest(body, { admin, kind });
}

export function normalizeFilter(value = "") {
  return normalizeDirectoryFilter(value);
}

export function uniqueRows(rows = []) {
  const byId = new Map();
  rows.flat().forEach((row) => {
    if (row?.id) byId.set(row.id, row);
  });
  return [...byId.values()];
}

export async function readRows(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function readPage(query, { limit, offset }, label, optional = false) {
  const { data, error, count } = await query.range(offset, offset + limit);
  if (error) {
    if (!optional) throw error;
    console.warn(`Directory optional page skipped: ${label}`, error.message);
    return { rows: [], total: 0, hasMore: false };
  }
  const rows = data ?? [];
  return {
    rows: rows.slice(0, limit),
    total: Number.isFinite(Number(count)) ? Number(count) : offset + Math.min(rows.length, limit),
    hasMore: rows.length > limit,
  };
}

export async function readRowsByIds(supabase, table, columns, column, ids, { optional = false } = {}) {
  const scopedIds = uniqueValues(ids);
  if (!scopedIds.length) return [];
  const rows = [];
  for (let index = 0; index < scopedIds.length; index += DIRECTORY_ID_BATCH_SIZE) {
    const batch = scopedIds.slice(index, index + DIRECTORY_ID_BATCH_SIZE);
    const { data, error } = await supabase.from(table).select(columns).in(column, batch);
    if (error) {
      if (!optional) throw error;
      console.warn(`Directory optional query skipped: ${table}`, error.message);
      break;
    }
    rows.push(...(data ?? []));
  }
  return rows;
}

export function getCurrentUser(context) {
  return context.profile
    ? fromRemoteProfile(context.profile)
    : createProfileShell(context.authUserId, context.authUser?.email ?? "");
}

export function getAdminSection(value = "") {
  return normalizeAdminSection(value);
}

export function getQueueMode(value = "") {
  return normalizeAdminQueueMode(value);
}

export function collectReportProfileIds(reports = []) {
  return uniqueValues(reports.flatMap((report) => [
    report.user_id,
    ...(report.type === "player" ? [report.target_id] : []),
    ...(Array.isArray(report.reported_user_ids) ? report.reported_user_ids : []),
  ]));
}

export function toAdminMatchState(matchRows = [], matchPlayerRows = [], teamRows = []) {
  if (!matchRows.length) return [];
  const teamById = Object.fromEntries(teamRows.map((team) => [team.id, fromRemoteTeam(team, [])]));
  const emptyMap = () => new Map();
  const context = {
    teamById,
    courtById: {},
    playersByMatch: groupRowsBy(matchPlayerRows, "match_id"),
    resultsByMatch: {},
    statsByMatch: emptyMap(),
    agreementsByMatch: emptyMap(),
    approvalsByMatch: emptyMap(),
    disputesByMatch: emptyMap(),
  };
  return matchRows.map((row) => fromRemoteMatch(row, context));
}

export async function loadAdminSection(context, body = {}) {
  const section = getAdminSection(body.section);
  const queueMode = getQueueMode(body.queueMode ?? body.queue);
  const pageRequest = getPageRequest(body, { admin: true });
  const sourceCount = section === "appointments" ? 3 : section === "teams" ? 1 : 2;
  const sourcePageRequest = {
    limit: Math.max(1, Math.floor(pageRequest.limit / sourceCount)),
    offset: pageRequest.offset,
  };
  const filter = normalizeFilter(body.filter ?? body.query ?? body.q);
  const adminLevel = context.profileId ? await getAdminLevel(context) : 0;
  if (adminLevel < 30) {
    const error = new Error("admin_required");
    error.statusCode = 403;
    throw error;
  }

  const reportTypes = ADMIN_REPORT_TYPES[section] ?? [];
  let reportPage = { rows: [], total: 0, hasMore: false };
  let courtRequestPage = { rows: [], total: 0, hasMore: false };
  let issueMatchPage = { rows: [], total: 0, hasMore: false };
  let disciplinaryPage = { rows: [], total: 0, hasMore: false };
  let adminAppointmentPage = { rows: [], total: 0, hasMore: false };
  let refereeAppointmentPage = { rows: [], total: 0, hasMore: false };
  let refereeRequestPage = { rows: [], total: 0, hasMore: false };
  let pendingAppointmentCount = 0;

  if (reportTypes.length) {
    let query = context.supabase
      .from("reports")
      .select(REPORT_COLUMNS, { count: "exact" })
      .in("type", reportTypes)
      .order("created_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false });
    if (queueMode === "pending") query = query.eq("status", "open");
    if (filter) query = query.ilike("reason", `%${filter}%`);
    reportPage = await readPage(query, sourcePageRequest, "admin_reports");
  }

  if (section === "courts") {
    let query = context.supabase
      .from("court_requests")
      .select(COURT_REQUEST_COLUMNS, { count: "exact" })
      .order("created_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false });
    if (queueMode === "pending") query = query.in("status", ["pending", "reported"]);
    query = applyDirectoryTextFilter(query, ["name", "hashtag", "address_text", "road_address", "jibun_address"], filter);
    courtRequestPage = await readPage(query, sourcePageRequest, "admin_court_requests");
  }

  if (section === "matches") {
    let query = context.supabase
      .from("matches")
      .select(MATCH_LIST_COLUMNS, { count: "exact" })
      .in("status", ["disputed", "approval"])
      .order("updated_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false });
    if (queueMode === "history") {
      query = context.supabase
        .from("matches")
        .select(MATCH_LIST_COLUMNS, { count: "exact" })
        .in("status", ["disputed", "approval", "confirmed", "void"])
        .order("updated_at", { ascending: false, nullsFirst: false })
        .order("id", { ascending: false });
    }
    query = applyDirectoryTextFilter(query, ["title", "court_name"], filter);
    issueMatchPage = await readPage(query, sourcePageRequest, "admin_issue_matches");
  }

  if (section === "players") {
    let query = context.supabase
      .from("admin_disciplinary_actions")
      .select(ADMIN_DISCIPLINARY_COLUMNS, { count: "exact" })
      .order("created_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false });
    if (queueMode === "pending") query = query.eq("status", "active");
    query = applyDirectoryTextFilter(query, ["type", "action_type", "status"], filter);
    disciplinaryPage = await readPage(query, sourcePageRequest, "admin_disciplinary_actions");
  }

  if (section === "appointments") {
    const appointmentQuery = (table) => {
      let query = context.supabase
      .from(table)
      .select(APPOINTMENT_COLUMNS, { count: "exact" })
      .order("created_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false });
      if (queueMode === "pending") query = query.in("status", ["active", "approved", "pending"]);
      query = applyDirectoryTextFilter(query, ["role", "grade", "status"], filter);
      return query;
    };
    let refereeRequestQuery = context.supabase
      .from("referee_requests")
      .select(REFEREE_REQUEST_COLUMNS, { count: "exact" })
      .order("created_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false });
    if (queueMode === "pending") refereeRequestQuery = refereeRequestQuery.eq("status", "pending");
    refereeRequestQuery = applyDirectoryTextFilter(refereeRequestQuery, ["qualification", "status"], filter);
    const [
      nextAdminAppointmentPage,
      nextRefereeAppointmentPage,
      nextRefereeRequestPage,
      adminPendingCount,
      refereePendingCount,
    ] = await Promise.all([
      readPage(appointmentQuery("admin_appointments"), sourcePageRequest, "admin_appointments"),
      readPage(appointmentQuery("referee_appointments"), sourcePageRequest, "referee_appointments"),
      readPage(refereeRequestQuery, sourcePageRequest, "referee_requests"),
      context.supabase.from("admin_appointments").select("id", { count: "exact", head: true }).eq("status", "pending"),
      context.supabase.from("referee_appointments").select("id", { count: "exact", head: true }).eq("status", "pending"),
    ]);
    if (adminPendingCount.error) throw adminPendingCount.error;
    if (refereePendingCount.error) throw refereePendingCount.error;
    adminAppointmentPage = nextAdminAppointmentPage;
    refereeAppointmentPage = nextRefereeAppointmentPage;
    refereeRequestPage = nextRefereeRequestPage;
    pendingAppointmentCount = Number(adminPendingCount.count ?? 0) + Number(refereePendingCount.count ?? 0);
  }

  const reportRows = reportPage.rows;
  const reportRowsByType = (type) => reportRows.filter((row) => row.type === type);
  const targetCourtRequestRows = section === "courts"
    ? await readRowsByIds(context.supabase, "court_requests", COURT_REQUEST_COLUMNS, "id", reportRowsByType("court_request").map((row) => row.target_id))
    : [];
  let courtRequestRows = uniqueRows([courtRequestPage.rows, targetCourtRequestRows]);
  const approvedCourtTargetIds = reportRowsByType("court").map((row) => row.target_id);
  const courtReviewTargetIds = reportRowsByType("court_review").map((row) => row.target_id);
  const [targetApprovedCourtRows, courtReviewRows] = await Promise.all([
    readRowsByIds(context.supabase, "approved_courts", APPROVED_COURT_COLUMNS, "id", approvedCourtTargetIds),
    readRowsByIds(context.supabase, "court_reviews", COURT_REVIEW_COLUMNS, "id", courtReviewTargetIds),
  ]);
  const requestZonecodes = uniqueValues(courtRequestRows.map((row) => row.zonecode));
  const [locationCandidateRows, pendingLocationRequestRows] = requestZonecodes.length
    ? await Promise.all([
      readRows(
        context.supabase
          .from("approved_courts")
          .select(APPROVED_COURT_COLUMNS)
          .in("zonecode", requestZonecodes)
          .limit(pageRequest.limit),
      ),
      readRows(
        context.supabase
          .from("court_requests")
          .select(COURT_REQUEST_COLUMNS)
          .in("zonecode", requestZonecodes)
          .in("status", ["pending", "reported"])
          .limit(pageRequest.limit),
      ),
    ])
    : [[], []];
  courtRequestRows = uniqueRows([courtRequestRows, pendingLocationRequestRows]);
  const approvedCourtRows = uniqueRows([targetApprovedCourtRows, locationCandidateRows]);

  const targetMatchIds = uniqueValues([
    ...reportRowsByType("match").map((row) => row.target_id),
    ...reportRowsByType("player").map((row) => row.payload?.sourceMatchId),
  ]);
  const targetMatchRows = await readRowsByIds(context.supabase, "matches", MATCH_LIST_COLUMNS, "id", targetMatchIds);
  const matchRows = uniqueRows([issueMatchPage.rows, targetMatchRows]);
  const matchPlayerRows = await readRowsByIds(context.supabase, "match_players", MATCH_PLAYER_COLUMNS, "match_id", matchRows.map((row) => row.id));

  const teamTargetIds = uniqueValues([
    ...reportRowsByType("team_emblem").map((row) => row.target_id),
    ...reportRowsByType("team_name").map((row) => row.target_id),
    ...matchRows.flatMap((row) => [row.team_a_id, row.team_b_id]),
  ]);
  const affiliationTargetIds = reportRowsByType("affiliation_name").map((row) => row.target_id);
  const [teamRows, affiliationRows] = await Promise.all([
    readRowsByIds(context.supabase, "teams", TEAM_COLUMNS, "id", teamTargetIds),
    readRowsByIds(context.supabase, "affiliations", AFFILIATION_COLUMNS, "id", affiliationTargetIds),
  ]);

  const appointmentRows = [...adminAppointmentPage.rows, ...refereeAppointmentPage.rows];
  const profileIds = uniqueValues([
    context.profileId,
    ...collectReportProfileIds(reportRows),
    ...courtRequestRows.map((row) => row.requested_by),
    ...courtReviewRows.flatMap((row) => [row.reviewer_id]),
    ...disciplinaryPage.rows.flatMap((row) => [row.user_id, row.created_by]),
    ...appointmentRows.flatMap((row) => [row.user_id, row.appointed_by]),
    ...refereeRequestPage.rows.flatMap((row) => [row.requested_by, row.payload?.userId]),
    ...matchPlayerRows.map((row) => row.user_id),
    ...affiliationRows.map((row) => row.created_by),
  ]);
  const publicProfileRows = await readRowsByIds(context.supabase, "public_profiles", PUBLIC_PROFILE_COLUMNS, "id", profileIds);
  const currentUser = getCurrentUser(context);
  const userById = new Map(publicProfileRows.map((row) => [row.id, fromRemoteProfile(row)]));
  userById.set(currentUser.id, { ...userById.get(currentUser.id), ...currentUser });

  const settings = {
    ...DEFAULT_SETTINGS,
    ...getRemoteAppSettings(context.profile),
    approvedCourts: approvedCourtRows.map(fromRemoteApprovedCourt),
    courtRequests: courtRequestRows.map(fromRemoteCourtRequest),
    courtReviews: courtReviewRows.map(fromRemoteCourtReview),
    refereeRequests: refereeRequestPage.rows.map((row) => {
      const request = fromRemotePayloadRow(row);
      return { ...request, userId: request.userId ?? request.requestedBy ?? row.requested_by };
    }),
    adminAppointments: adminAppointmentPage.rows.map(fromRemotePayloadRow),
    refereeAppointments: refereeAppointmentPage.rows.map(fromRemotePayloadRow),
    adminDisciplinaryActions: disciplinaryPage.rows.map(fromRemotePayloadRow),
  };
  const state = normalizeState({
    currentUserId: currentUser.id,
    users: [...userById.values()],
    teams: teamRows.filter((row) => !row.deleted_at).map((row) => ({ ...fromRemoteTeam(row, []), membersPartial: true })),
    affiliations: affiliationRows.map(fromRemoteAffiliation),
    matches: toAdminMatchState(matchRows, matchPlayerRows, teamRows),
    reports: reportRows.map(fromRemoteReport),
    settings,
  }, { includeDemo: false });
  const sourcePages = [reportPage, courtRequestPage, issueMatchPage, disciplinaryPage, adminAppointmentPage, refereeAppointmentPage, refereeRequestPage];
  const total = sourcePages.reduce((sum, page) => sum + Number(page.total ?? 0), 0);
  const hasMore = sourcePages.some((page) => page.hasMore);
  const sectionCount = section === "appointments" && queueMode === "pending"
    ? refereeRequestPage.total + pendingAppointmentCount
    : total;

  return {
    state,
    adminContext: {
      profileId: context.profileId,
      adminLevel,
      adminGrade: adminLevel >= 100 ? "owner" : adminLevel >= 80 ? "senior" : adminLevel >= 60 ? "regionManager" : adminLevel >= 50 ? "matchManager" : "support",
    },
    page: {
      scope: "admin",
      section,
      queueMode,
      filter,
      limit: pageRequest.limit,
      sourceLimit: sourcePageRequest.limit,
      offset: pageRequest.offset,
      nextOffset: hasMore ? pageRequest.offset + sourcePageRequest.limit : null,
      hasMore,
      total,
      counts: { [section]: sectionCount },
    },
    updatedAt: getRowsMaxUpdatedAt([
      ...reportRows,
      ...courtRequestRows,
      ...matchRows,
      ...teamRows,
      ...affiliationRows,
      ...appointmentRows,
      ...disciplinaryPage.rows,
    ]),
  };
}

export function applyDirectoryTextFilter(query, columns, filter) {
  if (!filter) return query;
  return query.or(columns.map((column) => `${column}.ilike.%${filter}%`).join(","));
}
