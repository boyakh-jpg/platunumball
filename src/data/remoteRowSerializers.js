function getItemTimestamp(item = {}) {
  return item.updatedAt ?? item.createdAt ?? item.queuedAt ?? item.startedAt ?? item.approvedAt ?? item.resolvedAt ?? new Date().toISOString();
}

export function toPayloadRow(item = {}) {
  return {
    id: item.id,
    status: item.status ?? null,
    payload: item,
    created_at: item.createdAt ?? item.queuedAt ?? item.startedAt ?? item.approvedAt ?? new Date().toISOString(),
    updated_at: getItemTimestamp(item),
  };
}

export function toNotificationRow(notification = {}, currentUserId = "") {
  return {
    id: notification.id,
    user_id: notification.targetUserId ?? currentUserId,
    target_user_id: notification.targetUserId ?? null,
    title: notification.title,
    body: notification.body ?? "",
    tone: notification.tone ?? "match",
    type: notification.type ?? null,
    match_id: notification.matchId ?? null,
    recruiting_post_id: notification.recruitingPostId ?? null,
    invitation_id: notification.invitationId ?? null,
    discord_event: notification.discordEvent ?? notification.eventType ?? null,
    read_at: notification.readAt ?? null,
    payload: notification,
    created_at: notification.createdAt ?? new Date().toISOString(),
    updated_at: getItemTimestamp(notification),
  };
}

export function toReportRow(report = {}) {
  return {
    id: report.id,
    type: report.type,
    target_id: report.targetId,
    user_id: report.by ?? null,
    reported_user_ids: report.reportedUserIds ?? [],
    reason: report.reason ?? "기타 운영 확인 필요",
    status: report.status ?? "open",
    resolved_at: report.resolvedAt ?? null,
    resolved_by: report.resolvedBy ?? null,
    resolution: report.resolution ?? null,
    payload: report,
    created_at: report.createdAt ?? new Date().toISOString(),
    updated_at: getItemTimestamp(report),
  };
}

export function toCourtRequestRow(request = {}) {
  return {
    id: request.id,
    requested_by: request.requestedBy ?? null,
    status: request.status ?? "pending",
    name: request.name,
    hashtag: request.hashtag ?? null,
    address_text: request.addressText,
    road_address: request.roadAddress ?? null,
    jibun_address: request.jibunAddress ?? null,
    zonecode: request.zonecode ?? null,
    lat: request.lat ?? null,
    lng: request.lng ?? null,
    payload: request,
    created_at: request.createdAt ?? new Date().toISOString(),
    updated_at: getItemTimestamp(request),
  };
}

export function toApprovedCourtRow(court = {}) {
  return {
    id: court.id,
    source_request_id: court.sourceRequestId ?? null,
    approved_by: court.approvedBy ?? null,
    name: court.name,
    hashtag: court.hashtag ?? null,
    address_text: court.addressText,
    road_address: court.roadAddress ?? null,
    jibun_address: court.jibunAddress ?? null,
    zonecode: court.zonecode ?? null,
    lat: court.lat ?? null,
    lng: court.lng ?? null,
    status: court.status ?? "active",
    hidden_at: court.hiddenAt ?? null,
    hidden_by: court.hiddenBy ?? null,
    hidden_reason: court.hiddenReason ?? null,
    public_access: court.publicAccess ?? "unknown",
    registration_origin: court.registrationOrigin ?? "user_request",
    facility_name: court.facilityName ?? court.baseName ?? court.name,
    court_unit: court.courtUnit ?? null,
    sido: court.sido ?? null,
    sigungu: court.sigungu ?? null,
    emd: court.emd ?? court.addressDong ?? null,
    indoor_outdoor: court.indoorOutdoor ?? null,
    venue_type: court.venueType ?? null,
    court_kind: court.courtKind ?? null,
    surface_type: court.surfaceType ?? null,
    surface_type_raw: court.surfaceTypeRaw ?? null,
    court_layout: court.courtLayout ?? null,
    court_layout_raw: court.courtLayoutRaw ?? null,
    hoop_count: court.hoopCount ?? null,
    access_type: court.accessType ?? null,
    reservation_required: court.reservationRequired ?? court.reservation ?? null,
    paid: court.paid ?? null,
    lighting: court.lighting ?? null,
    operational_status: court.operationalStatus ?? "active",
    verification_status: court.verificationStatus ?? "pending",
    name_source: court.nameSource ?? null,
    address_source: court.addressSource ?? null,
    source_confidence: court.sourceConfidence ?? null,
    verified_at: court.verifiedAt ?? null,
    name_modified_at: court.nameModifiedAt ?? null,
    name_modified_by: court.nameModifiedBy ?? null,
    approved_at: court.approvedAt ?? null,
    created_at: court.createdAt ?? court.approvedAt ?? new Date().toISOString(),
    updated_at: getItemTimestamp(court),
  };
}
