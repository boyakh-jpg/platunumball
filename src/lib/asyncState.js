export function isLatestRequest(currentRequestId, requestId) {
  return currentRequestId === requestId;
}

export function isCurrentScopedOperation(currentOperation, operation, scopeId) {
  return currentOperation === operation && operation?.scopeId === scopeId;
}

export function isCurrentScopedRequest(currentScopeId, currentRequestId, scopeId, requestId) {
  return currentScopeId === scopeId && currentRequestId === requestId;
}
