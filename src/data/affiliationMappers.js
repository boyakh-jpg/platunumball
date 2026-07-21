export function fromRemoteAffiliation(row = {}) {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    normalizedName: row.normalized_name ?? "",
    memberCount: Number(row.member_count ?? 0),
    score: Number(row.score ?? 0),
    wins: Number(row.wins ?? 0),
    losses: Number(row.losses ?? 0),
    status: row.status ?? "active",
    createdBy: row.created_by ?? null,
    mergedIntoId: row.merged_into_id ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}
