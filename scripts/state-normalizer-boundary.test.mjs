import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { afterEach } from "node:test";
import { fileURLToPath } from "node:url";

import {
  hasDemoInitialState,
  normalizeState,
  setDemoInitialState,
} from "../src/data/stateNormalizer.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readSource = (relativePath) => fs.readFileSync(path.join(rootDir, relativePath), "utf8");

afterEach(() => {
  setDemoInitialState(null);
});

test("normalizeState keeps demo merge, deletion, block, and default notification semantics", () => {
  setDemoInitialState({
    currentUserId: "viewer",
    users: [{ id: "demo-user", name: "demo", ratings: {} }],
    teams: [
      { id: "deleted-team", members: [] },
      { id: "demo-team", members: [] },
    ],
    teamInvitations: [],
    affiliations: [],
    seasons: [],
    matches: [],
    tournaments: [],
    notifications: [{ id: "demo-notice", targetUserId: "viewer" }],
    reports: [],
    recruitingPosts: [],
    discordNotificationDeliveries: [],
    discordNotificationSeenKeys: [],
    discordNotificationSeenUsers: [],
    settings: {
      blockedUserIds: [],
      favoriteTeamIds: ["demo-team"],
    },
  });

  const state = normalizeState({
    currentUserId: "viewer",
    deletedTeamIds: ["deleted-team"],
    users: [{ id: "viewer", name: "viewer", ratings: {} }],
    teamInvitations: [
      { id: "blocked-team-invite", targetUserId: "viewer", fromUserId: "blocked-user" },
      { id: "visible-team-invite", targetUserId: "viewer", fromUserId: "allowed-user" },
    ],
    recruitingPosts: [{
      id: "closed-room",
      status: "closed",
      roomState: {
        invitations: [
          { id: "blocked-room-invite", targetUserId: "viewer", fromUserId: "blocked-user" },
          { id: "visible-room-invite", targetUserId: "viewer", fromUserId: "allowed-user" },
        ],
      },
    }],
    notifications: [
      { id: "blocked-notice", targetUserId: "viewer", fromUserId: "blocked-user" },
      { id: "visible-notice", targetUserId: "viewer", fromUserId: "allowed-user" },
    ],
    settings: {
      blockedUserIds: ["blocked-user"],
    },
  });

  assert.equal(hasDemoInitialState(), true);
  assert.deepEqual(state.users.map(({ id }) => id), ["demo-user", "viewer"]);
  assert.deepEqual(state.teams.map(({ id }) => id), ["demo-team"]);
  assert.deepEqual(state.teamInvitations.map(({ id }) => id), ["visible-team-invite"]);
  assert.deepEqual(
    state.recruitingPosts[0].roomState.invitations.map(({ id }) => id),
    ["visible-room-invite"],
  );
  assert.deepEqual(state.notifications, [{
    id: "visible-notice",
    targetUserId: "viewer",
    fromUserId: "allowed-user",
    readAt: null,
  }]);
  assert.deepEqual(state.settings.favoriteTeamIds, ["demo-team"]);
});

test("includeDemo false excludes demo state and preserves authoritative match lifecycle by default", () => {
  setDemoInitialState({
    currentUserId: "demo-user",
    users: [{ id: "demo-user", ratings: {} }],
    teams: [],
    matches: [],
    recruitingPosts: [],
    notifications: [],
    settings: { favoriteTeamIds: ["demo-team"] },
  });
  const match = {
    id: "future-result",
    status: "approval",
    scheduledDate: "2099-01-01",
    scheduledTime: "12:00",
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T01:00:00.000Z",
    result: { scoreA: 1, scoreB: 0 },
    teamA: { players: ["a"], score: 1 },
    teamB: { players: ["b"], score: 0 },
  };

  const authoritative = normalizeState({ matches: [match] }, { includeDemo: false });
  assert.equal(authoritative.currentUserId, "");
  assert.deepEqual(authoritative.users, []);
  assert.deepEqual(authoritative.settings.favoriteTeamIds, []);
  assert.equal(authoritative.matches[0].status, "approval");
  assert.equal(authoritative.matches[0].startedAt, match.startedAt);
  assert.deepEqual(authoritative.matches[0].result, match.result);

  const repaired = normalizeState(
    { matches: [match] },
    { includeDemo: false, preserveAuthoritativeMatches: false },
  );
  assert.equal(repaired.matches[0].status, "agreed");
  assert.equal(repaired.matches[0].startedAt, null);
  assert.equal(repaired.matches[0].result, null);
});

test("server read APIs import the shared state normalizer without loading repository mutations", async () => {
  const serverFiles = [
    "server/api/profile/me.js",
    "server/api/directory/load.js",
    "server/api/records/list.js",
    "server/api/matches/_listLoader.js",
    "server/api/recruiting/_listLoader.js",
    "server/api/teams/list.js",
  ];

  for (const relativePath of serverFiles) {
    const source = readSource(relativePath);
    assert.match(source, /shared\/lib\/stateNormalizer\.js/);
    assert.doesNotMatch(source, /src\/data\/repository\.js/);
  }

  const clientShim = readSource("src/data/stateNormalizer.js");
  assert.equal(clientShim.trim(), 'export * from "../../shared/lib/stateNormalizer.js";');
  const repositorySource = readSource("src/data/repository.js");
  assert.match(repositorySource, /from "\.\/stateNormalizer\.js"/);
  assert.match(repositorySource, /export \{[\s\S]*normalizeState,[\s\S]*\} from "\.\/stateNormalizer\.js"/);
  assert.doesNotMatch(repositorySource, /export function normalizeState\(/);

  const repository = await import("../src/data/repository.js");
  assert.equal(repository.normalizeState, normalizeState);
  assert.equal(repository.setDemoInitialState, setDemoInitialState);
});
