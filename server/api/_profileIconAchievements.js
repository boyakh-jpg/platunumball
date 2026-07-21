import { getProfileIconAchievementState, PROFILE_ICON_CATALOG } from "../../src/lib/profileIcons.js";

const PROFILE_ICON_ID_SET = new Set(PROFILE_ICON_CATALOG.map((icon) => icon.id));

function getProgressSnapshot(icon, metrics) {
  return Object.fromEntries((icon.achievement?.requirements ?? []).map(({ metric }) => [metric, Number(metrics?.[metric] ?? 0)]));
}

export async function refreshProfileIconAchievements(supabase, profileId) {
  const [verifiedMetricsResult, refereeExamResult] = await Promise.all([
    supabase.rpc("rankball_profile_icon_verified_metrics", {
      p_profile_id: profileId,
    }),
    supabase
      .from("referee_exam_attempts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", profileId)
      .in("status", ["passed", "failed"])
      .not("finished_at", "is", null),
  ]);
  const { data: verifiedMetrics, error: metricsError } = verifiedMetricsResult;
  if (metricsError) throw metricsError;
  if (refereeExamResult.error) throw refereeExamResult.error;

  const metrics = {
    ...(verifiedMetrics ?? {}),
    refereeExamCompletedCount: Number(refereeExamResult.count ?? 0),
  };

  const achievedIcons = PROFILE_ICON_CATALOG.filter((icon) => (
    getProfileIconAchievementState(icon.id, metrics)?.achieved === true
  ));
  if (achievedIcons.length) {
    const { error: unlockError } = await supabase
      .from("profile_icon_unlocks")
      .upsert(achievedIcons.map((icon) => ({
        profile_id: profileId,
        icon_key: icon.id,
        progress_snapshot: getProgressSnapshot(icon, metrics),
      })), {
        onConflict: "profile_id,icon_key",
        ignoreDuplicates: true,
      });
    if (unlockError) throw unlockError;
  }

  const { data: unlockedRows, error: unlockedError } = await supabase
    .from("profile_icon_unlocks")
    .select("icon_key,unlocked_at")
    .eq("profile_id", profileId)
    .order("unlocked_at", { ascending: true });
  if (unlockedError) throw unlockedError;

  const activeUnlockedRows = (unlockedRows ?? []).filter((row) => PROFILE_ICON_ID_SET.has(row.icon_key));

  return {
    metrics: metrics ?? {},
    unlockedIconKeys: activeUnlockedRows.map((row) => row.icon_key),
    unlockedAtByKey: Object.fromEntries(activeUnlockedRows.map((row) => [row.icon_key, row.unlocked_at])),
    unlockedCount: activeUnlockedRows.length,
    totalIconCount: PROFILE_ICON_CATALOG.length,
  };
}
