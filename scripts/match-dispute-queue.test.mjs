import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { disputeMatch, resolveMatchDispute } from "../src/data/repository.js";
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
  const endedAt = new Date(Date.now() - 60_000).toISOString();
  return {
    currentUserId,
    users: [
      { id: "host", name: "방장", trustScore: 100, streak: 0, ratings: { integrated: 1200, modes: { "1v1": 1200 } } },
      { id: "guest", name: "참가자", trustScore: 100, streak: 0, ratings: { integrated: 1200, modes: { "1v1": 1200 } } },
      { id: "reserve", name: "후보", trustScore: 100, streak: 0, ratings: { integrated: 1200, modes: { "1v1": 1200 } } },
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
      endedAt,
      disputeMinutes: 10,
      teamA: { name: "A", players: ["host"], score: 5 },
      teamB: { name: "B", players: ["guest"], score: 7 },
      reservePlayers: { teamA: ["reserve"], teamB: [] },
      result: {
        scoreA: 5,
        scoreB: 7,
        playerStats: {
          host: { points: 5, rebounds: 0, assists: 0, steals: 0, blocks: 0, fouls: 0 },
          guest: { points: 7, rebounds: 0, assists: 0, steals: 0, blocks: 0, fouls: 0 },
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
  const player = state.users.find((user) => user.id === playerId);
  return buildMatchDisputeRequest({
    match,
    playerId,
    playerName: player?.name,
    requestedPoints,
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

test("여러 참가자의 이의를 병렬 접수하고 방장이 건별 처리한다", () => {
  const start = makeState("host");
  const first = disputeMatch(start, "match-queue", requestFor(start, "host", 8));
  const secondInput = { ...first, currentUserId: "guest" };
  const second = disputeMatch(secondInput, "match-queue", requestFor(secondInput, "guest", 9));
  const open = getOpenMatchDisputes(second.matches[0]);

  assert.equal(open.length, 2);
  assert.equal(second.matches[0].status, "disputed");
  assert.equal(canUserResolveMatchDispute(second.matches[0], "host"), true);
  assert.equal(canUserResolveMatchDispute(second.matches[0], "guest"), false);

  const hostDispute = open.find((dispute) => dispute.by === "host");
  const accepted = resolveMatchDispute({ ...second, currentUserId: "host" }, "match-queue", hostDispute.id, "accepted");
  assert.equal(getOpenMatchDisputes(accepted.matches[0]).length, 1);
  assert.equal(accepted.matches[0].status, "disputed");
  assert.equal(accepted.matches[0].disputeDraftResult.playerStats.host.points, 8);

  const remaining = getOpenMatchDisputes(accepted.matches[0])[0];
  const finished = resolveMatchDispute(accepted, "match-queue", remaining.id, "rejected");
  assert.equal(getOpenMatchDisputes(finished.matches[0]).length, 0);
  assert.equal(finished.matches[0].status, "confirmed");
  assert.equal(finished.matches[0].result.playerStats.host.points, 8);
  assert.deepEqual(finished.matches[0].approvals, { teamA: [], teamB: [] });
  assert.match(finished.notifications[0].body, /불복은 신고/);
});

test("기존 사유형 이의제기도 가결할 수 있다", () => {
  const start = makeState("guest");
  const disputed = disputeMatch(start, "match-queue", "기존 기록을 다시 확인해 주세요.");
  const openDispute = getOpenMatchDisputes(disputed.matches[0])[0];
  const finished = resolveMatchDispute({ ...disputed, currentUserId: "host" }, "match-queue", openDispute.id, "accepted");

  assert.equal(getOpenMatchDisputes(finished.matches[0]).length, 0);
  assert.equal(finished.matches[0].status, "confirmed");
  assert.deepEqual(finished.matches[0].result, start.matches[0].result);
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

test("DB와 목록 API가 병렬 큐를 새로고침 가능한 형태로 조회한다", async () => {
  const migration = await readSource("supabase/migrations/20260722120000_parallel_match_dispute_queue.sql");
  const listApi = await readSource("server/api/matches/list.js");
  assert.match(migration, /match_disputes_one_open_per_user_idx/);
  assert.match(migration, /rankball_match_resolve_dispute_action/);
  assert.match(migration, /safe_decision not in \('accepted', 'rejected'\)/);
  assert.match(migration, /match_host_required/);
  const hostFinalizeMigration = await readSource("supabase/migrations/20260724235900_match_dispute_host_finalize.sql");
  assert.match(hostFinalizeMigration, /match_dispute_host_required/);
  assert.match(hostFinalizeMigration, /match_dispute_items_open/);
  assert.match(hostFinalizeMigration, /'reapprovalRequired', false/);
  assert.match(hostFinalizeMigration, /rankball_match_finalize_locked\(/);
  assert.match(listApi, /attachOpenDisputeQueues/);
  assert.match(listApi, /\.eq\("status", "open"\)/);
});
