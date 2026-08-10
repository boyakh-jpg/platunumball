export function isLatestRequest(currentRequestId, requestId) {
  return currentRequestId === requestId;
}

export function isCurrentScopedOperation(currentOperation, operation, scopeId) {
  return currentOperation === operation && operation?.scopeId === scopeId;
}

export function isCurrentScopedRequest(currentScopeId, currentRequestId, scopeId, requestId) {
  return currentScopeId === scopeId && currentRequestId === requestId;
}

export function createMutationTracker(keys = []) {
  return Object.fromEntries(keys.map((key) => [key, { version: 0, pending: 0 }]));
}

export function beginTrackedMutation(tracker, key) {
  const current = tracker[key] ?? { version: 0, pending: 0 };
  tracker[key] = { version: current.version + 1, pending: current.pending + 1 };
  return tracker[key].version;
}

export function endTrackedMutation(tracker, key) {
  const current = tracker[key] ?? { version: 0, pending: 0 };
  tracker[key] = { version: current.version + 1, pending: Math.max(0, current.pending - 1) };
}

export function getTrackedMutationVersion(tracker, key) {
  return tracker[key]?.version ?? 0;
}

export function hasTrackedMutationSince(tracker, key, version) {
  const current = tracker[key];
  return Boolean(current?.pending) || (current?.version ?? 0) !== version;
}
