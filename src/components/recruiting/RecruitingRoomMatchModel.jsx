export function buildRecruitingRoomMatchModel(context) {
  const {
    MATCH_SIDES, ROOM_BODY_MODES, activeInviteDraftRaw, activeSelfSlotDraftRaw, app, attendanceStartStatus,
    canChat, canUserResolveMatchDispute, currentUserIsAdmin, entryPoint, getMatchManualFinalizationStatus, getMatchRecordPlayerIds,
    getMatchRecordWindow, getMatchParticipationCancellationState, getMatchReservePlayerIds, getMatchResultEntryPermission, getMatchRoomPhase, getMatchSideLeaderId, getMatchSidePlayerIds,
    getMissingStartAttendanceIds, getOpenMatchDisputes, getPickupRerollState, getPostgameRecordVerification, getRecruitingBenchCapacity, getRecruitingPostTerminalState,
    getRecruitingRoomStatus, getRecruitingSideCapacity, getRecruitingSideLeaderId, getTeamCaptainId, getTournamentRosterTeam, individualOnlyRoom,
    isMatchPregameSlotManagementOpen, isMatchRecordMatch, isMatchRecordParticipantSetupOpen, isMatchRecordParticipantSetupRequired, isMatchReferee, isPersonalRecordMatch,
    isTournamentGovernanceEnabled, isTournamentMatchLineupEditable, lobby, matchRoom, mine, myEntry,
    pickupAssignmentPolicy, readOnly, roomChatLocked, roomOwnerId, roomPhaseViewModel, roomState, ruleAcknowledgementPending,
    scheduleChangePending, selectedMatchRules, selectedPost, sourceMatch, sourceMatchSideName, sourceMatchStatus,
    teamById,
  } = context;

const roomQueueStatus = getRecruitingRoomStatus(lobby, { post: selectedPost, myEntry, mine });
        const roomReadyLabel = sourceMatch ? sourceMatchStatus.label : roomQueueStatus.label;
        const sourceMatchPhase = sourceMatch ? getMatchRoomPhase(sourceMatch) : null;
        const roomPhaseVersusIndex = roomPhaseViewModel.sectionOrder.indexOf("versus");
        const roomPhaseSectionsBeforeVersus = roomPhaseVersusIndex >= 0
          ? roomPhaseViewModel.sectionOrder.slice(0, roomPhaseVersusIndex)
          : roomPhaseViewModel.sectionOrder;
        const roomPhaseSectionsAfterVersus = roomPhaseVersusIndex >= 0
          ? roomPhaseViewModel.sectionOrder.slice(roomPhaseVersusIndex + 1)
          : [];
        const recruitingRoomTerminalStatus = sourceMatch ? null : getRecruitingPostTerminalState(selectedPost);
        const sourceMatchIsRecordRoom = Boolean(sourceMatch && isMatchRecordMatch(sourceMatch));
        const sourceMatchIsPersonalRecord = Boolean(sourceMatch && isPersonalRecordMatch(sourceMatch));
        const sourceMatchRecordVerification = sourceMatchIsRecordRoom
          ? getPostgameRecordVerification(sourceMatch)
          : null;
        const sourceMatchIsTournamentPregame = isTournamentMatchLineupEditable(sourceMatch);
        const sourceMatchRecordEditable = Boolean(sourceMatchIsRecordRoom && !sourceMatch?.result && !sourceMatch?.confirmedAt);
        const sourceMatchRecordSetupOpen = isMatchRecordParticipantSetupOpen(sourceMatch);
        const canManageMatchRecordParticipants = Boolean(
          isMatchRecordParticipantSetupRequired(sourceMatch)
          && sourceMatch?.createdBy === app.currentUser.id,
        );
        const currentUserIsSourceReferee = Boolean(
          sourceMatch
          && isMatchReferee(sourceMatch, app.currentUser.id)
        );
        const publicPreview = Boolean(readOnly && app.demoPreview);
        const sourceRoomReadOnly = Boolean(
          readOnly ||
          recruitingRoomTerminalStatus ||
          (matchRoom && (
            sourceMatch?.status === "disputed" ||
            ["cancelled", "void"].includes(sourceMatchPhase?.phase) ||
            (sourceMatchPhase?.phase === "record" && !sourceMatchRecordEditable)
          )),
        );
        const sourceMatchStarted = Boolean(sourceMatch?.startedAt);
        const sourceMatchSlotManagementOpen = Boolean(
          !sourceRoomReadOnly
          && (!matchRoom || isMatchPregameSlotManagementOpen(sourceMatch))
          && (!sourceMatch || (sourceMatchPhase?.phase === "checkin" && sourceMatch.refereeId
            ? currentUserIsSourceReferee
            : mine)),
        );
        const activeInviteDraft = sourceRoomReadOnly ? null : activeInviteDraftRaw;
        const activeSelfSlotDraft = sourceMatchSlotManagementOpen ? activeSelfSlotDraftRaw : null;
        const canUseChat = canChat && !sourceRoomReadOnly && !roomChatLocked;
        const currentUserCanOperateStartedSourceMatch = Boolean(sourceMatch && (sourceMatch.refereeId ? currentUserIsSourceReferee : mine));
        const currentUserCanStartSourceMatch = Boolean(sourceMatch && (sourceMatch.refereeId ? currentUserIsSourceReferee : mine));
        const canResolveSourceMatchDispute = Boolean(
          sourceMatch &&
          canUserResolveMatchDispute(sourceMatch, app.currentUser.id, selectedPost) &&
          (sourceMatch.refereeId ? currentUserIsSourceReferee : mine)
        );
        const sourceFinalAuthorityLabel = sourceMatch?.refereeId ? "배정 심판" : "방장";
        const sourceMatchHostSideName = sourceMatch && getMatchSidePlayerIds(sourceMatch, "teamB").includes(sourceMatch.createdBy) ? "teamB" : "teamA";
        const sourceMatchOpponentSideName = sourceMatchHostSideName === "teamA" ? "teamB" : "teamA";
        const sourceTournament = sourceMatch?.tournamentId
          ? app.state.tournaments?.find((tournament) => tournament.id === sourceMatch.tournamentId) ?? null
          : null;
        const sourceMatchRequiresTournamentReferee = isTournamentGovernanceEnabled(sourceTournament);
        const sourceMatchRecordTeams = {
          teamA: sourceMatch ? getTournamentRosterTeam(
            teamById[sourceMatch.teamA?.teamId],
            sourceTournament,
            sourceMatch.teamA?.teamId,
            sourceMatch.teamA?.name,
          ) : null,
          teamB: sourceMatch ? getTournamentRosterTeam(
            teamById[sourceMatch.teamB?.teamId],
            sourceTournament,
            sourceMatch.teamB?.teamId,
            sourceMatch.teamB?.name,
          ) : null,
        };
        const sourceMatchSideLeaderIds = {
          teamA: sourceMatchIsTournamentPregame
            ? getTeamCaptainId(sourceMatchRecordTeams.teamA) ?? ""
            : sourceMatch
            ? getMatchSideLeaderId(sourceMatch, app.state.teams, "teamA")
            : individualOnlyRoom ? "" : getRecruitingSideLeaderId(lobby, "teamA", roomOwnerId, roomState),
          teamB: sourceMatchIsTournamentPregame
            ? getTeamCaptainId(sourceMatchRecordTeams.teamB) ?? ""
            : sourceMatch
            ? getMatchSideLeaderId(sourceMatch, app.state.teams, "teamB")
            : individualOnlyRoom ? "" : getRecruitingSideLeaderId(lobby, "teamB", roomOwnerId, roomState),
        };
        const canEditMatchRecordRoster = Boolean(
          matchRoom &&
          sourceMatch &&
          (sourceMatchIsTournamentPregame || sourceMatchRecordSetupOpen),
        );
        const showMatchRecordRosterPanel = Boolean(
          canEditMatchRecordRoster &&
          MATCH_SIDES.some((sideName) => sourceMatchSideLeaderIds[sideName] === app.currentUser.id),
        );
        const sourceMatchOpponentLeaderId = sourceMatch
          ? sourceMatchSideLeaderIds[sourceMatchOpponentSideName] ?? ""
          : "";
        const sourceMatchAttendance = {
          teamA: sourceMatch?.attendance?.teamA ?? [],
          teamB: sourceMatch?.attendance?.teamB ?? [],
        };
        const sourceMatchCheckedInIds = [...new Set([
          ...sourceMatchAttendance.teamA,
          ...sourceMatchAttendance.teamB,
        ].filter(Boolean))];
        const sourceMatchPlacementByPlayerId = sourceMatch
          ? Object.fromEntries(MATCH_SIDES.flatMap((sideName) => [
              ...getMatchSidePlayerIds(sourceMatch, sideName).map((playerId) => [playerId, { side: sideName, reserve: false }]),
              ...getMatchReservePlayerIds(sourceMatch, sideName).map((playerId) => [playerId, { side: sideName, reserve: true }]),
            ]))
          : null;
        const sourceMatchUsesQrAttendance = selectedMatchRules.qrAttendanceEnabled === true;
        const sourceMatchServerStartStatus = attendanceStartStatus?.matchId === sourceMatch?.id
          ? attendanceStartStatus
          : null;
        const canInspectMatchAttendance = Boolean(
          matchRoom
          && sourceMatchUsesQrAttendance
          && currentUserCanStartSourceMatch
          && !sourceMatch?.startedAt
          && !sourceMatch?.endedAt
          && !sourceMatch?.result,
        );
        const canManageMatchCheckin = Boolean(
          matchRoom
          && currentUserCanStartSourceMatch
          && !sourceMatch?.startedAt
          && !sourceMatch?.endedAt
          && !sourceMatch?.result
          && (
            sourceMatchUsesQrAttendance
              ? sourceMatchServerStartStatus?.checkinOpen === true
              : sourceMatchPhase?.phase === "checkin"
          ),
        );
        const canShowStartSourceMatch = Boolean(
          matchRoom
          && currentUserCanStartSourceMatch
          && !sourceMatch?.result
          && !sourceMatch?.endedAt
          && !sourceMatchStarted
          && (sourceMatchUsesQrAttendance || sourceMatchPhase?.phase === "checkin"),
        );
        const sourceMatchMissingStartAttendanceIds = canShowStartSourceMatch
          ? getMissingStartAttendanceIds(sourceMatch, sourceMatchUsesQrAttendance ? "" : app.currentUser.id)
          : [];
        const pickupAssignmentSideCapacity = sourceMatch ? getRecruitingSideCapacity(sourceMatch) : 0;
        const pickupAssignmentBenchCapacity = sourceMatch ? getRecruitingBenchCapacity(sourceMatch) : 0;
        const pickupAssignmentAttendanceReady = sourceMatchCheckedInIds.length >= pickupAssignmentSideCapacity * 2
          && sourceMatchCheckedInIds.length <= (pickupAssignmentSideCapacity + pickupAssignmentBenchCapacity) * 2;
        const pickupAssignmentSidesComplete = Boolean(
          sourceMatch
          && getMatchSidePlayerIds(sourceMatch, "teamA").length === pickupAssignmentSideCapacity
          && getMatchSidePlayerIds(sourceMatch, "teamB").length === pickupAssignmentSideCapacity,
        );
        const pickupRerollState = getPickupRerollState(sourceMatch, app.currentUser.id);
        const currentUserCheckedInForPickup = sourceMatchCheckedInIds.includes(app.currentUser.id);
        const canRequestPickupReroll = Boolean(
          sourceMatch
          && pickupAssignmentPolicy.automatic
          && sourceMatch.rules?.sideAssignmentStatus === "draft"
          && (canManageMatchCheckin || currentUserCheckedInForPickup),
        );
        const pickupRerollTrustReady = Number(app.currentUser.trustScore ?? 0) >= 1;
        const canStartSourceMatch = canShowStartSourceMatch
          && !scheduleChangePending
          && !ruleAcknowledgementPending
          && (
            sourceMatchUsesQrAttendance
              ? sourceMatchServerStartStatus?.canStart === true
              : sourceMatchMissingStartAttendanceIds.length === 0
          )
          && (roomPhaseViewModel.mode !== ROOM_BODY_MODES.pickupAssignment || roomPhaseViewModel.assignmentConfirmed);
        const sourceMatchStartButtonLabel = canStartSourceMatch
          ? "경기 시작"
          : scheduleChangePending
            ? "일정 승인 대기"
            : ruleAcknowledgementPending
              ? "변경 확인 대기"
          : sourceMatchUsesQrAttendance && !sourceMatchServerStartStatus
            ? "서버시간 확인 중"
          : sourceMatchUsesQrAttendance && sourceMatchServerStartStatus?.blockReason === "attendance_not_open"
            ? "출석 시작 전"
          : sourceMatchUsesQrAttendance && sourceMatchServerStartStatus?.blockReason === "attendance_pending"
            ? `참가자 ${sourceMatchServerStartStatus.missingCount}명 출석 필요`
          : sourceMatchMissingStartAttendanceIds.length > 0
            ? `참가자 ${sourceMatchMissingStartAttendanceIds.length}명 출석 필요`
            : sourceMatchUsesQrAttendance && sourceMatchServerStartStatus?.blockReason === "match_state_mismatch"
              ? "경기 상태 확인 필요"
            : "팀 배정 확정 필요";
        const sourceMatchStartButtonTitle = canStartSourceMatch
          ? ""
          : scheduleChangePending
            ? "일정 또는 구장 변경안을 전원이 승인해야 합니다."
            : ruleAcknowledgementPending
              ? "현재 참가자 전원이 최신 규칙을 확인해야 합니다."
          : sourceMatchUsesQrAttendance && !sourceMatchServerStartStatus
            ? "서버시간과 최신 출석 상태를 확인한 뒤 시작할 수 있습니다."
          : sourceMatchUsesQrAttendance && sourceMatchServerStartStatus?.blockReason === "attendance_not_open"
            ? "QR 출석은 경기 20분 전부터 시작합니다."
          : sourceMatchUsesQrAttendance && sourceMatchServerStartStatus?.blockReason === "attendance_pending"
            ? "출전선수와 후보선수 전원이 출석해야 예정시간 전에 시작할 수 있습니다."
          : sourceMatchMissingStartAttendanceIds.length > 0
            ? "출전선수와 후보선수 전원이 출석해야 예정시간 전에 시작할 수 있습니다."
            : sourceMatchUsesQrAttendance && sourceMatchServerStartStatus?.blockReason === "server_time_unavailable"
              ? "서버시간을 확인하지 못했습니다. 새로고침 후 다시 시도해 주세요."
            : "A/B 팀 배정과 교대 기준을 확정해야 경기 시작이 가능합니다.";
        const canRequestRefereeAbsence = Boolean(!sourceMatchRequiresTournamentReferee && matchRoom && mine && sourceMatch?.refereeId && sourceMatchPhase?.phase === "checkin" && sourceMatch?.refereeAbsenceRequest?.status !== "pending" && !sourceMatch?.refereeAbsenceRequest?.confirmedAt && !sourceMatch?.startedAt && !sourceMatch?.endedAt && !sourceMatch?.result);
        const canConfirmRefereeAbsence = Boolean(!sourceMatchRequiresTournamentReferee && matchRoom && sourceMatchOpponentLeaderId === app.currentUser.id && sourceMatch?.refereeId && sourceMatch?.refereeAbsenceRequest?.status === "pending" && !sourceMatch.refereeAbsenceRequest.confirmedAt && sourceMatchPhase?.phase === "checkin" && !sourceMatch?.startedAt && !sourceMatch?.endedAt && !sourceMatch?.result && sourceMatchSideName);
        const canEndSourceMatch = Boolean(matchRoom && currentUserCanOperateStartedSourceMatch && sourceMatchPhase?.phase === "live" && !sourceMatch?.endedAt && sourceMatchStarted);
        const sourceManualFinalizationStatus = getMatchManualFinalizationStatus(sourceMatch);
        const canFinalizeSourceMatch = Boolean(
          matchRoom && !sourceMatchIsRecordRoom
          && sourceMatch?.endedAt && sourceMatch.result && sourceManualFinalizationStatus.ready && !sourceMatch?.confirmedAt
          && sourceMatch.status !== "disputed"
          && (sourceMatch.refereeId ? currentUserIsSourceReferee : mine)
        );
        const sourceMatchResultEntryPermission = sourceMatch
          ? getMatchResultEntryPermission(sourceMatch, app.currentUser.id, {
              canOperatePostStart: currentUserCanOperateStartedSourceMatch,
              refereeEligible: currentUserIsSourceReferee,
            })
          : null;
        const canReviewSourceMatch = Boolean(matchRoom && sourceMatch?.status !== "disputed" && sourceMatchResultEntryPermission?.canEditDisputeDraft);
        const canSubmitSourceMatchLiveResult = Boolean(matchRoom && sourceMatchResultEntryPermission?.canSubmitLive);
        const canSubmitSourceMatchPostgameResult = Boolean(matchRoom && sourceMatchResultEntryPermission?.canSubmitPostgame);
        const getEditableSourceMatchStatFields = (playerId) => sourceMatchResultEntryPermission?.getEditableStatFields(playerId) ?? [];
        const sourceMatchResultSubmitLabel = sourceMatchResultEntryPermission?.operatorPostgamePoints
          ? "누락 득점 저장"
          : currentUserIsSourceReferee
            ? "심판 기록 제출"
            : "내 득점 저장";
        const canCancelSourceMatch = Boolean(matchRoom && sourceMatch && ["contract", "agreed"].includes(sourceMatch.status) && (sourceMatchStarted || sourceMatch.endedAt || sourceMatch.result ? currentUserCanOperateStartedSourceMatch : mine));
        const sourceParticipationCancellation = sourceMatch
          ? getMatchParticipationCancellationState(sourceMatch, app.currentUser.id)
          : { allowed: false, side: "", reserve: false };
        const canDeleteSourceSoloRecord = Boolean(matchRoom && isPersonalRecordMatch(sourceMatch) && sourceMatch.createdBy === app.currentUser.id && sourceMatch.status !== "cancelled");
        const sourceMatchRecordWindow = sourceMatch ? getMatchRecordWindow(sourceMatch) : null;
        const sourceOpenDisputes = sourceMatch ? getOpenMatchDisputes(sourceMatch) : [];
        const sourceHasOwnOpenDispute = sourceOpenDisputes.some((dispute) => dispute.by === app.currentUser.id);
        const canManageSourceMatchSubstitutionSide = (sideName) => Boolean(
          matchRoom &&
          sourceMatch?.status === "agreed" &&
          sourceMatchPhase?.phase === "live" &&
          !sourceMatch?.endedAt &&
          sourceMatchRecordWindow?.beforeEnd &&
          currentUserIsSourceReferee
        );
        const sourceMatchApprovalOpen = Boolean(
          sourceMatch?.result &&
          sourceMatchRecordWindow?.disputeOpen &&
          (["approval", "disputed"].includes(sourceMatch.status) || (sourceMatch.status === "agreed" && sourceMatch.endedAt)),
        );
        const canRefreshSourceMatchReview = Boolean(
          matchRoom
          && sourceMatch
          && (mine || currentUserIsSourceReferee || currentUserIsAdmin)
          && (sourceMatchApprovalOpen || sourceMatch.status === "disputed")
        );
        const canRequestSourceMatchPointDispute = Boolean(
          matchRoom &&
          sourceMatchApprovalOpen &&
          !sourceHasOwnOpenDispute &&
          getMatchRecordPlayerIds(sourceMatch).includes(app.currentUser.id),
        );
        const showSourceMatchRecordSummary = Boolean(
          matchRoom &&
          sourceMatch?.result &&
          ["postgame", "dispute", "record"].includes(sourceMatchPhase?.phase),
        );
        const canShowSourceMatchRecordEditor = Boolean(sourceMatch?.refereeId) && (canReviewSourceMatch || canSubmitSourceMatchLiveResult || canSubmitSourceMatchPostgameResult);
        const sourceMatchRecordBoardFirst = Boolean(
          matchRoom && Boolean(sourceMatch?.refereeId) &&
          (
            sourceMatchIsRecordRoom ||
            (entryPoint === "recorder" && (showSourceMatchRecordSummary || canShowSourceMatchRecordEditor))
          ),
        );

  return {
    roomQueueStatus, roomReadyLabel, sourceMatchPhase, roomPhaseVersusIndex, roomPhaseSectionsBeforeVersus, roomPhaseSectionsAfterVersus,
    recruitingRoomTerminalStatus, sourceMatchIsRecordRoom, sourceMatchIsPersonalRecord, sourceMatchRecordVerification, sourceMatchIsTournamentPregame, sourceMatchRecordEditable,
    sourceMatchRecordSetupOpen, canManageMatchRecordParticipants, publicPreview, sourceRoomReadOnly, sourceMatchStarted, sourceMatchSlotManagementOpen, activeInviteDraft,
    activeSelfSlotDraft, canUseChat, currentUserIsSourceReferee, currentUserCanOperateStartedSourceMatch, currentUserCanStartSourceMatch, canResolveSourceMatchDispute,
    sourceFinalAuthorityLabel, sourceMatchHostSideName, sourceMatchOpponentSideName, sourceTournament, sourceMatchRequiresTournamentReferee, sourceMatchRecordTeams,
    sourceMatchSideLeaderIds, canEditMatchRecordRoster, showMatchRecordRosterPanel, sourceMatchOpponentLeaderId, sourceMatchAttendance, sourceMatchCheckedInIds,
    sourceMatchPlacementByPlayerId, sourceMatchUsesQrAttendance, sourceMatchServerStartStatus, canInspectMatchAttendance, canManageMatchCheckin, canShowStartSourceMatch,
    sourceMatchMissingStartAttendanceIds, pickupAssignmentSideCapacity, pickupAssignmentBenchCapacity, pickupAssignmentAttendanceReady, pickupAssignmentSidesComplete, pickupRerollState,
    currentUserCheckedInForPickup, canRequestPickupReroll, pickupRerollTrustReady, canStartSourceMatch, sourceMatchStartButtonLabel, sourceMatchStartButtonTitle,
    canRequestRefereeAbsence, canConfirmRefereeAbsence, canEndSourceMatch, sourceManualFinalizationStatus, canFinalizeSourceMatch, sourceMatchResultEntryPermission,
    canReviewSourceMatch, canSubmitSourceMatchLiveResult, canSubmitSourceMatchPostgameResult, getEditableSourceMatchStatFields, sourceMatchResultSubmitLabel, canCancelSourceMatch, sourceParticipationCancellation,
    canDeleteSourceSoloRecord, sourceMatchRecordWindow, sourceOpenDisputes, sourceHasOwnOpenDispute, canManageSourceMatchSubstitutionSide, sourceMatchApprovalOpen,
    canRefreshSourceMatchReview, canRequestSourceMatchPointDispute, showSourceMatchRecordSummary, canShowSourceMatchRecordEditor, sourceMatchRecordBoardFirst,
  };
}
