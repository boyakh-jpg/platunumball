export function isTrue(value) {
  return value === true || value === "true";
}

export function reject(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

export function getRecruitingBenchPolicyError(error = {}) {
  const errorText = [error.message, error.details, error.hint].filter(Boolean).join(" ");
  if (errorText.includes("invalid_bench_capacity")) return { statusCode: 400, message: "invalid_bench_capacity" };
  if (errorText.includes("recruiting_side_capacity_below_roster")) return { statusCode: 409, message: "recruiting_side_capacity_below_roster" };
  if (errorText.includes("recruiting_bench_capacity_below_roster")) return { statusCode: 409, message: "recruiting_bench_capacity_below_roster" };
  if (errorText.includes("pickup_participant_capacity_below_pool")) return { statusCode: 409, message: "pickup_participant_capacity_below_pool" };
  if (errorText.includes("recruiting_reserve_full")) return { statusCode: 409, message: "recruiting_reserve_full" };
  if (errorText.includes("room_edit_limit_reached")) return { statusCode: 409, message: "room_edit_limit_reached" };
  if (errorText.includes("room_edit_window_closed")) return { statusCode: 409, message: "room_edit_window_closed" };
  if (errorText.includes("room_schedule_target_too_soon")) return { statusCode: 409, message: "room_schedule_target_too_soon" };
  if (errorText.includes("room_cancel_locked")) return { statusCode: 409, message: "room_cancel_locked" };
  if (errorText.includes("room_remake_source_not_found")) return { statusCode: 404, message: "room_remake_source_not_found" };
  if (errorText.includes("room_remake_owner_required")) return { statusCode: 403, message: "room_remake_owner_required" };
  if (errorText.includes("room_remake_source_not_terminal") || errorText.includes("room_remake_source_mismatch")) {
    return { statusCode: 409, message: errorText.includes("mismatch") ? "room_remake_source_mismatch" : "room_remake_source_not_terminal" };
  }
  if (errorText.includes("recruiting_room_edit_locked")) return { statusCode: 409, message: "recruiting_room_edit_locked" };
  if (errorText.includes("room_meeting_point_required")) return { statusCode: 400, message: "room_meeting_point_required" };
  if (errorText.includes("match_regulation_duration_exceeded")) return { statusCode: 400, message: "match_regulation_duration_exceeded" };
  if (errorText.includes("court_not_found") || errorText.includes("invalid_room_court")) return { statusCode: 400, message: "invalid_room_court" };
  return null;
}
