begin;

insert into public.profile_icon_unlocks (profile_id, icon_key, progress_snapshot)
select
  profile.id,
  '341-founding-player-s0',
  jsonb_build_object('foundingPlayer', 1, 'source', 'founding_player_backfill')
from public.profiles profile
where profile.founding_player
on conflict (profile_id, icon_key) do nothing;

commit;
