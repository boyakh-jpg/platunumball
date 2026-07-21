create index if not exists matches_profile_icon_host_idx
  on public.matches (created_by, status, id);

create index if not exists matches_profile_icon_court_idx
  on public.matches (status, court_id, id);

create index if not exists match_players_profile_icon_peers_idx
  on public.match_players (match_id, side, user_id);

create or replace function public.rankball_profile_icon_verified_metrics(p_profile_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_profile_id text := nullif(btrim(p_profile_id), '');
  base_metrics jsonb;
  hosted_match_count integer := 0;
  distinct_court_count integer := 0;
  distinct_teammate_count integer := 0;
  distinct_opponent_count integer := 0;
  accepted_invite_count integer := 0;
  community_service_count integer := 0;
  position_variety_count integer := 0;
begin
  if safe_profile_id is null then
    raise exception 'missing_profile_id' using errcode = '22023';
  end if;

  base_metrics := public.rankball_profile_icon_metrics(safe_profile_id)
    - 'points'
    - 'rebounds'
    - 'assists'
    - 'steals'
    - 'blocks'
    - 'stealsBlocks'
    - 'interiorStops'
    - 'doubleDoubleCount'
    - 'tripleDoubleCount'
    - 'mvpPerformanceCount'
    - 'scoringLeaderGameCount'
    - 'reboundLeaderGameCount'
    - 'assistLeaderGameCount'
    - 'stealLeaderGameCount'
    - 'blockLeaderGameCount';

  select count(*)::integer
  into hosted_match_count
  from public.matches match_row
  where match_row.created_by = safe_profile_id
    and match_row.status = 'confirmed';

  select count(distinct nullif(btrim(match_row.court_id), ''))::integer
  into distinct_court_count
  from public.match_players self_player
  join public.matches match_row on match_row.id = self_player.match_id
  where self_player.user_id = safe_profile_id
    and match_row.status = 'confirmed'
    and nullif(btrim(match_row.court_id), '') is not null;

  select count(distinct peer_player.user_id)::integer
  into distinct_teammate_count
  from public.match_players self_player
  join public.matches match_row on match_row.id = self_player.match_id
  join public.match_players peer_player on peer_player.match_id = self_player.match_id
  where self_player.user_id = safe_profile_id
    and match_row.status = 'confirmed'
    and nullif(btrim(peer_player.user_id), '') is not null
    and peer_player.user_id <> safe_profile_id
    and (
      case
        when lower(coalesce(nullif(self_player.side, ''), 'teamA')) in ('teamb', 'b') then 'B'
        else 'A'
      end
    ) = (
      case
        when lower(coalesce(nullif(peer_player.side, ''), 'teamA')) in ('teamb', 'b') then 'B'
        else 'A'
      end
    );

  select count(distinct peer_player.user_id)::integer
  into distinct_opponent_count
  from public.match_players self_player
  join public.matches match_row on match_row.id = self_player.match_id
  join public.match_players peer_player on peer_player.match_id = self_player.match_id
  where self_player.user_id = safe_profile_id
    and match_row.status = 'confirmed'
    and nullif(btrim(peer_player.user_id), '') is not null
    and peer_player.user_id <> safe_profile_id
    and (
      case
        when lower(coalesce(nullif(self_player.side, ''), 'teamA')) in ('teamb', 'b') then 'B'
        else 'A'
      end
    ) <> (
      case
        when lower(coalesce(nullif(peer_player.side, ''), 'teamA')) in ('teamb', 'b') then 'B'
        else 'A'
      end
    );

  accepted_invite_count :=
    coalesce((base_metrics->>'recruitingInviteAcceptedCount')::integer, 0)
    + coalesce((base_metrics->>'teamInviteAcceptedCount')::integer, 0);

  community_service_count :=
    coalesce((base_metrics->>'refereeCount')::integer, 0)
    + coalesce((base_metrics->>'recorderCount')::integer, 0);

  position_variety_count :=
    case when coalesce((base_metrics->>'pgAppearances')::integer, 0) > 0 then 1 else 0 end
    + case when coalesce((base_metrics->>'sgAppearances')::integer, 0) > 0 then 1 else 0 end
    + case when coalesce((base_metrics->>'sfAppearances')::integer, 0) > 0 then 1 else 0 end
    + case when coalesce((base_metrics->>'pfAppearances')::integer, 0) > 0 then 1 else 0 end
    + case when coalesce((base_metrics->>'cAppearances')::integer, 0) > 0 then 1 else 0 end;

  return base_metrics || jsonb_build_object(
    'hostedMatchCount', hosted_match_count,
    'distinctCourtCount', distinct_court_count,
    'distinctTeammateCount', distinct_teammate_count,
    'distinctOpponentCount', distinct_opponent_count,
    'acceptedInviteCount', accepted_invite_count,
    'communityServiceCount', community_service_count,
    'positionVarietyCount', position_variety_count
  );
end;
$$;

revoke all on function public.rankball_profile_icon_verified_metrics(text) from public, anon, authenticated;
grant execute on function public.rankball_profile_icon_verified_metrics(text) to service_role;
