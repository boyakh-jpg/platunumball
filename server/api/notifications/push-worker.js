import webpush from "web-push";
import { allowRequestMethod, bearerTokenMatches, getSupabaseAdminClient, readJsonBody, sendJson } from "../_supabaseAdmin.js";

const MAX_ATTEMPTS = 5;

function assertWorkerAccess(request) {
  if (!bearerTokenMatches(request, process.env.CRON_SECRET || "")) {
    const error = new Error("invalid_cron_secret");
    error.statusCode = 401;
    throw error;
  }
}

function configureWebPush() {
  const publicKey = String(process.env.VITE_WEB_PUSH_VAPID_PUBLIC_KEY ?? "").trim();
  const privateKey = String(process.env.WEB_PUSH_VAPID_PRIVATE_KEY ?? "").trim();
  const subject = String(process.env.WEB_PUSH_VAPID_SUBJECT ?? "").trim();
  if (!publicKey || !privateKey || !subject) throw new Error("web_push_vapid_not_configured");
  webpush.setVapidDetails(subject, publicKey, privateKey);
}

function getStatusCode(error = {}) {
  return Number(error.statusCode ?? error.status ?? 0);
}

function assertMutation(result) {
  if (result?.error) throw result.error;
}

export function getRetryDelaySeconds(attemptCount, retryAfter) {
  const headerSeconds = Number(retryAfter);
  if (Number.isFinite(headerSeconds) && headerSeconds > 0) return Math.min(3600, Math.ceil(headerSeconds));
  const headerDate = Date.parse(String(retryAfter ?? ""));
  if (Number.isFinite(headerDate) && headerDate > Date.now()) return Math.min(3600, Math.ceil((headerDate - Date.now()) / 1000));
  return Math.min(3600, 30 * (2 ** Math.max(0, attemptCount - 1)));
}

export default async function handler(request, response) {
  if (!allowRequestMethod(request, response, ["GET", "POST"])) return;
  try {
    assertWorkerAccess(request);
    configureWebPush();
    const body = request.method === "POST" ? await readJsonBody(request) : {};
    const limit = Math.max(1, Math.min(100, Math.floor(Number(body.limit) || 20)));
    const supabase = getSupabaseAdminClient();
    const { data: deliveries, error: claimError } = await supabase.rpc("claim_external_notification_deliveries", { batch_size: limit });
    if (claimError) throw claimError;

    let sent = 0;
    let failed = 0;
    let cancelled = 0;
    let retried = 0;
    for (const delivery of deliveries ?? []) {
      const { data: subscription, error: subscriptionError } = await supabase.from("web_push_subscriptions")
        .select("id,endpoint,p256dh,auth_secret,enabled,failure_count")
        .eq("id", delivery.subscription_id).maybeSingle();
      if (subscriptionError) throw subscriptionError;
      if (!subscription?.enabled) {
        assertMutation(await supabase.from("external_notification_deliveries").update({ status: "cancelled", failed_at: new Date().toISOString(), last_error: "push_subscription_inactive", updated_at: new Date().toISOString() }).eq("id", delivery.id).eq("status", "sending"));
        cancelled += 1;
        continue;
      }
      try {
        await webpush.sendNotification({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth_secret },
        }, JSON.stringify(delivery.payload), { TTL: 300, urgency: "normal" });
        const now = new Date().toISOString();
        const mutationResults = await Promise.all([
          supabase.from("external_notification_deliveries").update({ status: "sent", sent_at: now, last_error: null, updated_at: now }).eq("id", delivery.id).eq("status", "sending"),
          supabase.from("web_push_subscriptions").update({ failure_count: 0, last_failure: null, last_seen_at: now, updated_at: now }).eq("id", subscription.id),
        ]);
        mutationResults.forEach(assertMutation);
        sent += 1;
      } catch (error) {
        const statusCode = getStatusCode(error);
        const now = new Date().toISOString();
        const terminalSubscription = statusCode === 404 || statusCode === 410;
        const terminalAuth = statusCode === 401 || statusCode === 403;
        const retryable = statusCode === 429 || statusCode >= 500 || statusCode === 0;
        const canRetry = retryable && Number(delivery.attempt_count) < MAX_ATTEMPTS;
        const lastError = `web_push_${statusCode || "network"}`;
        if (terminalSubscription) {
          assertMutation(await supabase.from("web_push_subscriptions").update({ enabled: false, failure_count: Number(subscription.failure_count || 0) + 1, last_failure: lastError, updated_at: now }).eq("id", subscription.id));
        } else {
          assertMutation(await supabase.from("web_push_subscriptions").update({ failure_count: Number(subscription.failure_count || 0) + 1, last_failure: lastError, updated_at: now }).eq("id", subscription.id));
        }
        assertMutation(await supabase.from("external_notification_deliveries").update({
          status: canRetry ? "queued" : terminalSubscription ? "cancelled" : "failed",
          next_attempt_at: canRetry ? new Date(Date.now() + getRetryDelaySeconds(delivery.attempt_count, error.headers?.["retry-after"]) * 1000).toISOString() : now,
          failed_at: canRetry ? null : now,
          last_error: terminalAuth ? "web_push_vapid_rejected" : lastError,
          updated_at: now,
        }).eq("id", delivery.id).eq("status", "sending"));
        if (canRetry) retried += 1; else if (terminalSubscription) cancelled += 1; else failed += 1;
      }
    }
    sendJson(response, 200, { ok: true, processed: deliveries?.length ?? 0, sent, retried, failed, cancelled });
  } catch (error) {
    console.error("Web push worker failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "web_push_worker_failed" });
  }
}
