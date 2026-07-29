import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  projectMatchDisputeRow,
  projectMatchDisputeRows,
  projectMatchTimestamps,
} from "../shared/lib/matchReadProjection.js";

const disputeRowFixture = Object.freeze({
  id: "dispute-1",
  match_id: "match-1",
  user_id: "player-1",
  reason: "score",
  request_payload: {
    scoreA: 21,
    scoreB: 19,
    playerStats: {
      "player-1": { points: 10 },
    },
  },
  status: "resolved",
  resolved_at: "2026-07-29T10:01:00.000Z",
  resolved_by: "referee-1",
  resolution: "accepted",
  resolution_reason: "현장 기록 확인",
  resolution_audit: {
    actorRole: "referee",
    openDisputeCount: 0,
  },
  created_at: "2026-07-29T10:00:00.000Z",
});

test("match dispute row는 기존 client shape와 기본값을 보존한다", () => {
  assert.deepEqual(projectMatchDisputeRow(disputeRowFixture), {
    id: "dispute-1",
    by: "player-1",
    reason: "score",
    request: {
      scoreA: 21,
      scoreB: 19,
      playerStats: {
        "player-1": { points: 10 },
      },
    },
    status: "resolved",
    resolvedAt: "2026-07-29T10:01:00.000Z",
    resolvedBy: "referee-1",
    resolution: "accepted",
    resolutionReason: "현장 기록 확인",
    resolutionAudit: {
      actorRole: "referee",
      openDisputeCount: 0,
    },
    createdAt: "2026-07-29T10:00:00.000Z",
  });

  assert.deepEqual(projectMatchDisputeRow({
    id: "dispute-open",
    user_id: "player-2",
    reason: "score",
    created_at: "2026-07-29T11:00:00.000Z",
  }), {
    id: "dispute-open",
    by: "player-2",
    reason: "score",
    request: {},
    status: "open",
    resolvedAt: null,
    resolvedBy: "",
    resolution: "",
    resolutionReason: "",
    resolutionAudit: {},
    createdAt: "2026-07-29T11:00:00.000Z",
  });
});

test("match dispute 목록 projection은 null 목록을 빈 배열로 읽는다", () => {
  assert.deepEqual(projectMatchDisputeRows([disputeRowFixture]), [
    projectMatchDisputeRow(disputeRowFixture),
  ]);
  assert.deepEqual(projectMatchDisputeRows(null), []);
});

test("match read timestamps preserve nullable lifecycle fields and updated fallback", () => {
  assert.deepEqual(projectMatchTimestamps({
    created_at: "2026-07-29T10:00:00.000Z",
    agreed_at: null,
    started_at: "2026-07-29T10:05:00.000Z",
    ended_at: null,
    confirmed_at: null,
    cancelled_at: null,
    voided_at: null,
  }), {
    createdAt: "2026-07-29T10:00:00.000Z",
    agreedAt: null,
    startedAt: "2026-07-29T10:05:00.000Z",
    endedAt: null,
    confirmedAt: null,
    cancelledAt: null,
    voidedAt: null,
    updatedAt: "2026-07-29T10:00:00.000Z",
  });
});

test("client mapper와 match list API는 shared dispute projection만 사용한다", async () => {
  const [clientMapper, sharedMapper, matchListApi] = await Promise.all([
    readFile(new URL("../src/data/matchMappers.js", import.meta.url), "utf8"),
    readFile(new URL("../shared/lib/matchMappers.js", import.meta.url), "utf8"),
    readFile(new URL("../server/api/matches/list.js", import.meta.url), "utf8"),
  ]);

  assert.equal(clientMapper.trim(), 'export * from "../../shared/lib/matchMappers.js";');
  for (const source of [sharedMapper, matchListApi]) {
    assert.match(source, /matchReadProjection\.js/);
    assert.match(source, /projectMatchDisputeRows\(/);
    assert.match(source, /projectMatchTimestamps\(/);
    assert.doesNotMatch(source, /resolutionAudit:\s*dispute\.resolution_audit/);
  }
});
