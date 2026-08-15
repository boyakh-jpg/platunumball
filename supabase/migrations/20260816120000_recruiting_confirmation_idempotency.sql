do $$
begin
  if exists (
    select 1
    from public.matches
    where nullif(btrim(rules->>'recruitingPostId'), '') is not null
    group by nullif(btrim(rules->>'recruitingPostId'), '')
    having count(*) > 1
  ) then
    raise exception 'duplicate_recruiting_match_links_require_manual_resolution';
  end if;
end;
$$;

create unique index if not exists matches_rules_recruiting_post_id_unique_idx
  on public.matches ((nullif(btrim(rules->>'recruitingPostId'), '')))
  where nullif(btrim(rules->>'recruitingPostId'), '') is not null;

create or replace function public.rankball_confirm_recruiting_match_action(
  p_actor_profile_id text,
  p_post_action text,
  p_post_row jsonb,
  p_application_rows jsonb default '[]'::jsonb,
  p_recruiting_notification_rows jsonb default '[]'::jsonb,
  p_expected_updated_at timestamptz default null,
  p_match_action text default 'confirmRecruitingMatch',
  p_match_row jsonb default '{}'::jsonb,
  p_player_rows jsonb default '[]'::jsonb,
  p_result_row jsonb default null,
  p_stat_rows jsonb default '[]'::jsonb,
  p_agreement_rows jsonb default '[]'::jsonb,
  p_approval_rows jsonb default '[]'::jsonb,
  p_dispute_rows jsonb default '[]'::jsonb,
  p_match_notification_rows jsonb default '[]'::jsonb,
  p_replace_result boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_post_id text := nullif(btrim(p_post_row->>'id'), '');
  safe_match_id text := nullif(btrim(p_match_row->>'id'), '');
  requested_post_id text := nullif(btrim(p_match_row#>>'{rules,recruitingPostId}'), '');
  existing_linked_match_id text;
  current_post public.recruiting_posts%rowtype;
  current_owner_id text;
  recruiting_result jsonb;
  match_result jsonb;
  linked_match_row jsonb;
begin
  if safe_actor_id is null then
    raise exception 'missing_actor_profile_id' using errcode = '22023';
  end if;
  if safe_post_id is null or safe_match_id is null then
    raise exception 'missing_recruiting_confirmation_ids' using errcode = '22023';
  end if;
  if requested_post_id is not null and requested_post_id <> safe_post_id then
    raise exception 'recruiting_match_link_mismatch' using errcode = '22023';
  end if;
  if p_post_action <> 'confirmRecruitingMatch' or p_match_action <> 'confirmRecruitingMatch' then
    raise exception 'invalid_recruiting_confirmation_action' using errcode = '22023';
  end if;
  if p_post_row->>'status' <> 'closed' or p_match_row->>'status' <> 'agreed' then
    raise exception 'invalid_recruiting_confirmation_state' using errcode = '22023';
  end if;

  linked_match_row := jsonb_set(
    p_match_row,
    '{rules}',
    (
      case
        when jsonb_typeof(p_match_row->'rules') = 'object' then p_match_row->'rules'
        else '{}'::jsonb
      end
    ) || jsonb_build_object('recruitingPostId', safe_post_id),
    true
  );

  perform pg_advisory_xact_lock(hashtext('rankball:recruiting'), hashtext(safe_post_id));
  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));

  select *
  into current_post
  from public.recruiting_posts
  where id = safe_post_id
  for update;

  if not found then
    raise exception 'recruiting_post_not_found' using errcode = '22023';
  end if;
  current_owner_id := coalesce(nullif(current_post.room_state->>'ownerId', ''), nullif(current_post.player_id, ''));
  if current_owner_id is distinct from safe_actor_id then
    raise exception 'recruiting_room_owner_required' using errcode = '42501';
  end if;

  select match_row.id
  into existing_linked_match_id
  from public.matches match_row
  where nullif(btrim(match_row.rules->>'recruitingPostId'), '') = safe_post_id
  limit 1;

  if existing_linked_match_id is not null then
    if existing_linked_match_id <> safe_match_id then
      raise exception 'recruiting_post_already_linked' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'ok', true,
      'postId', safe_post_id,
      'matchId', safe_match_id,
      'recruiting', jsonb_build_object('ok', true, 'postId', safe_post_id, 'alreadyConfirmed', true),
      'match', jsonb_build_object('ok', true, 'matchId', safe_match_id, 'alreadyConfirmed', true),
      'confirmationAtomic', true,
      'alreadyConfirmed', true
    );
  end if;

  if current_post.status <> 'open' then
    raise exception 'recruiting_room_not_mutable' using errcode = '42501';
  end if;
  if exists (select 1 from public.matches where id = safe_match_id) then
    raise exception 'match_already_exists' using errcode = '23505';
  end if;

  recruiting_result := public.rankball_recruiting_action(
    safe_actor_id,
    p_post_action,
    p_post_row,
    p_application_rows,
    p_recruiting_notification_rows,
    p_expected_updated_at
  );

  match_result := public.rankball_match_action(
    safe_actor_id,
    p_match_action,
    linked_match_row,
    p_player_rows,
    p_result_row,
    p_stat_rows,
    p_agreement_rows,
    p_approval_rows,
    p_dispute_rows,
    p_match_notification_rows,
    p_replace_result
  );

  return jsonb_build_object(
    'ok', true,
    'postId', safe_post_id,
    'matchId', safe_match_id,
    'recruiting', recruiting_result,
    'match', match_result,
    'confirmationAtomic', true,
    'alreadyConfirmed', false
  );
end;
$$;

revoke all on function public.rankball_confirm_recruiting_match_action(text, text, jsonb, jsonb, jsonb, timestamptz, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, boolean) from public;
revoke all on function public.rankball_confirm_recruiting_match_action(text, text, jsonb, jsonb, jsonb, timestamptz, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, boolean) from anon;
revoke all on function public.rankball_confirm_recruiting_match_action(text, text, jsonb, jsonb, jsonb, timestamptz, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, boolean) from authenticated;
grant execute on function public.rankball_confirm_recruiting_match_action(text, text, jsonb, jsonb, jsonb, timestamptz, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, boolean) to service_role;

select pg_notify('pgrst', 'reload schema');
