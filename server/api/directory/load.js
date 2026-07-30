import {
  allowRequestMethod,
  getAdminLevel,
  getAuthenticatedContext,
  getRowsMaxUpdatedAt,
  groupRowsBy,
  readJsonBody,
  requireAdminContext,
  sendJson,
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
  FAVORITE_COLUMNS,
  MATCH_LIST_COLUMNS,
  MATCH_PLAYER_COLUMNS,
  PROFILE_ME_COLUMNS,
  PUBLIC_PROFILE_COLUMNS,
  REFEREE_EXAM_ATTEMPT_COLUMNS,
  REFEREE_REQUEST_COLUMNS,
  REPORT_COLUMNS,
  TEAM_COLUMNS,
  TEAM_INVITATION_COLUMNS,
  TEAM_MEMBER_COLUMNS,
} from "../../../shared/lib/repositoryColumns.js";
import { DEFAULT_SETTINGS } from "../../../shared/lib/repositoryDefaults.js";
import { fromRemoteTeam, fromRemoteTeamInvitation } from "../../../shared/lib/teamMappers.js";
import {
  DIRECTORY_ID_BATCH_SIZE,
  getDirectoryPageRequest,
  normalizeAdminQueueMode,
  normalizeAdminSection,
  normalizeDirectoryFilter,
  normalizeDirectoryKind,
} from "../../../shared/lib/queryPolicy.js";

const PROFILE_PRIVACY_KEYS = ["regionRanking", "teamHistory", "statSummary"];
const ADMIN_REPORT_TYPES = {
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

function uniqueRows(rows = []) {
  const byId = new Map();
  rows.flat().forEach((row) => {
    if (row?.id) byId.set(row.id, row);
  });
  return [...byId.values()];
}

async function readRows(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

async function readPage(query, { limit, offset }, label, optional = false) {
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

async function readRowsByIds(supabase, table, columns, column, ids, { optional = false } = {}) {
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

function getCurrentUser(context) {
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

function collectReportProfileIds(reports = []) {
  return uniqueValues(reports.flatMap((report) => [
    report.user_id,
    ...(report.type === "player" ? [report.target_id] : []),
    ...(Array.isArray(report.reported_user_ids) ? report.reported_user_ids : []),
  ]));
}

function toAdminMatchState(matchRows = [], matchPlayerRows = [], teamRows = []) {
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

async function loadAdminSection(context, body = {}) {
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
    [adminAppointmentPage, refereeAppointmentPage, refereeRequestPage] = await Promise.all([
      readPage(appointmentQuery("admin_appointments"), sourcePageRequest, "admin_appointments"),
      readPage(appointmentQuery("referee_appointments"), sourcePageRequest, "referee_appointments"),
      readPage(refereeRequestQuery, sourcePageRequest, "referee_requests"),
    ]);
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
    ? refereeRequestPage.total + [...adminAppointmentPage.rows, ...refereeAppointmentPage.rows].filter((row) => row.status === "pending").length
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

export function toPublicProfilePrivacy(appSettings = {}) {
  const privacy = appSettings?.privacy && typeof appSettings.privacy === "object" && !Array.isArray(appSettings.privacy)
    ? appSettings.privacy
    : {};
  return Object.fromEntries(PROFILE_PRIVACY_KEYS.map((key) => [key, privacy[key] !== false]));
}

export function mapDirectoryProfilePrivacy(users = [], profileRows = [], currentProfileId = "", currentPrivacy = {}) {
  const profileById = new Map(profileRows.filter((row) => row?.id).map((row) => [row.id, row]));
  return users.map((user) => {
    const {
      app_settings: _appSettings,
      appSettings: _appSettingsCamel,
      privacy: _privacy,
      ...publicUser
    } = user;
    const profile = profileById.get(user.id);
    const privacy = profile
      ? toPublicProfilePrivacy(profile.app_settings)
      : user.id === currentProfileId
        ? toPublicProfilePrivacy({ privacy: currentPrivacy })
        : Object.fromEntries(PROFILE_PRIVACY_KEYS.map((key) => [key, false]));
    const representativeTeamId = privacy.teamHistory && typeof profile?.app_settings?.representativeTeamId === "string"
      ? profile.app_settings.representativeTeamId.trim()
      : "";
    return { ...publicUser, privacy, ...(representativeTeamId ? { representativeTeamId } : {}) };
  });
}

export function canLoadProfileTeamHistory(profileId = "", currentProfileId = "", profileRows = []) {
  if (!profileId) return false;
  if (profileId === currentProfileId) return true;
  const profile = profileRows.find((row) => row?.id === profileId);
  return Boolean(profile && toPublicProfilePrivacy(profile.app_settings).teamHistory);
}

function applyDirectoryTextFilter(query, columns, filter) {
  if (!filter) return query;
  return query.or(columns.map((column) => `${column}.ilike.%${filter}%`).join(","));
}

async function loadDirectoryPage(context, body = {}) {
  const filter = normalizeFilter(body.filter ?? body.query ?? body.q);
  const region = normalizeFilter(body.region);
  const profileId = String(body.profileId ?? "").trim();
  const kind = normalizeDirectoryKind(body.kind, "all");
  const pageRequest = getPageRequest(body, { kind });
  const includeSelfDetails = kind === "self";
  const includeTeamMemberProfiles = body.includeTeamMemberProfiles === true;
  const placementCompleteOnly = body.placementCompleteOnly === true;
  const currentUser = getCurrentUser(context);
  const currentProfileId = context.profileId ?? currentUser.id;

  if (kind === "affiliations") {
    let query = context.supabase
      .from("affiliations")
      .select(AFFILIATION_COLUMNS, { count: "exact" })
      .eq("status", "active")
      .order("score", { ascending: false, nullsFirst: false })
      .order("id", { ascending: true });
    query = applyDirectoryTextFilter(query, ["name", "type"], filter);
    const affiliationPage = await readPage(query, pageRequest, "affiliations");
    return {
      state: normalizeState({
        currentUserId: currentUser.id,
        users: [currentUser],
        affiliations: affiliationPage.rows.map(fromRemoteAffiliation),
      }, { includeDemo: false }),
      page: {
        scope: "directory",
        kind,
        filter,
        region: "",
        profileId: "",
        limit: pageRequest.limit,
        offset: pageRequest.offset,
        nextOffset: affiliationPage.hasMore ? pageRequest.offset + pageRequest.limit : null,
        hasMore: affiliationPage.hasMore,
        affiliations: { total: affiliationPage.total, hasMore: affiliationPage.hasMore },
      },
      updatedAt: getRowsMaxUpdatedAt(affiliationPage.rows),
    };
  }

  const [favoriteRows, invitationRows, ownMembershipRows, targetProfileSettingRows] = await Promise.all([
    currentProfileId
      ? readRows(context.supabase.from("favorites").select(FAVORITE_COLUMNS).eq("user_id", currentProfileId))
      : [],
    currentProfileId
      ? readRows(
        context.supabase
          .from("team_invitations")
          .select(TEAM_INVITATION_COLUMNS)
          .or(`from_user_id.eq.${currentProfileId},target_user_id.eq.${currentProfileId}`)
          .order("created_at", { ascending: false }),
      )
      : [],
    currentProfileId
      ? readRows(context.supabase.from("team_members").select(TEAM_MEMBER_COLUMNS).eq("user_id", currentProfileId))
      : [],
    profileId
      ? profileId === currentProfileId && context.profile
        ? [{ id: currentProfileId, app_settings: context.profile.app_settings ?? {} }]
        : readRowsByIds(context.supabase, "profiles", "id,app_settings", "id", [profileId])
      : [],
  ]);

  let profilePage = { rows: [], total: 0, hasMore: false };
  if (["all", "players"].includes(kind)) {
    let query = context.supabase
      .from("public_profiles")
      .select(PUBLIC_PROFILE_COLUMNS, { count: "exact" })
      .order("trust_score", { ascending: false, nullsFirst: false })
      .order("id", { ascending: true });
    if (profileId) query = query.eq("id", profileId);
    else {
      if (region) query = query.eq("region", region);
      if (placementCompleteOnly) query = query.gte("placement_match_count", 5);
      query = applyDirectoryTextFilter(query, ["name", "hashtag", "handle", "region", "position"], filter);
    }
    profilePage = await readPage(query, profileId ? { limit: 1, offset: 0 } : pageRequest, "public_profiles");
  }

  let profileMembershipRows = [];
  if (
    profilePage.rows.some((row) => row.id === profileId)
    && canLoadProfileTeamHistory(profileId, currentProfileId, targetProfileSettingRows)
  ) {
    profileMembershipRows = profileId === currentProfileId
      ? ownMembershipRows
      : await readRows(context.supabase.from("team_members").select(TEAM_MEMBER_COLUMNS).eq("user_id", profileId));
  }

  let teamPage = { rows: [], total: 0, hasMore: false };
  if (["all", "teams"].includes(kind) && !profileId) {
    let query = context.supabase
      .from("teams")
      .select(TEAM_COLUMNS, { count: "exact" })
      .is("deleted_at", null)
      .order("mmr", { ascending: false, nullsFirst: false })
      .order("id", { ascending: true });
    if (region) query = query.eq("region", region);
    query = applyDirectoryTextFilter(query, ["name", "home_court", "region"], filter);
    teamPage = await readPage(query, pageRequest, "teams");
  }

  const favoriteProfileIds = favoriteRows
    .filter((row) => row.target_type === "player" || row.target_type === "referee")
    .map((row) => row.target_id);
  const favoriteTeamIds = favoriteRows.filter((row) => row.target_type === "team").map((row) => row.target_id);
  const favoriteCourtIds = favoriteRows.filter((row) => row.target_type === "court").map((row) => row.target_id);
  const invitationTeamIds = invitationRows.map((row) => row.team_id);
  const scopedTeamIds = uniqueValues([
    ...teamPage.rows.map((row) => row.id),
    ...favoriteTeamIds,
    ...invitationTeamIds,
    ...ownMembershipRows.map((row) => row.team_id),
    ...profileMembershipRows.map((row) => row.team_id),
  ]);
  const extraTeamIds = scopedTeamIds.filter((id) => !teamPage.rows.some((row) => row.id === id));
  const [extraTeamRows, teamMemberRows] = await Promise.all([
    readRowsByIds(context.supabase, "teams", TEAM_COLUMNS, "id", extraTeamIds),
    readRowsByIds(context.supabase, "team_members", TEAM_MEMBER_COLUMNS, "team_id", scopedTeamIds),
  ]);
  const teamRows = uniqueRows([teamPage.rows, extraTeamRows]).filter((row) => !row.deleted_at);
  const memberProfileIds = teamMemberRows
    .filter((row) => includeTeamMemberProfiles || row.role === "captain" || row.user_id === currentProfileId)
    .map((row) => row.user_id);
  const invitationProfileIds = invitationRows.flatMap((row) => [row.from_user_id, row.target_user_id]);
  const scopedProfileIds = uniqueValues([
    ...profilePage.rows.map((row) => row.id),
    ...favoriteProfileIds,
    ...memberProfileIds,
    ...invitationProfileIds,
    currentProfileId,
  ]);
  const extraProfileIds = scopedProfileIds.filter((id) => !profilePage.rows.some((row) => row.id === id));
  const knownPrivacyProfileIds = new Set(targetProfileSettingRows.map((row) => row.id));
  const remainingPrivacyProfileIds = scopedProfileIds.filter((id) => !knownPrivacyProfileIds.has(id));
  const [extraPublicProfileRows, extraPrivacyRows] = await Promise.all([
    readRowsByIds(context.supabase, "public_profiles", PUBLIC_PROFILE_COLUMNS, "id", extraProfileIds),
    readRowsByIds(context.supabase, "profiles", "id,app_settings", "id", remainingPrivacyProfileIds),
  ]);
  const privacyRows = uniqueRows([targetProfileSettingRows, extraPrivacyRows]);
  const publicProfileRows = uniqueRows([profilePage.rows, extraPublicProfileRows]);
  const publicUsers = mapDirectoryProfilePrivacy(
    publicProfileRows.map(fromRemoteProfile),
    privacyRows,
    currentProfileId,
    getRemoteAppSettings(context.profile).privacy,
  );
  const userById = new Map(publicUsers.map((user) => [user.id, user]));
  userById.set(currentUser.id, { ...userById.get(currentUser.id), ...currentUser });

  const [selfReports, courtRequests, favoriteCourts, reportableCourts, ownCourtReviews, reportableCourtReviews, refereeRequests, refereeExamAttempts, adminAppointments, refereeAppointments, disciplinaryActions, affiliations] = await Promise.all([
    includeSelfDetails && currentProfileId ? readRows(context.supabase.from("reports").select(REPORT_COLUMNS).eq("user_id", currentProfileId).order("created_at", { ascending: false }).limit(pageRequest.limit)) : [],
    includeSelfDetails && currentProfileId ? readRows(context.supabase.from("court_requests").select(COURT_REQUEST_COLUMNS).eq("requested_by", currentProfileId).order("created_at", { ascending: false }).limit(pageRequest.limit)) : [],
    includeSelfDetails ? readRowsByIds(context.supabase, "approved_courts", APPROVED_COURT_COLUMNS, "id", favoriteCourtIds) : [],
    includeSelfDetails ? readRows(context.supabase.from("approved_courts").select(APPROVED_COURT_COLUMNS).eq("status", "active").order("updated_at", { ascending: false }).limit(pageRequest.limit)) : [],
    includeSelfDetails && currentProfileId ? readRows(context.supabase.from("court_reviews").select(COURT_REVIEW_COLUMNS).eq("reviewer_id", currentProfileId).order("created_at", { ascending: false }).limit(pageRequest.limit)) : [],
    includeSelfDetails && currentProfileId ? readRows(context.supabase.from("court_reviews").select(COURT_REVIEW_COLUMNS).eq("status", "active").neq("reviewer_id", currentProfileId).order("created_at", { ascending: false }).limit(pageRequest.limit)) : [],
    includeSelfDetails && currentProfileId ? readRows(context.supabase.from("referee_requests").select(REFEREE_REQUEST_COLUMNS).eq("requested_by", currentProfileId).order("created_at", { ascending: false }).limit(pageRequest.limit)) : [],
    includeSelfDetails && currentProfileId ? readRows(context.supabase.from("referee_exam_attempts").select(REFEREE_EXAM_ATTEMPT_COLUMNS).eq("user_id", currentProfileId).order("created_at", { ascending: false }).limit(pageRequest.limit)) : [],
    includeSelfDetails && currentProfileId ? readRows(context.supabase.from("admin_appointments").select(APPOINTMENT_COLUMNS).eq("user_id", currentProfileId).order("created_at", { ascending: false }).limit(pageRequest.limit)) : [],
    includeSelfDetails && currentProfileId ? readRows(context.supabase.from("referee_appointments").select(APPOINTMENT_COLUMNS).eq("user_id", currentProfileId).order("created_at", { ascending: false }).limit(pageRequest.limit)) : [],
    includeSelfDetails && currentProfileId ? readRows(context.supabase.from("admin_disciplinary_actions").select(ADMIN_DISCIPLINARY_COLUMNS).eq("user_id", currentProfileId).order("created_at", { ascending: false }).limit(pageRequest.limit)) : [],
    kind === "all" && !profileId
      ? readRows(context.supabase.from("affiliations").select(AFFILIATION_COLUMNS).eq("status", "active").order("score", { ascending: false }).limit(pageRequest.limit))
      : [],
  ]);

  const favoriteByType = (type) => favoriteRows.filter((row) => row.target_type === type).map((row) => row.target_id);
  const membersByTeam = groupRowsBy(teamMemberRows, "team_id");
  const state = normalizeState({
    currentUserId: currentUser.id,
    users: [...userById.values()],
    teams: teamRows.map((row) => fromRemoteTeam(row, membersByTeam.get(row.id) ?? [])),
    teamInvitations: invitationRows.map(fromRemoteTeamInvitation),
    affiliations: affiliations.map(fromRemoteAffiliation),
    reports: selfReports.map(fromRemoteReport),
    settings: {
      ...DEFAULT_SETTINGS,
      ...getRemoteAppSettings(context.profile),
      favoritePlayerIds: favoriteByType("player"),
      favoriteTeamIds: favoriteByType("team"),
      favoriteCourtIds: favoriteByType("court"),
      favoriteRefereeIds: favoriteByType("referee"),
      approvedCourts: uniqueRows([favoriteCourts, reportableCourts]).map(fromRemoteApprovedCourt),
      courtRequests: courtRequests.map(fromRemoteCourtRequest),
      courtReviews: uniqueRows([ownCourtReviews, reportableCourtReviews]).map(fromRemoteCourtReview),
      refereeRequests: refereeRequests.map(fromRemotePayloadRow),
      refereeExamAttempts: refereeExamAttempts.map(fromRemotePayloadRow),
      adminAppointments: adminAppointments.map(fromRemotePayloadRow),
      refereeAppointments: refereeAppointments.map(fromRemotePayloadRow),
      adminDisciplinaryActions: disciplinaryActions.map(fromRemotePayloadRow),
    },
  }, { includeDemo: false });
  const hasMore = profilePage.hasMore || teamPage.hasMore;

  return {
    state,
    page: {
      scope: "directory",
      kind,
      filter,
      region,
      profileId,
      includeTeamMemberProfiles,
      placementCompleteOnly,
      limit: pageRequest.limit,
      offset: pageRequest.offset,
      nextOffset: hasMore ? pageRequest.offset + pageRequest.limit : null,
      hasMore,
      players: { total: profilePage.total, hasMore: profilePage.hasMore },
      teams: { total: teamPage.total, hasMore: teamPage.hasMore },
    },
    updatedAt: getRowsMaxUpdatedAt([
      ...publicProfileRows,
      ...teamRows,
      ...teamMemberRows,
      ...selfReports,
      ...courtRequests,
      ...ownCourtReviews,
      ...reportableCourtReviews,
    ]),
  };
}

export default async function handler(request, response) {
  if (!allowRequestMethod(request, response)) return;

  try {
    const body = await readJsonBody(request);
    const context = body.scope === "admin"
      ? await requireAdminContext(request, { profileSelect: PROFILE_ME_COLUMNS })
      : await getAuthenticatedContext(request, { allowMissingProfile: true, profileSelect: PROFILE_ME_COLUMNS });
    const result = body.scope === "admin"
      ? await loadAdminSection(context, body)
      : await loadDirectoryPage(context, body);
    sendJson(response, 200, { ok: true, ...result });
  } catch (error) {
    sendJson(response, error.statusCode || 500, { error: error.message || "directory_load_failed" });
  }
}
