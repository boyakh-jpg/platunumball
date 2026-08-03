import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import {
  MATCH_ROOM_SOURCE_PATHS,
  RECRUITING_PAGE_SOURCE_PATHS,
  readSourceGroup,
} from "./management-source-groups.mjs";

import { validateMatchShape } from "../server/api/matches/sync-match.js";
import { validateRecruitingPostShape } from "../server/api/recruiting/sync-post.js";
import { projectActiveRpcContractChecks } from "../server/api/system/schema-health.js";
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
} from "../server/lib/ratingEngine.js";
import { DEFAULT_RATING_POLICY, RATING_POLICY_MODE_IDS } from "../server/lib/ratingPolicy.js";

async function readJavaScriptDirectory(directoryUrl) {
  const names = (await readdir(directoryUrl))
    .filter((name) => name.endsWith(".js"))
    .sort();
  return (await Promise.all(names.map((name) => readFile(new URL(name, directoryUrl), "utf8")))).join("\n");
}

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
    readFile(new URL("../server/lib/ratingEngine.js", import.meta.url), "utf8"),
    readFile(new URL("../server/api/profile/me.js", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/PlayerDetail.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/ProfileRecords.jsx", import.meta.url), "utf8"),
    readSourceGroup((file) => readFile(new URL(`../${file}`, import.meta.url), "utf8"), MATCH_ROOM_SOURCE_PATHS),
    readSourceGroup(
      (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8"),
      RECRUITING_PAGE_SOURCE_PATHS,
    ),
    readFile(new URL("../src/components/match/MatchContract.jsx", import.meta.url), "utf8"),
    readFile(new URL("../docs/logic-and-terminology.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/design-system.md", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(ratingSource, /calculatePlayerStatBoost/);
  assert.match(ratingSource, /const statBoost = 0/);
  assert.match(profileApiSource, /stat_match_count/);
  assert.match(profileApiSource, /averageFouls: statMatchCount \? fouls \/ statMatchCount : 0/);
  [playerDetailSource, profileRecordsSource].forEach((source) => {
    assert.match(source, /hasVerifiedPlayerStats/);
  });
  assert.match(playerDetailSource, /recordedStatHistory\.length/);
  assert.match(profileRecordsSource, /recentSummary\.statGames/);
  assert.match(profileRecordsSource, /summarizeProfileRecords/);
  assert.match(matchRoomSource, /\{\(hasReferee \|\| isSoloRecord\) && shouldShowResultEntry \? \(/);
  assert.match(matchRoomSource, /\{match\.result && \(hasReferee \|\| isSoloRecord\) \? \(/);
  assert.match(matchRoomSource, /(?:\{|return \()statEditorPlayer && \(hasReferee \|\| isSoloRecord\) \? \(/);
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

test("MMR 계산식과 정책 기본값은 서버 전용 모듈에만 남는다", async () => {
  const [publicRating, publicPolicy, publicConstants, publicRepository, serverRating, serverPolicy] = await Promise.all([
    readFile(new URL("../src/lib/rating.js", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/ratingPolicy.js", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/constants.js", import.meta.url), "utf8"),
    readJavaScriptDirectory(new URL("../src/data/repository/", import.meta.url)),
    readFile(new URL("../server/lib/ratingEngine.js", import.meta.url), "utf8"),
    readFile(new URL("../server/lib/ratingPolicy.js", import.meta.url), "utf8"),
  ]);
  const publicSource = [publicRating, publicPolicy, publicConstants, publicRepository].join("\n");

  assert.doesNotMatch(publicSource, /function expectedScore|function getKFactor|ratingWeight|integratedWeight|modeCap|integratedCap|PLACEMENT_PRIOR_WEIGHT|TEAM_PERFORMANCE_ADJUSTMENT_LIMIT/);
  assert.doesNotMatch(publicRepository, /applyMatchRating|calculateTeamDelta|getFinalizationRatingContext/);
  assert.match(serverRating, /function expectedScore/);
  assert.match(serverRating, /export function applyMatchRating/);
  assert.match(serverPolicy, /export const DEFAULT_RATING_POLICY/);
});

test("score policy health owns the auto-finalize exception", async () => {
  const [schemaHealthSource, migrationSource] = await Promise.all([
    readFile(new URL("../server/api/system/schema-health.js", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260727123000_match_score_policy_health_alignment.sql", import.meta.url), "utf8"),
  ]);

  assert.match(schemaHealthSource, /checkScoreOperationPolicy/);
  assert.match(schemaHealthSource, /autoFinalizeLocked/);
  assert.match(migrationSource, /not coalesce\(has_function_privilege/);
  assert.match(migrationSource, /match_auto_finalization_locked/);
});

test("RPC grant health distinguishes current entry points from retired signatures", async () => {
  const [
    schemaHealthSource,
    migrationSource,
    registryDeltaSource,
    seasonRegistrySource,
    courtVerificationRegistrySource,
    previousGeneralHealthSource,
    previousAuthoritativeHealthSource,
  ] = await Promise.all([
    readFile(new URL("../server/api/system/schema-health.js", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../supabase/migrations/20260729162000_align_rpc_grant_health_with_current_policy.sql",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../supabase/migrations/20260730017000_match_record_participants_operation.sql",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../supabase/migrations/20260801007000_canonical_season_rankings.sql",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../supabase/migrations/20260803222000_court_request_ai_verification.sql",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../supabase/migrations/20260713160000_confirm_recruiting_match_atomic_rpc.sql",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../supabase/migrations/20260725010000_remove_legacy_match_dispute_actions.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  const normalizedMigrationSource = migrationSource.replace(/\r\n?/g, "\n");
  const readHealthContracts = (source, functionName) => {
    const start = source.indexOf(`create or replace function public.${functionName}()`);
    const end = source.indexOf(`revoke all on function public.${functionName}()`, start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    return new Set(
      [...source.slice(start, end).matchAll(/\('([^']+)',\s*'public\.[^']+'\)/g)]
        .map((match) => match[1]),
    );
  };
  const registryRows = [
    ...`${migrationSource}\n${registryDeltaSource}\n${seasonRegistrySource}\n${courtVerificationRegistrySource}`.matchAll(
      /\('(general|authoritative)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'(active|retired)',\s*(true|false)\)/g,
    ),
  ].map((match) => ({
    scope: match[1],
    contractName: match[2],
    functionName: match[3],
    signature: match[4],
    lifecycle: match[5],
    serviceRoleExecute: match[6] === "true",
  }));
  const registryByKey = new Map(
    registryRows.map((row) => [`${row.scope}:${row.contractName}`, row]),
  );
  const assertRegistryContract = (scope, contractName, signature, lifecycle) => {
    const row = registryByKey.get(`${scope}:${contractName}`);
    assert.ok(row, `missing registry contract: ${scope}:${contractName}`);
    assert.equal(row.signature, signature);
    assert.equal(row.lifecycle, lifecycle);
  };
  const registryNames = (scope) => new Set(
    registryRows.filter((row) => row.scope === scope).map((row) => row.contractName),
  );
  const previousGeneralNames = readHealthContracts(
    previousGeneralHealthSource,
    "rankball_rpc_grant_health",
  );
  const previousAuthoritativeNames = readHealthContracts(
    previousAuthoritativeHealthSource,
    "rankball_authoritative_rpc_grant_health",
  );
  const generalNames = registryNames("general");
  const authoritativeNames = registryNames("authoritative");
  const activeRegistryFunctionNames = new Set(
    registryRows
      .filter((row) => row.lifecycle === "active")
      .map((row) => row.functionName),
  );
  const activeRegistrySignatures = new Set(
    registryRows
      .filter((row) => row.lifecycle === "active")
      .map((row) => row.signature),
  );
  const reviewedServiceOnlySignatures = `
public.rankball_admin_auto_group_nearby_courts(text,integer,text,text,text)
public.rankball_admin_level_for_profile(text,integer)
public.rankball_admin_review_court_with_auto_unit(text,integer,text,text,jsonb,text)
public.rankball_admin_update_court_with_auto_unit(text,integer,text,jsonb,text)
public.rankball_admin_update_courts_batch_with_auto_unit(text,integer,jsonb,text)
public.rankball_admin_verify_nearby_court_count(text,integer,text,integer,text,jsonb,text)
public.rankball_assert_match_actor_active(text)
public.rankball_cleanup_simulation_artifacts()
public.rankball_cleanup_simulation_notices()
public.rankball_cleanup_simulation_recruiting_artifacts(integer)
public.rankball_court_detail_review_rows(text,text,integer)
public.rankball_court_reviewable_matches(text,text,text,integer)
public.rankball_event_profile_eligible(text,boolean,text,numeric,text,jsonb)
public.rankball_event_profile_mmr(text)
public.rankball_expire_unconfirmed_recruiting_rooms(timestamptz)
public.rankball_extend_admin_appointment_action(text,integer,text,integer,text)
public.rankball_match_clock_action(text,text,text,jsonb)
public.rankball_match_confirm_pickup_assignment(text,text,text,integer)
public.rankball_match_generate_pickup_assignment(text,text,text)
public.rankball_match_record_participants_action(text,text,jsonb)
public.rankball_match_room_update_action(text,text,jsonb)
public.rankball_season_rankings(text,text)
public.rankball_match_rule_ack_action(text,text,integer)
public.rankball_match_schedule_response_action(text,text,text,text)
public.rankball_match_start_action_guarded(text,text,text,text,jsonb)
public.rankball_match_swap_pickup_players(text,text,text,text)
public.rankball_match_team_roster_action(text,text,jsonb)
public.rankball_moderate_reported_name(text,integer,text,text,text,text,text,text)
public.rankball_quarantine_simulation_artifacts(timestamptz)
public.rankball_recruiting_close_with_reason_action(text,text,text)
public.rankball_recruiting_expire_room_change(text)
public.rankball_recruiting_room_update_action(text,text,jsonb)
public.rankball_recruiting_rule_ack_action(text,text,integer)
public.rankball_recruiting_schedule_response_action(text,text,text,text)
public.rankball_recruiting_set_room_team_action(text,text,text,text)
public.rankball_recruiting_side_party_join_action(text,text,text,text,text)
public.rankball_refresh_match_feed_for_match(text)
public.rankball_refresh_recruiting_feed_for_post(text)
public.rankball_related_active_match_list(text,integer,boolean)
public.rankball_review_void_match_report(text,integer,text,text,text,text,integer,text,text)
public.rankball_set_profile_affiliation(text,text,text)
public.rankball_tournament_lineup_deadline_batch_action(timestamptz,integer)
public.rankball_tournament_match_forfeit_action(text,text,text,text,text)
public.rankball_update_team_emblem_design(text,text,text,boolean,text,text,text,text)
`.trim().split(/\r?\n/);
  const browserRpcAllowlist = new Set(["rankball_can_access_recruiting_room_chat"]);
  const serverRpcNames = new Set();
  const scanServerRpcNames = async (directoryUrl) => {
    const entries = await readdir(directoryUrl, { withFileTypes: true });
    await Promise.all(entries.map(async (entry) => {
      const childUrl = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directoryUrl);
      if (entry.isDirectory()) {
        await scanServerRpcNames(childUrl);
        return;
      }
      if (!entry.isFile() || !entry.name.endsWith(".js")) return;
      const source = await readFile(childUrl, "utf8");
      [...source.matchAll(/\.rpc\(\s*["'](rankball_[A-Za-z0-9_]+)["']/g)]
        .forEach((match) => serverRpcNames.add(match[1]));
    }));
  };
  await scanServerRpcNames(new URL("../server/", import.meta.url));
  const legacyRevokeStart = normalizedMigrationSource.indexOf("foreach legacy_signature");
  const legacyRevokeEnd = normalizedMigrationSource.indexOf("]\n  loop", legacyRevokeStart);
  assert.notEqual(legacyRevokeStart, -1);
  assert.notEqual(legacyRevokeEnd, -1);
  const legacyRevokeSource = normalizedMigrationSource.slice(legacyRevokeStart, legacyRevokeEnd);
  const healthWrapperSource = normalizedMigrationSource.slice(
    normalizedMigrationSource.indexOf("create or replace function public.rankball_rpc_grant_health()"),
  );
  const replacedGeneralContracts = new Set([
    "rankball_match_late_player_action",
    "rankball_match_roster_move_action",
    "rankball_recruiting_stat_recorder_action",
  ]);

  assert.ok(previousGeneralNames.size >= 40);
  assert.ok(previousAuthoritativeNames.size >= 10);
  assert.ok(generalNames.size >= previousGeneralNames.size);
  assert.ok(authoritativeNames.size >= previousAuthoritativeNames.size);
  assert.equal(registryByKey.size, registryRows.length);
  registryRows.forEach((row) => {
    assert.equal(row.serviceRoleExecute, row.lifecycle === "active");
  });
  assertRegistryContract(
    "authoritative",
    "rankball_match_resolve_dispute_action",
    "public.rankball_match_resolve_dispute_action(text,text,text,text,text)",
    "active",
  );
  assertRegistryContract(
    "authoritative",
    "rankball_match_resolve_dispute_action_legacy_4arg",
    "public.rankball_match_resolve_dispute_action(text,text,text,text)",
    "retired",
  );
  assertRegistryContract(
    "general",
    "rankball_match_terminal_action",
    "public.rankball_match_terminal_action(text,text,text,text)",
    "active",
  );
  assertRegistryContract(
    "general",
    "rankball_match_terminal_action_legacy_3arg",
    "public.rankball_match_terminal_action(text,text,text)",
    "retired",
  );
  assertRegistryContract(
    "general",
    "rankball_match_list",
    "public.rankball_match_list(text,integer,text,boolean)",
    "active",
  );
  assertRegistryContract(
    "general",
    "rankball_match_list_legacy_3arg",
    "public.rankball_match_list(text,integer,text)",
    "retired",
  );
  assert.equal(reviewedServiceOnlySignatures.length, 44);
  assert.equal(new Set(reviewedServiceOnlySignatures).size, 44);
  reviewedServiceOnlySignatures.forEach((signature) => {
    assert.ok(
      activeRegistrySignatures.has(signature),
      `reviewed service-only RPC missing from active registry: ${signature}`,
    );
  });
  assert.deepEqual(
    [...browserRpcAllowlist],
    ["rankball_can_access_recruiting_room_chat"],
  );
  assert.deepEqual(
    [...serverRpcNames].filter((name) => browserRpcAllowlist.has(name)).sort(),
    [...browserRpcAllowlist].sort(),
  );
  browserRpcAllowlist.forEach((name) => {
    assert.equal(activeRegistryFunctionNames.has(name), false);
  });
  assert.deepEqual(
    [...serverRpcNames]
      .filter((name) => !activeRegistryFunctionNames.has(name) && !browserRpcAllowlist.has(name))
      .sort(),
    [],
  );
  assert.equal(
    registryRows.filter((row) => row.functionName === "rankball_save_profile_icon_settings").length,
    2,
  );
  assert.doesNotMatch(schemaHealthSource, /const REQUIRED_RPCS = \[/);
  assert.doesNotMatch(schemaHealthSource, /async function checkRpc\(/);
  assert.doesNotMatch(schemaHealthSource, /p_actor_profile_id:\s*""/);
  assert.match(schemaHealthSource, /projectActiveRpcContractChecks/);
  assert.match(
    schemaHealthSource,
    /const rpcChecks = projectActiveRpcContractChecks\(rpcGrantCheck\)/,
  );
  assert.match(schemaHealthSource, /rpc_contract_registry_health_missing/);
  assert.match(
    schemaHealthSource,
    /rpc_grant:rankball_rpc_contract_registry_acl/,
  );
  assert.match(schemaHealthSource, /checkMatchOverlapPolicy/);
  assert.match(
    schemaHealthSource,
    /client\.rpc\("rankball_match_overlap_policy_health"\)/,
  );
  assert.doesNotMatch(schemaHealthSource, /legacyRosterMoveServiceRevoked/);
  assert.match(migrationSource, /create table if not exists public\.rankball_rpc_contract_registry/);
  assert.match(migrationSource, /alter table public\.rankball_rpc_contract_registry enable row level security/);
  assert.match(
    migrationSource,
    /revoke all on table public\.rankball_rpc_contract_registry[\s\S]*service_role/,
  );
  assert.match(migrationSource, /from public\.rankball_rpc_contract_registry registry/);
  assert.match(migrationSource, /from public\.rankball_rpc_contract_health\('general'\)/);
  assert.match(migrationSource, /from public\.rankball_rpc_contract_health\('authoritative'\)/);
  assert.match(migrationSource, /on conflict \(contract_scope, contract_name\) do update/);
  assert.doesNotMatch(healthWrapperSource, /with required\(function_name, signature\)/);
  assert.match(
    migrationSource,
    /revoke all on function public\.rankball_rpc_contract_health\(text\)[\s\S]*service_role/,
  );
  previousGeneralNames.forEach((contractName) => {
    if (!replacedGeneralContracts.has(contractName)) {
      assert.ok(generalNames.has(contractName), `missing general RPC contract: ${contractName}`);
    }
  });
  previousAuthoritativeNames.forEach((contractName) => {
    if (contractName !== "rankball_recruiting_stat_recorder_action") {
      assert.ok(
        authoritativeNames.has(contractName),
        `missing authoritative RPC contract: ${contractName}`,
      );
    }
  });
  assert.match(migrationSource, /'rankball_match_roster_transition_action'[\s\S]*'active', true/);
  assert.match(migrationSource, /'rankball_match_finalize_locked'[\s\S]*text,text,text,boolean[\s\S]*'active', true/);
  assert.match(
    registryDeltaSource,
    /'rankball_match_record_participants_action'[\s\S]*text,text,jsonb[\s\S]*'active'[\s\S]*true/,
  );
  assert.match(migrationSource, /rankball_match_late_player_action_legacy[\s\S]*'retired', false/);
  assert.match(migrationSource, /rankball_match_roster_move_action_legacy[\s\S]*'retired', false/);
  assert.match(migrationSource, /rankball_recruiting_stat_recorder_action_legacy[\s\S]*'retired', false/);
  assert.match(migrationSource, /rankball_match_finalize_locked_legacy_3arg[\s\S]*'retired', false/);
  assert.match(migrationSource, /rankball_match_resolve_dispute_action_legacy_4arg[\s\S]*'retired', false/);
  assert.match(migrationSource, /rankball_match_terminal_action_legacy_3arg[\s\S]*'retired', false/);
  assert.match(migrationSource, /rankball_match_list_legacy_3arg[\s\S]*'retired', false/);
  [
    "public.rankball_match_resolve_dispute_action(text,text,text,text)",
    "public.rankball_match_terminal_action(text,text,text)",
    "public.rankball_match_list(text,integer,text)",
  ].forEach((signature) => {
    assert.ok(legacyRevokeSource.includes(signature));
  });
  assert.match(migrationSource, /expectedServiceRoleExecute/);
  assert.doesNotMatch(
    migrationSource,
    /grant execute on function public\.rankball_match_(?:late_player_action|roster_move_action)\(/,
  );
  assert.doesNotMatch(
    migrationSource,
    /grant execute on function public\.rankball_recruiting_stat_recorder_action\(/,
  );
  assert.doesNotMatch(
    migrationSource,
    /grant execute on function public\.rankball_match_finalize_locked\(\s*text,\s*text,\s*text\s*\)/,
  );
});

test("schema health projects active registry contracts into the legacy rpcChecks shape", () => {
  const rpcChecks = projectActiveRpcContractChecks({
    ok: false,
    error: null,
    checks: [
      {
        check_name: "rpc_grant:rankball_example_action",
        ok: true,
        detail: {
          function: "rankball_example_action",
          lifecycle: "active",
          signature: "public.rankball_example_action(text)",
        },
      },
      {
        check_name: "authoritative_rpc_grant:rankball_example_action",
        ok: false,
        detail: {
          function: "rankball_example_action",
          lifecycle: "active",
          signature: "public.rankball_example_action(text)",
        },
      },
      {
        check_name: "rpc_grant:rankball_retired_action",
        ok: true,
        detail: {
          function: "rankball_retired_action",
          lifecycle: "retired",
          signature: "public.rankball_retired_action(text)",
        },
      },
      {
        check_name: "rpc_grant:rankball_rpc_contract_registry_acl",
        ok: true,
        detail: { table: "rankball_rpc_contract_registry" },
      },
    ],
  });

  assert.equal(rpcChecks.length, 1);
  assert.equal(rpcChecks[0].rpc, "rankball_example_action");
  assert.equal(rpcChecks[0].ok, false);
  assert.equal(rpcChecks[0].probeError, null);
  assert.deepEqual(rpcChecks[0].contractChecks, [
    "rpc_grant:rankball_example_action",
    "authoritative_rpc_grant:rankball_example_action",
  ]);
  assert.match(rpcChecks[0].error, /authoritative_rpc_grant:rankball_example_action/);

  assert.deepEqual(
    projectActiveRpcContractChecks({
      ok: false,
      error: "rpc_grant_health_failed",
      checks: [],
    }),
    [{
      rpc: "rankball_rpc_contract_registry",
      ok: false,
      error: "rpc_grant_health_failed",
      probeError: null,
      contractChecks: [],
    }],
  );
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
