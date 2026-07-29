import assert from "node:assert/strict";
import test from "node:test";
import { getTournamentMatches } from "../src/lib/tournamentMatches.js";

test("대회 저장 ID와 후속 생성 경기를 중복 없이 라운드·경기 순서로 합친다", () => {
  const storedMatch = {
    id: "match-1",
    tournamentId: "tournament-1",
    tournamentRound: 1,
    tournamentFixture: 2,
    source: "stored",
  };
  const currentMatch = {
    ...storedMatch,
    source: "current",
  };
  const followupMatch = {
    id: "match-2",
    tournamentId: "tournament-1",
    tournamentRound: 2,
    tournamentFixture: 1,
  };
  const firstFixture = {
    id: "match-3",
    tournamentId: "tournament-1",
    tournamentRound: 1,
    tournamentFixture: 1,
  };

  const result = getTournamentMatches(
    { id: "tournament-1", matchIds: ["missing", "match-1"] },
    { "match-1": storedMatch },
    [
      followupMatch,
      currentMatch,
      { id: "other", tournamentId: "tournament-2" },
      firstFixture,
    ],
  );

  assert.deepEqual(result.map((match) => match.id), ["match-3", "match-1", "match-2"]);
  assert.equal(result[1].source, "current");
});

test("입력 배열과 객체를 변경하지 않는다", () => {
  const tournament = { id: "tournament-1", matchIds: ["match-1"] };
  const stored = {
    id: "match-1",
    tournamentId: "tournament-1",
    tournamentRound: 2,
    tournamentFixture: 1,
  };
  const linked = {
    id: "match-2",
    tournamentId: "tournament-1",
    tournamentRound: 1,
    tournamentFixture: 1,
  };
  const matches = [stored, linked];
  const before = [...matches];

  getTournamentMatches(tournament, { "match-1": stored }, matches);

  assert.deepEqual(matches, before);
  assert.deepEqual(tournament.matchIds, ["match-1"]);
});
