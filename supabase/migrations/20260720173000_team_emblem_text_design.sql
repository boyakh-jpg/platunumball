alter table public.teams
  add column if not exists emblem_text_mode text not null default 'name',
  add column if not exists emblem_abbreviation text,
  add column if not exists emblem_font text not null default 'sport';

alter table public.teams
  alter column emblem_text_mode set default 'name',
  alter column emblem_text_mode set not null,
  alter column emblem_font set default 'sport',
  alter column emblem_font set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'teams_emblem_text_mode_check') then
    alter table public.teams
      add constraint teams_emblem_text_mode_check
      check (emblem_text_mode in ('name', 'abbreviation'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'teams_emblem_abbreviation_check') then
    alter table public.teams
      add constraint teams_emblem_abbreviation_check
      check (emblem_abbreviation is null or char_length(btrim(emblem_abbreviation)) between 1 and 8);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'teams_emblem_font_check') then
    alter table public.teams
      add constraint teams_emblem_font_check
      check (emblem_font in ('sport', 'gothic', 'serif', 'mono'));
  end if;
end
$$;

create or replace function public.rankball_update_team_emblem_design(
  p_actor_profile_id text,
  p_team_id text,
  p_emblem_color text,
  p_border_enabled boolean,
  p_border_color text,
  p_text_mode text,
  p_abbreviation text,
  p_font text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_team public.teams%rowtype;
  safe_team_id text := btrim(coalesce(p_team_id, ''));
  safe_emblem_color text := lower(btrim(coalesce(p_emblem_color, '#f05a46')));
  safe_border_color text := lower(btrim(coalesce(p_border_color, '#f05a46')));
  safe_text_mode text := lower(btrim(coalesce(p_text_mode, 'name')));
  safe_abbreviation text := nullif(regexp_replace(btrim(coalesce(p_abbreviation, '')), '\s+', ' ', 'g'), '');
  safe_font text := lower(btrim(coalesce(p_font, 'sport')));
  now_at timestamptz := clock_timestamp();
begin
  select * into current_team
  from public.teams
  where id = safe_team_id
    and deleted_at is null
  for update;

  if current_team.id is null then
    raise exception 'team_not_found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.team_members
    where team_id = safe_team_id
      and user_id = p_actor_profile_id
      and role = 'captain'
  ) then
    raise exception 'team_emblem_permission_denied' using errcode = '42501';
  end if;
  if safe_emblem_color !~ '^#[0-9a-f]{6}$' or safe_border_color !~ '^#[0-9a-f]{6}$' then
    raise exception 'invalid_emblem_color' using errcode = '22023';
  end if;
  if safe_text_mode not in ('name', 'abbreviation') then
    raise exception 'invalid_team_emblem_text_mode' using errcode = '22023';
  end if;
  if char_length(coalesce(safe_abbreviation, '')) > 8
    or (safe_text_mode = 'abbreviation' and safe_abbreviation is null) then
    raise exception 'invalid_team_emblem_abbreviation' using errcode = '22023';
  end if;
  if safe_font not in ('sport', 'gothic', 'serif', 'mono') then
    raise exception 'invalid_team_emblem_font' using errcode = '22023';
  end if;

  update public.teams
  set
    emblem_color = safe_emblem_color,
    emblem_border_enabled = coalesce(p_border_enabled, true),
    emblem_border_color = safe_border_color,
    emblem_text_mode = safe_text_mode,
    emblem_abbreviation = safe_abbreviation,
    emblem_font = safe_font,
    emblem_updated_at = now_at,
    updated_at = now_at
  where id = safe_team_id
  returning * into current_team;

  return jsonb_build_object(
    'ok', true,
    'teamId', current_team.id,
    'emblemColor', current_team.emblem_color,
    'emblemBorderEnabled', current_team.emblem_border_enabled,
    'emblemBorderColor', current_team.emblem_border_color,
    'emblemTextMode', current_team.emblem_text_mode,
    'emblemAbbreviation', current_team.emblem_abbreviation,
    'emblemFont', current_team.emblem_font,
    'emblemUpdatedAt', current_team.emblem_updated_at
  );
end;
$$;

revoke all on function public.rankball_update_team_emblem_design(text, text, text, boolean, text, text, text, text) from public, anon, authenticated;
grant execute on function public.rankball_update_team_emblem_design(text, text, text, boolean, text, text, text, text) to service_role;

drop trigger if exists rankball_teams_feed_dependency_refresh on public.teams;
create trigger rankball_teams_feed_dependency_refresh
after insert or update of id, name, accent, emblem_key, emblem_source, emblem_updated_at, emblem_color, emblem_border_enabled, emblem_border_color, emblem_text_mode, emblem_abbreviation, emblem_font, deleted_at or delete
on public.teams
for each row execute function public.rankball_refresh_team_feed_dependency_trigger();

select pg_notify('pgrst', 'reload schema');
