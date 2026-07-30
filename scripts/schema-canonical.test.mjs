import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [schemaSource, repairMigrationSource] = await Promise.all([
  readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8"),
  readFile(
    new URL(
      "../supabase/migrations/20260730018000_repair_recruiting_close_canonical.sql",
      import.meta.url,
    ),
    "utf8",
  ),
]);

function occurrenceCount(source, token) {
  return source.split(token).length - 1;
}

function functionSegment(source, startToken, endToken) {
  const start = source.indexOf(startToken);
  assert.notEqual(start, -1, `${startToken} 시작점을 찾지 못했습니다.`);
  const end = source.indexOf(endToken, start + startToken.length);
  assert.notEqual(end, -1, `${endToken} 종료점을 찾지 못했습니다.`);
  return source.slice(start, end);
}

test("schema snapshot keeps one canonical recruiting close wrapper and one internal helper", () => {
  const helperToken =
    "create or replace function public.rankball_recruiting_close_action_pre_cancel_policy(";
  const wrapperToken =
    "create or replace function public.rankball_recruiting_close_action(";

  assert.equal(occurrenceCount(schemaSource, helperToken), 1);
  assert.equal(occurrenceCount(schemaSource, wrapperToken), 1);

  const helperSource = functionSegment(schemaSource, helperToken, wrapperToken);
  const wrapperSource = functionSegment(
    schemaSource,
    wrapperToken,
    "revoke all on function public.rankball_recruiting_close_action_pre_cancel_policy(",
  );

  assert.match(helperSource, /closeWithApplicantsPenalty/u);
  assert.match(helperSource, /closeUnreadyPenalty/u);
  assert.match(helperSource, /closeMaxPenalty/u);
  assert.match(helperSource, /'방 닫기 페널티'/u);
  assert.match(
    helperSource,
    /'대기 인원 또는 임박한 일정이 있는 방을 닫아 신뢰 점수가 감소했습니다\.'/u,
  );

  assert.match(
    wrapperSource,
    /public\.rankball_scheduled_at_kst\(current_post\.scheduled_at\)/u,
  );
  assert.match(
    wrapperSource,
    /public\.rankball_recruiting_close_action_pre_cancel_policy\(/u,
  );
  assert.match(wrapperSource, /room_cancel_locked/u);
  assert.match(wrapperSource, /'경기 취소 신뢰도 반영'/u);
  assert.match(
    wrapperSource,
    /'경기 시작 12시간 이내에 취소해 신뢰도 '/u,
  );
  assert.match(wrapperSource, /'점이 감소했습니다\.'/u);
  assert.doesNotMatch(helperSource + wrapperSource, /[一-龥]|[ÃÂ]|\uFFFD/u);
});

test("encoding repair migration preserves function logic and hardens helper grants", () => {
  assert.match(
    repairMigrationSource,
    /pg_get_functiondef\(target_function\)/u,
  );
  assert.match(repairMigrationSource, /regexp_replace\(/u);
  assert.match(
    repairMigrationSource,
    /rankball_recruiting_close_action_pre_cancel_policy\(text,text\)/u,
  );
  assert.match(
    repairMigrationSource,
    /rankball_match_terminal_action_pre_cancel_reason\(text,text,text,text\)/u,
  );
  assert.match(
    repairMigrationSource,
    /from public, anon, authenticated, service_role/u,
  );
  assert.match(
    repairMigrationSource,
    /type in \('recruiting_cancel_penalty', 'match_cancel_penalty'\)/u,
  );
  assert.match(
    repairMigrationSource,
    /recruiting_close_action_canonical_postflight_failed/u,
  );
  assert.doesNotMatch(
    repairMigrationSource,
    /delete\s+from\s+public\.(?:user_room_feed|room_feed_cards)/iu,
  );
});
