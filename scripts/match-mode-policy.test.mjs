import assert from "node:assert/strict";
import test from "node:test";

import { validateMatchShape } from "../server/api/matches/sync-match.js";
import { validateRecruitingPostShape } from "../server/api/recruiting/sync-post.js";
import { getSupportedTournamentMode } from "../server/api/tournaments/sync-tournament.js";
import {
  MATCH_MODE_IDS,
  MATCH_MODES,
  RECORD_TYPES,
  isSupportedMatchMode,
  isSupportedSoloRecordMode,
} from "../src/lib/constants.js";
import { applyMatchRating, calculateTeamDelta } from "../src/lib/rating.js";
import { DEFAULT_RATING_POLICY, RATING_POLICY_MODE_IDS } from "../src/lib/ratingPolicy.js";

function makeMatch(mode, recordType = RECORD_TYPES.match) {
  return {
    id: `match-${mode}`,
    mode,
    ranked: true,
    preRegistered: true,
    official: false,
    court: "검증 구장",
    createdAt: "2026-07-20T00:00:00.000Z",
    scheduledAt: "2026-07-21T00:00:00.000Z",
    rules: { recordType },
    teamA: { players: ["player-a"], score: 10 },
    teamB: { players: ["player-b"], score: 8 },
    reservePlayers: { teamA: [], teamB: [] },
    result: {
      scoreA: 10,
      scoreB: 8,
      playerStats: { "player-a": {}, "player-b": {} },
    },
  };
}

test("경기 생성·관리자 MMR 정책은 같은 네 가지 모드를 사용한다", () => {
  const modeIds = MATCH_MODES.map((mode) => mode.id);
  assert.deepEqual(modeIds, ["1v1", "2v2", "3v3", "5v5"]);
  assert.deepEqual(MATCH_MODE_IDS, modeIds);
  assert.deepEqual(RATING_POLICY_MODE_IDS, modeIds);
  assert.deepEqual(Object.keys(DEFAULT_RATING_POLICY.playerMmr.modeScalePercent), modeIds);
  assert.deepEqual(Object.keys(DEFAULT_RATING_POLICY.playerMmr.integratedScalePercent), modeIds);
});

test("일반·비공개·대회·경기 기록은 지원 모드만 허용하고 개인 기록만 4v4를 유지한다", () => {
  MATCH_MODE_IDS.forEach((mode) => {
    assert.equal(isSupportedMatchMode(mode), true);
    assert.doesNotThrow(() => validateRecruitingPostShape({ mode }));
    assert.doesNotThrow(() => validateMatchShape(makeMatch(mode)));
    assert.equal(getSupportedTournamentMode(mode), mode);
  });

  assert.equal(isSupportedMatchMode("4v4"), false);
  assert.equal(isSupportedSoloRecordMode("4v4"), true);
  assert.throws(() => validateRecruitingPostShape({ mode: "4v4" }), /unsupported_match_mode/);
  assert.throws(() => validateMatchShape(makeMatch("4v4")), /unsupported_match_mode/);
  assert.doesNotThrow(() => validateMatchShape(makeMatch("4v4", RECORD_TYPES.personalRecord)));
  assert.throws(() => getSupportedTournamentMode("4v4"), /unsupported_match_mode/);
  assert.throws(() => validateMatchShape(makeMatch("unknown")), /unsupported_match_mode/);
  assert.throws(() => validateRecruitingPostShape({ mode: " 3v3 " }), /unsupported_match_mode/);
});

test("네 가지 모드는 자신의 모드 MMR·통합 MMR·팀 MMR을 각각 계산한다", () => {
  MATCH_MODE_IDS.forEach((mode) => {
    const match = makeMatch(mode);
    const users = [
      { id: "player-a", trustScore: 80, ratings: { integrated: 1200, modes: { [mode]: 1200 } } },
      { id: "player-b", trustScore: 80, ratings: { integrated: 1200, modes: { [mode]: 1200 } } },
    ];
    const ratings = Object.fromEntries(users.map((user) => [user.id, user.ratings]));
    const result = applyMatchRating(match, users, ratings, [], []);

    assert.equal(result.changes.length, 2);
    assert.notEqual(result.ratings["player-a"].modes[mode], 1200);
    assert.deepEqual(Object.keys(result.ratings["player-a"].modes), [mode]);
    assert.notEqual(result.ratings["player-a"].integrated, 1200);
    assert.notEqual(calculateTeamDelta({ teamMmr: 1200, opponentTeamMmr: 1200, actual: 1, match }), 0);
  });
});
