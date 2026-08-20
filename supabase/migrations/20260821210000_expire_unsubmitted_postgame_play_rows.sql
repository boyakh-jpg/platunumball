create or replace function public.rankball_recorder_match_page(
  p_profile_id text,
  p_limit integer default 40,
  p_cursor text default ''
) returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  safe_profile_id text := nullif(btrim(p_profile_id), '');
  safe_limit integer := greatest(1, least(coalesce(p_limit, 40), 80));
  safe_cursor text := nullif(btrim(p_cursor), '');
  cursor_payload text;
  cursor_separator integer;
  cursor_created_at timestamptz;
  cursor_id text;
  selected_ids text[];
  selected_created_ats timestamptz[];
  page_ids text[];
  has_more boolean;
begin
  if safe_profile_id is null then
    raise exception 'profile_id is required';
  end if;

  perform public.rankball_assert_match_actor_active(safe_profile_id);

  if safe_cursor is not null and safe_cursor <> 'mine:0' then
    if left(safe_cursor, 5) <> 'play:' then
      raise exception 'invalid recorder cursor';
    end if;
    cursor_payload := substring(safe_cursor from 6);
    cursor_separator := strpos(cursor_payload, '|');
    if cursor_separator <= 1 or cursor_separator >= length(cursor_payload) then
      raise exception 'invalid recorder cursor';
    end if;
    begin
      cursor_created_at := left(cursor_payload, cursor_separator - 1)::timestamptz;
    exception when others then
      raise exception 'invalid recorder cursor';
    end;
    cursor_id := nullif(substring(cursor_payload from cursor_separator + 1), '');
    if cursor_id is null then
      raise exception 'invalid recorder cursor';
    end if;
  end if;

  select
    coalesce(array_agg(page.id order by page.sort_at desc, page.id desc), array[]::text[]),
    coalesce(array_agg(page.sort_at order by page.sort_at desc, page.id desc), array[]::timestamptz[])
    into selected_ids, selected_created_ats
  from (
    select
      match_row.id,
      coalesce(match_row.created_at, '-infinity'::timestamptz) as sort_at
    from public.matches match_row
    left join public.match_results result on result.match_id = match_row.id
    where (
        match_row.created_by = safe_profile_id
        or match_row.referee_id = safe_profile_id
        or exists (
          select 1
          from public.match_players player
          where player.match_id = match_row.id
            and player.user_id = safe_profile_id
        )
        or coalesce(match_row.played_player_ids -> 'teamA', '[]'::jsonb) ? safe_profile_id
        or coalesce(match_row.played_player_ids -> 'teamB', '[]'::jsonb) ? safe_profile_id
        or coalesce(match_row.reserve_players -> 'teamA', '[]'::jsonb) ? safe_profile_id
        or coalesce(match_row.reserve_players -> 'teamB', '[]'::jsonb) ? safe_profile_id
      )
      and coalesce(match_row.rules ->> 'recordType', 'standard') not in ('personal_record', 'solo')
      and match_row.status in ('agreed', 'approval', 'disputed')
      and (
        (
          match_row.status = 'disputed'
          and exists (
            select 1
            from public.match_disputes dispute
            where dispute.match_id = match_row.id
              and dispute.status = 'open'
          )
        )
        or (match_row.started_at is not null and match_row.ended_at is null)
        or (
          match_row.ended_at is not null
          and result.final_submitted_at is null
          and clock_timestamp() <= match_row.ended_at
            + make_interval(mins => greatest(1, coalesce(match_row.stat_entry_minutes, 60)))
        )
        or (
          result.final_submitted_at is not null
          and match_row.status in ('approval', 'disputed')
          and (
            exists (
              select 1
              from public.match_disputes dispute
              where dispute.match_id = match_row.id
                and dispute.status = 'open'
            )
            or clock_timestamp() <= greatest(match_row.ended_at, result.final_submitted_at)
              + make_interval(
                  mins => case
                    when match_row.dispute_minutes in (10, 15, 20) then match_row.dispute_minutes
                    else 15
                  end
                )
          )
        )
      )
      and (
        cursor_created_at is null
        or coalesce(match_row.created_at, '-infinity'::timestamptz) < cursor_created_at
        or (
          coalesce(match_row.created_at, '-infinity'::timestamptz) = cursor_created_at
          and match_row.id < cursor_id
        )
      )
    order by coalesce(match_row.created_at, '-infinity'::timestamptz) desc, match_row.id desc
    limit safe_limit + 1
  ) page;

  has_more := cardinality(selected_ids) > safe_limit;
  page_ids := selected_ids[1:least(cardinality(selected_ids), safe_limit)];

  return jsonb_build_object(
    'ids', to_jsonb(coalesce(page_ids, array[]::text[])),
    'cursor', case when has_more then
      'play:' || selected_created_ats[safe_limit]::text || '|' || selected_ids[safe_limit]
      else null
    end,
    'exhausted', not has_more
  );
end
$function$;

revoke all on function public.rankball_recorder_match_page(text, integer, text)
  from public, anon, authenticated, service_role;
grant execute on function public.rankball_recorder_match_page(text, integer, text) to service_role;
