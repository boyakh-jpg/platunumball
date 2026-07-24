begin;

create index if not exists user_room_feed_inactive_profile_status_idx
  on public.user_room_feed (
    entity_type,
    profile_id,
    status,
    updated_at desc,
    entity_id
  )
  where is_active = false;

comment on index public.user_room_feed_inactive_profile_status_idx is
  '최근 7일간 취소된 모집방과 경기를 사용자 일정에서 조회하기 위한 비활성 피드 인덱스';

commit;
