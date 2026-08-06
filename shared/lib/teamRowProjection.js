import { DEFAULT_RATING } from "./matchConstants.js";
import { mapRemoteTeamEmblem } from "./teamEmblem.js";

export function projectTeamRow(row = {}) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    homeCourt: row.home_court,
    region: row.region,
    mmr: row.mmr ?? DEFAULT_RATING,
    wins: row.wins ?? 0,
    losses: row.losses ?? 0,
    accent: row.accent,
    ...mapRemoteTeamEmblem(row),
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? row.created_at ?? null,
  };
}
