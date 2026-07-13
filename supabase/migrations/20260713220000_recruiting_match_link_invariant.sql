with link_candidates as (
  select
    match_row.id as match_id,
    post.id as post_id,
    count(*) over (partition by match_row.id) as match_candidate_count,
    count(*) over (partition by post.id) as post_candidate_count
  from public.matches match_row
  join public.recruiting_posts post
    on post.status = 'closed'
   and post.confirmed_at is not null
   and post.confirmed_at = match_row.created_at
   and post.title = match_row.title
   and coalesce(nullif(post.room_state->>'ownerId', ''), post.player_id) = match_row.created_by
  where nullif(match_row.rules->>'recruitingPostId', '') is null
),
unambiguous_links as (
  select match_id, post_id
  from link_candidates
  where match_candidate_count = 1
    and post_candidate_count = 1
)
update public.matches match_row
set rules = jsonb_set(
  coalesce(match_row.rules, '{}'::jsonb),
  '{recruitingPostId}',
  to_jsonb(link.post_id),
  true
)
from unambiguous_links link
where match_row.id = link.match_id;

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
    'confirmationAtomic', true
  );
end;
$$;

revoke all on function public.rankball_confirm_recruiting_match_action(text, text, jsonb, jsonb, jsonb, timestamptz, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, boolean) from public;
revoke all on function public.rankball_confirm_recruiting_match_action(text, text, jsonb, jsonb, jsonb, timestamptz, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, boolean) from anon;
revoke all on function public.rankball_confirm_recruiting_match_action(text, text, jsonb, jsonb, jsonb, timestamptz, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, boolean) from authenticated;
grant execute on function public.rankball_confirm_recruiting_match_action(text, text, jsonb, jsonb, jsonb, timestamptz, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, boolean) to service_role;

select pg_notify('pgrst', 'reload schema');
