-- Repair legacy seed/diagnostic rows that persisted replacement question marks.
update public.matches
set court_name = '미정'
where court_name like '%?%';

update public.matches
set memo = ''
where memo like '%?%';

update public.matches
set rules = jsonb_set(coalesce(rules, '{}'::jsonb), '{ball}', to_jsonb('7호 공'::text), true)
where coalesce(rules->>'ball', '') like '%?%';

update public.matches
set rules = jsonb_set(coalesce(rules, '{}'::jsonb), '{attackRule}', to_jsonb('득점 후 공격권 교대'::text), true)
where coalesce(rules->>'attackRule', '') like '%?%';

update public.matches
set rules = jsonb_set(coalesce(rules, '{}'::jsonb), '{foulRule}', to_jsonb('파울 콜 즉시 중단, 공격권 유지'::text), true)
where coalesce(rules->>'foulRule', '') like '%?%';
