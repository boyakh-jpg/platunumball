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

test("대회 진행 상태는 확정 여부와 현재 역할에 맞게 안내한다", async (t) => {
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

    const nextActionBase = {
      tournament: { id: "t", format: "league", status: "active" },
      governanceEnabled: false,
      canManageSchedule: true,
    };
    const unscheduledMatch = { id: "unscheduled", tournamentId: "t", status: "agreed" };

    await t.test("팀장과 심판은 다른 준비 항목보다 자신의 승인 요청을 먼저 확인한다", () => {
      const pending = { ...nextActionBase, tournament: { ...nextActionBase.tournament, status: "draft" }, hasPendingTeamApprovals: true, governanceEnabled: true, requiredRefereeCount: 2 };
      const captain = model.getTournamentNextAction({ ...pending, teamRows: [{ team: teamById.a, canApprove: true }] });
      assert.equal(captain.target, model.tournamentDetailSections.teams);
      assert.match(captain.title, /A 참가를 승인/);
      const representative = model.getTournamentNextAction({ ...pending, teamRows: [{ team: teamById.a, needsRepresentativeTeam: true }] });
      assert.match(representative.title, /대표팀 설정/);
      const referee = model.getTournamentNextAction({ ...pending, refereeRows: [{ canApprove: true }] });
      assert.equal(referee.target, model.tournamentDetailSections.referees);
      assert.match(referee.title, /초대에 응답/);
      assert.equal(model.getTournamentNextAction(pending).target, model.tournamentDetailSections.teams);
    });

    await t.test("필수 승인·심판 자격·중립 조건을 충족한 뒤 개최 방식을 안내한다", () => {
      const users = ["ref-a", "ref-b"].map((id) => ({ id, trustScore: 95 }));
      const refereeAppointments = users.map((user) => ({ userId: user.id, role: "referee", grade: "candidate", status: "active", startsAt: "2020-01-01T00:00:00.000Z", endsAt: "2099-12-31T23:59:59.000Z" }));
      const ready = {
        ...nextActionBase,
        tournament: { ...nextActionBase.tournament, status: "draft", endDate: "2099-01-01", teamIds: ["a", "b"], refereeIds: users.map((user) => user.id), refereeStatuses: { "ref-a": "accepted", "ref-b": "accepted" } },
        app: { state: { teams: [{ id: "a", members: [] }, { id: "b", members: [] }], users, settings: { refereeAppointments } } },
        governanceEnabled: true,
        requiredRefereeCount: 2,
        acceptedRefereeIds: users.map((user) => user.id),
        canStartCommunity: true,
      };
      const missingReferee = model.getTournamentNextAction({ ...ready, acceptedRefereeIds: ["ref-a"] });
      assert.equal(missingReferee.target, model.tournamentDetailSections.referees);
      assert.match(missingReferee.title, /1명의 승인/);
      const ineligible = model.getTournamentNextAction({ ...ready, app: { state: { ...ready.app.state, settings: { refereeAppointments: [] } } } });
      assert.equal(ineligible.target, model.tournamentDetailSections.referees);
      assert.match(ineligible.description, /자격/);
      const nonneutral = model.getTournamentNextAction({ ...ready, app: { state: { ...ready.app.state, teams: [{ id: "a", members: users.map((user) => ({ userId: user.id })) }, { id: "b", members: [] }] } } });
      assert.equal(nonneutral.target, model.tournamentDetailSections.referees);
      assert.match(nonneutral.description, /중립 심판/);
      assert.equal(model.getTournamentNextAction(ready).target, model.tournamentDetailSections.sanction);
      assert.match(model.getTournamentNextAction(ready).title, /개최 방식을 선택/);
      assert.match(model.getTournamentNextAction({ ...ready, canStartCommunity: false }).title, /개최 승인을 기다리고/);
    });

    await t.test("미배정 심판부터 안내하고 주최자만 첫 미정 일정의 편집을 연다", () => {
      const active = { ...nextActionBase, tournamentMatches: [unscheduledMatch] };
      assert.equal(model.getTournamentNextAction({ ...active, governanceEnabled: true }).target, model.tournamentDetailSections.matchReferees);
      const ownerAction = model.getTournamentNextAction(active);
      assert.equal(ownerAction.scheduleMatchId, unscheduledMatch.id);
      assert.equal(ownerAction.target, model.tournamentDetailSections.competition);
      const viewerAction = model.getTournamentNextAction({ ...active, canManageSchedule: false });
      assert.equal(viewerAction.scheduleMatchId, "");
      assert.equal(viewerAction.actionLabel, "경기 일정 보기");
      assert.equal(model.getTournamentNextAction({ ...active, tournament: { ...active.tournament, format: "tournament" } }).target, model.tournamentDetailSections.schedule);
    });

    await t.test("명단 제출·경기 시작으로 잠긴 일정은 편집으로 안내하지 않고 미확정 결과를 연결한다", () => {
      const locked = [
        { ...unscheduledMatch, id: "lineup", rules: { rosterReady: { teamA: true } } },
        { ...unscheduledMatch, id: "started", startedAt: "2020-01-01T00:00:00.000Z" },
        { ...makeMatch("pending"), tournamentId: "t", status: "disputed" },
      ];
      const action = model.getTournamentNextAction({ ...nextActionBase, tournamentMatches: locked });
      assert.equal(action.matchId, "pending");
      assert.equal(action.scheduleMatchId, undefined);
      assert.match(action.title, /결과 확인 중 1경기/);
      const closed = model.getTournamentNextAction({ ...nextActionBase, tournament: { ...nextActionBase.tournament, status: "closed" }, tournamentMatches: locked });
      assert.equal(closed.matchId, undefined);
      assert.match(closed.title, /종료/);
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
