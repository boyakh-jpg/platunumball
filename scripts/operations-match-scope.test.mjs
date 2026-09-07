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
import { useMatchLoaders } from "../src/hooks/appData/orchestrator/matchLoaders.js";

function createQueryClient(rows = []) {
  const calls = [];
  const createQuery = () => ({
    rows: [...rows],
    select(...args) { calls.push(["select", ...args]); return this; },
    or(expression) {
      calls.push(["or", expression]);
      this.rows = this.rows.filter((row) => expression.split(",").some((condition) => {
        const [column, , value] = condition.split(".");
        return row[column] === value;
      }));
      return this;
    },
    neq(column, value) { calls.push(["neq", column, value]); this.rows = this.rows.filter((row) => row[column] !== value); return this; },
    in(column, values) { this.rows = this.rows.filter((row) => values.includes(row[column])); return this; },
    not(column, operator, value) {
      assert.equal(operator, "in");
      const values = value.slice(1, -1).split(",");
      this.rows = this.rows.filter((row) => !values.includes(row[column]));
      return this;
    },
    order(column, options) {
      calls.push(["order", column, options]);
      return this;
    },
    range(from, to) {
      calls.push(["range", from, to]);
      this.rows.sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")) || b.id.localeCompare(a.id));
      this.rows = this.rows.slice(from, to + 1);
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve({ data: this.rows, error: null }).then(resolve, reject);
    },
  });
  return {
    calls,
    client: {
      from(table) {
        calls.push(["from", table]);
        return createQuery();
      },
    },
  };
}

test("operations query is role-bound, closed-free, and capped", async () => {
  const rows = [{ id: "match-1", created_by: "operator-1", status: "open" }];
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
  assert.deepEqual(calls.find(([method]) => method === "range"), [
    "range",
    0,
    MATCH_RELATED_FALLBACK_MAX_LIMIT - 1,
  ]);
});

test("old unresolved work precedes recent completed history and every page remains reachable", async () => {
  const rows = [
    ...Array.from({ length: 101 }, (_, index) => ({
      id: `completed-${index}`, created_by: "operator-1", status: "confirmed", updated_at: "2026-09-07",
    })),
    ...Array.from({ length: 51 }, (_, index) => ({
      id: `pending-${index}`, referee_id: "operator-1", status: "approval", updated_at: "2026-01-01",
    })),
    { id: "closed", created_by: "operator-1", status: "closed" },
    { id: "unrelated", created_by: "other", status: "open" },
  ];
  const { client } = createQueryClient(rows);
  const first = await fetchOperationsMatchPage(client, "operator-1", 50);
  assert.equal(first.rows.length, 50);
  assert.ok(first.rows.every((row) => row.status === "approval"));
  assert.equal(first.cursor, "operations:active:50");
  const second = await fetchOperationsMatchPage(client, "operator-1", 50, first.cursor);
  assert.equal(second.rows[0].status, "approval");
  assert.equal(second.cursor, "operations:past:49");
  const third = await fetchOperationsMatchPage(client, "operator-1", 50, second.cursor);
  const last = await fetchOperationsMatchPage(client, "operator-1", 50, third.cursor);
  assert.equal(last.exhausted, true);
  assert.equal(last.cursor, "");
  const ids = [first, second, third, last].flatMap((page) => page.rows.map((row) => row.id));
  assert.equal(ids.length, 152);
  assert.equal(new Set(ids).size, 152);
  assert.ok(!ids.includes("closed") && !ids.includes("unrelated"));
  assert.deepEqual(await fetchOperationsMatchPage(client, "operator-1", 50, "operations:past:1,or"), first);
});

test("operations loader appends pages, retains failed-page cursor, and resets on refresh", async () => {
  let store = createMatchListStore();
  const requests = [];
  const responses = [
    { state: { matches: [{ id: "pending" }] }, page: { cursor: "operations:past:49" } },
    new Error("page_failed"),
    { state: { matches: [{ id: "past" }] }, page: { cursor: "" } },
    { state: { matches: [{ id: "new" }] }, page: { cursor: "" } },
  ];
  const context = {
    MATCH_LIST_SCOPES, MATCH_LIST_STATUSES, REMOTE_CLIENT_MATCH_LIMIT: 50,
    isSupabaseConfigured: true, authUserId: "operator-1", authEmail: "",
    matchPagination: {}, state: {}, operationsMatchesPromiseRef: { current: null },
    pendingMatchIdsRef: { current: new Set() }, pendingRecruitingPostIdsRef: { current: new Set() },
    recentMatchMutationTimesRef: { current: new Map() }, recentRecruitingMutationTimesRef: { current: new Map() },
    roomMutationVersionRef: { current: 0 },
    useCallback: (fn) => fn,
    normalizeServerState: (state) => state,
    filterPendingMatches: (state) => state,
    filterPendingRecruitingPosts: (state) => state,
    getStateMatchIds: (state) => (state.matches ?? []).map(({ id }) => id),
    getStateRecruitingPostIds: () => [],
    setState: () => {},
    setMatchLists: (update) => { store = update(store); },
    updateMatchListScope,
    trackedPostServerAction: async (path, body) => {
      requests.push(body);
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response;
    },
  };
  const { loadOperationsMatches } = useMatchLoaders(context);
  assert.equal(await loadOperationsMatches(), 1);
  assert.equal(store.operations.cursor, "operations:past:49");
  assert.equal(await loadOperationsMatches({ cursor: store.operations.cursor }), false);
  assert.deepEqual(store.operations.ids, ["pending"]);
  assert.equal(store.operations.cursor, "operations:past:49");
  assert.equal(await loadOperationsMatches({ cursor: store.operations.cursor }), 1);
  assert.deepEqual(new Set(store.operations.ids), new Set(["pending", "past"]));
  assert.equal(store.operations.cursor, "");
  assert.equal(await loadOperationsMatches({ force: true }), 1);
  assert.deepEqual(store.operations.ids, ["new"]);
  assert.deepEqual(requests.map(({ cursor }) => cursor), ["", "operations:past:49", "operations:past:49", ""]);
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
