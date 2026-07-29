import { shuffleItems } from "./rowUtils.js";

export function normalizeTournament(tournament = {}) {
  const teamIds = tournament.teamIds ?? [];
  const refereeIds = tournament.refereeIds ?? [];
  const teamStatuses = {
    ...Object.fromEntries(teamIds.map((teamId) => [teamId, "invited"])),
    ...(tournament.teamStatuses ?? {}),
  };
  const refereeStatuses = {
    ...Object.fromEntries(refereeIds.map((refereeId) => [refereeId, "invited"])),
    ...(tournament.refereeStatuses ?? {}),
  };

  return {
    ...tournament,
    status: tournament.status ?? "draft",
    teamIds,
    teamStatuses,
    teamApprovals: tournament.teamApprovals ?? {},
    refereeIds,
    refereeStatuses,
    refereeApprovals: tournament.refereeApprovals ?? {},
    sanctionStatus: tournament.sanctionStatus ?? "pending",
    matchIds: tournament.matchIds ?? [],
    bracket: tournament.bracket ?? null,
  };
}

export function getTournamentTeamStatuses(tournament = {}) {
  return {
    ...Object.fromEntries((tournament.teamIds ?? []).map((teamId) => [teamId, "invited"])),
    ...(tournament.teamStatuses ?? {}),
  };
}

export function getTournamentTeamStatus(tournament = {}, teamId = "") {
  return getTournamentTeamStatuses(tournament)[teamId] ?? "invited";
}

export function getTournamentTeamIds(tournament = {}) {
  return [...new Set([
    ...(tournament.teamIds ?? []),
    ...Object.keys(tournament.teamStatuses ?? {}),
  ].filter(Boolean))];
}

export function getTournamentTeamRosterSnapshot(tournament = {}, teamId = "") {
  const snapshot = tournament?.rules?.teamRosterSnapshot?.teams?.[teamId];
  return snapshot && typeof snapshot === "object" ? snapshot : null;
}

export function getTournamentRosterTeam(team = null, tournament = {}, teamId = "", fallbackName = "") {
  const snapshot = getTournamentTeamRosterSnapshot(tournament, teamId);
  const snapshotMembers = Array.isArray(snapshot?.members)
    ? snapshot.members
        .map((member) => ({
          userId: member.userId ?? member.user_id ?? "",
          role: member.role ?? "regular",
        }))
        .filter((member) => member.userId)
    : [];
  const membersById = new Map(snapshotMembers.map((member) => [member.userId, member]));
  (team?.members ?? []).forEach((member) => {
    if (member?.userId) membersById.set(member.userId, member);
  });
  if (snapshot?.captainId && !membersById.has(snapshot.captainId)) {
    membersById.set(snapshot.captainId, { userId: snapshot.captainId, role: "captain" });
  }
  if (!team && !snapshot) return null;
  return {
    ...(team ?? {}),
    id: team?.id ?? teamId,
    name: team?.name ?? fallbackName ?? "",
    members: [...membersById.values()],
  };
}

export function buildLeaguePairings(teamIds = []) {
  const pairings = [];
  for (let homeIndex = 0; homeIndex < teamIds.length; homeIndex += 1) {
    for (let awayIndex = homeIndex + 1; awayIndex < teamIds.length; awayIndex += 1) {
      pairings.push({
        round: 1,
        fixture: pairings.length + 1,
        teamAId: teamIds[homeIndex],
        teamBId: teamIds[awayIndex],
      });
    }
  }
  return pairings;
}

function getByeMatchIndexes(matchCount, byeCount) {
  const indexes = [];
  let left = 0;
  let right = matchCount - 1;
  while (indexes.length < byeCount && left <= right) {
    indexes.push(left);
    if (indexes.length < byeCount && right !== left) indexes.push(right);
    left += 1;
    right -= 1;
  }
  return new Set(indexes);
}

export function buildTournamentPairings(teamIds = []) {
  const seedOrder = shuffleItems(teamIds);
  const bracketSize = 2 ** Math.ceil(Math.log2(Math.max(seedOrder.length, 2)));
  const matchCount = bracketSize / 2;
  const byeCount = Math.max(0, bracketSize - seedOrder.length);
  const byeMatchIndexes = getByeMatchIndexes(matchCount, byeCount);
  let seedIndex = 0;
  const firstRound = Array.from({ length: matchCount }, (_item, index) => {
    if (byeMatchIndexes.has(index)) {
      const teamAId = seedOrder[seedIndex++] ?? null;
      return {
        id: `r1-${index + 1}`,
        round: 1,
        fixture: index + 1,
        teamAId,
        teamBId: null,
        byeTeamId: teamAId,
      };
    }
    const teamAId = seedOrder[seedIndex++] ?? null;
    const teamBId = seedOrder[seedIndex++] ?? null;
    return {
      id: `r1-${index + 1}`,
      round: 1,
      fixture: index + 1,
      teamAId,
      teamBId,
      byeTeamId: !teamBId ? teamAId : null,
    };
  });
  const pairings = firstRound
    .filter((row) => row.teamAId && row.teamBId)
    .map((row) => ({
      round: row.round,
      fixture: row.fixture,
      bracketMatch: row.fixture,
      teamAId: row.teamAId,
      teamBId: row.teamBId,
    }));
  const byes = firstRound.filter((row) => row.byeTeamId).map((row) => row.byeTeamId);
  const slots = firstRound.flatMap((row) => [row.teamAId, row.teamBId]);
  return { seedOrder, bracketSize, slots, firstRound, pairings, byes };
}

export function fromRemoteTournament(tournament = {}, { tournamentTeamsByTournament = new Map(), courtById = {} } = {}) {
  const teamRows = [...(tournamentTeamsByTournament.get(tournament.id) ?? [])]
    .sort((a, b) => (a.seed_order ?? 0) - (b.seed_order ?? 0));
  const rowTeamStatuses = Object.fromEntries(teamRows.map((team) => [team.team_id, team.status ?? "invited"]));
  const rowTeamApprovals = Object.fromEntries(
    teamRows
      .filter((team) => team.approved_by || team.approved_at)
      .map((team) => [team.team_id, { by: team.approved_by, approvedAt: team.approved_at }]),
  );
  return {
    id: tournament.id,
    title: tournament.title,
    format: tournament.format,
    visibility: tournament.visibility,
    status: tournament.status,
    region: tournament.region,
    courtId: tournament.court_id ?? null,
    court: tournament.court_name ?? courtById[tournament.court_id]?.name ?? "미정",
    mode: tournament.mode,
    ranked: tournament.ranked,
    official: tournament.official,
    startDate: tournament.start_date,
    endDate: tournament.end_date,
    schedulePolicy: tournament.schedule_policy,
    scheduleNote: tournament.schedule_note,
    mmrLimitMode: tournament.mmr_limit_mode,
    maxMmrGap: tournament.max_mmr_gap,
    mmrPolicy: tournament.mmr_policy,
    rules: tournament.rules ?? {},
    memo: tournament.memo,
    createdBy: tournament.created_by,
    createdAt: tournament.created_at,
    startedAt: tournament.started_at,
    matchIds: tournament.match_ids ?? [],
    teamStatuses: { ...rowTeamStatuses, ...(tournament.team_statuses ?? {}) },
    teamApprovals: { ...rowTeamApprovals, ...(tournament.team_approvals ?? {}) },
    refereeIds: tournament.referee_ids ?? [],
    refereeStatuses: tournament.referee_statuses ?? {},
    refereeApprovals: tournament.referee_approvals ?? {},
    sanctionStatus: tournament.sanction_status ?? "pending",
    sanctionReviewedBy: tournament.sanction_reviewed_by ?? null,
    sanctionReviewedAt: tournament.sanction_reviewed_at ?? null,
    sanctionReviewNote: tournament.sanction_review_note ?? "",
    bracket: tournament.bracket ?? null,
    teamIds: teamRows.map((team) => team.team_id),
  };
}
