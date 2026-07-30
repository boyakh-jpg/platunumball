import { allowRequestMethod, getAdminLevel, getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import { mergeRoomFeedCards as mergeFeedCards } from "../../lib/roomFeedCards.js";
import { REMOTE_CLIENT_RECRUITING_LIMIT } from "../../../shared/lib/constants.js";
import { PROFILE_ME_COLUMNS } from "../../../shared/lib/repositoryColumns.js";

import { INSTANT_TIMING_TYPE, RECRUITING_PUBLIC_PAGE_MAX_LIMIT, fetchCurrentUserRecruitingPage, fetchRecruitingFallbackCounts, fetchRecruitingFeedCounts, fetchRecruitingPage, isLegacyListFallbackAllowed, selectRecruitingCounts } from "./_listQueries.js";
import { getProfileRegionKey, normalizeRegionKey } from "./_listProjection.js";
import { loadCompactRecruitingList } from "./_listLoader.js";

function getPageOffset(body = {}) {
  const rawOffset = body.offset ?? body.recruitingOffset ?? body.nextOffset;
  const numericOffset = Number(rawOffset);
  if (Number.isFinite(numericOffset) && numericOffset > 0) return Math.floor(numericOffset);

  const numericCursor = Number(body.cursor);
  if (Number.isFinite(numericCursor) && numericCursor > 0) return Math.floor(numericCursor);
  return 0;
}

function getTargetPostIds(body = {}) {
  return [
    body.postId,
    body.recruitingPostId,
    ...(Array.isArray(body.recruitingPostIds) ? body.recruitingPostIds : []),
  ].map((id) => String(id ?? "").trim()).filter(Boolean);
}

function getRecruitingStartFilter(body = {}) {
  const startFilter = String(body.startFilter ?? "").trim();
  if (startFilter === INSTANT_TIMING_TYPE) return { startFilter, timingType: INSTANT_TIMING_TYPE, scheduledDate: "" };
  if (/^\d{4}-\d{2}-\d{2}$/.test(startFilter)) return { startFilter, timingType: "", scheduledDate: startFilter };
  const timingType = String(body.timingType ?? "").trim() === INSTANT_TIMING_TYPE ? INSTANT_TIMING_TYPE : "";
  const scheduledDate = String(body.scheduledDate ?? "").trim();
  if (timingType === INSTANT_TIMING_TYPE) return { startFilter: INSTANT_TIMING_TYPE, timingType, scheduledDate: "" };
  if (/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) return { startFilter: scheduledDate, timingType: "", scheduledDate };
  return { startFilter: "all", timingType: "", scheduledDate: "" };
}

function getRecruitingRegionScope(body = {}) {
  const regionScope = String(body.regionScope ?? "").trim();
  if (regionScope === "all") return "all";
  if (regionScope === "region") return "region";
  return "local";
}

function createTimingProbe() {
  const startedAt = Date.now();
  const steps = [];
  return {
    async track(name, task) {
      const stepStartedAt = Date.now();
      try {
        return await task();
      } finally {
        steps.push({ name, ms: Date.now() - stepStartedAt });
      }
    },
    payload() {
      return { totalMs: Date.now() - startedAt, steps };
    },
    header() {
      const timing = this.payload();
      return [
        ...steps.map((step) => `${step.name};dur=${Math.max(0, step.ms)}`),
        `total;dur=${Math.max(0, timing.totalMs)}`,
      ].join(", ");
    },
  };
}

function sendTimedJson(response, statusCode, payload, timing, includeTiming = false) {
  if (typeof response.setHeader === "function") {
    response.setHeader("Server-Timing", timing.header());
  }
  const nextPayload = includeTiming
    ? { ...payload, debugTiming: timing.payload() }
    : payload;
  sendJson(response, statusCode, nextPayload);
}

function getCappedLimit(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return REMOTE_CLIENT_RECRUITING_LIMIT;
  return Math.max(1, Math.min(RECRUITING_PUBLIC_PAGE_MAX_LIMIT, Math.floor(number)));
}

export default async function handler(request, response) {
  const timing = createTimingProbe();
  if (!allowRequestMethod(request, response)) return;

  let debugTiming = false;
  try {
    const body = await timing.track("body", () => readJsonBody(request));
    debugTiming = body.debugTiming === true;
    const context = await timing.track("auth", () => getAuthenticatedContext(request, { allowMissingProfile: true, profileSelect: PROFILE_ME_COLUMNS }));
    const shouldLoadAdminContext = body.adminContext !== false && body.includeAdminContext !== false;
    const adminLevel = shouldLoadAdminContext && context.profileId
      ? await timing.track("admin", () => getAdminLevel(context))
      : 0;
    const limit = getCappedLimit(body.limit ?? body.recruitingLimit ?? REMOTE_CLIENT_RECRUITING_LIMIT);
    const mineOnly = body.scope === "mine" || body.mine === true;
    const roomScope = ["created", "joined", "invited"].includes(body.roomScope) ? body.roomScope : "";
    const includeMine = mineOnly || body.includeMine === true;
    const includeFeedCounts = body.includeFeedCounts === true;
    const includeFallbackCounts = body.includeFallbackCounts === true;
    const preferFreshRows = body.preferFreshRows === true;
    const allowLegacyFallback = isLegacyListFallbackAllowed(body);
    const allowFeedRepair = body.allowFeedRepair === true || process.env.RANKBALL_ALLOW_READ_FEED_REPAIR === "true";
    const mineLimit = mineOnly ? limit : REMOTE_CLIENT_RECRUITING_LIMIT;
    const explicitPostIds = getTargetPostIds(body);
    const listOnly = body.listOnly !== false && !explicitPostIds.length;
    const offset = getPageOffset(body);
    const shouldPageList = !mineOnly && !explicitPostIds.length;
    const startFilter = getRecruitingStartFilter(body);
    const regionScope = getRecruitingRegionScope(body);
    const regionKey = regionScope === "all"
      ? ""
      : normalizeRegionKey(body.regionKey || body.regionDistrict || getProfileRegionKey(context.profile));
    const [mineResult, pageResult, feedCountsResult] = await Promise.all([
      includeMine
        ? timing.track("mine", () => fetchCurrentUserRecruitingPage(context.supabase, context.profileId, mineLimit, roomScope, listOnly, allowLegacyFallback))
        : Promise.resolve({ ids: [], cards: [], source: "", exhausted: true }),
      shouldPageList
        ? timing.track("page", () => fetchRecruitingPage(context.supabase, limit, offset, regionKey, listOnly, startFilter, allowLegacyFallback, allowFeedRepair))
        : Promise.resolve({ ids: [], cards: [], source: "", exhausted: true }),
      context.profileId && includeFeedCounts
        ? timing.track("counts", () => fetchRecruitingFeedCounts(context.supabase, context.profileId))
        : Promise.resolve(null),
    ]);
    const fallbackCountsResult = context.profileId && includeFeedCounts && includeFallbackCounts && !feedCountsResult
      ? await timing.track("fallbackCounts", () => fetchRecruitingFallbackCounts(context.supabase, context.profileId))
      : null;
    const currentUserPostIds = mineResult?.ids ?? [];
    const pagePostIds = pageResult?.ids ?? [];
    const pageCards = mergeFeedCards(mineResult?.cards ?? [], pageResult?.cards ?? []);
    const pageSource = pageResult?.source ?? "";
    const pageExhausted = typeof pageResult?.exhausted === "boolean" ? pageResult.exhausted : null;
    const pageNextOffset = pageResult?.nextOffset;
    const feedCounts = selectRecruitingCounts(feedCountsResult, fallbackCountsResult);
    const compactResult = await timing.track("compact", () => loadCompactRecruitingList(context, {
      adminLevel,
      currentUserPostIds,
      explicitPostIds,
      includeMine,
      mineOnly,
      pagePostIds,
      pageCards,
      pageSource,
      pageExhausted,
      pageNextOffset,
      feedCounts,
      limit,
      offset,
      regionScope: regionKey ? "region" : regionScope,
      regionKey,
      startFilter: startFilter.startFilter,
      timingType: startFilter.timingType,
      scheduledDate: startFilter.scheduledDate,
      debugPage: debugTiming,
      preferFreshRows,
    }));
    sendTimedJson(response, 200, {
      ok: true,
      ...compactResult,
    }, timing, debugTiming);
  } catch (error) {
    sendTimedJson(response, error.statusCode || 500, { error: error.message || "recruiting_list_failed" }, timing, debugTiming);
  }
}
