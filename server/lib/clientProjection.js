export function compactClientUser(user = {}, profileId = "") {
  const compact = {
    id: user.id,
    name: user.name,
    handle: user.handle,
    hashtag: user.hashtag,
    position: user.position,
    region: user.region,
    avatarColor: user.avatarColor,
    avatarKey: user.avatarKey ?? null,
    avatarSource: user.avatarSource ?? "initial",
    avatarIconKey: user.avatarIconKey ?? null,
    avatarUpdatedAt: user.avatarUpdatedAt ?? null,
    avatarBackgroundEnabled: user.avatarBackgroundEnabled !== false,
    avatarBorderEnabled: user.avatarBorderEnabled === true,
    avatarBorderColor: user.avatarBorderColor ?? user.avatarColor,
    discordAvatarUrl: user.discordAvatarUrl ?? null,
    trustScore: user.trustScore,
    ratings: Number.isFinite(Number(user.ratings?.integrated))
      ? { integrated: user.ratings.integrated, placement: user.ratings?.placement }
      : undefined,
    ageGroup: user.ageGroup,
  };
  if (user.id !== profileId) return compact;
  return {
    ...compact,
    regionSido: user.regionSido,
    regionDistrict: user.regionDistrict,
    school: user.school,
    company: user.company,
    club: user.club,
    streak: user.streak,
    ratings: user.ratings,
    authUserId: user.authUserId,
    testLoginId: user.testLoginId,
    birthYear: user.birthYear,
    ageGroupCheckedSeason: user.ageGroupCheckedSeason,
    onboardingComplete: user.onboardingComplete,
    profileVersion: user.profileVersion,
    handleLockedAt: user.handleLockedAt,
    birthYearLockedAt: user.birthYearLockedAt,
    nameUpdatedAt: user.nameUpdatedAt,
    discordConnection: user.discordConnection,
    discordUserId: user.discordUserId,
  };
}
