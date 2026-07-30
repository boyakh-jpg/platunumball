import { RECORD_TYPES } from "../../../lib/constants.js";
import { courtIdByName } from "../../../lib/courts.js";
import { getCourtId } from "../../../lib/courts.js";
import { getMatchCreationPolicyPayload } from "../../../lib/matchCreationPolicies.js";
import { getMatchReservePlayerIds } from "../../../lib/matchUtils.js";
import { getMatchRulesPayload } from "../../../lib/matchRules.js";
import { getRecruitingBenchCapacity } from "../../../lib/recruiting.js";
import { getRecruitingSideCapacity } from "../../../lib/recruiting.js";
import { getRegisteredCourts } from "../../../lib/courts.js";
import { getRoomEditAvailability } from "../../../lib/roomFlow.js";
import { isRoomScheduleChangePending } from "../../../lib/roomFlow.js";
import { isSupportedMatchMode } from "../../../lib/constants.js";
import { isSupportedSoloRecordMode } from "../../../lib/constants.js";
import { makeId } from "../../rowUtils.js";
import { uniquePlayerIds } from "../../rowUtils.js";
import { currentUserCanOperateMatchPreparation } from "../matchAccess.js";
import { getMatchChangeRequiredIds, getPendingScheduleChangeNotification, getRoomChangeDeadlineAt, getRoomEditLimitNotification, getRoomEditWindowNotification, getRoomScheduleTarget, hasNonScheduleRoomChange, hasRoomScheduleChange, withoutRoomSchedulePatch } from "./helpers.js";

export function updateMatchRoomRules(state, matchId, patch = {}) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match || !["contract", "agreed"].includes(match.status) || match.result || match.endedAt) return state;
  if (!currentUserCanOperateMatchPreparation(state, match)) return state;
  const editAvailability = getRoomEditAvailability(match);
  if (!editAvailability.allowed) {
    const notification = editAvailability.reason === "limit"
      ? getRoomEditLimitNotification({ matchId })
      : getRoomEditWindowNotification({ matchId });
    return { ...state, notifications: [notification, ...state.notifications] };
  }
  if (isRoomScheduleChangePending(match)) {
    return { ...state, notifications: [getPendingScheduleChangeNotification({ matchId }), ...state.notifications] };
  }
  const requiredIds = getMatchChangeRequiredIds(match);
  const scheduleChanged = hasRoomScheduleChange(match, patch);
  const scheduleNeedsApproval = scheduleChanged && requiredIds.some((playerId) => playerId !== state.currentUserId);
  const matchPatch = scheduleNeedsApproval ? withoutRoomSchedulePatch(patch) : patch;
  const generalRulesChanged = hasNonScheduleRoomChange(match, matchPatch);
  const ruleAcknowledgementNeeded = generalRulesChanged
    && requiredIds.some((playerId) => playerId !== state.currentUserId);
  const scheduleTarget = getRoomScheduleTarget(match, patch);
  const changeDeadlineAt = getRoomChangeDeadlineAt(match, scheduleTarget);
  const sideCapacity = Math.max(1, Math.min(5, Number(matchPatch.sideCapacity ?? getRecruitingSideCapacity(match))));
  const nextMode = `${sideCapacity}v${sideCapacity}`;
  const isSoloRecord = match.rules?.recordType === RECORD_TYPES.personalRecord;
  if (isSoloRecord ? !isSupportedSoloRecordMode(nextMode) : !isSupportedMatchMode(nextMode)) return state;
  const benchCapacity = getRecruitingBenchCapacity({ ...match, benchCapacity: matchPatch.benchCapacity });
  const teamAActiveCount = uniquePlayerIds(match.teamA?.players ?? []).length;
  const teamBActiveCount = uniquePlayerIds(match.teamB?.players ?? []).length;
  if (teamAActiveCount > sideCapacity || teamBActiveCount > sideCapacity) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "정원 변경 불가",
          body: "현재 출전 인원이 새 정원보다 많습니다. 먼저 미출석 인원을 후보 명단으로 이동하거나 방에서 내보내 주세요.",
          tone: "orange",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }
  if (getMatchReservePlayerIds(match, "teamA").length > benchCapacity || getMatchReservePlayerIds(match, "teamB").length > benchCapacity) return state;
  const convertToPlayerMatch = matchPatch.matchJoinMode === "player";
  const updatedAt = new Date().toISOString();
  const nextOperations = getMatchCreationPolicyPayload({
    ...match,
    ...(match.rules ?? {}),
    ...matchPatch,
    mode: nextMode,
  });
  const nextRules = {
    ...(match.rules ?? {}),
    ...getMatchRulesPayload({ ...(match.rules ?? {}), ...matchPatch }, { mode: nextMode }),
    ballProvider: nextOperations.ballProvider,
    vestsProvided: nextOperations.vestsProvided,
    sideCapacity,
    benchCapacity,
    roomEditCount: 1,
    roomEditedAt: updatedAt,
    roomEditedBy: state.currentUserId,
    ruleRevision: generalRulesChanged ? Number(match.rules?.ruleRevision ?? 0) + 1 : Number(match.rules?.ruleRevision ?? 0),
    ruleChangedAt: generalRulesChanged ? updatedAt : match.rules?.ruleChangedAt,
    ...(generalRulesChanged ? {
      ruleAcknowledgementRequiredIds: requiredIds,
      ruleAcknowledgedIds: [state.currentUserId],
      ruleAcknowledgementDeadlineAt: changeDeadlineAt,
    } : {
      ruleAcknowledgementRequiredIds: match.rules?.ruleAcknowledgementRequiredIds ?? [],
      ruleAcknowledgedIds: match.rules?.ruleAcknowledgedIds ?? [],
      ruleAcknowledgementDeadlineAt: match.rules?.ruleAcknowledgementDeadlineAt,
    }),
    ...(scheduleNeedsApproval ? {
      scheduleProposal: {
        id: makeId("schedule"),
        status: "pending",
        proposedBy: state.currentUserId,
        proposedAt: updatedAt,
        consentDeadlineAt: changeDeadlineAt,
        ...scheduleTarget,
        requiredIds,
        approvedIds: [state.currentUserId],
      },
    } : {}),
  };
  delete nextRules.startedAt;
  const nextCourtName = matchPatch.court === undefined ? match.court : String(matchPatch.court || match.court || "미정").slice(0, 80);
  const nextCourt = getRegisteredCourts(state).find((court) => court.name === nextCourtName || court.id === matchPatch.courtId) ?? null;
  const nextCourtId = matchPatch.court === undefined ? getCourtId(match) : (nextCourt?.id ?? courtIdByName(nextCourtName));
  if (nextCourt?.region) nextRules.region = nextCourt.region;
  const nextMatch = {
    ...match,
    mode: nextMode,
    status: "agreed",
    rules: nextRules,
    sideCapacity,
    benchCapacity,
    courtId: nextCourtId,
    court: nextCourtName,
    timingType: scheduleNeedsApproval ? match.timingType : scheduleTarget.timingType,
    scheduledDate: scheduleNeedsApproval ? match.scheduledDate : scheduleTarget.scheduledDate,
    scheduledTime: scheduleNeedsApproval ? match.scheduledTime : scheduleTarget.scheduledTime,
    scheduledAt: scheduleNeedsApproval ? match.scheduledAt : scheduleTarget.scheduledAt,
    memo: matchPatch.memo === undefined ? match.memo : String(matchPatch.memo ?? "").slice(0, 500),
    stakes: matchPatch.stakes === undefined ? match.stakes : String(matchPatch.stakes ?? "").slice(0, 500),
    teamA: {
      ...(match.teamA ?? {}),
      teamId: convertToPlayerMatch ? null : match.teamA?.teamId ?? null,
      playerTeams: convertToPlayerMatch ? {} : match.teamA?.playerTeams ?? {},
    },
    teamB: {
      ...(match.teamB ?? {}),
      teamId: convertToPlayerMatch ? null : match.teamB?.teamId ?? null,
      playerTeams: convertToPlayerMatch ? {} : match.teamB?.playerTeams ?? {},
    },
    parties: convertToPlayerMatch ? [] : match.parties ?? [],
    agreements: match.agreements ?? { teamA: [], teamB: [] },
    attendance: match.attendance ?? { teamA: [], teamB: [] },
    agreedAt: match.agreedAt ?? null,
    startedAt: null,
  };
  const targetNotifications = requiredIds
    .filter((playerId) => playerId !== state.currentUserId)
    .flatMap((targetUserId) => [
      ...(ruleAcknowledgementNeeded ? [{
        id: makeId("n"),
        targetUserId,
        title: "경기 정보 변경 확인",
        body: `${match.title}의 경기 규칙이 변경되었습니다. 방에서 변경 내용을 확인해 주세요.`,
        tone: "match",
        type: "match_rules_changed",
        discordEvent: "match",
        matchId,
        actionRequired: true,
      }] : []),
      ...(scheduleNeedsApproval ? [{
        id: makeId("n"),
        targetUserId,
        title: "일정 변경 승인 요청",
        body: `${match.title}의 일정 또는 구장 변경안이 도착했습니다. 기존 일정은 전원 승인 전까지 유지됩니다.`,
        tone: "match",
        type: "match_schedule_change_requested",
        discordEvent: "match",
        matchId,
        actionRequired: true,
      }] : []),
    ]);
  return {
    ...state,
    matches: state.matches.map((item) => (item.id === matchId ? nextMatch : item)),
    notifications: [...targetNotifications, ...state.notifications],
  };
}
