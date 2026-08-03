import { CreateMatchRefereePicker } from "./CreateMatchRefereePicker.jsx";

export function CreateMatchDetailsSection({ context }) {
  const {
    Card, MATCH_MODES, MatchRosterPolicyFields, NumericStepper, SOLO_RECORD_MODES,
    SearchPicker, app, canCreateTeamRoom, draft,
    getDefaultCreateTitle, getDefaultTournamentTitle, getMatchFormationMode, getMatchModeChangePatch, getSoloRecordUserSearchText, isDefaultCreateTitle, isDefaultTournamentTitle,
    isInstantRoom, isMatchRecordRoom, isPickupMatch, isPublicRoom, isSoloRecord, isStandardCreateWizard, isTournamentRoom,
    maxScheduleDate, minSoloRecordDate, modeManuallyChangedRef, normalizeSoloRosterSide, practiceMode, recordComposition, recordEntryMode,
    remoteDirectoryEnabled, renderSoloRecordUserSearchItem, scheduleMaxDate,
    setSoloTeamAUserQuery, setSoloTeamBUserQuery, soloRecordUserCandidates, soloTeamAUserQuery, soloTeamBUserQuery,
    today, tournamentFormatOptions, tournamentScheduleOptions, update, wizardStep,
  } = context;

  return (
    <>
{wizardStep === 1 ? (
        <Card className="section-card full-span">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">기본 설정</p>
              <h2>경기 정보와 일정</h2>
            </div>
          </div>
          <div className={`form-grid create-match-info-grid ${!isTournamentRoom && !isSoloRecord && !isMatchRecordRoom ? "is-standard-room" : ""}`}>
            <label className="create-title-field">
              {isTournamentRoom ? "대회 이름" : "제목"}
              <input value={draft.title} onChange={(event) => update({ title: event.target.value })} />
            </label>
            {!isTournamentRoom && !isSoloRecord && !isMatchRecordRoom ? (
              <label className="create-format-field">
                참가 방식
                <select
                  value={draft.hostJoinMode}
                  onChange={(event) => {
                    const hostJoinMode = isPickupMatch || (event.target.value === "team" && !canCreateTeamRoom) ? "player" : event.target.value;
                    const opponentLeaderId = "";
                    update({
                      hostJoinMode,
                      teamOnly: hostJoinMode === "team",
                      teamAId: undefined,
                      teamBId: undefined,
                      playerIds: [],
                      reservePlayerIds: [],
                      opponentPlayerIds: [],
                      opponentReservePlayerIds: [],
                      opponentLeaderId,
                    });
                  }}
                >
                  <option value="team" disabled={!canCreateTeamRoom || isPickupMatch}>팀전</option>
                  <option value="player">개인전</option>
                </select>
                {isPickupMatch
                  ? <span className="form-warning">픽업은 개인 참가자를 모집해 현장에서 팀을 나눕니다.</span>
                  : !canCreateTeamRoom ? <span className="form-warning">팀이 있어야 팀전을 만들 수 있습니다.</span> : null}
              </label>
            ) : null}
            {isTournamentRoom ? (
              <label className="create-format-field">
                대회 방식
                <select value={draft.tournamentFormat} onChange={(event) => {
                  const tournamentFormat = event.target.value;
                  update({
                    tournamentFormat,
                    title: isDefaultTournamentTitle(draft.title) ? getDefaultTournamentTitle(tournamentFormat) : draft.title,
                  });
                }}>
                  {tournamentFormatOptions.map((option) => <option key={option.id} value={option.id}>{option.label} · {option.desc}</option>)}
                </select>
              </label>
            ) : null}
            {!isTournamentRoom && !isSoloRecord && !isMatchRecordRoom ? (
              <div className="field-block create-timing-field">
                <span className="field-label">일정</span>
                <div className="ui-segmented-control segmented-control compact-segments">
                  <button type="button" className={draft.timingType === "scheduled" ? "active" : ""} disabled={practiceMode} onClick={() => update({ timingType: "scheduled" })}>일정 지정</button>
                  <button type="button" className={draft.timingType === "instant" ? "active" : ""} onClick={() => update({ timingType: "instant" })}>즉시</button>
                </div>
                <small>{practiceMode ? "연습에서는 즉시 경기만 사용합니다." : isInstantRoom ? "날짜와 시간 없이 바로 경기 준비방을 만듭니다." : isPublicRoom ? "공개 예약방은 5일 이내이면서 시작까지 4시간 이상 남은 일정만 만들 수 있습니다." : "비공개 예약방은 1개월 이내 일정으로 만들 수 있습니다."}</small>
              </div>
            ) : null}
            <label className="create-capacity-field">
              경기 인원
              <select value={draft.mode} onChange={(event) => {
                modeManuallyChangedRef.current = true;
                const mode = event.target.value;
                if (isTournamentRoom) {
                  update({
                    ...getMatchModeChangePatch(draft, mode),
                    title: isDefaultCreateTitle(draft.title) ? getDefaultCreateTitle(mode) : draft.title,
                  });
                  return;
                }
                if (isSoloRecord) {
                  update({ mode });
                  return;
                }
                if (isMatchRecordRoom) {
                  update({
                    ...getMatchModeChangePatch(draft, mode),
                    hostJoinMode: recordComposition === "team" ? "team" : "player",
                    teamOnly: recordComposition === "team",
                    teamAId: undefined,
                    teamBId: undefined,
                    playerIds: [app.currentUser.id],
                    reservePlayerIds: [],
                    opponentPlayerIds: [],
                    opponentReservePlayerIds: [],
                    opponentLeaderId: "",
                  });
                  return;
                }
                const hostJoinMode = getMatchFormationMode(draft) === "pickup" || mode === "1v1" || !canCreateTeamRoom ? "player" : draft.hostJoinMode;
                const nextIsTeamRoom = !isTournamentRoom && hostJoinMode === "team";
                const opponentLeaderId = "";
                update({
                  ...getMatchModeChangePatch(draft, mode),
                  hostJoinMode,
                  teamOnly: nextIsTeamRoom,
                  teamAId: undefined,
                  teamBId: undefined,
                  title: isDefaultCreateTitle(draft.title) ? getDefaultCreateTitle(mode, draft.matchIntent) : draft.title,
                  ...(nextIsTeamRoom ? {
                    playerIds: [],
                    reservePlayerIds: [],
                    opponentPlayerIds: [],
                    opponentReservePlayerIds: [],
                    opponentLeaderId,
                  } : {
                    playerIds: [],
                    reservePlayerIds: [],
                    opponentPlayerIds: [],
                    opponentReservePlayerIds: [],
                    opponentLeaderId: "",
                  }),
                });
              }}>
                {(isSoloRecord ? SOLO_RECORD_MODES : MATCH_MODES).map((mode) => (
                  <option key={mode.id} value={mode.id}>
                    {mode.label}
                  </option>
                ))}
              </select>
            </label>
            {!isInstantRoom ? (
              <>
                <label className="create-date-field">
                  날짜
                  <input type="date" min={isSoloRecord || isMatchRecordRoom ? minSoloRecordDate : today} max={scheduleMaxDate} value={draft.scheduledDate} onChange={(event) => update({ scheduledDate: event.target.value })} />
                </label>
                <label className="create-time-field">
                  {isMatchRecordRoom ? "시작 시각" : isSoloRecord ? "종료 시각" : "시간"}
                  <input type="time" value={draft.scheduledTime} onChange={(event) => update({ scheduledTime: event.target.value })} />
                  {isMatchRecordRoom
                    ? <small>종료시간은 시작시간 기준 30분 뒤로 저장됩니다.</small>
                    : isSoloRecord
                      ? <small>현재부터 과거 24시간 이내</small>
                      : null}
                </label>
              </>
            ) : null}
            {isSoloRecord ? (
              <>
                <label className="personal-record-score-field">
                  우리팀 점수
                  <NumericStepper
                    value={draft.soloScoreFor}
                    max={999}
                    label="우리팀 점수"
                    clearZeroOnFocus
                    onChange={(value) => update({ soloScoreFor: value })}
                  />
                </label>
                <label className="personal-record-score-field">
                  상대 점수
                  <NumericStepper
                    value={draft.soloScoreAgainst}
                    max={999}
                    label="상대 점수"
                    clearZeroOnFocus
                    onChange={(value) => update({ soloScoreAgainst: value })}
                  />
                </label>
                {recordEntryMode === "named" ? (
                  <>
                <label>
                  우리 팀명
                  <input value={draft.soloTeamAName} placeholder="우리팀" onChange={(event) => update({ soloTeamAName: event.target.value })} />
                </label>
                <label>
                  상대 팀명
                  <input value={draft.soloTeamBName} placeholder="상대팀" onChange={(event) => update({ soloTeamBName: event.target.value, soloOpponentName: event.target.value })} />
                </label>
                <label>
                  우리팀 유저 찾기
                  <SearchPicker
                    value={soloTeamAUserQuery}
                    onChange={setSoloTeamAUserQuery}
                    placeholder="이름, #해시태그 검색"
                    items={soloRecordUserCandidates}
                    getSearchText={getSoloRecordUserSearchText}
                    remoteSearchType={remoteDirectoryEnabled ? "player" : ""}
                    remoteLimit={10}
                    idleItems={soloRecordUserCandidates.slice(0, 5)}
                    idleTitle="최근/지역 선수"
                    title="선수 검색 결과"
                    emptyText="선수 없음"
                    showIdleOnFocus
                    floating
                    closeOnResultClick
                    renderItem={renderSoloRecordUserSearchItem("teamA")}
                  />
                </label>
                <label>
                  상대팀 유저 찾기
                  <SearchPicker
                    value={soloTeamBUserQuery}
                    onChange={setSoloTeamBUserQuery}
                    placeholder="이름, #해시태그 검색"
                    items={soloRecordUserCandidates}
                    getSearchText={getSoloRecordUserSearchText}
                    remoteSearchType={remoteDirectoryEnabled ? "player" : ""}
                    remoteLimit={10}
                    idleItems={soloRecordUserCandidates.slice(0, 5)}
                    idleTitle="최근/지역 선수"
                    title="선수 검색 결과"
                    emptyText="선수 없음"
                    showIdleOnFocus
                    floating
                    closeOnResultClick
                    renderItem={renderSoloRecordUserSearchItem("teamB")}
                  />
                </label>
                <label className="memo-label solo-record-roster-field">
                  우리팀 선수
                  <textarea
                    value={draft.soloTeamAPlayersText}
                    placeholder="한 줄에 한 명. 예: 김민준 #rb001pg PG"
                    onChange={(event) => update({ soloTeamAPlayersText: event.target.value })}
                    onBlur={() => normalizeSoloRosterSide("teamA")}
                  />
                </label>
                <label className="memo-label solo-record-roster-field">
                  상대 선수
                  <textarea
                    value={draft.soloTeamBPlayersText}
                    placeholder="한 줄에 한 명. 예: 이서연 #rb002c C"
                    onChange={(event) => update({ soloTeamBPlayersText: event.target.value })}
                    onBlur={() => normalizeSoloRosterSide("teamB")}
                  />
                </label>
                  </>
                ) : null}
              </>
            ) : null}
            {!isTournamentRoom && !isSoloRecord && !isMatchRecordRoom && !isStandardCreateWizard ? (
              <CreateMatchRefereePicker context={context} />
            ) : null}
            {isTournamentRoom ? (
              <>
                <label>
                  종료일
                  <input type="date" min={today} max={maxScheduleDate} value={draft.tournamentEndDate} onChange={(event) => update({ tournamentEndDate: event.target.value })} />
                </label>
                <label>
                  일정 배정
                  <select value={draft.tournamentSchedulePolicy} onChange={(event) => update({ tournamentSchedulePolicy: event.target.value })}>
                    {tournamentScheduleOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                  </select>
                </label>
              </>
            ) : null}
          </div>
          {!isSoloRecord && !isMatchRecordRoom ? <MatchRosterPolicyFields draft={draft} onChange={update} /> : null}
        </Card>
        ) : null}
    </>
  );
}
