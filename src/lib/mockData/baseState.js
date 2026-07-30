export * from "./baseStateHelpers.js";
import { baseUsers, baseTeams } from "./baseDirectoryFixtures.js";
import { baseAffiliations, baseSeasons, baseMatches, baseNotifications, baseTournaments, baseRecruitingPosts, baseSettings, baseReports } from "./baseActivityFixtures.js";

export const baseState = {
  currentUserId: "u1",
  users: baseUsers,
  teams: baseTeams,
  affiliations: baseAffiliations,
  seasons: baseSeasons,
  matches: baseMatches,
  notifications: baseNotifications,
  tournaments: baseTournaments,
  recruitingPosts: baseRecruitingPosts,
  settings: baseSettings,
  reports: baseReports,
};
