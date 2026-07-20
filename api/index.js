import adminAppointmentAction from "../server/api/admin/appointment-action.js";
import adminContext from "../server/api/admin/context.js";
import adminDisciplinaryAction from "../server/api/admin/disciplinary-action.js";
import adminRatingPolicy from "../server/api/admin/rating-policy.js";
import adminReviewAction from "../server/api/admin/review-action.js";
import discordCallback from "../server/api/auth/discord/callback.js";
import discordStart from "../server/api/auth/discord/start.js";
import courtRequestApprove from "../server/api/court-requests/approve.js";
import courtRequestReport from "../server/api/court-requests/report.js";
import courtRequestSubmit from "../server/api/court-requests/submit.js";
import courtAddressSearch from "../server/api/courts/address-search.js";
import courtSubmitReview from "../server/api/courts/submit-review.js";
import courtDetail from "../server/api/courts/detail.js";
import directoryLoad from "../server/api/directory/load.js";
import discordDmWorker from "../server/api/discord/dm-worker.js";
import discordInteractions from "../server/api/discord/interactions.js";
import discordRoomChat from "../server/api/discord/room-chat.js";
import discordSyncDeliveries from "../server/api/discord/sync-deliveries.js";
import favoriteSync from "../server/api/favorites/sync.js";
import homeLoad from "../server/api/home/load.js";
import matchDetail from "../server/api/matches/detail.js";
import matchList from "../server/api/matches/list.js";
import matchSyncMatch from "../server/api/matches/sync-match.js";
import notificationDelete from "../server/api/notifications/delete.js";
import notificationList from "../server/api/notifications/list.js";
import notificationRead from "../server/api/notifications/read.js";
import profileEmblem from "../server/api/profile/emblem.js";
import profileAchievements from "../server/api/profile/achievements.js";
import profileMe from "../server/api/profile/me.js";
import profileUpsert from "../server/api/profile/upsert.js";
import refereeSync from "../server/api/referee/sync.js";
import recruitingList from "../server/api/recruiting/list.js";
import recruitingSyncPost from "../server/api/recruiting/sync-post.js";
import reportSubmit from "../server/api/reports/submit.js";
import settingsSync from "../server/api/settings/sync.js";
import search from "../server/api/search.js";
import stateLoad from "../server/api/state/load.js";
import systemCleanupSim from "../server/api/system/cleanup-sim.js";
import systemFeedAudit from "../server/api/system/feed-audit.js";
import systemMaintenance from "../server/api/system/maintenance.js";
import systemSchemaHealth from "../server/api/system/schema-health.js";
import teamList from "../server/api/teams/list.js";
import teamEmblem from "../server/api/teams/emblem.js";
import teamSyncTeam from "../server/api/teams/sync-team.js";
import tournamentSyncTournament from "../server/api/tournaments/sync-tournament.js";

const ROUTES = new Map([
  ["/admin/appointment-action", adminAppointmentAction],
  ["/admin/context", adminContext],
  ["/admin/disciplinary-action", adminDisciplinaryAction],
  ["/admin/rating-policy", adminRatingPolicy],
  ["/admin/review-action", adminReviewAction],
  ["/auth/discord/callback", discordCallback],
  ["/auth/discord/start", discordStart],
  ["/court-requests/approve", courtRequestApprove],
  ["/court-requests/report", courtRequestReport],
  ["/court-requests/submit", courtRequestSubmit],
  ["/courts/address-search", courtAddressSearch],
  ["/courts/submit-review", courtSubmitReview],
  ["/courts/detail", courtDetail],
  ["/directory/load", directoryLoad],
  ["/discord/dm-worker", discordDmWorker],
  ["/discord/interactions", discordInteractions],
  ["/discord/room-chat", discordRoomChat],
  ["/discord/sync-deliveries", discordSyncDeliveries],
  ["/favorites/sync", favoriteSync],
  ["/home/load", homeLoad],
  ["/matches/detail", matchDetail],
  ["/matches/list", matchList],
  ["/matches/sync-match", matchSyncMatch],
  ["/notifications/delete", notificationDelete],
  ["/notifications/list", notificationList],
  ["/notifications/read", notificationRead],
  ["/profile/emblem", profileEmblem],
  ["/profile/achievements", profileAchievements],
  ["/profile/me", profileMe],
  ["/profile/upsert", profileUpsert],
  ["/referee/sync", refereeSync],
  ["/recruiting/list", recruitingList],
  ["/recruiting/sync-post", recruitingSyncPost],
  ["/reports/submit", reportSubmit],
  ["/settings/sync", settingsSync],
  ["/search", search],
  ["/state/load", stateLoad],
  ["/system/cleanup-sim", systemCleanupSim],
  ["/system/feed-audit", systemFeedAudit],
  ["/system/maintenance", systemMaintenance],
  ["/system/schema-health", systemSchemaHealth],
  ["/teams/detail", teamList],
  ["/teams/emblem", teamEmblem],
  ["/teams/list", teamList],
  ["/teams/sync-team", teamSyncTeam],
  ["/tournaments/sync-tournament", tournamentSyncTournament],
]);

function getRequestUrl(request) {
  const protocol = request.headers["x-forwarded-proto"] || "https";
  const host = request.headers["x-forwarded-host"] || request.headers.host || "localhost";
  return new URL(request.url || "/", `${protocol}://${host}`);
}

function getQueryObject(request, url) {
  const query = { ...Object.fromEntries(url.searchParams), ...(request.query ?? {}) };
  request.query = query;
  return query;
}

function normalizeApiPath(value = "") {
  const path = String(value || "").replace(/^\/?api\/?/, "").replace(/^\/+|\/+$/g, "");
  return path ? `/${path}` : "/";
}

function getRoutePath(request) {
  const url = getRequestUrl(request);
  const query = getQueryObject(request, url);
  const rewritePath = Array.isArray(query.path) ? query.path[0] : query.path;
  if (rewritePath) return normalizeApiPath(rewritePath);

  const pathname = normalizeApiPath(url.pathname);
  if (pathname === "/" || pathname === "/index" || pathname === "/index.js") return "/";
  return pathname;
}

export default async function handler(request, response) {
  const routePath = getRoutePath(request);
  const routeHandler = ROUTES.get(routePath);

  if (!routeHandler) {
    response.status(404).json({ error: "api_route_not_found", path: routePath });
    return;
  }

  request.rankballRoutePath = routePath;
  return routeHandler(request, response);
}
