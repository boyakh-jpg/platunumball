export function fromRemoteTeamInvitation(row = {}) {
  return {
    id: row.id,
    teamId: row.team_id,
    fromUserId: row.from_user_id,
    targetUserId: row.target_user_id,
    role: row.role ?? "regular",
    status: row.status ?? "pending",
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
  };
}
