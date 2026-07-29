// Shared trust-score domain policy.
export function clampTrustScore(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value ?? 80))));
}

export function adjustUserTrust(users = [], userId, delta) {
  if (!userId || !delta) return users;
  return users.map((user) => (
    user.id === userId
      ? { ...user, trustScore: clampTrustScore((user.trustScore ?? 80) + delta) }
      : user
  ));
}

export function getFoulTrustPenalty(stats = {}) {
  const fouls = Math.max(0, Number(stats.fouls ?? 0));
  if (fouls <= 2) return 0;
  return -Math.min(4, fouls - 2);
}
