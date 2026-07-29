import { DEFAULT_SETTINGS } from "./repositoryDefaults.js";

const FAVORITE_SETTING_TARGETS = Object.freeze([
  ["favoritePlayerIds", "player"],
  ["favoriteTeamIds", "team"],
  ["favoriteCourtIds", "court"],
  ["favoriteRefereeIds", "referee"],
]);

export function projectProfileSettings(remoteSettings = {}, favoriteRows = [], options = {}) {
  const sourceSettings = remoteSettings && typeof remoteSettings === "object" && !Array.isArray(remoteSettings)
    ? remoteSettings
    : {};
  const rows = Array.isArray(favoriteRows) ? favoriteRows : [];
  const favoriteRowsAuthoritative = options.favoriteRowsAuthoritative !== false;
  const favoriteSettings = Object.fromEntries(FAVORITE_SETTING_TARGETS.map(([settingKey, targetType]) => [
    settingKey,
    favoriteRowsAuthoritative
      ? rows.filter((favorite) => favorite?.target_type === targetType).map((favorite) => favorite.target_id)
      : sourceSettings[settingKey] ?? [],
  ]));
  const overrides = options.overrides && typeof options.overrides === "object" && !Array.isArray(options.overrides)
    ? options.overrides
    : {};

  return {
    ...DEFAULT_SETTINGS,
    ...sourceSettings,
    ...favoriteSettings,
    ...overrides,
  };
}

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

export function isHomeGuideCardVisible(settings = {}) {
  return settings.showHomeGuideCard !== false;
}

export function isDiscordNotificationEnabled(settings = {}, event = "match") {
  const discord = normalizeSettings(settings).notificationChannels.discord;
  return discord.enabled === true && discord.events?.[event] !== false;
}
