import { randomUUID } from "node:crypto";
import { loadAuthoritativeState } from "../_authoritativeState.js";

import { PUBLIC_ROOM_PARTICIPATION_ACTIONS } from "./_syncPostPolicy.js";
import { reject } from "./_syncPostCommon.js";
import { isMissingSqlReducer, applyRecruitingManagementAction } from "./_syncPostManagementActions.js";
export { appendRemakeInvitationContext } from "./_syncPostManagementActions.js";


async function expireRecruitingRoomChangeIfDue(context, postId = "", roomState = null) {
  const proposal = roomState?.scheduleProposal;
  const deadlineMs = proposal?.consentDeadlineAt ? new Date(proposal.consentDeadlineAt).getTime() : Number.NaN;
  if (roomState && (
    proposal?.status !== "pending"
    || !Number.isFinite(deadlineMs)
    || deadlineMs > Date.now()
  )) return proposal?.status ?? "none";
  const { data, error } = await context.supabase.rpc("rankball_recruiting_expire_room_change", {
    p_post_id: postId,
  });
  if (error) throw error;
  return data?.status ?? proposal?.status ?? "none";
}

export async function assertPublicRoomParticipationAllowed(context, operation = {}) {
  if (!PUBLIC_ROOM_PARTICIPATION_ACTIONS.has(operation.action)) return;
  const postId = String(operation.postId ?? "").trim();
  if (!postId) return;
  const [{ data: post, error: postError }, { data: discipline, error: disciplineError }] = await Promise.all([
    context.supabase.from("recruiting_posts").select("visibility,room_state").eq("id", postId).maybeSingle(),
    context.supabase
      .from("admin_disciplinary_actions")
      .select("id,ends_at")
      .eq("user_id", context.profileId)
      .eq("type", "public_room_suspension")
      .eq("status", "active")
      .lte("starts_at", new Date().toISOString())
      .or(`ends_at.is.null,ends_at.gt.${new Date().toISOString()}`)
      .limit(1)
      .maybeSingle(),
  ]);
  if (postError) throw postError;
  if (disciplineError) throw disciplineError;
  const proposalStatus = await expireRecruitingRoomChangeIfDue(context, postId, post?.room_state ?? {});
  if (proposalStatus === "pending") reject(409, "recruiting_schedule_change_pending");
  if ((post?.visibility ?? "public") === "public" && discipline?.id) reject(403, "public_room_participation_suspended");
}

export async function assertRecruitingRoomChangeComplete(context, postId = "") {
  const safePostId = String(postId ?? "").trim();
  if (!safePostId) reject(400, "recruiting_post_id_required");
  await expireRecruitingRoomChangeIfDue(context, safePostId);
  const { data: post, error } = await context.supabase
    .from("recruiting_posts")
    .select("room_state")
    .eq("id", safePostId)
    .maybeSingle();
  if (error) throw error;
  if (!post) reject(404, "recruiting_post_not_found");
  const roomState = post.room_state ?? {};
  if (roomState.scheduleProposal?.status === "pending") {
    reject(409, "recruiting_schedule_change_pending");
  }
  const requiredIds = [...new Set((roomState.ruleAcknowledgementRequiredIds ?? []).filter(Boolean))];
  const acknowledgedIds = new Set((roomState.ruleAcknowledgedIds ?? []).filter(Boolean));
  if (requiredIds.some((profileId) => !acknowledgedIds.has(profileId))) {
    reject(409, "recruiting_rule_acknowledgement_pending");
  }
}

export const SQL_REDUCER_RECRUITING_ACTIONS = new Set([
  "acknowledgeRecruitingRoomRules",
  "createRecruitingPost",
  "acceptRecruitingInvitation",
  "cancelRecruitingParticipation",
  "declineRecruitingInvitation",
  "interestRecruitingPost",
  "inviteRecruitingPlayers",
  "inviteRecruitingReferee",
  "closeRecruitingPost",
  "setRecruitingRoomTeam",
  "setRecruitingApplicantPlacement",
  "setRecruitingApplicantReserve",
  "setRecruitingSlotPosition",
  "updateRecruitingRoomRules",
  "respondRecruitingScheduleProposal",
  "joinRecruitingSideParty",
  "setRecruitingPartyPlayerPlacement",
  "setRecruitingPartyPlayerReserve",
  "setRecruitingTeamPartyRoster",
  "detachRecruitingPartyPlayer",
  "removeRecruitingPartyPlayer",
  "kickRecruitingApplicant",
]);

const MANAGEMENT_SQL_RECRUITING_ACTIONS = new Set([
  "createRecruitingPost",
  "acceptRecruitingInvitation",
  "declineRecruitingInvitation",
  "inviteRecruitingPlayers",
  "inviteRecruitingReferee",
  "updateRecruitingRoomRules",
  "setRecruitingApplicantPlacement",
  "setRecruitingApplicantReserve",
  "joinRecruitingSideParty",
  "setRecruitingPartyPlayerPlacement",
  "setRecruitingPartyPlayerReserve",
  "setRecruitingTeamPartyRoster",
  "detachRecruitingPartyPlayer",
  "removeRecruitingPartyPlayer",
  "kickRecruitingApplicant",
]);



export function shouldUseSqlRecruitingAction(operation = {}) {
  return SQL_REDUCER_RECRUITING_ACTIONS.has(String(operation?.action ?? ""));
}

export function withRecruitingCreatePostId(operation = null) {
  if (!operation || operation.action !== "createRecruitingPost") return operation;
  if (operation.preferredPostId || operation.postId || operation.draft?.id) return operation;
  return {
    ...operation,
    preferredPostId: `q_${Date.now().toString(36)}_${randomUUID().replace(/-/g, "").slice(0, 10)}`,
  };
}

function rejectSqlRecruitingFallback(data = {}) {
  if (!data?.fallback) return;
  reject(409, String(data.reason || "recruiting_operation_blocked"));
}

export async function loadSyncedRecruitingState(context, postId = "") {
  if (!postId) return { state: null, post: null };
  const state = await loadAuthoritativeState(context, { operation: { action: "loadRecruitingPost", postId } });
  return {
    state,
    post: (state.recruitingPosts ?? []).find((post) => post.id === postId) ?? null,
  };
}











export async function applySqlRecruitingAction(context, operation = {}) {
  if (operation.action === "setRecruitingRoomTeam") {
    const postId = String(operation.postId ?? "").trim();
    const teamId = String(operation.teamId ?? "").trim();
    const side = operation.side === "teamA" || operation.side === "teamB" ? operation.side : "";
    if (!postId) reject(400, "missing_recruiting_post");
    if (!teamId) reject(400, "recruiting_team_required");
    if (!side) reject(400, "invalid_recruiting_team_side");
    const { data, error } = await context.supabase.rpc("rankball_recruiting_set_room_team_action", {
      p_actor_profile_id: context.profileId,
      p_post_id: postId,
      p_side: side,
      p_team_id: teamId,
    });
    if (error) {
      if (isMissingSqlReducer(error)) reject(503, "recruiting_set_room_team_rpc_required");
      throw error;
    }
    return { ok: true, ...(data && typeof data === "object" ? data : {}), postId };
  }
  if (operation.action === "acknowledgeRecruitingRoomRules" && operation.postId) {
    const { data, error } = await context.supabase.rpc("rankball_recruiting_rule_ack_action", {
      p_actor_profile_id: context.profileId,
      p_post_id: operation.postId,
      p_rule_revision: Number(operation.revision ?? 0),
    });
    if (error) {
      if (isMissingSqlReducer(error)) reject(503, "recruiting_rule_ack_rpc_required");
      throw error;
    }
    return { ok: true, ...(data && typeof data === "object" ? data : {}), postId: operation.postId };
  }

  if (operation.action === "respondRecruitingScheduleProposal" && operation.postId) {
    const { data, error } = await context.supabase.rpc("rankball_recruiting_schedule_response_action", {
      p_actor_profile_id: context.profileId,
      p_post_id: operation.postId,
      p_proposal_id: operation.proposalId ?? "",
      p_decision: operation.decision ?? "approve",
    });
    if (error) {
      if (isMissingSqlReducer(error)) reject(503, "recruiting_schedule_response_rpc_required");
      throw error;
    }
    return { ok: true, ...(data && typeof data === "object" ? data : {}), postId: operation.postId };
  }

  if (operation.action === "updateRecruitingRoomRules" && operation.postId) {
    const { data, error } = await context.supabase.rpc("rankball_recruiting_room_update_action", {
      p_actor_profile_id: context.profileId,
      p_post_id: operation.postId,
      p_patch: operation.patch ?? {},
    });
    if (error) {
      if (isMissingSqlReducer(error)) reject(503, "recruiting_room_update_rpc_required");
      throw error;
    }
    rejectSqlRecruitingFallback(data);
    return {
      ok: true,
      ...(data && typeof data === "object" ? data : {}),
      postId: operation.postId,
    };
  }

  if (operation.action === "joinRecruitingSideParty" && (operation.entryId === "host" || String(operation.entryId ?? "").startsWith("team:"))) {
    const { data, error } = await context.supabase.rpc("rankball_recruiting_side_party_join_action", {
      p_actor_profile_id: context.profileId,
      p_post_id: operation.postId,
      p_team_id: operation.teamId,
      p_side: operation.sideName ?? "",
      p_entry_id: operation.entryId ?? "",
    });
    if (error) {
      if (isMissingSqlReducer(error)) reject(503, "recruiting_side_party_join_rpc_unavailable");
      throw error;
    }
    return {
      ok: true,
      ...(data && typeof data === "object" ? data : {}),
      postId: operation.postId,
    };
  }

  if (MANAGEMENT_SQL_RECRUITING_ACTIONS.has(operation.action)) {
    return applyRecruitingManagementAction(context, operation);
  }

  if (operation.action === "closeRecruitingPost") {
    const { data, error } = await context.supabase.rpc("rankball_recruiting_close_with_reason_action", {
      p_actor_profile_id: context.profileId,
      p_post_id: operation.postId,
      p_reason: operation.reason ?? "",
    });
    if (error) {
      if (isMissingSqlReducer(error)) return null;
      throw error;
    }
    return {
      ok: true,
      ...(data && typeof data === "object" ? data : {}),
      postId: operation.postId,
    };
  }

  if (operation.action === "inviteRecruitingPlayers") {
    const invite = operation.invite && typeof operation.invite === "object"
      ? operation.invite
      : {};
    const { data, error } = await context.supabase.rpc("rankball_recruiting_invite_players_action", {
      p_actor_profile_id: context.profileId,
      p_post_id: operation.postId,
      p_target_user_ids: invite.playerIds ?? [invite.playerId].filter(Boolean),
      p_side: invite.side ?? "teamB",
      p_reserve: Boolean(invite.reserve),
      p_join_mode: invite.joinMode ?? "player",
      p_team_id: invite.teamId ?? "",
    });
    if (error) {
      if (isMissingSqlReducer(error)) return null;
      throw error;
    }
    rejectSqlRecruitingFallback(data);
    return {
      ok: true,
      ...(data && typeof data === "object" ? data : {}),
      postId: operation.postId,
    };
  }

  if (["acceptRecruitingInvitation", "declineRecruitingInvitation"].includes(operation.action)) {
    const { data, error } = await context.supabase.rpc("rankball_recruiting_invitation_decision_action", {
      p_actor_profile_id: context.profileId,
      p_post_id: operation.postId,
      p_invitation_id: operation.invitationId ?? "",
      p_action: operation.action,
    });
    if (error) {
      if (isMissingSqlReducer(error)) return null;
      throw error;
    }
    if (data?.fallback) return applyRecruitingManagementAction(context, operation);
    rejectSqlRecruitingFallback(data);
    return {
      ok: true,
      ...(data && typeof data === "object" ? data : {}),
      postId: operation.postId,
    };
  }

  if (operation.action === "interestRecruitingPost") {
    const application = operation.application && typeof operation.application === "object"
      ? operation.application
      : {};
    if ((application.joinMode ?? operation.joinMode) === "referee") {
      return applyRecruitingManagementAction(context, operation);
    }
    const { data, error } = await context.supabase.rpc("rankball_recruiting_interest_player_action", {
      p_actor_profile_id: context.profileId,
      p_post_id: operation.postId,
      p_join_mode: application.joinMode ?? operation.joinMode ?? "",
      p_team_id: application.teamId ?? "",
      p_side: application.side ?? "",
      p_reserve: Boolean(application.reserve),
      p_position: application.position ?? "",
    });
    if (error) {
      if (isMissingSqlReducer(error)) return null;
      throw error;
    }
    if (data?.fallback) return applyRecruitingManagementAction(context, operation);
    return {
      ok: true,
      ...(data && typeof data === "object" ? data : {}),
      postId: operation.postId,
    };
  }

  if (operation.action === "cancelRecruitingParticipation") {
    const { data, error } = await context.supabase.rpc("rankball_recruiting_cancel_participation_action", {
      p_actor_profile_id: context.profileId,
      p_post_id: operation.postId,
    });
    if (error) {
      if (isMissingSqlReducer(error)) return null;
      throw error;
    }
    return {
      ok: true,
      ...(data && typeof data === "object" ? data : {}),
      postId: operation.postId,
    };
  }

  if (operation.action === "setRecruitingApplicantPlacement") {
    const placement = operation.placement && typeof operation.placement === "object"
      ? operation.placement
      : {};
    const { data, error } = await context.supabase.rpc("rankball_recruiting_applicant_placement_action", {
      p_actor_profile_id: context.profileId,
      p_post_id: operation.postId,
      p_player_id: operation.playerId ?? context.profileId,
      p_side: placement.side ?? "",
      p_reserve: Boolean(placement.reserve),
    });
    if (error) {
      if (isMissingSqlReducer(error)) return null;
      throw error;
    }
    rejectSqlRecruitingFallback(data);
    return {
      ok: true,
      ...(data && typeof data === "object" ? data : {}),
      postId: operation.postId,
    };
  }

  if (operation.action !== "setRecruitingSlotPosition") return null;
  const { data, error } = await context.supabase.rpc("rankball_recruiting_slot_position_action", {
    p_actor_profile_id: context.profileId,
    p_post_id: operation.postId,
    p_player_id: operation.playerId ?? context.profileId,
    p_position: operation.position ?? "",
  });
  if (error) {
    if (isMissingSqlReducer(error)) return null;
    throw error;
  }
  return {
    ok: true,
    ...(data && typeof data === "object" ? data : {}),
    postId: operation.postId,
  };
}
