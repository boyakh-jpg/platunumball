import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildMatchResultSubmission } from "../shared/lib/matchRecordVerification.js";
import { getMatchResultEntryPermission } from "../shared/lib/matchResultEntry.js";
import {
  getMatchFinalizationWindow,
  getMatchRoomPhase,
  hasMatchFinalSubmission,
  isMatchInPlayMenu,
} from "../shared/lib/matchRoomLifecycle.js";
import { isPlayableMatchRow } from "../server/api/matches/_listProjection.js";

const root = new URL("../", import.meta.url);
const readSource = (path) => readFile(new URL(path, root), "utf8");
const endedAt = "2026-08-21T00:00:00.000Z";
const finalSubmittedAt = "2026-08-21T00:01:00.000Z";

function makeMatch(overrides = {}) {
  return {
    id: "explicit-final-match",
    status: "agreed",
    createdBy: "host",
    startedAt: "2026-08-20T23:00:00.000Z",
    endedAt,
    refereeId: null,
    disputeMinutes: 10,
    statEntryMinutes: 10,
    teamA: { players: ["host"], score: 4 },
    teamB: { players: ["guest"], score: 4 },
    rules: { recordType: "match" },
    result: {
      scoreA: 4,
      scoreB: 4,
      submittedBy: "host",
      submittedAt: endedAt,
    },
    disputes: [],
    ...overrides,
  };
}

test("명시 최종 제출 없는 종료 경기는 기록 입력창까지만 Play에 남는다", () => {
  const agreed = makeMatch();
  const legacyApproval = makeMatch({ status: "approval" });
  const openDispute = makeMatch({
    status: "disputed",
    disputes: [{ id: "open-dispute", status: "open" }],
  });

  assert.equal(hasMatchFinalSubmission(agreed), false);
  assert.equal(getMatchRoomPhase(agreed, "2026-08-21T01:00:00.000Z").phase, "postgame");
  assert.equal(getMatchRoomPhase(legacyApproval, "2026-08-21T01:00:00.000Z").phase, "postgame");
  assert.equal(isMatchInPlayMenu(agreed, "2026-08-21T00:05:00.000Z"), true);
  assert.equal(isMatchInPlayMenu(agreed, "2026-08-21T01:00:00.000Z"), false);
  assert.equal(isMatchInPlayMenu(legacyApproval, "2026-08-21T01:00:00.000Z"), false);
  assert.equal(isMatchInPlayMenu(openDispute, "2026-08-21T01:00:00.000Z"), true);
});

test("명시 최종 제출 시각부터 이의·확정 창을 계산한다", () => {
  const match = makeMatch({
    status: "approval",
    result: {
      ...makeMatch().result,
      finalSubmittedBy: "host",
      finalSubmittedAt,
    },
  });

  assert.equal(hasMatchFinalSubmission(match), true);
  assert.equal(getMatchRoomPhase(match, "2026-08-21T00:05:00.000Z").phase, "dispute");
  assert.equal(getMatchRoomPhase(match, "2026-08-21T00:12:00.000Z").phase, "record");
  assert.equal(isMatchInPlayMenu(match, "2026-08-21T00:12:00.000Z"), false);

  const manualWindow = getMatchFinalizationWindow(match, "2026-08-21T00:05:00.000Z");
  assert.equal(manualWindow.ready, true);
  assert.equal(manualWindow.automaticReady, false);
  assert.equal(
    getMatchFinalizationWindow(match, "2026-08-21T00:11:00.000Z").automaticReady,
    true,
  );
});

test("무심판 경기 방장은 canonical 점수만 명시 제출하고 +/-는 사용하지 않는다", () => {
  const match = makeMatch();
  const host = getMatchResultEntryPermission(match, "host", {
    canOperatePostStart: true,
    now: "2026-08-21T00:02:00.000Z",
  });
  const regular = getMatchResultEntryPermission(match, "guest", {
    canOperatePostStart: false,
    now: "2026-08-21T00:02:00.000Z",
  });

  assert.equal(host.canSubmitMissingPostgameResult, true);
  assert.deepEqual(host.editableScoreSides, []);
  assert.equal(regular.canSubmitMissingPostgameResult, false);
  assert.equal(
    getMatchResultEntryPermission(match, "host", {
      canOperatePostStart: true,
      now: "2026-08-21T01:00:00.000Z",
    }).canSubmitMissingPostgameResult,
    true,
  );
  assert.equal(
    getMatchResultEntryPermission({ ...match, status: "approval" }, "host", {
      canOperatePostStart: true,
      now: "2026-08-21T00:02:00.000Z",
    }).canSubmitMissingPostgameResult,
    false,
  );

  const submission = buildMatchResultSubmission(
    match,
    { playerStats: { host: { points: 0 }, guest: { points: 0 } } },
    () => [],
    { editableScoreSides: [], preserveCanonicalScores: true },
  );
  assert.equal(submission.scoreA, 4);
  assert.equal(submission.scoreB, 4);
});

test("SQL은 legacy 결과만 backfill하고 terminal 경기를 재활성화하지 않는다", async () => {
  const source = await readSource("supabase/migrations/20260821150000_explicit_match_final_submission_and_recorder_page.sql");
  const wrapperStart = source.indexOf("create or replace function public.rankball_match_result_action(");
  const wrapperEnd = source.indexOf("$function$;", wrapperStart);
  assert.ok(wrapperStart >= 0 && wrapperEnd > wrapperStart);
  const wrapperSource = source.slice(wrapperStart, wrapperEnd);

  assert.match(
    source,
    /rankball_match_result_action\(\s*p_actor_profile_id text,\s*p_match_id text,\s*p_result jsonb default '\{\}'::jsonb/su,
  );
  assert.doesNotMatch(source, /rankball_match_result_action\(\s*p_actor_id text/su);
  const backfillSource = source.slice(0, source.indexOf("do $migration$"));
  assert.match(backfillSource, /update public\.match_results result[\s\S]*match_row\.status in \('approval', 'disputed'\)[\s\S]*result\.final_submitted_at is null/u);
  assert.doesNotMatch(backfillSource, /match_row\.status in \('agreed',[^)]*'approval'/u);
  assert.doesNotMatch(backfillSource, /insert into public\.match_results/u);
  assert.match(source, /if is_explicit_final_submission and \([\s\S]*not is_standard_match[\s\S]*match_row\.status is distinct from 'agreed'[\s\S]*match_row\.ended_at is null[\s\S]*result_row\.final_submitted_at is not null[\s\S]*raise exception 'final result submission is not allowed/u);
  assert.match(source, /match_row\.status = 'agreed'[\s\S]*match_row\.ended_at is not null[\s\S]*result_row\.final_submitted_at is null/u);
  assert.doesNotMatch(source, /match_row\.status in \('agreed', 'approval', 'disputed', 'confirmed', 'closed', 'void', 'cancelled'\)/u);
  assert.match(source, /safe_result \? 'periodScores'[\s\S]*invalid_match_period_scores[\s\S]*period_score_total_mismatch/u);
  assert.match(source, /on conflict \(match_id\) do update[\s\S]*period_scores = excluded\.period_scores/u);
  assert.match(
    wrapperSource,
    /if is_standard_match\s+and match_row\.status = 'agreed'\s+and match_row\.ended_at is not null\s+and result_row\.final_submitted_at is null\s+and not is_explicit_final_submission then\s+raise exception 'explicit final result submission is required'/u,
  );
  assert.match(
    source,
    /revoke all on function public\.rankball_match_result_action_pre_explicit_final_submission\(text, text, jsonb\)[\s\S]*from public, anon, authenticated, service_role/u,
  );
  assert.match(
    source,
    /revoke all on function public\.rankball_match_result_action\(text, text, jsonb\)[\s\S]*from public, anon, authenticated, service_role;[\s\S]*grant execute on function public\.rankball_match_result_action\(text, text, jsonb\) to service_role/u,
  );
});

test("서버만 canonical 경기 상태에서 explicit marker를 만들고 RPC 인자명을 보존한다", async () => {
  const source = await readSource("server/lib/matchSqlCoreActions.js");

  assert.match(source, /sourceMatch\?\.endedAt[\s\S]*sourceMatch\?\.status === "agreed"[\s\S]*!sourceMatch\?\.result\?\.finalSubmittedAt/u);
  assert.match(source, /finalSubmission: explicitFinalSubmission/u);
  assert.match(source, /p_actor_profile_id: context\.profileId/u);
  assert.doesNotMatch(source, /finalSubmission: operation\.result/u);
});

test("자동 확정과 Play 조회는 marker·phase·relation을 pagination 전에 강제한다", async () => {
  const [automaticSource, listSource, projectionSource, loaderSource, migrationSource, recorderPageSource] = await Promise.all([
    readSource("src/data/repository/lifecycle/automatic.js"),
    readSource("server/api/matches/_listQueries.js"),
    readSource("server/api/matches/_listProjection.js"),
    readSource("server/api/matches/_listLoader.js"),
    readSource("supabase/migrations/20260821210000_expire_unsubmitted_postgame_play_rows.sql"),
    readSource("src/pages/Recorder.jsx"),
  ]);
  const recorderStart = migrationSource.indexOf("create or replace function public.rankball_recorder_match_page");
  const recorderEnd = migrationSource.indexOf("$function$;", recorderStart);
  assert.ok(recorderStart >= 0 && recorderEnd > recorderStart);
  const recorderSource = migrationSource.slice(recorderStart, recorderEnd);
  const rowProjectionStart = projectionSource.indexOf("export function isPlayableMatchRow");
  const rowProjectionEnd = projectionSource.indexOf("export function getMatchRowActorIds", rowProjectionStart);
  assert.ok(rowProjectionStart >= 0 && rowProjectionEnd > rowProjectionStart);
  const rowProjectionSource = projectionSource.slice(rowProjectionStart, rowProjectionEnd);
  const playPageStart = listSource.indexOf("export async function fetchPlayMatchPage");
  const nextExportStart = listSource.indexOf("\nexport ", playPageStart + 1);
  const playPageEnd = nextExportStart >= 0 ? nextExportStart : listSource.length;
  assert.ok(playPageStart >= 0 && playPageEnd > playPageStart);
  const playPageSource = listSource.slice(playPageStart, playPageEnd);
  const legacyLoaderStart = loaderSource.indexOf("} else if (!playOnly) {");
  const playLoaderStart = loaderSource.indexOf("if (playOnly) {", legacyLoaderStart);
  assert.ok(legacyLoaderStart >= 0 && playLoaderStart > legacyLoaderStart);
  const legacyLoaderSource = loaderSource.slice(legacyLoaderStart, playLoaderStart);

  assert.match(automaticSource, /hasMatchFinalSubmission\(current\)/u);
  assert.match(automaticSource, /getMatchFinalizationWindow\(current, nowMs\)/u);
  assert.match(automaticSource, /finalizationWindow\.automaticReady/u);
  assert.ok(listSource.indexOf('rpc("rankball_recorder_match_page"') < listSource.indexOf('.from("user_room_feed")'));
  assert.match(listSource, /while \(scanned < MATCH_FEED_ROW_MAX_LIMIT/u);
  assert.match(listSource, /const seenEligibleIds = new Set\(\)/u);
  assert.match(listSource, /seenEligibleIds\.has\(row\.id\)/u);
  assert.match(playPageSource, /cursorError\.code = "PLAY_CURSOR_UNAVAILABLE"/u);
  assert.ok(playPageSource.indexOf("PLAY_CURSOR_UNAVAILABLE") < playPageSource.indexOf("getMineOffsetCursor(cursor)"));
  assert.match(legacyLoaderSource, /fetchCurrentUserMatchPage/u);
  assert.match(rowProjectionSource, /row\.created_by/u);
  assert.match(rowProjectionSource, /row\.referee_id/u);
  assert.match(rowProjectionSource, /players\.map\(\(player\) => player\.user_id\)/u);
  assert.match(rowProjectionSource, /row\.played_player_ids/u);
  assert.match(rowProjectionSource, /row\.reserve_players/u);
  assert.doesNotMatch(rowProjectionSource, /former_referee|stat_recorders|submitted_by/u);
  assert.match(recorderSource, /match_row\.created_by = safe_profile_id/u);
  assert.match(recorderSource, /match_row\.referee_id = safe_profile_id/u);
  assert.match(recorderSource, /from public\.match_players player[\s\S]*player\.user_id = safe_profile_id/u);
  assert.match(recorderSource, /match_row\.played_player_ids -> 'teamA'/u);
  assert.match(recorderSource, /match_row\.reserve_players -> 'teamA'/u);
  assert.doesNotMatch(recorderSource, /former_referee|stat_recorders|submitted_by/u);
  assert.match(recorderSource, /recordType', 'standard'\) not in \('personal_record', 'solo'\)/u);
  assert.match(recorderSource, /result\.final_submitted_at is null[\s\S]*clock_timestamp\(\) <= match_row\.ended_at[\s\S]*stat_entry_minutes/u);
  assert.doesNotMatch(recorderSource, /recordType'[^\n]*not in \([^\n]*'match_record'/u);
  const relationIndex = recorderSource.indexOf("match_row.created_by = safe_profile_id");
  const phaseIndex = recorderSource.indexOf("and match_row.status in ('agreed', 'approval', 'disputed')");
  const cursorIndex = recorderSource.indexOf("cursor_created_at is null");
  const limitIndex = recorderSource.indexOf("limit safe_limit + 1");
  assert.ok(relationIndex >= 0 && relationIndex < limitIndex);
  assert.ok(phaseIndex >= 0 && phaseIndex < limitIndex);
  assert.ok(cursorIndex >= 0 && cursorIndex < limitIndex);
  assert.match(recorderSource, /order by coalesce\(match_row\.created_at,[^\n]+desc, match_row\.id desc[\s\S]*limit safe_limit \+ 1/u);
  assert.doesNotMatch(recorderSource, /offset safe_offset/u);
  assert.match(loaderSource, /const hydrationRows = playOnly \? readableRows : readableRows\.filter/u);
  assert.match(loaderSource, /\.filter\(\(match\) => playOnly \|\| filterMatchItems\(\[match\]\)\.length > 0\)/u);
  assert.match(loaderSource, /matches = playOnly[\s\S]*sortByFeedOrder\(countedMatches, playPageIds\)/u);
  assert.match(recorderPageSource, /const isReferee = isMatchReferee\(match, user\.id\);/u);
  assert.doesNotMatch(recorderPageSource, /const isReferee =[^;]*canOperateAssignedMatchReferee/u);
});

test("legacy feed의 former referee 후보는 현재 canonical 관계가 없으면 Play에서 제외한다", () => {
  const legacyFormerRefereeOnly = {
    id: "legacy-former-referee",
    status: "agreed",
    created_by: "host",
    referee_id: "current-referee",
    former_referee_id: "former-referee",
    played_player_ids: { teamA: [], teamB: [] },
    reserve_players: { teamA: [], teamB: [] },
    rules: { recordType: "standard" },
  };

  assert.equal(isPlayableMatchRow(legacyFormerRefereeOnly, [], "former-referee"), false);
  assert.equal(isPlayableMatchRow(legacyFormerRefereeOnly, [], "current-referee"), true);
});
