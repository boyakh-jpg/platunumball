import { getBearerToken, getSupabaseAdminClient, sendJson } from "../_supabaseAdmin.js";

function assertAccess(request) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret || getBearerToken(request) !== secret) {
    const error = new Error("invalid_cleanup_secret");
    error.statusCode = 401;
    throw error;
  }
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    assertAccess(request);
    const client = getSupabaseAdminClient();
    const checks = [];
    let artifactCleanup = null;
    let artifactCleanupError = null;
    const simulationNoticeResult = await client.rpc("rankball_cleanup_simulation_notices");
    const simulationNoticeCleanup = simulationNoticeResult.data;
    const simulationNoticeCleanupError = simulationNoticeResult.error;
    let cleanupAttempts = 0;
    const deletedTotals = {
      matches: 0,
      tournaments: 0,
      notifications: Number(simulationNoticeCleanup?.deletedNotifications ?? 0),
      discordDeliveries: Number(simulationNoticeCleanup?.deletedDiscordDeliveries ?? 0),
    };
    do {
      cleanupAttempts += 1;
      const result = await client.rpc("rankball_cleanup_simulation_artifacts");
      artifactCleanup = result.data;
      artifactCleanupError = result.error;
      if (artifactCleanupError) break;
      deletedTotals.matches += Number(artifactCleanup?.deletedMatches ?? 0);
      deletedTotals.tournaments += Number(artifactCleanup?.deletedTournaments ?? 0);
      deletedTotals.notifications += Number(artifactCleanup?.deletedNotifications ?? 0);
      deletedTotals.discordDeliveries += Number(artifactCleanup?.deletedDiscordDeliveries ?? 0);
    } while (
      cleanupAttempts < 10
      && (
        Number(artifactCleanup?.remainingMatches ?? 0) > 0
        || Number(artifactCleanup?.remainingTournaments ?? 0) > 0
      )
    );
    const artifactRowsRemain = Number(artifactCleanup?.remainingMatches ?? 0) > 0
      || Number(artifactCleanup?.remainingTournaments ?? 0) > 0;
    checks.push({
      table: "simulation_artifacts",
      ok: !artifactCleanupError && !artifactRowsRemain,
      error: artifactCleanupError?.message ?? (artifactRowsRemain ? "simulation_artifacts_remaining" : null),
      attempts: cleanupAttempts,
      deleted: deletedTotals.matches + deletedTotals.tournaments,
      remaining: Number(artifactCleanup?.remainingMatches ?? 0) + Number(artifactCleanup?.remainingTournaments ?? 0),
    });
    const remainingNotifications = Number(artifactCleanup?.remainingNotifications ?? 0)
      + Number(simulationNoticeCleanup?.remainingNotifications ?? 0);
    const remainingDiscordDeliveries = Number(artifactCleanup?.remainingDiscordDeliveries ?? 0)
      + Number(simulationNoticeCleanup?.remainingDiscordDeliveries ?? 0);
    checks.push({
      table: "simulation_notifications",
      ok: !artifactCleanupError && !simulationNoticeCleanupError && remainingNotifications === 0 && remainingDiscordDeliveries === 0,
      error: artifactCleanupError?.message
        ?? simulationNoticeCleanupError?.message
        ?? (remainingNotifications > 0 || remainingDiscordDeliveries > 0 ? "simulation_notifications_remaining" : null),
      deleted: deletedTotals.notifications,
      deletedDiscordDeliveries: deletedTotals.discordDeliveries,
      remaining: remainingNotifications,
      remainingDiscordDeliveries,
    });
    let recruitingCleanup = null;
    let recruitingCleanupError = null;
    let recruitingCleanupAttempts = 0;
    let deletedRecruitingPosts = 0;
    let deletedRecruitingNotifications = 0;
    let deletedRecruitingDiscordDeliveries = 0;
    do {
      recruitingCleanupAttempts += 1;
      const result = await client.rpc("rankball_cleanup_simulation_recruiting_artifacts", { p_limit: 250 });
      recruitingCleanup = result.data;
      recruitingCleanupError = result.error;
      if (recruitingCleanupError) break;
      deletedRecruitingPosts += Number(recruitingCleanup?.deletedPosts ?? 0);
      deletedRecruitingNotifications += Number(recruitingCleanup?.deletedNotifications ?? 0);
      deletedRecruitingDiscordDeliveries += Number(recruitingCleanup?.deletedDiscordDeliveries ?? 0);
    } while (recruitingCleanupAttempts < 10 && Number(recruitingCleanup?.remainingPosts ?? 0) > 0);
    const recruitingRowsRemain = Number(recruitingCleanup?.remainingPosts ?? 0) > 0;
    checks.push({
      table: "simulation_recruiting_artifacts",
      ok: !recruitingCleanupError && !recruitingRowsRemain,
      error: recruitingCleanupError?.message ?? (recruitingRowsRemain ? "simulation_recruiting_artifacts_remaining" : null),
      attempts: recruitingCleanupAttempts,
      deleted: deletedRecruitingPosts,
      deletedNotifications: deletedRecruitingNotifications,
      deletedDiscordDeliveries: deletedRecruitingDiscordDeliveries,
      remaining: Number(recruitingCleanup?.remainingPosts ?? 0),
    });
    const { data: feedCleanup, error: feedCleanupError } = await client.rpc("rankball_cleanup_room_feed");
    checks.push({
      table: "user_room_feed",
      ok: !feedCleanupError,
      error: feedCleanupError?.message ?? null,
      closed: (feedCleanup ?? []).reduce((sum, row) => sum + Number(row.affected_count ?? 0), 0),
    });

    const failed = checks.filter((check) => !check.ok);
    sendJson(response, 200, {
      ok: failed.length === 0,
      failedCount: failed.length,
      closed: checks.reduce((sum, check) => sum + Number(check.closed ?? 0), 0),
      deleted: checks.reduce((sum, check) => sum + Number(check.deleted ?? 0), 0),
      checks,
    });
  } catch (error) {
    sendJson(response, error.statusCode || 500, { error: error.message || "cleanup_sim_failed" });
  }
}
