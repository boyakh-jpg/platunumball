import { toArray } from "../_supabaseAdmin.js";

export const COURT_CORRECTION_FIELDS = new Map([
  ["name", "시설명"],
  ["location", "위치·주소"],
  ["access", "공개·이용 방식"],
  ["operation", "운영·폐쇄 상태"],
  ["court", "코트 유형·시설"],
  ["contact", "연락처·예약 URL"],
  ["duplicate", "중복 구장"],
  ["other", "기타"],
]);

export const COURT_CORRECTION_ATTRIBUTES = new Map([
  ["publicAccess", { field: "access", label: "공개 범위", values: new Set(["public", "private", "unknown"]) }],
  ["accessType", { field: "access", label: "이용 방식", values: new Set(["walk_in", "reservation", "restricted", "unknown"]) }],
  ["paid", { field: "access", label: "이용료", values: new Set(["true", "false", "null"]) }],
  ["operationalStatus", { field: "operation", label: "운영 상태", values: new Set(["active", "pending", "closed", "unknown"]) }],
  ["indoorOutdoor", { field: "court", label: "실내외", values: new Set(["outdoor", "indoor", "mixed", "unknown"]) }],
  ["courtKind", { field: "court", label: "구장 유형", values: new Set(["official", "street_hoop", "unknown"]) }],
  ["surfaceType", { field: "court", label: "바닥", values: new Set(["asphalt", "urethane", "dirt", "indoor_wood", "indoor_synthetic", "unknown"]) }],
  ["courtLayout", { field: "court", label: "코트 형태", values: new Set(["full", "half", "single_hoop", "unknown"]) }],
  ["lighting", { field: "court", label: "조명", values: new Set(["true", "false", "null"]) }],
]);

export function uniqueStrings(values) {
  return Array.from(new Set(toArray(values).map((value) => String(value).trim()).filter(Boolean)));
}

export function normalizeCourtCorrection(value = {}) {
  const field = String(value?.field || "").trim();
  const attribute = String(value?.attribute || "").trim();
  const proposedValue = String(value?.proposedValue || "").trim();
  const note = String(value?.note || "").trim();
  const evidenceUrl = String(value?.evidenceUrl || "").trim();
  const structuredAttribute = COURT_CORRECTION_ATTRIBUTES.get(attribute);
  const structuredValid = Boolean(
    structuredAttribute
    && structuredAttribute.field === field
    && structuredAttribute.values.has(proposedValue),
  );
  const freeTextValid = !attribute && proposedValue.length >= 4 && proposedValue.length <= 500;
  if (!COURT_CORRECTION_FIELDS.has(field) || (!structuredValid && !freeTextValid) || note.length > 500) {
    const error = new Error("invalid_court_correction");
    error.statusCode = 400;
    throw error;
  }
  if (evidenceUrl) {
    try {
      const parsed = new URL(evidenceUrl);
      if (!["http:", "https:"].includes(parsed.protocol) || evidenceUrl.length > 1000) throw new Error("invalid");
    } catch {
      const error = new Error("invalid_court_correction_url");
      error.statusCode = 400;
      throw error;
    }
  }
  return {
    field,
    attribute: structuredValid ? attribute : null,
    proposedValue,
    note: note || null,
    evidenceUrl: evidenceUrl || null,
  };
}

export async function assertCanSubmitCourtReport(context, targetId, rawCorrection) {
  const correction = normalizeCourtCorrection(rawCorrection);
  const { data: court, error: courtError } = await context.supabase
    .from("approved_courts")
    .select("id, source_request_id, status, name, address_text, road_address, jibun_address, public_access, access_type, operational_status, indoor_outdoor, court_kind, surface_type, court_layout, hoop_count, paid, lighting")
    .eq("id", targetId)
    .maybeSingle();
  if (courtError) throw courtError;
  if (!court) {
    const error = new Error("court_not_found");
    error.statusCode = 404;
    throw error;
  }
  if (court.status && court.status !== "active") {
    const error = new Error("court_hidden");
    error.statusCode = 400;
    throw error;
  }

  let requestedBy = null;
  if (court.source_request_id) {
    const { data: request, error: requestError } = await context.supabase
      .from("court_requests")
      .select("requested_by")
      .eq("id", court.source_request_id)
      .maybeSingle();
    if (requestError) throw requestError;
    requestedBy = request?.requested_by ?? null;
  }
  return {
    reportedUserIds: requestedBy && requestedBy !== context.profileId ? [requestedBy] : [],
    verifiedReason: `${correction.attribute ? COURT_CORRECTION_ATTRIBUTES.get(correction.attribute).label : COURT_CORRECTION_FIELDS.get(correction.field)} 수정 요청: ${correction.proposedValue}${correction.note ? ` · ${correction.note}` : ""}`.slice(0, 500),
    verifiedPayload: {
      courtCorrection: {
        ...correction,
        current: {
          name: court.name,
          addressText: court.address_text,
          roadAddress: court.road_address,
          jibunAddress: court.jibun_address,
          publicAccess: court.public_access,
          accessType: court.access_type,
          operationalStatus: court.operational_status,
          indoorOutdoor: court.indoor_outdoor,
          courtKind: court.court_kind,
          surfaceType: court.surface_type,
          courtLayout: court.court_layout,
          hoopCount: court.hoop_count,
          paid: court.paid,
          lighting: court.lighting,
        },
      },
    },
  };
}

export async function assertCanSubmitCourtReviewReport(context, targetId) {
  const { data: review, error: reviewError } = await context.supabase
    .from("court_reviews")
    .select("id, reviewer_id, status")
    .eq("id", targetId)
    .maybeSingle();
  if (reviewError) throw reviewError;
  if (!review) {
    const error = new Error("court_review_not_found");
    error.statusCode = 404;
    throw error;
  }
  if (review.status && review.status !== "active") {
    const error = new Error("court_review_hidden");
    error.statusCode = 400;
    throw error;
  }
  if (review.reviewer_id === context.profileId) {
    const error = new Error("cannot_report_self");
    error.statusCode = 400;
    throw error;
  }
  return [review.reviewer_id].filter(Boolean);
}

export async function loadReportableTeam(context, targetId, teamColumns, { captainRequired = false } = {}) {
  const [{ data: team, error: teamError }, { data: captain, error: captainError }] = await Promise.all([
    context.supabase
      .from("teams")
      .select(teamColumns)
      .eq("id", targetId)
      .is("deleted_at", null)
      .maybeSingle(),
    context.supabase
      .from("team_members")
      .select("user_id")
      .eq("team_id", targetId)
      .eq("role", "captain")
      .limit(1)
      .maybeSingle(),
  ]);
  if (teamError) throw teamError;
  if (captainError) throw captainError;
  if (!team?.id) {
    const error = new Error("team_not_found");
    error.statusCode = 404;
    throw error;
  }
  if (captainRequired && !captain?.user_id) {
    const error = new Error("team_captain_not_found");
    error.statusCode = 404;
    throw error;
  }
  return { team, captainId: captain?.user_id ?? null };
}

export async function assertCanSubmitTeamEmblemReport(context, targetId) {
  const { team, captainId } = await loadReportableTeam(
    context,
    targetId,
    "id,name,emblem_key,emblem_source,emblem_updated_at,deleted_at",
    { captainRequired: true },
  );
  if (captainId === context.profileId) {
    const error = new Error("cannot_report_own_team_emblem");
    error.statusCode = 400;
    throw error;
  }
  if (team.emblem_source !== "upload" || !team.emblem_key) {
    const error = new Error("team_emblem_not_reportable");
    error.statusCode = 400;
    throw error;
  }
  return {
    reportedUserIds: [captainId],
    verifiedPayload: {
      teamName: team.name,
      captainId,
      emblemKey: team.emblem_key,
      emblemSource: team.emblem_source,
      emblemUpdatedAt: team.emblem_updated_at,
    },
  };
}

export async function assertCanSubmitTeamNameReport(context, targetId) {
  const { team, captainId } = await loadReportableTeam(
    context,
    targetId,
    "id,name,deleted_at",
  );
  if (captainId === context.profileId) {
    const error = new Error("cannot_report_own_team_name");
    error.statusCode = 400;
    throw error;
  }
  return {
    reportedUserIds: captainId ? [captainId] : [],
    verifiedPayload: { teamName: team.name, captainId },
  };
}

export async function assertCanSubmitAffiliationNameReport(context, targetId) {
  const { data: affiliation, error: affiliationError } = await context.supabase
    .from("affiliations")
    .select("id,name,type,status,created_by,member_count")
    .eq("id", targetId)
    .eq("type", "organization")
    .eq("status", "active")
    .maybeSingle();
  if (affiliationError) throw affiliationError;
  if (!affiliation?.id) {
    const error = new Error("affiliation_not_found");
    error.statusCode = 404;
    throw error;
  }
  if (affiliation.created_by === context.profileId) {
    const error = new Error("cannot_report_own_affiliation_name");
    error.statusCode = 400;
    throw error;
  }
  return {
    reportedUserIds: affiliation.created_by ? [affiliation.created_by] : [],
    verifiedPayload: {
      affiliationName: affiliation.name,
      affiliationCreatedBy: affiliation.created_by,
      affiliationMemberCount: Number(affiliation.member_count ?? 0),
    },
  };
}
