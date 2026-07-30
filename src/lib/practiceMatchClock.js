import { normalizeMatchRules } from "./matchRules.js";
import { PRACTICE_ID_PREFIX, isPracticeEntity } from "./practiceMode.js";
import { getMatchReservePlayerIds } from "./matchUtils.js";

const PRACTICE_SELF_ID = `${PRACTICE_ID_PREFIX}player-self`;

function settleClock(clock, nowMs) {
  if (clock.status !== "running") return { ...clock, serverNow: new Date(nowMs).toISOString() };
  const resumedAtMs = Date.parse(clock.lastResumedAt || "") || nowMs;
  const elapsedMs = Math.max(0, nowMs - resumedAtMs);
  const appliedMs = Math.min(elapsedMs, Math.max(0, Number(clock.periodRemainingMs || 0)));
  const periodRemainingMs = Math.max(0, Number(clock.periodRemainingMs || 0) - appliedMs);
  return {
    ...clock,
    status: periodRemainingMs === 0 ? "paused" : clock.status,
    serverNow: new Date(nowMs).toISOString(),
    lastResumedAt: periodRemainingMs === 0 ? null : new Date(nowMs).toISOString(),
    periodRemainingMs,
    shotRemainingMs: Number(clock.shotClockSeconds || 0) > 0
      ? Math.max(0, Number(clock.shotRemainingMs || 0) - appliedMs)
      : 0,
    activeElapsedMs: Number(clock.activeElapsedMs || 0) + appliedMs,
  };
}

function getPracticeClockControllerCandidates(match = {}, users = []) {
  const userById = Object.fromEntries(users.map((user) => [user.id, user]));
  const activeCandidates = ["teamA", "teamB"].flatMap((side) => (
    (match?.[side]?.players ?? []).map((playerId, slotOrder) => ({
      id: playerId,
      name: userById[playerId]?.name || "연습 선수",
      side,
      slotOrder,
      role: "active",
    }))
  ));
  const usedIds = new Set(activeCandidates.map((player) => player.id));
  const reserveCandidates = ["teamA", "teamB"].flatMap((side) => (
    getMatchReservePlayerIds(match, side)
      .filter((playerId) => playerId && !usedIds.has(playerId))
      .map((playerId, slotOrder) => ({
        id: playerId,
        name: userById[playerId]?.name || "연습 후보",
        side,
        slotOrder,
        role: "reserve",
      }))
  ));
  reserveCandidates.forEach((player) => usedIds.add(player.id));
  const refereeId = String(match?.refereeId || "").trim();
  return [
    ...activeCandidates,
    ...reserveCandidates,
    ...(refereeId && !usedIds.has(refereeId)
      ? [{
          id: refereeId,
          name: userById[refereeId]?.name || "연습 심판",
          side: null,
          slotOrder: 0,
          role: "referee",
        }]
      : []),
  ];
}

export function createPracticeClockClient(
  getState,
  getActorId = () => PRACTICE_SELF_ID,
  onForcedMatchEnd = null,
  getNowMs = () => Date.now(),
) {
  const clocks = new Map();
  const getResponse = (matchId, clock) => {
    const state = getState();
    const match = state.matches.find((item) => item.id === matchId);
    const actorId = getActorId();
    const managerId = match?.refereeId || match?.createdBy || PRACTICE_SELF_ID;
    const canManage = actorId === managerId;
    const canControl = actorId === clock.controllerId;
    const clockUsed = Boolean(
      clock.startedWithinWindow
      && clock.endedExplicitly
      && Number(clock.activeElapsedMs || 0) >= Number(clock.minimumActiveMs || 0),
    );
    const controllerCandidates = getPracticeClockControllerCandidates(match, state.users);
    return {
      ok: true,
      clock: {
        ...clock,
        matchEndedAt: match?.endedAt ?? null,
        canManage,
        canControl,
        clockUsed,
      },
      score: {
        a: Number(match?.result?.scoreA ?? match?.teamA?.score ?? 0),
        b: Number(match?.result?.scoreB ?? match?.teamB?.score ?? 0),
        updatedAt: match?.result?.submittedAt ?? null,
      },
      activePlayers: controllerCandidates,
      attendanceQr: null,
    };
  };
  const getClock = (matchId) => {
    if (clocks.has(matchId)) return clocks.get(matchId);
    const state = getState();
    const match = state.matches.find((item) => item.id === matchId);
    if (!isPracticeEntity(match)) throw new Error("practice_match_required");
    const rules = normalizeMatchRules(match.rules, { mode: match.mode });
    const now = new Date(getNowMs());
    const autoStart = Boolean(match.refereeId && match.startedAt);
    const clockStartedAt = autoStart ? match.startedAt : null;
    const configuredShotClock = [0, 24, 30, 60].includes(Number(match.rules?.shotClockSeconds))
      ? Number(match.rules.shotClockSeconds)
      : 0;
    const periodMs = rules.periodMinutes * 60 * 1000;
    const clock = {
      matchId,
      status: autoStart ? "running" : "pending",
      serverNow: now.toISOString(),
      startDeadlineAt: new Date(Date.parse(match.startedAt || now.toISOString()) + 5 * 60 * 1000).toISOString(),
      startedWithinWindow: autoStart,
      clockUsed: false,
      currentPeriod: 1,
      expectedPeriodCount: rules.periodCount,
      overtimeCount: 0,
      periodRemainingMs: periodMs,
      shotClockSeconds: configuredShotClock,
      shotRemainingMs: configuredShotClock * 1000,
      activeElapsedMs: 0,
      minimumActiveMs: rules.periodCount * periodMs * 0.7,
      controllerId: autoStart ? match.refereeId : match.teamA?.players?.[0] || PRACTICE_SELF_ID,
      lastResumedAt: clockStartedAt,
      clockStartedAt,
      clockEndedAt: null,
      endedExplicitly: false,
      matchEndedAt: null,
      breakStartedAt: null,
    };
    clocks.set(matchId, clock);
    return clock;
  };
  return async (matchId, action = "read", payload = {}) => {
    const nowMs = getNowMs();
    let clock = settleClock(getClock(matchId), nowMs);
    const state = getState();
    const match = state.matches.find((item) => item.id === matchId);
    const forceEndAtMs = clock.clockStartedAt
      ? Date.parse(clock.clockStartedAt) + 90 * 60 * 1000
      : Number.POSITIVE_INFINITY;
    if (!match?.endedAt && nowMs >= forceEndAtMs) {
      const forceEndAt = new Date(forceEndAtMs).toISOString();
      clock = {
        ...clock,
        status: "ended",
        lastResumedAt: null,
        clockEndedAt: clock.clockEndedAt || forceEndAt,
        endedExplicitly: false,
        forcedMatchEnd: true,
        forceEndAt,
        matchEndedAt: forceEndAt,
      };
      clocks.set(matchId, clock);
      await onForcedMatchEnd?.(matchId);
      return getResponse(matchId, clock);
    }
    if (match?.endedAt && clock.status !== "ended") {
      const refereeLifecycleEnd = Boolean(match.refereeId && clock.clockStartedAt);
      clock = {
        ...clock,
        status: "ended",
        lastResumedAt: null,
        clockEndedAt: clock.clockEndedAt || match.endedAt,
        endedExplicitly: refereeLifecycleEnd,
        matchEndedAt: match.endedAt,
      };
    }
    const rules = normalizeMatchRules(match.rules, { mode: match.mode });
    const periodMs = rules.periodMinutes * 60 * 1000;
    const actorId = getActorId();
    const managerId = match.refereeId || match.createdBy || PRACTICE_SELF_ID;
    const isManager = actorId === managerId;
    const isController = actorId === clock.controllerId;
    const actionAllowed = action === "read"
      || (action === "configure" && isManager && !clock.clockStartedAt)
      || (action === "transfer" && (isManager || isController))
      || (!["configure", "transfer"].includes(action) && isController);
    if (!actionAllowed) {
      const errorCode = action === "configure"
        ? "match_clock_configure_forbidden"
        : action === "transfer"
          ? "match_clock_transfer_forbidden"
          : "match_clock_start_forbidden";
      const error = new Error(errorCode);
      error.code = error.message;
      throw error;
    }
    if (["configure", "transfer"].includes(action) && payload.controllerId) {
      const controllerIds = getPracticeClockControllerCandidates(match, state.users)
        .map((player) => player.id);
      if (!controllerIds.includes(payload.controllerId)) {
        const error = new Error("match_clock_controller_must_be_active");
        error.code = error.message;
        throw error;
      }
    }
    if (action === "configure") {
      clock = {
        ...clock,
        controllerId: payload.controllerId || clock.controllerId,
        shotClockSeconds: Number(payload.shotClockSeconds || 0),
        shotRemainingMs: Number(payload.shotClockSeconds || 0) * 1000,
      };
    } else if (action === "start" || action === "resume") {
      const firstStart = !clock.clockStartedAt;
      clock = {
        ...clock,
        status: "running",
        startedWithinWindow: firstStart
          ? nowMs <= Date.parse(clock.startDeadlineAt || "")
          : clock.startedWithinWindow,
        clockStartedAt: clock.clockStartedAt || new Date(nowMs).toISOString(),
        lastResumedAt: new Date(nowMs).toISOString(),
      };
    } else if (action === "pause") {
      clock = { ...clock, status: "paused", lastResumedAt: null };
    } else if (action === "resetShot") {
      clock = { ...clock, shotRemainingMs: Number(clock.shotClockSeconds || 0) * 1000 };
    } else if (action === "endPeriod") {
      clock = {
        ...clock,
        status: "break",
        periodRemainingMs: 0,
        shotRemainingMs: 0,
        lastResumedAt: null,
        breakStartedAt: new Date(nowMs).toISOString(),
      };
    } else if (action === "startPeriod") {
      clock = {
        ...clock,
        status: "running",
        currentPeriod: Math.min(clock.expectedPeriodCount, clock.currentPeriod + 1),
        periodRemainingMs: periodMs,
        shotRemainingMs: Number(clock.shotClockSeconds || 0) * 1000,
        lastResumedAt: new Date(nowMs).toISOString(),
        breakStartedAt: null,
      };
    } else if (action === "startOvertime") {
      clock = {
        ...clock,
        status: "running",
        overtimeCount: clock.overtimeCount + 1,
        periodRemainingMs: rules.overtimeMinutes * 60 * 1000,
        shotRemainingMs: Number(clock.shotClockSeconds || 0) * 1000,
        lastResumedAt: new Date(nowMs).toISOString(),
        breakStartedAt: null,
      };
    } else if (action === "transfer") {
      clock = { ...clock, controllerId: payload.controllerId || clock.controllerId };
    } else if (action === "endClock") {
      clock = {
        ...clock,
        status: "ended",
        lastResumedAt: null,
        clockEndedAt: new Date(nowMs).toISOString(),
        endedExplicitly: true,
      };
    }
    clocks.set(matchId, clock);
    return getResponse(matchId, clock);
  };
}
