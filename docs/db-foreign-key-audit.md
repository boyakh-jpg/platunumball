# DB Foreign Key Audit

Date: 2026-07-03

Scope:

- Supabase/Postgres public schema.
- `*_id`, `*_by`, `id`-like columns only.
- No migration created.
- No data or column deleted.
- No cascade delete recommended by default.
- Names, address fields, lat/lng, JSON snapshots, `card_json`, and free-text labels are not FK candidates.

## Summary

- Existing FK count: 36.
- Missing high-confidence FK candidates checked: 36.
- High-confidence candidates with orphan count 0: 35.
- Orphan data found: 1 row in `matches.tournament_id`.
- Polymorphic/cache/external ids must not get hard FK without schema split.

## SQL Used

Existing FK list:

```sql
select
  nsp.nspname as table_schema,
  child.relname as table_name,
  child_att.attname as column_name,
  parent_nsp.nspname as foreign_table_schema,
  parent.relname as foreign_table_name,
  parent_att.attname as foreign_column_name,
  pg_get_constraintdef(con.oid) as definition,
  con.conname as constraint_name
from pg_constraint con
join pg_class child on child.oid = con.conrelid
join pg_namespace nsp on nsp.oid = child.relnamespace
join pg_class parent on parent.oid = con.confrelid
join pg_namespace parent_nsp on parent_nsp.oid = parent.relnamespace
join unnest(con.conkey) with ordinality as child_cols(attnum, ord) on true
join unnest(con.confkey) with ordinality as parent_cols(attnum, ord) on parent_cols.ord = child_cols.ord
join pg_attribute child_att on child_att.attrelid = child.oid and child_att.attnum = child_cols.attnum
join pg_attribute parent_att on parent_att.attrelid = parent.oid and parent_att.attnum = parent_cols.attnum
where con.contype = 'f'
  and nsp.nspname = 'public'
order by child.relname, con.conname, child_cols.ord;
```

Candidate columns:

```sql
with fk_cols as (
  select kcu.table_schema, kcu.table_name, kcu.column_name
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on tc.constraint_name = kcu.constraint_name
   and tc.table_schema = kcu.table_schema
  where tc.constraint_type = 'FOREIGN KEY'
    and tc.table_schema = 'public'
)
select
  c.table_name,
  c.column_name,
  c.data_type,
  c.is_nullable,
  case when fk_cols.column_name is null then false else true end as has_fk
from information_schema.columns c
left join fk_cols
  on fk_cols.table_schema = c.table_schema
 and fk_cols.table_name = c.table_name
 and fk_cols.column_name = c.column_name
where c.table_schema = 'public'
  and (c.column_name = 'id' or c.column_name like '%\_id' escape '\' or c.column_name like '%\_by' escape '\')
  and c.table_name not like 'pg_%'
order by c.table_name, c.ordinal_position;
```

## Existing Foreign Keys

| child | parent | definition |
| --- | --- | --- |
| `favorites.user_id` | `profiles.id` | `ON DELETE CASCADE` |
| `match_agreements.match_id` | `matches.id` | `ON DELETE CASCADE` |
| `match_agreements.user_id` | `profiles.id` | `ON DELETE CASCADE` |
| `match_approvals.match_id` | `matches.id` | `ON DELETE CASCADE` |
| `match_approvals.user_id` | `profiles.id` | `ON DELETE CASCADE` |
| `match_disputes.match_id` | `matches.id` | `ON DELETE CASCADE` |
| `match_disputes.user_id` | `profiles.id` | `ON DELETE SET NULL` |
| `match_players.match_id` | `matches.id` | `ON DELETE CASCADE` |
| `match_players.team_id` | `teams.id` | `ON DELETE SET NULL` |
| `match_players.user_id` | `profiles.id` | `ON DELETE CASCADE` |
| `match_results.match_id` | `matches.id` | `ON DELETE CASCADE` |
| `match_results.submitted_by` | `profiles.id` | `ON DELETE SET NULL` |
| `matches.court_id` | `courts.id` | `ON DELETE SET NULL` |
| `matches.created_by` | `profiles.id` | `ON DELETE SET NULL` |
| `matches.team_a_id` | `teams.id` | `ON DELETE SET NULL` |
| `matches.team_b_id` | `teams.id` | `ON DELETE SET NULL` |
| `notifications.match_id` | `matches.id` | `ON DELETE CASCADE` |
| `notifications.user_id` | `profiles.id` | `ON DELETE CASCADE` |
| `player_match_stats.match_id` | `matches.id` | `ON DELETE CASCADE` |
| `player_match_stats.user_id` | `profiles.id` | `ON DELETE CASCADE` |
| `profile_match_summaries.profile_id` | `profiles.id` | `ON DELETE CASCADE` |
| `profiles.auth_user_id` | `auth.users.id` | `ON DELETE SET NULL` |
| `recruiting_applications.player_id` | `profiles.id` | `ON DELETE CASCADE` |
| `recruiting_applications.post_id` | `recruiting_posts.id` | `ON DELETE CASCADE` |
| `recruiting_applications.team_id` | `teams.id` | `ON DELETE SET NULL` |
| `recruiting_posts.court_id` | `courts.id` | `ON DELETE SET NULL` |
| `recruiting_posts.player_id` | `profiles.id` | `ON DELETE SET NULL` |
| `recruiting_posts.team_id` | `teams.id` | `ON DELETE SET NULL` |
| `reports.user_id` | `profiles.id` | `ON DELETE SET NULL` |
| `room_chat_messages.user_id` | `profiles.id` | `ON DELETE CASCADE` |
| `team_invitations.from_user_id` | `profiles.id` | `ON DELETE CASCADE` |
| `team_invitations.target_user_id` | `profiles.id` | `ON DELETE CASCADE` |
| `team_invitations.team_id` | `teams.id` | `ON DELETE CASCADE` |
| `team_members.team_id` | `teams.id` | `ON DELETE CASCADE` |
| `team_members.user_id` | `profiles.id` | `ON DELETE CASCADE` |
| `tournament_teams.tournament_id` | `tournaments.id` | `ON DELETE CASCADE` |

## FK Candidates

| table | column | type | likely parent | confidence | orphan check SQL | recommendation |
| --- | --- | --- | --- | --- | --- | --- |
| `admin_appointments` | `user_id` | `text nullable` | `profiles.id` | high | `OC-01` | `ON DELETE SET NULL` |
| `admin_appointments` | `appointed_by` | `text nullable` | `profiles.id` | high | `OC-02` | `ON DELETE SET NULL` |
| `admin_audit_log` | `report_id` | `text nullable` | `reports.id` | high | `OC-03` | `ON DELETE SET NULL` |
| `admin_audit_log` | `request_id` | `text nullable` | `court_requests.id` | high | `OC-04` | `ON DELETE SET NULL` |
| `admin_audit_log` | `target_user_id` | `text nullable` | `profiles.id` | high | `OC-05` | `ON DELETE SET NULL` |
| `admin_audit_log` | `created_by` | `text nullable` | `profiles.id` | high | `OC-06` | `ON DELETE SET NULL` |
| `admin_disciplinary_actions` | `user_id` | `text nullable` | `profiles.id` | high | `OC-07` | `ON DELETE SET NULL` |
| `admin_disciplinary_actions` | `source_report_id` | `text nullable` | `reports.id` | high | `OC-08` | `ON DELETE SET NULL` |
| `admin_disciplinary_actions` | `created_by` | `text nullable` | `profiles.id` | high | `OC-09` | `ON DELETE SET NULL` |
| `approved_courts` | `source_request_id` | `text nullable` | `court_requests.id` | high | `OC-10` | `ON DELETE SET NULL` |
| `approved_courts` | `approved_by` | `text nullable` | `profiles.id` | high | `OC-11` | `ON DELETE SET NULL` |
| `approved_courts` | `hidden_by` | `text nullable` | `profiles.id` | high | `OC-12` | `ON DELETE SET NULL` |
| `court_requests` | `requested_by` | `text nullable` | `profiles.id` | high | `OC-13` | `ON DELETE SET NULL` |
| `court_reviews` | `match_id` | `text not null` | `matches.id` | high | `OC-14` | `ON DELETE RESTRICT` |
| `court_reviews` | `reviewer_id` | `text not null` | `profiles.id` | high | `OC-15` | `ON DELETE RESTRICT` |
| `court_reviews` | `hidden_by` | `text nullable` | `profiles.id` | high | `OC-16` | `ON DELETE SET NULL` |
| `discord_notification_deliveries` | `notification_id` | `text nullable` | `notifications.id` | high | `OC-17` | `ON DELETE SET NULL` |
| `discord_notification_deliveries` | `target_user_id` | `text nullable` | `profiles.id` | high | `OC-18` | `ON DELETE SET NULL` |
| `matches` | `tournament_id` | `text nullable` | `tournaments.id` | high | `OC-19` | fix orphan first, then `ON DELETE SET NULL` |
| `matches` | `referee_id` | `text nullable` | `profiles.id` | high | `OC-20` | `ON DELETE SET NULL` |
| `matches` | `former_referee_id` | `text nullable` | `profiles.id` | high | `OC-21` | `ON DELETE SET NULL` |
| `notifications` | `target_user_id` | `text nullable` | `profiles.id` | high | `OC-22` | `ON DELETE SET NULL` |
| `notifications` | `recruiting_post_id` | `text nullable` | `recruiting_posts.id` | high | `OC-23` | `ON DELETE SET NULL` |
| `player_match_stats` | `recorded_by` | `text nullable` | `profiles.id` | high | `OC-24` | `ON DELETE SET NULL` |
| `profile_match_summaries` | `last_match_id` | `text nullable` | `matches.id` | high | `OC-25` | `ON DELETE SET NULL` |
| `recruiting_applications` | `source_team_id` | `text nullable` | `teams.id` | high | `OC-26` | `ON DELETE SET NULL` |
| `recruiting_posts` | `target_team_id` | `text nullable` | `teams.id` | high | `OC-27` | `ON DELETE SET NULL` |
| `recruiting_posts` | `referee_id` | `text nullable` | `profiles.id` | high | `OC-28` | `ON DELETE SET NULL` |
| `referee_appointments` | `user_id` | `text nullable` | `profiles.id` | high | `OC-29` | `ON DELETE SET NULL` |
| `referee_appointments` | `appointed_by` | `text nullable` | `profiles.id` | high | `OC-30` | `ON DELETE SET NULL` |
| `referee_exam_attempts` | `user_id` | `text nullable` | `profiles.id` | high | `OC-31` | `ON DELETE SET NULL` |
| `referee_requests` | `requested_by` | `text nullable` | `profiles.id` | high | `OC-32` | `ON DELETE SET NULL` |
| `reports` | `resolved_by` | `text nullable` | `profiles.id` | high | `OC-33` | `ON DELETE SET NULL` |
| `tournament_teams` | `team_id` | `text not null` | `teams.id` | high | `OC-34` | `ON DELETE RESTRICT` |
| `tournament_teams` | `approved_by` | `text nullable` | `profiles.id` | high | `OC-35` | `ON DELETE SET NULL` |
| `tournaments` | `created_by` | `text nullable` | `profiles.id` | high | `OC-36` | `ON DELETE SET NULL` |

## Orphan Check SQL

`OC-01` to `OC-36` were run with this query:

```sql
select * from (
  select 'admin_appointments.user_id -> profiles.id' as candidate, count(*)::int as orphan_count from public.admin_appointments c left join public.profiles p on p.id = c.user_id where c.user_id is not null and p.id is null
  union all select 'admin_appointments.appointed_by -> profiles.id', count(*)::int from public.admin_appointments c left join public.profiles p on p.id = c.appointed_by where c.appointed_by is not null and p.id is null
  union all select 'admin_audit_log.report_id -> reports.id', count(*)::int from public.admin_audit_log c left join public.reports p on p.id = c.report_id where c.report_id is not null and p.id is null
  union all select 'admin_audit_log.request_id -> court_requests.id', count(*)::int from public.admin_audit_log c left join public.court_requests p on p.id = c.request_id where c.request_id is not null and p.id is null
  union all select 'admin_audit_log.target_user_id -> profiles.id', count(*)::int from public.admin_audit_log c left join public.profiles p on p.id = c.target_user_id where c.target_user_id is not null and p.id is null
  union all select 'admin_audit_log.created_by -> profiles.id', count(*)::int from public.admin_audit_log c left join public.profiles p on p.id = c.created_by where c.created_by is not null and p.id is null
  union all select 'admin_disciplinary_actions.user_id -> profiles.id', count(*)::int from public.admin_disciplinary_actions c left join public.profiles p on p.id = c.user_id where c.user_id is not null and p.id is null
  union all select 'admin_disciplinary_actions.source_report_id -> reports.id', count(*)::int from public.admin_disciplinary_actions c left join public.reports p on p.id = c.source_report_id where c.source_report_id is not null and p.id is null
  union all select 'admin_disciplinary_actions.created_by -> profiles.id', count(*)::int from public.admin_disciplinary_actions c left join public.profiles p on p.id = c.created_by where c.created_by is not null and p.id is null
  union all select 'approved_courts.source_request_id -> court_requests.id', count(*)::int from public.approved_courts c left join public.court_requests p on p.id = c.source_request_id where c.source_request_id is not null and p.id is null
  union all select 'approved_courts.approved_by -> profiles.id', count(*)::int from public.approved_courts c left join public.profiles p on p.id = c.approved_by where c.approved_by is not null and p.id is null
  union all select 'approved_courts.hidden_by -> profiles.id', count(*)::int from public.approved_courts c left join public.profiles p on p.id = c.hidden_by where c.hidden_by is not null and p.id is null
  union all select 'court_requests.requested_by -> profiles.id', count(*)::int from public.court_requests c left join public.profiles p on p.id = c.requested_by where c.requested_by is not null and p.id is null
  union all select 'court_reviews.match_id -> matches.id', count(*)::int from public.court_reviews c left join public.matches p on p.id = c.match_id where c.match_id is not null and p.id is null
  union all select 'court_reviews.reviewer_id -> profiles.id', count(*)::int from public.court_reviews c left join public.profiles p on p.id = c.reviewer_id where c.reviewer_id is not null and p.id is null
  union all select 'court_reviews.hidden_by -> profiles.id', count(*)::int from public.court_reviews c left join public.profiles p on p.id = c.hidden_by where c.hidden_by is not null and p.id is null
  union all select 'discord_notification_deliveries.notification_id -> notifications.id', count(*)::int from public.discord_notification_deliveries c left join public.notifications p on p.id = c.notification_id where c.notification_id is not null and p.id is null
  union all select 'discord_notification_deliveries.target_user_id -> profiles.id', count(*)::int from public.discord_notification_deliveries c left join public.profiles p on p.id = c.target_user_id where c.target_user_id is not null and p.id is null
  union all select 'matches.tournament_id -> tournaments.id', count(*)::int from public.matches c left join public.tournaments p on p.id = c.tournament_id where c.tournament_id is not null and p.id is null
  union all select 'matches.referee_id -> profiles.id', count(*)::int from public.matches c left join public.profiles p on p.id = c.referee_id where c.referee_id is not null and p.id is null
  union all select 'matches.former_referee_id -> profiles.id', count(*)::int from public.matches c left join public.profiles p on p.id = c.former_referee_id where c.former_referee_id is not null and p.id is null
  union all select 'notifications.target_user_id -> profiles.id', count(*)::int from public.notifications c left join public.profiles p on p.id = c.target_user_id where c.target_user_id is not null and p.id is null
  union all select 'notifications.recruiting_post_id -> recruiting_posts.id', count(*)::int from public.notifications c left join public.recruiting_posts p on p.id = c.recruiting_post_id where c.recruiting_post_id is not null and p.id is null
  union all select 'player_match_stats.recorded_by -> profiles.id', count(*)::int from public.player_match_stats c left join public.profiles p on p.id = c.recorded_by where c.recorded_by is not null and p.id is null
  union all select 'profile_match_summaries.last_match_id -> matches.id', count(*)::int from public.profile_match_summaries c left join public.matches p on p.id = c.last_match_id where c.last_match_id is not null and p.id is null
  union all select 'recruiting_applications.source_team_id -> teams.id', count(*)::int from public.recruiting_applications c left join public.teams p on p.id = c.source_team_id where c.source_team_id is not null and p.id is null
  union all select 'recruiting_posts.target_team_id -> teams.id', count(*)::int from public.recruiting_posts c left join public.teams p on p.id = c.target_team_id where c.target_team_id is not null and p.id is null
  union all select 'recruiting_posts.referee_id -> profiles.id', count(*)::int from public.recruiting_posts c left join public.profiles p on p.id = c.referee_id where c.referee_id is not null and p.id is null
  union all select 'referee_appointments.user_id -> profiles.id', count(*)::int from public.referee_appointments c left join public.profiles p on p.id = c.user_id where c.user_id is not null and p.id is null
  union all select 'referee_appointments.appointed_by -> profiles.id', count(*)::int from public.referee_appointments c left join public.profiles p on p.id = c.appointed_by where c.appointed_by is not null and p.id is null
  union all select 'referee_exam_attempts.user_id -> profiles.id', count(*)::int from public.referee_exam_attempts c left join public.profiles p on p.id = c.user_id where c.user_id is not null and p.id is null
  union all select 'referee_requests.requested_by -> profiles.id', count(*)::int from public.referee_requests c left join public.profiles p on p.id = c.requested_by where c.requested_by is not null and p.id is null
  union all select 'reports.resolved_by -> profiles.id', count(*)::int from public.reports c left join public.profiles p on p.id = c.resolved_by where c.resolved_by is not null and p.id is null
  union all select 'tournament_teams.team_id -> teams.id', count(*)::int from public.tournament_teams c left join public.teams p on p.id = c.team_id where c.team_id is not null and p.id is null
  union all select 'tournament_teams.approved_by -> profiles.id', count(*)::int from public.tournament_teams c left join public.profiles p on p.id = c.approved_by where c.approved_by is not null and p.id is null
  union all select 'tournaments.created_by -> profiles.id', count(*)::int from public.tournaments c left join public.profiles p on p.id = c.created_by where c.created_by is not null and p.id is null
) s
order by candidate;
```

## High Confidence Fixes

Safe for a future migration after review:

- Add FK for every high-confidence candidate with orphan count 0.
- Use `ON DELETE SET NULL` for nullable audit/profile/reference columns.
- Use `ON DELETE RESTRICT` for not-null historical rows.
- Do not add `matches.tournament_id` FK until the orphan row is cleaned.
- Do not use cascade delete unless product rule explicitly says child rows must die with parent.

## Needs Decision

| table | column | why |
| --- | --- | --- |
| `admin_audit_log` | `appointment_id` | Can reference `admin_appointments.id` or `referee_appointments.id`; one FK cannot cover both. Split column or add `appointment_type` before FK. |
| `court_reviews` | `court_id` | `rankball_submit_court_review` can derive from match court, payload, or synthetic id. Also court source has legacy `courts` plus `approved_courts`. |
| `matches` | `court_id` | FK already points to `courts.id`, while current logic also falls back to active `approved_courts`. Keep until court source is normalized. |
| `recruiting_posts` | `court_id` | FK already points to `courts.id`, while current logic also falls back to active `approved_courts`. Keep until court source is normalized. |
| `room_chat_messages` | `room_id` | Current `room_type` is `recruiting`, but column is typed for multi-room use. FK only if chat table is locked to recruiting rooms. |
| `notifications` | `invitation_id` | Can be team invitation id or recruiting invitation id from room state; no single parent table. |
| `user_room_feed` | `profile_id` | `feed_scope='profile'` is a profile id, but public feed can use legacy `profile_id='*'`. FK only after public feed key is split. |
| `recruiting_applications` | `source_entry_id` | Source entry is room/application snapshot identity, not a stable parent table key. |

## Orphan Data Found

| candidate | orphan count | row |
| --- | --- | --- |
| `matches.tournament_id -> tournaments.id` | 1 | `matches.id='m_mr3hh0sb_q3x4v'`, `tournament_id=''`, `status='confirmed'`, `title='직접 경기 마포 러너스 vs 성수 브릿지'` |

Fix before FK:

```sql
update public.matches
set tournament_id = null
where tournament_id is not null
  and btrim(tournament_id) = '';
```

Do not run this as part of the audit. This is a future data cleanup step.

## Do Not FK

| table | column | reason |
| --- | --- | --- |
| `favorites` | `target_id` | Polymorphic by `target_type`: profile/team/court. |
| `reports` | `target_id` | Polymorphic by `type`: match/player/court/court_request/court_review/etc. |
| `room_feed_cards` | `entity_id` | Polymorphic by `entity_type`: recruiting/match. |
| `user_room_feed` | `entity_id` | Polymorphic by `entity_type`: recruiting/match. |
| `profiles` | `test_login_id` | Test login handle, not parent table key. |
| `profiles` | `discord_user_id` | External Discord id, not local parent table key. |
| `discord_notification_deliveries` | `discord_user_id` | External Discord id, not local parent table key. |
| `public_profiles` | `id` | View projection of `profiles.id`; do not add FK to a view. |
