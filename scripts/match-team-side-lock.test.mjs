import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { isMatchPartyTeamParty, isMatchSideTeamParty } from "../shared/lib/matchRoster.js";

const migrationPath = new URL("../supabase/migrations/20260806220000_match_team_side_lock_alignment.sql", import.meta.url);
const serverActionPath = new URL("../server/lib/matchSqlActions.js", import.meta.url);

test("팀 사이드 잠금은 실제 참가자가 2명 이상인 팀 파티에만 적용한다", async () => {
  assert.equal(isMatchSideTeamParty({ teamA: { teamId: "team-1", players: ["p1"] } }, "teamA"), false);
  assert.equal(isMatchSideTeamParty({ teamA: { teamId: "team-1", players: ["p1", "p2"] } }, "teamA"), true);
  assert.equal(isMatchPartyTeamParty({ teamId: "team-1", players: ["p1"], reserves: [] }), false);
  assert.equal(isMatchPartyTeamParty({ teamId: "team-1", players: ["p1"], reserves: ["p2"] }), true);

  const [migration, serverAction] = await Promise.all([
    readFile(migrationPath, "utf8"),
    readFile(serverActionPath, "utf8"),
  ]);
  assert.match(migration, /create or replace function public\.rankball_match_room_action_pre_side_mmr_balance/);
  assert.match(migration, /team_party_locked/);
  assert.match(migration, />= 2/);
  assert.doesNotMatch(migration, /current_team_id is not null/);
  assert.doesNotMatch(serverAction, /assertMatchTeamPlacementSide/);
});
