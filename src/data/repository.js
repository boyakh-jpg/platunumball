import { MAX_TEAM_MEMBERSHIPS, MODE_SIZES, TEAM_ROLES } from "../lib/constants.js";
import { initialState } from "../lib/mockData.js";
import { getApprovalStatus, getSideMajority, normalizePlayerStats } from "../lib/matchUtils.js";
import { applyMatchRating, calculateTeamDelta } from "../lib/rating.js";
import { clearState, readState, writeState } from "../lib/storage.js";
import { isSupabaseConfigured, supabase } from "../lib/supabase.js";

const clone = (value) => JSON.parse(JSON.stringify(value));
const makeId = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const REMOTE_STATE_ID = "rankball-mvp";

function mergeById(current = [], fallback = []) {
  const currentMap = new Map(current.map((item) => [item.id, item]));
  const mergedDefaults = fallback.map((item) => ({ ...item, ...(currentMap.get(item.id) ?? {}) }));
  const extraItems = current.filter((item) => !fallback.some((fallbackItem) => fallbackItem.id === item.id));
  return [...mergedDefaults, ...extraItems];
}

function normalizeState(state) {
  return {
    ...clone(initialState),
    ...state,
    users: mergeById(state?.users, initialState.users),
    teams: mergeById(state?.teams, initialState.teams),
    affiliations: mergeById(state?.affiliations, initialState.affiliations),
    matches: mergeById(state?.matches, initialState.matches),
    notifications: state?.notifications?.length ? state.notifications : initialState.notifications,
  };
}

export function loadState() {
  return normalizeState(readState(clone(initialState)));
}

export function saveState(state) {
  writeState(state);
}

export async function loadRemoteState() {
  if (!isSupabaseConfigured) return null;

  const { data, error } = await supabase
    .from("rankball_state")
    .select("state")
    .eq("id", REMOTE_STATE_ID)
    .maybeSingle();

  if (error) {
    console.warn("Supabase state load failed. Falling back to local mock mode.", error.message);
    return null;
  }

  if (data?.state && Object.keys(data.state).length > 0) {
    const normalized = normalizeState(data.state);
    if (JSON.stringify(normalized) !== JSON.stringify(data.state)) {
      await saveRemoteState(normalized);
    }
    return normalized;
  }

  await saveRemoteState(clone(initialState));
  return clone(initialState);
}

export async function saveRemoteState(state) {
  if (!isSupabaseConfigured) return;

  const { error } = await supabase.from("rankball_state").upsert({
    id: REMOTE_STATE_ID,
    state,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    console.warn("Supabase state save failed. Local state remains available.", error.message);
  }
}

export function subscribeRemoteState(onState) {
  if (!isSupabaseConfigured) return () => {};

  const channel = supabase
    .channel("rankball-state")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "rankball_state", filter: `id=eq.${REMOTE_STATE_ID}` },
      (payload) => {
        if (payload.new?.state) onState(payload.new.state);
      },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export function resetState() {
  clearState();
  return clone(initialState);
}

function getTeamPlayers(team, size) {
  return team.members.slice(0, size).map((member) => member.userId);
}

function teamRegularRatio(team, playerIds) {
  if (!team) return 1;
  const selected = team.members.filter((member) => playerIds.includes(member.userId));
  if (!selected.length) return 1;
  const weighted = selected.reduce((sum, member) => {
    if (member.role === "mercenary" || member.role === "guest") return sum + 0.35;
    if (member.role === "candidate") return sum + 0.75;
    return sum + 1;
  }, 0);
  return weighted / selected.length;
}

function updateAffiliationScores(state) {
  const users = state.users;
  return state.affiliations.map((affiliation) => {
    const members = users.filter((user) => {
      if (affiliation.type === "region") return user.region === affiliation.name;
      if (affiliation.type === "school") return user.school === affiliation.name;
      if (affiliation.type === "company") return user.company === affiliation.name;
      if (affiliation.type === "club") return user.club === affiliation.name;
      return false;
    });
    if (!members.length) return affiliation;
    const average = members.reduce((sum, user) => sum + user.ratings.integrated, 0) / members.length;
    return { ...affiliation, score: Math.round(average + affiliation.wins * 2 - affiliation.losses) };
  });
}

function finalizeMatch(state, targetMatch) {
  const ratings = Object.fromEntries(state.users.map((user) => [user.id, clone(user.ratings)]));
  const ratingResult = applyMatchRating(targetMatch, state.users, ratings, state.matches);
  const scoreA = Number(targetMatch.result.scoreA);
  const scoreB = Number(targetMatch.result.scoreB);
  const actualA = scoreA === scoreB ? 0.5 : scoreA > scoreB ? 1 : 0;
  const actualB = 1 - actualA;
  const teamA = state.teams.find((team) => team.id === targetMatch.teamA.teamId);
  const teamB = state.teams.find((team) => team.id === targetMatch.teamB.teamId);
  const teamADelta = teamA
    ? calculateTeamDelta({
        teamMmr: teamA.mmr,
        opponentTeamMmr: teamB?.mmr ?? 1200,
        actual: actualA,
        match: targetMatch,
        regularRatio: teamRegularRatio(teamA, targetMatch.teamA.players),
      })
    : 0;
  const teamBDelta = teamB
    ? calculateTeamDelta({
        teamMmr: teamB.mmr,
        opponentTeamMmr: teamA?.mmr ?? 1200,
        actual: actualB,
        match: targetMatch,
        regularRatio: teamRegularRatio(teamB, targetMatch.teamB.players),
      })
    : 0;

  const users = state.users.map((user) => {
    const nextRatings = ratingResult.ratings[user.id];
    if (!nextRatings) return user;
    const change = ratingResult.changes.find((item) => item.playerId === user.id);
    return {
      ...user,
      streak: change?.result === "win" ? Math.max(1, user.streak + 1) : change?.result === "loss" ? Math.min(-1, user.streak - 1) : user.streak,
      ratings: nextRatings,
    };
  });

  const teams = state.teams.map((team) => {
    if (team.id === targetMatch.teamA.teamId) {
      return {
        ...team,
        mmr: Math.round(team.mmr + teamADelta),
        wins: team.wins + (actualA === 1 ? 1 : 0),
        losses: team.losses + (actualA === 0 ? 1 : 0),
      };
    }
    if (team.id === targetMatch.teamB.teamId) {
      return {
        ...team,
        mmr: Math.round(team.mmr + teamBDelta),
        wins: team.wins + (actualB === 1 ? 1 : 0),
        losses: team.losses + (actualB === 0 ? 1 : 0),
      };
    }
    return team;
  });

  const confirmedMatch = {
    ...targetMatch,
    status: "confirmed",
    ratingResult: ratingResult.changes,
    teamRatingResult: { teamA: teamADelta, teamB: teamBDelta },
    confirmedAt: new Date().toISOString(),
  };
  const nextState = {
    ...state,
    users,
    teams,
    matches: state.matches.map((match) => (match.id === targetMatch.id ? confirmedMatch : match)),
    notifications: [
      {
        id: makeId("n"),
        title: "경기 확정",
        body: `${targetMatch.title} 결과가 티어와 랭킹에 반영됐습니다.`,
        tone: "tier",
      },
      ...state.notifications,
    ],
  };

  return { ...nextState, affiliations: updateAffiliationScores(nextState) };
}

export function createMatch(state, draft) {
  const mode = draft.mode ?? "5v5";
  const size = MODE_SIZES[mode] ?? 5;
  const scheduledAt = `${draft.scheduledDate ?? ""} ${draft.scheduledTime ?? ""}`.trim();
  const teams = state.teams;
  const teamA = teams.find((team) => team.id === draft.teamAId) ?? teams[0];
  const teamB = teams.find((team) => team.id === draft.teamBId && team.id !== teamA.id) ?? teams.find((team) => team.id !== teamA.id) ?? teams[1];
  const evidence = (draft.evidence ?? []).map((item) => ({ id: item.id, label: item.label }));
  const match = {
    id: makeId("m"),
    title: draft.title || `${draft.court} ${mode} 판`,
    mode,
    court: draft.court,
    scheduledDate: draft.scheduledDate,
    scheduledTime: draft.scheduledTime,
    scheduledAt: scheduledAt || "일정 미정",
    status: "contract",
    official: Boolean(draft.official),
    preRegistered: Boolean(draft.preRegistered),
    rules: {
      targetScore: Number(draft.targetScore ?? 21),
      timeLimit: Number(draft.timeLimit ?? 12),
      winByTwo: Boolean(draft.winByTwo),
      ball: draft.ball || "7호 공",
    },
    memo: draft.memo || "결과는 양팀 과반 승인 후 티어에 반영됩니다.",
    stakes: draft.stakes || "내기 없음. 기록과 티어만 반영합니다.",
    evidence,
    teamA: { name: teamA.name, teamId: teamA.id, players: getTeamPlayers(teamA, size), score: 0 },
    teamB: { name: teamB.name, teamId: teamB.id, players: getTeamPlayers(teamB, size), score: 0 },
    approvals: { teamA: [], teamB: [] },
    result: null,
    ratingResult: null,
    createdAt: new Date().toISOString(),
  };

  return {
    ...state,
    matches: [match, ...state.matches],
    notifications: [
      { id: makeId("n"), title: "새 경기방", body: `${match.title} 계약서가 생성됐습니다.`, tone: "match" },
      ...state.notifications,
    ],
  };
}

export function submitMatchResult(state, matchId, result) {
  return {
    ...state,
    matches: state.matches.map((match) =>
      match.id === matchId
        ? {
            ...match,
            status: "approval",
            teamA: { ...match.teamA, score: Number(result.scoreA) },
            teamB: { ...match.teamB, score: Number(result.scoreB) },
            approvals: { teamA: [], teamB: [] },
            result: {
              scoreA: Number(result.scoreA),
              scoreB: Number(result.scoreB),
              playerStats: normalizePlayerStats(result.playerStats, [...match.teamA.players, ...match.teamB.players]),
              submittedAt: new Date().toISOString(),
            },
          }
        : match,
    ),
  };
}

export function approveMatch(state, matchId, sideName, playerId) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match?.result || match.status === "confirmed") return state;

  const sidePlayers = match[sideName]?.players ?? [];
  const approvalId = playerId && sidePlayers.includes(playerId)
    ? playerId
    : sidePlayers.find((id) => !(match.approvals?.[sideName] ?? []).includes(id));

  if (!approvalId) return state;

  const updatedMatch = {
    ...match,
    approvals: {
      ...(match.approvals ?? { teamA: [], teamB: [] }),
      [sideName]: Array.from(new Set([...(match.approvals?.[sideName] ?? []), approvalId])),
    },
  };
  const stateWithApproval = {
    ...state,
    matches: state.matches.map((item) => (item.id === matchId ? updatedMatch : item)),
  };

  if (getApprovalStatus(updatedMatch, state.teams, "teamA").approved && getApprovalStatus(updatedMatch, state.teams, "teamB").approved) {
    return finalizeMatch(stateWithApproval, updatedMatch);
  }

  return stateWithApproval;
}

export function updateProfile(state, patch) {
  return {
    ...state,
    users: state.users.map((user) => (user.id === state.currentUserId ? { ...user, ...patch } : user)),
  };
}

export function createTeam(state, teamDraft) {
  const captainId = teamDraft.captainId || state.currentUserId;
  const captainTeamCount = state.teams.filter((team) => team.members.some((member) => member.userId === captainId)).length;
  if (captainTeamCount >= MAX_TEAM_MEMBERSHIPS) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "팀 생성 제한",
          body: `한 플레이어는 최대 ${MAX_TEAM_MEMBERSHIPS}개 팀까지만 소속될 수 있습니다.`,
          tone: "team",
        },
        ...state.notifications,
      ],
    };
  }

  const team = {
    id: makeId("t"),
    name: teamDraft.name,
    homeCourt: teamDraft.homeCourt,
    region: teamDraft.region,
    mmr: 1200,
    wins: 0,
    losses: 0,
    accent: teamDraft.accent || "#58d2c0",
    members: [{ userId: captainId, role: "captain" }],
  };

  return {
    ...state,
    teams: [team, ...state.teams],
    notifications: [{ id: makeId("n"), title: "팀 생성", body: `${team.name} 팀이 등록됐습니다.`, tone: "team" }, ...state.notifications],
  };
}

export function getMemberRoleLabel(role) {
  return TEAM_ROLES[role] ?? role;
}
