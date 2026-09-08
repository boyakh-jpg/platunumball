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
import { getTournamentListStatus } from "../src/pages/matchesPageBaseSelectors.js";

test("대회 목록은 팀 승인 완료 후 남은 필수 심판 승인을 안내한다", () => {
  const tournament = {
    status: "draft",
    teamIds: ["team-a", "team-b"],
    teamStatuses: { "team-a": "accepted", "team-b": "accepted" },
    refereeIds: ["ref-a", "ref-b"],
    refereeStatuses: { "ref-a": "accepted", "ref-b": "invited" },
    rules: { governanceVersion: 2 },
  };
  assert.deepEqual(getTournamentListStatus(tournament), {
    label: "심판 승인 대기",
    tone: "gold",
    teamApprovalLabel: "팀 2/2 승인",
    refereeApprovalLabel: "심판 1/2명 승인",
    approvalLabel: "심판 승인 대기",
    approvalTone: "gold",
  });
  const approved = getTournamentListStatus({
    ...tournament,
    refereeStatuses: { "ref-a": "accepted", "ref-b": "accepted" },
  });
  assert.equal(approved.label, "참가 승인 완료");
  assert.equal(approved.approvalTone, "green");
});

test("대회 목록 승인 수는 팀 snapshot을 포함하고 거절한 팀을 제외한다", () => {
  const status = getTournamentListStatus({
    teamIds: ["team-a", "team-b"],
    teamStatuses: { "team-a": "accepted", "team-b": "declined", "team-c": "invited" },
    rules: { governanceVersion: 2 },
  });
  assert.equal(status.label, "팀 승인 대기");
  assert.equal(status.teamApprovalLabel, "팀 1/2 승인");
  assert.equal(status.refereeApprovalLabel, "심판 0/2명 승인");
});

test("대회 목록은 기존 대회에 심판 승인을 요구하지 않고 빈 참가를 완료로 표시하지 않는다", () => {
  const legacy = getTournamentListStatus({
    status: "active",
    teamIds: ["team-a", "team-b"],
    teamStatuses: { "team-a": "accepted", "team-b": "accepted" },
  });
  assert.equal(legacy.label, "진행 중");
  assert.equal(legacy.tone, "green");
  assert.equal(legacy.approvalLabel, "참가 승인 완료");
  assert.equal(legacy.refereeApprovalLabel, "");
  const empty = getTournamentListStatus();
  assert.equal(empty.label, "참가팀 확인 필요");
  assert.equal(empty.approvalTone, "gold");
  assert.equal(getTournamentListStatus({ status: "closed" }).label, "종료");
  assert.equal(getTournamentListStatus({ status: "unexpected_status" }).label, "상태 확인 중");
});

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

test("대회 팀 승인은 공용 governance 처리와 중복 실행 잠금을 사용한다", async () => {
  const detailSource = await readSourceGroup(
    (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8"),
    TOURNAMENT_DETAIL_SOURCE_PATHS,
  );

  assert.match(detailSource, /`approve-team:\$\{row\.teamId\}`/);
  assert.match(detailSource, /\(\) => app\.actions\.approveTournamentTeam\(tournament\.id, row\.teamId\)/);
  assert.match(detailSource, /disabled=\{Boolean\(governanceAction\)\}/);
});

test("대회 governance 성공은 후속 재조회 실패와 분리한다", async () => {
  const detailSource = await readSourceGroup(
    (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8"),
    TOURNAMENT_DETAIL_SOURCE_PATHS,
  );

  assert.match(detailSource, /setGovernanceFeedback\(successMessage\);\s*Promise\.resolve\(\)\s*\.then\(\(\) => app\.actions\.loadTournament\?\.\(tournament\.id\)\)\s*\.catch\(\(\) => false\);\s*return true;/);
  assert.doesNotMatch(detailSource, /await app\.actions\.loadTournament\?\.\(tournament\.id\)/);
});

test("대회 상세 조회는 미존재와 일시 오류를 분리한다", async () => {
  const [detailSource, matchActionsSource, serverActionsSource] = await Promise.all([
    readFile(new URL("../src/pages/TournamentDetail.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/appData/actions/matchActions.js", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/appData/orchestrator/serverActions.js", import.meta.url), "utf8"),
  ]);

  assert.match(matchActionsSource, /result\.error === "tournament_not_found" \|\| Number\(result\.statusCode\) === 404/);
  assert.match(matchActionsSource, /throw error;/);
  assert.match(serverActionsSource, /operation\?\.action === "loadTournament"[\s\S]*quietError: "tournament_not_found"/);
  assert.match(detailSource, /setTournamentLoadStatus\("missing"\)/);
  assert.match(detailSource, /setTournamentLoadStatus\("error"\)/);
  assert.match(detailSource, /대회를 불러오지 못했습니다/);
  assert.match(detailSource, /삭제되었거나 존재하지 않는 대회입니다/);
  assert.doesNotMatch(detailSource, /삭제되었거나 아직 불러오지 못한 대회입니다/);
});
