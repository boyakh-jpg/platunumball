export function useAuth(app) {
  return {
    user: app.currentUser,
    isMockMode: true,
  };
}
