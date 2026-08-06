import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import * as clientHandles from "../src/lib/handles.js";
import * as clientMatchLifecycle from "../src/data/matchLifecycleUtils.js";
import * as clientMatchMappers from "../src/data/matchMappers.js";
import * as clientProfileMappers from "../src/data/profileMappers.js";
import * as clientRecruitingMappers from "../src/data/recruitingMappers.js";
import * as clientRowUtils from "../src/data/rowUtils.js";
import * as clientScheduleUtils from "../src/data/scheduleUtils.js";
import * as clientStateMappers from "../src/data/stateMappers.js";
import * as clientStateNormalizer from "../src/data/stateNormalizer.js";
import * as clientTeamMappers from "../src/data/teamMappers.js";
import * as clientTournamentMappers from "../src/data/tournamentMappers.js";
import * as sharedHandles from "../shared/lib/handles.js";
import * as sharedMatchLifecycle from "../shared/lib/matchLifecycleUtils.js";
import * as sharedMatchMappers from "../shared/lib/matchMappers.js";
import * as sharedProfileMappers from "../shared/lib/profileMappers.js";
import * as sharedRecruitingMappers from "../shared/lib/recruitingMappers.js";
import * as sharedRowUtils from "../shared/lib/rowUtils.js";
import * as sharedScheduleUtils from "../shared/lib/scheduleUtils.js";
import * as sharedStateMappers from "../shared/lib/stateMappers.js";
import * as sharedStateNormalizer from "../shared/lib/stateNormalizer.js";
import * as sharedTeamMappers from "../shared/lib/teamMappers.js";
import * as sharedTournamentMappers from "../shared/lib/tournamentMappers.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function listJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return listJavaScriptFiles(target);
    return entry.isFile() && /\.(?:js|mjs|jsx)$/.test(entry.name) ? [target] : [];
  }));
  return nested.flat();
}

function assertSameExports(clientModule, sharedModule) {
  assert.deepEqual(Object.keys(clientModule).sort(), Object.keys(sharedModule).sort());
  for (const exportName of Object.keys(sharedModule)) {
    assert.strictEqual(clientModule[exportName], sharedModule[exportName], exportName);
  }
}

test("client mapper compatibility modules preserve shared canonical export identity", () => {
  for (const [clientModule, sharedModule] of [
    [clientHandles, sharedHandles],
    [clientMatchLifecycle, sharedMatchLifecycle],
    [clientMatchMappers, sharedMatchMappers],
    [clientProfileMappers, sharedProfileMappers],
    [clientRecruitingMappers, sharedRecruitingMappers],
    [clientRowUtils, sharedRowUtils],
    [clientScheduleUtils, sharedScheduleUtils],
    [clientStateMappers, sharedStateMappers],
    [clientStateNormalizer, sharedStateNormalizer],
    [clientTournamentMappers, sharedTournamentMappers],
  ]) {
    assertSameExports(clientModule, sharedModule);
  }
  assert.strictEqual(clientTeamMappers.fromRemoteTeam, sharedTeamMappers.fromRemoteTeam);
  assert.strictEqual(clientTeamMappers.fromRemoteTeamInvitation, sharedTeamMappers.fromRemoteTeamInvitation);
});

test("shared mapper behavior fixtures preserve profile, team, match, tournament, and state projections", () => {
  const profile = sharedProfileMappers.fromRemoteProfile({
    id: "profile-1",
    name: "선수",
    hashtag: "Player_1",
    ratings: { integrated: 1234, modes: { "3v3": 1200 } },
    avatar_background_enabled: false,
    founding_player: true,
  });
  assert.equal(profile.hashtag, "#player_1");
  assert.equal(profile.handle, "#player_1");
  assert.equal(profile.ratings.integrated, 1234);
  assert.equal(profile.avatarBackgroundEnabled, false);
  assert.equal(profile.foundingPlayer, true);
  assert.equal(sharedProfileMappers.createProfileShell("", "").name, "신규 선수");
  assert.equal(sharedProfileMappers.createProfileShell("", "player@example.com").name, "player");

  const team = sharedTeamMappers.fromRemoteTeam({
    id: "team-1",
    name: "팀",
    mmr: 1210,
  }, [
    { user_id: "regular", role: "regular" },
    { user_id: "captain", role: "captain" },
  ]);
  assert.equal(team.rosterMmr, 1210);
  assert.deepEqual(team.members, [
    { userId: "captain", role: "captain" },
    { userId: "regular", role: "regular" },
  ]);

  assert.deepEqual(
    sharedMatchMappers.getRemoteMatchActivePlayerIds({
      reserve_players: { teamA: ["reserve"] },
    }, "teamA", [
      { side: "teamA", user_id: "reserve", slot_order: 0 },
      { side: "teamA", user_id: "active", slot_order: 1 },
    ]),
    ["active"],
  );
  assert.deepEqual(
    sharedMatchMappers.getReadableMatchStatRows(
      { referee_id: "referee" },
      [
        { user_id: "verified", record_source: "referee" },
        { user_id: "unverified", record_source: "player" },
      ],
    ),
    [{ user_id: "verified", record_source: "referee" }],
  );

  const tournament = sharedTournamentMappers.fromRemoteTournament({
    id: "tournament-1",
    court_id: "court-1",
    team_statuses: { "team-1": "accepted" },
  }, {
    courtById: { "court-1": { name: "구장" } },
    tournamentTeamsByTournament: new Map([[
      "tournament-1",
      [{ team_id: "team-1", seed_order: 1, status: "invited" }],
    ]]),
  });
  assert.equal(tournament.court, "구장");
  assert.deepEqual(tournament.teamIds, ["team-1"]);
  assert.equal(tournament.teamStatuses["team-1"], "accepted");

  const state = sharedStateNormalizer.normalizeState({
    users: [{ id: "profile-1", ratings: { integrated: 1234 } }],
    teams: [{ id: "team-1", members: [{ userId: "profile-1" }] }],
  }, { includeDemo: false });
  assert.equal(state.users[0].ratings.integrated, 1234);
  assert.equal(state.teams[0].members[0].role, "regular");
  assert.deepEqual(state.recruitingPosts, []);
});

test("server mapper consumers do not reach through client data modules", async () => {
  const serverFiles = await listJavaScriptFiles(path.join(ROOT, "server"));
  const sources = await Promise.all(serverFiles.map(async (file) => ({
    file,
    source: await readFile(file, "utf8"),
  })));
  const forbidden = /src\/data\/(?:profileMappers|matchMappers|recruitingMappers|teamMappers|tournamentMappers|stateNormalizer)\.js/;
  for (const { file, source } of sources) {
    assert.doesNotMatch(source.replaceAll("\\", "/"), forbidden, path.relative(ROOT, file));
  }
  for (const moduleName of [
    "profileMappers",
    "matchMappers",
    "recruitingMappers",
    "teamMappers",
    "tournamentMappers",
    "stateNormalizer",
  ]) {
    assert.ok(
      sources.some(({ source }) => source.includes(`shared/lib/${moduleName}.js`)),
      moduleName,
    );
  }
});
