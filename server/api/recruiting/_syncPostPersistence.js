import { toNotificationRows } from "../_supabaseAdmin.js";

import { reject } from "./_syncPostCommon.js";
import { canSyncRecruitingAction, getRequiredInvitationId, isInvitationDecisionAction, validateAgeEligibility, validateLockedRecruitingCore, validateNoUnexpectedRosterInsert, validateRecruitingCreateBranchShape, validateRecruitingCreateCourt, validateRecruitingPostShape, validateRecruitingRosterEligibility, validateRefereeAction } from "./_syncPostPolicy.js";
import { timeStep } from "./_syncPostResponse.js";
import { fromRecruitingApplicationRows, getTimestamp, queueRecruitingRoomCancelledDeliveries, toRecruitingApplicationRows, toRecruitingPostRow } from "./_syncPostProjection.js";

export async function persistRecruitingPostSnapshot(context, { post, notifications = [], action = "sync", body = {}, expectedUpdatedAt = null, timing = null, afterResponseTasks = null, prepareOnly = false }) {
  if (!post?.id) reject(400, "missing_recruiting_post");
  validateRecruitingPostShape(post);

  const actionBody = { ...body, action };
  const isCreateAction = action === "createRecruitingPost";
  const { data: existingPost, error: existingError } = await timeStep(timing, "persistExistingPost", () => context.supabase
      .from("recruiting_posts")
      .select(isCreateAction ? "id" : "id, visibility, player_id, team_id, target_team_id, mode, scheduled_date, scheduled_time, ranked, official, side_capacity, bench_capacity, host_join_mode, host_side, player_ids, referee_id, referee_trust_min, room_state, rules, age_restriction, allowed_age_groups, updated_at")
      .eq("id", post.id)
      .maybeSingle());

  if (existingError) throw existingError;
  if (isCreateAction && existingPost) reject(409, "recruiting_post_already_exists");
  if (isCreateAction) {
    validateRecruitingCreateCourt(post);
    validateRecruitingCreateBranchShape(post);
  }
  const { data: existingApplications, error: existingApplicationsError } = await timeStep(timing, "persistExistingApplications", () => existingPost && !isCreateAction
    ? context.supabase
      .from("recruiting_applications")
      .select("kind,team_id,player_id,side,status,reserve,position,player_ids,source_team_id,source_entry_id,created_at,updated_at")
      .eq("post_id", post.id)
    : { data: [], error: null });
  if (existingApplicationsError) throw existingApplicationsError;
  const existingPostSnapshot = existingPost
    ? {
        ...existingPost,
        ownerId: existingPost.room_state?.ownerId,
        playerId: existingPost.player_id,
        playerIds: existingPost.player_ids,
        refereeId: existingPost.referee_id,
        roomState: existingPost.room_state,
        applicants: fromRecruitingApplicationRows(existingApplications),
      }
    : null;
  await timeStep(timing, "permissionValidation", () => {
    if (isInvitationDecisionAction(action)) getRequiredInvitationId(actionBody);
    if (!canSyncRecruitingAction(context.profileId, existingPostSnapshot, post, action, actionBody)) {
      reject(403, "recruiting_sync_permission_denied");
    }
    validateNoUnexpectedRosterInsert(existingPostSnapshot, post, action, actionBody);
    validateLockedRecruitingCore(context.profileId, existingPostSnapshot, post, actionBody);
  });
  await timeStep(timing, "validateReferee", () => validateRefereeAction(context.supabase, context.profileId, existingPostSnapshot, post, actionBody));
  await timeStep(timing, "validateRoster", () => validateRecruitingRosterEligibility(context.supabase, post, context.profileId));
  await timeStep(timing, "validateAge", () => validateAgeEligibility(context.supabase, context.profileId, existingPostSnapshot, post, actionBody));

  const postRow = toRecruitingPostRow(post);
  const applicationRows = toRecruitingApplicationRows(post);
  const notificationRows = toNotificationRows(notifications, context.profileId, { coalesce: "nullish", getUpdatedAt: getTimestamp });
  const persistence = {
    p_actor_profile_id: context.profileId,
    p_action: action,
    p_post_row: postRow,
    p_application_rows: applicationRows,
    p_notification_rows: notificationRows,
    p_expected_updated_at: expectedUpdatedAt,
  };

  if (prepareOnly) {
    return {
      ok: true,
      post,
      postId: post.id,
      applicationCount: applicationRows.length,
      notificationCount: notificationRows.length,
      persistence,
    };
  }

  const { data: persistResult, error: persistError } = await timeStep(timing, "persistRpc", () => context.supabase.rpc("rankball_recruiting_action", persistence));
  if (persistError) {
    if (persistError.code === "40001" || String(persistError.message ?? "").includes("recruiting_stale_snapshot")) {
      reject(409, "recruiting_stale_snapshot");
    }
    throw persistError;
  }
  let discordDeliveryCount = 0;
  let discordDeliveryError = null;
  let discordDeliveryDeferred = false;
  if (action === "closeRecruitingPost") {
    try {
      discordDeliveryCount = await timeStep(timing, "discordQueue", () => queueRecruitingRoomCancelledDeliveries(context.supabase, post, action));
    } catch (deliveryError) {
      discordDeliveryError = deliveryError.message || "discord_recruiting_delivery_failed";
      console.error("Recruiting Discord delivery queue failed.", deliveryError);
    }
  }

  return {
    ok: true,
    post,
    postId: post.id,
    applicationCount: Number(persistResult?.applicationCount ?? applicationRows.length),
    notificationCount: Number(persistResult?.notificationCount ?? notificationRows.length),
    discordDeliveryCount,
    discordDeliveryError,
    discordDeliveryDeferred,
  };
}
