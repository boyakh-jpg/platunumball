const ROOM_FEED_SOURCE_TYPES = Object.freeze([
  { entityType: "recruiting", table: "recruiting_posts" },
  { entityType: "match", table: "matches" },
]);

function uniqueEntityIds(rows = [], entityType = "") {
  return [...new Set((rows ?? [])
    .filter((row) => row?.entity_type === entityType)
    .map((row) => String(row?.entity_id ?? "").trim())
    .filter(Boolean))];
}

export async function fetchRoomFeedSourceMap(client, rows = [], options = {}) {
  const columnsByType = options.columnsByType ?? {};
  const sourceMap = new Map();

  for (const { entityType, table } of ROOM_FEED_SOURCE_TYPES) {
    const ids = uniqueEntityIds(rows, entityType);
    if (!ids.length) continue;
    const columns = columnsByType[entityType];
    if (!columns) throw new Error(`missing_room_feed_source_columns:${entityType}`);

    const { data, error } = await client
      .from(table)
      .select(columns)
      .in("id", ids);
    if (error) throw error;
    (data ?? []).forEach((row) => {
      sourceMap.set(`${entityType}:${row.id}`, row);
    });
  }

  return sourceMap;
}
