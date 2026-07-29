function getEntityId(row = {}) {
  return row?.entity_id ?? row?.entityId;
}

function getCardTime(card = {}) {
  return Number(new Date(card.updatedAt ?? card.updated_at ?? card.createdAt ?? card.created_at ?? 0).getTime()) || 0;
}

export function readRoomFeedCard(row = {}, { allowCardAlias = false } = {}) {
  const card = row?.card_json ?? row?.cardJson ?? (allowCardAlias ? row?.card : null);
  if (!card || typeof card !== "object" || Array.isArray(card)) return null;
  const id = card.id ?? getEntityId(row);
  return id ? { card, id } : null;
}

export function mergeFeedRelations(current = [], incoming = []) {
  return [...new Set([...(current ?? []), ...(incoming ?? [])])];
}

export function collectUniqueRoomFeedCards(rows = [], ids = [], {
  normalizeCard,
  mergeDuplicate,
} = {}) {
  if (typeof normalizeCard !== "function") throw new TypeError("normalizeCard is required.");
  const idSet = new Set(ids);
  const cards = new Map();
  (rows ?? []).forEach((row) => {
    const id = getEntityId(row);
    if (!id || !idSet.has(id)) return;
    if (cards.has(id)) {
      if (typeof mergeDuplicate === "function") {
        cards.set(id, mergeDuplicate(cards.get(id), row) ?? cards.get(id));
      }
      return;
    }
    const card = normalizeCard(row);
    if (card) cards.set(id, card);
  });
  return ids.map((id) => cards.get(id)).filter(Boolean);
}

export async function attachRoomFeedCardJson(client, rows = [], {
  entityType,
  uniqueIds,
  isMissingTableError,
} = {}) {
  const normalizeIds = typeof uniqueIds === "function"
    ? uniqueIds
    : (values) => [...new Set(values.filter(Boolean))];
  const ids = normalizeIds((rows ?? []).map((row) => row?.entity_id));
  if (!ids.length) return rows;
  const { data, error } = await client
    .from("room_feed_cards")
    .select("entity_id,card_json")
    .eq("entity_type", entityType)
    .in("entity_id", ids);
  if (error) {
    if (typeof isMissingTableError === "function" && isMissingTableError(error)) return rows;
    throw error;
  }
  const cardById = new Map((data ?? []).map((row) => [row.entity_id, row.card_json]));
  return rows.map((row) => ({
    ...row,
    card_json: cardById.get(row?.entity_id) ?? row?.card_json ?? {},
  }));
}

export function mergeRoomFeedCards(...cardGroups) {
  const cards = new Map();
  cardGroups.flat().forEach((card) => {
    const id = card?.id;
    if (!id) return;
    if (cards.has(id)) {
      const existing = cards.get(id);
      const feedRelations = mergeFeedRelations(existing.__feedRelations, card.__feedRelations);
      if (getCardTime(card) > getCardTime(existing)) {
        cards.set(id, { ...card, __feedRelations: feedRelations });
      } else {
        existing.__feedRelations = feedRelations;
      }
      return;
    }
    cards.set(id, card);
  });
  return [...cards.values()];
}
