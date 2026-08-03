import { allowRequestMethod, getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import { fromRemoteProfile } from "../../../shared/lib/profileMappers.js";
import { PROFILE_CARD_COLUMNS, PROFILE_ME_COLUMNS } from "../../../shared/lib/repositoryColumns.js";
import { isRefereeGrade } from "../../../shared/lib/constants.js";
import { loadCompactMatchList } from "../matches/list.js";

function isActiveAppointment(row = {}, now = Date.now()) {
  const startsAt = row.starts_at ? new Date(row.starts_at).getTime() : 0;
  const endsAt = row.ends_at ? new Date(row.ends_at).getTime() : Number.POSITIVE_INFINITY;
  return row.status === "active"
    && isRefereeGrade(row.grade)
    && (!Number.isFinite(startsAt) || startsAt <= now)
    && (!Number.isFinite(endsAt) || now <= endsAt);
}

function countRefereeMatches(supabase, refereeId, field = "") {
  let query = supabase
    .from("matches")
    .select("id", { count: "exact", head: true })
    .eq("referee_id", refereeId)
    .eq("status", "confirmed")
    .or("visibility.neq.private,visibility.is.null");
  if (field) query = query.eq(field, true);
  return query;
}

export default async function handler(request, response) {
  if (!allowRequestMethod(request, response)) return;

  try {
    const body = await readJsonBody(request);
    const refereeId = String(body.refereeId ?? "").trim();
    if (!refereeId) {
      sendJson(response, 400, { error: "referee_id_required" });
      return;
    }
    const context = await getAuthenticatedContext(request, { allowMissingProfile: true, profileSelect: PROFILE_ME_COLUMNS });
    const limit = Math.max(1, Math.min(20, Math.floor(Number(body.limit) || 12)));
    const [profileResult, appointmentResult, matchResult, totalResult, rankedResult, officialResult] = await Promise.all([
      context.supabase.from("profiles").select(PROFILE_CARD_COLUMNS).eq("id", refereeId).maybeSingle(),
      context.supabase
        .from("referee_appointments")
        .select("id,user_id,role,grade,status,starts_at,ends_at")
        .eq("user_id", refereeId)
        .eq("role", "referee")
        .order("created_at", { ascending: false })
        .limit(10),
      loadCompactMatchList(context, {
        refereeProfileId: refereeId,
        includeRecruitingSchedule: false,
        includeClosedNotices: false,
      }, 0, limit),
      countRefereeMatches(context.supabase, refereeId),
      countRefereeMatches(context.supabase, refereeId, "ranked"),
      countRefereeMatches(context.supabase, refereeId, "official"),
    ]);
    if (profileResult.error) throw profileResult.error;
    if (appointmentResult.error) throw appointmentResult.error;
    if (totalResult.error) throw totalResult.error;
    if (rankedResult.error) throw rankedResult.error;
    if (officialResult.error) throw officialResult.error;
    const appointment = (appointmentResult.data ?? []).find((row) => isActiveAppointment(row));
    if (!profileResult.data || !appointment) {
      sendJson(response, 404, { error: "referee_not_found", refereeId });
      return;
    }

    const referee = {
      ...fromRemoteProfile(profileResult.data),
      refereeGrade: appointment.grade,
      refereeProfile: {
        grade: appointment.grade,
        status: appointment.status,
        startsAt: appointment.starts_at,
        endsAt: appointment.ends_at,
      },
    };
    const matches = matchResult.state?.matches ?? [];
    sendJson(response, 200, {
      ok: true,
      referee,
      stats: {
        completed: Number(totalResult.count ?? 0),
        ranked: Number(rankedResult.count ?? 0),
        official: Number(officialResult.count ?? 0),
        recent: matches.length,
        lastMatchAt: matches[0]?.confirmedAt ?? matches[0]?.endedAt ?? null,
      },
      state: {
        ...matchResult.state,
        users: [
          referee,
          ...(matchResult.state?.users ?? []).filter((user) => user.id !== referee.id),
        ],
      },
    });
  } catch (error) {
    sendJson(response, error.statusCode || 500, { error: error.message || "referee_detail_failed" });
  }
}
