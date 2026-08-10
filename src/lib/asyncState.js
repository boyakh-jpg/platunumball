export function isLatestRequest(currentRequestId, requestId) {
  return currentRequestId === requestId;
}

export function isCurrentScopedOperation(currentOperation, operation, scopeId) {
  return currentOperation === operation && operation?.scopeId === scopeId;
}
