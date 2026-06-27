import { getAdminLevel, getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import { loadNormalizedRemoteStateFromClient, REMOTE_CLIENT_RECRUITING_LIMIT } from "../../../src/data/repository.js";
import { filterStateForProfile } from "../state/load.js";

let currentUserRecruitingRpcAvailable = true;

function getPageOffset(body = {}) {
  const rawOffset = body.offset ?? body.recruitingOffset ?? body.nextOffset;
  const numericOffset = Number(rawOffset);
  if (Number.isFinite(numericOffset) && numericOffset > 0) return Math.floor(numericOffset);

  const numericCursor = Number(body.cursor);
  if (Number.isFinite(numericCursor) && numericCursor > 0) return Math.floor(numericCursor);
  return 0;
}

function getTargetPostIds(body = {}) {
  return [
    body.postId,
    body.recruitingPostId,
    ...(Array.isArray(body.recruitingPostIds) ? body.recruitingPostIds : []),
  ].map((id) => String(id ?? "").trim()).filter(Boolean);
}

function uniqueIds(ids = []) {
  return [...new Set(ids.map((id) => String(id ?? "").trim()).filter(Boolean))];
}

function mergeById(current = [], incoming = []) {
  const merged = new Map((current ?? []).filter((item) => item?.id).map((item) => [item.id, item]));
  (incoming ?? []).forEach((item) => {
    if (item?.id) merged.set(item.id, item);
  });
  return [...merged.values()];
}

function mergeStateById(current = {}, incoming = {}) {
  return {
    ...current,
    ...incoming,
    users: mergeById(current.users, incoming.users),
    teams: mergeById(current.teams, incoming.teams),
    recruitingPosts: mergeById(current.recruitingPosts, incoming.recruitingPosts),
    settings: {
      ...(current.settings ?? {}),
      ...(incoming.settings ?? {}),
    },
  };
}

function compactUser(user = {}, profileId = "") {
  const compact = {
    id: user.id,
    name: user.name,
    handle: user.handle,
    hashtag: user.hashtag,
    position: user.position,
    region: user.region,
    avatarColor: user.avatarColor,
    trustScore: user.trustScore,
    ratings: Number.isFinite(Number(user.ratings?.integrated)) ? { integrated: user.ratings.integrated } : undefined,
    ageGroup: user.ageGroup,
  };
  if (user.id !== profileId) return compact;
  return {
    ...compact,
    regionSido: user.regionSido,
    regionDistrict: user.regionDistrict,
    school: user.school,
    company: user.company,
    club: user.club,
    streak: user.streak,
    ratings: user.ratings,
    authUserId: user.authUserId,
    testLoginId: user.testLoginId,
    birthYear: user.birthYear,
    ageGroupCheckedSeason: user.ageGroupCheckedSeason,
    onboardingComplete: user.onboardingComplete,
    profileVersion: user.profileVersion,
    handleLockedAt: user.handleLockedAt,
    birthYearLockedAt: user.birthYearLockedAt,
    nameUpdatedAt: user.nameUpdatedAt,
    discordConnection: user.discordConnection,
    discordUserId: user.discordUserId,
  };
}

function compactTeam(team = {}) {
  return {
    id: team.id,
    name: team.name,
    homeCourt: team.homeCourt,
    region: team.region,
    mmr: team.mmr,
    wins: team.wins,
    losses: team.losses,
    accent: team.accent,
    membersPartial: true,
    members: team.members ?? [],
  };
}

function compactRecruitingApplication(applicant = {}) {
  return {
    kind: applicant.kind,
    joinMode: applicant.joinMode,
    teamId: applicant.teamId,
    playerId: applicant.playerId,
    side: applicant.side,
    status: applicant.status,
    reserve: applicant.reserve,
    position: applicant.position,
    playerIds: applicant.playerIds ?? [],
    sourceTeamId: applicant.sourceTeamId,
    sourceEntryId: applicant.sourceEntryId,
    createdAt: applicant.createdAt,
    updatedAt: applicant.updatedAt,
  };
}

function compactRecruitingRoomState(roomState = {}, profileId = "") {
  const invitations = Array.isArray(roomState.invitations)
    ? roomState.invitations
      .filter((invitation) => invitation.targetUserId === profileId || invitation.fromUserId === profileId)
      .map((invitation) => ({
        id: invitation.id,
        role: invitation.role,
        targetUserId: invitation.targetUserId,
        fromUserId: invitation.fromUserId,
        teamId: invitation.teamId,
        side: invitation.side,
        reserve: invitation.reserve,
        status: invitation.status,
        createdAt: invitation.createdAt,
        updatedAt: invitation.updatedAt,
      }))
    : [];
  return {
    ownerId: roomState.ownerId,
    teamOnly: roomState.teamOnly,
    timingType: roomState.timingType,
    hostReserve: roomState.hostReserve,
    refereeWanted: roomState.refereeWanted,
    invitations,
    mmrRangeMode: roomState.mmrRangeMode,
    partyLeaders: roomState.partyLeaders ?? {},
    partyReserves: roomState.partyReserves ?? {},
    reserveReady: roomState.reserveReady ?? {},
    pinnedReservePlayers: roomState.pinnedReservePlayers ?? {},
    slotPositions: roomState.slotPositions ?? {},
    statRecorders: roomState.statRecorders ?? {},
    ruleRevision: roomState.ruleRevision,
    approvalModeA: roomState.approvalModeA,
    approvalModeB: roomState.approvalModeB,
  };
}

function compactRecruitingPost(post = {}, profileId = "") {
  const rules = post.rules ?? {};
  return {
    id: post.id,
    type: post.type,
    title: post.title,
    visibility: post.visibility,
    region: post.region,
    court: post.court,
    mode: post.mode,
    scheduledDate: post.scheduledDate,
    scheduledTime: post.scheduledTime,
    scheduledAt: post.scheduledAt,
    timingType: post.timingType,
    ranked: post.ranked,
    official: post.official,
    preRegistered: post.preRegistered,
    ratingScale: post.ratingScale,
    ageRestriction: post.ageRestriction,
    allowedAgeGroups: post.allowedAgeGroups ?? [],
    rules: {
      targetScore: rules.targetScore,
      timeLimit: rules.timeLimit,
      winByTwo: rules.winByTwo,
      ball: rules.ball,
      ageRestriction: rules.ageRestriction,
      allowedAgeGroups: rules.allowedAgeGroups,
    },
    stakes: post.stakes,
    spots: post.spots,
    teamId: post.teamId,
    targetTeamId: post.targetTeamId,
    refereeWanted: post.refereeWanted,
    refereeId: post.refereeId,
    refereeTrustMin: post.refereeTrustMin,
    statEntryMinutes: post.statEntryMinutes,
    disputeMinutes: post.disputeMinutes,
    roomState: compactRecruitingRoomState(post.roomState ?? {}, profileId),
    teamOnly: post.teamOnly,
    hostJoinMode: post.hostJoinMode,
    hostSide: post.hostSide,
    hostReady: post.hostReady,
    sideCapacity: post.sideCapacity,
    playerIds: post.playerIds ?? [],
    position: post.position,
    playerId: post.playerId,
    memo: post.memo,
    status: post.status,
    applicants: (post.applicants ?? []).map(compactRecruitingApplication),
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    confirmedAt: post.confirmedAt,
  };
}

function compactRecruitingListState(state = {}, profileId = "") {
  return {
    ...state,
    users: (state.users ?? []).map((user) => compactUser(user, profileId)),
    teams: (state.teams ?? []).map(compactTeam),
    recruitingPosts: (state.recruitingPosts ?? []).map((post) => compactRecruitingPost(post, profileId)),
    matches: [],
    tournaments: [],
    affiliations: [],
    seasons: [],
    reports: [],
    notifications: [],
    discordNotificationDeliveries: [],
    settings: {
      theme: state.settings?.theme === "light" ? "light" : "dark",
      privacy: state.settings?.privacy,
      favoritePlayerIds: state.settings?.favoritePlayerIds ?? [],
      favoriteTeamIds: state.settings?.favoriteTeamIds ?? [],
      favoriteCourtIds: state.settings?.favoriteCourtIds ?? [],
      approvedCourts: state.settings?.approvedCourts ?? [],
      refereeAppointments: state.settings?.refereeAppointments ?? [],
    },
  };
}

async function fetchPostIds(query, idColumn = "id") {
  const { data, error } = await query;
  if (error) {
    console.warn("Current user recruiting id query skipped.", error.message);
    return [];
  }
  return (data ?? []).map((row) => row?.[idColumn]).filter(Boolean);
}

async function fetchCurrentUserRecruitingPostIds(client, profileId = "", limit = REMOTE_CLIENT_RECRUITING_LIMIT) {
  if (!profileId) return [];
  const cappedLimit = Math.max(1, Math.min(80, Number(limit) || REMOTE_CLIENT_RECRUITING_LIMIT));
  if (currentUserRecruitingRpcAvailable) {
    const { data: rpcRows, error: rpcError } = await client.rpc("rankball_current_recruiting_post_ids", {
      p_profile_id: profileId,
      p_limit: cappedLimit,
    });
    if (!rpcError) {
      return uniqueIds((rpcRows ?? []).map((row) => row?.post_id ?? row?.id ?? row)).slice(0, cappedLimit);
    }
    currentUserRecruitingRpcAvailable = false;
    console.warn("Current user recruiting RPC skipped.", rpcError.message);
  }
  const [ownedPostIds, hostedPlayerPostIds, refereedPostIds, applicantPostIds, applicantPartyPostIds] = await Promise.all([
    fetchPostIds(client.from("recruiting_posts").select("id").eq("status", "open").eq("player_id", profileId).order("updated_at", { ascending: false }).limit(cappedLimit)),
    fetchPostIds(client.from("recruiting_posts").select("id").eq("status", "open").contains("player_ids", [profileId]).order("updated_at", { ascending: false }).limit(cappedLimit)),
    fetchPostIds(client.from("recruiting_posts").select("id").eq("status", "open").eq("referee_id", profileId).order("updated_at", { ascending: false }).limit(cappedLimit)),
    fetchPostIds(client.from("recruiting_applications").select("post_id,updated_at").eq("player_id", profileId).order("updated_at", { ascending: false }).limit(cappedLimit), "post_id"),
    fetchPostIds(client.from("recruiting_applications").select("post_id,updated_at").contains("player_ids", [profileId]).order("updated_at", { ascending: false }).limit(cappedLimit), "post_id"),
  ]);
  return uniqueIds([
    ...ownedPostIds,
    ...hostedPlayerPostIds,
    ...refereedPostIds,
    ...applicantPostIds,
    ...applicantPartyPostIds,
  ]).slice(0, cappedLimit);
}

async function fetchRecruitingPagePostIds(client, limit = REMOTE_CLIENT_RECRUITING_LIMIT, offset = 0) {
  const cappedLimit = Math.max(1, Math.min(80, Number(limit) || REMOTE_CLIENT_RECRUITING_LIMIT));
  const safeOffset = Math.max(0, Math.floor(Number(offset) || 0));
  const { data, error } = await client
    .from("recruiting_posts")
    .select("id")
    .eq("status", "open")
    .eq("visibility", "public")
    .order("updated_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .range(safeOffset, safeOffset + cappedLimit - 1);
  if (error) throw error;
  return (data ?? []).map((row) => row?.id).filter(Boolean);
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const context = await getAuthenticatedContext(request, { allowMissingProfile: true });
    const shouldLoadAdminContext = body.adminContext !== false && body.includeAdminContext !== false;
    const adminLevel = shouldLoadAdminContext && context.profileId ? await getAdminLevel(context) : 0;
    const requestedLimit = Number(body.limit ?? body.recruitingLimit ?? REMOTE_CLIENT_RECRUITING_LIMIT);
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : REMOTE_CLIENT_RECRUITING_LIMIT;
    const mineOnly = body.scope === "mine" || body.mine === true;
    const includeMine = mineOnly || body.includeMine === true;
    const mineLimit = mineOnly ? limit : REMOTE_CLIENT_RECRUITING_LIMIT;
    const currentUserPostIds = includeMine ? await fetchCurrentUserRecruitingPostIds(context.supabase, context.profileId, mineLimit) : [];
    const explicitPostIds = getTargetPostIds(body);
    const listOnly = body.listOnly !== false && !explicitPostIds.length;
    const offset = getPageOffset(body);
    const shouldPageList = !mineOnly && !explicitPostIds.length;
    const pagePostIds = shouldPageList ? await fetchRecruitingPagePostIds(context.supabase, limit, offset) : [];
    const targetPostIds = uniqueIds([...explicitPostIds, ...(mineOnly ? currentUserPostIds : pagePostIds)]);
    const normalized = await loadNormalizedRemoteStateFromClient(
      context.supabase,
      context.authUserId,
      context.authUser?.email ?? "",
      {
        clientState: true,
        isAdmin: adminLevel >= 30,
        scope: "recruiting",
        recruitingListOnly: listOnly,
        recruitingPostIds: targetPostIds,
        recruitingLimit: 0,
        matchLimit: 0,
        tournamentLimit: 0,
      },
    );
    const profileId = context.profileId ?? normalized?.state?.currentUserId ?? "";
    const pageState = filterStateForProfile(normalized?.state ?? {}, profileId, adminLevel >= 30);
    const pagePosts = pageState.recruitingPosts ?? [];
    let state = pageState;
    if (includeMine && !mineOnly) {
      const loadedIds = new Set(pagePosts.map((post) => post.id));
      const missingMineIds = currentUserPostIds.filter((postId) => !loadedIds.has(postId));
      if (missingMineIds.length) {
        const mineNormalized = await loadNormalizedRemoteStateFromClient(
          context.supabase,
          context.authUserId,
          context.authUser?.email ?? "",
          {
            clientState: true,
            isAdmin: adminLevel >= 30,
            scope: "recruiting",
            recruitingListOnly: listOnly,
            recruitingPostIds: missingMineIds,
            recruitingLimit: 0,
            matchLimit: 0,
            tournamentLimit: 0,
          },
        );
        const mineState = filterStateForProfile(mineNormalized?.state ?? {}, profileId, adminLevel >= 30);
        state = mergeStateById(pageState, mineState);
      }
    }
    const responseState = listOnly ? compactRecruitingListState(state, profileId) : state;
    sendJson(response, 200, {
      ok: true,
      state: {
        ...responseState,
        matches: [],
        tournaments: [],
      },
      page: {
        limit,
        count: pagePosts.length,
        offset,
        nextOffset: offset + pagePostIds.length,
        cursor: String(offset + pagePostIds.length),
        exhausted: mineOnly || Boolean(explicitPostIds.length) || pagePostIds.length < limit,
      },
      updatedAt: normalized?.updatedAt ?? 0,
    });
  } catch (error) {
    sendJson(response, error.statusCode || 500, { error: error.message || "recruiting_list_failed" });
  }
}
