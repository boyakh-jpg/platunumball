export function useAuth(app) {
  return {
    user: app.currentUser,
    isDemoMode: true,
  };
}
