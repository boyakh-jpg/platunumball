import { isEligibleReferee } from "../../shared/lib/refereeEligibility.js";

function mapRefereeAppointment(row = {}) {
  return {
    userId: row.user_id,
    role: row.role,
    grade: row.grade,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
  };
}

export async function isActiveReferee(supabase, userId) {
  if (!userId) return false;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile) return false;

  const { data: appointments, error } = await supabase
    .from("referee_appointments")
    .select("user_id, role, grade, status, starts_at, ends_at")
    .eq("user_id", userId)
    .eq("role", "referee")
    .eq("status", "active");
  if (error) throw error;

  return isEligibleReferee({ id: profile.id }, undefined, (appointments ?? []).map(mapRefereeAppointment));
}
