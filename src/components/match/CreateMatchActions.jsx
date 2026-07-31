export function createCreateMatchActions(context) {
  const {
    RECORD_TYPES, Star, ageRestrictionOption, app, appendSoloRecordUser, challengeTeamAId, challengeTeamBId, currentRegion, draft,
    favoriteRefereeIds, favoriteTeamIds, formatCreateSaveError, getAvailableTeamPlayerIds, getCourtAddress, getCourtHashtag, getCourtLayoutLabel,
    getCourtSurfaceLabel, getMatchCreationPolicyPayload, getMatchRulesPayload, getOpponentTeam, getPersonalRecordDraftPayload, getRepresentativePlayerIds, getScopedMatchCreationPolicyPayload,
    getTeamEligibility, getTeamHashtag, getTournamentTeamEligibility, getUserHashtag, isFavoriteCourt, isInstantRoom, isMatchRecordRoom,
    isMmrInRecruitingRange, isPublicRoom, isSoloRecord, isTeamRoom, isTournamentRoom, myTeams, navigate,
    normalizeSoloRecordRosterInput, onRecruitingCreated, practiceMode, recordComposition, remakeDraft, remakeSourceId, remakeSourceMatchId,
    representativeTournamentTeam, selectCourt, selectedCourt, selectedTeamA, selectedTournamentCourts, setDraft, setOpponentTeamQuery,
    setRefereeQuery, setSelectedTournamentRefereeProfiles, setSubmitFeedback, setSubmitting, sideCapacity, sortedTeams, submitDisabled,
    submitDisabledReason, submitting, update,
  } = context;

const selectTeamA = (teamAId) => {
    if (!myTeams.some((team) => team.id === teamAId)) return;
    const team = app.state.teams.find((item) => item.id === teamAId);
    const teamEligibility = getTeamEligibility(team, team?.mmr);
    if (!teamEligibility.allowed) {
      setSubmitFeedback(`${team?.name ?? "내 팀"}: ${teamEligibility.reason}`);
      return;
    }
    const playerIds = getRepresentativePlayerIds(app.currentUser.id);
    const currentTeamB = app.state.teams.find((item) => item.id === draft.teamBId);
    const currentTeamBUsable = currentTeamB &&
      currentTeamB.id !== teamAId &&
      getAvailableTeamPlayerIds(currentTeamB, playerIds).length >= 1;
    const nextTeamB = currentTeamBUsable
      ? currentTeamB
      : getOpponentTeam(sortedTeams, teamAId, currentRegion, playerIds, 1) ?? getOpponentTeam(app.state.teams, teamAId, currentRegion, playerIds, 1);
    const opponentLeaderId = nextTeamB?.members?.find((member) => member.role === "captain")?.userId ?? "";
    setOpponentTeamQuery("");
    update({
      teamAId,
      teamBId: nextTeamB?.id,
      ...(isTeamRoom ? {
        playerIds,
        reservePlayerIds: [],
        opponentPlayerIds: [],
        opponentReservePlayerIds: [],
        opponentLeaderId,
      } : {}),
    });
  };
  const selectTeamB = (teamBId) => {
    const currentTeamA = app.state.teams.find((item) => item.id === draft.teamAId);
    const nextTeamA = currentTeamA?.id === teamBId
      ? getOpponentTeam(sortedTeams, teamBId, currentRegion, [], sideCapacity) ?? getOpponentTeam(app.state.teams, teamBId, currentRegion, [], sideCapacity)
      : currentTeamA;
    const playerIds = draft.playerIds?.length ? draft.playerIds : getRepresentativePlayerIds(app.currentUser.id);
    const team = app.state.teams.find((item) => item.id === teamBId);
    const teamEligibility = getTeamEligibility(team, nextTeamA?.mmr ?? team?.mmr);
    if (!teamEligibility.allowed) {
      setSubmitFeedback(`${team?.name ?? "상대 팀"}: ${teamEligibility.reason}`);
      return;
    }
    const opponentLeaderId = team?.members?.find((member) => member.role === "captain")?.userId ?? "";
    setOpponentTeamQuery("");
    update({
      teamAId: nextTeamA?.id,
      teamBId,
      ...(isTeamRoom ? {
        playerIds,
        reservePlayerIds: [],
        opponentPlayerIds: [],
        opponentReservePlayerIds: [],
        opponentLeaderId,
      } : {}),
    });
  };
  const assignTeam = (teamId, side) => {
    if (side === "A") selectTeamA(teamId);
    if (side === "B") selectTeamB(teamId);
  };
  const toggleTournamentTeam = (teamId) => {
    const teamIds = draft.tournamentTeamIds ?? [];
    const team = app.state.teams.find((item) => item.id === teamId);
    if (teamIds.includes(teamId) && teamId === representativeTournamentTeam?.id) {
      setSubmitFeedback("내 대표팀은 대회 참가팀에서 해제할 수 없습니다.");
      return;
    }
    if (!teamIds.includes(teamId)) {
      const eligibility = getTournamentTeamEligibility(team);
      if (!eligibility.allowed) {
        setSubmitFeedback(`${team?.name ?? "선택 팀"}: ${eligibility.reason}`);
        return;
      }
    }
    setDraft((current) => {
      const currentTeamIds = current.tournamentTeamIds ?? [];
      return {
        ...current,
        tournamentTeamIds: currentTeamIds.includes(teamId)
          ? currentTeamIds.filter((id) => id !== teamId)
          : [...currentTeamIds, teamId],
      };
    });
  };
  const renderCourtSearchItem = (court) => {
    const favorite = isFavoriteCourt(court);
    const rating = Number(court.adjustedRating ?? court.rating ?? 0);
    const reviewCount = Number(court.reviewCount ?? 0);
    const completedMatchCount = Number(court.completedMatchCount ?? 0);
    return (
      <div
        key={court.id}
        className={draft.court === court.name ? "search-picker-result-row search-picker-result-row-actionable selected" : "search-picker-result-row search-picker-result-row-actionable"}
        onMouseDown={(event) => event.preventDefault()}
      >
        <button type="button" className="search-picker-result-main" onClick={() => selectCourt(court)}>
          <strong>{court.name}</strong>
          <span className="court-search-result-address">{getCourtAddress(court)}</span>
          <span>{court.region} / {court.type} / {getCourtSurfaceLabel(court)} / {getCourtLayoutLabel(court)}</span>
          <em className="court-search-result-meta">
            <span>{getCourtHashtag(court)} · {favorite ? "즐겨찾기" : "구장"}</span>
            <span><Star size={13} fill={reviewCount ? "currentColor" : "none"} /> {reviewCount ? `보정 ${rating.toFixed(1)} · 리뷰 ${reviewCount}` : "평가 전"} · 경기 {completedMatchCount}</span>
          </em>
        </button>
      </div>
    );
  };
  const renderCreateTeamSearchItem = (team) => {
    const invited = (draft.tournamentTeamIds ?? []).includes(team.id);
    const selected = isTournamentRoom ? invited : isPublicRoom ? draft.teamAId === team.id : draft.teamAId === team.id;
    const eligibility = isTournamentRoom ? getTournamentTeamEligibility(team) : getTeamEligibility(team, team.mmr);
    const actionLabel = isTournamentRoom ? (invited ? "초대 해제" : "초대") : isPublicRoom ? "내 파티" : "A사이드";
    return (
      <button
        key={team.id}
        type="button"
        className={["search-picker-result-row", selected ? "selected" : "", !eligibility.allowed && !invited ? "is-disabled" : ""].filter(Boolean).join(" ")}
        disabled={!eligibility.allowed && !invited}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (isTournamentRoom) toggleTournamentTeam(team.id);
          else assignTeam(team.id, "A");
        }}
      >
        <strong>{team.name}</strong>
        <span>{team.region} · {team.mmr} MMR · {team.homeCourt}</span>
        <em>{getTeamHashtag(team)} · {eligibility.allowed ? `${actionLabel} · 가능 ${eligibility.eligibleCount}/${eligibility.capacity}` : eligibility.reason}</em>
      </button>
    );
  };
  const renderOpponentTeamSearchItem = (team) => {
    const mmrBlocked = draft.mmrLimitMode === "block" && draft.ranked && selectedTeamA && !isMmrInRecruitingRange(team.mmr, selectedTeamA.mmr, true, draft.mmrRangeMode);
    const eligibility = getTeamEligibility(team, selectedTeamA?.mmr ?? team.mmr);
    const favorite = favoriteTeamIds.includes(team.id);
    const toggleFavorite = (event) => {
      event.preventDefault();
      event.stopPropagation();
      app.actions.toggleFavoriteTeam(team.id);
    };
    return (
      <div
        key={team.id}
        className={team.id === draft.teamBId ? "search-picker-result-row search-picker-result-row-actionable selected" : "search-picker-result-row search-picker-result-row-actionable"}
        onMouseDown={(event) => event.preventDefault()}
      >
        <button type="button" className="search-picker-result-main" disabled={!eligibility.allowed || mmrBlocked} onClick={() => selectTeamB(team.id)}>
          <strong>{team.name}</strong>
          <span>{team.region} · {team.mmr} MMR · {team.homeCourt}</span>
          <em>{getTeamHashtag(team)} · {mmrBlocked ? "팀 MMR 범위 밖" : eligibility.allowed ? `${favorite ? "즐겨찾기" : "B사이드"} · 가능 ${eligibility.eligibleCount}/${eligibility.capacity}` : eligibility.reason}</em>
        </button>
        <button
          type="button"
          className={favorite ? "search-picker-favorite-action active" : "search-picker-favorite-action"}
          aria-label={favorite ? `${team.name} 즐겨찾기 해제` : `${team.name} 즐겨찾기 추가`}
          aria-pressed={favorite}
          onMouseDown={(event) => event.preventDefault()}
          onClick={toggleFavorite}
        >
          <Star size={16} fill={favorite ? "currentColor" : "none"} />
        </button>
      </div>
    );
  };
  const selectReferee = (user) => {
    setSelectedTournamentRefereeProfiles((current) => (
      current.some((referee) => referee.id === user.id) ? current : [...current, user]
    ));
    if (isTournamentRoom) {
      setDraft((current) => ({
        ...current,
        tournamentRefereeIds: (current.tournamentRefereeIds ?? []).includes(user.id)
          ? current.tournamentRefereeIds
          : [...(current.tournamentRefereeIds ?? []), user.id],
      }));
      setRefereeQuery("");
      return;
    }
    update({ refereeWanted: true, refereeId: user.id });
    setRefereeQuery(user.name ?? "");
  };
  const removeTournamentReferee = (refereeId) => {
    setDraft((current) => ({
      ...current,
      tournamentRefereeIds: (current.tournamentRefereeIds ?? []).filter((id) => id !== refereeId),
    }));
  };
  const clearReferee = () => {
    update({ refereeWanted: false, refereeId: "" });
    setRefereeQuery("");
  };
  const renderRefereeSearchItem = (user) => {
    const favorite = favoriteRefereeIds.includes(user.id);
    return (
      <div
        key={user.id}
        className={(isTournamentRoom ? (draft.tournamentRefereeIds ?? []).includes(user.id) : user.id === draft.refereeId) ? "search-picker-result-row search-picker-result-row-actionable selected" : "search-picker-result-row search-picker-result-row-actionable"}
        onMouseDown={(event) => event.preventDefault()}
      >
        <button type="button" className="search-picker-result-main" disabled={isTournamentRoom && (draft.tournamentRefereeIds ?? []).includes(user.id)} onClick={() => selectReferee(user)}>
          <strong>{user.name}</strong>
          <span>{getUserHashtag(user)} · {user.position} · {user.region}</span>
          <em>{favorite ? "즐겨찾기 · " : ""}신뢰도 {user.trustScore} · {user.refereeProfile?.grade ?? user.refereeGrade ?? "심판"}</em>
        </button>
      </div>
    );
  };
  const renderSoloRecordUserSearchItem = (sideName) => (user) => (
    <div
      key={user.id}
      className="search-picker-result-row search-picker-result-row-actionable"
      onMouseDown={(event) => event.preventDefault()}
    >
      <button type="button" className="search-picker-result-main" onClick={() => appendSoloRecordUser(sideName, user)}>
        <strong>{user.name}</strong>
        <span>{getUserHashtag(user)} · {user.position} · {user.region}</span>
        <em>실제 선수 연결 · 기록에는 해시태그 숨김</em>
      </button>
    </div>
  );
  const submit = async (event) => {
    event.preventDefault();
    if (submitting) return;
    if (practiceMode && (
      isSoloRecord
      || isMatchRecordRoom
      || isTournamentRoom
      || draft.visibility !== "private"
    )) {
      setSubmitFeedback("연습 경기는 비공개 경기방으로만 만들 수 있습니다.");
      return;
    }
    if (submitDisabled) {
      setSubmitFeedback(submitDisabledReason || "경기 생성 조건을 확인해 주세요.");
      return;
    }
    setSubmitFeedback("");
    setSubmitting(true);
    try {
    if (isSoloRecord) {
      const normalizedTeamA = normalizeSoloRecordRosterInput(
        draft.soloTeamAPlayersText,
        draft.soloTeamAPlayerRefs,
        app.state.users,
      );
      const normalizedTeamB = normalizeSoloRecordRosterInput(
        draft.soloTeamBPlayersText,
        draft.soloTeamBPlayerRefs,
        app.state.users,
      );
      const personalRecordDraft = getPersonalRecordDraftPayload({
        ...draft,
        soloTeamAPlayersText: normalizedTeamA.text,
        soloTeamBPlayersText: normalizedTeamB.text,
        soloTeamAPlayerRefs: normalizedTeamA.refs,
        soloTeamBPlayerRefs: normalizedTeamB.refs,
      });
      const matchId = await app.actions.createMatch({
        ...personalRecordDraft,
        recordType: RECORD_TYPES.personalRecord,
        visibility: draft.visibility === "public" ? "public" : "private",
        ranked: false,
        official: false,
        preRegistered: false,
        mode: draft.mode,
        mmrLimitMode: "off",
        courtId: selectedCourt?.id ?? "",
        court: selectedCourt?.name ?? "",
        scheduledDate: draft.scheduledDate,
        scheduledTime: draft.scheduledTime,
      });
      if (typeof matchId === "string" && matchId) navigate("/app/profile/records");
      else {
        setSubmitFeedback(formatCreateSaveError(matchId, "개인 기록을 저장하지 못했습니다."));
      }
      return;
    }
    if (isMatchRecordRoom) {
      const creationPolicyPayload = getScopedMatchCreationPolicyPayload(draft, "match_record");
      const matchId = await app.actions.createMatch({
        ...draft,
        ...creationPolicyPayload,
        recordType: RECORD_TYPES.matchRecord,
        recordComposition,
        visibility: "private",
        timingType: "scheduled",
        hostJoinMode: recordComposition === "team" ? "team" : "player",
        teamOnly: recordComposition === "team",
        ranked: false,
        official: false,
        preRegistered: false,
        mmrLimitMode: "off",
        ageRestriction: "any",
        allowedAgeGroups: [],
        courtReserved: false,
        courtFee: "",
        stakes: "",
        teamAId: undefined,
        teamBId: undefined,
        playerIds: [app.currentUser.id],
        reservePlayerIds: [],
        opponentPlayerIds: [],
        opponentReservePlayerIds: [],
        opponentLeaderId: "",
        sideCapacity: creationPolicyPayload.onCourtCount,
        benchCapacity: creationPolicyPayload.benchCapacity,
        rules: {
          ...creationPolicyPayload,
          sideCapacity: creationPolicyPayload.onCourtCount,
        },
        courtId: selectedCourt?.id ?? "",
        court: selectedCourt?.name ?? "",
        scheduledDate: draft.scheduledDate,
        scheduledTime: draft.scheduledTime,
      });
      if (typeof matchId === "string" && matchId) navigate(`/app/recorder?match=${encodeURIComponent(matchId)}`);
      else {
        setSubmitFeedback(formatCreateSaveError(matchId, "경기 기록을 만들지 못했습니다."));
      }
      return;
    }
    if (isTournamentRoom) {
      const creationPolicyPayload = getScopedMatchCreationPolicyPayload(draft, "tournament");
      const tournamentResult = await app.actions.createTournament({
        ...draft,
        ...creationPolicyPayload,
        sideCapacity: creationPolicyPayload.onCourtCount,
        benchCapacity: creationPolicyPayload.benchCapacity,
        teamIds: draft.tournamentTeamIds,
        refereeIds: draft.tournamentRefereeIds,
        courtId: selectedCourt.id,
        court: selectedCourt.name,
        region: selectedCourt.region,
        rules: {
          ...getMatchRulesPayload(draft, { mode: draft.mode }),
          ...creationPolicyPayload,
          disputeMinutes: Number.parseInt(draft.objectionWindow, 10),
          sideCapacity: creationPolicyPayload.onCourtCount,
          mmrLimitMode: draft.mmrLimitMode,
          mmrRangeMode: draft.mmrRangeMode,
          ageRestriction: draft.ageRestriction,
          allowedAgeGroups: ageRestrictionOption.allowedGroups,
          allowedCourtIds: selectedTournamentCourts.map((court) => court.id),
          allowedCourts: selectedTournamentCourts.map((court) => ({ id: court.id, name: court.name, region: court.region })),
          rosterReady: { teamA: false, teamB: false },
        },
      });
      if (typeof tournamentResult === "string" && tournamentResult) {
        navigate(`/app/tournaments/${encodeURIComponent(tournamentResult)}`, {
          state: { from: "/app/matches?panel=tournament" },
        });
      }
      else {
        setSubmitFeedback(formatCreateSaveError(tournamentResult, "대회를 저장하지 못했습니다."));
      }
      return;
    }
    const creationPolicyPayload = getMatchCreationPolicyPayload(draft);
    const createAsTeam = creationPolicyPayload.hostJoinMode === "team" && creationPolicyPayload.teamOnly;
    const remakeInvitationContext = remakeDraft
      ? [
          "취소된 방을 같은 설정으로 다시 만들었습니다.",
          draft.remakeCancellationReason ? `이전 방 취소 사유: ${draft.remakeCancellationReason}` : "",
        ].filter(Boolean).join("\n")
      : "";
    const postId = await app.actions.createRecruitingPost({
      ...creationPolicyPayload,
      ...(remakeDraft ? { remakeSourceId, remakeSourceMatchId } : {}),
      visibility: draft.visibility,
      title: draft.title,
      hostJoinMode: creationPolicyPayload.hostJoinMode,
      teamOnly: createAsTeam,
      teamId: "",
      playerIds: [],
      reservePlayerIds: [],
      opponentTeamId: "",
      opponentPlayerIds: [],
      opponentReservePlayerIds: [],
      opponentLeaderId: "",
      invitePlayerIds: [],
      approvalModeA: draft.approvalModeA,
      approvalModeB: draft.approvalModeB,
      refereeWanted: draft.refereeWanted || Boolean(draft.refereeId),
      refereeId: draft.refereeId,
      targetTeamId: "",
      region: selectedCourt.region,
      courtId: selectedCourt.id,
      court: selectedCourt.name,
      timingType: draft.timingType,
      scheduledDate: isInstantRoom ? "" : draft.scheduledDate,
      scheduledTime: isInstantRoom ? "" : draft.scheduledTime,
      mode: draft.mode,
      sideCapacity: creationPolicyPayload.onCourtCount,
      benchCapacity: creationPolicyPayload.benchCapacity,
      ranked: creationPolicyPayload.ranked,
      official: creationPolicyPayload.official,
      preRegistered: draft.preRegistered,
      mmrRangeMode: draft.mmrRangeMode,
      mmrLimitMode: creationPolicyPayload.mmrLimitMode,
      ageRestriction: draft.ageRestriction,
      allowedAgeGroups: ageRestrictionOption.allowedGroups,
      objectionWindow: draft.objectionWindow,
      disputeMinutes: Number.parseInt(draft.objectionWindow, 10),
      rules: {
        ...getMatchRulesPayload(draft, { mode: draft.mode }),
        ...creationPolicyPayload,
        sideCapacity: creationPolicyPayload.onCourtCount,
        ageRestriction: draft.ageRestriction,
        allowedAgeGroups: ageRestrictionOption.allowedGroups,
      },
      stakes: draft.stakes,
      courtReserved: creationPolicyPayload.venuePaymentType === "paid_reserved",
      courtFee: creationPolicyPayload.venueFee ? String(creationPolicyPayload.venueFee) : "",
      memo: [
        creationPolicyPayload.venuePaymentType === "paid_reserved" ? `구장 예약: ${creationPolicyPayload.venueFee ? `${creationPolicyPayload.venueFee}원` : "예약 있음"}` : "",
        remakeDraft && draft.remakeCancellationReason ? `이전 방 취소 사유: ${draft.remakeCancellationReason}` : "",
        draft.memo,
        isPublicRoom ? "공개방: 빈 슬롯은 방에서 공개 모집합니다." : "비공개방: 초대/선택된 인원만 참여합니다.",
      ].filter(Boolean).join("\n"),
    });
    if (typeof postId === "string" && postId) {
      const presetTeamAId = remakeDraft ? draft.remakeTeamAId : challengeTeamAId;
      const presetTeamBId = remakeDraft ? draft.remakeTeamBId : challengeTeamBId;
      let presetTeamAReady = false;
      if (createAsTeam && presetTeamAId) {
        const result = await app.actions.setRecruitingRoomTeam(postId, "teamA", presetTeamAId);
        if (!result || result?.ok === false) {
          await app.actions.closeRecruitingPost(postId, "A팀 선택 실패로 생성 취소");
          setSubmitFeedback(formatCreateSaveError(result, "A팀을 선택하지 못해 생성한 방을 종료했습니다."));
          return;
        }
        presetTeamAReady = true;
      }
      if (remakeDraft && draft.remakeReinvite) {
        if (createAsTeam && presetTeamAReady && presetTeamBId) {
          await app.actions.setRecruitingRoomTeam(postId, "teamB", presetTeamBId, remakeInvitationContext);
        } else if (!createAsTeam) {
          for (const group of draft.remakeInvitationGroups ?? []) {
            await app.actions.inviteRecruitingPlayers(postId, {
              side: group.side,
              reserve: group.reserve,
              playerIds: group.playerIds,
              joinMode: "player",
              contextMessage: remakeInvitationContext,
            });
          }
        }
      } else if (!remakeDraft && createAsTeam && presetTeamAReady && draft.visibility === "private" && presetTeamBId) {
        const result = await app.actions.setRecruitingRoomTeam(postId, "teamB", presetTeamBId, "시즌 라이벌 매치업에서 보낸 팀 초대입니다.");
        if (!result || result?.ok === false) {
          await app.actions.closeRecruitingPost(postId, "B팀 초대 실패로 생성 취소");
          setSubmitFeedback(formatCreateSaveError(result, "상대 B팀을 초대하지 못해 생성한 방을 종료했습니다."));
          return;
        }
      }
      if (onRecruitingCreated) onRecruitingCreated(postId);
      else navigate(`/app/recruiting?post=${encodeURIComponent(postId)}`);
    }
    else {
      setSubmitFeedback(formatCreateSaveError(postId, "경기를 저장하지 못했습니다."));
    }
    return;
    } catch (error) {
      setSubmitFeedback(formatCreateSaveError(error, "경기를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요."));
    } finally {
      setSubmitting(false);
    }
  };

  return {
    selectTeamA, selectTeamB, assignTeam, toggleTournamentTeam, renderCourtSearchItem, renderCreateTeamSearchItem, renderOpponentTeamSearchItem,
    selectReferee, removeTournamentReferee, clearReferee, renderRefereeSearchItem, renderSoloRecordUserSearchItem, submit,
  };
}
