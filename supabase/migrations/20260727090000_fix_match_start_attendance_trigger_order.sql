begin;

drop trigger if exists aa_mark_pending_attendance_no_show_at_start on public.matches;
drop trigger if exists zz_mark_pending_attendance_no_show_at_start on public.matches;

create trigger aa_mark_pending_attendance_no_show_at_start
after update of started_at on public.matches
for each row execute function public.rankball_mark_pending_attendance_no_show_at_start();

select pg_notify('pgrst', 'reload schema');

commit;
