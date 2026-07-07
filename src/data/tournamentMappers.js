export function normalizeTournament(tournament = {}) {
  const teamIds = tournament.teamIds ?? [];
  const teamStatuses = {
    ...Object.fromEntries(teamIds.map((teamId) => [teamId, "invited"])),
    ...(tournament.teamStatuses ?? {}),
  };

  return {
    ...tournament,
    status: tournament.status ?? "draft",
    teamIds,
    teamStatuses,
    teamApprovals: tournament.teamApprovals ?? {},
    matchIds: tournament.matchIds ?? [],
    bracket: tournament.bracket ?? null,
  };
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
    bracket: tournament.bracket ?? null,
    teamIds: teamRows.map((team) => team.team_id),
  };
}
