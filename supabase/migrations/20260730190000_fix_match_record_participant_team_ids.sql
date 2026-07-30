-- Repair the match-record participant reducer without rewriting migration history.
-- Its PL/pgSQL locals shadow matches.team_a_id/team_b_id in UPDATE.

begin;

do $$
declare
  function_signature regprocedure :=
    'public.rankball_match_record_participants_action(text,text,jsonb)'::regprocedure;
  function_definition text;
begin
  select pg_get_functiondef(function_signature)
  into function_definition;

  if position('team_a_id text;' in function_definition) = 0
     or position('team_b_id text;' in function_definition) = 0 then
    raise exception 'match_record_participant_team_id_repair_source_missing'
      using errcode = 'P0001';
  end if;

  function_definition := replace(function_definition, 'team_a_id text;', 'selected_team_a_id text;');
  function_definition := replace(function_definition, 'team_b_id text;', 'selected_team_b_id text;');
  function_definition := replace(function_definition, 'team_a_id :=', 'selected_team_a_id :=');
  function_definition := replace(function_definition, 'team_b_id :=', 'selected_team_b_id :=');
  function_definition := replace(function_definition, 'team_a_id is null', 'selected_team_a_id is null');
  function_definition := replace(function_definition, 'team_b_id is null', 'selected_team_b_id is null');
  function_definition := replace(function_definition, 'team_a_id = team_b_id', 'selected_team_a_id = selected_team_b_id');
  function_definition := replace(function_definition, 'team.id = team_a_id', 'team.id = selected_team_a_id');
  function_definition := replace(function_definition, 'team.id = team_b_id', 'team.id = selected_team_b_id');
  function_definition := replace(function_definition, 'member.team_id = team_a_id', 'member.team_id = selected_team_a_id');
  function_definition := replace(function_definition, 'member.team_id = team_b_id', 'member.team_id = selected_team_b_id');
  function_definition := replace(function_definition, 'safe_match_id, team_a_id, team_a_captain_id', 'safe_match_id, selected_team_a_id, team_a_captain_id');
  function_definition := replace(function_definition, 'safe_match_id, team_b_id, team_b_captain_id', 'safe_match_id, selected_team_b_id, team_b_captain_id');
  function_definition := replace(function_definition, 'then team_a_id', 'then selected_team_a_id');
  function_definition := replace(function_definition, 'then team_b_id', 'then selected_team_b_id');

  if position('team_a_id text;' in function_definition) > 0
     or position('team_b_id text;' in function_definition) > 0
     or position('then team_a_id' in function_definition) > 0
     or position('then team_b_id' in function_definition) > 0 then
    raise exception 'match_record_participant_team_id_repair_incomplete'
      using errcode = 'P0001';
  end if;

  execute function_definition;
end;
$$;

revoke all on function public.rankball_match_record_participants_action(
  text,
  text,
  jsonb
) from public, anon, authenticated;
grant execute on function public.rankball_match_record_participants_action(
  text,
  text,
  jsonb
) to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
