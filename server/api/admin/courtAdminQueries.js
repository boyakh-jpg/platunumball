
export const PAGE_SIZE = 100;

export const MAX_PAGE = 10_000;

export const MAX_FILTER_LENGTH = 240;

export const MAX_BATCH_UPDATES = 100;

export const NORMALIZATION_BATCH_SIZE = 10;

export const MAX_BATCH_BYTES = 524_288;

export const TEMPORARY_REASON_OPTIONAL_PROFILE_ID = "p_a6086f1e61b34ebca4";

export const TEMPORARY_COURT_UPDATE_REASON = "한시적 boyakh 구장 DB 정리";

export const COURT_COLUMNS = "name,facility_name,court_unit,indoor_outdoor,venue_type,court_kind,surface_type,court_layout,hoop_count,access_type,reservation_required,paid,lighting,public_access,operational_status,verification_status,sido,sigungu,emd,name_modification_count,registration_origin,status,updated_at,id,hashtag,address_text,road_address,jibun_address,zonecode,lat,lng,operator_name,contact_phone,official_url,reservation_url,opening_hours_text,application_method,access_note,detail_address,location_note,facility_area_sqm,facility_area_scope,name_evidence_decision,name_evidence_application_status,name_evidence_reference,name_evidence_kind,name_evidence_relation,name_evidence_distance_m,name_evidence_proposed_facility,name_evidence_applied_facility,name_evidence_url,name_evidence_snapshot_date,regional_alias_no,regional_alias_region_key,admin_review_count,admin_reviewed_at,admin_reviewed_by,admin_review_scenario,admin_review_priority";

export const HISTORY_COLUMNS = "id,court_id,sigungu,changed_by,changed_by_name,change_source,changed_fields,changes,changes_text,reason,created_at";

export const ADDRESS_NAME_COLUMNS = "id,facility_name,court_unit,address_text,road_address,jibun_address,lat,lng,emd,name_evidence_decision,name_evidence_application_status,name_evidence_reference";

export const DUPLICATE_GROUP_COLUMNS = "id,name,facility_name,court_unit,address_text,road_address,jibun_address,lat,lng,status,proximity_excess,verified_court_count";

export const COURT_SORT_COLUMNS = {
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

export const HISTORY_SORT_COLUMNS = {
  createdAt: "created_at",
  courtId: "court_id",
  sigungu: "sigungu",
  changedByName: "changed_by_name",
  changeSource: "change_source",
  changedFields: "changed_fields",
  changesText: "changes_text",
  reason: "reason",
};

export const COURT_REVIEW_REASONS = {
  public: "원터치 검수: 공개",
  private: "원터치 검수: 비공개",
  regional_alias: "원터치 검수: 읍면동 순번명",
  review_required: "원터치 검수: 추가 확인",
  closed: "원터치 검수: 폐쇄",
  duplicate: "원터치 검수: 중복",
};

export function safePage(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(MAX_PAGE, Math.max(1, Math.floor(parsed))) : 1;
}

export function safeText(value) {
  return String(value ?? "").trim().slice(0, MAX_FILTER_LENGTH);
}

export function safeFilters(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function isTemporaryReasonOptional(profileId) {
  return String(profileId ?? "") === TEMPORARY_REASON_OPTIONAL_PROFILE_ID;
}

export function getCourtUpdateReason(profileId, value) {
  const reason = String(value ?? "").trim().slice(0, 160);
  if (reason.length >= 4) return reason;
  if (isTemporaryReasonOptional(profileId)) return TEMPORARY_COURT_UPDATE_REASON;
  const error = new Error("court_update_reason_required");
  error.statusCode = 400;
  throw error;
}

export function getCourtReviewReason(profileId, scenario, value) {
  if (scenario === "manual") return getCourtUpdateReason(profileId, value);
  const reason = COURT_REVIEW_REASONS[scenario];
  if (!reason) {
    const error = new Error("court_review_scenario_invalid");
    error.statusCode = 400;
    throw error;
  }
  return reason;
}

export function normalizeBatchUpdates(value) {
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

export function applyTextFilter(query, column, value) {
  const text = safeText(value);
  return text ? query.ilike(column, `%${text}%`) : query;
}

export function applyExactFilter(query, column, value) {
  const text = safeText(value);
  if (text === "__null__") return query.is(column, null);
  return text ? query.eq(column, text) : query;
}

export function applyBooleanFilter(query, column, value) {
  const text = safeText(value);
  if (text === "true") return query.eq(column, true);
  if (text === "false") return query.eq(column, false);
  if (text === "__null__") return query.is(column, null);
  return query;
}

export function applyNumberFilter(query, column, value) {
  const text = safeText(value);
  if (!text) return query;
  const number = Number(text);
  return Number.isFinite(number) ? query.eq(column, number) : query;
}

export function applyDayFilter(query, column, value) {
  const date = safeText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return query;
  const start = new Date(`${date}T00:00:00.000+09:00`);
  const end = new Date(start.getTime() + 86_400_000);
  return query.gte(column, start.toISOString()).lt(column, end.toISOString());
}

export function applyCourtFilters(query, rawFilters) {
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

export function applyHistoryFilters(query, rawFilters) {
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

export async function loadPage(query, { sortColumn, ascending, offset }) {
  const { data, error, count } = await query
    .order(sortColumn, { ascending, nullsFirst: false })
    .order("id", { ascending: true })
    .range(offset, offset + PAGE_SIZE - 1);
  if (error) throw error;
  return {
    rows: data ?? [],
    total: Number(count ?? 0),
  };
}

export async function loadCourtRows(context, body) {
  const page = safePage(body.page);
  const offset = (page - 1) * PAGE_SIZE;
  const sortColumn = COURT_SORT_COLUMNS[body.sortKey] ?? "admin_review_priority";
  const ascending = body.sortDirection !== "desc";
  let query = context.supabase.from("rankball_admin_court_database").select(COURT_COLUMNS, { count: "exact" });
  query = applyCourtFilters(query, body.filters);
  const { rows, total } = await loadPage(query, { sortColumn, ascending, offset });
  return {
    ok: true,
    rows,
    page: { page, pageSize: PAGE_SIZE, total, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)) },
    capabilities: { reasonOptional: isTemporaryReasonOptional(context.profileId) },
  };
}

export async function loadHistoryRows(context, body) {
  const page = safePage(body.page);
  const offset = (page - 1) * PAGE_SIZE;
  const sortColumn = HISTORY_SORT_COLUMNS[body.sortKey] ?? "created_at";
  const ascending = body.sortDirection === "asc";
  let query = context.supabase.from("rankball_admin_court_change_history").select(HISTORY_COLUMNS, { count: "exact" });
  query = applyHistoryFilters(query, body.filters);
  const { rows, total } = await loadPage(query, { sortColumn, ascending, offset });
  return {
    ok: true,
    rows,
    page: { page, pageSize: PAGE_SIZE, total, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)) },
  };
}

export async function loadAllRows(context, table, columns) {
  const rows = [];
  const batchSize = 1_000;
  for (let offset = 0; ; offset += batchSize) {
    const { data, error } = await context.supabase
      .from(table)
      .select(columns)
      .order("id", { ascending: true })
      .range(offset, offset + batchSize - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < batchSize) break;
  }
  return rows;
}

export function loadAllCourtAddressRows(context) {
  return loadAllRows(context, "rankball_admin_court_database", ADDRESS_NAME_COLUMNS);
}

export function loadAllCourtDuplicateRows(context) {
  return loadAllRows(context, "approved_courts", DUPLICATE_GROUP_COLUMNS);
}
