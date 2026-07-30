import { randomUUID } from "node:crypto";
import { DEFAULT_RATING } from "../../../shared/lib/matchConstants.js";
import { toArray } from "../_supabaseAdmin.js";
import { MATCH_SIDES } from "../../../shared/lib/constants.js";
import { loadAuthoritativeState } from "../_authoritativeState.js";
import { PUBLIC_ROOM_PARTICIPATION_ACTIONS, isPendingInvitation, normalizeAllowedAgeGroups } from "./_syncPostPolicy.js";
import { isTrue, reject } from "./_syncPostCommon.js";
import { getCanonicalBenchCapacity, normalizeRoomState } from "./_syncPostProjection.js";

export function isMissingSqlReducer(error = {}) {
  const message = String(error?.message ?? "");
  return (
    error?.code === "PGRST202" ||
    message.includes("rankball_recruiting_invitation_decision_action") ||
    message.includes("rankball_recruiting_invite_players_action") ||
    message.includes("rankball_recruiting_close_action") ||
    message.includes("rankball_recruiting_slot_position_action") ||
    message.includes("rankball_recruiting_cancel_participation_action") ||
    message.includes("rankball_recruiting_applicant_placement_action") ||
    message.includes("rankball_recruiting_interest_player_action") ||
    message.includes("rankball_recruiting_side_party_join_action") ||
    message.includes("rankball_recruiting_room_update_action") ||
    message.includes("rankball_recruiting_rule_ack_action") ||
    message.includes("rankball_recruiting_schedule_response_action") ||
    message.includes("rankball_recruiting_management_action") ||
    message.includes("rankball_recruiting_set_room_team_action")
  );
}

export async function appendRemakeInvitationContext(supabase, post = {}, operation = {}) {
  const contextMessage = String(
    operation.contextMessage
      ?? operation.invite?.contextMessage
      ?? "",
  ).trim().slice(0, 500);
  if (!contextMessage || !post?.id) return 0;

  const requestedTargetIds = new Set(
    (operation.invite?.playerIds ?? [operation.invite?.playerId])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean),
  );
  const invitationIds = toArray(post.roomState?.invitations)
    .filter((invitation) => {
      if (!isPendingInvitation(invitation)) return false;
      if (operation.action === "setRecruitingRoomTeam") {
        return invitation.teamId === operation.teamId && invitation.side === operation.side;
      }
      return requestedTargetIds.has(String(invitation.targetUserId ?? ""));
    })
    .map((invitation) => String(invitation.id ?? "").trim())
    .filter(Boolean);
  if (!invitationIds.length) return 0;

  const { data: notifications, error } = await supabase
    .from("notifications")
    .select("id,body,payload")
    .eq("recruiting_post_id", post.id)
    .in("invitation_id", invitationIds);
  if (error) throw error;

  await Promise.all((notifications ?? []).map(async (notification) => {
    const body = String(notification.body ?? "");
    const { error: updateError } = await supabase
      .from("notifications")
      .update({
        body: body.includes(contextMessage) ? body : [body, contextMessage].filter(Boolean).join("\n"),
        payload: {
          ...(notification.payload && typeof notification.payload === "object" ? notification.payload : {}),
          contextMessage,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", notification.id);
    if (updateError) throw updateError;
  }));
  return notifications?.length ?? 0;
}

export function getRequestedRecruitingRoster(operation = {}) {
  const activeIds = toArray(operation.roster?.playerIds).map((id) => String(id ?? "").trim()).filter(Boolean);
  const reserveIds = toArray(operation.roster?.reservePlayerIds).map((id) => String(id ?? "").trim()).filter(Boolean);
  return { activeIds, reserveIds, allIds: [...activeIds, ...reserveIds] };
}

export async function loadRecruitingPartyGuardSnapshot(context, operation = {}) {
  const postId = String(operation.postId ?? "").trim();
  const entryId = String(operation.entryId ?? "").trim();
  if (!postId || !entryId) reject(400, "recruiting_party_target_missing");

  const { data: post, error: postError } = await context.supabase
    .from("recruiting_posts")
    .select("id,team_id,player_id,host_side,host_join_mode,ranked,allowed_age_groups,age_restriction,rules,room_state,side_capacity,bench_capacity")
    .eq("id", postId)
    .maybeSingle();
  if (postError) throw postError;
  if (!post) reject(404, "recruiting_post_not_found");

  let application = null;
  const targetTeamId = entryId === "host"
    ? post.team_id
    : (entryId.startsWith("team:") ? entryId.slice(5).trim() : "");
  if (entryId !== "host" && targetTeamId) {
    const { data, error } = await context.supabase
      .from("recruiting_applications")
      .select("team_id,side")
      .eq("post_id", postId)
      .eq("team_id", targetTeamId)
      .eq("kind", "team")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    application = data;
  }

  const partySide = post.room_state?.partySides?.[entryId];
  const expectedSide = MATCH_SIDES.includes(partySide)
    ? partySide
    : (entryId === "host" ? post.host_side : application?.side);
  return { post, targetTeamId, expectedSide };
}

export async function assertRecruitingPartyManagementGuard(context, operation = {}) {
  if (!["detachRecruitingPartyPlayer", "setRecruitingTeamPartyRoster"].includes(operation.action)) return;
  const snapshot = await loadRecruitingPartyGuardSnapshot(context, operation);

  if (operation.action === "detachRecruitingPartyPlayer") {
    if (snapshot.post.host_join_mode === "team" || isTrue(snapshot.post.room_state?.teamOnly)) {
      reject(409, "team_room_party_detach_forbidden");
    }
    const requestedSide = MATCH_SIDES.includes(operation.placement?.side)
      ? operation.placement.side
      : null;
    if (requestedSide && snapshot.expectedSide && requestedSide !== snapshot.expectedSide) {
      reject(409, "recruiting_party_side_locked");
    }
    return;
  }

  if (!snapshot.targetTeamId) reject(404, "recruiting_team_not_found");
  const { activeIds, reserveIds, allIds } = getRequestedRecruitingRoster(operation);
  const uniqueIds = new Set(allIds);
  if (uniqueIds.size !== allIds.length) reject(409, "recruiting_party_roster_duplicate");
  if (activeIds.length > Number(snapshot.post.side_capacity ?? 5)) reject(409, "recruiting_side_full");
  if (reserveIds.length > getCanonicalBenchCapacity(snapshot.post)) reject(409, "recruiting_reserve_full");
  if (!allIds.length) return;

  const { data: members, error: memberError } = await context.supabase
    .from("team_members")
    .select("user_id")
    .eq("team_id", snapshot.targetTeamId)
    .in("user_id", allIds);
  if (memberError) throw memberError;
  const memberIds = new Set(toArray(members).map((row) => row.user_id));
  if (allIds.some((playerId) => !memberIds.has(playerId))) reject(403, "recruiting_team_roster_not_member");

  let targetMmr = DEFAULT_RATING;
  if (snapshot.post.team_id) {
    const { data: hostTeam, error: teamError } = await context.supabase
      .from("teams")
      .select("mmr")
      .eq("id", snapshot.post.team_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (teamError) throw teamError;
    if (!hostTeam) reject(404, "recruiting_host_team_not_found");
    targetMmr = Number(hostTeam.mmr ?? DEFAULT_RATING);
  } else if (snapshot.post.player_id) {
    const { data, error } = await context.supabase.rpc("rankball_event_profile_mmr", {
      p_profile_id: snapshot.post.player_id,
    });
    if (error) throw error;
    targetMmr = Number(data ?? DEFAULT_RATING);
  }

  const roomState = snapshot.post.room_state ?? {};
  const rules = snapshot.post.rules ?? {};
  const normalizedPolicyState = normalizeRoomState(roomState, snapshot.post);
  const mmrRangeMode = normalizedPolicyState.mmrRangeMode;
  const mmrLimitMode = normalizedPolicyState.mmrLimitMode;
  const allowedAgeGroups = normalizeAllowedAgeGroups(snapshot.post);
  const eligibilityResults = await Promise.all(allIds.map(async (playerId) => {
    const { data, error } = await context.supabase.rpc("rankball_event_profile_eligible", {
      p_profile_id: playerId,
      p_ranked: snapshot.post.ranked !== false,
      p_mmr_limit_mode: mmrLimitMode,
      p_target_mmr: targetMmr,
      p_mmr_range_mode: mmrRangeMode,
      p_allowed_age_groups: allowedAgeGroups,
    });
    if (error) throw error;
    return data === true;
  }));
  if (eligibilityResults.some((eligible) => !eligible)) reject(403, "team_roster_player_ineligible");
}

export async function applyRecruitingManagementAction(context, operation = {}) {
  await assertRecruitingPartyManagementGuard(context, operation);
  const { data, error } = await context.supabase.rpc("rankball_recruiting_management_action", {
    p_actor_profile_id: context.profileId,
    p_operation: operation,
  });
  if (error) {
    if (isMissingSqlReducer(error)) reject(503, "recruiting_management_rpc_unavailable");
    throw error;
  }
  const invitationExpired = data?.invitationExpired === true;
  const capacityReason = data?.reason === "recruiting_player_capacity_full"
    ? "recruiting_player_capacity_full"
    : data?.reason === "recruiting_reserve_full"
      ? "recruiting_reserve_full"
      : "";
  return {
    ok: invitationExpired ? false : true,
    ...(data && typeof data === "object" ? data : {}),
    ...(invitationExpired ? {
      ok: false,
      error: capacityReason || "recruiting_invitation_expired",
      message: data?.message || (
        capacityReason === "recruiting_reserve_full"
          ? "해당 후보 자리가 이미 찼습니다."
          : "방이 마감됐습니다. 먼저 수락한 선수만 참가합니다."
      ),
    } : {}),
    postId: data?.postId ?? operation.postId ?? operation.preferredPostId ?? operation.draft?.id,
  };
}
