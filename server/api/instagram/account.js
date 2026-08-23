import { createHmac } from "node:crypto";
import { allowRequestMethod, getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";

const LINK_CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

function getHashSecret(env = process.env) {
  const secret = String(env.INSTAGRAM_BOT_HASH_SECRET ?? "").trim();
  if (!secret) throw Object.assign(new Error("instagram_hash_secret_not_configured"), { statusCode: 503 });
  return secret;
}

function hashLinkCode(code, secret) {
  return createHmac("sha256", secret).update(code).digest("hex");
}

async function loadHistory(supabase, profileId) {
  const { data, error } = await supabase.from("instagram_receipt_bot_history")
    .select("id, receipt_summary, created_at")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw error;
  return data ?? [];
}

export async function handleInstagramAccount(request, response, options = {}) {
  if (!allowRequestMethod(request, response, ["POST"])) return;
  try {
    const body = await readJsonBody(request, { maxBytes: 2_000, maxStringLength: 100 });
    const context = options.context ?? await getAuthenticatedContext(request);
    const action = String(body.action ?? "").trim();
    if (action === "link") {
      const code = String(body.code ?? "").trim();
      if (!LINK_CODE_PATTERN.test(code)) {
        sendJson(response, 400, { error: "invalid_instagram_link_code" });
        return;
      }
      const secret = getHashSecret(options.env);
      const { data: linked, error } = await context.supabase.rpc("consume_instagram_receipt_bot_link", {
        p_code_hash: hashLinkCode(code, secret),
        p_profile_id: context.profileId,
      });
      if (error) throw error;
      if (!linked) {
        sendJson(response, 410, { error: "instagram_link_expired" });
        return;
      }
    } else if (action !== "history") {
      sendJson(response, 400, { error: "invalid_instagram_account_action" });
      return;
    }

    const history = await loadHistory(context.supabase, context.profileId);
    sendJson(response, 200, { ok: true, linked: action === "link", history });
  } catch (error) {
    console.error("Instagram account action failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "instagram_account_action_failed" });
  }
}

export default function handler(request, response) {
  return handleInstagramAccount(request, response);
}
