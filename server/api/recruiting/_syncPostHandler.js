import { allowRequestMethod, getAuthenticatedContext, readJsonBody } from "../_supabaseAdmin.js";
import { applyAuthoritativeRecruitingOperation, getOperation, loadAuthoritativeState } from "../_authoritativeState.js";
import { persistMatchSnapshot } from "../matches/sync-match.js";
import { hasPracticeMutationPayload, PRACTICE_LOCAL_ONLY_ERROR } from "../../../shared/lib/practiceMode.js";

import { createTimingProbe, hasDebugTimingParam, sendTimedJson } from "./_syncPostResponse.js";
import { getRecruitingBenchPolicyError, isTrue, reject } from "./_syncPostCommon.js";
import { SQL_REDUCER_RECRUITING_ACTIONS, appendRemakeInvitationContext, applySqlRecruitingAction, assertPublicRoomParticipationAllowed, assertRecruitingRoomChangeComplete, loadSyncedRecruitingState, shouldUseSqlRecruitingAction, withRecruitingCreatePostId } from "./_syncPostActions.js";
import { normalizeRecruitingCreationPolicyOperation, validatePickupRecruitingOperation } from "./_syncPostPolicy.js";
import { persistRecruitingRoomChatMessage } from "./_syncPostChat.js";
import { queueRecruitingRoomCancelledDeliveries } from "./_syncPostProjection.js";
import { persistRecruitingPostSnapshot } from "./_syncPostPersistence.js";

export default async function handler(request, response) {
  const timing = createTimingProbe();
  const afterResponseTasks = [];
  let debugTiming = hasDebugTimingParam(request);
  if (!allowRequestMethod(request, response)) return;

  try {
    const body = await timing.track("body", () => readJsonBody(request));
    if (hasPracticeMutationPayload(body)) {
      sendTimedJson(response, 400, { error: PRACTICE_LOCAL_ONLY_ERROR }, timing, debugTiming);
      return;
    }
    debugTiming = debugTiming || isTrue(body.debugTiming);
    const context = await timing.track("auth", () => getAuthenticatedContext(request));
    let operation = withRecruitingCreatePostId(getOperation(body, body.action ? String(body.action) : "sync"));
    if (!operation) reject(400, "recruiting_operation_required");
    operation = await timing.track("pickupPolicy", () => validatePickupRecruitingOperation(context, operation));
    operation = normalizeRecruitingCreationPolicyOperation(operation);
    if (!SQL_REDUCER_RECRUITING_ACTIONS.has(operation.action) && !["sendRecruitingChat", "confirmRecruitingMatch"].includes(operation.action)) {
      reject(400, "unsupported_recruiting_operation");
    }
    await timing.track("publicRoomDiscipline", () => assertPublicRoomParticipationAllowed(context, operation));
    let post = null;
    let notifications = [];
    let action = operation.action;
    let createdMatch = null;
    let replayResult = null;

    if (operation?.action === "sendRecruitingChat") {
      const chatResult = await timing.track("persistRoomChatMessage", () => persistRecruitingRoomChatMessage(context, operation));
      if (chatResult) {
        sendTimedJson(response, 200, chatResult, timing, debugTiming);
        return;
      }
      reject(503, "recruiting_chat_rpc_unavailable");
    }

    if (operation && shouldUseSqlRecruitingAction(operation)) {
      const sqlResult = await timing.track("sqlReducer", () => applySqlRecruitingAction(context, operation));
      if (sqlResult) {
        let synced = await timing.track("loadSyncedAfterSql", () => loadSyncedRecruitingState(context, sqlResult.postId ?? operation.postId));
        let discordDeliveryCount = 0;
        let discordDeliveryError = null;
        let invitationContextCount = 0;
        let invitationContextError = null;
        if (["inviteRecruitingPlayers", "setRecruitingRoomTeam"].includes(operation.action) && synced.post) {
          try {
            invitationContextCount = await timing.track(
              "appendRemakeInvitationContext",
              () => appendRemakeInvitationContext(context.supabase, synced.post, operation),
            );
            if (invitationContextCount) {
              synced = await timing.track("reloadAfterInviteContext", () => loadSyncedRecruitingState(context, synced.post.id));
            }
          } catch (contextError) {
            invitationContextError = contextError.message || "recruiting_invitation_context_failed";
            console.error("Recruiting invitation context update failed.", contextError);
          }
        }
        if (operation.action === "closeRecruitingPost" && synced.post) {
          try {
            discordDeliveryCount = await timing.track("discordQueue", () => queueRecruitingRoomCancelledDeliveries(context.supabase, synced.post, operation.action));
            synced = await timing.track("reloadAfterCancelNotice", () => loadSyncedRecruitingState(context, synced.post.id));
          } catch (deliveryError) {
            discordDeliveryError = deliveryError.message || "discord_recruiting_delivery_failed";
            console.error("Recruiting Discord delivery queue failed.", deliveryError);
          }
        }
        sendTimedJson(response, 200, {
          ...sqlResult,
          discordDeliveryCount,
          discordDeliveryError,
          invitationContextCount,
          invitationContextError,
          ...(synced.post ? { post: synced.post } : {}),
          ...(synced.state ? { state: synced.state } : {}),
        }, timing, debugTiming);
        return;
      }
      reject(503, "recruiting_sql_reducer_unavailable");
    }

    if (operation.action === "confirmRecruitingMatch") {
      await timing.track("roomChangeApproval", () => assertRecruitingRoomChangeComplete(context, operation.postId));
      const state = await timing.track("authoritativeLoad", () => loadAuthoritativeState(context, { operation }));
      const result = await timing.track("authoritativeReplay", () => applyAuthoritativeRecruitingOperation(state, operation));
      replayResult = result;
      post = result.post;
      createdMatch = result.createdMatch;
      notifications = result.notifications;
      action = operation.action;
    }

    const recruitingNotifications = createdMatch
      ? notifications.filter((notification) => !notification.matchId || notification.matchId !== createdMatch.id)
      : notifications;
    let result;
    if (createdMatch) {
      const preparedRecruiting = await timing.track("prepareRecruitingSnapshot", () => persistRecruitingPostSnapshot(context, {
        post,
        notifications: recruitingNotifications,
        action,
        body: { ...body, ...(operation ?? {}) },
        expectedUpdatedAt: operation ? replayResult?.baseUpdatedAt ?? null : null,
        timing,
        prepareOnly: true,
      }));
      const matchNotifications = notifications.filter((notification) => notification.matchId === createdMatch.id);
      const matchResult = await timing.track("persistAtomicConfirmation", () => persistMatchSnapshot(context, {
        match: createdMatch,
        notifications: matchNotifications,
        action: "confirmRecruitingMatch",
        body: { ...body, ...(operation ?? {}) },
        recruitingPersistence: preparedRecruiting.persistence,
      }));
      result = {
        ok: true,
        post,
        postId: post.id,
        applicationCount: Number(matchResult.recruitingPersistResult?.applicationCount ?? preparedRecruiting.applicationCount),
        notificationCount: Number(matchResult.recruitingPersistResult?.notificationCount ?? preparedRecruiting.notificationCount),
        discordDeliveryCount: 0,
        discordDeliveryError: null,
        discordDeliveryDeferred: false,
        createdMatch: matchResult.match,
        matchId: matchResult.matchId,
        confirmationAtomic: Boolean(matchResult.confirmationAtomic),
      };
    } else {
      result = await timing.track("persistSnapshot", () => persistRecruitingPostSnapshot(context, {
        post,
        notifications: recruitingNotifications,
        action,
        body: { ...body, ...(operation ?? {}) },
        expectedUpdatedAt: operation ? replayResult?.baseUpdatedAt ?? null : null,
        timing,
        afterResponseTasks,
      }));
    }
    if (result?.postId && action !== "createRecruitingPost") {
      const synced = await timing.track("loadSyncedAfterPersist", () => loadSyncedRecruitingState(context, result.postId));
      if (synced.post) result.post = synced.post;
      if (synced.state) result.state = synced.state;
    }
    sendTimedJson(response, 200, result, timing, debugTiming);
    afterResponseTasks.forEach((task) => {
      Promise.resolve()
        .then(task)
        .catch((error) => console.error("Recruiting deferred task failed.", error));
    });
  } catch (error) {
    console.error("Recruiting post sync failed.", error);
    const benchPolicyError = getRecruitingBenchPolicyError(error);
    const statusCode = benchPolicyError?.statusCode ?? error.statusCode ?? 500;
    const errorMessage = benchPolicyError?.message ?? error.message ?? "recruiting_post_sync_failed";
    sendTimedJson(response, statusCode, {
      error: errorMessage,
      details: {
        ...(error.details && typeof error.details === "object" ? error.details : {}),
        reason: errorMessage,
        statusCode,
      },
    }, timing, debugTiming);
  }
}
