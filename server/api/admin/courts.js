import { allowRequestMethod, readJsonBody, requireAdminContext, sendJson } from "../_supabaseAdmin.js";
import { buildCourtAddressNameUpdates } from "../../../shared/lib/courts.js";
import {
  NORMALIZATION_BATCH_SIZE,
  safeText,
  getCourtUpdateReason,
  getCourtReviewReason,
  normalizeBatchUpdates,
  loadCourtRows,
  loadHistoryRows,
  loadAllCourtAddressRows,
  loadAllCourtDuplicateRows,
} from "./courtAdminQueries.js";





























































export function getAdminCourtErrorStatus(error) {
  const explicitStatus = Number(error?.statusCode);
  if (Number.isInteger(explicitStatus) && explicitStatus >= 400 && explicitStatus <= 599) return explicitStatus;
  const message = String(error?.message ?? "");
  if (/admin_permission_required/i.test(message)) return 403;
  if (/court(?:_name_evidence)?_not_found/i.test(message)) return 404;
  if (/required|invalid|unchanged|patch|batch/i.test(message)) return 400;
  if (["23514", "22P02", "22003"].includes(error?.code)) return 400;
  if (error?.code === "23505") return 409;
  return 500;
}

export default async function handler(request, response) {
  if (!allowRequestMethod(request, response)) return;

  try {
    const context = await requireAdminContext(request, { minimumLevel: 50 });
    const adminLevel = context.adminLevel;
    const body = await readJsonBody(request);

    const operation = safeText(body.operation || "list");
    if (operation === "list") {
      sendJson(response, 200, await loadCourtRows(context, body));
      return;
    }
    if (operation === "history") {
      sendJson(response, 200, await loadHistoryRows(context, body));
      return;
    }
    if (operation === "duplicateGroups") {
      const plan = buildCourtAddressNameUpdates(await loadAllCourtDuplicateRows(context));
      sendJson(response, 200, {
        ok: true,
        groups: plan.reviewGroups,
        groupCount: plan.reviewGroups.length,
        duplicateCourtCount: plan.duplicateCourtCount,
      });
      return;
    }
    if (operation === "proximity") {
      const { data, error } = await context.supabase.rpc("rankball_admin_auto_group_nearby_courts", {
        p_actor_profile_id: context.profileId,
        p_actor_admin_level: adminLevel,
        p_court_id: safeText(body.courtId),
        p_facility_name: safeText(body.facilityName) || null,
        p_reason: "관리자 검수: 30m 근접 구장 자동 병합",
      });
      if (error) throw error;
      sendJson(response, 200, data ?? { ok: true, detectedCount: 1, courts: [] });
      return;
    }
    if (operation === "verifyCount") {
      const actualCount = Number(body.actualCount);
      const patch = body.patch && typeof body.patch === "object" && !Array.isArray(body.patch) ? body.patch : {};
      if (!Number.isSafeInteger(actualCount) || actualCount < 1 || actualCount > 2_147_483_647) {
        sendJson(response, 400, { error: "court_actual_count_invalid" });
        return;
      }
      if (JSON.stringify(patch).length > 32_768) {
        sendJson(response, 400, { error: "court_patch_invalid" });
        return;
      }
      const { data, error } = await context.supabase.rpc("rankball_admin_verify_nearby_court_count", {
        p_actor_profile_id: context.profileId,
        p_actor_admin_level: adminLevel,
        p_court_id: safeText(body.courtId),
        p_actual_count: actualCount,
        p_facility_name: safeText(body.facilityName) || null,
        p_patch: patch,
        p_reason: "관리자 검수: 실제 코트 수 확정",
      });
      if (error) throw error;
      sendJson(response, 200, data ?? { ok: true, actualCount });
      return;
    }
    if (operation === "update") {
      const patch = body.patch && typeof body.patch === "object" && !Array.isArray(body.patch) ? body.patch : null;
      if (!patch || JSON.stringify(patch).length > 32_768) {
        sendJson(response, 400, { error: "court_patch_invalid" });
        return;
      }
      const { data, error } = await context.supabase.rpc("rankball_admin_update_court_with_auto_unit", {
        p_actor_profile_id: context.profileId,
        p_actor_admin_level: adminLevel,
        p_court_id: safeText(body.courtId),
        p_patch: patch,
        p_reason: getCourtUpdateReason(body.reason),
      });
      if (error) throw error;
      sendJson(response, 200, data ?? { ok: true });
      return;
    }
    if (operation === "updateBatch") {
      const updates = normalizeBatchUpdates(body.updates);
      const { data, error } = await context.supabase.rpc("rankball_admin_update_courts_batch_with_auto_unit", {
        p_actor_profile_id: context.profileId,
        p_actor_admin_level: adminLevel,
        p_updates: updates,
        p_reason: getCourtUpdateReason(body.reason),
      });
      if (error) throw error;
      sendJson(response, 200, data ?? { ok: true, updatedCount: updates.length });
      return;
    }
    if (operation === "normalizeAddressNames") {
      const plan = buildCourtAddressNameUpdates(await loadAllCourtAddressRows(context));
      const pendingIds = new Set(plan.updates.map((update) => update.courtId));
      const groups = [];
      let selectedCount = 0;
      for (const items of plan.unitGroups) {
        const pendingCount = items.filter((item) => pendingIds.has(item.courtId)).length;
        if (!pendingCount || (groups.length && selectedCount + pendingCount > NORMALIZATION_BATCH_SIZE)) continue;
        groups.push(items);
        selectedCount += pendingCount;
        if (selectedCount >= NORMALIZATION_BATCH_SIZE) break;
      }
      const groupedIds = new Set(groups.flatMap((items) => items.map((update) => update.courtId)));
      const groupedUpdates = groups.flatMap((items) => items.filter((update) => pendingIds.has(update.courtId)));
      const standaloneUpdates = plan.updates
        .filter((update) => !groupedIds.has(update.courtId) && !update.patch.courtUnit)
        .slice(0, Math.max(0, NORMALIZATION_BATCH_SIZE - groupedUpdates.length));
      const updates = [...groupedUpdates, ...standaloneUpdates];
      const saveUpdate = async (update, patch = update.patch) => {
        const { error } = await context.supabase.rpc("rankball_admin_update_court_with_auto_unit", {
          p_actor_profile_id: context.profileId,
          p_actor_admin_level: adminLevel,
          p_court_id: update.courtId,
          p_patch: patch,
          p_reason: "중복 주소 코트 번호 일괄 정리",
        });
        if (String(error?.message ?? "").includes("court_patch_unchanged")) return;
        if (error) throw new Error(`${error.message}|court:${update.courtId}|unit:${String(patch.courtUnit ?? "")}`);
      };
      for (const group of groups) {
        const pendingGroup = group.filter((update) => pendingIds.has(update.courtId));
        try {
          for (const update of pendingGroup) await saveUpdate(update);
        } catch (error) {
          if (!String(error?.message ?? "").includes("court_duplicate")) throw error;
          for (const update of group) await saveUpdate(update, { courtUnit: `임시${update.courtId.replace(/[^a-zA-Z0-9가-힣]/g, "").slice(-16)}코트` });
          for (const update of group) await saveUpdate(update);
        }
      }
      for (const update of standaloneUpdates) await saveUpdate(update);
      sendJson(response, 200, {
        ok: true,
        updatedCount: updates.length,
        remainingCount: Math.max(0, plan.updates.length - updates.length),
        scannedCount: plan.scannedCount,
        addressFacilityCount: plan.addressFacilityCount,
        duplicateAddressCount: plan.duplicateAddressCount,
        duplicateCourtCount: plan.duplicateCourtCount,
      });
      return;
    }
    if (operation === "review") {
      const scenario = safeText(body.scenario);
      const patch = body.patch && typeof body.patch === "object" && !Array.isArray(body.patch) ? body.patch : {};
      if (JSON.stringify(patch).length > 32_768) {
        sendJson(response, 400, { error: "court_patch_invalid" });
        return;
      }
      const { data, error } = await context.supabase.rpc("rankball_admin_review_court_with_auto_unit", {
        p_actor_profile_id: context.profileId,
        p_actor_admin_level: adminLevel,
        p_court_id: safeText(body.courtId),
        p_scenario: scenario,
        p_patch: patch,
        p_reason: getCourtReviewReason(scenario, body.reason),
      });
      if (error) throw error;
      sendJson(response, 200, data ?? { ok: true, scenario });
      return;
    }
    if (operation !== "rename") {
      sendJson(response, 400, { error: "unsupported_admin_court_operation" });
      return;
    }

    const { data, error } = await context.supabase.rpc("rankball_admin_update_court_with_auto_unit", {
      p_actor_profile_id: context.profileId,
      p_actor_admin_level: adminLevel,
      p_court_id: safeText(body.courtId),
      p_patch: { facilityName: safeText(body.facilityName) },
      p_reason: getCourtUpdateReason(body.reason),
    });
    if (error) throw error;
    sendJson(response, 200, data ?? { ok: true });
  } catch (error) {
    console.error("Admin court database failed.", error);
    sendJson(response, getAdminCourtErrorStatus(error), { error: error.message || "admin_court_database_failed" });
  }
}
