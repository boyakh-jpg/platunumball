import { randomUUID } from "node:crypto";
import { DEFAULT_RATING } from "../../../shared/lib/matchConstants.js";
import { toArray } from "../_supabaseAdmin.js";
import { MATCH_SIDES } from "../../../shared/lib/constants.js";
import { loadAuthoritativeState } from "../_authoritativeState.js";

import { PUBLIC_ROOM_PARTICIPATION_ACTIONS, isPendingInvitation, normalizeAllowedAgeGroups } from "./_syncPostPolicy.js";
import { isTrue, reject } from "./_syncPostCommon.js";
import { getCanonicalBenchCapacity, normalizeRoomState } from "./_syncPostProjection.js";

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

function isMissingSqlReducer(error = {}) {
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

function getRequestedRecruitingRoster(operation = {}) {
  const activeIds = toArray(operation.roster?.playerIds).map((id) => String(id ?? "").trim()).filter(Boolean);
  const reserveIds = toArray(operation.roster?.reservePlayerIds).map((id) => String(id ?? "").trim()).filter(Boolean);
  return { activeIds, reserveIds, allIds: [...activeIds, ...reserveIds] };
}

async function loadRecruitingPartyGuardSnapshot(context, operation = {}) {
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

async function assertRecruitingPartyManagementGuard(context, operation = {}) {
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

async function applyRecruitingManagementAction(context, operation = {}) {
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
