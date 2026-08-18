import { allowRequestMethod, getAuthenticatedContext, getSupabaseAdminClient, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import { normalizeKakaoOpenProfileUrl } from "../../../shared/lib/externalNotifications.js";
import { getBlockedUserIds, isTerminalMatchStatus, isTerminalRecruitingStatus } from "../../../shared/lib/notifications.js";

function addIds(target, values) {
  (Array.isArray(values) ? values : [values]).forEach((value) => {
    const id = String(value ?? "").trim();
    if (id) target.add(id);
  });
}

function addRoomStateIds(target, roomState = {}) {
  addIds(target, [roomState.ownerId, roomState.refereeId, roomState.hostId]);
  Object.values(roomState.partyLeaders ?? {}).forEach((value) => addIds(target, value));
  Object.values(roomState.partyReserves ?? {}).forEach((value) => addIds(target, value));
  addIds(target, roomState.pinnedReservePlayers);
}

async function loadContextParticipantIds(supabase, context) {
  if (context.kind === "match") {
    const [matchResult, playerResult] = await Promise.all([
      supabase.from("matches").select("id,status,created_by,referee_id,reserve_players,started_at,ended_at,cancelled_at,voided_at").eq("id", context.id).maybeSingle(),
      supabase.from("match_players").select("user_id").eq("match_id", context.id),
    ]);
    if (matchResult.error) throw matchResult.error;
    if (playerResult.error) throw playerResult.error;
    const match = matchResult.data;
    if (!match || isTerminalMatchStatus(match.status) || match.ended_at || match.cancelled_at || match.voided_at) return null;
    const ids = new Set();
    addIds(ids, [match.created_by, match.referee_id]);
    addIds(ids, (playerResult.data ?? []).map((row) => row.user_id));
    Object.values(match.reserve_players ?? {}).forEach((value) => addIds(ids, value));
    return ids;
  }

  if (context.kind === "recruiting") {
    const [postResult, applicationResult] = await Promise.all([
      supabase.from("recruiting_posts").select("id,status,player_id,player_ids,referee_id,room_state").eq("id", context.id).maybeSingle(),
      supabase.from("recruiting_applications").select("player_id,player_ids,status").eq("post_id", context.id),
    ]);
    if (postResult.error) throw postResult.error;
    if (applicationResult.error) throw applicationResult.error;
    const post = postResult.data;
    if (!post || isTerminalRecruitingStatus(post.status)) return null;
    const ids = new Set();
    addIds(ids, [post.player_id, post.referee_id]);
    addIds(ids, post.player_ids);
    addRoomStateIds(ids, post.room_state);
    (applicationResult.data ?? []).filter((row) => ["waiting", "ready", "accepted", "confirmed"].includes(String(row.status ?? "").toLowerCase())).forEach((row) => {
      addIds(ids, row.player_id);
      addIds(ids, row.player_ids);
    });
    return ids;
  }
  return null;
}

export function canResolveExternalContact({ requesterId, targetId, participantIds, blocked = false }) {
  return Boolean(
    requesterId
    && targetId
    && requesterId !== targetId
    && participantIds?.has(requesterId)
    && participantIds?.has(targetId)
    && !blocked
  );
}

export default async function handler(request, response) {
  if (!allowRequestMethod(request, response, ["POST"])) return;
  try {
    const body = await readJsonBody(request, { maxBytes: 4_000, maxStringLength: 500 });
    const auth = await getAuthenticatedContext(request);
    const supabase = getSupabaseAdminClient();
    const targetId = String(body.targetProfileId ?? "").trim();
    const context = { kind: String(body.context?.kind ?? ""), id: String(body.context?.id ?? "").trim() };
    if (!targetId || !context.id || !["match", "recruiting"].includes(context.kind)) {
      sendJson(response, 400, { error: "invalid_contact_context" });
      return;
    }

    const participantIds = await loadContextParticipantIds(supabase, context);
    if (!participantIds?.has(auth.profileId) || !participantIds.has(targetId) || targetId === auth.profileId) {
      sendJson(response, 200, { ok: true, contact: null });
      return;
    }

    const [blockResult, profileResult, contactResult] = await Promise.all([
      supabase.from("external_contact_blocks").select("blocker_profile_id,blocked_profile_id").in("blocker_profile_id", [auth.profileId, targetId]).in("blocked_profile_id", [auth.profileId, targetId]),
      supabase.from("profiles").select("id,app_settings").in("id", [auth.profileId, targetId]),
      supabase.from("external_contact_preferences").select("enabled,kakao_enabled,kakao_open_profile_url").eq("profile_id", targetId).maybeSingle(),
    ]);
    if (blockResult.error) throw blockResult.error;
    if (profileResult.error) throw profileResult.error;
    if (contactResult.error) throw contactResult.error;
    const profileById = new Map((profileResult.data ?? []).map((profile) => [profile.id, profile]));
    const legacyBlocked = getBlockedUserIds(profileById.get(auth.profileId)?.app_settings).includes(targetId)
      || getBlockedUserIds(profileById.get(targetId)?.app_settings).includes(auth.profileId);
    if (!canResolveExternalContact({ requesterId: auth.profileId, targetId, participantIds, blocked: legacyBlocked || (blockResult.data ?? []).length > 0 })) {
      sendJson(response, 200, { ok: true, contact: null });
      return;
    }

    const preference = contactResult.data;
    const url = normalizeKakaoOpenProfileUrl(preference?.kakao_open_profile_url);
    const contact = preference?.enabled === true && preference?.kakao_enabled === true && url
      ? { kind: "kakao", url }
      : null;
    sendJson(response, 200, { ok: true, contact });
  } catch (error) {
    console.error("External contact resolution failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "external_contact_resolution_failed" });
  }
}
