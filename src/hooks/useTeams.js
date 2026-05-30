export function useTeams(app) {
  return {
    teams: app.state.teams,
    createTeam: app.actions.createTeam,
  };
}
