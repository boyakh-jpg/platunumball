-- Read-only regression cases: no match, profile, clock, or score rows are written.
with cases(name, period_scores, rules, clock, before_a, before_b, after_a, after_b, expected) as (
  values
    ('first quarter', '[]'::jsonb, '{"periodCount":4}'::jsonb, '{"status":"running","currentPeriod":1,"overtimeCount":0}'::jsonb, 0, 0, 2, 0, '[{"label":"1Q","scoreA":2,"scoreB":0}]'::jsonb),
    ('next quarter', '[{"label":"1Q","scoreA":2,"scoreB":0}]'::jsonb, '{"periodCount":4}'::jsonb, '{"status":"running","currentPeriod":2,"overtimeCount":0}'::jsonb, 2, 0, 5, 0, '[{"label":"1Q","scoreA":2,"scoreB":0},{"label":"2Q","scoreA":3,"scoreB":0}]'::jsonb),
    ('both PTS deltas', '[{"label":"1Q","scoreA":2,"scoreB":3}]'::jsonb, '{"periodCount":4}'::jsonb, '{"status":"running","currentPeriod":2,"overtimeCount":0}'::jsonb, 2, 3, 4, 6, '[{"label":"1Q","scoreA":2,"scoreB":3},{"label":"2Q","scoreA":2,"scoreB":3}]'::jsonb),
    ('current decrement', '[{"label":"1Q","scoreA":5,"scoreB":3}]'::jsonb, '{"periodCount":4}'::jsonb, '{"status":"running","currentPeriod":1,"overtimeCount":0}'::jsonb, 5, 3, 3, 3, '[{"label":"1Q","scoreA":3,"scoreB":3}]'::jsonb),
    ('break correction', '[{"label":"1Q","scoreA":5,"scoreB":0}]'::jsonb, '{"periodCount":4}'::jsonb, '{"status":"break","currentPeriod":1,"overtimeCount":0}'::jsonb, 5, 0, 4, 0, '[{"label":"1Q","scoreA":4,"scoreB":0}]'::jsonb),
    ('paused correction', '[]'::jsonb, '{"periodCount":4}'::jsonb, '{"status":"paused","currentPeriod":1,"overtimeCount":0}'::jsonb, 0, 0, 0, 3, '[{"label":"1Q","scoreA":0,"scoreB":3}]'::jsonb),
    ('zero previous periods', '[]'::jsonb, '{"periodCount":4}'::jsonb, '{"status":"running","currentPeriod":3,"overtimeCount":0}'::jsonb, 0, 0, 2, 0, '[{"label":"1Q","scoreA":0,"scoreB":0},{"label":"2Q","scoreA":0,"scoreB":0},{"label":"3Q","scoreA":2,"scoreB":0}]'::jsonb),
    ('first half', '[]'::jsonb, '{"periodCount":2}'::jsonb, '{"status":"running","currentPeriod":1,"overtimeCount":0}'::jsonb, 0, 0, 2, 0, '[{"label":"1H","scoreA":2,"scoreB":0}]'::jsonb),
    ('second half', '[{"label":"1H","scoreA":2,"scoreB":0}]'::jsonb, '{"periodCount":2}'::jsonb, '{"status":"running","currentPeriod":2,"overtimeCount":0}'::jsonb, 2, 0, 2, 3, '[{"label":"1H","scoreA":2,"scoreB":0},{"label":"2H","scoreA":0,"scoreB":3}]'::jsonb),
    ('REG', '[]'::jsonb, '{"periodCount":1}'::jsonb, '{"status":"running","currentPeriod":1,"overtimeCount":0}'::jsonb, 0, 0, 1, 0, '[{"label":"REG","scoreA":1,"scoreB":0}]'::jsonb),
    ('first OT', '[{"label":"REG","scoreA":21,"scoreB":21}]'::jsonb, '{"periodCount":1}'::jsonb, '{"status":"running","currentPeriod":1,"overtimeCount":1}'::jsonb, 21, 21, 23, 21, '[{"label":"REG","scoreA":21,"scoreB":21},{"label":"OT","scoreA":2,"scoreB":0}]'::jsonb),
    ('repeated OT', '[{"label":"REG","scoreA":21,"scoreB":21},{"label":"OT","scoreA":2,"scoreB":2}]'::jsonb, '{"periodCount":1}'::jsonb, '{"status":"running","currentPeriod":1,"overtimeCount":2}'::jsonb, 23, 23, 24, 23, '[{"label":"REG","scoreA":21,"scoreB":21},{"label":"OT","scoreA":3,"scoreB":2}]'::jsonb),
    ('legacy missing', '[]'::jsonb, '{"periodCount":4}'::jsonb, '{"status":"running","currentPeriod":2,"overtimeCount":0}'::jsonb, 5, 0, 7, 0, '[]'::jsonb),
    ('legacy mismatch', '[{"label":"1Q","scoreA":2,"scoreB":0}]'::jsonb, '{"periodCount":4}'::jsonb, '{"status":"running","currentPeriod":2,"overtimeCount":0}'::jsonb, 5, 0, 7, 0, '[]'::jsonb),
    ('no clock', '[]'::jsonb, '{"periodCount":4}'::jsonb, null, 0, 0, 2, 0, '[]'::jsonb),
    ('pending clock', '[]'::jsonb, '{"periodCount":4}'::jsonb, '{"status":"pending","currentPeriod":1,"overtimeCount":0}'::jsonb, 0, 0, 2, 0, '[]'::jsonb),
    ('ended clock', '[]'::jsonb, '{"periodCount":4}'::jsonb, '{"status":"ended","currentPeriod":1,"overtimeCount":0}'::jsonb, 0, 0, 2, 0, '[]'::jsonb),
    ('missing rules', '[]'::jsonb, '{}'::jsonb, '{"status":"running","currentPeriod":1,"overtimeCount":0}'::jsonb, 0, 0, 2, 0, '[]'::jsonb),
    ('invalid rules', '[]'::jsonb, '{"periodCount":3}'::jsonb, '{"status":"running","currentPeriod":1,"overtimeCount":0}'::jsonb, 0, 0, 2, 0, '[]'::jsonb),
    ('wrong labels', '[{"label":"REG","scoreA":2,"scoreB":0}]'::jsonb, '{"periodCount":4}'::jsonb, '{"status":"running","currentPeriod":1,"overtimeCount":0}'::jsonb, 2, 0, 4, 0, '[]'::jsonb),
    ('current would be negative', '[{"label":"1Q","scoreA":5,"scoreB":0},{"label":"2Q","scoreA":1,"scoreB":0}]'::jsonb, '{"periodCount":4}'::jsonb, '{"status":"running","currentPeriod":2,"overtimeCount":0}'::jsonb, 6, 0, 4, 0, '[]'::jsonb),
    ('future data', '[{"label":"1Q","scoreA":2,"scoreB":0},{"label":"2Q","scoreA":0,"scoreB":0}]'::jsonb, '{"periodCount":4}'::jsonb, '{"status":"running","currentPeriod":1,"overtimeCount":0}'::jsonb, 2, 0, 3, 0, '[]'::jsonb),
    ('invalid overtime', '[]'::jsonb, '{"periodCount":4}'::jsonb, '{"status":"running","currentPeriod":1,"overtimeCount":1}'::jsonb, 0, 0, 2, 0, '[]'::jsonb),
    ('period maximum', '[{"label":"1Q","scoreA":999,"scoreB":0}]'::jsonb, '{"periodCount":4}'::jsonb, '{"status":"running","currentPeriod":1,"overtimeCount":0}'::jsonb, 999, 0, 1000, 0, '[]'::jsonb),
    ('zero delta preserves', '[{"label":"1Q","scoreA":5,"scoreB":0}]'::jsonb, '{"periodCount":4}'::jsonb, null, 5, 0, 5, 0, '[{"label":"1Q","scoreA":5,"scoreB":0}]'::jsonb),
    ('large input safe', '[]'::jsonb, '{"periodCount":4}'::jsonb, '{"status":"running","currentPeriod":1,"overtimeCount":0}'::jsonb, 0, 0, 2147483647, 0, '[]'::jsonb)
), checked as (
  select name, expected, public.rankball_match_period_scores_after_delta(
    period_scores, rules, clock, before_a, before_b, after_a, after_b
  ) as actual from cases
)
select name, actual = expected as passed, actual, expected from checked order by name;
