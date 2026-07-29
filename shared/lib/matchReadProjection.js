export function projectMatchDisputeRow(row = {}) {
  return {
    id: row.id,
    by: row.user_id,
    reason: row.reason,
    request: row.request_payload ?? {},
    status: row.status ?? "open",
    resolvedAt: row.resolved_at ?? null,
    resolvedBy: row.resolved_by ?? "",
    resolution: row.resolution ?? "",
    resolutionReason: row.resolution_reason ?? "",
    resolutionAudit: row.resolution_audit ?? {},
    createdAt: row.created_at,
  };
}

export function projectMatchDisputeRows(rows = []) {
  return (rows ?? []).map(projectMatchDisputeRow);
}

export function projectMatchTimestamps(row = {}) {
  return {
    createdAt: row.created_at,
    agreedAt: row.agreed_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    confirmedAt: row.confirmed_at,
    cancelledAt: row.cancelled_at,
    voidedAt: row.voided_at,
    updatedAt: row.updated_at ?? row.created_at,
  };
}
