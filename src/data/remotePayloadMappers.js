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
    createdAt: row.created_at ?? payload.createdAt,
    updatedAt: row.updated_at ?? payload.updatedAt,
  };
}

export function fromRemoteApprovedCourt(row = {}) {
  const payload = getRemotePayload(row);
  return {
    ...payload,
    id: row.id ?? payload.id,
    sourceRequestId: row.source_request_id ?? payload.sourceRequestId,
    approvedBy: row.approved_by ?? payload.approvedBy,
    name: row.name ?? payload.name,
    hashtag: row.hashtag ?? payload.hashtag,
    addressText: row.address_text ?? payload.addressText,
    roadAddress: row.road_address ?? payload.roadAddress,
    jibunAddress: row.jibun_address ?? payload.jibunAddress,
    zonecode: row.zonecode ?? payload.zonecode,
    lat: row.lat ?? payload.lat,
    lng: row.lng ?? payload.lng,
    status: row.status ?? payload.status ?? "active",
    hiddenAt: row.hidden_at ?? payload.hiddenAt,
    hiddenBy: row.hidden_by ?? payload.hiddenBy,
    hiddenReason: row.hidden_reason ?? payload.hiddenReason,
    rawRating: row.raw_rating ?? payload.rawRating ?? null,
    adjustedRating: row.adjusted_rating ?? payload.adjustedRating ?? null,
    reviewCount: Number(row.review_count ?? payload.reviewCount ?? 0),
    completedMatchCount: Number(row.completed_match_count ?? payload.completedMatchCount ?? 0),
    recommendationScore: row.recommendation_score ?? payload.recommendationScore ?? null,
    recentReviews: row.recent_reviews ?? payload.recentReviews ?? [],
    metricsUpdatedAt: row.metrics_updated_at ?? payload.metricsUpdatedAt ?? null,
    approvedAt: row.approved_at ?? payload.approvedAt,
    createdAt: row.created_at ?? payload.createdAt,
    updatedAt: row.updated_at ?? payload.updatedAt,
  };
}

export function fromRemoteCourtMetric(row = {}) {
  return {
    id: row.id,
    name: row.name,
    rawRating: row.raw_rating ?? null,
    adjustedRating: row.adjusted_rating ?? null,
    reviewCount: Number(row.review_count ?? 0),
    completedMatchCount: Number(row.completed_match_count ?? 0),
    recommendationScore: row.recommendation_score ?? null,
    recentReviews: row.recent_reviews ?? [],
    metricsUpdatedAt: row.metrics_updated_at ?? null,
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
