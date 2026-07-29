import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  getTournamentTeamIds,
  getTournamentTeamStatus,
} from "../src/data/tournamentMappers.js";

test("대회 팀 ID와 상태는 명시 목록·상태 snapshot을 함께 사용한다", () => {
  const tournament = {
    teamIds: ["team-a", "team-b", "team-a"],
    teamStatuses: {
      "team-b": "accepted",
      "team-c": "declined",
    },
  };

  assert.deepEqual(getTournamentTeamIds(tournament), ["team-a", "team-b", "team-c"]);
  assert.equal(getTournamentTeamStatus(tournament, "team-a"), "invited");
  assert.equal(getTournamentTeamStatus(tournament, "team-b"), "accepted");
  assert.equal(getTournamentTeamStatus(tournament, "missing"), "invited");
});

test("대회 목록과 상세는 공용 팀 projection을 사용한다", async () => {
  const [matchesSource, detailSource] = await Promise.all([
    readFile(new URL("../src/pages/Matches.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/TournamentDetail.jsx", import.meta.url), "utf8"),
  ]);

  assert.match(matchesSource, /getTournamentTeamIds, getTournamentTeamStatus/);
  assert.match(detailSource, /getTournamentTeamStatus/);
  assert.doesNotMatch(matchesSource, /function getTournamentTeamStatus\s*\(/);
  assert.doesNotMatch(detailSource, /function getTournamentTeamStatus\s*\(/);
});
