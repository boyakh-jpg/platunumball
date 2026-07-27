import { getAuthenticatedContext, readJsonBody, sendJson } from "./_supabaseAdmin.js";
import {
  AFFILIATION_COLUMNS,
  COURT_REVIEW_COLUMNS,
  MAP_COURT_COLUMNS,
  PROFILE_CARD_COLUMNS as PROFILE_COLUMNS,
  SEARCH_COURT_COLUMNS as COURT_COLUMNS,
  TEAM_COLUMNS,
  TEAM_MEMBER_COLUMNS,
} from "../../src/data/repositoryColumns.js";
import { DEFAULT_RATING, isRefereeGrade } from "../../src/lib/constants.js";
import { COURT_MAP_SEARCH_LIMIT, COURT_MAP_SEARCH_PURPOSE } from "../../src/lib/queryPolicy.js";
import { fromRemoteApprovedCourt } from "../../src/data/remotePayloadMappers.js";

const REFEREE_APPOINTMENT_COLUMNS = "user_id,role,grade,status,starts_at,ends_at";
const TYPE_ALIASES = {
  all: ["profile", "team", "court", "referee"],
  player: ["profile"],
  profile: ["profile"],
  team: ["team"],
  court: ["court"],
  court_request: ["court_request"],
  court_review: ["court_review"],
  referee: ["referee"],
  affiliation: ["affiliation"],
  organization: ["affiliation"],
};

function normalizeSearchQuery(value = "") {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 48);
}

function stripHash(value = "") {
  return normalizeSearchQuery(value).replace(/^#+/, "");
}

function sanitizeIlike(value = "") {
  return normalizeSearchQuery(value).replace(/[,%()*"']/g, " ").replace(/\s+/g, " ").trim();
}

function getQueryMinLength(query = "") {
  const text = normalizeSearchQuery(query).replace(/\s+/g, "");
  if (!text) return 2;
  if (text.startsWith("#")) return 2;
  if (/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(text)) return 2;
  return 4;
}

function getRequestedTypes(value = "all") {
  const rawTypes = Array.isArray(value) ? value : [value];
  const expanded = rawTypes.flatMap((type) => TYPE_ALIASES[String(type || "").trim()] ?? []);
  return [...new Set(expanded.length ? expanded : TYPE_ALIASES.all)];
}

function clampLimit(value, max = 25) {
  const limit = Number(value);
  if (!Number.isFinite(limit)) return 10;
  return Math.min(Math.max(Math.floor(limit), 1), max);
}

function searchFilter(fields = [], query = "") {
  const raw = sanitizeIlike(query);
  const plain = sanitizeIlike(stripHash(query));
  const values = [...new Set([raw, plain, plain ? `#${plain}` : ""].filter(Boolean))];
  return fields
    .flatMap((field) => values.map((value) => `${field}.ilike.%${value}%`))
    .join(",");
}

function normalizeFuzzyText(value = "") {
  return normalizeSearchQuery(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}#]+/gu, "");
}

function isWithinOneEdit(source = "", target = "") {
  if (source === target) return true;
  if (!source || !target || Math.abs(source.length - target.length) > 1) return false;

  let sourceIndex = 0;
  let targetIndex = 0;
  let edits = 0;
  while (sourceIndex < source.length && targetIndex < target.length) {
    if (source[sourceIndex] === target[targetIndex]) {
      sourceIndex += 1;
      targetIndex += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (source.length > target.length) sourceIndex += 1;
    else if (target.length > source.length) targetIndex += 1;
    else {
      sourceIndex += 1;
      targetIndex += 1;
    }
  }
  return edits + Number(sourceIndex < source.length || targetIndex < target.length) <= 1;
}

export function isCourtFuzzyMatch(row = {}, query = "") {
  const normalizedQuery = normalizeFuzzyText(stripHash(query));
  if (normalizedQuery.length < 2) return false;
  const tokens = [
    row.name,
    row.hashtag,
    row.address_text,
    row.road_address,
    row.jibun_address,
    row.facility_name,
    row.sido,
    row.sigungu,
    row.emd,
  ]
    .flatMap((value) => normalizeSearchQuery(value).split(" "))
    .map(normalizeFuzzyText)
    .filter(Boolean);

  return tokens.some((token) => {
    if (token.includes(normalizedQuery)) return true;
    if (token.length < normalizedQuery.length) return isWithinOneEdit(token, normalizedQuery);
    for (let index = 0; index <= token.length - normalizedQuery.length; index += 1) {
      if (isWithinOneEdit(token.slice(index, index + normalizedQuery.length), normalizedQuery)) return true;
    }
    return false;
  });
}

function activeTerm(row = {}, nowMs = Date.now()) {
  const startsAt = row.starts_at ? new Date(row.starts_at).getTime() : 0;
  const endsAt = row.ends_at ? new Date(row.ends_at).getTime() : 0;
  return (!startsAt || startsAt <= nowMs) && (!endsAt || endsAt >= nowMs);
}

function isActiveRefereeAppointment(row = {}, throughMs = Date.now()) {
  const status = row.status || "active";
  const role = row.role || "referee";
  const endsAt = row.ends_at ? new Date(row.ends_at).getTime() : Infinity;
  return role === "referee"
    && status === "active"
    && isRefereeGrade(row.grade)
    && activeTerm(row)
    && (!Number.isFinite(throughMs) || endsAt >= throughMs);
}

function getPayload(row = {}) {
  return row.payload && typeof row.payload === "object" && !Array.isArray(row.payload) ? row.payload : {};
}

function toProfile(row = {}, kind = "profile", extra = {}) {
  return {
    kind,
    id: row.id,
    name: row.name,
    handle: row.handle,
    hashtag: row.hashtag,
    position: row.position,
    region: row.region,
    trustScore: row.trust_score ?? 0,
    avatarColor: row.avatar_color,
    avatarKey: row.avatar_key ?? null,
    avatarSource: row.avatar_source ?? "initial",
    avatarIconKey: row.avatar_icon_key ?? null,
    avatarUpdatedAt: row.avatar_updated_at ?? null,
    avatarBackgroundEnabled: row.avatar_background_enabled !== false,
    avatarBorderEnabled: row.avatar_border_enabled === true,
    avatarBorderColor: row.avatar_border_color ?? row.avatar_color,
    discordAvatarUrl: row.discord_avatar_url ?? null,
    ratings: row.ratings ?? {},
    ageGroup: row.age_group,
    searchText: [row.name, row.hashtag, row.handle, row.region, row.position].filter(Boolean).join(" "),
    ...extra,
  };
}

function toTeam(row = {}, memberRows = []) {
  return {
    kind: "team",
    id: row.id,
    name: row.name,
    homeCourt: row.home_court,
    region: row.region,
    mmr: row.mmr ?? DEFAULT_RATING,
    wins: row.wins ?? 0,
    losses: row.losses ?? 0,
    accent: row.accent,
    emblemKey: row.emblem_key ?? null,
    emblemSource: row.emblem_source ?? (row.emblem_key ? "upload" : "initial"),
    emblemUpdatedAt: row.emblem_updated_at ?? null,
    emblemUploadedAt: row.emblem_uploaded_at ?? null,
    emblemUploadCount: Number(row.emblem_upload_count ?? 0),
    emblemColor: row.emblem_color ?? row.accent ?? null,
    emblemBorderEnabled: row.emblem_border_enabled !== false,
    emblemBorderColor: row.emblem_border_color ?? row.accent ?? null,
    emblemTextMode: new Set(["name", "abbreviation"]).has(row.emblem_text_mode) ? row.emblem_text_mode : "initial",
    emblemAbbreviation: row.emblem_abbreviation ?? "",
    emblemFont: row.emblem_font ?? "sport",
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? row.created_at ?? null,
    members: memberRows.map((member) => ({ userId: member.user_id, role: member.role ?? "regular" })),
    searchText: [row.name, row.region, row.home_court, row.id].filter(Boolean).join(" "),
  };
}

function toCourt(row = {}) {
  const court = fromRemoteApprovedCourt(row);
  return {
    ...court,
    kind: "court",
    searchText: [court.name, court.hashtag, court.addressText, court.region, court.type].filter(Boolean).join(" "),
  };
}

function toCourtRequest(row = {}) {
  return {
    kind: "court_request",
    id: row.id,
    requestedBy: row.requested_by,
    status: row.status ?? "pending",
    name: row.name,
    hashtag: row.hashtag ?? null,
    addressText: row.address_text ?? "",
    roadAddress: row.road_address ?? null,
    jibunAddress: row.jibun_address ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? row.created_at ?? null,
    searchText: [row.name, row.hashtag, row.address_text, row.road_address, row.jibun_address].filter(Boolean).join(" "),
  };
}

function toCourtReview(row = {}) {
  const payload = getPayload(row);
  return {
    ...payload,
    kind: "court_review",
    id: row.id,
    courtId: row.court_id,
    courtName: row.court_name,
    matchId: row.match_id,
    reviewerId: row.reviewer_id,
    rating: row.rating,
    tags: row.tags ?? [],
    memo: row.memo ?? "",
    status: row.status ?? "active",
    createdAt: row.created_at ?? null,
    searchText: [row.court_name, row.memo, ...(row.tags ?? [])].filter(Boolean).join(" "),
  };
}

function getContextTeamId(context = {}) {
  const value = String(context?.teamId ?? "").trim();
  return value.length <= 80 ? value : "";
}

async function getTeamMemberIds(supabase, teamId) {
  if (!teamId) return [];
  const { data, error } = await supabase
    .from("team_members")
    .select("user_id")
    .eq("team_id", teamId);
  if (error) throw error;
  return [...new Set((data ?? []).map((row) => row.user_id).filter(Boolean))];
}

async function searchProfiles(supabase, query, limit, searchContext = {}) {
  const teamId = getContextTeamId(searchContext);
  const teamMemberIds = teamId ? await getTeamMemberIds(supabase, teamId) : [];
  if (teamId && !teamMemberIds.length) return [];
  let request = supabase
    .from("public_profiles")
    .select(PROFILE_COLUMNS)
    .or(searchFilter(["name", "hashtag", "handle", "region", "position"], query));
  if (teamId) request = request.in("id", teamMemberIds);
  const { data, error } = await request
    .order("trust_score", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row) => toProfile(row, "profile", teamId ? { teamIds: [teamId] } : {}));
}

async function searchTeams(supabase, query, limit) {
  const { data, error } = await supabase
    .from("teams")
    .select(TEAM_COLUMNS)
    .is("deleted_at", null)
    .or(searchFilter(["name", "home_court", "region", "id"], query))
    .order("mmr", { ascending: false })
    .limit(limit);
  if (error) throw error;
  const teamRows = data ?? [];
  const teamIds = teamRows.map((team) => team.id).filter(Boolean);
  const { data: memberRows, error: memberError } = teamIds.length
    ? await supabase.from("team_members").select(TEAM_MEMBER_COLUMNS).in("team_id", teamIds)
    : { data: [], error: null };
  if (memberError) throw memberError;
  const membersByTeam = (memberRows ?? []).reduce((map, member) => {
    const list = map.get(member.team_id) ?? [];
    list.push(member);
    map.set(member.team_id, list);
    return map;
  }, new Map());
  return teamRows.map((team) => toTeam(team, membersByTeam.get(team.id) ?? []));
}

async function searchCourts(supabase, query, limit, searchContext = {}) {
  const courtMapSearch = searchContext.purpose === COURT_MAP_SEARCH_PURPOSE;
  const fields = courtMapSearch
    ? ["sigungu", "region_key", "address_text", "road_address", "jibun_address"]
    : ["name", "hashtag", "facility_name", "sigungu", "address_text", "road_address", "jibun_address"];
  let request = supabase
    .from("approved_courts")
    .select(courtMapSearch ? MAP_COURT_COLUMNS : COURT_COLUMNS)
    .eq("status", "active");
  if (courtMapSearch) request = request.not("lat", "is", null).not("lng", "is", null);
  const { data, error } = await request
    .or(searchFilter(fields, query))
    .order("updated_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw error;
  if ((data ?? []).length || courtMapSearch) return (data ?? []).map(toCourt);

  const fallbackQuery = normalizeFuzzyText(stripHash(query)).slice(0, 1);
  if (!fallbackQuery) return [];
  const { data: fallbackData, error: fallbackError } = await supabase
    .from("approved_courts")
    .select(COURT_COLUMNS)
    .eq("status", "active")
    .or(searchFilter(["name", "facility_name", "sigungu", "address_text", "road_address", "jibun_address"], fallbackQuery))
    .order("updated_at", { ascending: false, nullsFirst: false })
    .limit(Math.min(100, Math.max(25, limit * 5)));
  if (fallbackError) throw fallbackError;
  return (fallbackData ?? []).filter((row) => isCourtFuzzyMatch(row, query)).slice(0, limit).map(toCourt);
}

async function searchCourtRequests(supabase, profileId, query, limit) {
  if (!profileId) return [];
  const { data, error } = await supabase
    .from("court_requests")
    .select("id,requested_by,status,name,hashtag,address_text,road_address,jibun_address,created_at,updated_at")
    .in("status", ["pending", "reported"])
    .neq("requested_by", profileId)
    .or(searchFilter(["name", "hashtag", "address_text", "road_address", "jibun_address"], query))
    .order("updated_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map(toCourtRequest);
}

async function searchCourtReviews(supabase, profileId, query, limit) {
  let request = supabase
    .from("court_reviews")
    .select(COURT_REVIEW_COLUMNS)
    .eq("status", "active")
    .or(searchFilter(["court_name", "memo"], query))
    .order("created_at", { ascending: false })
    .limit(limit);
  if (profileId) request = request.neq("reviewer_id", profileId);
  const { data, error } = await request;
  if (error) throw error;
  return (data ?? []).map(toCourtReview);
}

async function searchReferees(supabase, query, limit, searchContext = {}) {
  const throughText = String(searchContext.refereeThroughDate ?? "").slice(0, 10);
  const throughMs = throughText ? new Date(`${throughText}T23:59:59.999Z`).getTime() : Date.now();
  const { data, error } = await supabase
    .from("public_profiles")
    .select(PROFILE_COLUMNS)
    .gte("trust_score", 90)
    .or(searchFilter(["name", "hashtag", "handle", "region", "position"], query))
    .order("trust_score", { ascending: false })
    .limit(limit * 3);
  if (error) throw error;
  const profileRows = data ?? [];
  const profileIds = profileRows.map((profile) => profile.id).filter(Boolean);
  const { data: appointmentRows, error: appointmentError } = profileIds.length
    ? await supabase.from("referee_appointments").select(REFEREE_APPOINTMENT_COLUMNS).in("user_id", profileIds)
    : { data: [], error: null };
  if (appointmentError) throw appointmentError;
  const appointmentByUserId = new Map();
  (appointmentRows ?? []).filter((appointment) => isActiveRefereeAppointment(appointment, throughMs)).forEach((appointment) => {
    if (!appointmentByUserId.has(appointment.user_id)) appointmentByUserId.set(appointment.user_id, appointment);
  });
  return profileRows
    .filter((profile) => appointmentByUserId.has(profile.id))
    .slice(0, limit)
    .map((row) => {
      const appointment = appointmentByUserId.get(row.id);
      return toProfile(row, "referee", {
        refereeGrade: appointment.grade,
        refereeProfile: {
          grade: appointment.grade,
          status: appointment.status,
          startsAt: appointment.starts_at,
          endsAt: appointment.ends_at,
        },
      });
    });
}

async function searchAffiliations(supabase, query, limit) {
  const { data, error } = await supabase
    .from("affiliations")
    .select(AFFILIATION_COLUMNS)
    .eq("type", "organization")
    .eq("status", "active")
    .or(searchFilter(["name"], query))
    .order("member_count", { ascending: false })
    .order("name", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    kind: "affiliation",
    id: row.id,
    type: row.type,
    name: row.name,
    label: row.name,
    memberCount: Number(row.member_count ?? 0),
    status: row.status ?? "active",
    searchText: `${row.name} ${row.member_count ?? 0}명`,
  }));
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const query = normalizeSearchQuery(body.query ?? body.q ?? "");
    const minLength = getQueryMinLength(query);
    const forceSearch = body.force === true;
    const queryLength = query.replace(/\s+/g, "").length;
    if ((!forceSearch && queryLength < minLength) || (forceSearch && queryLength < 1)) {
      sendJson(response, 200, { ok: true, items: [] });
      return;
    }

    const types = getRequestedTypes(body.type ?? body.types ?? "all");
    const searchContext = body.context && typeof body.context === "object" ? body.context : {};
    const courtMapSearch = types.length === 1 && types[0] === "court" && searchContext.purpose === COURT_MAP_SEARCH_PURPOSE;
    const limit = clampLimit(body.limit, courtMapSearch ? COURT_MAP_SEARCH_LIMIT : 25);
    const context = await getAuthenticatedContext(request, { allowMissingProfile: true });
    const loaders = {
      profile: () => searchProfiles(context.supabase, query, limit, searchContext),
      team: () => searchTeams(context.supabase, query, limit),
      court: () => searchCourts(context.supabase, query, limit, searchContext),
      court_request: () => searchCourtRequests(context.supabase, context.profileId, query, limit),
      court_review: () => searchCourtReviews(context.supabase, context.profileId, query, limit),
      referee: () => searchReferees(context.supabase, query, limit, searchContext),
      affiliation: () => searchAffiliations(context.supabase, query, limit),
    };
    const chunks = await Promise.all(types.map((type) => loaders[type]?.() ?? []));
    const seen = new Set();
    const items = chunks.flat().filter((item) => {
      const key = `${item.kind}:${item.id}`;
      if (!item.id || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, limit);
    sendJson(response, 200, { ok: true, items });
  } catch (error) {
    console.warn("Search failed.", error.message);
    sendJson(response, error.statusCode || 500, { error: "search_failed" });
  }
}
