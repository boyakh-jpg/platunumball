-- Keep abandoned simulation match sources aligned with their quarantined feed rows.
-- This is a soft quarantine only. Source rows and derived rows remain intact.

begin;

do $migration$
declare
  function_oid oid;
  function_definition text;
  patched_definition text;
  old_match_filter constant text := $old$
  where match_row.id like 'm\_seed\_%' escape '\'
$old$;
  new_match_filter constant text := $new$
  where (
      match_row.id like 'm\_seed\_%' escape '\'
      or (
        match_row.id like 'sim\_m\_%' escape '\'
        and match_row.tournament_id is null
        and match_row.status in ('agreed', 'live', 'approval', 'disputed')
        and match_row.updated_at < p_now - interval '24 hours'
      )
    )
$new$;
  old_quarantine_reason constant text := $old_reason$
        'quarantineReason', 'legacy_sample'
$old_reason$;
  new_quarantine_reason constant text := $new_reason$
        'quarantineReason', case
          when match_row.id like 'm\_seed\_%' escape '\' then 'legacy_sample'
          else 'simulation_artifact'
        end
$new_reason$;
  old_profile_refresh_filter constant text := $old_profile$
      where player.match_id like 'm\_seed\_%' escape '\'
$old_profile$;
  new_profile_refresh_filter constant text := $new_profile$
      where (
          player.match_id like 'm\_seed\_%' escape '\'
          or (
            player.match_id like 'sim\_m\_%' escape '\'
            and exists (
              select 1
              from public.matches quarantined_match
              where quarantined_match.id = player.match_id
                and quarantined_match.rules->>'quarantineReason' = 'simulation_artifact'
            )
          )
        )
$new_profile$;
  old_court_refresh_filter constant text := $old_court$
        where match_row.id like 'm\_seed\_%' escape '\'
$old_court$;
  new_court_refresh_filter constant text := $new_court$
        where (
            match_row.id like 'm\_seed\_%' escape '\'
            or (
              match_row.id like 'sim\_m\_%' escape '\'
              and match_row.rules->>'quarantineReason' = 'simulation_artifact'
            )
          )
$new_court$;
  old_feed_simulation_filter constant text := $old_feed$
      feed.entity_id like 'sim\_%' escape '\'
$old_feed$;
  new_feed_simulation_filter constant text := $new_feed$
      (
        feed.entity_id like 'sim\_%' escape '\'
        and (
          feed.entity_type <> 'match'
          or exists (
            select 1
            from public.matches quarantined_match
            where quarantined_match.id = feed.entity_id
              and quarantined_match.rules->>'quarantineReason' = 'simulation_artifact'
          )
        )
      )
$new_feed$;
  old_card_simulation_filter constant text := $old_card$
    card.entity_id like 'sim\_%' escape '\'
$old_card$;
  new_card_simulation_filter constant text := $new_card$
    (
      card.entity_id like 'sim\_%' escape '\'
      and (
        card.entity_type <> 'match'
        or exists (
          select 1
          from public.matches quarantined_match
          where quarantined_match.id = card.entity_id
            and quarantined_match.rules->>'quarantineReason' = 'simulation_artifact'
        )
      )
    )
$new_card$;
begin
  select procedure.oid
    into function_oid
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.proname = 'rankball_quarantine_simulation_artifacts'
    and pg_get_function_identity_arguments(procedure.oid) = 'p_now timestamp with time zone';

  if function_oid is null then
    raise exception 'rankball_quarantine_simulation_artifacts_missing' using errcode = '42883';
  end if;

  select pg_get_functiondef(function_oid)
    into function_definition;

  patched_definition := function_definition;

  if position(new_match_filter in patched_definition) = 0 then
    if position(old_match_filter in patched_definition) = 0 then
      raise exception 'rankball_quarantine_simulation_match_filter_unexpected'
        using errcode = '55000';
    end if;
    patched_definition := replace(patched_definition, old_match_filter, new_match_filter);
  end if;

  if position(new_quarantine_reason in patched_definition) = 0 then
    if position(old_quarantine_reason in patched_definition) = 0 then
      raise exception 'rankball_quarantine_simulation_reason_unexpected'
        using errcode = '55000';
    end if;
    patched_definition := replace(
      patched_definition,
      old_quarantine_reason,
      new_quarantine_reason
    );
  end if;

  if position(new_profile_refresh_filter in patched_definition) = 0 then
    if position(old_profile_refresh_filter in patched_definition) = 0 then
      raise exception 'rankball_quarantine_simulation_profile_refresh_filter_unexpected'
        using errcode = '55000';
    end if;
    patched_definition := replace(
      patched_definition,
      old_profile_refresh_filter,
      new_profile_refresh_filter
    );
  end if;

  if position(new_court_refresh_filter in patched_definition) = 0 then
    if position(old_court_refresh_filter in patched_definition) = 0 then
      raise exception 'rankball_quarantine_simulation_court_refresh_filter_unexpected'
        using errcode = '55000';
    end if;
    patched_definition := replace(
      patched_definition,
      old_court_refresh_filter,
      new_court_refresh_filter
    );
  end if;

  if position(new_feed_simulation_filter in patched_definition) = 0 then
    if position(old_feed_simulation_filter in patched_definition) = 0 then
      raise exception 'rankball_quarantine_simulation_feed_filter_unexpected'
        using errcode = '55000';
    end if;
    patched_definition := replace(
      patched_definition,
      old_feed_simulation_filter,
      new_feed_simulation_filter
    );
  end if;

  if position(new_card_simulation_filter in patched_definition) = 0 then
    if position(old_card_simulation_filter in patched_definition) = 0 then
      raise exception 'rankball_quarantine_simulation_card_filter_unexpected'
        using errcode = '55000';
    end if;
    patched_definition := replace(
      patched_definition,
      old_card_simulation_filter,
      new_card_simulation_filter
    );
  end if;

  if patched_definition is distinct from function_definition then
    execute patched_definition;
  end if;
end
$migration$;

revoke all on function public.rankball_quarantine_simulation_artifacts(timestamptz)
  from public, anon, authenticated;
grant execute on function public.rankball_quarantine_simulation_artifacts(timestamptz)
  to service_role;

comment on function public.rankball_quarantine_simulation_artifacts(timestamptz) is
  'Soft-quarantines stale active non-tournament simulation sources and derived rows while preserving confirmed matches, tournament state, and terminal court-request decisions.';

select public.rankball_quarantine_simulation_artifacts(now());

select pg_notify('pgrst', 'reload schema');

commit;
