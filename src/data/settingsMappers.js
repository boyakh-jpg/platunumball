import { DEFAULT_SETTINGS } from "./repositoryDefaults.js";

export function normalizeSettings(settings = {}, options = {}) {
  const fallbackSettings = options.fallbackSettings ?? {};
  const theme = settings.theme === "light" ? "light" : "dark";
  const discordChannel = settings.notificationChannels?.discord ?? {};
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    theme,
    privacy: {
      ...DEFAULT_SETTINGS.privacy,
      ...(settings.privacy ?? {}),
    },
    notificationChannels: {
      ...DEFAULT_SETTINGS.notificationChannels,
      ...(settings.notificationChannels ?? {}),
      discord: {
        ...DEFAULT_SETTINGS.notificationChannels.discord,
        ...discordChannel,
        events: {
          ...DEFAULT_SETTINGS.notificationChannels.discord.events,
          ...(discordChannel.events ?? {}),
        },
      },
    },
    blockedUserIds: settings.blockedUserIds ?? [],
    favoritePlayerIds: settings.favoritePlayerIds ?? fallbackSettings.favoritePlayerIds ?? [],
    favoriteTeamIds: settings.favoriteTeamIds ?? fallbackSettings.favoriteTeamIds ?? [],
    representativeTeamId: settings.representativeTeamId ?? fallbackSettings.representativeTeamId ?? "",
    favoriteCourtIds: settings.favoriteCourtIds ?? fallbackSettings.favoriteCourtIds ?? [],
    favoriteRefereeIds: settings.favoriteRefereeIds ?? fallbackSettings.favoriteRefereeIds ?? [],
    courtMetrics: settings.courtMetrics ?? fallbackSettings.courtMetrics ?? [],
    approvedCourts: settings.approvedCourts ?? fallbackSettings.approvedCourts ?? [],
    courtRequests: settings.courtRequests ?? fallbackSettings.courtRequests ?? [],
    courtReviews: settings.courtReviews ?? fallbackSettings.courtReviews ?? [],
    refereeRequests: settings.refereeRequests ?? fallbackSettings.refereeRequests ?? [],
    adminAppointments: settings.adminAppointments ?? fallbackSettings.adminAppointments ?? [],
    refereeAppointments: settings.refereeAppointments ?? fallbackSettings.refereeAppointments ?? [],
    adminAuditLog: settings.adminAuditLog ?? fallbackSettings.adminAuditLog ?? [],
    adminDisciplinaryActions: settings.adminDisciplinaryActions ?? fallbackSettings.adminDisciplinaryActions ?? [],
    refereeExamAttempts: settings.refereeExamAttempts ?? fallbackSettings.refereeExamAttempts ?? [],
  };
}

export function isDiscordNotificationEnabled(settings = {}, event = "match") {
  const discord = normalizeSettings(settings).notificationChannels.discord;
  return discord.enabled === true && discord.events?.[event] !== false;
}
