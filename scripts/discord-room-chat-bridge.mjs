import { isDiscordSnowflake } from "../src/lib/discordProtocol.js";
import { getConfiguredPublicAppUrl } from "../server/api/_publicAppUrl.js";

const DISCORD_GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
const GUILD_MESSAGES_INTENT = 1 << 9;
const MESSAGE_CONTENT_INTENT = 1 << 15;
const DEFAULT_INTENTS = GUILD_MESSAGES_INTENT | MESSAGE_CONTENT_INTENT;

const token = readRequiredEnv("DISCORD_BOT_TOKEN");
const bridgeSecret = process.env.DISCORD_CHAT_BRIDGE_SECRET || process.env.CRON_SECRET || "";
const bridgeUrl = getBridgeUrl();
const intents = readIntegerEnv("DISCORD_CHAT_BRIDGE_INTENTS", DEFAULT_INTENTS);
const channelFilter = new Set(readListEnv("DISCORD_CHAT_BRIDGE_CHANNEL_IDS"));
const logSkips = readBooleanEnv("DISCORD_CHAT_BRIDGE_LOG_SKIPS", false);
const dryRun = readBooleanEnv("DISCORD_CHAT_BRIDGE_DRY_RUN", false);
const requestTimeoutMs = readIntegerEnv("DISCORD_CHAT_BRIDGE_REQUEST_TIMEOUT_MS", 10000);
const maxDeliveryAttempts = readIntegerEnv("DISCORD_CHAT_BRIDGE_MAX_DELIVERY_ATTEMPTS", 4);
const identifyProperties = {
  os: process.platform,
  browser: "rankball-room-chat-bridge",
  device: "rankball-room-chat-bridge",
};

let socket = null;
let sequence = null;
let heartbeatTimer = null;
let heartbeatAcknowledged = true;
let closing = false;
let reconnectAttempt = 0;
let reconnectTimer = null;
let nextReconnectDelayMs = null;
let sessionId = "";
let resumeGatewayUrl = "";
let inFlight = 0;

const FATAL_GATEWAY_CLOSE_CODES = new Set([4004, 4010, 4011, 4012, 4013, 4014]);
const RESET_SESSION_CLOSE_CODES = new Set([4007, 4009]);

if (typeof WebSocket !== "function") {
  console.error("Global WebSocket is required. Run this script with Node 22+ or a runtime that exposes WebSocket.");
  process.exit(1);
}

if (!bridgeSecret && !dryRun) {
  console.error("DISCORD_CHAT_BRIDGE_SECRET or CRON_SECRET is required.");
  process.exit(1);
}

if (!process.env.DISCORD_CHAT_BRIDGE_SECRET && process.env.CRON_SECRET && !dryRun) {
  console.warn("DISCORD_CHAT_BRIDGE_SECRET is not set. CRON_SECRET compatibility fallback is active.");
}

function readRequiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    console.error(`${name} is required.`);
    process.exit(1);
  }
  return value;
}

function readIntegerEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function readBooleanEnv(name, fallback = false) {
  const value = String(process.env[name] || "").trim().toLowerCase();
  if (!value) return fallback;
  return ["1", "true", "yes", "y", "on"].includes(value);
}

function readListEnv(name) {
  return String(process.env[name] || "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => isDiscordSnowflake(item));
}

function getBridgeUrl() {
  const explicit = String(process.env.DISCORD_CHAT_BRIDGE_URL || "").trim();
  if (explicit) return explicit;
  const base = getConfiguredPublicAppUrl();
  if (!base) {
    console.error("DISCORD_CHAT_BRIDGE_URL or VITE_PUBLIC_APP_URL is required.");
    process.exit(1);
  }
  return `${base}/api/discord/room-chat`;
}

function sleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function getGatewayUrl() {
  const base = String(resumeGatewayUrl || DISCORD_GATEWAY_URL).replace(/\?.*$/, "").replace(/\/+$/, "");
  return `${base}/?v=10&encoding=json`;
}

function resetGatewaySession() {
  sessionId = "";
  resumeGatewayUrl = "";
  sequence = null;
}

function send(payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(payload));
}

function sendHeartbeat(requirePreviousAck = true) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  if (requirePreviousAck && !heartbeatAcknowledged) {
    console.warn("Discord heartbeat ACK missed. Reconnecting.");
    socket.close(4000, "heartbeat_ack_timeout");
    return;
  }
  heartbeatAcknowledged = false;
  send({ op: 1, d: sequence });
}

function startHeartbeat(intervalMs) {
  stopHeartbeat();
  heartbeatAcknowledged = true;
  const safeIntervalMs = Math.max(1000, Number(intervalMs) || 45000);
  const runHeartbeat = () => {
    sendHeartbeat(true);
    if (!closing) heartbeatTimer = setTimeout(runHeartbeat, safeIntervalMs);
  };
  heartbeatTimer = setTimeout(runHeartbeat, Math.floor(Math.random() * safeIntervalMs));
}

function stopHeartbeat() {
  if (!heartbeatTimer) return;
  clearTimeout(heartbeatTimer);
  heartbeatTimer = null;
}

function scheduleReconnect() {
  if (closing || reconnectTimer) return;
  const delayMs = nextReconnectDelayMs ?? Math.min(30000, 1000 * 2 ** Math.min(5, reconnectAttempt));
  nextReconnectDelayMs = null;
  reconnectAttempt += 1;
  console.warn(`Discord gateway reconnecting in ${delayMs}ms.`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delayMs);
}

function connect() {
  if (closing) return;
  const nextSocket = new WebSocket(getGatewayUrl());
  socket = nextSocket;

  nextSocket.addEventListener("open", () => {
    console.log("Discord room chat bridge connected.");
  });

  nextSocket.addEventListener("message", (event) => {
    void handleGatewayMessage(event.data).catch((error) => {
      console.error("Discord gateway message failed.", error);
    });
  });

  nextSocket.addEventListener("close", (event) => {
    if (socket !== nextSocket) return;
    socket = null;
    stopHeartbeat();
    if (closing) return;
    if (FATAL_GATEWAY_CLOSE_CODES.has(event.code)) {
      console.error(`Discord gateway closed with fatal code ${event.code}.`);
      void shutdown(1);
      return;
    }
    if (RESET_SESSION_CLOSE_CODES.has(event.code)) resetGatewaySession();
    console.warn(`Discord gateway closed (${event.code}).`);
    scheduleReconnect();
  });

  nextSocket.addEventListener("error", (event) => {
    console.error("Discord gateway socket error.", event?.message || "socket_error");
  });
}

async function handleGatewayMessage(raw) {
  const payload = JSON.parse(String(raw));
  if (typeof payload.s === "number") sequence = payload.s;

  if (payload.op === 10) {
    startHeartbeat(Number(payload.d?.heartbeat_interval || 45000));
    if (sessionId && typeof sequence === "number") {
      send({
        op: 6,
        d: {
          token: token.replace(/^Bot\s+/i, ""),
          session_id: sessionId,
          seq: sequence,
        },
      });
    } else {
      send({
        op: 2,
        d: {
          token: token.replace(/^Bot\s+/i, ""),
          intents,
          properties: identifyProperties,
        },
      });
    }
    return;
  }

  if (payload.op === 1) {
    sendHeartbeat(false);
    return;
  }

  if (payload.op === 11) {
    heartbeatAcknowledged = true;
    return;
  }

  if (payload.op === 7) {
    nextReconnectDelayMs = 0;
    socket?.close(4000, "gateway_reconnect_requested");
    return;
  }

  if (payload.op === 9) {
    if (!payload.d) resetGatewaySession();
    nextReconnectDelayMs = 1000 + Math.floor(Math.random() * 4000);
    socket?.close(4000, "invalid_session");
    return;
  }

  if (payload.op !== 0) return;
  if (payload.t === "READY") {
    sessionId = String(payload.d?.session_id || "");
    resumeGatewayUrl = String(payload.d?.resume_gateway_url || "");
    reconnectAttempt = 0;
    console.log(`Discord room chat bridge ready as ${payload.d?.user?.username || "bot"}.`);
    return;
  }
  if (payload.t === "RESUMED") {
    reconnectAttempt = 0;
    console.log("Discord room chat bridge session resumed.");
    return;
  }
  if (payload.t === "MESSAGE_CREATE") await forwardMessage(payload.d ?? {});
}

function shouldSkipMessage(message = {}) {
  if (!isDiscordSnowflake(message.id)) return "invalid_message_id";
  if (!isDiscordSnowflake(message.channel_id)) return "invalid_channel_id";
  if (message.author?.bot || message.webhook_id) return "bot_or_webhook_message";
  if (channelFilter.size && !channelFilter.has(String(message.channel_id))) return "channel_not_allowed";
  if (!String(message.content || "").trim()) return "empty_content";
  return "";
}

async function forwardMessage(message = {}) {
  const skipReason = shouldSkipMessage(message);
  if (skipReason) {
    if (logSkips) console.log(`Skipped Discord message ${message.id || ""}: ${skipReason}`);
    return;
  }

  const payload = {
    messageId: String(message.id),
    channelId: String(message.channel_id),
    discordUserId: String(message.author?.id || ""),
    username: String(message.author?.global_name || message.author?.username || ""),
    body: String(message.content || ""),
    authorBot: Boolean(message.author?.bot),
    webhookId: message.webhook_id || null,
  };

  if (dryRun) {
    console.log("DRY RUN Discord room chat payload", payload);
    return;
  }

  inFlight += 1;
  try {
    await deliverBridgePayload(payload, message.id);
  } finally {
    inFlight -= 1;
  }
}

async function deliverBridgePayload(payload, messageId) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxDeliveryAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("bridge_request_timeout")), requestTimeoutMs);
    try {
      const response = await fetch(bridgeUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bridgeSecret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const text = await response.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      if (response.ok) {
        if (body?.duplicate && logSkips) console.log(`Bridge duplicate ${messageId}`);
        return;
      }

      const errorText = typeof body === "string" ? body : body?.error || response.statusText;
      if (response.status === 404 || response.status === 403) {
        if (logSkips) console.log(`Bridge skipped ${messageId}: ${errorText}`);
        return;
      }
      const retryable = response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500;
      lastError = new Error(`bridge_failed:${response.status}:${errorText}`);
      if (!retryable || attempt === maxDeliveryAttempts) throw lastError;

      const retryAfterHeader = Number(response.headers.get("retry-after"));
      const retryAfterBodyMs = Number(body?.retryAfterMs);
      const retryAfterBodySeconds = Number(body?.retry_after);
      const retryDelayMs = Math.min(30000, Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
        ? retryAfterHeader * 1000
        : Number.isFinite(retryAfterBodyMs) && retryAfterBodyMs > 0
          ? retryAfterBodyMs
          : Number.isFinite(retryAfterBodySeconds) && retryAfterBodySeconds > 0
            ? retryAfterBodySeconds * 1000
            : 500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250));
      console.warn(`Bridge delivery ${messageId} retry ${attempt}/${maxDeliveryAttempts} in ${retryDelayMs}ms.`);
      await sleep(retryDelayMs);
    } catch (error) {
      lastError = error;
      if (attempt === maxDeliveryAttempts || String(error?.message || "").startsWith("bridge_failed:4")) throw error;
      await sleep(Math.min(30000, 500 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 250));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError ?? new Error("bridge_delivery_failed");
}

async function shutdown(exitCode = 0) {
  closing = true;
  stopHeartbeat();
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  socket?.close(1000, "shutdown");
  const started = Date.now();
  while (inFlight > 0 && Date.now() - started < 3000) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  process.exit(exitCode);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

console.log(`Discord room chat bridge target: ${bridgeUrl}`);
connect();
