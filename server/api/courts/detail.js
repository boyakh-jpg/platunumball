import { getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import { fromRemoteApprovedCourt } from "../../../src/data/remotePayloadMappers.js";
import { fromRemoteProfile } from "../../../src/data/profileMappers.js";
import {
  APPROVED_COURT_COLUMNS,
  PUBLIC_PROFILE_COLUMNS,
} from "../../../src/data/repositoryColumns.js";

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
    const { data: courtRow, error: courtError } = await context.supabase
      .from("approved_courts")
      .select(APPROVED_COURT_COLUMNS)
      .eq("id", courtId)
      .eq("status", "active")
      .maybeSingle();
    if (courtError) throw courtError;
    if (!courtRow) {
      sendJson(response, 404, { error: "court_not_found" });
      return;
    }

    const court = fromRemoteApprovedCourt(courtRow);
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
