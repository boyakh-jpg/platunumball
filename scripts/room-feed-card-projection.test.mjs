import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  attachRoomFeedCardJson,
  collectUniqueRoomFeedCards,
  mergeFeedRelations,
  mergeRoomFeedCards,
  readRoomFeedCard,
} from "../server/lib/roomFeedCards.js";
import { fetchRoomFeedSourceMap } from "../server/lib/roomFeedSources.js";

test("피드 카드 후보는 기존 필드 우선순위와 객체·ID 검증을 유지한다", () => {
  const snakeCard = { id: "snake", source: "snake" };
  const camelCard = { id: "camel", source: "camel" };
  const aliasCard = { id: "alias", source: "alias" };

  assert.deepEqual(readRoomFeedCard({
    entity_id: "row",
    card_json: snakeCard,
    cardJson: camelCard,
    card: aliasCard,
  }, { allowCardAlias: true }), {
    card: snakeCard,
    id: "snake",
  });
  assert.deepEqual(readRoomFeedCard({
    entity_id: "row",
    cardJson: camelCard,
    card: aliasCard,
  }, { allowCardAlias: true }), {
    card: camelCard,
    id: "camel",
  });
  assert.deepEqual(readRoomFeedCard({
    entity_id: "row",
    card: aliasCard,
  }, { allowCardAlias: true }), {
    card: aliasCard,
    id: "alias",
  });
  assert.equal(readRoomFeedCard({ entity_id: "row", card: aliasCard }), null);
  assert.equal(readRoomFeedCard({ entity_id: "row", card_json: JSON.stringify(snakeCard) }), null);
  assert.equal(readRoomFeedCard({ entity_id: "row", card_json: [] }), null);
  assert.equal(readRoomFeedCard({ card_json: { title: "ID 없음" } }), null);
  assert.deepEqual(readRoomFeedCard({ entity_id: "fallback", card_json: { title: "fallback" } }), {
    card: { title: "fallback" },
    id: "fallback",
  });
});

test("피드 카드 중복 제거는 요청 ID 필터·순서와 최초 유효 카드 우선 규칙을 유지한다", () => {
  const normalizeCard = (row) => {
    const candidate = readRoomFeedCard(row);
    return candidate ? { ...candidate.card, id: candidate.id } : null;
  };
  const rows = [
    { entity_id: "outside", card_json: { id: "outside", value: 0 } },
    { entity_id: "a", card_json: "invalid" },
    { entity_id: "a", card_json: { id: "a", value: 1 } },
    { entity_id: "a", card_json: { id: "a", value: 2 } },
    { entity_id: "b", card_json: { id: "b", value: 3 }, relation: "team" },
    { entity_id: "b", card_json: { id: "b", value: 4 }, relation: "invited" },
  ];

  const cards = collectUniqueRoomFeedCards(rows, ["b", "a", "b", "missing"], {
    normalizeCard,
    mergeDuplicate: (existing, row) => ({
      ...existing,
      relations: mergeFeedRelations(existing.relations, [row.relation].filter(Boolean)),
    }),
  });

  assert.deepEqual(cards, [
    { id: "b", value: 3, relations: ["invited"] },
    { id: "a", value: 1, relations: [] },
    { id: "b", value: 3, relations: ["invited"] },
  ]);
});

function createRoomFeedClient(result) {
  const calls = [];
  const query = {
    select(columns) {
      calls.push(["select", columns]);
      return this;
    },
    eq(column, value) {
      calls.push(["eq", column, value]);
      return this;
    },
    async in(column, values) {
      calls.push(["in", column, values]);
      return result;
    },
  };
  return {
    calls,
    client: {
      from(table) {
        calls.push(["from", table]);
        return query;
      },
    },
  };
}

test("room_feed_cards 결합은 원격 최신 행, 기존 card_json, 빈 객체 순으로 덮어쓴다", async () => {
  const { client, calls } = createRoomFeedClient({
    data: [
      { entity_id: "a", card_json: { source: "remote-old" } },
      { entity_id: "a", card_json: { source: "remote-last" } },
      { entity_id: "b", card_json: null },
    ],
    error: null,
  });
  const rows = [
    { entity_id: "a", card_json: { source: "inline-a" }, relation: "captain" },
    { entity_id: "a", card_json: { source: "inline-duplicate" } },
    { entity_id: "b", card_json: { source: "inline-b" } },
    { entity_id: "c" },
    { entityId: "camel-only", card_json: { source: "camel-inline" } },
  ];

  const attached = await attachRoomFeedCardJson(client, rows, {
    entityType: "match",
    uniqueIds: (values) => [...new Set(values.filter(Boolean))],
    isMissingTableError: () => false,
  });

  assert.deepEqual(calls, [
    ["from", "room_feed_cards"],
    ["select", "entity_id,card_json"],
    ["eq", "entity_type", "match"],
    ["in", "entity_id", ["a", "b", "c"]],
  ]);
  assert.deepEqual(attached.map((row) => row.card_json), [
    { source: "remote-last" },
    { source: "remote-last" },
    { source: "inline-b" },
    {},
    { source: "camel-inline" },
  ]);
  assert.equal(attached[0].relation, "captain");
});

test("room_feed_cards 미존재 오류만 기존 행 배열로 폴백하고 다른 오류는 전달한다", async () => {
  const rows = [{ entity_id: "a", card_json: { source: "inline" } }];
  const missing = { code: "42P01", message: "room_feed_cards does not exist" };
  const missingClient = createRoomFeedClient({ data: null, error: missing }).client;
  const fallback = await attachRoomFeedCardJson(missingClient, rows, {
    entityType: "recruiting",
    isMissingTableError: (error) => error === missing,
  });
  assert.equal(fallback, rows);

  const denied = { code: "42501", message: "permission denied" };
  const deniedClient = createRoomFeedClient({ data: null, error: denied }).client;
  await assert.rejects(
    attachRoomFeedCardJson(deniedClient, rows, {
      entityType: "match",
      isMissingTableError: () => false,
    }),
    (error) => error === denied,
  );
});

function createRoomFeedSourceClient(resultsByTable = {}) {
  const calls = [];
  return {
    calls,
    client: {
      from(table) {
        calls.push(["from", table]);
        return {
          select(columns) {
            calls.push(["select", table, columns]);
            return this;
          },
          async in(column, values) {
            calls.push(["in", table, column, values]);
            return resultsByTable[table] ?? { data: [], error: null };
          },
        };
      },
    },
  };
}

test("피드 원본 조회는 타입별 ID와 컬럼만 주입받아 같은 Map 키로 결합한다", async () => {
  const { client, calls } = createRoomFeedSourceClient({
    recruiting_posts: { data: [{ id: "r1", status: "open" }], error: null },
    matches: { data: [{ id: "m1", status: "agreed" }], error: null },
  });
  const sourceMap = await fetchRoomFeedSourceMap(client, [
    { entity_type: "recruiting", entity_id: " r1 " },
    { entity_type: "recruiting", entity_id: "r1" },
    { entity_type: "match", entity_id: "m1" },
    { entity_type: "other", entity_id: "ignored" },
  ], {
    columnsByType: {
      recruiting: "id,status,room_state",
      match: "id,status,rules",
    },
  });

  assert.deepEqual(calls, [
    ["from", "recruiting_posts"],
    ["select", "recruiting_posts", "id,status,room_state"],
    ["in", "recruiting_posts", "id", ["r1"]],
    ["from", "matches"],
    ["select", "matches", "id,status,rules"],
    ["in", "matches", "id", ["m1"]],
  ]);
  assert.deepEqual(sourceMap.get("recruiting:r1"), { id: "r1", status: "open" });
  assert.deepEqual(sourceMap.get("match:m1"), { id: "m1", status: "agreed" });
});

test("피드 원본 공용 조회는 DB 오류와 타입별 컬럼 누락을 숨기지 않는다", async () => {
  const denied = { code: "42501", message: "permission denied" };
  const { client } = createRoomFeedSourceClient({
    recruiting_posts: { data: null, error: denied },
  });
  await assert.rejects(
    fetchRoomFeedSourceMap(client, [{ entity_type: "recruiting", entity_id: "r1" }], {
      columnsByType: { recruiting: "id,status" },
    }),
    (error) => error === denied,
  );
  await assert.rejects(
    fetchRoomFeedSourceMap(createRoomFeedSourceClient().client, [{ entity_type: "match", entity_id: "m1" }]),
    /missing_room_feed_source_columns:match/u,
  );
});

test("피드 그룹 병합은 최초 순서, 최신 카드 내용, 모든 relation을 보존한다", () => {
  const older = {
    id: "same",
    title: "older",
    updatedAt: "2026-07-01T00:00:00.000Z",
    __feedRelations: ["captain"],
  };
  const newer = {
    id: "same",
    title: "newer",
    updatedAt: "2026-07-02T00:00:00.000Z",
    __feedRelations: ["team"],
  };
  const equalOrOlder = {
    id: "same",
    title: "ignored",
    updatedAt: "2026-07-01T00:00:00.000Z",
    __feedRelations: ["invited"],
  };

  assert.deepEqual(mergeRoomFeedCards(
    [older, { id: "second", updatedAt: "2026-07-03T00:00:00.000Z" }],
    [newer, equalOrOlder, null, { title: "ID 없음" }],
  ), [
    {
      ...newer,
      __feedRelations: ["captain", "team", "invited"],
    },
    { id: "second", updatedAt: "2026-07-03T00:00:00.000Z" },
  ]);
});

test("경기·모집 목록은 공통 피드 결합을 쓰고 전용 검증은 각 API에 남긴다", async () => {
  const [matchSource, recruitingSource] = await Promise.all([
    readFile(new URL("../server/api/matches/list.js", import.meta.url), "utf8"),
    readFile(new URL("../server/api/recruiting/list.js", import.meta.url), "utf8"),
  ]);

  [matchSource, recruitingSource].forEach((source) => {
    assert.match(source, /from "\.\.\/\.\.\/lib\/roomFeedCards\.js"/);
    assert.doesNotMatch(source, /\.from\("room_feed_cards"\)/);
    assert.doesNotMatch(source, /function normalizeFeedCard\(/);
  });
  assert.match(matchSource, /function normalizeMatchFeedCard\(/);
  assert.match(matchSource, /function getFeedOffsetCursor\(/);
  assert.match(matchSource, /`feed:\$\{offset \+ \(data \?\? \[\]\)\.length\}`/);
  assert.match(matchSource, /closedNotice: true/);
  assert.match(matchSource, /if \(!nextCard\?\.teamA/);
  assert.match(matchSource, /if \(!recordType\) return null/);
  assert.match(recruitingSource, /function normalizeRecruitingFeedCard\(/);
  assert.match(recruitingSource, /function getRecruitingFeedCardRejectReason\(/);
  assert.match(recruitingSource, /missing_pending_invitation/);
});

test("피드 감사와 유지보수는 원본 조회만 공용화하고 판정은 각 API에 남긴다", async () => {
  const [auditSource, maintenanceSource] = await Promise.all([
    readFile(new URL("../server/api/system/feed-audit.js", import.meta.url), "utf8"),
    readFile(new URL("../server/api/system/maintenance.js", import.meta.url), "utf8"),
  ]);

  [auditSource, maintenanceSource].forEach((source) => {
    assert.match(source, /from "\.\.\/\.\.\/lib\/roomFeedSources\.js"/u);
    assert.match(source, /fetchRoomFeedSourceMap\(/u);
  });
  assert.doesNotMatch(auditSource, /function fetchSourcesByType\(/u);
  assert.match(auditSource, /function getCardInvalidReasons\(/u);
  assert.match(maintenanceSource, /function getSourceTime\(/u);
  assert.match(maintenanceSource, /const candidates = entities/u);
});
