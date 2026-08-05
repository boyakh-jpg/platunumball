import { getSupabaseAdminClient } from "../_supabaseAdmin.js";
import {
  allowSystemReadRequest,
  assertSystemSecretAccess,
  readSystemRequestBody,
  sendJson,
} from "./_systemRequest.js";
import { REQUIRED_COLUMNS } from "./schemaHealthRequirements.js";




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
];

function canEnsureSimulationTestActors() {
  return process.env.VERCEL_ENV !== "production" && process.env.NODE_ENV !== "production";
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
  const { data: ownerProfiles, error: ownerProfileError } = await client
    .from("profiles")
    .select("id, name, handle, hashtag")
    .eq("id", "p_a6086f1e61b34ebca4")
    .limit(1);
  if (ownerProfileError) throw ownerProfileError;

  const owner = ownerProfiles?.[0];
  if (!owner?.id) {
    return {
      ok: false,
      error: "owner_profile_missing",
      ownerFound: false,
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
        profile: owner.id,
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
