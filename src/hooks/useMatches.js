export function useMatches(app) {
  return {
    matches: app.state.matches,
    createMatch: app.actions.createMatch,
    submitMatchResult: app.actions.submitMatchResult,
    approveMatch: app.actions.approveMatch,
  };
}
