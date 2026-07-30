import {
  allowRequestMethod,
  bearerTokenMatches,
  readJsonBody,
  sendJson,
} from "../_supabaseAdmin.js";

export { sendJson };

export function allowSystemReadRequest(request, response) {
  return allowRequestMethod(request, response, ["GET", "POST"]);
}

export function assertSystemSecretAccess(request, errorCode) {
  const secret = process.env.CRON_SECRET || "";
  if (bearerTokenMatches(request, secret)) return;
  const error = new Error(errorCode);
  error.statusCode = 401;
  throw error;
}

export async function readSystemRequestBody(request) {
  return request.method === "POST" ? readJsonBody(request) : {};
}
