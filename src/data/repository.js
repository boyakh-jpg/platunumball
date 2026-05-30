import { MAX_TEAM_MEMBERSHIPS, MODE_SIZES, TEAM_ROLES } from "../lib/constants.js";
import { initialState } from "../lib/mockData.js";
import { getAgreementStatus, getApprovalStatus, normalizePlayerStats } from "../lib/matchUtils.js";
import { applyMatchRating, calculateTeamDelta } from "../lib/rating.js";
import { clearState, readState, writeState } from "../lib/storage.js";
import { isSupabaseConfigured, supabase } from "../lib/supabase.js";

const clone = (value) => JSON.parse(JSON.stringify(value));
const makeId = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const REMOTE_STATE_ID = "rankball-mvp";
const DEFAULT_SETTINGS = {
  privacy: {
    regionRanking: true,
    teamHistory: true,
    statSummary: true,
  },
  blockedUserIds: [],
};

function mergeById(current = [], fallback = []) {
  const currentMap = new Map(current.map((item) => [item.id, item]));
  const mergedDefaults = fallback.map((item) => ({ ...item, ...(currentMap.get(item.id) ?? {}) }));
  const extraItems = current.filter((item) => !fallback.some((fallbackItem) => fallbackItem.id === item.id));
  return [...mergedDefaults, ...extraItems];
}

function normalizeMatch(match) {
  const startedStatuses = ["agreed", "approval", "confirmed", "disputed", "void", "cancelled"];
  const started = startedStatuses.includes(match.status);
  const teamAPlayers = match.teamA?.players ?? [];
  const teamBPlayers = match.teamB?.players ?? [];

  return {
    ...match,
    status: match.status ?? "contract",
    agreements: match.agreements ?? {
      teamA: started ? [...teamAPlayers] : [],
      teamB: started ? [...teamBPlayers] : [],
    },
    approvals: match.approvals ?? { teamA: [], teamB: [] },
    disputes: match.disputes ?? [],
  };
}

function normalizeSettings(settings = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    privacy: {
      ...DEFAULT_SETTINGS.privacy,
      ...(settings.privacy ?? {}),
    },
    blockedUserIds: settings.blockedUserIds ?? [],
  };
}

function normalizeState(state) {
  const notifications = state?.notifications?.length ? state.notifications : initialState.notifications;

  return {
    ...clone(initialState),
    ...state,
    users: mergeById(state?.users, initialState.users),
    teams: mergeById(state?.teams, initialState.teams),
    affiliations: mergeById(state?.affiliations, initialState.affiliations),
    matches: mergeById(state?.matches, initialState.matches).map(normalizeMatch),
    notifications: notifications.map((notification) => ({ readAt: null, ...notification })),
    settings: normalizeSettings(state?.settings ?? initialState.settings),
    reports: state?.reports ?? initialState.reports ?? [],
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
    console.warn("Supabase state load failed. Falling back to local demo mode.", error.message);
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
      trustScore: Math.min(100, (user.trustScore ?? 80) + 1),
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
        matchId: targetMatch.id,
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
    ranked: draft.ranked !== false,
    official: Boolean(draft.official),
    preRegistered: Boolean(draft.preRegistered),
    rules: {
      targetScore: Number(draft.targetScore ?? 21),
      timeLimit: Number(draft.timeLimit ?? 12),
      winByTwo: Boolean(draft.winByTwo),
      ball: draft.ball || "7호 공",
      attackRule: draft.attackRule || "공격권은 득점 후 교대",
      foulRule: draft.foulRule || "파울은 콜한 쪽 기준으로 즉시 중단",
    },
    memo: draft.memo || "결과는 양팀 과반 승인 후 티어에 반영됩니다.",
    stakes: draft.stakes || "금전 거래 없이 약속과 벌칙만 기록합니다.",
    objectionWindow: draft.objectionWindow || (draft.official ? "24시간" : "1시간"),
    evidence,
    teamA: { name: teamA.name, teamId: teamA.id, players: getTeamPlayers(teamA, size), score: 0 },
    teamB: { name: teamB.name, teamId: teamB.id, players: getTeamPlayers(teamB, size), score: 0 },
    agreements: { teamA: [], teamB: [] },
    approvals: { teamA: [], teamB: [] },
    disputes: [],
    result: null,
    ratingResult: null,
    createdAt: new Date().toISOString(),
  };

  return {
    ...state,
    matches: [match, ...state.matches],
    notifications: [
      { id: makeId("n"), title: "새 경기방", body: `${match.title} 경기 전 동의를 기다립니다.`, tone: "match", matchId: match.id },
      ...state.notifications,
    ],
  };
}

function getNextDecisionId(match, sideName, decisionKey, playerId) {
  const sidePlayers = match[sideName]?.players ?? [];
  if (playerId && sidePlayers.includes(playerId)) return playerId;
  return sidePlayers.find((id) => !(match[decisionKey]?.[sideName] ?? []).includes(id));
}

export function agreeMatch(state, matchId, sideName, playerId) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match || !["contract", "agreed"].includes(match.status)) return state;

  const agreementId = getNextDecisionId(match, sideName, "agreements", playerId);
  if (!agreementId) return state;

  const updatedMatch = {
    ...match,
    agreements: {
      ...(match.agreements ?? { teamA: [], teamB: [] }),
      [sideName]: Array.from(new Set([...(match.agreements?.[sideName] ?? []), agreementId])),
    },
  };
  const ready =
    match.status !== "agreed" &&
    getAgreementStatus(updatedMatch, state.teams, "teamA").approved &&
    getAgreementStatus(updatedMatch, state.teams, "teamB").approved;
  const nextMatch = ready
    ? { ...updatedMatch, status: "agreed", agreedAt: updatedMatch.agreedAt ?? new Date().toISOString() }
    : updatedMatch;

  return {
    ...state,
    matches: state.matches.map((item) => (item.id === matchId ? nextMatch : item)),
    notifications: ready
      ? [
          {
            id: makeId("n"),
            title: "경기 전 동의 완료",
            body: `${match.title} 경기 결과를 입력할 수 있습니다.`,
            tone: "match",
            matchId,
          },
          ...state.notifications,
        ]
      : state.notifications,
  };
}

export function submitMatchResult(state, matchId, result) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match) return state;
  if (match.status === "contract") {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "경기 전 동의 필요",
          body: `${match.title}는 양팀 동의가 끝나야 결과를 입력할 수 있습니다.`,
          tone: "match",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }
  if (["confirmed", "void", "cancelled", "disputed"].includes(match.status)) return state;

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
    notifications: [
      {
        id: makeId("n"),
        title: "결과 승인 대기",
        body: `${match.title} 결과가 제출됐습니다. 양팀 승인을 기다립니다.`,
        tone: "match",
        matchId,
      },
      ...state.notifications,
    ],
  };
}

export function approveMatch(state, matchId, sideName, playerId) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match?.result || ["confirmed", "void", "cancelled", "disputed"].includes(match.status)) return state;

  const approvalId = getNextDecisionId(match, sideName, "approvals", playerId);
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

export function disputeMatch(state, matchId, reason = "") {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match?.result || match.status !== "approval") return state;

  const dispute = {
    id: makeId("d"),
    by: state.currentUserId,
    reason: reason.trim() || "스코어 또는 개인 기록 확인이 필요합니다.",
    createdAt: new Date().toISOString(),
  };

  return {
    ...state,
    matches: state.matches.map((item) =>
      item.id === matchId
        ? { ...item, status: "disputed", disputes: [dispute, ...(item.disputes ?? [])] }
        : item,
    ),
    notifications: [
      {
        id: makeId("n"),
        title: "이의제기 접수",
        body: `${match.title} 결과가 보류됐습니다. 양팀 확인 후 재승인하거나 무효 처리하세요.`,
        tone: "match",
        matchId,
      },
      ...state.notifications,
    ],
  };
}

export function cancelMatch(state, matchId) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match || !["contract", "agreed"].includes(match.status)) return state;

  return {
    ...state,
    matches: state.matches.map((item) =>
      item.id === matchId
        ? { ...item, status: "cancelled", cancelledAt: new Date().toISOString() }
        : item,
    ),
    notifications: [
      { id: makeId("n"), title: "경기 취소", body: `${match.title} 경기방이 취소됐습니다.`, tone: "match", matchId },
      ...state.notifications,
    ],
  };
}

export function voidMatch(state, matchId) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match || match.status !== "disputed") return state;

  return {
    ...state,
    matches: state.matches.map((item) =>
      item.id === matchId
        ? { ...item, status: "void", ranked: false, voidedAt: new Date().toISOString() }
        : item,
    ),
    notifications: [
      { id: makeId("n"), title: "결과 무효", body: `${match.title} 결과가 랭킹 반영에서 제외됐습니다.`, tone: "match", matchId },
      ...state.notifications,
    ],
  };
}

export function resumeMatchApproval(state, matchId) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match || match.status !== "disputed") return state;

  return {
    ...state,
    matches: state.matches.map((item) =>
      item.id === matchId
        ? { ...item, status: "approval", approvals: { teamA: [], teamB: [] }, reviewResumedAt: new Date().toISOString() }
        : item,
    ),
    notifications: [
      { id: makeId("n"), title: "승인 재개", body: `${match.title} 결과 승인을 다시 시작합니다.`, tone: "match", matchId },
      ...state.notifications,
    ],
  };
}

export function switchUser(state, userId) {
  if (!state.users.some((user) => user.id === userId)) return state;
  return { ...state, currentUserId: userId };
}

export function updatePrivacySettings(state, patch) {
  return {
    ...state,
    settings: normalizeSettings({
      ...(state.settings ?? {}),
      privacy: {
        ...(state.settings?.privacy ?? DEFAULT_SETTINGS.privacy),
        ...patch,
      },
    }),
  };
}

export function blockUser(state, userId) {
  if (!state.users.some((user) => user.id === userId) || userId === state.currentUserId) return state;
  const blockedUserIds = Array.from(new Set([...(state.settings?.blockedUserIds ?? []), userId]));
  const blockedUser = state.users.find((user) => user.id === userId);

  return {
    ...state,
    settings: normalizeSettings({ ...(state.settings ?? {}), blockedUserIds }),
    notifications: [
      {
        id: makeId("n"),
        title: "플레이어 차단",
        body: `${blockedUser?.name ?? "선택한 플레이어"}가 홈 검색과 추천 목록에서 숨겨집니다.`,
        tone: "team",
      },
      ...state.notifications,
    ],
  };
}

export function unblockUser(state, userId) {
  return {
    ...state,
    settings: normalizeSettings({
      ...(state.settings ?? {}),
      blockedUserIds: (state.settings?.blockedUserIds ?? []).filter((id) => id !== userId),
    }),
  };
}

export function reportMatch(state, matchId, reason = "") {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match) return state;
  const report = {
    id: makeId("r"),
    type: "match",
    targetId: matchId,
    by: state.currentUserId,
    reason: reason.trim() || "경기 기록 확인이 필요합니다.",
    status: "open",
    createdAt: new Date().toISOString(),
  };

  return {
    ...state,
    reports: [report, ...(state.reports ?? [])],
    notifications: [
      {
        id: makeId("n"),
        title: "신고 접수",
        body: `${match.title} 신고가 접수됐습니다. 운영 검토 목록에 남겼습니다.`,
        tone: "match",
        matchId,
      },
      ...state.notifications,
    ],
  };
}

export function markNotificationRead(state, notificationId) {
  const readAt = new Date().toISOString();
  return {
    ...state,
    notifications: state.notifications.map((notification) =>
      notification.id === notificationId ? { ...notification, readAt: notification.readAt ?? readAt } : notification,
    ),
  };
}

export function markAllNotificationsRead(state) {
  const readAt = new Date().toISOString();
  return {
    ...state,
    notifications: state.notifications.map((notification) => ({ ...notification, readAt: notification.readAt ?? readAt })),
  };
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

export function addTeamMember(state, teamId, memberDraft) {
  const userId = memberDraft.userId;
  const team = state.teams.find((item) => item.id === teamId);
  if (!team || team.members.some((member) => member.userId === userId)) return state;

  const membershipCount = state.teams.filter((item) => item.members.some((member) => member.userId === userId)).length;
  if (membershipCount >= MAX_TEAM_MEMBERSHIPS) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "팀원 추가 제한",
          body: `한 플레이어는 최대 ${MAX_TEAM_MEMBERSHIPS}개 팀까지만 소속될 수 있습니다.`,
          tone: "team",
        },
        ...state.notifications,
      ],
    };
  }

  return {
    ...state,
    teams: state.teams.map((item) =>
      item.id === teamId
        ? { ...item, members: [...item.members, { userId, role: memberDraft.role || "regular" }] }
        : item,
    ),
  };
}

export function updateTeamMemberRole(state, teamId, userId, role) {
  return {
    ...state,
    teams: state.teams.map((team) => {
      if (team.id !== teamId) return team;
      const nextMembers = team.members.map((member) => (
        member.userId === userId ? { ...member, role } : member
      ));
      const hasCaptain = nextMembers.some((member) => member.role === "captain");
      return {
        ...team,
        members: hasCaptain ? nextMembers : nextMembers.map((member, index) => (index === 0 ? { ...member, role: "captain" } : member)),
      };
    }),
  };
}

export function removeTeamMember(state, teamId, userId) {
  return {
    ...state,
    teams: state.teams.map((team) => {
      if (team.id !== teamId) return team;
      const nextMembers = team.members.filter((member) => member.userId !== userId);
      const hasCaptain = nextMembers.some((member) => member.role === "captain");
      return {
        ...team,
        members: hasCaptain ? nextMembers : nextMembers.map((member, index) => (index === 0 ? { ...member, role: "captain" } : member)),
      };
    }),
  };
}

export function getMemberRoleLabel(role) {
  return TEAM_ROLES[role] ?? role;
}
