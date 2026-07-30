import { clearState } from "../../lib/storage.js";
import { clone } from "../rowUtils.js";
import { createEmptyState } from "../stateMappers.js";
import { getDemoInitialState } from "../stateNormalizer.js";
import { normalizeState } from "../stateNormalizer.js";
import { readState } from "../../lib/storage.js";
import { syncDiscordNotificationDeliveries } from "../../lib/discord.js";
import { writeState } from "../../lib/storage.js";
import { runAutomaticStateMaintenance } from "./lifecycle.js";

export function loadState(options = {}) {
  const includeDemo = options.includeDemo !== false;
  const fallback = includeDemo ? clone(getDemoInitialState()) : createEmptyState(options);
  const rawState = includeDemo ? readState(fallback) : fallback;
  return runAutomaticStateMaintenance(normalizeState(rawState, { includeDemo }));
}

export function saveState(state) {
  writeState(state);
}

export function syncNotificationDeliveries(state) {
  return syncDiscordNotificationDeliveries(state);
}

export function subscribeRemoteState() {
  return () => {};
}

export function resetState(options = {}) {
  clearState();
  return options.includeDemo === false ? createEmptyState(options) : clone(getDemoInitialState());
}
