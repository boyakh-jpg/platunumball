import HelpDisclosure from "../common/HelpDisclosure.jsx";

export function CreateMatchIntentSection({ context }) {
  const {
    Badge, Card, ClipboardList, Globe2, Lock, MatchIntentPresetSelector, RECORD_COMPOSITION_OPTIONS,
    RECORD_ENTRY_MODE_OPTIONS, RECORD_TYPES, Trophy, app, canCreateTeamRoom, currentRoomKind, defaultMode,
    defaultTeamA, defaultTournamentTeamA, defaultTournamentTeamB, draft, getDefaultCreateTitle, getDefaultTeamPlayerIds, getDefaultTournamentTitle,
    getMatchConfigurationChangePatch, getMatchFormationMode, getMatchIntentChangePatch, getMatchModeChangePatch, getMatchModeOrDefault, getMatchRecordMemo, getRecordComposition,
    getRecordEntryMode, getRepresentativePlayerIds, getRoomKindLabel, getSeoulTimeInputValue, goToWizardStep, isDefaultCreateTitle, isDefaultTournamentTitle,
    hasTeamChallenge, isMatchRecordRoom, isPublicRoom, isRecordCreateIntent, isSoloRecord, isStandardCreateWizard, isTournamentRoom, practiceMode,
    recordComposition, recordEntryMode, selectedTeamA, selectedTeamB, setTeamRegion, today, update,
    wizardStep,
  } = context;

  return (
    <>
{wizardStep === 1 ? (
        <Card className="section-card full-span create-visibility-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Room visibility</p>
              <h2 className="create-choice-heading">{isRecordCreateIntent ? "기록 방식" : "공개 범위"}</h2>
            </div>
            <Badge tone={isTournamentRoom ? "gold" : isPublicRoom ? "green" : "neutral"}>{getRoomKindLabel(currentRoomKind)}</Badge>
          </div>
          <div className={isRecordCreateIntent ? "create-mode-grid" : "create-mode-grid is-compact-control-grid"}>
            {!isRecordCreateIntent ? (
              <>
                <button
                  type="button"
                  className={draft.recordType === RECORD_TYPES.match && draft.visibility === "private" ? "ui-choice-tile active" : "ui-choice-tile"}
                  onClick={() => {
                    const team = defaultTeamA ?? selectedTeamA;
                    const mode = getMatchModeOrDefault(draft.mode, defaultMode);
                    const hostJoinMode = getMatchFormationMode(draft) === "pickup" || mode === "1v1" || !canCreateTeamRoom ? "player" : draft.hostJoinMode;
                    const playerIds = hostJoinMode === "team" ? getRepresentativePlayerIds(app.currentUser.id) : [];
                    const opponentLeaderId = hostJoinMode === "team" ? getDefaultTeamPlayerIds(selectedTeamB, 1, playerIds)[0] ?? "" : "";
                    goToWizardStep(1, { replace: true });
                    update({
                      ...getMatchModeChangePatch(draft, mode),
                      recordType: RECORD_TYPES.match,
                      visibility: "private",
                      qrAttendanceEnabled: undefined,
                      official: false,
                      preRegistered: true,
                      hostJoinMode,
                      teamOnly: hostJoinMode === "team",
                      title: isDefaultCreateTitle(draft.title) || isDefaultTournamentTitle(draft.title) ? getDefaultCreateTitle(mode, draft.matchIntent) : draft.title,
                      teamAId: team?.id ?? draft.teamAId,
                      playerIds,
                      reservePlayerIds: [],
                      opponentPlayerIds: [],
                      opponentReservePlayerIds: [],
                      opponentLeaderId,
                    });
                  }}
                >
                  <Lock size={19} />
                  <span>
                    <strong>비공개 경기방</strong>
                    <em>초대받은 선수·팀만 참여합니다.</em>
                  </span>
                </button>
                <button
                  type="button"
                  className={draft.recordType === RECORD_TYPES.match && draft.visibility === "public" ? "ui-choice-tile active" : "ui-choice-tile"}
                  disabled={practiceMode || hasTeamChallenge}
                  onClick={() => {
                    const team = defaultTeamA ?? selectedTeamA;
                    const nextMode = getMatchModeOrDefault(draft.mode, defaultMode);
                    const hostJoinMode = getMatchFormationMode(draft) === "pickup" || nextMode === "1v1" || !canCreateTeamRoom ? "player" : draft.hostJoinMode;
                    const playerIds = hostJoinMode === "team" ? getRepresentativePlayerIds(app.currentUser.id) : [];
                    goToWizardStep(1, { replace: true });
                    update({
                      ...getMatchModeChangePatch(draft, nextMode),
                      recordType: RECORD_TYPES.match,
                      visibility: "public",
                      qrAttendanceEnabled: undefined,
                      official: false,
                      preRegistered: true,
                      hostJoinMode,
                      teamOnly: hostJoinMode === "team",
                      title: isDefaultCreateTitle(draft.title) || isDefaultTournamentTitle(draft.title) ? getDefaultCreateTitle(nextMode, draft.matchIntent) : draft.title,
                      teamAId: team?.id ?? draft.teamAId,
                      playerIds,
                      reservePlayerIds: [],
                      opponentPlayerIds: [],
                      opponentReservePlayerIds: [],
                    });
                  }}
                >
                  <Globe2 size={19} />
                  <span>
                    <strong>공개 매칭방</strong>
                    <em>매칭 목록에서 선수·팀을 모집합니다.</em>
                  </span>
                </button>
                <button type="button" className={isTournamentRoom ? "ui-choice-tile active" : "ui-choice-tile"} disabled={practiceMode || hasTeamChallenge} onClick={() => {
                  setTeamRegion("전체");
                  const mode = getMatchModeOrDefault(draft.mode, defaultMode);
                  update({
                    ...getMatchConfigurationChangePatch(draft, { matchPurpose: "competitive", formationMode: "prearranged" }),
                    ...getMatchModeChangePatch(draft, mode),
                    recordType: RECORD_TYPES.match,
                    visibility: "tournament",
                    qrAttendanceEnabled: undefined,
                    timingType: "scheduled",
                    hostJoinMode: "team",
                    teamOnly: true,
                    title: isDefaultCreateTitle(draft.title) ? getDefaultTournamentTitle(draft.tournamentFormat) : draft.title,
                    tournamentTeamIds: draft.tournamentTeamIds?.length ? draft.tournamentTeamIds : [defaultTournamentTeamA?.id, defaultTournamentTeamB?.id].filter(Boolean),
                  });
                }}>
                  <Trophy size={19} />
                  <span>
                    <strong>비공개 대회방</strong>
                    <em>초대팀으로 리그·토너먼트를 운영합니다.</em>
                  </span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className={isMatchRecordRoom ? "ui-choice-tile active" : "ui-choice-tile"}
                  onClick={() => {
                    const nextMode = getMatchModeOrDefault(draft.mode, defaultMode);
                    update({
                      ...getMatchIntentChangePatch(draft, "standard_competitive"),
                      ...getMatchModeChangePatch(draft, nextMode),
                      recordType: RECORD_TYPES.matchRecord,
                      recordComposition: getRecordComposition(draft),
                      visibility: "private",
                      timingType: "scheduled",
                      hostJoinMode: getRecordComposition(draft) === "team" ? "team" : "player",
                      teamOnly: getRecordComposition(draft) === "team",
                      ranked: false,
                      official: false,
                      preRegistered: false,
                      mmrLimitMode: "off",
                      ageRestriction: "any",
                      courtReserved: false,
                      courtFee: "",
                      stakes: "",
                      memo: getMatchRecordMemo(draft.memo),
                      title: isMatchRecordRoom ? draft.title : "경기 기록",
                      scheduledDate: today,
                      scheduledTime: getSeoulTimeInputValue(),
                      courtId: "",
                      court: "",
                      teamAId: undefined,
                      teamBId: undefined,
                      playerIds: [app.currentUser.id],
                      reservePlayerIds: [],
                      opponentPlayerIds: [],
                      opponentReservePlayerIds: [],
                      opponentLeaderId: "",
                    });
                  }}
                >
                  <ClipboardList size={19} />
                  <span>
                    <strong>경기 기록</strong>
                    <em>빈 경기 기록을 만든 뒤 실제 참가자를 등록하고 2/3 이상의 내 참가 확인을 받습니다.</em>
                  </span>
                </button>
                <button
                  type="button"
                  className={isSoloRecord ? "ui-choice-tile active" : "ui-choice-tile"}
                  onClick={() => update({
                    ...getMatchModeChangePatch(draft, "1v1"),
                    recordType: RECORD_TYPES.personalRecord,
                    recordEntryMode: getRecordEntryMode(draft),
                    visibility: "private",
                    timingType: "scheduled",
                    hostJoinMode: "player",
                    teamOnly: false,
                    ranked: false,
                    official: false,
                    preRegistered: false,
                    mmrLimitMode: "off",
                    title: draft.recordType === RECORD_TYPES.personalRecord ? draft.title : "개인 기록",
                    scheduledDate: today,
                    scheduledTime: getSeoulTimeInputValue(),
                    courtId: "",
                    court: "",
                    playerIds: [],
                    reservePlayerIds: [],
                    opponentPlayerIds: [],
                    opponentReservePlayerIds: [],
                    opponentLeaderId: "",
                  })}
                >
                  <ClipboardList size={19} />
                  <span>
                    <strong>내 기록</strong>
                    <em>승인 없이 빠르게 남기거나 선수 이름을 직접 적습니다. MMR에는 반영되지 않습니다.</em>
                  </span>
                </button>
              </>
            )}
          </div>
          {practiceMode ? <HelpDisclosure>연습에서는 비공개 경기방만 사용합니다. 경기 목적·팀 구성·시계 규칙은 직접 바꿔볼 수 있습니다.</HelpDisclosure> : null}
          {hasTeamChallenge ? <HelpDisclosure>라이벌 매치는 비공개 팀전으로 고정됩니다.</HelpDisclosure> : null}
          {isStandardCreateWizard ? (
            <div className="match-intent-preset-section">
              <MatchIntentPresetSelector
                matchPurpose={draft.matchPurpose}
                formationMode={draft.formationMode}
                formationLocked={hasTeamChallenge}
                onPurposeSelect={(matchPurpose) => {
                  const patch = getMatchConfigurationChangePatch(draft, { matchPurpose });
                  update({
                    ...patch,
                    qrAttendanceEnabled: undefined,
                    title: isDefaultCreateTitle(draft.title) ? getDefaultCreateTitle(draft.mode, patch.matchIntent) : draft.title,
                  });
                }}
                onFormationSelect={(formationMode) => {
                  const patch = getMatchConfigurationChangePatch(draft, { formationMode });
                  update({
                    ...patch,
                    qrAttendanceEnabled: undefined,
                    title: isDefaultCreateTitle(draft.title) ? getDefaultCreateTitle(draft.mode, patch.matchIntent) : draft.title,
                    ...(formationMode === "pickup" ? {
                      playerIds: [],
                      reservePlayerIds: [],
                      opponentPlayerIds: [],
                      opponentReservePlayerIds: [],
                      opponentLeaderId: "",
                    } : {}),
                  });
                }}
              />
            </div>
          ) : null}
          {isMatchRecordRoom ? (
            <div className="match-intent-preset-section">
              <span className="field-label create-choice-heading">구성 방식</span>
              <div className="match-intent-preset-grid" role="radiogroup" aria-label="경기 기록 구성 방식">
                {RECORD_COMPOSITION_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={recordComposition === option.id}
                    className={recordComposition === option.id ? "ui-choice-tile active" : "ui-choice-tile"}
                    onClick={() => update({
                      recordComposition: option.id,
                      hostJoinMode: option.id === "team" ? "team" : "player",
                      teamOnly: option.id === "team",
                      teamAId: undefined,
                      teamBId: undefined,
                      playerIds: [app.currentUser.id],
                      reservePlayerIds: [],
                      opponentPlayerIds: [],
                      opponentReservePlayerIds: [],
                      opponentLeaderId: "",
                    })}
                  >
                    <strong>{option.label}</strong>
                    <span>{option.description}</span>
                  </button>
                ))}
              </div>
              <div className="create-public-note ui-design-borderless-surface">
                <ClipboardList size={17} />
                <span>생성 단계에서는 아무도 초대하지 않습니다. 방에서 {recordComposition === "team" ? "두 팀과 실제 출전 명단을" : "A/B 실제 참가자를"} 구성합니다.</span>
              </div>
            </div>
          ) : null}
          {isSoloRecord ? (
            <div className="match-intent-preset-section">
              <span className="field-label create-choice-heading">입력 방식</span>
              <div className="match-intent-preset-grid" role="radiogroup" aria-label="내 기록 입력 방식">
                {RECORD_ENTRY_MODE_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={recordEntryMode === option.id}
                    className={recordEntryMode === option.id ? "ui-choice-tile active" : "ui-choice-tile"}
                    onClick={() => update({ recordEntryMode: option.id })}
                  >
                    <strong>{option.label}</strong>
                    <span>{option.description}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {isSoloRecord ? (
            <div className="match-intent-preset-section">
              <span className="field-label create-choice-heading">공개 범위</span>
              <div className="match-intent-preset-grid" role="radiogroup" aria-label="내 기록 공개 범위">
                <button
                  type="button"
                  role="radio"
                  aria-checked={draft.visibility !== "public"}
                  className={`ui-choice-tile has-icon${draft.visibility !== "public" ? " active" : ""}`}
                  onClick={() => update({ visibility: "private" })}
                >
                  <Lock size={19} />
                  <span>
                    <strong>비공개</strong>
                    <em>나만 프로필에서 확인합니다.</em>
                  </span>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={draft.visibility === "public"}
                  className={`ui-choice-tile has-icon${draft.visibility === "public" ? " active" : ""}`}
                  onClick={() => update({ visibility: "public" })}
                >
                  <Globe2 size={19} />
                  <span>
                    <strong>공개</strong>
                    <em>다른 사용자가 내 프로필 기록에서 볼 수 있습니다.</em>
                  </span>
                </button>
              </div>
              <HelpDisclosure>공개 기록도 모집·일정 목록에는 노출되지 않으며 MMR과 공식 통계에 반영되지 않습니다.</HelpDisclosure>
            </div>
          ) : null}
        </Card>
        ) : null}
    </>
  );
}
