import { toNodeHandler } from "@modelcontextprotocol/node";
import { boxtierMcpHandler } from "../server/api/mcp.js";

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 30;
const DEFAULT_MAX_TRACKED_KEYS = 10_000;
const requestWindows = new Map();

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function requestKey(request) {
  const forwarded = String(request.headers?.["x-forwarded-for"] ?? "").split(",")[0].trim();
  return forwarded || request.socket?.remoteAddress || "unknown";
}

function isRateLimited(request) {
  const now = Date.now();
  const windowMs = positiveInteger(process.env.BOXTIER_MCP_RATE_WINDOW_MS, DEFAULT_WINDOW_MS);
  const maxRequests = positiveInteger(process.env.BOXTIER_MCP_RATE_MAX_REQUESTS, DEFAULT_MAX_REQUESTS);
  const maxTrackedKeys = positiveInteger(process.env.BOXTIER_MCP_RATE_MAX_KEYS, DEFAULT_MAX_TRACKED_KEYS);
  const key = requestKey(request);
  const active = requestWindows.get(key);
  if (!active || now - active.startedAt >= windowMs) {
    if (requestWindows.size >= maxTrackedKeys) {
      for (const [trackedKey, tracked] of requestWindows) {
        if (now - tracked.startedAt >= windowMs) requestWindows.delete(trackedKey);
      }
      if (requestWindows.size >= maxTrackedKeys) requestWindows.delete(requestWindows.keys().next().value);
    }
    requestWindows.set(key, { startedAt: now, count: 1 });
    return 0;
  }
  active.count += 1;
  return active.count > maxRequests
    ? Math.max(1, Math.ceil((windowMs - (now - active.startedAt)) / 1_000))
    : 0;
}

const nodeHandler = toNodeHandler(boxtierMcpHandler, {
  onerror: (error) => console.error("[mcp] node adapter failed", error),
});

export default async function handler(request, response) {
  const retryAfter = request.method === "POST" ? isRateLimited(request) : 0;
  if (retryAfter > 0) {
    response.writeHead(429, {
      "content-type": "application/json; charset=utf-8",
      "retry-after": String(retryAfter),
    });
    response.end(JSON.stringify({ error: "mcp_rate_limited" }));
    return;
  }
  await nodeHandler(request, response, request.body);
}
