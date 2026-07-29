import { COURT_REQUEST_TRUST_MIN } from "../../shared/lib/constants.js";

export async function assertCourtRequestAccess(context) {
  const { data, error } = await context.supabase
    .from("profiles")
    .select("trust_score")
    .eq("id", context.profileId)
    .maybeSingle();
  if (error) throw error;
  if (Number(data?.trust_score ?? 0) >= COURT_REQUEST_TRUST_MIN) return;
  const accessError = new Error("court_request_trust_required");
  accessError.statusCode = 403;
  throw accessError;
}
