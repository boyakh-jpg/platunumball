-- Keep the mandatory match actor discipline guard on an indexed lookup path.

create index if not exists admin_disciplinary_actions_active_user_window_idx
  on public.admin_disciplinary_actions (user_id, starts_at, ends_at)
  where status = 'active';
