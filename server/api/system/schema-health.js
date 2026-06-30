import { getSupabaseAdminClient, readJsonBody, sendJson } from "../_supabaseAdmin.js";

const REQUIRED_COLUMNS = {
  profiles: [
    "id",
    "auth_user_id",
    "test_login_id",
    "hashtag",
    "onboarding_complete",
    "discord_user_id",
  ],
  public_profiles: [
    "id",
    "name",
    "hashtag",
    "trust_score",
    "updated_at",
  ],
  teams: [
    "id",
    "name",
    "home_court",
    "region",
    "deleted_at",
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
    "created_by",
    "agreed_at",
    "started_at",
    "ended_at",
    "confirmed_at",
    "cancelled_at",
    "voided_at",
    "updated_at",
  ],
  match_players: [
    "match_id",
    "user_id",
    "side",
    "slot_order",
  ],
  user_room_feed: [
    "profile_id",
    "entity_type",
    "entity_id",
    "relation",
    "feed_scope",
    "region_key",
    "status",
    "card_json",
    "sort_at",
    "is_active",
  ],
  match_results: [
    "match_id",
    "score_a",
    "score_b",
    "submitted_by",
    "stat_submissions",
  ],
  player_match_stats: [
    "match_id",
    "user_id",
    "points",
    "rebounds",
    "assists",
    "steals",
    "blocks",
    "fouls",
  ],
  profile_match_summaries: [
    "profile_id",
    "match_count",
    "win_count",
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
    "updated_at",
  ],
  notifications: [
    "id",
    "user_id",
    "target_user_id",
    "match_id",
    "recruiting_post_id",
    "payload",
  ],
};

const REQUIRED_RPCS = [
  {
    name: "rankball_current_recruiting_post_ids",
    args: { p_profile_id: "", p_limit: 1 },
  },
  {
    name: "rankball_recruiting_feed_counts",
    args: { p_profile_id: "" },
  },
  {
    name: "rankball_recruiting_slot_position_action",
    args: { p_actor_profile_id: "", p_post_id: "", p_player_id: "", p_position: "" },
  },
  {
    name: "rankball_recruiting_cancel_participation_action",
    args: { p_actor_profile_id: "", p_post_id: "" },
  },
  {
    name: "rankball_recruiting_interest_player_action",
    args: { p_actor_profile_id: "", p_post_id: "", p_join_mode: "", p_team_id: "", p_side: "", p_reserve: false, p_position: "" },
  },
  {
    name: "rankball_recruiting_applicant_placement_action",
    args: { p_actor_profile_id: "", p_post_id: "", p_player_id: "", p_side: "", p_reserve: false },
  },
  {
    name: "rankball_recruiting_action",
    args: { p_actor_profile_id: "", p_action: "", p_post_row: {}, p_application_rows: [], p_notification_rows: [], p_expected_updated_at: null },
  },
  {
    name: "rankball_match_action",
    args: {
      p_actor_profile_id: "",
      p_action: "",
      p_match_row: {},
      p_player_rows: [],
      p_result_row: null,
      p_stat_rows: [],
      p_agreement_rows: [],
      p_approval_rows: [],
      p_dispute_rows: [],
      p_notification_rows: [],
      p_replace_result: false,
    },
  },
  {
    name: "rankball_match_list",
    args: { p_profile_id: "", p_limit: 1, p_cursor: "", p_active_only: true },
  },
  {
    name: "rankball_cleanup_room_feed",
    args: { p_now: new Date(0).toISOString() },
  },
  {
    name: "rankball_match_end_action",
    args: { p_actor_profile_id: "", p_match_id: "", p_started_at: "", p_ended_at: "" },
  },
  {
    name: "rankball_match_late_player_action",
    args: {
      p_actor_profile_id: "",
      p_action: "addMatchLatePlayer",
      p_match_id: "",
      p_player_id: "",
      p_played_player_ids: {},
      p_reserve_players: {},
      p_anonymous_players: {},
      p_mmr_excluded_player_ids: [],
    },
  },
];

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

function getBearerToken(request) {
  const header = request.headers.authorization || request.headers.Authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? "";
}

function assertAccess(request) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret || getBearerToken(request) !== secret) {
    const error = new Error("invalid_schema_health_secret");
    error.statusCode = 401;
    throw error;
  }
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

async function checkRpc(client, name, args) {
  const { error } = await client.rpc(name, args);
  const message = error?.message ?? "";
  const missing = error?.code === "PGRST202" || /could not find|not found|does not exist/i.test(message);
  return {
    rpc: name,
    ok: !missing,
    error: missing ? message : null,
    probeError: !missing ? message || null : null,
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

export default async function handler(request, response) {
  if (!["GET", "POST"].includes(request.method)) {
    response.setHeader("Allow", "GET, POST");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    assertAccess(request);
    const body = request.method === "POST" ? await readJsonBody(request) : {};
    const client = getSupabaseAdminClient();
    const checks = await Promise.all(
      Object.entries(REQUIRED_COLUMNS).map(([table, columns]) => checkTable(client, table, columns)),
    );
    const rpcChecks = await Promise.all(REQUIRED_RPCS.map((rpc) => checkRpc(client, rpc.name, rpc.args)));
    const feedTriggerCheck = await checkFeedTriggers(client);
    const failed = checks.filter((check) => !check.ok);
    const failedRpcs = rpcChecks.filter((check) => !check.ok);
    const simulationSeed = body?.ensureTestActors === true
      ? canEnsureSimulationTestActors()
        ? await ensureSimulationTestActors(client)
        : { ok: false, skipped: true, error: "production_test_seed_disabled" }
      : null;
    sendJson(response, 200, {
      ok: failed.length === 0 && failedRpcs.length === 0 && feedTriggerCheck.ok && (!simulationSeed || simulationSeed.ok),
      failedCount: failed.length,
      failedRpcCount: failedRpcs.length,
      failedFeedTriggerCount: feedTriggerCheck.missing.length,
      checks,
      rpcChecks,
      feedTriggerCheck,
      simulationSeed,
    });
  } catch (error) {
    sendJson(response, error.statusCode || 500, { error: error.message || "schema_health_failed" });
  }
}
