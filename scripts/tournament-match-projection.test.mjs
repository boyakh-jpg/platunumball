import assert from "node:assert/strict";
import test from "node:test";
import { getTournamentMatches } from "../src/lib/tournamentMatches.js";
import { formatTournamentError } from "../src/lib/tournamentErrors.js";

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

test("대회 결과는 실제 확정 후에만 순위와 후속 대진에 반영한다", async (t) => {
  const { createServer } = await import("vite");
  const vite = await createServer({
    configFile: false,
    appType: "custom",
    logLevel: "silent",
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, watch: null },
  });
  try {
    const model = await vite.ssrLoadModule("/src/pages/tournamentDetailModel.jsx");
    const teamById = Object.fromEntries(["a", "b", "c", "d"].map((id) => [id, { id, name: id.toUpperCase() }]));
    const teamRows = Object.values(teamById).map((team) => ({ team, teamId: team.id }));
    const firstRound = [
      { fixture: 1, teamAId: "a", teamBId: "b" },
      { fixture: 2, teamAId: "c", teamBId: "d" },
    ];
    const tournament = {
      bracket: {
        bracketSize: 4,
        firstRound,
        rounds: [{ pairings: firstRound.map((row) => ({ ...row, matchId: `semi-${row.fixture}` })) }],
      },
    };
    const makeMatch = (id, teamAId = "a", teamBId = "b") => ({
      id,
      status: "approval",
      endedAt: "2020-01-01T01:00:00.000Z",
      finalSubmittedAt: "2020-01-01T01:00:00.000Z",
      result: { scoreA: 22, scoreB: 10 },
      teamA: { teamId: teamAId, name: teamById[teamAId].name },
      teamB: { teamId: teamBId, name: teamById[teamBId].name },
    });

    await t.test("확인 기한이 지난 승인·이의 경기에도 승자와 승수를 미리 부여하지 않는다", () => {
      for (const status of ["approval", "disputed"]) {
        const match = { ...makeMatch("semi-1"), status };
        assert.equal(model.getMatchWinnerTeamId(match), "");
        assert.equal(model.getWinnerName(match), "");
        assert.equal(model.getLeagueMatchResult(match), null);
        assert.ok(model.getLeagueStandings(teamRows, [match]).every((row) => row.played === 0 && row.wins === 0 && row.pointsFor === 0));
        const fixtureState = model.getLeagueFixtureState(match);
        assert.equal(fixtureState.label, "결과 확인 중");
        assert.equal(fixtureState.actionLabel, "결과 확인");
        assert.equal(model.getBracketNodeStatus({ match }, teamById), "결과 확인 중");
      }
    });

    await t.test("점수나 이전 확정 시각만으로 진행·취소·무효 경기를 확정하지 않는다", () => {
      for (const status of ["agreed", "closed", "cancelled", "void"]) {
        const match = { ...makeMatch("semi-1"), status, confirmedAt: "2020-01-01T02:00:00.000Z", scoreA: 22, scoreB: 10 };
        assert.equal(model.getMatchWinnerTeamId(match), "");
        assert.equal(model.getLeagueMatchResult(match), null);
      }
    });

    await t.test("두 준결승 모두 확정된 뒤 결승 대진을 표시하고 결승 확정 전에는 우승자를 숨긴다", () => {
      const semiA = makeMatch("semi-1");
      const semiB = makeMatch("semi-2", "c", "d");
      const pendingTree = model.buildTournamentBracketTree(tournament, { "semi-1": semiA, "semi-2": semiB });
      const pendingFinal = pendingTree[1].nodes[0];
      assert.equal(pendingFinal.sourceA.teamId, null);
      assert.equal(pendingFinal.sourceB.teamId, null);
      assert.equal(model.getBracketNodeStatus(pendingFinal, teamById), "승자 결정 후 대진 확정");

      const confirmedMatches = {
        "semi-1": { ...semiA, status: "confirmed" },
        "semi-2": { ...semiB, status: "confirmed" },
      };
      const final = model.buildTournamentBracketTree(tournament, confirmedMatches)[1].nodes[0];
      assert.equal(final.sourceA.teamId, "a");
      assert.equal(final.sourceB.teamId, "c");
      assert.equal(model.getBracketNodeStatus(final, teamById), "대진 확정 · 경기 생성 대기");
      assert.equal(model.getNodeWinnerTeamId(final), "");
      const standings = model.getLeagueStandings(teamRows, Object.values(confirmedMatches));
      assert.equal(standings.find((row) => row.teamId === "a").wins, 1);
      assert.equal(standings.find((row) => row.teamId === "b").losses, 1);

      const finalTournament = { bracket: { ...tournament.bracket, rounds: [...tournament.bracket.rounds, { pairings: [{ fixture: 1, matchId: "final" }] }] } };
      const finalMatch = makeMatch("final", "a", "c");
      assert.equal(model.getNodeWinnerTeamId(model.buildTournamentBracketTree(finalTournament, { ...confirmedMatches, final: finalMatch })[1].nodes[0]), "");
      assert.equal(model.getNodeWinnerTeamId(model.buildTournamentBracketTree(finalTournament, { ...confirmedMatches, final: { ...finalMatch, status: "confirmed" } })[1].nodes[0]), "a");
    });

    await t.test("확정된 몰수승과 부전승은 계속 진출에 반영한다", () => {
      const forfeit = { ...makeMatch("semi-1"), status: "confirmed", result: null, rules: { forfeit: { losingSide: "teamB" } } };
      assert.equal(model.getMatchWinnerTeamId(forfeit), "a");
      assert.deepEqual(model.getLeagueMatchResult(forfeit), { teamAId: "a", teamBId: "b", scoreA: 1, scoreB: 0 });
      assert.equal(model.getMatchWinnerTeamId({ ...forfeit, status: "approval" }), "");
      const byeTournament = { bracket: { bracketSize: 2, firstRound: [{ fixture: 1, teamAId: "a", teamBId: null, byeTeamId: "a" }] } };
      assert.equal(model.getNodeWinnerTeamId(model.buildTournamentBracketTree(byeTournament, {})[0].nodes[0]), "a");
    });
  } finally {
    await vite.close();
  }
});

test("일정과 심판 작업은 같은 오류 원인과 다음 행동을 안내한다", () => {
  const scheduleFallback = "일정 저장 실패";
  const refereeFallback = "심판 작업 실패";
  for (const [code, action] of [
    ["tournament_referee_required", /심판을 배정한 뒤 일정을 저장/],
    ["tournament_referee_not_neutral", /중립 심판으로 변경/],
    ["tournament_referee_schedule_conflict", /경기 시간을 바꾸거나 다른 중립 심판을 배정/],
  ]) {
    const scheduleMessage = formatTournamentError(`RPC error: ${code}`, scheduleFallback);
    assert.match(scheduleMessage, action);
    assert.equal(scheduleMessage, formatTournamentError(code, refereeFallback));
  }
  assert.match(formatTournamentError("tournament_schedule_lineup_submitted"), /출전 명단을 제출한 뒤/);
  assert.match(formatTournamentError("tournament_schedule_revision_limit"), /한 번만 변경/);
  assert.equal(formatTournamentError("network_error", scheduleFallback), scheduleFallback);
  assert.equal(formatTournamentError("network_error", refereeFallback), refereeFallback);
});
