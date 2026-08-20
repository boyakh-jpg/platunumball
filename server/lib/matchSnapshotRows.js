import { randomUUID } from "node:crypto";
import { compactArray } from "../../shared/lib/arrayValues.js";
import { MINUTE_MS } from "../../shared/lib/matchConstants.js";
import {
  getDbScheduleParts,
  projectMatchDbFields,
  projectMatchPersistenceParts,
  projectPlayerStatRows,
} from "../../shared/lib/matchPersistence.js";
import {
  BASKETBALL_POSITIONS,
  RECORD_TYPES,
  normalizeBenchCapacity,
} from "../../shared/lib/constants.js";
import { nullableText } from "../../shared/lib/rowUtils.js";
import { flattenMatchReservePlayerIds as getMatchReserveIds } from "../../shared/lib/playerIds.js";
import { parseMatchScheduleDate } from "./matchNotifications.js";

const ACHIEVEMENT_POSITIONS = new Set(BASKETBALL_POSITIONS);

export { getMatchReserveIds };

export function getMatchBenchCapacity(match = {}) {
  return normalizeBenchCapacity(match.benchCapacity ?? match.rules?.benchCapacity);
}

export function getMatchPlayedIds(match = {}) {
  return Object.values(match.playedPlayerIds ?? match.rules?.playedPlayerIds ?? {})
    .flatMap(compactArray);
}

export function getMatchPlayedIdMap(match = {}) {
  const playedPlayerIds = (
    match.playedPlayerIds
    ?? match.played_player_ids
    ?? match.rules?.playedPlayerIds
    ?? {}
  );
  return {
    teamA: compactArray(playedPlayerIds.teamA),
    teamB: compactArray(playedPlayerIds.teamB),
  };
}

export function getSidePlayerRows(match = {}) {
  const slotPositions = match.rules?.slotPositions ?? match.slotPositions ?? {};
  const getPosition = (userId) => {
    const position = String(slotPositions?.[userId] ?? "").trim().toUpperCase();
    return ACHIEVEMENT_POSITIONS.has(position) ? position : null;
  };
  return [
    ...(match.teamA?.players ?? []).map((userId, index) => ({
      match_id: match.id,
      team_id: nullableText(match.teamA.playerTeams?.[userId] ?? match.teamA.teamId),
      user_id: userId,
      side: "teamA",
      slot_order: index,
      position: getPosition(userId),
    })),
    ...(match.teamB?.players ?? []).map((userId, index) => ({
      match_id: match.id,
      team_id: nullableText(match.teamB.playerTeams?.[userId] ?? match.teamB.teamId),
      user_id: userId,
      side: "teamB",
      slot_order: index,
      position: getPosition(userId),
    })),
  ].filter((row) => row.user_id);
}

export function toAuthoritativeMatchRow(match = {}, actorProfileId = "") {
  const {
    rules,
    playedPlayerIds,
    reservePlayers,
    mmrExcludedPlayerIds,
    anonymousPlayers,
  } = projectMatchPersistenceParts(match);
  const recruitingPostId = nullableText(
    match.recruitingPostId ?? match.rules?.recruitingPostId,
  );
  const courtId = (
    match.courtId
    ?? match.court_id
    ?? match.approvedCourtId
    ?? match.registeredCourtId
    ?? null
  );
  const schedule = getDbScheduleParts(match);
  const benchCapacity = getMatchBenchCapacity(match);
  const recordType = rules.recordType ?? "";
  const recordStartedAt = recordType === RECORD_TYPES.matchRecord
    ? parseMatchScheduleDate(
      `${match.scheduledDate ?? schedule.scheduledDate ?? ""} ${match.scheduledTime ?? schedule.scheduledTime ?? ""}`,
    ) ?? parseMatchScheduleDate(match.startedAt)
    : null;
  const persistedStartedAt = recordStartedAt?.toISOString() ?? match.startedAt ?? null;
  const persistedEndedAt = recordStartedAt
    ? new Date(recordStartedAt.getTime() + (30 * MINUTE_MS)).toISOString()
    : match.endedAt ?? null;
  const publicCode = nullableText(match.publicCode ?? match.public_code);
  return {
    id: match.id,
    ...(publicCode ? { public_code: publicCode } : {}),
    title: match.title ?? "경기",
    mode: match.mode ?? "5v5",
    court_id: courtId,
    court_name: match.court ?? match.courtName ?? "미정",
    ...projectMatchDbFields(match, {
      schedule,
      persistence: {
        rules,
        playedPlayerIds,
        reservePlayers,
        mmrExcludedPlayerIds,
        anonymousPlayers,
      },
    }),
    team_a_id: nullableText(match.teamA?.teamId),
    team_b_id: nullableText(match.teamB?.teamId),
    rules: {
      ...rules,
      timingType: schedule.timingType,
      visibility: match.visibility ?? match.rules?.visibility ?? "private",
      benchCapacity,
      playedPlayerIds,
      mmrExcludedPlayerIds,
      ...(recruitingPostId ? { recruitingPostId } : {}),
    },
    memo: match.memo ?? "",
    stakes: match.stakes ?? "",
    objection_window: match.objectionWindow ?? null,
    created_by: match.createdBy ?? match.teamA?.players?.[0] ?? actorProfileId,
    created_at: match.createdAt ?? new Date().toISOString(),
    agreed_at: match.agreedAt ?? null,
    started_at: persistedStartedAt,
    ended_at: persistedEndedAt,
    confirmed_at: match.confirmedAt ?? null,
    cancelled_at: match.cancelledAt ?? null,
    voided_at: match.voidedAt ?? null,
    updated_at: new Date().toISOString(),
  };
}

export function toResultRow(match = {}, actorProfileId = "") {
  if (!match.result) return null;
  return {
    match_id: match.id,
    submitted_by: (
      match.result.submittedBy
      ?? match.refereeId
      ?? match.teamA?.players?.[0]
      ?? actorProfileId
    ),
    score_a: Number(match.result.scoreA ?? 0),
    score_b: Number(match.result.scoreB ?? 0),
    result_revision: Number(match.result.revision ?? 0),
    stat_submissions: match.result.statSubmissions ?? {},
    submitted_at: match.result.submittedAt ?? new Date().toISOString(),
    final_submitted_by: match.result.finalSubmittedBy ?? null,
    final_submitted_at: match.result.finalSubmittedAt ?? null,
  };
}

export function toAuthoritativePlayerStatRows(match = {}) {
  return projectPlayerStatRows(match);
}

export function toAgreementRows(match = {}) {
  return [
    ...(match.agreements?.teamA ?? []).map((userId) => ({
      match_id: match.id,
      user_id: userId,
      side: "teamA",
    })),
    ...(match.agreements?.teamB ?? []).map((userId) => ({
      match_id: match.id,
      user_id: userId,
      side: "teamB",
    })),
  ];
}

export function toApprovalRows(match = {}) {
  return [
    ...(match.approvals?.teamA ?? []).map((userId) => ({
      match_id: match.id,
      user_id: userId,
      side: "teamA",
    })),
    ...(match.approvals?.teamB ?? []).map((userId) => ({
      match_id: match.id,
      user_id: userId,
      side: "teamB",
    })),
  ];
}

function toUuid(value = "") {
  const text = String(value || "");
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
    ? text
    : randomUUID();
}

export function toDisputeRows(match = {}) {
  return compactArray(match.disputes)
    .map((dispute) => ({
      id: toUuid(dispute.id),
      match_id: match.id,
      user_id: dispute.by ?? dispute.userId,
      reason: dispute.reason ?? "",
      created_at: dispute.createdAt ?? new Date().toISOString(),
    }))
    .filter((row) => row.id && row.user_id);
}
