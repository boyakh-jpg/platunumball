begin;

alter function public.rankball_apply_room_rule_patch(jsonb, jsonb, text) stable;

commit;
