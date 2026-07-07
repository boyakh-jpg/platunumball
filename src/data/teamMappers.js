export function fromRemoteTeam(row, memberRows) {
  return {
    id: row.id,
    name: row.name,
    homeCourt: row.home_court,
    region: row.region,
    mmr: row.mmr ?? 1200,
    wins: row.wins ?? 0,
    losses: row.losses ?? 0,
    accent: row.accent,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? row.created_at ?? null,
    members: [...(memberRows ?? [])]
      .sort((a, b) => String(a.role).localeCompare(String(b.role)) || String(a.user_id).localeCompare(String(b.user_id)))
      .map((member) => ({ userId: member.user_id, role: member.role ?? "regular" })),
  };
}

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
