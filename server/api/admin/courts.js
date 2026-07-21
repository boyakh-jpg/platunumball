import { getAdminLevel, getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";

const PAGE_SIZE = 100;
const MAX_PAGE = 10_000;
const MAX_FILTER_LENGTH = 120;
const COURT_COLUMNS = "name,facility_name,court_unit,indoor_outdoor,venue_type,court_kind,surface_type,court_layout,hoop_count,access_type,reservation_required,paid,lighting,public_access,operational_status,verification_status,sigungu,name_modification_count,registration_origin,status,updated_at,id,hashtag,address_text,lat,lng";
const HISTORY_COLUMNS = "id,court_id,sigungu,previous_name,new_name,facility_name,reason,changed_by,changed_by_name,change_source,created_at";

const COURT_SORT_COLUMNS = {
  name: "name",
  facilityName: "facility_name",
  courtUnit: "court_unit",
  indoorOutdoor: "indoor_outdoor",
  venueType: "venue_type",
  courtKind: "court_kind",
  surfaceType: "surface_type",
  courtLayout: "court_layout",
  hoopCount: "hoop_count",
  accessType: "access_type",
  reservationRequired: "reservation_required",
  paid: "paid",
  lighting: "lighting",
  publicAccess: "public_access",
  operationalStatus: "operational_status",
  verificationStatus: "verification_status",
  sigungu: "sigungu",
  modificationCount: "name_modification_count",
  registrationOrigin: "registration_origin",
  status: "status",
  updatedAt: "updated_at",
  id: "id",
  hashtag: "hashtag",
  address: "address_text",
  lat: "lat",
  lng: "lng",
};

const HISTORY_SORT_COLUMNS = {
  createdAt: "created_at",
  courtId: "court_id",
  sigungu: "sigungu",
  previousName: "previous_name",
  newName: "new_name",
  changedByName: "changed_by_name",
  changeSource: "change_source",
  reason: "reason",
};

function safePage(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(MAX_PAGE, Math.max(1, Math.floor(parsed))) : 1;
}

function safeText(value) {
  return String(value ?? "").trim().slice(0, MAX_FILTER_LENGTH);
}

function safeFilters(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function applyTextFilter(query, column, value) {
  const text = safeText(value);
  return text ? query.ilike(column, `%${text}%`) : query;
}

function applyExactFilter(query, column, value) {
  const text = safeText(value);
  if (text === "__null__") return query.is(column, null);
  return text ? query.eq(column, text) : query;
}

function applyBooleanFilter(query, column, value) {
  const text = safeText(value);
  if (text === "true") return query.eq(column, true);
  if (text === "false") return query.eq(column, false);
  if (text === "__null__") return query.is(column, null);
  return query;
}

function applyNumberFilter(query, column, value) {
  const text = safeText(value);
  if (!text) return query;
  const number = Number(text);
  return Number.isFinite(number) ? query.eq(column, number) : query;
}

function applyDayFilter(query, column, value) {
  const date = safeText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return query;
  const start = new Date(`${date}T00:00:00.000+09:00`);
  const end = new Date(start.getTime() + 86_400_000);
  return query.gte(column, start.toISOString()).lt(column, end.toISOString());
}

function applyCourtFilters(query, rawFilters) {
  const filters = safeFilters(rawFilters);
  let next = query;
  next = applyTextFilter(next, "name", filters.name);
  next = applyTextFilter(next, "facility_name", filters.facilityName);
  next = applyTextFilter(next, "court_unit", filters.courtUnit);
  next = applyExactFilter(next, "indoor_outdoor", filters.indoorOutdoor);
  next = applyExactFilter(next, "venue_type", filters.venueType);
  next = applyExactFilter(next, "court_kind", filters.courtKind);
  next = applyExactFilter(next, "surface_type", filters.surfaceType);
  next = applyExactFilter(next, "court_layout", filters.courtLayout);
  next = applyNumberFilter(next, "hoop_count", filters.hoopCount);
  next = applyExactFilter(next, "access_type", filters.accessType);
  next = applyBooleanFilter(next, "reservation_required", filters.reservationRequired);
  next = applyBooleanFilter(next, "paid", filters.paid);
  next = applyBooleanFilter(next, "lighting", filters.lighting);
  next = applyExactFilter(next, "public_access", filters.publicAccess);
  next = applyExactFilter(next, "operational_status", filters.operationalStatus);
  next = applyExactFilter(next, "verification_status", filters.verificationStatus);
  next = applyTextFilter(next, "sigungu", filters.sigungu);
  if (filters.modificationCount === "zero") next = next.eq("name_modification_count", 0);
  if (filters.modificationCount === "positive") next = next.gt("name_modification_count", 0);
  next = applyExactFilter(next, "registration_origin", filters.registrationOrigin);
  next = applyExactFilter(next, "status", filters.status);
  next = applyDayFilter(next, "updated_at", filters.updatedAt);
  next = applyTextFilter(next, "id", filters.id);
  next = applyTextFilter(next, "hashtag", filters.hashtag);
  next = applyTextFilter(next, "address_text", filters.address);
  next = applyNumberFilter(next, "lat", filters.lat);
  return applyNumberFilter(next, "lng", filters.lng);
}

function applyHistoryFilters(query, rawFilters) {
  const filters = safeFilters(rawFilters);
  let next = query;
  next = applyDayFilter(next, "created_at", filters.createdAt);
  next = applyTextFilter(next, "court_id", filters.courtId);
  next = applyTextFilter(next, "sigungu", filters.sigungu);
  next = applyTextFilter(next, "previous_name", filters.previousName);
  next = applyTextFilter(next, "new_name", filters.newName);
  next = applyTextFilter(next, "changed_by_name", filters.changedByName);
  next = applyExactFilter(next, "change_source", filters.changeSource);
  return applyTextFilter(next, "reason", filters.reason);
}

async function loadCourtRows(context, body) {
  const page = safePage(body.page);
  const offset = (page - 1) * PAGE_SIZE;
  const sortColumn = COURT_SORT_COLUMNS[body.sortKey] ?? "name_modification_count";
  const ascending = body.sortDirection !== "desc";
  let query = context.supabase.from("approved_courts").select(COURT_COLUMNS, { count: "exact" });
  query = applyCourtFilters(query, body.filters);
  const { data, error, count } = await query
    .order(sortColumn, { ascending, nullsFirst: false })
    .order("id", { ascending: true })
    .range(offset, offset + PAGE_SIZE - 1);
  if (error) throw error;
  const total = Number(count ?? 0);
  return {
    ok: true,
    rows: data ?? [],
    page: { page, pageSize: PAGE_SIZE, total, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)) },
  };
}

async function loadHistoryRows(context, body) {
  const page = safePage(body.page);
  const offset = (page - 1) * PAGE_SIZE;
  const sortColumn = HISTORY_SORT_COLUMNS[body.sortKey] ?? "created_at";
  const ascending = body.sortDirection === "asc";
  let query = context.supabase.from("court_name_change_log").select(HISTORY_COLUMNS, { count: "exact" });
  query = applyHistoryFilters(query, body.filters);
  const { data, error, count } = await query
    .order(sortColumn, { ascending, nullsFirst: false })
    .order("id", { ascending: true })
    .range(offset, offset + PAGE_SIZE - 1);
  if (error) throw error;
  const total = Number(count ?? 0);
  return {
    ok: true,
    rows: data ?? [],
    page: { page, pageSize: PAGE_SIZE, total, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)) },
  };
}

function getErrorStatus(error) {
  const message = String(error?.message ?? "");
  if (/admin_permission_required/i.test(message)) return 403;
  if (/court_not_found/i.test(message)) return 404;
  if (/required|invalid|unchanged/i.test(message)) return 400;
  if (error?.code === "23505") return 409;
  return error?.statusCode || 500;
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const context = await getAuthenticatedContext(request);
    const adminLevel = await getAdminLevel(context);
    if (adminLevel < 50) {
      sendJson(response, 403, { error: "admin_permission_required" });
      return;
    }

    const operation = safeText(body.operation || "list");
    if (operation === "list") {
      sendJson(response, 200, await loadCourtRows(context, body));
      return;
    }
    if (operation === "history") {
      sendJson(response, 200, await loadHistoryRows(context, body));
      return;
    }
    if (operation !== "rename") {
      sendJson(response, 400, { error: "unsupported_admin_court_operation" });
      return;
    }

    const { data, error } = await context.supabase.rpc("rankball_admin_rename_court", {
      p_actor_profile_id: context.profileId,
      p_actor_admin_level: adminLevel,
      p_court_id: safeText(body.courtId),
      p_facility_name: safeText(body.facilityName),
      p_reason: safeText(body.reason),
    });
    if (error) throw error;
    sendJson(response, 200, data ?? { ok: true });
  } catch (error) {
    console.error("Admin court database failed.", error);
    sendJson(response, getErrorStatus(error), { error: error.message || "admin_court_database_failed" });
  }
}
