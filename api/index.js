import adminAppointmentAction from "../server/api/admin/appointment-action.js";
import adminContext from "../server/api/admin/context.js";
import adminCourts from "../server/api/admin/courts.js";
import adminDisciplinaryAction from "../server/api/admin/disciplinary-action.js";
import adminRatingPolicy from "../server/api/admin/rating-policy.js";
import adminReviewAction from "../server/api/admin/review-action.js";
import adminUserOperations from "../server/api/admin/user-operations.js";
import alphaTestLogin from "../server/api/auth/alpha-test-login.js";
import discordCallback from "../server/api/auth/discord/callback.js";
import discordComplete from "../server/api/auth/discord/complete.js";
import discordStart from "../server/api/auth/discord/start.js";
import courtRequestApprove from "../server/api/court-requests/approve.js";
import courtRequestReport from "../server/api/court-requests/report.js";
import courtRequestSubmit from "../server/api/court-requests/submit.js";
import courtAddressSearch from "../server/api/courts/address-search.js";
import courtPlaceSearch from "../server/api/courts/place-search.js";
import courtSubmitReview from "../server/api/courts/submit-review.js";
import courtDetail from "../server/api/courts/detail.js";
import directoryLoad from "../server/api/directory/load.js";
import discordDmWorker from "../server/api/discord/dm-worker.js";
import discordInteractions from "../server/api/discord/interactions.js";
import discordRoomChat from "../server/api/discord/room-chat.js";
import discordSyncDeliveries from "../server/api/discord/sync-deliveries.js";
import favoriteSync from "../server/api/favorites/sync.js";
import homeLoad from "../server/api/home/load.js";
import matchAttendanceQr from "../server/api/matches/attendance-qr.js";
import matchDetail from "../server/api/matches/detail.js";
import matchClock from "../server/api/matches/clock.js";
import matchList from "../server/api/matches/list.js";
import matchSyncMatch from "../server/api/matches/sync-match.js";
import notificationDelete from "../server/api/notifications/delete.js";
import notificationList from "../server/api/notifications/list.js";
import notificationRead from "../server/api/notifications/read.js";
import profileEmblem from "../server/api/profile/emblem.js";
import profileAchievements from "../server/api/profile/achievements.js";
import profileAffiliation from "../server/api/profile/affiliation.js";
import profileMe from "../server/api/profile/me.js";
import profileUpsert from "../server/api/profile/upsert.js";
import recordList from "../server/api/records/list.js";
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
import { assertSafeInputPayload, UNSAFE_INPUT_ERROR_CODE } from "../src/lib/inputSecurity.js";
import { enforceApiRouteSecurity, findSensitiveQueryKey, setApiSecurityHeaders } from "../server/api/_requestSecurity.js";

function route(handler, methods, auth) {
  return Object.freeze({ handler, methods: Object.freeze(methods), auth });
}

export const API_ROUTES = new Map([
  ["/admin/appointment-action", route(adminAppointmentAction, ["POST"], "admin")],
  ["/admin/context", route(adminContext, ["POST"], "admin")],
  ["/admin/courts", route(adminCourts, ["POST"], "admin")],
  ["/admin/disciplinary-action", route(adminDisciplinaryAction, ["POST"], "admin")],
  ["/admin/rating-policy", route(adminRatingPolicy, ["POST"], "admin")],
  ["/admin/review-action", route(adminReviewAction, ["POST"], "admin")],
  ["/admin/user-operations", route(adminUserOperations, ["POST"], "admin")],
  ["/auth/alpha-test-login", route(alphaTestLogin, ["POST"], "alphaTest")],
  ["/auth/discord/callback", route(discordCallback, ["GET"], "oauthCallback")],
  ["/auth/discord/complete", route(discordComplete, ["POST"], "user")],
  ["/auth/discord/start", route(discordStart, ["POST"], "user")],
  ["/court-requests/approve", route(courtRequestApprove, ["POST"], "admin")],
  ["/court-requests/report", route(courtRequestReport, ["POST"], "user")],
  ["/court-requests/submit", route(courtRequestSubmit, ["POST"], "user")],
  ["/courts/address-search", route(courtAddressSearch, ["POST"], "user")],
  ["/courts/place-search", route(courtPlaceSearch, ["POST"], "user")],
  ["/courts/submit-review", route(courtSubmitReview, ["POST"], "user")],
  ["/courts/detail", route(courtDetail, ["POST"], "user")],
  ["/directory/load", route(directoryLoad, ["POST"], "user")],
  ["/discord/dm-worker", route(discordDmWorker, ["GET", "POST"], "internal")],
  ["/discord/interactions", route(discordInteractions, ["POST"], "signedWebhook")],
  ["/discord/room-chat", route(discordRoomChat, ["POST"], "internal")],
  ["/discord/sync-deliveries", route(discordSyncDeliveries, ["POST"], "user")],
  ["/favorites/sync", route(favoriteSync, ["POST"], "user")],
  ["/home/load", route(homeLoad, ["POST"], "user")],
  ["/matches/attendance-qr", route(matchAttendanceQr, ["POST"], "user")],
  ["/matches/detail", route(matchDetail, ["POST"], "user")],
  ["/matches/clock", route(matchClock, ["POST"], "user")],
  ["/matches/list", route(matchList, ["POST"], "user")],
  ["/matches/sync-match", route(matchSyncMatch, ["POST"], "user")],
  ["/notifications/delete", route(notificationDelete, ["POST"], "user")],
  ["/notifications/list", route(notificationList, ["POST"], "user")],
  ["/notifications/read", route(notificationRead, ["POST"], "user")],
  ["/profile/emblem", route(profileEmblem, ["POST"], "user")],
  ["/profile/achievements", route(profileAchievements, ["POST"], "user")],
  ["/profile/affiliation", route(profileAffiliation, ["POST"], "user")],
  ["/profile/me", route(profileMe, ["POST"], "user")],
  ["/profile/upsert", route(profileUpsert, ["POST"], "user")],
  ["/records/list", route(recordList, ["POST"], "user")],
  ["/referee/sync", route(refereeSync, ["POST"], "user")],
  ["/recruiting/list", route(recruitingList, ["POST"], "user")],
  ["/recruiting/sync-post", route(recruitingSyncPost, ["POST"], "user")],
  ["/reports/submit", route(reportSubmit, ["POST"], "user")],
  ["/settings/sync", route(settingsSync, ["POST"], "user")],
  ["/search", route(search, ["POST"], "user")],
  ["/state/load", route(stateLoad, ["POST"], "user")],
  ["/system/cleanup-sim", route(systemCleanupSim, ["POST"], "internal")],
  ["/system/feed-audit", route(systemFeedAudit, ["GET", "POST"], "internal")],
  ["/system/maintenance", route(systemMaintenance, ["GET", "POST"], "internal")],
  ["/system/schema-health", route(systemSchemaHealth, ["GET", "POST"], "internal")],
  ["/teams/detail", route(teamList, ["POST"], "user")],
  ["/teams/emblem", route(teamEmblem, ["POST"], "user")],
  ["/teams/list", route(teamList, ["POST"], "user")],
  ["/teams/sync-team", route(teamSyncTeam, ["POST"], "user")],
  ["/tournaments/sync-tournament", route(tournamentSyncTournament, ["POST"], "user")],
]);

function getRequestUrl(request) {
  const rawUrl = String(request.url || "/");
  return new URL(rawUrl.startsWith("/") ? rawUrl : `/${rawUrl}`, "https://rankball.invalid");
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
  const route = API_ROUTES.get(routePath);

  setApiSecurityHeaders(response);

  try {
    assertSafeInputPayload(request.query ?? {}, {
      path: "$query",
      maxDepth: 6,
      maxNodes: 200,
      maxStringLength: 8_000,
    });
  } catch (error) {
    response.setHeader?.("Cache-Control", "no-store");
    response.setHeader?.("X-Content-Type-Options", "nosniff");
    response.status(error.statusCode || 400).json({ error: error.code || UNSAFE_INPUT_ERROR_CODE });
    return;
  }

  if (findSensitiveQueryKey(request.query ?? {})) {
    response.status(400).json({ error: "credentials_not_allowed_in_url" });
    return;
  }

  if (!route) {
    response.status(404).json({ error: "api_route_not_found" });
    return;
  }

  if (!enforceApiRouteSecurity(request, response, route)) return;

  request.rankballRoutePath = routePath;
  return route.handler(request, response);
}
