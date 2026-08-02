alter table public.favorites
  drop constraint if exists favorites_target_type_check;

alter table public.favorites
  add constraint favorites_target_type_check
  check (target_type in ('player', 'team', 'court', 'referee'))
  not valid;

alter table public.favorites
  validate constraint favorites_target_type_check;
