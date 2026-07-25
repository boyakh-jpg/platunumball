-- Keep room equipment editable through the shared authoritative rule patch.
do $migration$
begin
  if to_regprocedure('public.rankball_apply_room_rule_patch_pre_room_equipment(jsonb,jsonb,text)') is null then
    alter function public.rankball_apply_room_rule_patch(jsonb, jsonb, text)
      rename to rankball_apply_room_rule_patch_pre_room_equipment;
  end if;
end;
$migration$;

create or replace function public.rankball_apply_room_rule_patch(
  p_current_rules jsonb,
  p_patch jsonb,
  p_mode text
)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  source_rules jsonb := coalesce(p_current_rules, '{}'::jsonb) || coalesce(p_patch, '{}'::jsonb);
  next_rules jsonb;
  ball_provider text := coalesce(nullif(btrim(source_rules->>'ballProvider'), ''), 'host');
  vests_provided boolean;
begin
  if ball_provider not in ('host', 'venue', 'participant', 'unknown') then
    raise exception 'invalid_room_ball_provider' using errcode = '22023';
  end if;

  next_rules := public.rankball_apply_room_rule_patch_pre_room_equipment(
    p_current_rules,
    p_patch,
    p_mode
  );
  vests_provided := case
    when p_mode = '1v1' then false
    else public.rankball_room_rule_boolean(source_rules, 'vestsProvided', false)
  end;

  return next_rules || jsonb_build_object(
    'ballProvider', ball_provider,
    'vestsProvided', vests_provided
  );
end;
$$;

revoke all on function public.rankball_apply_room_rule_patch_pre_room_equipment(jsonb, jsonb, text) from public, anon, authenticated, service_role;
revoke all on function public.rankball_apply_room_rule_patch(jsonb, jsonb, text) from public, anon, authenticated, service_role;

select pg_notify('pgrst', 'reload schema');
