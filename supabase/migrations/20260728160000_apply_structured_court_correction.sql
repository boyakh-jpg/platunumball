begin;

create or replace function public.rankball_apply_court_correction_report(
  p_actor_profile_id text,
  p_actor_admin_level integer,
  p_report_id text,
  p_reason text,
  p_feedback text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  report_row public.reports%rowtype;
  correction jsonb;
  safe_reason text := btrim(coalesce(p_reason, ''));
  safe_feedback text := btrim(coalesce(p_feedback, ''));
  field_name text;
  attribute_name text;
  proposed_value text;
  court_patch jsonb;
  court_result jsonb;
  review_result jsonb;
begin
  if public.rankball_admin_level_for_profile(p_actor_profile_id, p_actor_admin_level) < 50 then
    raise exception 'admin_discipline_permission_required' using errcode = '42501';
  end if;
  if char_length(safe_reason) < 4 or char_length(safe_reason) > 500
    or char_length(safe_feedback) < 4 or char_length(safe_feedback) > 500 then
    raise exception 'admin_review_detail_invalid' using errcode = '22023';
  end if;

  select *
  into report_row
  from public.reports
  where id = p_report_id
  for update;

  if not found then
    raise exception 'report_not_found' using errcode = 'P0002';
  end if;
  if report_row.status <> 'open' then
    raise exception 'report_already_processed' using errcode = '23505';
  end if;
  if report_row.type <> 'court' then
    raise exception 'court_correction_report_required' using errcode = '22023';
  end if;

  correction := coalesce(report_row.payload -> 'courtCorrection', '{}'::jsonb);
  field_name := coalesce(correction ->> 'field', '');
  attribute_name := coalesce(correction ->> 'attribute', '');
  proposed_value := coalesce(correction ->> 'proposedValue', '');

  court_patch := case
    when field_name = 'access' and attribute_name = 'publicAccess'
      and proposed_value in ('public', 'private', 'unknown')
      then jsonb_build_object(attribute_name, proposed_value)
    when field_name = 'access' and attribute_name = 'accessType'
      and proposed_value in ('walk_in', 'reservation', 'restricted', 'unknown')
      then jsonb_build_object(attribute_name, proposed_value)
    when field_name = 'access' and attribute_name = 'paid'
      and proposed_value in ('true', 'false', 'null')
      then jsonb_build_object(attribute_name, case
        when proposed_value = 'null' then 'null'::jsonb
        else to_jsonb(proposed_value::boolean)
      end)
    when field_name = 'operation' and attribute_name = 'operationalStatus'
      and proposed_value in ('active', 'pending', 'closed', 'unknown')
      then jsonb_build_object(attribute_name, proposed_value)
    when field_name = 'court' and attribute_name = 'indoorOutdoor'
      and proposed_value in ('outdoor', 'indoor', 'mixed', 'unknown')
      then jsonb_build_object(attribute_name, proposed_value)
    when field_name = 'court' and attribute_name = 'courtKind'
      and proposed_value in ('official', 'street_hoop', 'unknown')
      then jsonb_build_object(attribute_name, proposed_value)
    when field_name = 'court' and attribute_name = 'surfaceType'
      and proposed_value in ('asphalt', 'urethane', 'dirt', 'indoor_wood', 'indoor_synthetic', 'unknown')
      then jsonb_build_object(attribute_name, proposed_value)
    when field_name = 'court' and attribute_name = 'courtLayout'
      and proposed_value in ('full', 'half', 'single_hoop', 'unknown')
      then jsonb_build_object(attribute_name, proposed_value)
    when field_name = 'court' and attribute_name = 'lighting'
      and proposed_value in ('true', 'false', 'null')
      then jsonb_build_object(attribute_name, case
        when proposed_value = 'null' then 'null'::jsonb
        else to_jsonb(proposed_value::boolean)
      end)
    else null
  end;

  if court_patch is null then
    raise exception 'structured_court_correction_required' using errcode = '22023';
  end if;

  court_result := public.rankball_admin_update_court_with_auto_unit(
    p_actor_profile_id,
    p_actor_admin_level,
    report_row.target_id,
    court_patch,
    safe_reason
  );

  review_result := public.rankball_commit_admin_review_action(
    p_actor_profile_id,
    p_actor_admin_level,
    report_row.id,
    'validReport',
    null,
    3,
    safe_reason,
    safe_feedback
  );

  update public.reports
  set resolution = coalesce(resolution, '{}'::jsonb)
        || jsonb_build_object(
          'actionType', 'applyCourtCorrection',
          'appliedPatch', court_patch
        ),
      payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
        'resolution',
        coalesce(resolution, '{}'::jsonb)
          || jsonb_build_object(
            'actionType', 'applyCourtCorrection',
            'appliedPatch', court_patch
          )
      )
  where id = report_row.id;

  update public.admin_audit_log
  set payload = coalesce(payload, '{}'::jsonb)
        || jsonb_build_object(
          'actionType', 'applyCourtCorrection',
          'appliedPatch', court_patch
        )
  where report_id = report_row.id
    and type = 'report_action'
    and status = 'committed';

  return coalesce(review_result, '{}'::jsonb) || jsonb_build_object(
    'actionType', 'applyCourtCorrection',
    'appliedPatch', court_patch,
    'courtUpdate', court_result
  );
end;
$$;

revoke all on function public.rankball_apply_court_correction_report(text, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.rankball_apply_court_correction_report(text, integer, text, text, text) to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
