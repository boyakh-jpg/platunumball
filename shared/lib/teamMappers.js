import { DEFAULT_RATING } from "./constants.js";
import { normalizeTeamJoinApplication } from "./teamJoinApplication.js";
import { projectTeamRow } from "./teamRowProjection.js";

export function fromRemoteTeam(row, memberRows) {
  return {
    ...projectTeamRow(row),
    rosterMmr: row.roster_mmr ?? row.mmr ?? DEFAULT_RATING,
    performanceAdjustment: Number(row.performance_adjustment ?? 0),
    emblemViolationCount: Number(row.emblem_violation_count ?? 0),
    emblemUploadBlockedUntil: row.emblem_upload_blocked_until ?? null,
    emblemModeratedAt: row.emblem_moderated_at ?? null,
    emblemModerationReason: row.emblem_moderation_reason ?? "",
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
    requestKind: row.request_kind ?? "invite",
    status: row.status ?? "pending",
    application: normalizeTeamJoinApplication(row.application),
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
  };
}
