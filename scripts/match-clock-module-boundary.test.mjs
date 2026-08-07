import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { getMatchClockRecognition } from "../src/lib/matchClock.js";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, "$1"));
const MODULE_LIMITS = new Map([
  ["src/components/match/MatchClockPanel.jsx", 500],
  ["src/components/match/MatchClockPanelView.jsx", 500],
  ["src/components/match/MatchScoreControls.jsx", 250],
  ["src/components/match/useMatchClockRequests.js", 250],
  ["src/lib/matchClockAudio.js", 250],
]);

test("match clock panel delegates score controls and audio without growing back", async () => {
  const sources = Object.fromEntries(await Promise.all(
    [...MODULE_LIMITS].map(async ([relativePath]) => [
      relativePath,
      await readFile(path.join(ROOT, relativePath), "utf8"),
    ]),
  ));

  for (const [relativePath, maxLines] of MODULE_LIMITS) {
    const lineCount = sources[relativePath].split(/\r?\n/u).length;
    assert.ok(lineCount <= maxLines, `${relativePath}: ${lineCount}/${maxLines} lines`);
  }

  const panel = [
    sources["src/components/match/MatchClockPanel.jsx"],
    sources["src/components/match/MatchClockPanelView.jsx"],
  ].join("\n");
  assert.match(panel, /from "\.\/MatchScoreControls\.jsx"/u);
  assert.match(panel, /from "\.\.\/\.\.\/lib\/matchClockAudio\.js"/u);
  assert.match(panel, /export \{ default as MatchScoreControls \}/u);
  assert.doesNotMatch(panel, /\b(?:AudioContext|webkitAudioContext)\b/u);
  assert.doesNotMatch(panel, /브라우저 전체화면/u);
  assert.match(sources["src/components/match/MatchClockPanel.jsx"], /const openFocusMode = async \(\) => \{\s*if \(isPending\) return;/u);
  assert.match(sources["src/components/match/MatchClockPanel.jsx"], /if \(action === "start"\) void openFocusMode\(\);/u);
  assert.match(sources["src/components/match/MatchClockPanel.jsx"], /if \(!succeeded && action === "start"\) void closeFocusMode\(\);/u);
  assert.match(sources["src/components/match/MatchClockPanelView.jsx"], /aria-pressed=\{focusMode\}\s+disabled=\{isPending\}/u);
  assert.doesNotMatch(
    sources["src/components/match/MatchScoreControls.jsx"],
    /from "\.\/MatchClockPanel\.jsx"/u,
  );
  assert.doesNotMatch(
    sources["src/components/match/MatchClockPanelView.jsx"],
    /from "\.\/MatchClockPanel\.jsx"/u,
  );
  assert.match(sources["src/lib/matchClockAudio.js"], /window\.AudioContext \|\| window\.webkitAudioContext/u);
  assert.doesNotMatch(sources["src/lib/matchClockAudio.js"], /buzzerMediaElement/u);
  assert.match(sources["src/components/match/MatchClockPanelView.jsx"], /onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/u);
  assert.doesNotMatch(
    sources["src/lib/matchClockAudio.js"],
    /from ["'][^"']*MatchClockPanel\.jsx["']/u,
  );
});

test("24초 샷클락 옵션은 UI와 DB constraint 및 RPC에서 동일하게 허용한다", async () => {
  const [clockSource, viewSource, audioSource, migrationSource, schemaSource] = await Promise.all([
    readFile(path.join(ROOT, "src/lib/matchClock.js"), "utf8"),
    readFile(path.join(ROOT, "src/components/match/MatchClockPanelView.jsx"), "utf8"),
    readFile(path.join(ROOT, "src/lib/matchClockAudio.js"), "utf8"),
    readFile(path.join(ROOT, "supabase/migrations/20260730224000_align_match_clock_24_second_option.sql"), "utf8"),
    readFile(path.join(ROOT, "supabase/schema.sql"), "utf8"),
  ]);

  assert.match(clockSource, /value:\s*24,\s*label:\s*"24/u);
  assert.match(migrationSource, /where shot_clock_seconds = 35/u);
  assert.match(migrationSource, /check \(shot_clock_seconds in \(0, 24, 30, 60\)\)/u);
  assert.match(migrationSource, /next_shot_seconds not in \(0, 24, 30, 60\)/u);
  assert.match(schemaSource, /align the live match clock with the 24-second UI option/u);
  assert.match(viewSource, /disabled=\{Boolean\(pendingAction\) \|\| !selectedControllerId\}/u);
  assert.match(audioSource, /invalid_shot_clock_seconds:[^\n]*24초/u);
});

test("경기시계 인정 진행률은 전체 시간이 아니라 최소 인정시간을 기준으로 계산한다", async () => {
  assert.deepEqual(
    getMatchClockRecognition({
      activeElapsedMs: 210000,
      minimumActiveMs: 420000,
      clockUsed: false,
      startedWithinWindow: true,
    }),
    { ratio: 0.5, recognized: false, startedInWindow: true },
  );

  const viewSource = await readFile(
    path.join(ROOT, "src/components/match/MatchClockPanelView.jsx"),
    "utf8",
  );
  assert.match(viewSource, /인정 기준 진행/u);
  assert.match(viewSource, /단일 경기에는 다음 쿼터가 없습니다/u);
  assert.match(viewSource, /시계 종료/u);
  assert.match(viewSource, /경기 종료/u);
  assert.doesNotMatch(viewSource, /시계 종료 · 인정 판정|경기 종료 · 기록으로/u);
  assert.match(viewSource, /!match\.refereeId && !focusMode/u);
  assert.match(viewSource, /aria-label=\{`\$\{label\} 점수 조정`\}/u);
  assert.match(viewSource, /!match\.refereeId/u);
  assert.match(viewSource, /`연장 \$\{liveClock\.overtimeCount\} 종료`/u);
  assert.match(viewSource, /canResumeEndedClock[\s\S]*runAction\("resume"\)/u);
  assert.match(viewSource, /requiresForcedMatchEnd \? "강제 종료" : "경기 종료"/u);
  assert.match(viewSource, /Math\.floor\(recognition\.ratio \* 100\)/u);
});

test("최소 인정시간 전 종료만 강제 문구를 쓰고 경기 종료는 같은 lifecycle action을 유지한다", async () => {
  const [migration, panelSource, clockStyles] = await Promise.all([
    readFile(path.join(ROOT, "supabase/migrations/20260803120000_resume_unrecognized_match_clock.sql"), "utf8"),
    readFile(path.join(ROOT, "src/components/match/MatchClockPanel.jsx"), "utf8"),
    readFile(path.join(ROOT, "src/styles/responsive/match-clock-responsive.css"), "utf8"),
  ]);

  assert.match(migration, /session_row\.status not in \('paused', 'ended'\)/u);
  assert.match(migration, /session_row\.clock_ended_at := null/u);
  assert.match(migration, /current_match\.ended_at is not null/u);
  assert.match(panelSource, /인정시간이 부족해 경기시계는 미사용 처리됩니다/u);
  assert.match(panelSource, /const requiresForcedMatchEnd = recognition\.ratio < 1;/u);
  assert.doesNotMatch(panelSource, /!recognition\.startedInWindow \|\| recognition\.ratio < 1/u);
  assert.match(panelSource, /시작 인정시간을 지나 시계를 시작해 경기시계는 미사용 처리됩니다/u);
  assert.match(panelSource, /const response = await onEndMatch\(\)/u);
  assert.match(clockStyles, /@container \(width > 680px\)[\s\S]*grid-template-areas: "score shot"/u);
  assert.match(clockStyles, /@container \(width > 960px\)[\s\S]*grid-template-areas: "score attendance shot"/u);
  assert.doesNotMatch(migration, /\b(?:delete|truncate|drop table)\b/iu);
});

test("actual referee match keeps one clock lifecycle from start through overtime and result sync", async () => {
  const [
    migrationSource,
    clockCoreSource,
    overtimeSource,
    controllerSource,
    clockApiSource,
    panelSource,
    viewSource,
    matchAccessSource,
    matchRoomSource,
    recruitingSource,
  ] = await Promise.all([
    readFile(path.join(ROOT, "supabase/migrations/20260730233000_referee_clock_lifecycle_and_result_score.sql"), "utf8"),
    readFile(path.join(ROOT, "supabase/migrations/20260724173000_match_clock_server_verification.sql"), "utf8"),
    readFile(path.join(ROOT, "supabase/migrations/20260725024000_match_clock_explicit_end_and_scoreless_overtime.sql"), "utf8"),
    readFile(path.join(ROOT, "supabase/migrations/20260728124000_simplify_live_match_operations.sql"), "utf8"),
    readFile(path.join(ROOT, "server/api/matches/clock.js"), "utf8"),
    readFile(path.join(ROOT, "src/components/match/MatchClockPanel.jsx"), "utf8"),
    readFile(path.join(ROOT, "src/components/match/MatchClockPanelView.jsx"), "utf8"),
    readFile(path.join(ROOT, "src/data/repository/matchAccess.js"), "utf8"),
    readFile(path.join(ROOT, "src/pages/MatchRoomView.jsx"), "utf8"),
    readFile(path.join(ROOT, "src/components/recruiting/RecruitingRoomManagementSection.jsx"), "utf8"),
  ]);

  assert.match(migrationSource, /auto_start := nullif\(btrim\(new\.referee_id\), ''\) is not null[\s\S]*rankball_is_match_referee_eligible/u);
  assert.match(migrationSource, /initial_controller_id := nullif\(btrim\(new\.referee_id\), ''\)/u);
  assert.match(migrationSource, /case when auto_start then 'running' else 'pending' end/u);
  assert.match(migrationSource, /case when auto_start then new\.started_at end/u);
  assert.match(migrationSource, /initial_shot_seconds not in \(0, 24, 30, 60\)/u);
  assert.match(clockCoreSource, /elsif safe_action = 'endPeriod'[\s\S]*session_row\.status := 'break'/u);
  assert.match(clockCoreSource, /elsif safe_action = 'startPeriod'[\s\S]*session_row\.current_period := session_row\.current_period \+ 1/u);
  assert.match(clockCoreSource, /elsif safe_action = 'startOvertime'[\s\S]*session_row\.overtime_count := session_row\.overtime_count \+ 1/u);
  assert.match(clockCoreSource, /minimum_active_ms := ceil\(expected_period_seconds::numeric \* expected_period_count \* 1000 \* 0\.7\)/u);
  assert.match(overtimeSource, /can_start_overtime := score_a = score_b[\s\S]*current_match\.referee_id[\s\S]*current_match\.stat_recorders/u);
  assert.match(controllerSource, /rankball_match_clock_controller_eligible\(safe_match_id, target_controller_id\)/u);
  assert.match(clockApiSource, /"resetShot",[\s\S]*"endPeriod",[\s\S]*"startPeriod",[\s\S]*"startOvertime"/u);
  assert.match(clockApiSource, /\.from\("match_results"\)[\s\S]*\.select\("score_a,score_b,score_revision_a,score_revision_b,submitted_at"\)/u);
  assert.match(migrationSource, /case when nullif\(btrim\(new\.referee_id\), ''\) is not null then 'endClock' else 'matchEnd' end/u);
  assert.match(migrationSource, /active_elapsed_ms = session_row\.active_elapsed_ms \+ applied_ms/u);
  assert.match(migrationSource, /rankball_match_result_action_pre_referee_score_sync\([\s\S]*safe_result/u);
  assert.match(migrationSource, /update public\.match_results[\s\S]*score_a = requested_score_a[\s\S]*score_b = requested_score_b/u);
  assert.match(migrationSource, /update public\.matches[\s\S]*score_a = requested_score_a[\s\S]*score_b = requested_score_b/u);
  assert.match(migrationSource, /'scoreSynced', true/u);
  assert.match(migrationSource, /rankball_is_match_referee_eligible\(safe_actor_id, safe_match_id\)/u);
  assert.doesNotMatch(migrationSource, /\b(?:delete|truncate|drop table)\b/iu);
  assert.match(matchAccessSource, /if \(match\.refereeId\) return currentUserIsEligibleMatchReferee\(state, match\)/u);
  assert.match(matchAccessSource, /const currentUserCanStartMatch = currentUserCanOperateMatch/u);
  assert.match(panelSource, /match\?\.result\?\.scoreA/u);
  const requestSource = await readFile(
    path.join(ROOT, "src/components/match/useMatchClockRequests.js"),
    "utf8",
  );
  assert.match(requestSource, /if \(requestRef\.current\.mutating\) return false/u);
  assert.match(requestSource, /requestRef\.current\.sequence === requestId/u);
  assert.match(requestSource, /window\.setInterval\(readLatest, 3000\)/u);
  assert.match(viewSource, /runAction\("resetShot"\)/u);
  assert.match(viewSource, /confirmAction\([\s\S]{0,200}"endPeriod"\)/u);
  assert.match(viewSource, /confirmAction\([\s\S]{0,200}"startPeriod"\)/u);
  assert.match(viewSource, /confirmAction\([\s\S]{0,200}"startOvertime"\)/u);
  assert.match(matchRoomSource, /editableScoreSides=\{hasReferee \? \[\]/u);
  assert.match(recruitingSource, /editableScoreSides=\{sourceMatch\.refereeId \? \[\]/u);
});

test("unified match end and referee start eligibility stay server-enforced", async () => {
  const migration = await readFile(
    path.join(ROOT, "supabase/migrations/20260731020000_harden_match_clock_finalization_boundaries.sql"),
    "utf8",
  );
  assert.match(migration, /event\.action in \('endClock', 'matchEnd'\)/u);
  assert.match(migration, /rankball_is_match_referee_eligible\(safe_actor_id, safe_match_id\)/u);
  assert.match(migration, /match_referee_qualification_required/u);
  assert.doesNotMatch(migration, /\b(?:delete|truncate|drop table)\b/iu);
});

test("started QR matches do not keep a second start action", async () => {
  const source = await readFile(path.join(ROOT, "src/components/recruiting/RecruitingRoomMatchModel.jsx"), "utf8");
  assert.match(source, /const canShowStartSourceMatch = Boolean\([\s\S]{0,300}&& !sourceMatchStarted/u);
});

test("referee stat submission syncs actual-player points to the clock score", async () => {
  const migration = await readFile(
    path.join(ROOT, "supabase/migrations/20260731140000_sync_referee_points_to_score.sql"),
    "utf8",
  );
  assert.match(migration, /rankball_match_result_action_pre_referee_score_sync\(/u);
  assert.match(migration, /rankball_match_actual_player_ids\(safe_match_id\)/u);
  assert.match(migration, /sum\(coalesce\(stat\.points, 0\)\).*teamA/su);
  assert.match(migration, /sum\(coalesce\(stat\.points, 0\)\).*teamB/su);
  assert.match(migration, /score_a = next_score_a[\s\S]*score_b = next_score_b/u);
  assert.match(migration, /'scoreSource', 'referee_points'/u);
  assert.doesNotMatch(migration, /\b(?:delete|truncate|drop table)\b/iu);
});

test("referee live stat draft drives the visible clock score without overwriting stored team scores", async () => {
  const [roomSource, viewSource, clockSource, recruitingEditorSource, recruitingManagementSource] = await Promise.all([
    readFile(path.join(ROOT, "src/pages/MatchRoom.jsx"), "utf8"),
    readFile(path.join(ROOT, "src/pages/MatchRoomView.jsx"), "utf8"),
    readFile(path.join(ROOT, "src/components/match/MatchClockPanel.jsx"), "utf8"),
    readFile(path.join(ROOT, "src/components/recruiting/RecruitingSourceMatchPanels.jsx"), "utf8"),
    readFile(path.join(ROOT, "src/components/recruiting/RecruitingRoomManagementSection.jsx"), "utf8"),
  ]);
  assert.match(roomSource, /liveStatScoreA: pointAuditA\.statPoints/u);
  assert.match(roomSource, /liveStatScoreB: pointAuditB\.statPoints/u);
  assert.match(viewSource, /displayScoreA=\{hasReferee \? liveStatScoreA : null\}/u);
  assert.match(viewSource, /displayScoreB=\{hasReferee \? liveStatScoreB : null\}/u);
  assert.match(clockSource, /score: visibleScore/u);
  assert.match(clockSource, /displayScoreA != null && displayScoreB != null/u);
  assert.doesNotMatch(clockSource, /setScore\([^)]*displayScore/u);
  assert.match(recruitingEditorSource, /onDraftScoreChange\(\{[\s\S]*scoreA: getMergedResultScore/u);
  assert.match(recruitingManagementSource, /displayScoreA=\{sourceMatch\.refereeId \? sourceMatchDraftScore\?\.scoreA : null\}/u);
});
