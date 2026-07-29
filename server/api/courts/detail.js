import { getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import { fromRemoteApprovedCourt } from "../../../shared/lib/remotePayloadMappers.js";
import { fromRemoteProfile } from "../../../shared/lib/profileMappers.js";
import {
  APPROVED_COURT_COLUMNS,
  PUBLIC_PROFILE_COLUMNS,
} from "../../../shared/lib/repositoryColumns.js";

const LEGACY_COURT_DETAIL_COLUMNS = "id,name,region,type,region_key,address_text,road_address,jibun_address,lat,lng,raw_rating,adjusted_rating,review_count,completed_match_count,recommendation_score,recent_reviews,metrics_updated_at,payload,created_at";
const COURT_FACILITY_INFO_COLUMNS = "court_id,operator_name,contact_phone,official_url,reservation_url,opening_hours_text,application_method,access_note,detail_address,location_note,facility_area_sqm,facility_area_scope,updated_at";

function fromLegacyCourt(row = {}) {
  const payload = row.payload ?? {};
  return {
    ...payload,
    id: row.id,
    name: row.name ?? payload.name,
    region: row.region ?? payload.region,
    regionKey: row.region_key ?? payload.regionKey ?? row.region ?? payload.region,
    type: row.type ?? payload.type ?? "확인 필요",
    addressText: row.address_text ?? payload.addressText ?? "",
    roadAddress: row.road_address ?? payload.roadAddress ?? null,
    jibunAddress: row.jibun_address ?? payload.jibunAddress ?? null,
    lat: row.lat ?? payload.lat ?? null,
    lng: row.lng ?? payload.lng ?? null,
    status: "active",
    rawRating: row.raw_rating ?? payload.rawRating ?? null,
    adjustedRating: row.adjusted_rating ?? payload.adjustedRating ?? null,
    reviewCount: Number(row.review_count ?? payload.reviewCount ?? 0),
    completedMatchCount: Number(row.completed_match_count ?? payload.completedMatchCount ?? 0),
    recommendationScore: row.recommendation_score ?? payload.recommendationScore ?? null,
    recentReviews: row.recent_reviews ?? payload.recentReviews ?? [],
    metricsUpdatedAt: row.metrics_updated_at ?? payload.metricsUpdatedAt ?? null,
    createdAt: row.created_at ?? payload.createdAt ?? null,
  };
}

function fromCourtFacilityInfo(row = {}) {
  if (!row?.court_id) return {};
  return {
    operatorName: row.operator_name ?? null,
    contactPhone: row.contact_phone ?? null,
    officialUrl: row.official_url ?? null,
    reservationUrl: row.reservation_url ?? null,
    openingHoursText: row.opening_hours_text ?? null,
    applicationMethod: row.application_method ?? null,
    accessNote: row.access_note ?? null,
    detailAddress: row.detail_address ?? null,
    locationNote: row.location_note ?? null,
    facilityAreaSqm: row.facility_area_sqm ?? null,
    facilityAreaScope: row.facility_area_scope ?? null,
    facilityInfoUpdatedAt: row.updated_at ?? null,
  };
}

function toReview(row = {}, reviewer = null, includeRawRating = false) {
  return {
    id: row.review_id,
    courtId: row.court_id,
    courtName: row.court_name,
    matchId: row.match_id,
    reviewerId: row.reviewer_id,
    ...(includeRawRating ? { rating: Number(row.raw_rating ?? 0) } : {}),
    adjustedRating: Number(row.adjusted_rating ?? row.raw_rating ?? 0),
    surfaceRating: row.surface_rating,
    rimRating: row.rim_rating,
    lightingRating: row.lighting_rating,
    crowdRating: row.crowd_rating,
    locationAccuracy: row.location_accuracy,
    fitModes: row.fit_modes ?? [],
    tags: row.tags ?? [],
    memo: row.memo ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reviewer: reviewer ? {
      id: reviewer.id,
      name: reviewer.name,
      hashtag: reviewer.hashtag,
      avatarColor: reviewer.avatarColor,
      avatarKey: reviewer.avatarKey ?? null,
      avatarSource: reviewer.avatarSource ?? "initial",
      avatarIconKey: reviewer.avatarIconKey ?? null,
      avatarUpdatedAt: reviewer.avatarUpdatedAt ?? null,
      avatarBackgroundEnabled: reviewer.avatarBackgroundEnabled !== false,
      avatarBorderEnabled: reviewer.avatarBorderEnabled === true,
      avatarBorderColor: reviewer.avatarBorderColor ?? reviewer.avatarColor,
      discordAvatarUrl: reviewer.discordAvatarUrl ?? null,
    } : null,
  };
}

function toReviewableMatch(match = {}, review = null) {
  return {
    id: match.id,
    title: match.title,
    status: match.status,
    scheduledAt: match.scheduled_at,
    scheduledDate: match.scheduled_date,
    scheduledTime: match.scheduled_time,
    endedAt: match.ended_at,
    confirmedAt: match.confirmed_at,
    existingReview: review,
  };
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const courtId = String(body.courtId ?? "").trim().slice(0, 120);
    if (!courtId) {
      sendJson(response, 400, { error: "court_id_required" });
      return;
    }

    const context = await getAuthenticatedContext(request);
    const { data: approvedCourtRow, error: courtError } = await context.supabase
      .from("approved_courts")
      .select(APPROVED_COURT_COLUMNS)
      .eq("id", courtId)
      .maybeSingle();
    if (courtError) throw courtError;
    if (approvedCourtRow && approvedCourtRow.status != null && approvedCourtRow.status !== "active") {
      sendJson(response, 404, { error: "court_not_found" });
      return;
    }

    const { data: facilityInfoRow, error: facilityInfoError } = approvedCourtRow
      ? await context.supabase
        .from("court_facility_info")
        .select(COURT_FACILITY_INFO_COLUMNS)
        .eq("court_id", courtId)
        .maybeSingle()
      : { data: null, error: null };
    if (facilityInfoError) throw facilityInfoError;

    const { data: legacyCourtRow, error: legacyCourtError } = approvedCourtRow
      ? { data: null, error: null }
      : await context.supabase
        .from("courts")
        .select(LEGACY_COURT_DETAIL_COLUMNS)
        .eq("id", courtId)
        .maybeSingle();
    if (legacyCourtError) throw legacyCourtError;
    if (!approvedCourtRow && !legacyCourtRow) {
      sendJson(response, 404, { error: "court_not_found" });
      return;
    }

    const court = approvedCourtRow
      ? { ...fromRemoteApprovedCourt(approvedCourtRow), ...fromCourtFacilityInfo(facilityInfoRow) }
      : fromLegacyCourt(legacyCourtRow);
    const { data: reviewRows, error: reviewError } = await context.supabase.rpc(
      "rankball_court_detail_review_rows",
      { p_court_id: court.id, p_court_name: court.name, p_limit: 100 },
    );
    if (reviewError) throw reviewError;

    const reviewerIds = [...new Set((reviewRows ?? []).map((row) => row.reviewer_id).filter(Boolean))];
    const { data: profileRows, error: profileError } = reviewerIds.length
      ? await context.supabase.from("public_profiles").select(PUBLIC_PROFILE_COLUMNS).in("id", reviewerIds)
      : { data: [], error: null };
    if (profileError) throw profileError;
    const reviewers = new Map((profileRows ?? []).map((row) => {
      const profile = fromRemoteProfile(row);
      return [profile.id, profile];
    }));
    const reviews = (reviewRows ?? []).map((row) => (
      toReview(row, reviewers.get(row.reviewer_id), row.reviewer_id === context.profileId)
    ));

    const { data: matchRows, error: matchError } = await context.supabase.rpc(
      "rankball_court_reviewable_matches",
      {
        actor_profile_id: context.profileId,
        p_court_id: court.id,
        p_court_name: court.name,
        p_limit: 100,
      },
    );
    if (matchError) throw matchError;

    const ownReviews = new Map(
      reviews.filter((review) => review.reviewerId === context.profileId).map((review) => [review.matchId, review]),
    );
    const reviewableMatches = (matchRows ?? [])
      .map((match) => toReviewableMatch(match, ownReviews.get(match.id) ?? null));

    sendJson(response, 200, {
      ok: true,
      court,
      reviews,
      reviewableMatches,
    });
  } catch (error) {
    console.error("Court detail load failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "court_detail_load_failed" });
  }
}
