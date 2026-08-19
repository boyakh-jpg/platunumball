import { allowRequestMethod, sendJson } from "../_supabaseAdmin.js";

export default async function handler(request, response) {
  if (!allowRequestMethod(request, response, ["POST", "DELETE"])) return;
  response.setHeader("Cache-Control", "private, no-store");
  return sendJson(response, 410, { error: "receipt_emblem_upload_disabled" });
}
