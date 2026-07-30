function getRemotePayload(row = {}) {
  return row.payload && typeof row.payload === "object" && !Array.isArray(row.payload) ? row.payload : {};
}

export function fromRemotePayloadRow(row = {}) {
  const payload = getRemotePayload(row);
  return {
    ...payload,
    id: row.id ?? payload.id,
    status: row.status ?? payload.status,
    requestedBy: row.requested_by ?? payload.requestedBy,
    userId: row.user_id ?? payload.userId,
    targetUserId: row.target_user_id ?? payload.targetUserId,
    role: row.role ?? payload.role,
    grade: row.grade ?? payload.grade,
    type: row.type ?? payload.type,
    actionType: row.action_type ?? payload.actionType,
    startsAt: row.starts_at ?? payload.startsAt,
    endsAt: row.ends_at ?? payload.endsAt,
    appointedBy: row.appointed_by ?? payload.appointedBy,
    createdBy: row.created_by ?? payload.createdBy,
    createdAt: row.created_at ?? payload.createdAt,
    updatedAt: row.updated_at ?? payload.updatedAt,
  };
}

export function fromRemoteNotification(row = {}) {
  const payload = getRemotePayload(row);
  return {
    ...payload,
    id: row.id ?? payload.id,
    title: row.title ?? payload.title,
    body: row.body ?? payload.body,
    tone: row.tone ?? payload.tone,
    type: row.type ?? payload.type,
    targetUserId: row.target_user_id ?? payload.targetUserId ?? row.user_id,
    matchId: row.match_id ?? payload.matchId,
    recruitingPostId: row.recruiting_post_id ?? payload.recruitingPostId,
    invitationId: row.invitation_id ?? payload.invitationId,
    discordEvent: row.discord_event ?? payload.discordEvent,
    readAt: row.read_at ?? payload.readAt ?? null,
    dueAt: row.due_at ?? payload.dueAt ?? payload.sendAt ?? null,
    createdAt: row.created_at ?? payload.createdAt,
    updatedAt: row.updated_at ?? payload.updatedAt,
  };
}

export function fromRemoteReport(row = {}) {
  const payload = getRemotePayload(row);
  return {
    ...payload,
    id: row.id ?? payload.id,
    type: row.type ?? payload.type,
    targetId: row.target_id ?? payload.targetId,
    by: row.user_id ?? payload.by,
    reportedUserIds: row.reported_user_ids ?? payload.reportedUserIds ?? [],
    reason: row.reason ?? payload.reason,
    status: row.status ?? payload.status ?? "open",
    resolvedAt: row.resolved_at ?? payload.resolvedAt,
    resolvedBy: row.resolved_by ?? payload.resolvedBy,
    resolution: row.resolution ?? payload.resolution,
    createdAt: row.created_at ?? payload.createdAt,
    updatedAt: row.updated_at ?? payload.updatedAt,
  };
}

export function fromRemoteCourtRequest(row = {}) {
  const payload = getRemotePayload(row);
  return {
    ...payload,
    id: row.id ?? payload.id,
    requestedBy: row.requested_by ?? payload.requestedBy,
    status: row.status ?? payload.status ?? "pending",
    name: row.name ?? payload.name,
    hashtag: row.hashtag ?? payload.hashtag,
    addressText: row.address_text ?? payload.addressText,
    roadAddress: row.road_address ?? payload.roadAddress,
    jibunAddress: row.jibun_address ?? payload.jibunAddress,
    zonecode: row.zonecode ?? payload.zonecode,
    lat: row.lat ?? payload.lat,
    lng: row.lng ?? payload.lng,
    publicAccess: row.public_access ?? payload.publicAccess ?? "unknown",
    createdAt: row.created_at ?? payload.createdAt,
    updatedAt: row.updated_at ?? payload.updatedAt,
  };
}

export function fromRemoteApprovedCourt(row = {}) {
  const indoorOutdoor = row.indoor_outdoor ?? "unknown";
  const facilityName = row.facility_name ?? row.name ?? "";
  const region = row.sigungu ?? row.sido ?? row.emd ?? row.region_key ?? "";
  const type = indoorOutdoor === "outdoor"
    ? "야외"
    : indoorOutdoor === "indoor"
      ? "실내"
      : "확인 필요";
  return {
    id: row.id,
    sourceRequestId: row.source_request_id ?? null,
    approvedBy: row.approved_by ?? null,
    name: row.name,
    canonicalName: row.name,
    canonicalBaseName: row.name,
    baseName: facilityName,
    hashtag: row.hashtag ?? null,
    addressText: row.address_text ?? "",
    roadAddress: row.road_address ?? null,
    jibunAddress: row.jibun_address ?? null,
    zonecode: row.zonecode ?? null,
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    region,
    regionKey: row.region_key ?? region,
    addressDong: row.emd ?? null,
    type,
    publicAccess: row.public_access ?? "unknown",
    registrationOrigin: row.registration_origin ?? "user_request",
    facilityName,
    courtUnit: row.court_unit ?? null,
    sido: row.sido ?? null,
    sigungu: row.sigungu ?? null,
    emd: row.emd ?? null,
    indoorOutdoor,
    venueType: row.venue_type ?? "unknown",
    courtKind: row.court_kind ?? "unknown",
    surfaceType: row.surface_type ?? "unknown",
    surfaceTypeRaw: row.surface_type_raw ?? null,
    courtLayout: row.court_layout ?? "unknown",
    courtLayoutRaw: row.court_layout_raw ?? null,
    hoopCount: row.hoop_count ?? null,
    accessType: row.access_type ?? "unknown",
    reservationRequired: row.reservation_required ?? null,
    reservation: row.reservation_required ?? null,
    paid: row.paid ?? null,
    lighting: row.lighting ?? null,
    operationalStatus: row.operational_status ?? "active",
    verificationStatus: row.verification_status ?? "pending",
    nameSource: row.name_source ?? null,
    addressSource: row.address_source ?? null,
    sourceConfidence: row.source_confidence ?? null,
    verifiedAt: row.verified_at ?? null,
    nameModifiedAt: row.name_modified_at ?? null,
    nameModifiedBy: row.name_modified_by ?? null,
    nameModificationCount: Number(row.name_modification_count ?? 0),
    status: row.status ?? "active",
    hiddenAt: row.hidden_at ?? null,
    hiddenBy: row.hidden_by ?? null,
    hiddenReason: row.hidden_reason ?? null,
    ...projectRemoteCourtMetrics(row),
    favorite: false,
    approvedAt: row.approved_at ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? row.created_at ?? null,
  };
}

function projectRemoteCourtMetrics(row = {}) {
  return {
    rawRating: row.raw_rating ?? null,
    adjustedRating: row.adjusted_rating ?? null,
    reviewCount: Number(row.review_count ?? 0),
    completedMatchCount: Number(row.completed_match_count ?? 0),
    recommendationScore: row.recommendation_score ?? null,
    recentReviews: row.recent_reviews ?? [],
    metricsUpdatedAt: row.metrics_updated_at ?? null,
  };
}

export function fromRemoteCourtMetric(row = {}) {
  return {
    id: row.id,
    name: row.name,
    ...projectRemoteCourtMetrics(row),
  };
}

export function fromRemoteCourtReview(row = {}) {
  const payload = getRemotePayload(row);
  return {
    ...payload,
    id: row.id ?? payload.id,
    courtId: row.court_id ?? payload.courtId,
    courtName: row.court_name ?? payload.courtName,
    matchId: row.match_id ?? payload.matchId,
    reviewerId: row.reviewer_id ?? payload.reviewerId,
    rating: Number(row.rating ?? payload.rating ?? 0),
    surfaceRating: row.surface_rating ?? payload.surfaceRating ?? null,
    rimRating: row.rim_rating ?? payload.rimRating ?? null,
    lightingRating: row.lighting_rating ?? payload.lightingRating ?? null,
    crowdRating: row.crowd_rating ?? payload.crowdRating ?? null,
    locationAccuracy: row.location_accuracy ?? payload.locationAccuracy ?? null,
    fitModes: row.fit_modes ?? payload.fitModes ?? [],
    tags: row.tags ?? payload.tags ?? [],
    memo: row.memo ?? payload.memo ?? "",
    status: row.status ?? payload.status ?? "active",
    hiddenAt: row.hidden_at ?? payload.hiddenAt,
    hiddenBy: row.hidden_by ?? payload.hiddenBy,
    hiddenReason: row.hidden_reason ?? payload.hiddenReason,
    createdAt: row.created_at ?? payload.createdAt,
    updatedAt: row.updated_at ?? payload.updatedAt,
  };
}
