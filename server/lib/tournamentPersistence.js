export function projectTournamentDbIdentity(tournament = {}, overrides = {}) {
  const courtId = Object.hasOwn(overrides, "courtId") ? overrides.courtId : tournament.courtId;
  const courtName = Object.hasOwn(overrides, "courtName") ? overrides.courtName : tournament.court;
  return {
    id: tournament.id,
    title: tournament.title,
    format: tournament.format,
    visibility: tournament.visibility,
    status: tournament.status,
    region: tournament.region,
    court_id: courtId,
    court_name: courtName,
    mode: tournament.mode,
  };
}
