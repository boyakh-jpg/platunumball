import assert from "node:assert/strict";
import test from "node:test";
import {
  canRepeatOperationsMatch,
  getOperationsMatchBucket,
  getOperationsMatchRole,
  selectOperationsMatches,
} from "../src/lib/operationsCenter.js";

const NOW = new Date("2026-09-04T03:00:00.000Z");

test("운영 역할은 canonical 주최자와 배정 심판만 반환한다", () => {
  assert.equal(getOperationsMatchRole({ createdBy: "host" }, "host"), "host");
  assert.equal(
    getOperationsMatchRole(
      { createdBy: "fallback-host", refereeId: "operator" },
      "operator",
      { ownerId: "operator" },
    ),
    "referee",
  );
  assert.equal(
    getOperationsMatchRole({ createdBy: "fallback-host" }, "post-host", { ownerId: "post-host" }),
    "host",
  );
  assert.equal(getOperationsMatchRole({ createdBy: "host", refereeId: "referee" }, "other"), null);
  assert.equal(getOperationsMatchRole({ createdBy: "host" }, ""), null);
});

test("canonical 방 단계는 지금 처리, 다음 경기, 지난 경기 버킷으로 모인다", () => {
  const cases = [
    [{ status: "recruiting" }, "upcoming"],
    [{ status: "agreed", scheduledAt: "2026-09-05T03:00:00.000Z" }, "upcoming"],
    [{ status: "agreed", scheduledAt: "2026-09-04T03:10:00.000Z" }, "now"],
    [{ status: "agreed", startedAt: "2026-09-04T02:00:00.000Z" }, "now"],
    [{ status: "agreed", endedAt: "2026-09-04T02:30:00.000Z" }, "now"],
    [{ status: "disputed" }, "now"],
    [{ status: "confirmed" }, "past"],
    [{ status: "cancelled" }, "past"],
    [{ status: "void" }, "past"],
  ];

  for (const [match, bucket] of cases) {
    assert.equal(getOperationsMatchBucket(match, NOW), bucket);
  }
});

test("다시 만들기 표시는 모집글이 있는 종료 경기의 주최자에게만 허용한다", () => {
  for (const status of ["confirmed", "cancelled", "void"]) {
    assert.equal(
      canRepeatOperationsMatch({ status, recruitingPostId: "post-1", createdBy: "host" }, "host", null, NOW),
      true,
    );
  }

  assert.equal(
    canRepeatOperationsMatch(
      { status: "confirmed", recruitingPostId: "post-1", createdBy: "other" },
      "host",
      { ownerId: "host" },
      NOW,
    ),
    true,
  );
  assert.equal(
    canRepeatOperationsMatch(
      { status: "confirmed", recruitingPostId: "post-1", createdBy: "host", refereeId: "referee" },
      "referee",
      null,
      NOW,
    ),
    false,
  );
  assert.equal(canRepeatOperationsMatch({ status: "confirmed", createdBy: "host" }, "host", null, NOW), false);
  assert.equal(canRepeatOperationsMatch({ status: "confirmed", recruitingPostId: "post-1" }, "", null, NOW), false);
  assert.equal(
    canRepeatOperationsMatch({ status: "agreed", recruitingPostId: "post-1", createdBy: "host" }, "host", null, NOW),
    false,
  );
  assert.equal(
    canRepeatOperationsMatch({ status: "voided", recruitingPostId: "post-1", createdBy: "host" }, "host", null, NOW),
    false,
  );
});

test("선택기는 관련 역할만 남기고 source post가 없어도 안전하게 세 버킷을 만든다", () => {
  const matches = [
    { id: "waiting", status: "recruiting", recruitingPostId: "post-owned", createdBy: "fallback" },
    { id: "live", status: "agreed", startedAt: "2026-09-04T02:00:00.000Z", refereeId: "user" },
    { id: "record", status: "confirmed", recruitingPostId: "post-missing", createdBy: "user" },
    { id: "unrelated", status: "confirmed", createdBy: "other" },
    { id: "closed", status: "closed", createdBy: "user" },
    { id: "personal", status: "confirmed", createdBy: "user", rules: { recordType: "solo" } },
    { id: "match-record", status: "confirmed", createdBy: "user", rules: { recordType: "match_record" } },
    { id: "m_seed_upcoming_1", status: "recruiting", createdBy: "user" },
  ];

  const selected = selectOperationsMatches(matches, "user", {
    recruitingPosts: [{ id: "post-owned", ownerId: "user" }],
    now: NOW,
  });

  assert.deepEqual(selected.upcoming.map(({ match }) => match.id), ["waiting"]);
  assert.deepEqual(selected.now.map(({ match }) => match.id), ["live"]);
  assert.deepEqual(selected.past.map(({ match }) => match.id), ["record"]);
  assert.equal(selected.upcoming[0].role, "host");
  assert.equal(selected.upcoming[0].sourcePost.id, "post-owned");
  assert.equal(selected.now[0].role, "referee");
  assert.equal(selected.now[0].sourcePost, null);
  assert.equal(selected.past[0].phase.phase, "record");
  assert.equal(selected.past[0].canRepeat, true);
  assert.deepEqual(selectOperationsMatches(null, "user", null), { now: [], upcoming: [], past: [] });
});
