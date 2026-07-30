import { groupRowsBy as groupBy, isMissingRoomFeedCards, timeStep, uniqueValues as unique } from "../_supabaseAdmin.js";
import { projectMatchDisputeRows } from "../../../shared/lib/matchReadProjection.js";
import { attachRoomFeedCardJson } from "../../lib/roomFeedCards.js";
import { MATCH_DISPUTE_COLUMNS } from "../../../shared/lib/repositoryColumns.js";
import { MATCH_SIDES } from "../../../shared/lib/constants.js";

export async function attachRoomFeedCards(client, rows = [], entityType = "match") {
  return attachRoomFeedCardJson(client, rows, {
    entityType,
    uniqueIds: unique,
    isMissingTableError: isMissingRoomFeedCards,
  });
}

export async function attachMatchPlayerCountsToCards(client, matches = [], debugTiming = null) {
  const ids = unique((matches ?? []).map((match) => match?.id));
  if (!ids.length) return matches;
  const { data, error } = await timeStep(debugTiming, "cardPlayerCountsMs", () => (
    client.from("match_players").select("match_id,side,user_id").in("match_id", ids)
  ));
  if (error) throw error;
  const countsByMatch = new Map(ids.map((id) => [id, { teamA: new Set(), teamB: new Set() }]));
  (data ?? []).forEach((row) => {
    const matchId = row?.match_id;
    const side = row?.side;
    const userId = row?.user_id;
    if (!matchId || !MATCH_SIDES.includes(side) || !userId) return;
    if (!countsByMatch.has(matchId)) {
      countsByMatch.set(matchId, { teamA: new Set(), teamB: new Set() });
    }
    countsByMatch.get(matchId)[side].add(userId);
  });
  return matches.map((match) => {
    const counts = countsByMatch.get(match?.id);
    return {
      ...match,
      teamA: { ...(match.teamA ?? {}), count: counts.teamA.size },
      teamB: { ...(match.teamB ?? {}), count: counts.teamB.size },
    };
  });
}

export async function attachOpenDisputeQueues(client, matches = [], debugTiming = null) {
  const disputedMatchIds = unique((matches ?? [])
    .filter((match) => match?.status === "disputed")
    .map((match) => match.id));
  if (!disputedMatchIds.length) return matches;
  const { data, error } = await timeStep(debugTiming, "openDisputesMs", () => (
    client
      .from("match_disputes")
      .select(MATCH_DISPUTE_COLUMNS)
      .in("match_id", disputedMatchIds)
      .eq("status", "open")
      .order("created_at", { ascending: true })
  ));
  if (error) throw error;
  const disputesByMatch = groupBy(data ?? [], "match_id");
  return (matches ?? []).map((match) => match?.status === "disputed"
    ? {
        ...match,
        disputes: projectMatchDisputeRows(disputesByMatch.get(match.id)),
      }
    : match);
}
