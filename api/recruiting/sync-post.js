import { getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";

function toArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function toDbTime(value) {
  return value ? String(value).slice(0, 5) : null;
}

function getTimestamp(item = {}) {
  return item.updatedAt ?? item.createdAt ?? item.queuedAt ?? item.startedAt ?? item.approvedAt ?? new Date().toISOString();
}

function normalizeRoomState(roomState = {}, post = {}) {
  return {
    ...(roomState && typeof roomState === "object" ? roomState : {}),
    ownerId: post.ownerId ?? roomState?.ownerId ?? post.playerId ?? "",
    timingType: post.timingType ?? roomState?.timingType ?? "scheduled",
  };
}

function toRecruitingPostRow(post = {}) {
  const roomState = normalizeRoomState(post.roomState, post);
  return {
    id: post.id,
    type: post.type ?? "need_player",
    title: String(post.title ?? "").trim() || "매칭방",
    visibility: post.visibility === "private" ? "private" : "public",
    player_id: post.playerId,
    team_id: post.teamId ?? null,
    region: post.region ?? null,
    court_id: post.courtId ?? null,
    court_name: post.court ?? post.courtName ?? "미정",
    mode: post.mode ?? "5v5",
    scheduled_date: post.scheduledDate || null,
    scheduled_time: toDbTime(post.scheduledTime),
    scheduled_at: post.scheduledAt && !["일정 미정", "즉시"].includes(post.scheduledAt) ? post.scheduledAt : null,
    ranked: post.ranked !== false,
    official: Boolean(post.official),
    pre_registered: post.preRegistered !== false,
    rating_scale: Number(post.ratingScale ?? 1),
    age_restriction: post.ageRestriction ?? null,
    allowed_age_groups: toArray(post.allowedAgeGroups),
    rules: post.rules ?? {},
    stakes: post.stakes ?? "",
    court_reserved: Boolean(post.courtReserved),
    court_fee: post.courtFee ?? "",
    spots: Number(post.spots ?? 0),
    target_team_id: post.targetTeamId ?? null,
    referee_id: post.refereeId || null,
    referee_trust_min: Number(post.refereeTrustMin ?? 90),
    stat_entry_minutes: Number(post.statEntryMinutes ?? 60),
    dispute_minutes: Number(post.disputeMinutes ?? 120),
    room_state: roomState,
    host_join_mode: post.hostJoinMode === "player" ? "player" : "team",
    host_side: post.hostSide === "teamB" ? "teamB" : "teamA",
    host_ready: Boolean(post.hostReady),
    side_capacity: Math.max(1, Math.min(5, Number(post.sideCapacity ?? 5))),
    player_ids: toArray(post.playerIds),
    position: post.position ?? null,
    memo: post.memo ?? "",
    status: post.status ?? "open",
    confirmed_at: post.confirmedAt ?? null,
    created_at: post.createdAt ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function toRecruitingApplicationRows(post = {}) {
  return toArray(post.applicants).map((application) => ({
    post_id: post.id,
    player_id: application.playerId,
    team_id: application.teamId ?? null,
    kind: application.kind === "team" || application.teamId ? "team" : "player",
    side: application.side === "teamA" ? "teamA" : "teamB",
    status: ["waiting", "ready", "confirmed"].includes(application.status) ? application.status : "waiting",
    reserve: Boolean(application.reserve),
    position: application.position ?? null,
    player_ids: toArray(application.playerIds),
    source_team_id: application.sourceTeamId ?? null,
    source_entry_id: application.sourceEntryId ?? null,
    created_at: application.createdAt ?? new Date().toISOString(),
    updated_at: application.updatedAt ?? application.createdAt ?? new Date().toISOString(),
  })).filter((row) => row.player_id);
}

function toNotificationRows(notifications = [], fallbackProfileId = "") {
  return toArray(notifications).map((notification) => ({
    id: notification.id,
    user_id: notification.targetUserId ?? fallbackProfileId,
    target_user_id: notification.targetUserId ?? null,
    title: notification.title ?? "알림",
    body: notification.body ?? "",
    tone: notification.tone ?? "match",
    type: notification.type ?? null,
    match_id: notification.matchId ?? null,
    recruiting_post_id: notification.recruitingPostId ?? null,
    invitation_id: notification.invitationId ?? null,
    discord_event: notification.discordEvent ?? notification.eventType ?? null,
    read_at: notification.readAt ?? null,
    payload: notification,
    created_at: notification.createdAt ?? new Date().toISOString(),
    updated_at: getTimestamp(notification),
  })).filter((row) => row.id);
}

function participantIdsFromPost(post = {}) {
  const roomState = normalizeRoomState(post.roomState, post);
  return new Set([
    post.ownerId,
    roomState.ownerId,
    post.playerId,
    ...(toArray(post.playerIds)),
    ...(toArray(post.applicants).flatMap((application) => [
      application.playerId,
      ...(toArray(application.playerIds)),
      ...(toArray(application.reservePlayerIds)),
    ])),
    ...(Object.values(roomState.partyReserves ?? {}).flatMap(toArray)),
    ...(toArray(roomState.invitations).map((invitation) => invitation.targetUserId)),
    ...(toArray(roomState.invitations).map((invitation) => invitation.fromUserId)),
  ].filter(Boolean));
}

function canSyncRecruitingPost(profileId, existingPost, nextPost) {
  if (!profileId || !nextPost?.id) return false;
  if (!existingPost) {
    return participantIdsFromPost(nextPost).has(profileId) && (nextPost.ownerId === profileId || nextPost.playerId === profileId);
  }
  return participantIdsFromPost({
    ...existingPost,
    ownerId: existingPost.room_state?.ownerId,
    playerId: existingPost.player_id,
    playerIds: existingPost.player_ids,
    applicants: [],
    roomState: existingPost.room_state,
  }).has(profileId) || participantIdsFromPost(nextPost).has(profileId);
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const post = body.post && typeof body.post === "object" ? body.post : null;
    if (!post?.id) {
      sendJson(response, 400, { error: "missing_recruiting_post" });
      return;
    }

    const context = await getAuthenticatedContext(request);
    const { data: existingPost, error: existingError } = await context.supabase
      .from("recruiting_posts")
      .select("id, player_id, player_ids, room_state")
      .eq("id", post.id)
      .maybeSingle();

    if (existingError) throw existingError;
    if (!canSyncRecruitingPost(context.profileId, existingPost, post)) {
      sendJson(response, 403, { error: "recruiting_sync_permission_denied" });
      return;
    }

    const postRow = toRecruitingPostRow(post);
    const applicationRows = toRecruitingApplicationRows(post);
    const notificationRows = toNotificationRows(body.notifications, context.profileId);

    const { error: postError } = await context.supabase
      .from("recruiting_posts")
      .upsert(postRow, { onConflict: "id" });
    if (postError) throw postError;

    const { error: deleteError } = await context.supabase
      .from("recruiting_applications")
      .delete()
      .eq("post_id", post.id);
    if (deleteError) throw deleteError;

    if (applicationRows.length) {
      const { error: appError } = await context.supabase
        .from("recruiting_applications")
        .upsert(applicationRows, { onConflict: "post_id,player_id,kind" });
      if (appError) throw appError;
    }

    if (notificationRows.length) {
      const { error: notificationError } = await context.supabase
        .from("notifications")
        .upsert(notificationRows, { onConflict: "id" });
      if (notificationError) throw notificationError;
    }

    sendJson(response, 200, { ok: true, postId: post.id, applicationCount: applicationRows.length, notificationCount: notificationRows.length });
  } catch (error) {
    console.error("Recruiting post sync failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "recruiting_post_sync_failed" });
  }
}
