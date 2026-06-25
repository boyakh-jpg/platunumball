import adminAppointmentAction from "../server/api/admin/appointment-action.js";
import adminDisciplinaryAction from "../server/api/admin/disciplinary-action.js";
import adminReviewAction from "../server/api/admin/review-action.js";
import discordCallback from "../server/api/auth/discord/callback.js";
import discordStart from "../server/api/auth/discord/start.js";
import courtRequestApprove from "../server/api/court-requests/approve.js";
import courtRequestReport from "../server/api/court-requests/report.js";
import courtRequestSubmit from "../server/api/court-requests/submit.js";
import courtAddressSearch from "../server/api/courts/address-search.js";
import courtSubmitReview from "../server/api/courts/submit-review.js";
import discordDmWorker from "../server/api/discord/dm-worker.js";
import favoriteSync from "../server/api/favorites/sync.js";
import matchSyncMatch from "../server/api/matches/sync-match.js";
import profileUpsert from "../server/api/profile/upsert.js";
import refereeSync from "../server/api/referee/sync.js";
import recruitingSyncPost from "../server/api/recruiting/sync-post.js";
import reportSubmit from "../server/api/reports/submit.js";
import supabaseBridge from "../server/api/supabase/bridge.js";
import teamSyncTeam from "../server/api/teams/sync-team.js";
import tournamentSyncTournament from "../server/api/tournaments/sync-tournament.js";

const ROUTES = new Map([
  ["/admin/appointment-action", adminAppointmentAction],
  ["/admin/disciplinary-action", adminDisciplinaryAction],
  ["/admin/review-action", adminReviewAction],
  ["/auth/discord/callback", discordCallback],
  ["/auth/discord/start", discordStart],
  ["/court-requests/approve", courtRequestApprove],
  ["/court-requests/report", courtRequestReport],
  ["/court-requests/submit", courtRequestSubmit],
  ["/courts/address-search", courtAddressSearch],
  ["/courts/submit-review", courtSubmitReview],
  ["/discord/dm-worker", discordDmWorker],
  ["/favorites/sync", favoriteSync],
  ["/matches/sync-match", matchSyncMatch],
  ["/profile/upsert", profileUpsert],
  ["/referee/sync", refereeSync],
  ["/recruiting/sync-post", recruitingSyncPost],
  ["/reports/submit", reportSubmit],
  ["/supabase/bridge", supabaseBridge],
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

  return routeHandler(request, response);
}
