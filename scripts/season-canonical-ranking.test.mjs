import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [migration, archiveMigration, ratingMigration, api, router, hook, seasonPage, rankingsPage, logicDoc] = await Promise.all([
  readFile(new URL("../supabase/migrations/20260801007000_canonical_season_rankings.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20260722223000_match_record_archive.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20260728110000_player_placement_and_roster_team_mmr.sql", import.meta.url), "utf8"),
  readFile(new URL("../server/api/season/rankings.js", import.meta.url), "utf8"),
  readFile(new URL("../api/index.js", import.meta.url), "utf8"),
  readFile(new URL("../src/hooks/useCanonicalSeasonRankings.js", import.meta.url), "utf8"),
  readFile(new URL("../src/pages/Season.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/pages/Rankings.jsx", import.meta.url), "utf8"),
  readFile(new URL("../docs/logic-and-terminology.md", import.meta.url), "utf8"),
]);

test("시즌 테이블이 없거나 컬럼이 부족해도 비파괴적으로 복구한다", () => {
  assert.match(migration, /create table if not exists public\.seasons/u);
  assert.match(migration, /alter table public\.seasons add column if not exists promotion_line integer/u);
  assert.match(migration, /where not exists \([\s\S]*from public\.seasons where id = 'season-zero'/u);
  assert.match(migration, /create policy seasons_read_all[\s\S]*for select[\s\S]*to public/u);
});

test("명시한 시즌 ID가 없으면 활성 시즌으로 조용히 fallback하지 않는다", () => {
  assert.match(migration, /\(safe_season_id is not null and season\.id = safe_season_id\)[\s\S]*or \(safe_season_id is null and season\.active\)/u);
  assert.doesNotMatch(migration, /or season\.active/u);
});

test("archive의 실제 개인·팀 MMR 저장 구조를 읽는다", () => {
  assert.match(archiveMigration, /'match', to_jsonb\(current_match\)/u);
  assert.match(ratingMigration, /'integratedDelta'[\s\S]*new\.rating_result := next_rating_result/u);
  assert.match(ratingMigration, /new\.team_rating_result := jsonb_build_object\([\s\S]*'teamA'[\s\S]*'teamB'[\s\S]*'teams'/u);
  assert.match(ratingMigration, /array\[team_row\.id\][\s\S]*'delta', applied_team_delta/u);
  assert.match(migration, /payload #> '\{match,rating_result\}'/u);
  assert.match(migration, /array\['match', 'team_rating_result', 'teams', team_record\.team_id, 'delta'\]/u);
});

test("시즌 승격 순위는 활성 archive 전체와 실제 시즌 날짜를 집계한다", () => {
  assert.match(migration, /create or replace function public\.rankball_season_rankings\(/u);
  assert.match(migration, /from public\.match_record_archives archive[\s\S]*archive\.is_active[\s\S]*archive\.record_date between season_row\.starts_at and season_row\.ends_at/u);
  assert.match(migration, /from public\.match_record_participants participant[\s\S]*join season_archives/u);
  assert.match(migration, /from public\.match_record_teams team_record[\s\S]*join season_archives/u);
  assert.match(migration, /from public\.public_profiles profile[\s\S]*left join player_aggregate/u);
  assert.match(migration, /from public\.teams team[\s\S]*left join team_aggregate/u);
  assert.match(migration, /coalesce\(aggregate\.wins, 0\) \* 12[\s\S]*coalesce\(aggregate\.losses, 0\) \* 6/u);
  assert.match(migration, /coalesce\(aggregate\.wins, 0\) \* 16[\s\S]*coalesce\(aggregate\.losses, 0\) \* 8/u);
});

test("시즌 순위 RPC는 차단·지역 공개 설정을 적용하고 service role 전용이다", () => {
  assert.match(migration, /app_settings->'blockedUserIds'/u);
  assert.match(migration, /privacy,regionRanking/u);
  assert.match(migration, /'rankball_season_rankings'[\s\S]*'active'[\s\S]*true/u);
  assert.match(migration, /revoke all on function public\.rankball_season_rankings\(text, text\)[\s\S]*from public, anon, authenticated/u);
  assert.match(migration, /grant execute on function public\.rankball_season_rankings\(text, text\)[\s\S]*to service_role/u);
  assert.doesNotMatch(migration.replace(/--[^\r\n]*/gu, ""), /\b(?:drop table|truncate|delete from)\b/iu);
});

test("Season과 승격 Rankings 원격 경로는 canonical API만 사용한다", () => {
  assert.match(api, /getAuthenticatedContext\(request\)/u);
  assert.match(api, /\.rpc\("rankball_season_rankings"/u);
  assert.match(router, /"\/season\/rankings"[\s\S]*seasonRankings/u);
  assert.match(hook, /postServerAction\("\/api\/season\/rankings"/u);
  assert.match(seasonPage, /useCanonicalSeasonRankings\(app\.remoteReady, season\.id\)/u);
  assert.match(rankingsPage, /canonicalRankings\.data\?\.players/u);
  assert.match(rankingsPage, /canonicalRankings\.data\?\.teams/u);
  assert.match(logicDoc, /운영 시즌 개인·팀 승격 순위[^]*match_record_participants[^]*match_record_teams/u);
});
