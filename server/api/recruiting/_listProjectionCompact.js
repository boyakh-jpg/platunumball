import { compactClientUser } from "../../lib/clientProjection.js";
import { normalizeBenchCapacity } from "../../../shared/lib/constants.js";
import { isPublicTeamRecruitingRoom } from "../../../shared/lib/recruiting.js";
import { mapClientTeamEmblem } from "../../../shared/lib/teamEmblem.js";

export function compactTeam(team = {}) {
  return {
    id: team.id,
    name: team.name,
    homeCourt: team.homeCourt,
    region: team.region,
    mmr: team.mmr,
    wins: team.wins,
    losses: team.losses,
    accent: team.accent,
    ...mapClientTeamEmblem(team),
    membersPartial: true,
    members: team.members ?? [],
  };
}

export function compactRecruitingApplication(applicant = {}) {
  return {
    kind: applicant.kind,
    joinMode: applicant.joinMode,
    teamId: applicant.teamId,
    playerId: applicant.playerId,
    side: applicant.side,
    status: applicant.status,
    reserve: applicant.reserve,
    position: applicant.position,
    playerIds: applicant.playerIds ?? [],
    sourceTeamId: applicant.sourceTeamId,
    sourceEntryId: applicant.sourceEntryId,
    createdAt: applicant.createdAt,
    updatedAt: applicant.updatedAt,
  };
}

export function compactRecruitingRoomState(roomState = {}, profileId = "", options = {}) {
  const includeRoomInvitations = options.includeRoomInvitations === true;
  const invitations = Array.isArray(roomState.invitations)
    ? roomState.invitations
      .filter((invitation) => (
        includeRoomInvitations ||
        invitation.targetUserId === profileId ||
        invitation.fromUserId === profileId
      ))
      .map((invitation) => ({
        id: invitation.id,
        role: invitation.role,
        targetUserId: invitation.targetUserId,
        fromUserId: invitation.fromUserId,
        teamId: invitation.teamId,
        side: invitation.side,
        reserve: invitation.reserve,
        status: invitation.status,
        createdAt: invitation.createdAt,
        updatedAt: invitation.updatedAt,
      }))
    : [];
  const compactRoomState = {
    ownerId: roomState.ownerId,
    teamOnly: roomState.teamOnly,
    timingType: roomState.timingType,
    hostReserve: roomState.hostReserve,
    refereeWanted: roomState.refereeWanted,
    invitations,
    mmrRangeMode: roomState.mmrRangeMode,
    mmrLimitMode: roomState.mmrLimitMode,
    partyLeaders: roomState.partyLeaders ?? {},
    partyReserves: roomState.partyReserves ?? {},
    reserveReady: roomState.reserveReady ?? {},
    pinnedReservePlayers: roomState.pinnedReservePlayers ?? {},
    slotPositions: roomState.slotPositions ?? {},
    ruleRevision: roomState.ruleRevision,
    ruleChangedAt: roomState.ruleChangedAt,
    roomEditCount: roomState.roomEditCount,
    roomEditedAt: roomState.roomEditedAt,
    roomEditedBy: roomState.roomEditedBy,
    cancelledAt: roomState.cancelledAt,
    cancellationReason: roomState.cancellationReason,
    cancelPenalty: roomState.cancelPenalty,
    cancelPenaltyWaived: roomState.cancelPenaltyWaived,
    ruleAcknowledgementRequiredIds: roomState.ruleAcknowledgementRequiredIds ?? [],
    ruleAcknowledgedIds: roomState.ruleAcknowledgedIds ?? [],
    scheduleProposal: roomState.scheduleProposal ?? null,
    approvalModeA: roomState.approvalModeA,
    approvalModeB: roomState.approvalModeB,
  };
  if (options.includeRoomChat === true) {
    compactRoomState.chatMessages = Array.isArray(roomState.chatMessages)
      ? roomState.chatMessages
        .map((message) => ({
          id: message.id,
          messageSeq: Number(message.messageSeq ?? 0),
          userId: message.userId,
          body: String(message.body ?? "").slice(0, 500),
          createdAt: message.createdAt,
        }))
        .filter((message) => message.userId && message.body.trim())
      : [];
  }
  return compactRoomState;
}

export function compactRecruitingPost(post = {}, profileId = "", options = {}) {
  const rules = post.rules ?? {};
  return {
    id: post.id,
    listCardOnly: post.listCardOnly,
    type: post.type,
    title: post.title,
    visibility: post.visibility,
    region: post.region,
    regionKey: post.regionKey,
    courtId: post.courtId,
    court: post.court,
    courtPaid: post.courtPaid ?? null,
    courtReserved: post.courtReserved,
    courtFee: post.courtFee,
    ownerId: post.ownerId,
    hostName: post.hostName,
    hostTeamName: post.hostTeamName,
    targetTeamName: post.targetTeamName,
    mode: post.mode,
    scheduledDate: post.scheduledDate,
    scheduledTime: post.scheduledTime,
    scheduledAt: post.scheduledAt,
    timingType: post.timingType,
    ranked: post.ranked,
    official: post.official,
    preRegistered: post.preRegistered,
    ratingScale: post.ratingScale,
    ageRestriction: post.ageRestriction,
    allowedAgeGroups: post.allowedAgeGroups ?? [],
    rules: {
      endCondition: rules.endCondition,
      targetScore: rules.targetScore,
      periodCount: rules.periodCount,
      periodMinutes: rules.periodMinutes,
      periodBreakMinutes: rules.periodBreakMinutes,
      halftimeMinutes: rules.halftimeMinutes,
      overtimeMinutes: rules.overtimeMinutes,
      gameClockEnabled: rules.gameClockEnabled,
      qrAttendanceEnabled: rules.qrAttendanceEnabled,
      clockMode: rules.clockMode,
      lastPeriodStopMinutes: rules.lastPeriodStopMinutes,
      timeLimit: rules.timeLimit,
      winByTwo: rules.winByTwo,
      ball: rules.ball,
      attackRule: rules.attackRule,
      foulRule: rules.foulRule,
      meetingPoint: rules.meetingPoint,
      meetBeforeMinutes: rules.meetBeforeMinutes,
      matchIntent: rules.matchIntent,
      formationMode: rules.formationMode,
      playingTimePolicy: rules.playingTimePolicy,
      lineupSelectionPolicy: rules.lineupSelectionPolicy,
      pickupTeamAssignmentMode: rules.pickupTeamAssignmentMode,
      rotationMode: rules.rotationMode,
      rotationIntervalMinutes: rules.rotationIntervalMinutes,
      paymentPolicy: rules.paymentPolicy,
      venuePaymentType: rules.venuePaymentType,
      venueSecured: rules.venueSecured,
      totalCost: rules.totalCost,
      ballProvider: rules.ballProvider,
      vestsProvided: rules.vestsProvided,
      ageRestriction: rules.ageRestriction,
      allowedAgeGroups: rules.allowedAgeGroups,
    },
    stakes: post.stakes,
    spots: post.spots,
    teamId: post.teamId,
    targetTeamId: post.targetTeamId,
    refereeWanted: post.refereeWanted,
    refereeId: post.refereeId,
    refereeTrustMin: post.refereeTrustMin,
    statEntryMinutes: post.statEntryMinutes,
    disputeMinutes: post.disputeMinutes,
    roomState: compactRecruitingRoomState(post.roomState ?? {}, profileId, options),
    mmrLimitMode: post.mmrLimitMode,
    teamOnly: post.teamOnly === true || isPublicTeamRecruitingRoom(post),
    hostJoinMode: post.hostJoinMode,
    hostSide: post.hostSide,
    hostReady: post.hostReady,
    sideCapacity: post.sideCapacity,
    benchCapacity: normalizeBenchCapacity(post.benchCapacity ?? post.rules?.benchCapacity),
    listCounts: post.listCounts,
    __feedRelations: post.__feedRelations,
    __invitationsPartial: options.includeRoomInvitations !== true,
    playerIds: post.playerIds ?? [],
    position: post.position,
    playerId: post.playerId,
    memo: post.memo,
    status: post.status,
    applicants: (post.applicants ?? []).map(compactRecruitingApplication),
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    confirmedAt: post.confirmedAt,
  };
}

export function compactRecruitingListState(state = {}, profileId = "", options = {}) {
  return {
    ...state,
    users: (state.users ?? []).map((user) => compactClientUser(user, profileId)),
    teams: (state.teams ?? []).map(compactTeam),
    recruitingPosts: (state.recruitingPosts ?? []).map((post) => compactRecruitingPost(post, profileId, options)),
    matches: [],
    tournaments: [],
    affiliations: [],
    seasons: [],
    reports: [],
    notifications: [],
    discordNotificationDeliveries: [],
    settings: {
      theme: state.settings?.theme === "light" ? "light" : "dark",
      privacy: state.settings?.privacy,
      favoritePlayerIds: state.settings?.favoritePlayerIds ?? [],
      favoriteTeamIds: state.settings?.favoriteTeamIds ?? [],
      favoriteCourtIds: state.settings?.favoriteCourtIds ?? [],
      favoriteRefereeIds: state.settings?.favoriteRefereeIds ?? [],
      approvedCourts: state.settings?.approvedCourts ?? [],
      refereeAppointments: state.settings?.refereeAppointments ?? [],
    },
  };
}
