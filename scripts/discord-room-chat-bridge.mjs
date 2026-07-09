const DISCORD_GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
const GUILD_MESSAGES_INTENT = 1 << 9;
const MESSAGE_CONTENT_INTENT = 1 << 15;
const DEFAULT_INTENTS = GUILD_MESSAGES_INTENT | MESSAGE_CONTENT_INTENT;
const SNOWFLAKE_RE = /^\d{17,20}$/;

const token = readRequiredEnv("DISCORD_BOT_TOKEN");
const bridgeSecret = process.env.DISCORD_CHAT_BRIDGE_SECRET || process.env.CRON_SECRET || "";
const bridgeUrl = getBridgeUrl();
const intents = readIntegerEnv("DISCORD_CHAT_BRIDGE_INTENTS", DEFAULT_INTENTS);
const channelFilter = new Set(readListEnv("DISCORD_CHAT_BRIDGE_CHANNEL_IDS"));
const logSkips = readBooleanEnv("DISCORD_CHAT_BRIDGE_LOG_SKIPS", false);
const dryRun = readBooleanEnv("DISCORD_CHAT_BRIDGE_DRY_RUN", false);
const identifyProperties = {
  os: process.platform,
  browser: "rankball-room-chat-bridge",
  device: "rankball-room-chat-bridge",
};

let socket = null;
let sequence = null;
let heartbeatTimer = null;
let closing = false;
let reconnectAttempt = 0;
let inFlight = 0;

if (typeof WebSocket !== "function") {
  console.error("Global WebSocket is required. Run this script with Node 22+ or a runtime that exposes WebSocket.");
  process.exit(1);
}

if (!bridgeSecret && !dryRun) {
  console.error("DISCORD_CHAT_BRIDGE_SECRET or CRON_SECRET is required.");
  process.exit(1);
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
    .filter((item) => SNOWFLAKE_RE.test(item));
}

function getBridgeUrl() {
  const explicit = String(process.env.DISCORD_CHAT_BRIDGE_URL || "").trim();
  if (explicit) return explicit;
  const base = String(process.env.VITE_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.PUBLIC_APP_URL || "").trim().replace(/\/+$/, "");
  if (!base) {
    console.error("DISCORD_CHAT_BRIDGE_URL or VITE_PUBLIC_APP_URL is required.");
    process.exit(1);
  }
  return `${base}/api/discord/room-chat`;
}

function send(payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(payload));
}

function startHeartbeat(intervalMs) {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    send({ op: 1, d: sequence });
  }, intervalMs);
  send({ op: 1, d: sequence });
}

function stopHeartbeat() {
  if (!heartbeatTimer) return;
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

function connect() {
  if (closing) return;
  socket = new WebSocket(DISCORD_GATEWAY_URL);

  socket.addEventListener("open", () => {
    console.log("Discord room chat bridge connected.");
  });

  socket.addEventListener("message", (event) => {
    void handleGatewayMessage(event.data).catch((error) => {
      console.error("Discord gateway message failed.", error);
    });
  });

  socket.addEventListener("close", (event) => {
    stopHeartbeat();
    if (closing) return;
    const delayMs = Math.min(30000, 1000 * 2 ** Math.min(5, reconnectAttempt));
    reconnectAttempt += 1;
    console.warn(`Discord gateway closed (${event.code}). Reconnecting in ${delayMs}ms.`);
    setTimeout(connect, delayMs);
  });

  socket.addEventListener("error", (event) => {
    console.error("Discord gateway socket error.", event?.message || "socket_error");
  });
}

async function handleGatewayMessage(raw) {
  const payload = JSON.parse(String(raw));
  if (typeof payload.s === "number") sequence = payload.s;

  if (payload.op === 10) {
    startHeartbeat(Number(payload.d?.heartbeat_interval || 45000));
    send({
      op: 2,
      d: {
        token: token.replace(/^Bot\s+/i, ""),
        intents,
        properties: identifyProperties,
      },
    });
    return;
  }

  if (payload.op === 1) {
    send({ op: 1, d: sequence });
    return;
  }

  if (payload.op === 7 || payload.op === 9) {
    socket?.close(4000, "gateway_reconnect_requested");
    return;
  }

  if (payload.op !== 0) return;
  if (payload.t === "READY") {
    reconnectAttempt = 0;
    console.log(`Discord room chat bridge ready as ${payload.d?.user?.username || "bot"}.`);
    return;
  }
  if (payload.t === "MESSAGE_CREATE") await forwardMessage(payload.d ?? {});
}

function shouldSkipMessage(message = {}) {
  if (!message.id || !SNOWFLAKE_RE.test(String(message.id))) return "invalid_message_id";
  if (!message.channel_id || !SNOWFLAKE_RE.test(String(message.channel_id))) return "invalid_channel_id";
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
    const response = await fetch(bridgeUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bridgeSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!response.ok) {
      const errorText = typeof body === "string" ? body : body?.error || response.statusText;
      if (response.status === 404 || response.status === 403) {
        if (logSkips) console.log(`Bridge skipped ${message.id}: ${errorText}`);
        return;
      }
      throw new Error(`bridge_failed:${response.status}:${errorText}`);
    }
    if (body?.duplicate && logSkips) console.log(`Bridge duplicate ${message.id}`);
  } finally {
    inFlight -= 1;
  }
}

async function shutdown() {
  closing = true;
  stopHeartbeat();
  socket?.close(1000, "shutdown");
  const started = Date.now();
  while (inFlight > 0 && Date.now() - started < 3000) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

console.log(`Discord room chat bridge target: ${bridgeUrl}`);
connect();
