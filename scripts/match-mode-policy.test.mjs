import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
import {
  PLACEMENT_MATCH_TARGET,
  PLACEMENT_MAX_MMR,
  PLACEMENT_MIN_MMR,
  TEAM_PERFORMANCE_ADJUSTMENT_LIMIT,
  applyMatchRating,
  calculatePlacementPerformance,
  calculateRosterBasedTeamMmr,
  calculateTeamDelta,
  calculateTeamRosterMmr,
  getTeamPerformanceAdjustment,
  teamRegularRatio,
} from "../src/lib/rating.js";
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

test("개인 배치는 승패와 상대 MMR을 반영하고 5경기 뒤 브론즈~다이아몬드 범위로 확정한다", () => {
  assert.equal(calculatePlacementPerformance({
    sideSize: 1,
    opponentMmr: 1200,
    teammateMmrTotal: 0,
    actual: 1,
  }), 1400);
  assert.equal(calculatePlacementPerformance({
    sideSize: 1,
    opponentMmr: 1200,
    teammateMmrTotal: 0,
    actual: 0,
  }), 1000);
  assert.equal(calculatePlacementPerformance({
    sideSize: 5,
    opponentMmr: 2000,
    teammateMmrTotal: 0,
    actual: 1,
  }), 2000);
  assert.equal(calculatePlacementPerformance({
    sideSize: 1,
    opponentMmr: 600,
    teammateMmrTotal: 5000,
    actual: 0,
  }), 600);

  const player = {
    id: "player-a",
    trustScore: 80,
    ratings: {
      integrated: 1200,
      modes: {},
      placement: {
        matchCount: 0,
        evidenceWeight: 0,
        weightedTotal: 3000,
        modeCounts: {},
      },
    },
  };
  const opponent = {
    id: "player-b",
    trustScore: 80,
    ratings: { integrated: 600, modes: { "1v1": 600 } },
  };
  let currentRatings = {
    [player.id]: player.ratings,
    [opponent.id]: opponent.ratings,
  };

  for (let index = 0; index < PLACEMENT_MATCH_TARGET; index += 1) {
    const match = {
      ...makeMatch("1v1"),
      id: `placement-${index + 1}`,
      result: { scoreA: 0, scoreB: 1, playerStats: {} },
      teamA: { players: [player.id], score: 0 },
      teamB: { players: [opponent.id], score: 1 },
    };
    const result = applyMatchRating(match, [player, opponent], currentRatings, [], []);
    currentRatings = {
      ...currentRatings,
      [player.id]: result.ratings[player.id],
      [opponent.id]: opponent.ratings,
    };
    assert.equal(currentRatings[player.id].placement.matchCount, index + 1);
    assert.equal(currentRatings[player.id].placement.completed, index + 1 === PLACEMENT_MATCH_TARGET);
  }

  assert.equal(currentRatings[player.id].integrated, PLACEMENT_MIN_MMR);
  assert.ok(currentRatings[player.id].integrated <= PLACEMENT_MAX_MMR);
});

test("팀 기준 MMR은 주장·정규멤버 상위 5명 평균이며 성과 보정은 ±150으로 제한한다", () => {
  const team = {
    mmr: 2400,
    members: [
      { userId: "captain", role: "captain" },
      { userId: "regular-1", role: "regular" },
      { userId: "regular-2", role: "regular" },
      { userId: "regular-3", role: "regular" },
      { userId: "regular-4", role: "regular" },
      { userId: "regular-5", role: "regular" },
      { userId: "mercenary", role: "mercenary" },
    ],
  };
  const users = [
    { id: "captain", ratings: { integrated: 2000 } },
    { id: "regular-1", ratings: { integrated: 1800 } },
    { id: "regular-2", ratings: { integrated: 1600 } },
    { id: "regular-3", ratings: { integrated: 1400 } },
    { id: "regular-4", ratings: { integrated: 1200 } },
    { id: "regular-5", ratings: { integrated: 1000 } },
    { id: "mercenary", ratings: { integrated: 2500 } },
  ];

  assert.equal(calculateTeamRosterMmr(team, users), 1600);
  assert.equal(getTeamPerformanceAdjustment(team, 1600), TEAM_PERFORMANCE_ADJUSTMENT_LIMIT);
  assert.equal(getTeamPerformanceAdjustment({ mmr: 1000 }, 1600), -TEAM_PERFORMANCE_ADJUSTMENT_LIMIT);
  assert.deepEqual(calculateRosterBasedTeamMmr(team, users), {
    rosterMmr: 1600,
    performanceAdjustment: TEAM_PERFORMANCE_ADJUSTMENT_LIMIT,
    mmr: 1750,
  });
});

test("팀 MMR 변동은 실제 출전한 주장·정규멤버 비율 1·혼합·0을 그대로 반영한다", () => {
  const team = {
    members: [
      { userId: "captain", role: "captain" },
      { userId: "regular", role: "regular" },
      { userId: "mercenary-1", role: "mercenary" },
      { userId: "mercenary-2", role: "mercenary" },
    ],
  };
  const fullRegularRatio = teamRegularRatio(team, ["captain", "regular"]);
  const mixedRatio = teamRegularRatio(team, ["captain", "regular", "mercenary-1", "mercenary-2"]);
  const mercenaryOnlyRatio = teamRegularRatio(team, ["mercenary-1", "mercenary-2"]);
  const match = makeMatch("3v3");
  const fullDelta = calculateTeamDelta({
    teamMmr: 1200,
    opponentTeamMmr: 1200,
    actual: 1,
    match,
    regularRatio: fullRegularRatio,
  });
  const mixedDelta = calculateTeamDelta({
    teamMmr: 1200,
    opponentTeamMmr: 1200,
    actual: 1,
    match,
    regularRatio: mixedRatio,
  });
  const mercenaryOnlyDelta = calculateTeamDelta({
    teamMmr: 1200,
    opponentTeamMmr: 1200,
    actual: 1,
    match,
    regularRatio: mercenaryOnlyRatio,
  });

  assert.equal(fullRegularRatio, 1);
  assert.equal(mixedRatio, 0.5);
  assert.equal(mercenaryOnlyRatio, 0);
  assert.ok(Math.abs(mixedDelta - fullDelta / 2) <= 0.1);
  assert.equal(mercenaryOnlyDelta, 0);
});

test("개인 스탯과 기록 출처는 로컬 MMR 변화에 영향을 주지 않는다", () => {
  const mode = "3v3";
  const baseMatch = { ...makeMatch(mode), refereeId: "referee-1" };
  const statMatch = {
    ...baseMatch,
    refereeId: "referee-1",
    result: {
      ...baseMatch.result,
      playerStats: {
        "player-a": { points: 999, rebounds: 99, assists: 99, steals: 99, blocks: 99 },
        "player-b": { points: 0, rebounds: 0, assists: 0, steals: 0, blocks: 0 },
      },
      statSubmissions: {
        "player-a": { by: "referee-1", source: "referee" },
        "player-b": { by: "referee-1", source: "referee" },
      },
    },
  };
  const users = [
    { id: "player-a", trustScore: 80, ratings: { integrated: 1200, modes: { [mode]: 1200 } } },
    { id: "player-b", trustScore: 80, ratings: { integrated: 1200, modes: { [mode]: 1200 } } },
  ];
  const ratings = Object.fromEntries(users.map((user) => [user.id, user.ratings]));
  const withoutStats = applyMatchRating(baseMatch, users, ratings, [], []);
  const withStats = applyMatchRating(statMatch, users, ratings, [], []);

  assert.deepEqual(withStats.ratings, withoutStats.ratings);
  assert.deepEqual(withStats.changes, withoutStats.changes);
  assert.ok(withStats.changes.every((change) => change.statBoost === 0));
});

test("심판 stats 전용 프로필 표시와 score-only 정책 계약을 고정한다", async () => {
  const [ratingSource, profileApiSource, playerDetailSource, profileRecordsSource, matchRoomSource, recruitingSource, matchContractSource, logicSource, designSource] = await Promise.all([
    readFile(new URL("../src/lib/rating.js", import.meta.url), "utf8"),
    readFile(new URL("../server/api/profile/me.js", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/PlayerDetail.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/ProfileRecords.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/MatchRoom.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/Recruiting.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/match/MatchContract.jsx", import.meta.url), "utf8"),
    readFile(new URL("../docs/logic-and-terminology.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/design-system.md", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(ratingSource, /calculatePlayerStatBoost/);
  assert.match(ratingSource, /const statBoost = 0/);
  assert.match(profileApiSource, /stat_match_count/);
  assert.match(profileApiSource, /averageFouls: statMatchCount \? fouls \/ statMatchCount : 0/);
  [playerDetailSource, profileRecordsSource].forEach((source) => {
    assert.match(source, /Boolean\(match\.refereeId\).*hasOwnProperty/);
  });
  assert.match(playerDetailSource, /recordedStatHistory\.length/);
  assert.match(profileRecordsSource, /recordedStatRecords\.length/);
  assert.match(matchRoomSource, /\{\(hasReferee \|\| isSoloRecord\) && shouldShowResultEntry \? \(/);
  assert.match(matchRoomSource, /\{match\.result && \(hasReferee \|\| isSoloRecord\) \? \(/);
  assert.match(matchRoomSource, /\{statEditorPlayer && \(hasReferee \|\| isSoloRecord\) \? \(/);
  assert.match(recruitingSource, /matchRoom && Boolean\(sourceMatch\?\.refereeId\) &&/);
  assert.match(recruitingSource, /Boolean\(sourceMatch\.refereeId\).*SourceMatchDisputeEditor/s);
  assert.doesNotMatch(recruitingSource, /경기 종료 전까지 개인활약을 입력합니다/);
  assert.match(recruitingSource, /배정 심판이 팀 점수와 개인 스탯을 정리하고 최종 승인합니다/);
  assert.match(recruitingSource, /방장이 경기 중 기록된 팀 점수를 확인하고 최종 승인합니다/);
  assert.match(recruitingSource, /\$\{authorityLabel\}이 이의제기 \$\{openCount\}건을 사유와 함께 가결 또는 부결/);
  assert.match(matchContractSource, /\{referee \? <div>\s*<span>[^<]+<\/span>\s*<strong>\{match\.statEntryMinutes/);
  [logicSource, designSource].forEach((source) => {
    assert.match(source, /score-only/);
  });
  assert.match(logicSource, /경기시계 담당자·교체 단순화/);
  assert.match(logicSource, /신규 UI와 서버 action에서 사용하지 않는다/);
  assert.match(logicSource, /self-sub/);
  assert.match(logicSource, /stat_match_count/);
  assert.match(designSource, /0 PTS/);
});

test("score policy health owns intentional legacy RPC and auto-finalize exceptions", async () => {
  const [schemaHealthSource, migrationSource] = await Promise.all([
    readFile(new URL("../server/api/system/schema-health.js", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260727123000_match_score_policy_health_alignment.sql", import.meta.url), "utf8"),
  ]);

  assert.match(schemaHealthSource, /checkScoreOperationPolicy/);
  assert.match(schemaHealthSource, /legacyRosterMoveServiceRevoked/);
  assert.match(schemaHealthSource, /autoFinalizeLocked/);
  assert.match(migrationSource, /not coalesce\(has_function_privilege/);
  assert.match(migrationSource, /match_auto_finalization_locked/);
});

test("배치·팀 MMR migration은 소급·용병 비율·계수 분리를 한 번의 확정 경로에 고정한다", async () => {
  const migrationSource = await readFile(
    new URL("../supabase/migrations/20260728110000_player_placement_and_roster_team_mmr.sql", import.meta.url),
    "utf8",
  );

  assert.match(migrationSource, /placement_match_count/);
  assert.match(migrationSource, /status = 'confirmed'/);
  assert.match(migrationSource, /least\(5, count\(\*\)\)/);
  assert.match(migrationSource, /rankball_apply_placement_and_team_rating/);
  assert.match(migrationSource, /team_role in \('captain', 'regular'\)/);
  assert.match(migrationSource, /raw_team_delta \* coalesce\(regular_ratio, 0\)/);
  assert.match(migrationSource, /performance_adjustment between -150 and 150/);
  assert.match(migrationSource, /mmrRangeRatingScale/);
  assert.match(migrationSource, /pickupAssignmentRatingScale/);
  assert.match(migrationSource, /ranked_rating_locked_finalizer_required/);
  assert.doesNotMatch(migrationSource, /drop\s+table|truncate\s+table|delete\s+from/i);
});
