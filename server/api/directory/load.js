import {
  allowRequestMethod,
  getAuthenticatedContext,
  getBearerToken,
  getRowsMaxUpdatedAt,
  getSupabaseAdminClient,
  groupRowsBy,
  readJsonBody,
  requireAdminContext,
  sendJson,
  uniqueValues,
} from "../_supabaseAdmin.js";
import { fromRemoteAffiliation } from "../../../shared/lib/affiliationMappers.js";
import { fromRemoteProfile, getRemoteAppSettings } from "../../../shared/lib/profileMappers.js";
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
  normalizeDirectoryKind,
  normalizeDirectoryRankingSort,
} from "../../../shared/lib/queryPolicy.js";
import {
  getPageRequest,
  normalizeFilter,
  uniqueRows,
  readRows,
  readPage,
  readRowsByIds,
  getCurrentUser,
  loadAdminSection,
  applyDirectoryTextFilter,
} from "./loadAdminSection.js";
export { getPageRequest, normalizeFilter, getAdminSection, getQueueMode } from "./loadAdminSection.js";


const PROFILE_PRIVACY_KEYS = ["regionRanking", "teamHistory", "statSummary", "communityPosts", "communityComments"];


























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



async function loadDirectoryPage(context, body = {}) {
  const filter = normalizeFilter(body.filter ?? body.query ?? body.q);
  const region = normalizeFilter(body.region);
  const profileId = String(body.profileId ?? "").trim();
  const teamId = String(body.teamId ?? "").trim();
  const kind = normalizeDirectoryKind(body.kind, "all");
  const pageRequest = getPageRequest(body, { kind });
  const includeSelfDetails = kind === "self";
  const includeTeamMemberProfiles = body.includeTeamMemberProfiles === true;
  const placementCompleteOnly = body.placementCompleteOnly === true;
  const rankingSort = normalizeDirectoryRankingSort(body.rankingSort);
  const publicRead = context.publicRead === true;
  const currentUser = getCurrentUser(context);
  const currentProfileId = publicRead ? "" : context.profileId ?? currentUser.id;

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
        placementCompleteOnly: false,
        rankingSort: "",
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
    const rankingOrder = rankingSort === "integrated"
      ? "ratings->integrated"
      : rankingSort
        ? `ratings->modes->${rankingSort}`
        : "trust_score";
    let query = context.supabase
      .from("public_profiles")
      .select(PUBLIC_PROFILE_COLUMNS, { count: "exact" })
      .order(rankingOrder, { ascending: false, nullsFirst: false })
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
    if (teamId) query = query.eq("id", teamId);
    else {
      if (region) query = query.eq("region", region);
      query = applyDirectoryTextFilter(query, ["name", "home_court", "region"], filter);
    }
    teamPage = await readPage(query, teamId ? { limit: 1, offset: 0 } : pageRequest, "teams");
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
      rankingSort,
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
    const hasToken = Boolean(getBearerToken(request));
    const context = body.scope === "admin"
      ? await requireAdminContext(request, { profileSelect: PROFILE_ME_COLUMNS })
      : hasToken
        ? await getAuthenticatedContext(request, { allowMissingProfile: true, profileSelect: PROFILE_ME_COLUMNS })
        : { supabase: getSupabaseAdminClient(), authUser: null, authUserId: "", profileId: "", profile: null, publicRead: true };
    if (!hasToken && !["all", "players", "teams", "affiliations"].includes(normalizeDirectoryKind(body.kind, "all"))) {
      sendJson(response, 403, { error: "public_directory_scope_forbidden" });
      return;
    }
    const result = body.scope === "admin"
      ? await loadAdminSection(context, body)
      : await loadDirectoryPage(context, body);
    sendJson(response, 200, { ok: true, ...result });
  } catch (error) {
    sendJson(response, error.statusCode || 500, { error: error.message || "directory_load_failed" });
  }
}
