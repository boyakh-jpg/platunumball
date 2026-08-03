import { RECORD_TYPES } from "./constants.js";
import {
  projectMatchSideParticipationIds,
  uniquePlayerIds,
} from "./playerIds.js";
import { isMatchRecordMatch } from "./matchRecordTypes.js";

function getSideMajority(side = {}) {
  const total = side.players?.length ?? 0;
  return Math.floor(total / 2) + 1;
}

function isCaptainApprovalRequired() {
  return false;
}

export function getTeamCaptainId(teams = [], teamId) {
  const team = teams.find((item) => item.id === teamId);
  return team?.members?.find((member) => member.role === "captain")?.userId ?? null;
}

function getSideCaptainId(match = {}, teams = [], sideName) {
  return getTeamCaptainId(teams, match[sideName]?.teamId);
}

function getDecisionStatus(match = {}, teams = [], sideName, decisionKey) {
  const side = match[sideName] ?? { players: [] };
  const sourceApprovals = match[decisionKey]?.[sideName] ?? [];
  const recordApproverMap = match.rules?.recordApproverIds;
  const recordApprovalConfigured = decisionKey === "approvals"
    && match.rules?.recordType === RECORD_TYPES.matchRecord
    && recordApproverMap
    && typeof recordApproverMap === "object";
  const requiredIds = recordApprovalConfigured
    ? uniquePlayerIds(recordApproverMap?.[sideName] ?? [])
    : [];
  const approvals = recordApprovalConfigured
    ? sourceApprovals.filter((playerId) => requiredIds.includes(playerId))
    : sourceApprovals;
  if (recordApprovalConfigured) {
    const approvalMode = match.rules?.recordApprovalMode?.[sideName] === "captain"
      ? "captain"
      : "all";
    const approved = requiredIds.length > 0
      && requiredIds.every((playerId) => approvals.includes(playerId));
    return {
      approvals,
      total: side.players?.length ?? 0,
      majority: requiredIds.length,
      requiredIds,
      approvalMode,
      approvalLabel: approvalMode === "captain" ? "팀장 승인" : "전원 승인",
      captainId: approvalMode === "captain" ? requiredIds[0] ?? null : null,
      captainRequired: approvalMode === "captain",
      captainApproved: approvalMode !== "captain" || approved,
      majorityApproved: approved,
      approved,
    };
  }
  const captainId = getSideCaptainId(match, teams, sideName);
  const teamAgreement = decisionKey === "agreements" && Boolean(side.teamId);
  const captainRequired = teamAgreement || isCaptainApprovalRequired(match);
  const majority = teamAgreement ? 1 : getSideMajority(side);
  const majorityApproved = teamAgreement
    ? Boolean(captainId ? approvals.includes(captainId) : approvals.length)
    : approvals.length >= majority;
  const captainApproved = !captainRequired
    || !captainId
    || approvals.includes(captainId);

  return {
    approvals,
    total: side.players?.length ?? 0,
    majority,
    requiredIds: side.players ?? [],
    approvalMode: "majority",
    approvalLabel: "과반 승인",
    captainId,
    captainRequired,
    captainApproved,
    majorityApproved,
    approved: majorityApproved && captainApproved,
  };
}

export function getAgreementStatus(match = {}, teams = [], sideName) {
  return getDecisionStatus(match, teams, sideName, "agreements");
}

export function getApprovalStatus(match = {}, teams = [], sideName) {
  if (!isMatchRecordMatch(match)) {
    return {
      approvals: [],
      total: match[sideName]?.players?.length ?? 0,
      majority: 0,
      requiredIds: [],
      approvalMode: match.refereeId ? "referee" : "host",
      approvalLabel: match.refereeId ? "심판 최종 승인" : "방장 최종 승인",
      captainId: null,
      captainRequired: false,
      captainApproved: false,
      majorityApproved: false,
      approved: false,
    };
  }
  const requiredIds = uniquePlayerIds(
    match.rules?.recordApproverIds?.[sideName]?.length
      ? match.rules.recordApproverIds[sideName]
      : projectMatchSideParticipationIds(match, sideName),
  ).filter((playerId) => !match.anonymousPlayers?.[playerId]);
  const approvals = uniquePlayerIds([
    ...(match.approvals?.[sideName] ?? []),
    ...(match.rules?.participantAcceptedIds ?? []),
    ...(match.rules?.matchRecordConfirmedParticipantIds ?? []),
  ])
    .filter((playerId) => requiredIds.includes(playerId));
  const approved = requiredIds.length > 0
    && requiredIds.every((playerId) => approvals.includes(playerId));
  return {
    approvals,
    total: requiredIds.length,
    majority: requiredIds.length,
    requiredIds,
    approvalMode: "participant_confirmation",
    approvalLabel: "내 참가 확인",
    captainId: null,
    captainRequired: false,
    captainApproved: approved,
    majorityApproved: approved,
    approved,
  };
}
