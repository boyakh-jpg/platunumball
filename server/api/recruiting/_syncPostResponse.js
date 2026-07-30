import { sendJson } from "../_supabaseAdmin.js";

import { isTrue } from "./_syncPostCommon.js";

export function createTimingProbe() {
  const startedAt = Date.now();
  const steps = [];
  return {
    async track(name, callback) {
      const stepStartedAt = Date.now();
      try {
        return await callback();
      } finally {
        steps.push({ name, ms: Date.now() - stepStartedAt });
      }
    },
    payload() {
      return { totalMs: Date.now() - startedAt, steps };
    },
    header() {
      const timing = this.payload();
      return [
        `total;dur=${Math.max(0, timing.totalMs)}`,
        ...timing.steps.map((step) => `${step.name};dur=${Math.max(0, step.ms)}`),
      ].join(", ");
    },
  };
}

export function hasDebugTimingParam(request) {
  try {
    const url = new URL(request.url ?? "", "http://localhost");
    return isTrue(url.searchParams.get("debugTiming"));
  } catch {
    return false;
  }
}

export function sendTimedJson(response, statusCode, payload, timing, includeTiming = false) {
  if (timing) response.setHeader("Server-Timing", timing.header());
  sendJson(response, statusCode, includeTiming && timing
    ? { ...payload, debugTiming: timing.payload() }
    : payload);
}

export async function timeStep(timing, name, callback) {
  return timing ? timing.track(name, callback) : callback();
}
