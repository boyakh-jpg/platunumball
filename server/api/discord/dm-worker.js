import { attachNotificationActors, bearerTokenMatches, getSupabaseAdminClient, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import { isDiscordNotificationEnabled } from "../../../src/data/settingsMappers.js";
import { getBlockedUserIds, getNotificationActorId } from "../../../src/lib/notifications.js";
import { fromRemoteNotification } from "../../../src/data/remotePayloadMappers.js";
import { NOTIFICATION_COLUMNS } from "../../../src/data/repositoryColumns.js";
import { getPublicAppWebUrl } from "../_publicAppUrl.js";
import {
  DISCORD_API_BASE_URL,
  DISCORD_NOTIFICATION_BODY_MAX_LENGTH,
  DISCORD_NOTIFICATION_URL_MAX_LENGTH,
  isDiscordSnowflake,
} from "../../../src/lib/discordProtocol.js";
import { MINUTE_MS } from "../../../src/lib/constants.js";
import { BRAND_NAME } from "../../../src/lib/brand.js";

const MAX_BATCH_SIZE = 25;

function getWorkerSecret() {
  return process.env.CRON_SECRET || "";
}

async function assertWorkerAccess(request) {
  const workerSecret = getWorkerSecret();
  if (!bearerTokenMatches(request, workerSecret)) {
    const error = new Error("invalid_cron_secret");
    error.statusCode = 401;
    throw error;
  }
}

function getBatchLimit(value) {
  const limit = Number(value);
  if (!Number.isFinite(limit) || limit <= 0) return 10;
  return Math.min(MAX_BATCH_SIZE, Math.floor(limit));
}

function httpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function discordFetch(path, options = {}) {
  const token = String(process.env.DISCORD_BOT_TOKEN || "").trim();
  if (!token) {
    throw new Error("discord_bot_token_not_configured");
  }
  const authorization = /^Bot\s+/i.test(token) ? token : `Bot ${token}`;

  const response = await fetch(`${DISCORD_API_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    const message = body?.message || text || `discord_api_failed:${response.status}`;
    const error = new Error(`discord_api_failed:${response.status}:${path}:${message}`.slice(0, 300));
    error.statusCode = 502;
    throw error;
  }
  return body;
}

async function getDiscordBotStatus() {
  const token = String(process.env.DISCORD_BOT_TOKEN || "").trim();
  const configuredGuildIds = getConfiguredGuildIds();
  if (!token) {
    return {
      ok: false,
      tokenConfigured: false,
      configuredGuildCount: configuredGuildIds.length,
    };
  }

  const bot = await discordFetch("/users/@me", { method: "GET" });
  const guilds = await discordFetch("/users/@me/guilds", { method: "GET" });

  return {
    ok: true,
    tokenConfigured: true,
    tokenHasBotPrefix: /^Bot\s+/i.test(token),
    bot: {
      id: bot?.id ?? null,
      username: bot?.username ?? null,
      globalName: bot?.global_name ?? null,
    },
    guildCount: (guilds ?? []).length,
    configuredGuildCount: configuredGuildIds.length,
    configuredGuildIds,
  };
}

function trimDiscordText(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizeDiscordUsername(value = "") {
  return String(value || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

function getConfiguredGuildIds() {
  return String(
    process.env.DISCORD_GUILD_IDS ||
      process.env.DISCORD_GUILD_ID ||
      process.env.DISCORD_SERVER_IDS ||
      process.env.DISCORD_SERVER_ID ||
      "",
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

async function getBotGuildIds() {
  const configuredGuildIds = getConfiguredGuildIds();
  if (configuredGuildIds.length) return configuredGuildIds;

  const guilds = await discordFetch("/users/@me/guilds", { method: "GET" });
  return (guilds ?? []).map((guild) => String(guild.id || "").trim()).filter(Boolean);
}

function isExactDiscordUsernameMatch(user = {}, targetUsername = "") {
  const username = normalizeDiscordUsername(user.username);
  if (username && username === targetUsername) return true;
  const discriminator = String(user.discriminator || "").trim();
  const legacyUsername = discriminator && discriminator !== "0" ? `${username}#${discriminator}` : "";
  return Boolean(legacyUsername && legacyUsername === targetUsername);
}

async function resolveDiscordUserIdByUsername(username) {
  const targetUsername = normalizeDiscordUsername(username);
  if (!targetUsername) throw httpError("missing_discord_username");
  if (isDiscordSnowflake(targetUsername)) return targetUsername;

  const guildIds = await getBotGuildIds();
  if (!guildIds.length) throw httpError("discord_bot_has_no_guilds", 404);

  const matchedUsers = new Map();
  for (const guildId of guildIds) {
    const members = await discordFetch(
      `/guilds/${encodeURIComponent(guildId)}/members/search?query=${encodeURIComponent(targetUsername)}&limit=10`,
      { method: "GET" },
    );
    for (const member of members ?? []) {
      const user = member?.user ?? {};
      if (user.id && isExactDiscordUsernameMatch(user, targetUsername)) {
        matchedUsers.set(String(user.id), user);
      }
    }
  }

  if (matchedUsers.size === 1) return [...matchedUsers.keys()][0];
  if (matchedUsers.size > 1) throw httpError("discord_username_ambiguous", 409);
  throw httpError("discord_username_not_found_in_bot_guild", 404);
}

function getDiscordComponents(actions = []) {
  const buttons = actions
    .filter((action) => action?.customId)
    .slice(0, 5)
    .map((action) => ({
      type: 2,
      style: action.style === "primary" ? 1 : 2,
      label: trimDiscordText(action.label || action.id || "Open", 80),
      custom_id: trimDiscordText(action.customId, 100),
    }));

  return buttons.length ? [{ type: 1, components: buttons }] : [];
}

function getDiscordWebUrl(payload = {}) {
  const rawUrl = String(payload.webUrl || payload.webPath || "").trim();
  if (!rawUrl || /^https?:\/\//i.test(rawUrl)) return rawUrl;
  return getPublicAppWebUrl(rawUrl.startsWith("/") ? rawUrl : `/${rawUrl}`);
}

function getDiscordMessage(delivery = {}) {
  const payload = delivery.payload ?? {};
  const title = trimDiscordText(payload.title || BRAND_NAME, 120);
  const body = trimDiscordText(payload.body || "", DISCORD_NOTIFICATION_BODY_MAX_LENGTH);
  const webUrl = trimDiscordText(getDiscordWebUrl(payload), DISCORD_NOTIFICATION_URL_MAX_LENGTH);
  const content = [`**${title}**`, body, webUrl].filter(Boolean).join("\n").slice(0, 1900);
  return {
    content,
    allowed_mentions: { parse: [] },
    components: getDiscordComponents(payload.actions),
  };
}

async function sendDiscordDm(delivery) {
  const discordUserId = String(delivery.discord_user_id ?? "").trim();
  if (!discordUserId) {
    throw new Error("missing_discord_user_id");
  }

  const channel = await discordFetch("/users/@me/channels", {
    method: "POST",
    body: JSON.stringify({ recipient_id: discordUserId }),
  });
  if (!channel?.id) {
    throw new Error("discord_dm_channel_not_created");
  }

  const message = await discordFetch(`/channels/${encodeURIComponent(channel.id)}/messages`, {
    method: "POST",
    body: JSON.stringify(getDiscordMessage(delivery)),
  });

  return {
    channelId: channel.id,
    messageId: message?.id ?? null,
  };
}

async function sendTestDiscordDm(body = {}) {
  const discordUserId = String(body.discordUserId || body.discord_user_id || "").trim();
  const username = body.discordUsername || body.username || body.testUsername;
  const resolvedUserId = discordUserId || (await resolveDiscordUserIdByUsername(username));
  const now = new Date().toISOString();
  const result = await sendDiscordDm({
    discord_user_id: resolvedUserId,
    event: "test",
    payload: {
      title: trimDiscordText(body.title || `${BRAND_NAME} 테스트 DM`, 120),
      body: trimDiscordText(body.message || body.body || `${BRAND_NAME} Discord 알림 테스트입니다.`, DISCORD_NOTIFICATION_BODY_MAX_LENGTH),
      webUrl: trimDiscordText(body.webUrl || process.env.VITE_PUBLIC_APP_URL || "", DISCORD_NOTIFICATION_URL_MAX_LENGTH),
      sentAt: now,
    },
  });

  return {
    ok: true,
    test: true,
    discordUserId: resolvedUserId,
    channelId: result.channelId,
    messageId: result.messageId,
  };
}

function mergePayload(delivery, patch) {
  return {
    ...(delivery.payload ?? {}),
    ...patch,
  };
}

export function isDiscordDeliveryExpired(delivery = {}, nowMs = Date.now()) {
  const expiresAtMs = new Date(delivery.payload?.expiresAt ?? "").getTime();
  if (Number.isFinite(expiresAtMs)) return expiresAtMs <= nowMs;

  const legacyStartNotice = String(delivery.id ?? "").startsWith("discord-match-manager-start-now-");
  if (!legacyStartNotice) return false;
  const sendAtMs = new Date(delivery.send_at ?? delivery.payload?.sendAt ?? "").getTime();
  return Number.isFinite(sendAtMs) && sendAtMs <= nowMs;
}

export default async function handler(request, response) {
  if (!["GET", "POST"].includes(request.method)) {
    response.setHeader("Allow", "GET, POST");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    await assertWorkerAccess(request);
    const body = request.method === "POST" ? await readJsonBody(request) : {};
    if (request.method === "POST" && body.botCheck) {
      sendJson(response, 200, await getDiscordBotStatus());
      return;
    }

    if (request.method === "POST" && (body.testDm || body.discordUsername || body.username || body.testUsername || body.discordUserId || body.discord_user_id)) {
      sendJson(response, 200, await sendTestDiscordDm(body));
      return;
    }

    const limit = getBatchLimit(body.limit);
    const supabase = getSupabaseAdminClient();
    const now = new Date().toISOString();

    const { data: queuedRows, error: queueError } = await supabase
      .from("discord_notification_deliveries")
      .select("id, notification_id, target_user_id, discord_user_id, event, status, payload, queued_at, send_at, attempt_count")
      .eq("status", "queued")
      .is("sent_at", null)
      .lte("send_at", now)
      .order("send_at", { ascending: true, nullsFirst: true })
      .order("queued_at", { ascending: true, nullsFirst: true })
      .limit(limit);

    if (queueError) throw queueError;
    if (!queuedRows?.length) {
      sendJson(response, 200, { ok: true, processed: 0, sent: 0, failed: 0 });
      return;
    }

    const ids = queuedRows.map((row) => row.id);
    const { data: claimedRows, error: claimError } = await supabase
      .from("discord_notification_deliveries")
      .update({ status: "sending", updated_at: now })
      .in("id", ids)
      .eq("status", "queued")
      .is("sent_at", null)
      .lte("send_at", now)
      .select("id, notification_id, target_user_id, discord_user_id, event, status, payload, queued_at, send_at, attempt_count");

    if (claimError) throw claimError;

    const notificationIds = [...new Set((claimedRows ?? []).map((row) => row.notification_id).filter(Boolean))];
    const { data: notificationRows, error: notificationError } = notificationIds.length
      ? await supabase.from("notifications").select(NOTIFICATION_COLUMNS).in("id", notificationIds)
      : { data: [], error: null };
    if (notificationError) throw notificationError;
    const notificationsWithActors = await attachNotificationActors(supabase, (notificationRows ?? []).map(fromRemoteNotification));
    const actorByNotificationId = new Map(notificationsWithActors.map((notification) => [notification.id, getNotificationActorId(notification)]));
    const claimedRowsWithActors = (claimedRows ?? []).map((delivery) => {
      const fromUserId = getNotificationActorId(delivery) || actorByNotificationId.get(delivery.notification_id) || "";
      return fromUserId ? { ...delivery, payload: { ...(delivery.payload ?? {}), fromUserId } } : delivery;
    });

    const workerNowMs = new Date(now).getTime();
    const expiredRows = claimedRowsWithActors.filter((delivery) => isDiscordDeliveryExpired(delivery, workerNowMs));
    if (expiredRows.length) {
      const expiredAt = new Date().toISOString();
      for (const delivery of expiredRows) {
        const { error: expiredError } = await supabase
          .from("discord_notification_deliveries")
          .update({
            status: "cancelled",
            last_error: "discord_notification_expired",
            payload: mergePayload(delivery, {
              status: "cancelled",
              reason: "discord_notification_expired",
              cancelledAt: expiredAt,
            }),
            updated_at: expiredAt,
          })
          .eq("id", delivery.id)
          .eq("status", "sending")
          .is("sent_at", null);
        if (expiredError) throw expiredError;
      }
    }
    const expiredIds = new Set(expiredRows.map((delivery) => delivery.id));
    const activeClaimedRows = claimedRowsWithActors.filter((delivery) => !expiredIds.has(delivery.id));

    const targetUserIds = [...new Set(activeClaimedRows.map((row) => row.target_user_id).filter(Boolean))];
    const { data: profileRows, error: profileError } = targetUserIds.length
      ? await supabase.from("profiles").select("id,app_settings").in("id", targetUserIds)
      : { data: [], error: null };
    if (profileError) throw profileError;
    const settingsByProfileId = new Map((profileRows ?? []).map((profile) => [profile.id, profile.app_settings]));
    const optedOutRows = activeClaimedRows.filter((delivery) => (
      !isDiscordNotificationEnabled(settingsByProfileId.get(delivery.target_user_id), delivery.event) ||
      new Set(getBlockedUserIds(settingsByProfileId.get(delivery.target_user_id))).has(getNotificationActorId(delivery))
    ));
    if (optedOutRows.length) {
      const optedOutAt = new Date().toISOString();
      const { error: optOutError } = await supabase
        .from("discord_notification_deliveries")
        .update({ status: "cancelled", last_error: "discord_notification_disabled_or_blocked", updated_at: optedOutAt })
        .in("id", optedOutRows.map((delivery) => delivery.id))
        .eq("status", "sending")
        .is("sent_at", null);
      if (optOutError) throw optOutError;
    }
    const optedOutIds = new Set(optedOutRows.map((delivery) => delivery.id));
    const sendableRows = activeClaimedRows.filter((delivery) => !optedOutIds.has(delivery.id));

    const sent = [];
    const failed = [];

    for (const delivery of sendableRows) {
      try {
        const result = await sendDiscordDm(delivery);
        const sentAt = new Date().toISOString();
        await supabase
          .from("discord_notification_deliveries")
          .update({
            status: "sent",
            sent_at: sentAt,
            failed_at: null,
            last_error: null,
            payload: mergePayload(delivery, {
              status: "sent",
              sentAt,
              discordChannelId: result.channelId,
              discordMessageId: result.messageId,
            }),
            updated_at: sentAt,
          })
          .eq("id", delivery.id);
        sent.push(delivery.id);
      } catch (deliveryError) {
        const failedAt = new Date().toISOString();
        const attemptCount = Number(delivery.attempt_count ?? 0) + 1;
        const terminalFailure = attemptCount >= 5;
        const retryDelayMinutes = [1, 5, 15, 60][Math.min(attemptCount - 1, 3)];
        const retryAt = new Date(Date.now() + retryDelayMinutes * MINUTE_MS).toISOString();
        await supabase
          .from("discord_notification_deliveries")
          .update({
            status: terminalFailure ? "failed" : "queued",
            attempt_count: attemptCount,
            send_at: terminalFailure ? delivery.send_at : retryAt,
            failed_at: failedAt,
            last_error: deliveryError.message || "discord_dm_failed",
            payload: mergePayload(delivery, {
              status: terminalFailure ? "failed" : "queued",
              attemptCount,
              retryAt: terminalFailure ? null : retryAt,
              failedAt,
              error: deliveryError.message || "discord_dm_failed",
            }),
            updated_at: failedAt,
          })
          .eq("id", delivery.id);
        failed.push({ id: delivery.id, terminal: terminalFailure, attemptCount, error: deliveryError.message || "discord_dm_failed" });
      }
    }

    sendJson(response, 200, {
      ok: true,
      processed: sent.length + failed.length + optedOutRows.length + expiredRows.length,
      sent: sent.length,
      failed: failed.length,
      cancelled: optedOutRows.length + expiredRows.length,
      expired: expiredRows.length,
      sentIds: sent,
      failedRows: failed,
    });
  } catch (error) {
    console.error("Discord DM worker failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "discord_dm_worker_failed" });
  }
}
