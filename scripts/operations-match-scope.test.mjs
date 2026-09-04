import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  fetchOperationsMatchPage,
  MATCH_RELATED_FALLBACK_MAX_LIMIT,
} from "../server/api/matches/_listOperationsQueries.js";
import { filterOperationsMatchCards } from "../server/api/matches/_listProjection.js";
import {
  createMatchListStore,
  getMatchListScope,
  MATCH_LIST_SCOPES,
  MATCH_LIST_STATUSES,
  selectMatchListMatches,
  updateMatchListScope,
} from "../shared/lib/matchListStore.js";
import { buildLoaderActions } from "../src/hooks/appData/actions/loaderActions.js";
import { createInitialMatchListStore } from "../src/hooks/appData/remoteMerge/pages.js";

function createQueryClient(rows = []) {
  const calls = [];
  const query = {
    select(...args) { calls.push(["select", ...args]); return this; },
    or(...args) { calls.push(["or", ...args]); return this; },
    neq(...args) { calls.push(["neq", ...args]); return this; },
    order(...args) { calls.push(["order", ...args]); return this; },
    limit(...args) { calls.push(["limit", ...args]); return this; },
    then(resolve, reject) {
      return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
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

test("operations query is role-bound, closed-free, and capped", async () => {
  const rows = [{ id: "match-1" }];
  const { client, calls } = createQueryClient(rows);
  const result = await fetchOperationsMatchPage(client, "operator-1", 999);

  assert.deepEqual(result, {
    rows,
    cursor: "",
    exhausted: true,
    source: "operations",
  });
  assert.deepEqual(calls.find(([method]) => method === "or"), [
    "or",
    "created_by.eq.operator-1,referee_id.eq.operator-1",
  ]);
  assert.deepEqual(calls.find(([method]) => method === "neq"), ["neq", "status", "closed"]);
  assert.deepEqual(calls.find(([method]) => method === "limit"), [
    "limit",
    MATCH_RELATED_FALLBACK_MAX_LIMIT,
  ]);
});

test("operations query rejects unsafe PostgREST literals before querying", async () => {
  const { client, calls } = createQueryClient([{ id: "leak" }]);
  const result = await fetchOperationsMatchPage(client, "operator,referee", 20);

  assert.deepEqual(result, {
    rows: [],
    cursor: "",
    exhausted: true,
    source: "operations",
  });
  assert.deepEqual(calls, []);
});

test("operations projection keeps only current host/referee operational phases", () => {
  const currentUserId = "operator-1";
  const now = new Date("2026-09-04T12:00:00.000Z");
  const host = { createdBy: currentUserId, rules: {} };
  const matches = [
    { ...host, id: "waiting", status: "open" },
    { ...host, id: "locked", status: "agreed", scheduledAt: "2026-09-05T12:00:00.000Z" },
    { ...host, id: "checkin", status: "agreed", scheduledAt: "2026-09-04T12:05:00.000Z" },
    { ...host, id: "live", status: "agreed", startedAt: "2026-09-04T11:30:00.000Z" },
    { ...host, id: "postgame", status: "approval", endedAt: "2026-09-04T11:55:00.000Z" },
    { ...host, id: "dispute", status: "disputed" },
    { ...host, id: "record", status: "confirmed" },
    { ...host, id: "cancelled", status: "cancelled" },
    { ...host, id: "void", status: "void" },
    { createdBy: "someone-else", refereeId: currentUserId, rules: {}, id: "referee", status: "open" },
    { createdBy: "someone-else", refereeId: "another-referee", rules: {}, id: "participant-only", status: "open" },
    { ...host, id: "closed", status: "closed" },
    { ...host, id: "personal", status: "confirmed", rules: { recordType: "solo" } },
    { ...host, id: "match-record", status: "confirmed", rules: { recordType: "match_record" } },
    { ...host, id: "m_seed_upcoming_1", status: "open" },
  ];

  assert.deepEqual(
    filterOperationsMatchCards(matches, currentUserId, now).map(({ id }) => id),
    ["waiting", "locked", "checkin", "live", "postgame", "dispute", "record", "cancelled", "void", "referee"],
  );
});

test("operations list state is independent and preserves ids across status changes", () => {
  const initial = createMatchListStore({
    [MATCH_LIST_SCOPES.PERSONAL]: {
      ids: ["personal-1"],
      status: MATCH_LIST_STATUSES.READY,
    },
  });
  const ready = updateMatchListScope(initial, MATCH_LIST_SCOPES.OPERATIONS, {
    ids: ["operations-1"],
    recruitingPostIds: ["post-1"],
    status: MATCH_LIST_STATUSES.READY,
  });
  const failed = updateMatchListScope(ready, MATCH_LIST_SCOPES.OPERATIONS, {
    status: MATCH_LIST_STATUSES.ERROR,
    error: "load_failed",
  });

  assert.deepEqual(getMatchListScope(failed, MATCH_LIST_SCOPES.PERSONAL).ids, ["personal-1"]);
  assert.deepEqual(getMatchListScope(failed, MATCH_LIST_SCOPES.OPERATIONS), {
    ids: ["operations-1"],
    recruitingPostIds: ["post-1"],
    status: MATCH_LIST_STATUSES.ERROR,
    error: "load_failed",
  });
  assert.deepEqual(
    selectMatchListMatches(
      { "operations-1": { id: "operations-1" } },
      failed,
      MATCH_LIST_SCOPES.OPERATIONS,
    ),
    [{ id: "operations-1" }],
  );
});

test("local demo keeps synthetic matches out of the operations scope", () => {
  const localStore = createInitialMatchListStore({
    matches: [{ id: "local-match" }],
    recruitingPosts: [{ id: "local-post" }],
  });
  const loadOperationsMatches = () => Promise.resolve(true);
  const actions = buildLoaderActions({ loadOperationsMatches });

  assert.deepEqual(getMatchListScope(localStore, MATCH_LIST_SCOPES.OPERATIONS), {
    ids: [],
    recruitingPostIds: [],
    status: MATCH_LIST_STATUSES.READY,
    error: "",
  });
  assert.equal(actions.loadOperationsMatches, loadOperationsMatches);
});

test("local demo operations refresh resolves as an empty successful load", async () => {
  const source = await readFile(new URL("../src/hooks/appData/orchestrator/matchLoaders.js", import.meta.url), "utf8");

  assert.match(
    source,
    /const loadOperationsMatches = useCallback[\s\S]*?if \(!isSupabaseConfigured\) return 0;[\s\S]*?if \(!authUserId\) return false;/,
  );
});

test("OperationsCenter consumes only its dedicated loader and scope", async () => {
  const source = await readFile(new URL("../src/pages/OperationsCenter.jsx", import.meta.url), "utf8");

  assert.match(source, /MATCH_LIST_SCOPES\.OPERATIONS/);
  assert.match(source, /loadOperationsMatches/);
  assert.doesNotMatch(source, /MATCH_LIST_SCOPES\.PERSONAL/);
  assert.doesNotMatch(source, /loadInitialPersonalMatches/);
});
