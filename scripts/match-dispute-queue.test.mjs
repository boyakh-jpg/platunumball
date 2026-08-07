import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  approveMatch,
  disputeMatch,
  finalizeMatchByAuthority,
  resolveMatchDispute,
  runAutomaticStateMaintenance,
} from "../src/data/repository.js";
import {
  DISPUTE_WINDOW_MINUTES,
  DISPUTE_WINDOW_OPTIONS,
  normalizeDisputeWindowMinutes,
} from "../src/lib/constants.js";
import {
  buildMatchDisputeRequest,
  canUserResolveMatchDispute,
  getMatchRecordPlayerIds,
  getMatchRoomPhase,
  getOpenMatchDisputes,
} from "../src/lib/matchUtils.js";
import { getDefaultMatchRules, normalizeMatchRules } from "../src/lib/matchRules.js";

const root = new URL("../", import.meta.url);
const readSource = (path) => readFile(new URL(path, root), "utf8");

function makeState(currentUserId = "host") {
  const endedAt = new Date(Date.now() - 4 * 60_000).toISOString();
  return {
    currentUserId,
    users: [
      { id: "host", name: "방장", trustScore: 100, streak: 0, ratings: { integrated: 1200, modes: { "1v1": 1200 } } },
      { id: "guest", name: "참가자", trustScore: 100, streak: 0, ratings: { integrated: 1200, modes: { "1v1": 1200 } } },
      { id: "reserve", name: "후보", trustScore: 100, streak: 0, ratings: { integrated: 1200, modes: { "1v1": 1200 } } },
      { id: "referee", name: "심판", trustScore: 100, officialReferee: true, streak: 0, ratings: { integrated: 1200, modes: { "1v1": 1200 } } },
    ],
    teams: [],
    affiliations: [],
    recruitingPosts: [],
    matches: [{
      id: "match-queue",
      title: "병렬 이의제기 검증",
      mode: "1v1",
      ranked: false,
      status: "approval",
      createdBy: "host",
      refereeId: "referee",
      endedAt,
      disputeMinutes: 10,
      teamA: { name: "A", players: ["host"], score: 5 },
      teamB: { name: "B", players: ["guest"], score: 7 },
      reservePlayers: { teamA: ["reserve"], teamB: [] },
      result: {
        scoreA: 5,
        scoreB: 7,
        playerStats: {
          host: { points: 5, rebounds: 0, assists: 0, steals: 0, blocks: 0, turnovers: 0, fouls: 0 },
          guest: { points: 7, rebounds: 0, assists: 0, steals: 0, blocks: 0, turnovers: 0, fouls: 0 },
        },
        statSubmissions: {},
        submittedBy: "host",
        submittedAt: endedAt,
      },
      approvals: { teamA: ["host"], teamB: ["guest"] },
      disputes: [],
    }],
    notifications: [],
    settings: {},
  };
}

function requestFor(state, playerId, requestedPoints) {
  const match = state.matches[0];
  return buildMatchDisputeRequest({
    match,
    playerId,
    requestedStats: {
      ...(match.result?.playerStats?.[playerId] ?? {}),
      points: requestedPoints,
    },
    reason: "득점 기록이 다름",
  });
}

test("이의제기 시간은 10, 15, 20분만 허용한다", () => {
  assert.deepEqual(DISPUTE_WINDOW_OPTIONS, [10, 15, 20]);
  assert.equal(DISPUTE_WINDOW_MINUTES, 15);
  assert.equal(normalizeDisputeWindowMinutes(10), 10);
  assert.equal(normalizeDisputeWindowMinutes(20), 20);
  assert.equal(normalizeDisputeWindowMinutes(12), 15);
});

test("경기 기본 규칙은 모드별 현실적인 시간 모델을 사용한다", () => {
  assert.deepEqual(getDefaultMatchRules("5v5"), {
    gameClockEnabled: true,
    endCondition: "time",
    targetScore: 21,
    periodCount: 4,
    periodMinutes: 10,
    periodBreakMinutes: 2,
    halftimeMinutes: 10,
    overtimeMinutes: 5,
    clockMode: "stopped",
    lastPeriodStopMinutes: 0,
    timeLimit: 40,
    ball: "7호 공",
    winByTwo: false,
    attackRule: "득점 후 공격권 교대",
    foulRule: "파울 콜 즉시 중단, 공격권 유지",
    meetingPoint: "",
    meetBeforeMinutes: 15,
  });
  const normalized = normalizeMatchRules({ periodCount: 2, periodMinutes: 8, meetingPoint: "  2층 A코트 앞  " }, { mode: "3v3" });
  assert.equal(normalized.timeLimit, 16);
  assert.equal(normalized.meetingPoint, "2층 A코트 앞");
});

test("후보는 제외하고 실제 출전 선수만 이의를 접수한다", () => {
  const state = makeState("reserve");
  assert.deepEqual(getMatchRecordPlayerIds(state.matches[0]), ["host", "guest"]);
  const next = disputeMatch(state, "match-queue", requestFor(state, "reserve", 3));
  assert.equal(getOpenMatchDisputes(next.matches[0]).length, 0);
  assert.equal(next.notifications[0]?.title, "이의신청 권한 없음");
});

test("여러 참가자의 이의를 병렬 접수하고 심판이 건별 처리한 뒤 별도 승인한다", () => {
  const start = makeState("host");
  const first = disputeMatch(start, "match-queue", requestFor(start, "host", 8));
  const secondInput = { ...first, currentUserId: "guest" };
  const second = disputeMatch(secondInput, "match-queue", requestFor(secondInput, "guest", 9));
  const open = getOpenMatchDisputes(second.matches[0]);

  assert.equal(open.length, 2);
  assert.equal(second.matches[0].status, "disputed");
  assert.equal(canUserResolveMatchDispute(second.matches[0], "referee"), true);
  assert.equal(canUserResolveMatchDispute(second.matches[0], "host"), false);
  assert.equal(canUserResolveMatchDispute(second.matches[0], "guest"), false);

  const hostDispute = open.find((dispute) => dispute.by === "host");
  const hostAttempt = resolveMatchDispute(
    { ...second, currentUserId: "host" },
    "match-queue",
    hostDispute.id,
    "accepted",
    "방장은 심판 경기 이의를 처리할 수 없음",
  );
  assert.equal(getOpenMatchDisputes(hostAttempt.matches[0]).length, 2);
  const accepted = resolveMatchDispute(
    { ...second, currentUserId: "referee" },
    "match-queue",
    hostDispute.id,
    "accepted",
    "현장 기록과 이의 내용을 확인함",
  );
  assert.equal(getOpenMatchDisputes(accepted.matches[0]).length, 1);
  assert.equal(accepted.matches[0].status, "disputed");
  assert.equal(accepted.matches[0].disputeDraftResult.playerStats.host.points, 8);

  const remaining = getOpenMatchDisputes(accepted.matches[0])[0];
  const resolved = resolveMatchDispute(
    { ...accepted, currentUserId: "referee" },
    "match-queue",
    remaining.id,
    "rejected",
    "현장 기록과 기존 결과가 일치함",
  );
  assert.equal(getOpenMatchDisputes(resolved.matches[0]).length, 0);
  assert.equal(resolved.matches[0].status, "approval");
  assert.equal(resolved.matches[0].result.playerStats.host.points, 8);
  assert.deepEqual(resolved.matches[0].approvals, { teamA: [], teamB: [] });
  assert.match(resolved.notifications[0].body, /심판이 최종 승인/);

  const finalizeOptions = { disputesAcknowledged: true, now: Date.now() + (4 * 60_000) };
  const participantAttempt = finalizeMatchByAuthority({ ...resolved, currentUserId: "guest" }, "match-queue", finalizeOptions);
  assert.equal(participantAttempt.matches[0].status, "approval");
  const hostFinalizeAttempt = finalizeMatchByAuthority({ ...resolved, currentUserId: "host" }, "match-queue", finalizeOptions);
  assert.equal(hostFinalizeAttempt.matches[0].status, "approval");
  const finished = finalizeMatchByAuthority({ ...resolved, currentUserId: "referee" }, "match-queue", finalizeOptions);
  assert.equal(finished.matches[0].status, "confirmed");
});

test("심판은 같은 revision에서 접수된 서로 다른 선수 이의를 순서대로 가결한다", () => {
  const start = makeState("host");
  const first = disputeMatch(start, "match-queue", requestFor(start, "host", 8));
  const secondInput = { ...first, currentUserId: "guest" };
  const queued = disputeMatch(secondInput, "match-queue", requestFor(secondInput, "guest", 9));
  const disputes = getOpenMatchDisputes(queued.matches[0]);
  const hostDispute = disputes.find((dispute) => dispute.by === "host");
  const guestDispute = disputes.find((dispute) => dispute.by === "guest");

  const firstAccepted = resolveMatchDispute(
    { ...queued, currentUserId: "referee" },
    "match-queue",
    hostDispute.id,
    "accepted",
    "호스트 개인 기록을 확인했습니다.",
  );
  const allAccepted = resolveMatchDispute(
    firstAccepted,
    "match-queue",
    guestDispute.id,
    "accepted",
    "상대 선수 개인 기록도 확인했습니다.",
  );

  assert.equal(getOpenMatchDisputes(allAccepted.matches[0]).length, 0);
  assert.equal(allAccepted.matches[0].status, "approval");
  assert.equal(allAccepted.matches[0].result.playerStats.host.points, 8);
  assert.equal(allAccepted.matches[0].result.playerStats.guest.points, 9);
});

test("무심판 팀 점수 이의는 첫 가결 뒤 오래된 revision을 다시 적용하지 않는다", () => {
  const start = makeState("guest");
  const noRefereeMatch = {
    ...start.matches[0],
    refereeId: undefined,
    result: { ...start.matches[0].result, playerStats: {}, statSubmissions: {} },
  };
  const noRefereeState = { ...start, matches: [noRefereeMatch] };
  const first = disputeMatch(noRefereeState, "match-queue", {
    kind: "team_scores",
    requestedScoreA: 6,
    requestedScoreB: 8,
    baseRevision: 0,
    reason: "첫 점수 수정 요청",
  });
  const second = disputeMatch({ ...first, currentUserId: "host" }, "match-queue", {
    kind: "team_scores",
    requestedScoreA: 9,
    requestedScoreB: 7,
    baseRevision: 0,
    reason: "두 번째 점수 수정 요청",
  });
  const disputes = getOpenMatchDisputes(second.matches[0]);
  const guestDispute = disputes.find((dispute) => dispute.by === "guest");
  const hostDispute = disputes.find((dispute) => dispute.by === "host");
  const firstAccepted = resolveMatchDispute(
    { ...second, currentUserId: "host" },
    "match-queue",
    guestDispute.id,
    "accepted",
    "첫 점수 요청을 확인했습니다.",
  );
  const staleAttempt = resolveMatchDispute(
    firstAccepted,
    "match-queue",
    hostDispute.id,
    "accepted",
    "오래된 점수 요청입니다.",
  );

  assert.strictEqual(staleAttempt, firstAccepted);
  assert.equal(getOpenMatchDisputes(staleAttempt.matches[0]).length, 1);
  assert.equal(staleAttempt.matches[0].disputeDraftResult.scoreA, 6);
  assert.equal(staleAttempt.matches[0].disputeDraftResult.scoreB, 8);
});

test("무심판 경기도 점수 변경 없는 사유 이의를 접수한다", () => {
  const start = makeState("guest");
  const noRefereeState = {
    ...start,
    matches: [{
      ...start.matches[0],
      refereeId: undefined,
      result: { ...start.matches[0].result, playerStats: {}, statSubmissions: {} },
    }],
  };
  const next = disputeMatch(noRefereeState, "match-queue", {
    kind: "team_scores",
    requestedScoreA: 5,
    requestedScoreB: 7,
    baseRevision: 0,
    reason: "교체 출전 기록을 확인해 주세요.",
  });

  assert.equal(getOpenMatchDisputes(next.matches[0]).length, 1);
  assert.equal(next.matches[0].disputes[0].reason, "교체 출전 기록을 확인해 주세요.");
});

test("일반 경기 참가자 승인 경로는 폐기되고 경기 권한자의 명시적 최종 승인만 남는다", () => {
  const state = makeState("guest");
  const approved = approveMatch(state, "match-queue", "teamB", "guest");
  assert.strictEqual(approved, state);
  assert.equal(approved.matches[0].status, "approval");
});

test("기존 사유형 이의제기는 신규 접수 경로에서 거부한다", () => {
  const start = makeState("guest");
  const disputed = disputeMatch(start, "match-queue", "기존 기록을 다시 확인해 주세요.");
  assert.equal(getOpenMatchDisputes(disputed.matches[0]).length, 0);
  assert.equal(disputed.matches[0].status, "approval");
});

test("무심판 점수 이의 수락은 A/B 점수를 함께 바꾸고 개인 스탯을 만들지 않는다", () => {
  const start = makeState("guest");
  const noRefereeMatch = {
    ...start.matches[0],
    refereeId: undefined,
    result: {
      ...start.matches[0].result,
      playerStats: {},
      statSubmissions: {},
    },
  };
  const noRefereeState = { ...start, matches: [noRefereeMatch] };
  const disputed = disputeMatch(noRefereeState, "match-queue", {
    kind: "team_scores",
    requestedScoreA: 6,
    requestedScoreB: 10,
    baseRevision: 0,
    reason: "B 점수 정정",
  });
  const openDispute = getOpenMatchDisputes(disputed.matches[0])[0];
  const finished = resolveMatchDispute(
    { ...disputed, currentUserId: "host" },
    "match-queue",
    openDispute.id,
    "accepted",
    "요청한 B사이드 점수를 현장에서 확인함",
  );

  assert.equal(finished.matches[0].status, "approval");
  assert.equal(finished.matches[0].result.scoreA, 6);
  assert.equal(finished.matches[0].result.scoreB, 10);
  assert.deepEqual(finished.matches[0].result.playerStats, {});
  const confirmed = finalizeMatchByAuthority(
    { ...finished, currentUserId: "host" },
    "match-queue",
    { disputesAcknowledged: true, now: Date.now() + (4 * 60_000) },
  );
  assert.equal(confirmed.matches[0].status, "confirmed");
});

test("미처리 이의는 제한시간이 지나도 이의 단계에 남는다", () => {
  const state = makeState("host");
  const match = {
    ...state.matches[0],
    status: "disputed",
    endedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
    disputes: [{ id: "open-1", by: "guest", status: "open", reason: "확인 필요" }],
  };
  assert.equal(getMatchRoomPhase(match).phase, "dispute");
});

test("심판 개인기록이 미완성이면 disputeMinutes 뒤에도 보험성 자동 확정하지 않는다", () => {
  const state = makeState("referee");
  const submittedAt = new Date(Date.now() - 20 * 60_000).toISOString();
  const incompleteMatch = {
    ...state.matches[0],
    endedAt: submittedAt,
    result: {
      ...state.matches[0].result,
      submittedAt,
      playerStats: { host: state.matches[0].result.playerStats.host },
    },
  };
  const incompleteState = { ...state, matches: [incompleteMatch] };
  const blocked = runAutomaticStateMaintenance(incompleteState, new Date());
  assert.equal(blocked.matches[0].status, "approval");

  const completeState = {
    ...blocked,
    matches: [{
      ...blocked.matches[0],
      result: {
        ...blocked.matches[0].result,
        playerStats: state.matches[0].result.playerStats,
      },
    }],
  };
  const finalized = runAutomaticStateMaintenance(completeState, new Date());
  assert.equal(finalized.matches[0].status, "confirmed");
});

test("DB와 목록 API가 병렬 큐를 새로고침 가능한 형태로 조회한다", async () => {
  const migration = await readSource("supabase/migrations/20260722120000_parallel_match_dispute_queue.sql");
  const edgeMigration = await readSource("supabase/migrations/20260801006000_fix_match_dispute_and_referee_absence_edges.sql");
  const listApi = await readSource("server/api/matches/_listEnrichment.js");
  assert.match(migration, /match_disputes_one_open_per_user_idx/);
  assert.match(migration, /rankball_match_resolve_dispute_action/);
  assert.match(migration, /safe_decision not in \('accepted', 'rejected'\)/);
  assert.match(migration, /match_host_required/);
  const hostFinalizeMigration = await readSource("supabase/migrations/20260728130000_general_match_host_finalization.sql");
  assert.match(hostFinalizeMigration, /match_dispute_host_required/);
  assert.match(hostFinalizeMigration, /match_finalize_host_required/);
  assert.match(hostFinalizeMigration, /general_match_participant_approval_retired/);
  assert.match(hostFinalizeMigration, /'finalized', false/);
  assert.match(hostFinalizeMigration, /replace\(function_definition, old_finalize, ''\)/);
  const liveAuthorityMigration = await readSource("supabase/migrations/20260728143000_referee_live_match_authority.sql");
  assert.match(liveAuthorityMigration, /add column if not exists resolution_reason text/u);
  assert.match(liveAuthorityMigration, /add column if not exists resolution_audit jsonb/u);
  assert.match(liveAuthorityMigration, /match_disputes_resolution_reason_length_check/u);
  assert.match(liveAuthorityMigration, /p_resolution_reason text/u);
  assert.match(liveAuthorityMigration, /match_dispute_resolution_reason_required/u);
  assert.match(liveAuthorityMigration, /match_dispute_referee_required/u);
  assert.match(liveAuthorityMigration, /match_dispute_host_required/u);
  assert.match(liveAuthorityMigration, /'resolutionReason', safe_resolution_reason/u);
  assert.match(liveAuthorityMigration, /'previousResult', before_result/u);
  assert.match(liveAuthorityMigration, /'nextResult', after_result/u);
  assert.match(liveAuthorityMigration, /resolved_result := public\.rankball_match_resolve_dispute_pre_reason/u);
  assert.match(liveAuthorityMigration, /return resolved_result \|\| jsonb_build_object/u);
  assert.match(edgeMigration, /base_revision > greatest/u);
  assert.match(edgeMigration, /request_kind = 'team_scores'/u);
  assert.match(edgeMigration, /match_dispute_revision_guard_shape_changed/u);
  assert.match(listApi, /attachOpenDisputeQueues/);
  assert.match(listApi, /\.eq\("status", "open"\)/);
});

test("이의 상태 경기방은 무효 처리 대화상자를 import한 뒤 렌더한다", async () => {
  const sourceMatchPanels = await readSource("src/components/recruiting/RecruitingSourceMatchPanels.jsx");
  assert.match(sourceMatchPanels, /import MatchVoidDialog from "\.\.\/match\/MatchVoidDialog\.jsx";/);
  assert.match(sourceMatchPanels, /<MatchVoidDialog\b/);
});

test("사유만 있는 이의제기를 저장하고 제출·심판 화면을 즉시 갱신한다", async () => {
  const migration = await readSource("supabase/migrations/20260731233000_allow_reason_only_match_disputes.sql");
  const teamScoreMigration = await readSource("supabase/migrations/20260802011000_allow_reason_only_team_score_disputes.sql");
  const interactions = await readSource("src/components/recruiting/useRecruitingRoomModalInteractions.js");
  const controller = await readSource("src/components/recruiting/useRecruitingRoomController.js");
  assert.match(migration, /match_stat_dispute_no_change/);
  assert.match(migration, /execute function_definition/);
  assert.match(teamScoreMigration, /match_reason_only_team_dispute_shape_changed/);
  assert.match(teamScoreMigration, /execute replace\(function_definition, old_guard, new_guard\)/);
  assert.match(interactions, /await app\.actions\.disputeMatch/);
  assert.match(interactions, /await refreshSourceMatchReview\?\.\(\)/);
  assert.match(controller, /window\.setInterval\(refreshReview, 5000\)/);
});

test("기록완료 뒤 현재 사용자 기록 목록을 강제 갱신한다", async () => {
  const controller = await readSource("src/components/recruiting/useRecruitingRoomController.js");
  const actions = await readSource("src/components/recruiting/RecruitingRoomActionSection.jsx");
  assert.match(controller, /loadProfileRecords\?\.\(\{ force: true \}\)/);
  assert.match(actions, />\s*기록완료\s*</);
});

test("방장과 배정 심판에게 이의신청 종료 가능 시점을 안내한다", async () => {
  const model = await readSource("src/components/recruiting/RecruitingRoomMatchModel.jsx");
  const actions = await readSource("src/components/recruiting/RecruitingRoomActionSection.jsx");
  assert.match(model, /const canManageSourceMatchFinalization = Boolean\(/);
  assert.match(actions, /sourceManualFinalizationStatus\.delayMinutes\}분부터 이의신청 종료가 가능합니다/);
});
