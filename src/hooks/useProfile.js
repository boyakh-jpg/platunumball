export function useProfile(app) {
  return {
    profile: app.currentUser,
    updateProfile: app.actions.updateProfile,
  };
}
