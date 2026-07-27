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
  assert.match(matchRoomSource, /\{hasReferee && shouldShowResultEntry \? \(/);
  assert.match(matchRoomSource, /\{match\.result && hasReferee \? \(/);
  assert.match(matchRoomSource, /\{statEditorPlayer && hasReferee \? \(/);
  assert.match(recruitingSource, /matchRoom && Boolean\(sourceMatch\?\.refereeId\) &&/);
  assert.match(recruitingSource, /Boolean\(sourceMatch\.refereeId\).*SourceMatchDisputeEditor/s);
  assert.doesNotMatch(recruitingSource, /경기 종료 전까지 개인활약을 입력합니다/);
  assert.match(recruitingSource, /팀 점수판이 열려 있습니다\. 경기 종료 전까지 팀 점수를 기록합니다/);
  assert.match(recruitingSource, /const decisionOwner = match\.refereeId \? "배정 심판" : "방장"/);
  assert.match(matchContractSource, /\{referee \? <div>\s*<span>[^<]+<\/span>\s*<strong>\{match\.statEntryMinutes/);
  [logicSource, designSource].forEach((source) => {
    assert.match(source, /score-only/);
  });
  assert.match(logicSource, /takeover/);
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
