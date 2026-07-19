do $$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'affiliations',
    'courts',
    'discord_notification_deliveries',
    'favorites',
    'notifications',
    'profile_match_summaries',
    'public_profiles',
    'room_chat_messages',
    'room_discord_links',
    'seasons',
    'team_invitations',
    'team_members',
    'teams',
    'tournament_teams',
    'tournaments',
    'user_room_feed'
  ]
  loop
    if to_regclass(format('public.%I', relation_name)) is not null then
      execute format(
        'revoke insert, update, delete, truncate, references, trigger on table public.%I from anon, authenticated',
        relation_name
      );
    end if;
  end loop;
end
$$;

do $$
declare
  function_signature text;
begin
  foreach function_signature in array array[
    'public.rankball_admin_level_for_profile(text,integer)',
    'public.rankball_approve_court_request(text,integer,text,jsonb)',
    'public.rankball_extend_admin_appointment_action(text,integer,text,integer,text)',
    'public.rankball_mark_notification_read(text)',
    'public.rankball_current_recruiting_post_ids(text,integer)',
    'public.rankball_match_list(text,integer,text)',
    'public.rankball_refresh_court_feed_dependency(text)',
    'public.rankball_refresh_match_feed_for_match(text)',
    'public.rankball_refresh_profile_feed_dependency(text)',
    'public.rankball_refresh_recruiting_feed_for_post(text)',
    'public.rankball_refresh_team_feed_dependency(text)'
  ]
  loop
    if to_regprocedure(function_signature) is not null then
      execute 'revoke all on function ' || function_signature || ' from public, anon, authenticated';
      execute 'grant execute on function ' || function_signature || ' to service_role';
    end if;
  end loop;
end
$$;

select pg_notify('pgrst', 'reload schema');
