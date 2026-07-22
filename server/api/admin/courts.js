import { getAdminLevel, getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import { buildCourtAddressNameUpdates } from "../../../src/lib/courts.js";

const PAGE_SIZE = 100;
const MAX_PAGE = 10_000;
const MAX_FILTER_LENGTH = 240;
const MAX_BATCH_UPDATES = 100;
const NORMALIZATION_BATCH_SIZE = 10;
const MAX_BATCH_BYTES = 524_288;
const TEMPORARY_REASON_OPTIONAL_PROFILE_ID = "p_a6086f1e61b34ebca4";
const TEMPORARY_COURT_UPDATE_REASON = "한시적 boyakh 구장 DB 정리";
const COURT_COLUMNS = "name,facility_name,court_unit,indoor_outdoor,venue_type,court_kind,surface_type,court_layout,hoop_count,access_type,reservation_required,paid,lighting,public_access,operational_status,verification_status,sido,sigungu,emd,name_modification_count,registration_origin,status,updated_at,id,hashtag,address_text,road_address,jibun_address,zonecode,lat,lng,operator_name,contact_phone,official_url,reservation_url,opening_hours_text,application_method,access_note,detail_address,location_note,facility_area_sqm,facility_area_scope,name_evidence_decision,name_evidence_application_status,name_evidence_reference,name_evidence_kind,name_evidence_relation,name_evidence_distance_m,name_evidence_proposed_facility,name_evidence_applied_facility,name_evidence_url,name_evidence_snapshot_date,regional_alias_no,regional_alias_region_key,admin_review_count,admin_reviewed_at,admin_reviewed_by,admin_review_scenario,admin_review_priority";
const HISTORY_COLUMNS = "id,court_id,sigungu,changed_by,changed_by_name,change_source,changed_fields,changes,changes_text,reason,created_at";
const ADDRESS_NAME_COLUMNS = "id,facility_name,court_unit,address_text,road_address,jibun_address,lat,lng";

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
  sido: "sido",
  sigungu: "sigungu",
  emd: "emd",
  modificationCount: "name_modification_count",
  registrationOrigin: "registration_origin",
  status: "status",
  updatedAt: "updated_at",
  id: "id",
  hashtag: "hashtag",
  address: "address_text",
  roadAddress: "road_address",
  jibunAddress: "jibun_address",
  zonecode: "zonecode",
  lat: "lat",
  lng: "lng",
  operatorName: "operator_name",
  contactPhone: "contact_phone",
  officialUrl: "official_url",
  reservationUrl: "reservation_url",
  openingHoursText: "opening_hours_text",
  applicationMethod: "application_method",
  accessNote: "access_note",
  detailAddress: "detail_address",
  locationNote: "location_note",
  facilityAreaSqm: "facility_area_sqm",
  facilityAreaScope: "facility_area_scope",
  nameEvidenceDecision: "name_evidence_decision",
  nameEvidenceApplicationStatus: "name_evidence_application_status",
  nameEvidenceReference: "name_evidence_reference",
  nameEvidenceKind: "name_evidence_kind",
  nameEvidenceRelation: "name_evidence_relation",
  nameEvidenceDistanceM: "name_evidence_distance_m",
  nameEvidenceProposedFacility: "name_evidence_proposed_facility",
  nameEvidenceAppliedFacility: "name_evidence_applied_facility",
  nameEvidenceUrl: "name_evidence_url",
  nameEvidenceSnapshotDate: "name_evidence_snapshot_date",
  regionalAliasNo: "regional_alias_no",
  reviewCount: "admin_review_count",
  reviewedAt: "admin_reviewed_at",
  reviewedBy: "admin_reviewed_by",
  reviewScenario: "admin_review_scenario",
  reviewPriority: "admin_review_priority",
};

const HISTORY_SORT_COLUMNS = {
  createdAt: "created_at",
  courtId: "court_id",
  sigungu: "sigungu",
  changedByName: "changed_by_name",
  changeSource: "change_source",
  changedFields: "changed_fields",
  changesText: "changes_text",
  reason: "reason",
};

const COURT_REVIEW_REASONS = {
  public: "원터치 검수: 공개",
  private: "원터치 검수: 비공개",
  regional_alias: "원터치 검수: 읍면동 순번명",
  review_required: "원터치 검수: 추가 확인",
  closed: "원터치 검수: 폐쇄",
  duplicate: "원터치 검수: 중복",
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

function isTemporaryReasonOptional(profileId) {
  return String(profileId ?? "") === TEMPORARY_REASON_OPTIONAL_PROFILE_ID;
}

function getCourtUpdateReason(profileId, value) {
  const reason = String(value ?? "").trim().slice(0, 160);
  if (reason.length >= 4) return reason;
  if (isTemporaryReasonOptional(profileId)) return TEMPORARY_COURT_UPDATE_REASON;
  const error = new Error("court_update_reason_required");
  error.statusCode = 400;
  throw error;
}

function getCourtReviewReason(profileId, scenario, value) {
  if (scenario === "manual") return getCourtUpdateReason(profileId, value);
  const reason = COURT_REVIEW_REASONS[scenario];
  if (!reason) {
    const error = new Error("court_review_scenario_invalid");
    error.statusCode = 400;
    throw error;
  }
  return reason;
}

function normalizeBatchUpdates(value) {
  if (!Array.isArray(value) || !value.length || value.length > MAX_BATCH_UPDATES || JSON.stringify(value).length > MAX_BATCH_BYTES) {
    const error = new Error("court_batch_invalid");
    error.statusCode = 400;
    throw error;
  }
  const seen = new Set();
  return value.map((item) => {
    const courtId = safeText(item?.courtId);
    const patch = item?.patch && typeof item.patch === "object" && !Array.isArray(item.patch) ? item.patch : null;
    if (!courtId || seen.has(courtId) || !patch || !Object.keys(patch).length || JSON.stringify(patch).length > 32_768) {
      const error = new Error("court_batch_item_invalid");
      error.statusCode = 400;
      throw error;
    }
    seen.add(courtId);
    return { courtId, patch };
  });
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
  next = applyTextFilter(next, "sido", filters.sido);
  next = applyTextFilter(next, "sigungu", filters.sigungu);
  next = applyTextFilter(next, "emd", filters.emd);
  if (filters.modificationCount === "zero") next = next.eq("name_modification_count", 0);
  if (filters.modificationCount === "positive") next = next.gt("name_modification_count", 0);
  next = applyExactFilter(next, "registration_origin", filters.registrationOrigin);
  next = applyExactFilter(next, "status", filters.status);
  next = applyDayFilter(next, "updated_at", filters.updatedAt);
  next = applyTextFilter(next, "id", filters.id);
  next = applyTextFilter(next, "hashtag", filters.hashtag);
  next = applyTextFilter(next, "address_text", filters.address);
  next = applyTextFilter(next, "road_address", filters.roadAddress);
  next = applyTextFilter(next, "jibun_address", filters.jibunAddress);
  next = applyTextFilter(next, "zonecode", filters.zonecode);
  next = applyNumberFilter(next, "lat", filters.lat);
  next = applyNumberFilter(next, "lng", filters.lng);
  next = applyTextFilter(next, "operator_name", filters.operatorName);
  next = applyTextFilter(next, "contact_phone", filters.contactPhone);
  next = applyTextFilter(next, "official_url", filters.officialUrl);
  next = applyTextFilter(next, "reservation_url", filters.reservationUrl);
  next = applyTextFilter(next, "opening_hours_text", filters.openingHoursText);
  next = applyTextFilter(next, "application_method", filters.applicationMethod);
  next = applyTextFilter(next, "access_note", filters.accessNote);
  next = applyTextFilter(next, "detail_address", filters.detailAddress);
  next = applyTextFilter(next, "location_note", filters.locationNote);
  next = applyNumberFilter(next, "facility_area_sqm", filters.facilityAreaSqm);
  next = applyExactFilter(next, "facility_area_scope", filters.facilityAreaScope);
  next = applyExactFilter(next, "name_evidence_decision", filters.nameEvidenceDecision);
  next = applyExactFilter(next, "name_evidence_application_status", filters.nameEvidenceApplicationStatus);
  next = applyTextFilter(next, "name_evidence_reference", filters.nameEvidenceReference);
  next = applyExactFilter(next, "name_evidence_kind", filters.nameEvidenceKind);
  next = applyExactFilter(next, "name_evidence_relation", filters.nameEvidenceRelation);
  next = applyNumberFilter(next, "name_evidence_distance_m", filters.nameEvidenceDistanceM);
  next = applyTextFilter(next, "name_evidence_proposed_facility", filters.nameEvidenceProposedFacility);
  next = applyTextFilter(next, "name_evidence_applied_facility", filters.nameEvidenceAppliedFacility);
  next = applyTextFilter(next, "name_evidence_url", filters.nameEvidenceUrl);
  next = applyExactFilter(next, "name_evidence_snapshot_date", filters.nameEvidenceSnapshotDate);
  next = applyNumberFilter(next, "regional_alias_no", filters.regionalAliasNo);
  if (filters.reviewCount === "zero") next = next.eq("admin_review_count", 0);
  if (filters.reviewCount === "positive") next = next.gt("admin_review_count", 0);
  next = applyDayFilter(next, "admin_reviewed_at", filters.reviewedAt);
  next = applyTextFilter(next, "admin_reviewed_by", filters.reviewedBy);
  return applyExactFilter(next, "admin_review_scenario", filters.reviewScenario);
}

function applyHistoryFilters(query, rawFilters) {
  const filters = safeFilters(rawFilters);
  let next = query;
  next = applyDayFilter(next, "created_at", filters.createdAt);
  next = applyTextFilter(next, "court_id", filters.courtId);
  next = applyTextFilter(next, "sigungu", filters.sigungu);
  next = applyTextFilter(next, "changed_by_name", filters.changedByName);
  next = applyExactFilter(next, "change_source", filters.changeSource);
  next = applyTextFilter(next, "changed_fields", filters.changedFields);
  next = applyTextFilter(next, "changes_text", filters.changesText);
  return applyTextFilter(next, "reason", filters.reason);
}

async function loadCourtRows(context, body) {
  const page = safePage(body.page);
  const offset = (page - 1) * PAGE_SIZE;
  const sortColumn = COURT_SORT_COLUMNS[body.sortKey] ?? "admin_review_priority";
  const ascending = body.sortDirection !== "desc";
  let query = context.supabase.from("rankball_admin_court_database").select(COURT_COLUMNS, { count: "exact" });
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
    capabilities: { reasonOptional: isTemporaryReasonOptional(context.profileId) },
  };
}

async function loadHistoryRows(context, body) {
  const page = safePage(body.page);
  const offset = (page - 1) * PAGE_SIZE;
  const sortColumn = HISTORY_SORT_COLUMNS[body.sortKey] ?? "created_at";
  const ascending = body.sortDirection === "asc";
  let query = context.supabase.from("rankball_admin_court_change_history").select(HISTORY_COLUMNS, { count: "exact" });
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

async function loadAllCourtAddressRows(context) {
  const rows = [];
  const batchSize = 1_000;
  for (let offset = 0; ; offset += batchSize) {
    const { data, error } = await context.supabase
      .from("approved_courts")
      .select(ADDRESS_NAME_COLUMNS)
      .order("id", { ascending: true })
      .range(offset, offset + batchSize - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < batchSize) break;
  }
  return rows;
}

function getErrorStatus(error) {
  const message = String(error?.message ?? "");
  if (/admin_permission_required/i.test(message)) return 403;
  if (/court(?:_name_evidence)?_not_found/i.test(message)) return 404;
  if (/required|invalid|unchanged|patch|batch/i.test(message)) return 400;
  if (["23514", "22P02", "22003"].includes(error?.code)) return 400;
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
    if (operation === "proximity") {
      const { data, error } = await context.supabase.rpc("rankball_admin_auto_group_nearby_courts", {
        p_actor_profile_id: context.profileId,
        p_actor_admin_level: adminLevel,
        p_court_id: safeText(body.courtId),
        p_facility_name: safeText(body.facilityName) || null,
        p_reason: "관리자 검수: 30m 근접 구장 자동 병합",
      });
      if (error) throw error;
      sendJson(response, 200, data ?? { ok: true, detectedCount: 1, courts: [] });
      return;
    }
    if (operation === "verifyCount") {
      const actualCount = Number(body.actualCount);
      const patch = body.patch && typeof body.patch === "object" && !Array.isArray(body.patch) ? body.patch : {};
      if (!Number.isSafeInteger(actualCount) || actualCount < 1 || actualCount > 2_147_483_647) {
        sendJson(response, 400, { error: "court_actual_count_invalid" });
        return;
      }
      if (JSON.stringify(patch).length > 32_768) {
        sendJson(response, 400, { error: "court_patch_invalid" });
        return;
      }
      const { data, error } = await context.supabase.rpc("rankball_admin_verify_nearby_court_count", {
        p_actor_profile_id: context.profileId,
        p_actor_admin_level: adminLevel,
        p_court_id: safeText(body.courtId),
        p_actual_count: actualCount,
        p_facility_name: safeText(body.facilityName) || null,
        p_patch: patch,
        p_reason: "관리자 검수: 실제 코트 수 확정",
      });
      if (error) throw error;
      sendJson(response, 200, data ?? { ok: true, actualCount });
      return;
    }
    if (operation === "update") {
      const patch = body.patch && typeof body.patch === "object" && !Array.isArray(body.patch) ? body.patch : null;
      if (!patch || JSON.stringify(patch).length > 32_768) {
        sendJson(response, 400, { error: "court_patch_invalid" });
        return;
      }
      const { data, error } = await context.supabase.rpc("rankball_admin_update_court_with_auto_unit", {
        p_actor_profile_id: context.profileId,
        p_actor_admin_level: adminLevel,
        p_court_id: safeText(body.courtId),
        p_patch: patch,
        p_reason: getCourtUpdateReason(context.profileId, body.reason),
      });
      if (error) throw error;
      sendJson(response, 200, data ?? { ok: true });
      return;
    }
    if (operation === "updateBatch") {
      const updates = normalizeBatchUpdates(body.updates);
      const { data, error } = await context.supabase.rpc("rankball_admin_update_courts_batch_with_auto_unit", {
        p_actor_profile_id: context.profileId,
        p_actor_admin_level: adminLevel,
        p_updates: updates,
        p_reason: getCourtUpdateReason(context.profileId, body.reason),
      });
      if (error) throw error;
      sendJson(response, 200, data ?? { ok: true, updatedCount: updates.length });
      return;
    }
    if (operation === "normalizeAddressNames") {
      const plan = buildCourtAddressNameUpdates(await loadAllCourtAddressRows(context));
      const duplicateUpdates = plan.updates.filter((update) => update.patch.courtUnit);
      const pendingIds = new Set(duplicateUpdates.map((update) => update.courtId));
      const groups = [];
      let selectedCount = 0;
      for (const items of plan.unitGroups) {
        const pendingCount = items.filter((item) => pendingIds.has(item.courtId)).length;
        if (!pendingCount || (groups.length && selectedCount + pendingCount > NORMALIZATION_BATCH_SIZE)) continue;
        groups.push(items);
        selectedCount += pendingCount;
        if (selectedCount >= NORMALIZATION_BATCH_SIZE) break;
      }
      const updates = groups.flatMap((items) => items.filter((update) => pendingIds.has(update.courtId)));
      const saveUpdate = async (update, patch = update.patch) => {
        const { error } = await context.supabase.rpc("rankball_admin_update_court_with_auto_unit", {
          p_actor_profile_id: context.profileId,
          p_actor_admin_level: adminLevel,
          p_court_id: update.courtId,
          p_patch: patch,
          p_reason: "중복 주소 코트 번호 일괄 정리",
        });
        if (String(error?.message ?? "").includes("court_patch_unchanged")) return;
        if (error) throw new Error(`${error.message}|court:${update.courtId}|unit:${String(patch.courtUnit ?? "")}`);
      };
      for (const group of groups) {
        const pendingGroup = group.filter((update) => pendingIds.has(update.courtId));
        try {
          for (const update of pendingGroup) await saveUpdate(update);
        } catch (error) {
          if (!String(error?.message ?? "").includes("court_duplicate")) throw error;
          for (const update of group) await saveUpdate(update, { courtUnit: `임시${update.courtId.replace(/[^a-zA-Z0-9가-힣]/g, "").slice(-16)}코트` });
          for (const update of group) await saveUpdate(update);
        }
      }
      sendJson(response, 200, {
        ok: true,
        updatedCount: updates.length,
        remainingCount: Math.max(0, duplicateUpdates.length - updates.length),
        scannedCount: plan.scannedCount,
        addressFacilityCount: plan.addressFacilityCount,
        duplicateAddressCount: plan.duplicateAddressCount,
        duplicateCourtCount: plan.duplicateCourtCount,
      });
      return;
    }
    if (operation === "review") {
      const scenario = safeText(body.scenario);
      const patch = body.patch && typeof body.patch === "object" && !Array.isArray(body.patch) ? body.patch : {};
      if (JSON.stringify(patch).length > 32_768) {
        sendJson(response, 400, { error: "court_patch_invalid" });
        return;
      }
      const { data, error } = await context.supabase.rpc("rankball_admin_review_court_with_auto_unit", {
        p_actor_profile_id: context.profileId,
        p_actor_admin_level: adminLevel,
        p_court_id: safeText(body.courtId),
        p_scenario: scenario,
        p_patch: patch,
        p_reason: getCourtReviewReason(context.profileId, scenario, body.reason),
      });
      if (error) throw error;
      sendJson(response, 200, data ?? { ok: true, scenario });
      return;
    }
    if (operation !== "rename") {
      sendJson(response, 400, { error: "unsupported_admin_court_operation" });
      return;
    }

    const { data, error } = await context.supabase.rpc("rankball_admin_update_court_with_auto_unit", {
      p_actor_profile_id: context.profileId,
      p_actor_admin_level: adminLevel,
      p_court_id: safeText(body.courtId),
      p_patch: { facilityName: safeText(body.facilityName) },
      p_reason: getCourtUpdateReason(context.profileId, body.reason),
    });
    if (error) throw error;
    sendJson(response, 200, data ?? { ok: true });
  } catch (error) {
    console.error("Admin court database failed.", error);
    sendJson(response, getErrorStatus(error), { error: error.message || "admin_court_database_failed" });
  }
}
