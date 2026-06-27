import { getAdminLevel, getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import { loadNormalizedRemoteStateFromClient, REMOTE_CLIENT_MATCH_LIMIT } from "../../../src/data/repository.js";
import { filterStateForProfile } from "../state/load.js";

function getMatchCursor(matches = []) {
  const oldest = [...matches]
    .sort((a, b) => String(a.updatedAt ?? a.createdAt ?? "").localeCompare(String(b.updatedAt ?? b.createdAt ?? "")))
    .at(0);
  return oldest?.updatedAt ?? oldest?.createdAt ?? "";
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function getMatchUserIds(match = {}) {
  return unique([
    match.createdBy,
    match.refereeId,
    match.formerRefereeId,
    ...(match.teamA?.players ?? []),
    ...(match.teamB?.players ?? []),
    ...(match.reservePlayers?.teamA ?? []),
    ...(match.reservePlayers?.teamB ?? []),
  ]);
}

function getMatchTeamIds(match = {}) {
  return unique([match.teamA?.teamId, match.teamB?.teamId]);
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

function compactMatchSide(side = {}) {
  return {
    teamId: side.teamId,
    name: side.name,
    players: side.players ?? [],
    score: side.score,
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

function compactMatch(match = {}) {
  const rules = match.rules ?? {};
  return {
    id: match.id,
    title: match.title,
    mode: match.mode,
    court: match.court,
    visibility: match.visibility,
    scheduledDate: match.scheduledDate,
    scheduledTime: match.scheduledTime,
    scheduledAt: match.scheduledAt,
    timingType: match.timingType,
    status: match.status,
    official: match.official,
    preRegistered: match.preRegistered,
    ranked: match.ranked,
    refereeId: match.refereeId,
    formerRefereeId: match.formerRefereeId,
    refereeWanted: match.refereeWanted,
    createdBy: match.createdBy,
    recruitingPostId: match.recruitingPostId,
    tournamentId: match.tournamentId,
    teamA: compactMatchSide(match.teamA),
    teamB: compactMatchSide(match.teamB),
    agreements: match.agreements,
    approvals: match.approvals,
    disputes: match.disputes,
    playedPlayerIds: match.playedPlayerIds,
    reservePlayers: match.reservePlayers,
    parties: match.parties,
    result: match.result,
    rules: {
      targetScore: rules.targetScore,
      timeLimit: rules.timeLimit,
      winByTwo: rules.winByTwo,
      ball: rules.ball,
      playedPlayerIds: rules.playedPlayerIds,
      statRecorders: rules.statRecorders,
    },
    statRecorders: match.statRecorders,
    statEntryMinutes: match.statEntryMinutes,
    disputeMinutes: match.disputeMinutes,
    createdAt: match.createdAt,
    agreedAt: match.agreedAt,
    startedAt: match.startedAt,
    endedAt: match.endedAt,
    confirmedAt: match.confirmedAt,
    cancelledAt: match.cancelledAt,
    voidedAt: match.voidedAt,
    updatedAt: match.updatedAt,
  };
}

function compactMatchListState(state = {}, profileId = "") {
  const matches = (state.matches ?? []).map(compactMatch);
  const userIds = new Set(unique([profileId, ...matches.flatMap(getMatchUserIds)]));
  const teamIds = new Set(matches.flatMap(getMatchTeamIds));
  return {
    ...state,
    matches,
    users: (state.users ?? []).filter((user) => userIds.has(user.id)).map((user) => compactUser(user, profileId)),
    teams: (state.teams ?? []).filter((team) => teamIds.has(team.id)).map(compactTeam),
    affiliations: [],
    seasons: [],
    reports: [],
    notifications: [],
    discordNotificationDeliveries: [],
    settings: {
      theme: state.settings?.theme === "light" ? "light" : "dark",
    },
  };
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
    const requestedLimit = Number(body.limit ?? body.matchLimit ?? REMOTE_CLIENT_MATCH_LIMIT);
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : REMOTE_CLIENT_MATCH_LIMIT;
    const normalized = await loadNormalizedRemoteStateFromClient(
      context.supabase,
      context.authUserId,
      context.authUser?.email ?? "",
      {
        clientState: true,
        isAdmin: adminLevel >= 30,
        scope: "matches",
        matchListOnly: true,
        matchLimit: limit,
        matchUpdatedBefore: body.cursor ?? body.matchUpdatedBefore ?? "",
        recruitingLimit: 0,
        tournamentLimit: 0,
      },
    );
    const profileId = context.profileId ?? normalized?.state?.currentUserId ?? "";
    const state = filterStateForProfile(normalized?.state ?? {}, profileId, adminLevel >= 30);
    const matches = state.matches ?? [];
    const responseState = body.listOnly === false ? state : compactMatchListState(state, profileId);
    sendJson(response, 200, {
      ok: true,
      state: {
        ...responseState,
        recruitingPosts: [],
        tournaments: [],
      },
      page: {
        limit,
        count: matches.length,
        cursor: getMatchCursor(matches),
        exhausted: matches.length < limit,
      },
      updatedAt: normalized?.updatedAt ?? 0,
    });
  } catch (error) {
    sendJson(response, error.statusCode || 500, { error: error.message || "matches_list_failed" });
  }
}
