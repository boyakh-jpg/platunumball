import { getRecruitingRoomRosterProps } from "./RecruitingRoomRosterProps.js";

export function createRecruitingRoomMatchRenderers(context) {
  const {
    ApprovalPanel, MATCH_SIDES, MatchSubstitutionPanel, ReserveLine, SourceMatchDisputeReviewPanel, SourceMatchDisputeEditor,
    SourceMatchRecordSummary, app, benchCapacity, canInviteSideFromRoom, canManageEntry, canManageMatchCheckin,
    canManageSourceMatchSubstitutionSide, canRefreshSourceMatchReview, canResolveSourceMatchDispute, canShowSourceMatchRecordEditor, changeApprovalSource, currentUserIsSourceReferee,
    getEditableSourceMatchStatFields, getMatchCancelCopy, getMatchParticipationCancellationPenalty, getMatchRecordCompositionLabel, getRecruitingDisplayTitle, getRoomCancellationActionLabel, getRoomCancellationPolicy,
    getRoomCompetitionLabel, getRoomEditAvailability, getRoomRemakeDraft, getRoomTitleSizeClass, getRoomVisibilityLabel, getTournamentMatchDisplayTitle,
    individualOnlyRoom, isMatchSideTeamParty, isPartyEntry, lobby, matchRoom, mine,
    moveCandidate, navigate, onRemake, openInviteSlot, openSelfSlotAction, playingIds,
    recruitingRoomTerminalStatus, refreshSourceMatchReview, roomCancellationPending, roomCancellationTarget, roomOwnerId,
    roomState, selectedPost, setRoomCancellationPending, setRoomCancellationTarget, setSourceMatchDraftScore, showCaptainBadge, showSourceMatchRecordSummary,
    slotPositions, sourceMatch, sourceMatchAction, sourceMatchIsPersonalRecord, sourceMatchIsRecordRoom, sourceMatchPhase,
    sourceMatchRecordBoardFirst, sourceMatchRecordWindow, sourceMatchResultSubmitLabel, sourceMatchReviewRefreshing, sourceMatchSideLeaderIds, sourceMatchSlotManagementOpen,
    sourceMatchResultEntryPermission, sourceRoomReadOnly, teamOnlyRoom, userById,
  } = context;

const renderSourceMatchRecordBoard = () => {
          if (!sourceMatchRecordBoardFirst) return null;
          return (
            <div className="arena-match-source-actions arena-match-source-record-board">
              <strong className="ui-panel-title">경기 기록판</strong>
              {showSourceMatchRecordSummary ? (
                <SourceMatchRecordSummary match={sourceMatch} userById={userById} />
              ) : null}
              {sourceMatchIsRecordRoom && sourceMatch.rules?.recordSetupReady === true ? (
                <ApprovalPanel
                  match={sourceMatch}
                  teams={app.state.teams}
                  users={app.state.users}
                  currentUserId={app.currentUser.id}
                  onApprove={(sideName, playerId) => app.actions.approveMatch(sourceMatch.id, sideName, playerId)}
                />
              ) : null}
              {sourceMatchAction.disputed ? (
                <SourceMatchDisputeReviewPanel
                  match={sourceMatch}
                  userById={userById}
                  canResolve={canResolveSourceMatchDispute}
                  actions={app.actions}
                  onRefresh={canRefreshSourceMatchReview ? refreshSourceMatchReview : null}
                  refreshing={sourceMatchReviewRefreshing}
                />
              ) : null}
              {canShowSourceMatchRecordEditor ? (
                <SourceMatchDisputeEditor
                  match={sourceMatch}
                  userById={userById}
                  canReview={false}
                  getEditableStatFields={getEditableSourceMatchStatFields}
                  editableScoreSides={sourceMatchResultEntryPermission?.editableScoreSides ?? []}
                  submitLabel={sourceMatchResultSubmitLabel}
                  onDraftScoreChange={setSourceMatchDraftScore}
                  onSave={(draft) => app.actions.submitMatchResult(sourceMatch.id, draft)}
                />
              ) : null}
            </div>
          );
        };
        const renderMatchSubstitutionPanel = () => (
          !sourceRoomReadOnly
          && matchRoom
          && sourceMatch?.status === "agreed"
          && sourceMatchPhase?.phase === "live"
          && !sourceMatch?.endedAt
          && sourceMatchRecordWindow?.beforeEnd ? (
            <MatchSubstitutionPanel
              match={sourceMatch}
              userById={userById}
              teams={app.state.teams}
              currentUserId={app.currentUser.id}
              canManageSide={canManageSourceMatchSubstitutionSide}
              onSubstitute={(sideName, activePlayerId, reservePlayerId, reason) => app.actions.substituteMatchPlayer?.(
                sourceMatch.id,
                sideName,
                activePlayerId,
                reservePlayerId,
                reason,
              )}
            />
          ) : null
        );
        const renderRoomReserveLine = (sideName) => (
          <ReserveLine
            sideName={sideName}
            candidates={[
              ...lobby.sides[sideName].fillSlots,
              ...lobby.sides[sideName].reserveCandidates,
            ]}
            playingIds={playingIds}
            {...getRecruitingRoomRosterProps(context, sideName)}
            capacity={benchCapacity}
          />
        );
        const canMoveMatchSides = Boolean(canManageMatchCheckin && selectedPost.hostJoinMode !== "team");
        const canOperateSourceRoomRules = Boolean(
          !sourceRoomReadOnly &&
          (!matchRoom ? mine : (
            sourceMatch &&
            ["locked", "checkin"].includes(sourceMatchPhase?.phase) &&
            !sourceMatch.endedAt &&
            !sourceMatch.result &&
            (sourceMatch.refereeId && sourceMatchPhase?.phase === "checkin" ? currentUserIsSourceReferee : mine)
          )),
        );
        const roomEditAvailability = getRoomEditAvailability(changeApprovalSource);
        const roomEditAvailable = roomEditAvailability.allowed;
        const roomCancellationPolicy = sourceMatchIsRecordRoom
          ? { allowed: true, penalty: 0, waived: false }
          : getRoomCancellationPolicy(changeApprovalSource);
        const roomCompetitionLabel = getRoomCompetitionLabel(selectedPost);
        const roomDisplayTitle = sourceMatch?.tournamentId
          ? getTournamentMatchDisplayTitle(sourceMatch, selectedPost.title)
          : getRecruitingDisplayTitle(selectedPost, `${roomCompetitionLabel} ${selectedPost.mode || ""} 매치 큐`.trim());
        const roomTitleSizeClass = getRoomTitleSizeClass(roomDisplayTitle);
        const roomVisibilityLabel = sourceMatchIsPersonalRecord
          ? ((sourceMatch?.visibility ?? selectedPost.visibility) === "public" ? "공개" : "비공개")
          : getRoomVisibilityLabel(sourceMatch ?? selectedPost, selectedPost);
        const roomVisibilityTone = roomVisibilityLabel === "대회방" ? "gold" : ["비공개방", "비공개"].includes(roomVisibilityLabel) ? "blue" : "green";
        const sourceTeamSideCount = MATCH_SIDES.filter((sideName) => isMatchSideTeamParty(sourceMatch, sideName)).length;
        const lobbyTeamEntryCount = individualOnlyRoom ? 0 : (lobby.entries ?? []).filter((entry) => isPartyEntry(entry)).length;
        const teamMatchSideLocked = !individualOnlyRoom && (sourceTeamSideCount >= 2 || (selectedPost.hostJoinMode === "team" && lobbyTeamEntryCount > 0));
        const recordCompositionLabel = getMatchRecordCompositionLabel(sourceMatch);
        const roomMatchTypeLabel = sourceMatchIsPersonalRecord ? "내 기록" : recordCompositionLabel || (individualOnlyRoom
          ? "개인 매칭"
          : teamOnlyRoom || sourceTeamSideCount >= 2 || (selectedPost.visibility === "private" && lobbyTeamEntryCount >= 2)
            ? "팀전"
            : lobbyTeamEntryCount > 0 || sourceTeamSideCount > 0
              ? "팀 파티 포함"
              : "개인 매칭");
        const sourceMatchCancelCopy = getMatchCancelCopy(sourceMatch);
        const sourceMatchCancelActionLabel = getRoomCancellationActionLabel(
          sourceMatchCancelCopy.actionLabel,
          roomCancellationPolicy,
        );
        const requestSourceMatchCancellation = () => {
          setRoomCancellationTarget({
            kind: "match",
            id: sourceMatch.id,
            label: sourceMatchCancelCopy.actionLabel,
            reason: "",
            error: "",
          });
        };
        const requestRecruitingCancellation = () => {
          setRoomCancellationTarget({
            kind: "recruiting",
            id: selectedPost.id,
            label: "경기 취소",
            reason: "",
            error: "",
          });
        };
        const requestMatchParticipationCancellation = () => {
          setRoomCancellationTarget({
            kind: "participation",
            id: sourceMatch.id,
            label: "참가 취소",
            penalty: getMatchParticipationCancellationPenalty(sourceMatch, app.state.settings?.ratingPolicy?.trust),
            reason: "",
            error: "",
          });
        };
        const submitRoomCancellation = async (event) => {
          event.preventDefault();
          if (!roomCancellationTarget || roomCancellationPending) return;
          const reason = String(roomCancellationTarget.reason ?? "").trim();
          if (reason.length < 5 || reason.length > 200) {
            setRoomCancellationTarget((current) => ({ ...current, error: "취소 사유를 5~200자로 입력해 주세요." }));
            return;
          }
          setRoomCancellationPending(true);
          try {
            const result = roomCancellationTarget.kind === "match"
              ? await app.actions.cancelMatch(roomCancellationTarget.id, reason)
              : roomCancellationTarget.kind === "participation"
                ? await app.actions.cancelMatchParticipation(roomCancellationTarget.id, reason)
                : await app.actions.closeRecruitingPost(roomCancellationTarget.id, reason);
            if (!result || result?.ok === false) {
              setRoomCancellationTarget((current) => ({ ...current, error: "취소하지 못했습니다. 잠시 후 다시 시도해 주세요." }));
              return;
            }
            setRoomCancellationTarget(null);
          } catch (error) {
            setRoomCancellationTarget((current) => ({
              ...current,
              error: error?.message || "취소하지 못했습니다. 잠시 후 다시 시도해 주세요.",
            }));
          } finally {
            setRoomCancellationPending(false);
          }
        };
        const cancellationReasonText = String(
          sourceMatch?.rules?.cancellationReason
          ?? roomState.cancellationReasonText
          ?? "",
        ).trim();
        const canRemakeRoom = mine && (
          Boolean(recruitingRoomTerminalStatus) ||
          ["cancelled", "confirmed"].includes(sourceMatch?.status)
        );
        const remakeRoom = () => {
          if (!canRemakeRoom) return;
          if (onRemake) {
            onRemake();
            return;
          }
          const repeatMatch = sourceMatch?.status === "confirmed";
          const remakeSource = sourceMatch
            ? {
                ...selectedPost,
                ...sourceMatch,
                visibility: selectedPost.visibility,
                hostJoinMode: selectedPost.hostJoinMode,
                teamOnly: selectedPost.teamOnly,
                teamId: selectedPost.teamId,
                targetTeamId: selectedPost.targetTeamId,
                rules: { ...(selectedPost.rules ?? {}), ...(sourceMatch.rules ?? {}) },
                repeatMatch,
              }
            : selectedPost;
          navigate("/app/create", {
            state: {
              remakeDraft: getRoomRemakeDraft(remakeSource),
              remakeSourceId: repeatMatch ? "" : sourceMatch?.recruitingPostId ?? (/^match-room-/.test(selectedPost.id) ? "" : selectedPost.id),
              remakeSourceMatchId: repeatMatch ? "" : sourceMatch?.id ?? "",
            },
          });
        };

  return {
    renderSourceMatchRecordBoard, renderMatchSubstitutionPanel, renderRoomReserveLine, canMoveMatchSides, canOperateSourceRoomRules, roomEditAvailability,
    roomEditAvailable, roomCancellationPolicy, roomCompetitionLabel, roomDisplayTitle, roomTitleSizeClass, roomVisibilityLabel,
    roomVisibilityTone, sourceTeamSideCount, lobbyTeamEntryCount, teamMatchSideLocked, recordCompositionLabel, roomMatchTypeLabel,
    sourceMatchCancelCopy, sourceMatchCancelActionLabel, requestSourceMatchCancellation, requestRecruitingCancellation, requestMatchParticipationCancellation, submitRoomCancellation, cancellationReasonText,
    canRemakeRoom, remakeRoom,
  };
}
