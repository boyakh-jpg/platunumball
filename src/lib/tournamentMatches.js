export function getTournamentMatches(tournament = {}, matchesById = {}, matches = []) {
  const fromIds = (tournament.matchIds ?? [])
    .map((matchId) => matchesById[matchId])
    .filter(Boolean);
  const linkedMatches = matches.filter((match) => match.tournamentId === tournament.id);
  const uniqueMatches = [
    ...new Map(
      [...fromIds, ...linkedMatches].map((match) => [match.id, match]),
    ).values(),
  ];

  return uniqueMatches.sort((left, right) => (
    (left.tournamentRound ?? 0) - (right.tournamentRound ?? 0)
    || (left.tournamentFixture ?? 0) - (right.tournamentFixture ?? 0)
  ));
}
