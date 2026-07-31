import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MATCHES_PAGE_SOURCE_PATHS,
  TOURNAMENT_DETAIL_SOURCE_PATHS,
  readSourceGroup,
} from "./management-source-groups.mjs";
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
    readSourceGroup((file) => readFile(new URL(`../${file}`, import.meta.url), "utf8"), MATCHES_PAGE_SOURCE_PATHS),
    readSourceGroup((file) => readFile(new URL(`../${file}`, import.meta.url), "utf8"), TOURNAMENT_DETAIL_SOURCE_PATHS),
  ]);

  assert.match(matchesSource, /getTournamentTeamIds, getTournamentTeamStatus/);
  assert.match(detailSource, /getTournamentTeamIds, getTournamentTeamStatus/);
  assert.match(detailSource, /const tournamentTeamIds = getTournamentTeamIds\(tournament\)/);
  assert.doesNotMatch(matchesSource, /function getTournamentTeamStatus\s*\(/);
  assert.doesNotMatch(detailSource, /function getTournamentTeamStatus\s*\(/);
});

test("대회 상세 심판 검색은 중복 초대를 숨기고 실패 시 검색어를 유지한다", async () => {
  const detailSource = await readSourceGroup(
    (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8"),
    TOURNAMENT_DETAIL_SOURCE_PATHS,
  );

  assert.match(detailSource, /mapRemoteItem=\{\(referee\) => \(tournament\.refereeIds \?\? \[\]\)\.includes\(referee\.id\) \? null : referee\}/);
  assert.match(detailSource, /const invited = await runGovernanceAction\(/);
  assert.match(detailSource, /if \(invited\) setRefereeQuery\(""\)/);
  assert.doesNotMatch(detailSource, /\)\.then\(\(\) => setRefereeQuery\(""\)\)/);
});
