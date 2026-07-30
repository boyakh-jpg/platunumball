import { getSupabaseAdminClient } from "../_supabaseAdmin.js";
import {
  allowSystemReadRequest,
  assertSystemSecretAccess,
  readSystemRequestBody,
  sendJson,
} from "./_systemRequest.js";

const REQUIRED_COLUMNS = {
  profiles: [
    "id",
    "auth_user_id",
    "test_login_id",
    "hashtag",
    "onboarding_complete",
    "discord_user_id",
    "avatar_key",
    "avatar_source",
    "avatar_icon_key",
    "avatar_uploaded_at",
    "avatar_upload_count",
    "avatar_background_enabled",
    "avatar_border_enabled",
    "avatar_border_color",
    "discord_avatar_url",
    "placement_match_count",
    "placement_evidence_weight",
    "placement_weighted_sum",
    "placement_completed_at",
  ],
  public_profiles: [
    "id",
    "name",
    "hashtag",
    "trust_score",
    "updated_at",
    "avatar_key",
    "avatar_source",
    "avatar_icon_key",
    "avatar_background_enabled",
    "avatar_border_enabled",
    "avatar_border_color",
    "discord_avatar_url",
    "placement_match_count",
  ],
  teams: [
    "id",
    "name",
    "home_court",
    "region",
    "emblem_key",
    "emblem_previous_key",
    "emblem_source",
    "emblem_updated_at",
    "emblem_uploaded_at",
    "emblem_upload_count",
    "emblem_color",
    "emblem_border_enabled",
    "emblem_border_color",
    "emblem_text_mode",
    "emblem_abbreviation",
    "emblem_font",
    "emblem_violation_count",
    "emblem_upload_blocked_until",
    "emblem_moderated_at",
    "emblem_moderation_reason",
    "deleted_at",
    "roster_mmr",
    "performance_adjustment",
  ],
  team_members: [
    "team_id",
    "user_id",
    "role",
  ],
  recruiting_posts: [
    "id",
    "visibility",
    "player_id",
    "mode",
    "room_state",
    "host_join_mode",
    "host_ready",
    "side_capacity",
    "bench_capacity",
    "dispute_minutes",
    "status",
  ],
  recruiting_applications: [
    "post_id",
    "player_id",
    "kind",
    "side",
    "status",
    "player_ids",
  ],
  room_remake_events: [
    "id",
    "owner_id",
    "root_source_type",
    "root_source_id",
    "source_post_id",
    "source_match_id",
    "new_post_id",
    "sequence",
    "warning_level",
    "created_at",
  ],
  matches: [
    "id",
    "title",
    "mode",
    "court_name",
    "visibility",
    "status",
    "ranked",
    "scheduled_date",
    "scheduled_time",
    "team_a_id",
    "team_b_id",
    "score_a",
    "score_b",
    "rules",
    "dispute_minutes",
    "created_by",
    "agreed_at",
    "started_at",
    "ended_at",
    "confirmed_at",
    "cancelled_at",
    "voided_at",
    "updated_at",
    "dual_score_recorder_side",
  ],
  match_players: [
    "match_id",
    "user_id",
    "side",
    "slot_order",
    "position",
  ],
  match_attendance_entries: [
    "match_id",
    "player_id",
    "side",
    "original_role",
    "status",
    "method",
    "checked_in_at",
    "updated_at",
  ],
  match_substitution_events: [
    "id",
    "match_id",
    "side",
    "active_out_player_id",
    "active_in_player_id",
    "reason",
    "confirmed_by",
    "clock_active_elapsed_ms",
    "minimum_meaningful_seconds",
    "created_at",
  ],
  match_play_intervals: [
    "id",
    "match_id",
    "player_id",
    "side",
    "started_at",
    "started_active_elapsed_ms",
    "ended_at",
    "ended_active_elapsed_ms",
  ],
  match_score_events: [
    "id",
    "match_id",
    "side",
    "actor_profile_id",
    "event_type",
    "requested_delta",
    "score_before",
    "score_after",
    "score_revision",
    "authority_scope",
    "created_at",
  ],
  match_recorder_takeover_requests: [
    "id",
    "match_id",
    "side",
    "requested_by",
    "expected_recorder_id",
    "status",
    "created_at",
    "resolved_at",
    "resolved_by",
  ],
  profile_icon_unlocks: [
    "profile_id",
    "icon_key",
    "unlocked_at",
    "progress_snapshot",
  ],
  match_player_competitive_snapshots: [
    "match_id",
    "profile_id",
    "side",
    "age_group",
    "mode_mmr",
    "integrated_mmr",
    "mmr_eligible",
    "team_id",
    "team_role",
    "snapshot_source",
    "snapshotted_at",
  ],
  match_record_archives: [
    "match_id",
    "archive_version",
    "record_date",
    "occurred_at",
    "payload",
    "is_active",
    "updated_at",
  ],
  match_record_participants: [
    "match_id",
    "profile_id",
    "record_date",
    "side",
    "team_name",
    "opponent_team_name",
    "score_for",
    "score_against",
    "outcome",
    "stats",
    "record_type",
    "visibility",
    "owner_profile_id",
  ],
  match_record_teams: [
    "match_id",
    "team_id",
    "record_date",
    "side",
    "team_name",
    "opponent_team_name",
    "score_for",
    "score_against",
    "outcome",
    "visibility",
    "reader_ids",
  ],
  match_record_refresh_queue: [
    "match_id",
    "queued_at",
  ],
  user_room_feed: [
    "profile_id",
    "entity_type",
    "entity_id",
    "relation",
    "feed_scope",
    "region_key",
    "status",
    "timing_type",
    "scheduled_date",
    "card_json",
    "sort_at",
    "is_active",
  ],
  room_feed_cards: [
    "entity_type",
    "entity_id",
    "card_json",
    "updated_at",
  ],
  match_results: [
    "match_id",
    "score_a",
    "score_b",
    "submitted_by",
    "result_revision",
    "stat_submissions",
    "score_revision_a",
    "score_revision_b",
    "score_submissions",
  ],
  player_match_stats: [
    "match_id",
    "user_id",
    "points",
    "rebounds",
    "assists",
    "steals",
    "blocks",
    "turnovers",
    "fouls",
  ],
  profile_personal_record_summaries: [
    "profile_id", "record_count", "win_count", "loss_count", "draw_count", "stat_count",
    "points", "rebounds", "assists", "steals", "blocks", "fouls",
    "public_record_count", "public_win_count", "public_loss_count", "public_draw_count", "public_stat_count",
    "public_points", "public_rebounds", "public_assists", "public_steals", "public_blocks", "public_fouls",
    "last_record_id", "last_record_at", "updated_at",
  ],
  profile_match_summaries: [
    "profile_id",
    "match_count",
    "win_count",
    "stat_match_count",
    "loss_count",
    "draw_count",
    "points",
    "rebounds",
    "assists",
    "steals",
    "blocks",
    "fouls",
    "last_match_id",
    "last_match_at",
    "updated_at",
  ],
  match_agreements: [
    "match_id",
    "user_id",
    "side",
  ],
  match_approvals: [
    "match_id",
    "user_id",
    "side",
  ],
  match_disputes: [
    "match_id",
    "user_id",
    "reason",
    "request_payload",
    "status",
  ],
  favorites: [
    "user_id",
    "target_type",
    "target_id",
  ],
  approved_courts: [
    "id",
    "name",
    "status",
    "region_key",
    "updated_at",
  ],
  notifications: [
    "id",
    "user_id",
    "target_user_id",
    "match_id",
    "recruiting_post_id",
    "due_at",
    "payload",
  ],
  discord_notification_deliveries: [
    "id",
    "notification_id",
    "target_user_id",
    "discord_user_id",
    "event",
    "status",
    "payload",
    "queued_at",
    "send_at",
    "sent_at",
    "attempt_count",
  ],
  room_chat_messages: [
    "id",
    "room_type",
    "room_id",
    "user_id",
    "body",
    "message_seq",
    "source",
    "external_message_id",
    "external_channel_id",
    "external_thread_id",
    "metadata",
  ],
  room_discord_links: [
    "id",
    "room_type",
    "room_id",
    "discord_channel_id",
    "discord_thread_id",
    "enabled",
  ],
  rating_policy: [
    "id",
    "version",
    "policy",
    "reason",
    "updated_by",
    "updated_at",
  ],
};

const REQUIRED_FEED_TRIGGERS = [
  "rankball_recruiting_posts_feed_refresh",
  "rankball_recruiting_applications_feed_refresh",
  "rankball_matches_feed_refresh",
  "rankball_match_players_feed_refresh",
  "rankball_match_agreements_feed_refresh",
  "rankball_match_approvals_feed_refresh",
  "rankball_match_disputes_feed_refresh",
  "rankball_team_members_feed_dependency_refresh",
  "rankball_match_results_feed_refresh",
  "rankball_player_match_stats_feed_refresh",
  "rankball_profiles_feed_dependency_refresh",
  "rankball_teams_feed_dependency_refresh",
  "rankball_approved_courts_feed_dependency_refresh",
  "rankball_courts_feed_dependency_refresh",
];

function canEnsureSimulationTestActors() {
  if (process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production") {
    return process.env.RANKBALL_ALLOW_PRODUCTION_TEST_SEED === "true";
  }
  return true;
}

async function checkTable(client, table, columns) {
  const { error } = await client
    .from(table)
    .select(columns.join(","))
    .limit(1);
  return {
    table,
    ok: !error,
    error: error?.message ?? null,
    columns,
  };
}

export function projectActiveRpcContractChecks(rpcGrantCheck) {
  const projectedByRpc = new Map();
  const contractChecks = Array.isArray(rpcGrantCheck?.checks) ? rpcGrantCheck.checks : [];

  contractChecks.forEach((check) => {
    const detail = check?.detail ?? {};
    const rpc = String(detail.function ?? "").trim();
    if (!rpc || detail.lifecycle !== "active") return;

    const projected = projectedByRpc.get(rpc) ?? {
      rpc,
      ok: true,
      error: null,
      probeError: null,
      contractChecks: [],
    };
    projected.ok = projected.ok && check?.ok === true;
    projected.contractChecks.push(check?.check_name ?? rpc);
    if (check?.ok !== true) {
      projected.error = `${check?.check_name ?? rpc}: ${JSON.stringify(detail)}`;
    }
    projectedByRpc.set(rpc, projected);
  });

  if (projectedByRpc.size === 0 && rpcGrantCheck?.error) {
    return [{
      rpc: "rankball_rpc_contract_registry",
      ok: false,
      error: rpcGrantCheck.error,
      probeError: null,
      contractChecks: [],
    }];
  }

  return [...projectedByRpc.values()].sort((left, right) => left.rpc.localeCompare(right.rpc));
}

async function checkScoreOperationPolicy(client) {
  const { data, error } = await client.rpc("rankball_match_score_operation_policy_health");
  const result = Array.isArray(data) ? data[0] : data;
  return {
    ok: !error && result?.ok === true,
    error: error?.message ?? (!result ? "score_operation_policy_health_empty" : null),
    checks: result?.checks ?? {},
  };
}

async function checkMatchOverlapPolicy(client) {
  const { data, error } = await client.rpc("rankball_match_overlap_policy_health");
  const result = Array.isArray(data) ? data[0] : data;
  return {
    ok: !error && result?.ok === true,
    error: error?.message ?? (!result ? "match_overlap_policy_health_empty" : null),
    checks: result ?? {},
  };
}

async function checkDisputeWindowPolicy(client, scoreOperationPolicyCheck) {
  const { data, error } = await client.rpc("rankball_dispute_window_health");
  const checks = Array.isArray(data) ? data : [];
  const failed = checks.filter((check) => {
    if (check?.ok === true) return false;
    return !(
      scoreOperationPolicyCheck?.checks?.autoFinalizeLocked === true
      && check?.check_name === "rpc_normalization"
      && check?.detail === "public.rankball_match_auto_finalize_action(text,timestamp with time zone)"
    );
  });
  return {
    ok: !error && checks.length > 0 && failed.length === 0,
    error: error?.message ?? (checks.length === 0 ? "dispute_window_health_empty" : null),
    failed,
    checks,
  };
}

async function checkFeedTriggers(client) {
  const { data, error } = await client.rpc("rankball_feed_trigger_health");
  if (error) {
    return {
      ok: false,
      error: error.message || "feed_trigger_health_failed",
      missing: REQUIRED_FEED_TRIGGERS,
      triggers: [],
    };
  }

  const triggers = Array.isArray(data) ? data : [];
  const triggerNames = new Set(triggers.map((row) => row.trigger_name).filter(Boolean));
  const missing = REQUIRED_FEED_TRIGGERS.filter((name) => !triggerNames.has(name));
  return {
    ok: missing.length === 0,
    error: null,
    missing,
    triggers,
  };
}

async function checkRlsPolicies(client) {
  const rpcNames = ["rankball_rls_policy_health", "rankball_referee_rls_policy_health"];
  const results = await Promise.all(rpcNames.map(async (rpcName) => {
    const { data, error } = await client.rpc(rpcName);
    return { rpcName, data, error };
  }));
  const rpcError = results.find((result) => result.error);
  if (rpcError) {
    return {
      ok: false,
      error: rpcError.error.message || `${rpcError.rpcName}_failed`,
      failed: [],
      checks: [],
    };
  }

  const checks = results.flatMap((result) => (
    Array.isArray(result.data)
      ? result.data.map((check) => ({ ...check, rpcName: result.rpcName }))
      : []
  ));
  const failed = checks.filter((check) => !check.ok);
  return {
    ok: failed.length === 0,
    error: null,
    failed,
    checks,
  };
}

async function checkRpcGrants(client) {
  const results = await Promise.all([
    client.rpc("rankball_rpc_grant_health"),
    client.rpc("rankball_authoritative_rpc_grant_health"),
  ]);
  const failedRpc = results.find((result) => result.error);
  if (failedRpc?.error) {
    return {
      ok: false,
      error: failedRpc.error.message || "rpc_grant_health_failed",
      failed: [],
      checks: [],
    };
  }

  const checks = results.flatMap((result) => Array.isArray(result.data) ? result.data : []);
  const registryAclCheck = checks.find(
    (check) => check?.check_name === "rpc_grant:rankball_rpc_contract_registry_acl",
  );
  const registryContractChecks = checks.filter((check) => (
    ["active", "retired"].includes(check?.detail?.lifecycle)
    && Boolean(check?.detail?.function)
    && Boolean(check?.detail?.signature)
  ));
  const registryBacked = registryAclCheck?.ok === true && registryContractChecks.length > 0;
  const failed = checks.filter((check) => !check.ok);
  if (!registryBacked) {
    failed.push({
      check_name: "rpc_grant:rankball_rpc_contract_registry_health",
      ok: false,
      detail: {
        registryAclPresent: Boolean(registryAclCheck),
        contractCheckCount: registryContractChecks.length,
      },
    });
  }
  return {
    ok: registryBacked && failed.length === 0,
    error: registryBacked ? null : "rpc_contract_registry_health_missing",
    failed,
    checks,
  };
}

async function checkProfileIdentity(client) {
  return checkSingleRpcHealth(
    client,
    "rankball_profile_identity_health",
    "profile_identity_health_failed",
  );
}

async function checkSingleRpcHealth(client, rpcName, fallbackError) {
  const { data, error } = await client.rpc(rpcName);
  if (error) {
    return {
      ok: false,
      error: error.message || fallbackError,
      failed: [],
      checks: [],
    };
  }

  const checks = Array.isArray(data) ? data : [];
  const failed = checks.filter((check) => !check.ok);
  return {
    ok: failed.length === 0,
    error: null,
    failed,
    checks,
  };
}

async function checkTournamentInvitations(client) {
  return checkSingleRpcHealth(
    client,
    "rankball_tournament_invitation_health",
    "tournament_invitation_health_failed",
  );
}

async function checkTournamentStartDeliveries(client) {
  return checkSingleRpcHealth(
    client,
    "rankball_tournament_start_delivery_health",
    "tournament_start_delivery_health_failed",
  );
}

async function ensureSimulationTestActors(client) {
  const { data: profiles, error: profileError } = await client
    .from("profiles")
    .select("id, test_login_id")
    .eq("test_login_id", "rankball-001")
    .limit(1);
  if (profileError) throw profileError;

  const profile = profiles?.[0];
  if (!profile?.id) return { ok: false, error: "rankball_001_profile_missing" };

  const now = new Date().toISOString();
  const actorPayload = {
    source: "backend_simulation",
    testLoginId: "rankball-001",
  };
  const rows = [
    {
      table: "admin_appointments",
      row: {
        id: "sim_admin_rankball_001",
        user_id: profile.id,
        role: "admin",
        grade: "owner",
        status: "active",
        appointed_by: profile.id,
        starts_at: now,
        ends_at: null,
        payload: actorPayload,
        created_at: now,
        updated_at: now,
      },
    },
    {
      table: "referee_appointments",
      row: {
        id: "sim_referee_rankball_001",
        user_id: profile.id,
        role: "referee",
        grade: "gold",
        status: "active",
        appointed_by: profile.id,
        starts_at: now,
        ends_at: null,
        payload: actorPayload,
        created_at: now,
        updated_at: now,
      },
    },
  ];

  const checks = [];
  for (const item of rows) {
    const { error } = await client
      .from(item.table)
      .upsert(item.row, { onConflict: "id" });
    checks.push({ table: item.table, ok: !error, error: error?.message ?? null });
  }

  const failed = checks.filter((check) => !check.ok);
  return {
    ok: failed.length === 0,
    profileId: profile.id,
    testLoginId: profile.test_login_id,
    checks,
  };
}

async function ensureCourtAdminAppointments(client) {
  const { data: rankballProfiles, error: rankballProfileError } = await client
    .from("profiles")
    .select("id, test_login_id")
    .eq("test_login_id", "rankball-001")
    .limit(1);
  if (rankballProfileError) throw rankballProfileError;

  const { data: ownerProfiles, error: ownerProfileError } = await client
    .from("profiles")
    .select("id, name, handle, hashtag")
    .or("id.eq.boyakh,name.eq.boyakh,handle.eq.boyakh,handle.eq.#boyakh,hashtag.eq.boyakh,hashtag.eq.#boyakh")
    .limit(1);
  if (ownerProfileError) throw ownerProfileError;

  const regionManager = rankballProfiles?.[0];
  const owner = ownerProfiles?.[0];
  if (!regionManager?.id || !owner?.id) {
    return {
      ok: false,
      error: !owner?.id ? "boyakh_profile_missing" : "rankball_001_profile_missing",
      ownerFound: Boolean(owner?.id),
      regionManagerFound: Boolean(regionManager?.id),
    };
  }

  const now = new Date().toISOString();
  const rows = [
    {
      id: "ap_owner_boyakh",
      user_id: owner.id,
      role: "admin",
      grade: "owner",
      status: "active",
      appointed_by: owner.id,
      starts_at: null,
      ends_at: null,
      payload: {
        source: "schema_health_court_admin_bootstrap",
        profile: "boyakh",
      },
      created_at: now,
      updated_at: now,
    },
    {
      id: "ap_region_rankball_001",
      user_id: regionManager.id,
      role: "admin",
      grade: "regionManager",
      status: "active",
      appointed_by: owner.id,
      starts_at: null,
      ends_at: null,
      payload: {
        source: "schema_health_court_admin_bootstrap",
        profile: "rankball-001",
        region: "서울특별시",
      },
      created_at: now,
      updated_at: now,
    },
  ];

  const { error } = await client
    .from("admin_appointments")
    .upsert(rows, { onConflict: "id" });
  const { data: savedRows, error: readError } = await client
    .from("admin_appointments")
    .select("id,user_id,role,grade,status,starts_at,ends_at")
    .in("id", rows.map((row) => row.id));

  return {
    ok: !error && !readError,
    error: error?.message ?? readError?.message ?? null,
    ownerProfileId: owner.id,
    regionManagerProfileId: regionManager.id,
    rows: (savedRows ?? rows).map((row) => ({ id: row.id, userId: row.user_id ?? row.userId, grade: row.grade, status: row.status, startsAt: row.starts_at ?? null, endsAt: row.ends_at ?? null })),
  };
}

export default async function handler(request, response) {
  if (!allowSystemReadRequest(request, response)) return;

  try {
    assertSystemSecretAccess(request, "invalid_schema_health_secret");
    const body = await readSystemRequestBody(request);
    const client = getSupabaseAdminClient();
    const checks = await Promise.all(
      Object.entries(REQUIRED_COLUMNS).map(([table, columns]) => checkTable(client, table, columns)),
    );
    const feedTriggerCheck = await checkFeedTriggers(client);
    const rlsPolicyCheck = await checkRlsPolicies(client);
    const scoreOperationPolicyCheck = await checkScoreOperationPolicy(client);
    const rpcGrantCheck = await checkRpcGrants(client);
    const rpcChecks = projectActiveRpcContractChecks(rpcGrantCheck);
    const matchOverlapPolicyCheck = await checkMatchOverlapPolicy(client);
    const disputeWindowCheck = await checkDisputeWindowPolicy(client, scoreOperationPolicyCheck);
    const profileIdentityCheck = await checkProfileIdentity(client);
    const tournamentInvitationCheck = await checkTournamentInvitations(client);
    const tournamentStartDeliveryCheck = await checkTournamentStartDeliveries(client);
    const failed = checks.filter((check) => !check.ok);
    const failedRpcs = rpcChecks.filter((check) => !check.ok);
    const simulationSeed = body?.ensureTestActors === true
      ? canEnsureSimulationTestActors()
        ? await ensureSimulationTestActors(client)
        : { ok: false, skipped: true, error: "production_test_seed_disabled" }
      : null;
    const courtAdminSeed = body?.ensureCourtAdmins === true
      ? await ensureCourtAdminAppointments(client)
      : null;
    sendJson(response, 200, {
      ok: failed.length === 0 && failedRpcs.length === 0 && feedTriggerCheck.ok && rlsPolicyCheck.ok && scoreOperationPolicyCheck.ok && rpcGrantCheck.ok && matchOverlapPolicyCheck.ok && disputeWindowCheck.ok && profileIdentityCheck.ok && tournamentInvitationCheck.ok && tournamentStartDeliveryCheck.ok && (!simulationSeed || simulationSeed.ok) && (!courtAdminSeed || courtAdminSeed.ok),
      failedCount: failed.length,
      failedRpcCount: failedRpcs.length,
      failedFeedTriggerCount: feedTriggerCheck.missing.length,
      failedRlsPolicyCount: rlsPolicyCheck.failed.length,
      failedRpcGrantCount: rpcGrantCheck.failed.length,
      failedMatchOverlapPolicyCount: matchOverlapPolicyCheck.ok ? 0 : 1,
      failedDisputeWindowCount: disputeWindowCheck.failed.length,
      failedProfileIdentityCount: profileIdentityCheck.failed.length,
      failedTournamentInvitationCount: tournamentInvitationCheck.failed.length,
      failedTournamentStartDeliveryCount: tournamentStartDeliveryCheck.failed.length,
      checks,
      rpcChecks,
      feedTriggerCheck,
      rlsPolicyCheck,
      scoreOperationPolicyCheck,
      rpcGrantCheck,
      matchOverlapPolicyCheck,
      disputeWindowCheck,
      profileIdentityCheck,
      tournamentInvitationCheck,
      tournamentStartDeliveryCheck,
      simulationSeed,
      courtAdminSeed,
    });
  } catch (error) {
    sendJson(response, error.statusCode || 500, { error: error.message || "schema_health_failed" });
  }
}
