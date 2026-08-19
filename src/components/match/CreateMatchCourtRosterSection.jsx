import InlineValidatedInput from "../common/InlineValidatedInput.jsx";

export function CreateMatchCourtRosterSection({ context }) {
  const {
    AGE_GROUPS, Badge, Button, Card, ClipboardList, CourtDetailModal, CourtMapPicker,
    Globe2, MapIcon, MapPin, MatchCostPolicyFields, MeetingPointFields, MmrRangeSelector, NumericStepper,
    PLAYER_STAT_FIELDS, REGION_TREE, SearchPicker, ShieldCheck, TeamHoverCard, UsersRound, X,
    activePlayerIds, ageRestrictionBlocked, ageRestrictionOption, app, challengeTeamAId, challengeTeamBId, clearSelectedCourt, courtDetailCourtId, courtMapDirectoryStatus,
    courtMapOpen, courtMapRegion, courtPlayWarning, courtQuery, courtRegion, courtSummary, draft,
    favoriteCourts, favoriteReferees, finalWizardStep, getCourtAddress, getCourtLayoutLabel, getCourtSearchText, getCourtSurfaceLabel,
    getTournamentTeamEligibility, hasTeamChallenge, isMatchRecordRoom, isPublicRoom, isSoloRecord, isStandardCreateWizard, isTeamRoom, isTournamentRoom,
    loadedCourtMapRegionsRef, mmrLimitOptions, mmrRangePolicy, recordComposition, refereeQuery, refereeSearchResults, registeredCourts,
    remoteDirectoryEnabled, removeTournamentCourt, removeTournamentReferee, renderCourtSearchItem, renderCreateTeamSearchItem, renderRefereeSearchItem, representativeTournamentTeam,
    requiredTournamentRefereeCount, roomTierRange, selectCourt, selectedCourt, selectedTournamentCourts, selectedTournamentReferees, setCourtDetailCourtId,
    setCourtMapOpen, setCourtQuery, setCourtRegion, setRefereeQuery, setTeamQuery, sortedCourts,
    sortedTeams, teamQuery, teamTierBlocked, teamTierWarned,
    toggleAgeRestriction, toggleTournamentTeam, tournamentMmrBlocked, tournamentMmrPolicyOptions, tournamentMmrSpread, tournamentRefereeCandidates, tournamentTeams,
    update, updateSoloStat, wizardStep,
  } = context;

  const recordCourtOptional = isSoloRecord || isMatchRecordRoom;

  return (
    <>
{wizardStep === finalWizardStep ? (
        <Card className="section-card full-span selector-panel">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Court Finder</p>
              <h2>코트 검색</h2>
            </div>
            <Badge tone={selectedCourt ? "green" : recordCourtOptional ? "neutral" : "orange"}>
              {selectedCourt?.name ?? (recordCourtOptional ? "구장 미정" : "구장 선택 필요")}
            </Badge>
          </div>
          <div className="search-controls court-finder-controls">
            <label>
              지역
              <select value={courtRegion} onChange={(event) => setCourtRegion(event.target.value)}>
                {REGION_TREE.map((region) => (
                  <optgroup key={region.sido} label={region.sido}>
                    {region.districts.map((district) => {
                      const regionValue = `${region.sido} ${district}`;
                      return <option key={regionValue} value={regionValue}>{regionValue}</option>;
                    })}
                  </optgroup>
                ))}
              </select>
            </label>
            <div className="court-map-launch-control">
              <span>지도</span>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  loadedCourtMapRegionsRef.current.delete(`${courtMapRegion}:map`);
                  setCourtMapOpen(true);
                }}
              >
                <MapIcon size={16} /> 지도에서 찾기
              </Button>
            </div>
            <label>
              코트명
              <SearchPicker
                value={courtQuery}
                onChange={setCourtQuery}
                placeholder="코트, 지역, 실내/야외 검색"
                items={sortedCourts}
                idleItems={favoriteCourts.length ? favoriteCourts : sortedCourts.slice(0, 10)}
                idleTitle={favoriteCourts.length ? "즐겨찾는 구장" : "내 지역 추천 구장"}
                showIdleOnFocus
                floating
                closeOnResultClick
                remoteSearchType={remoteDirectoryEnabled ? "court" : ""}
                getSearchText={getCourtSearchText}
                renderItem={renderCourtSearchItem}
              />
            </label>
          </div>
          <div className="create-selected-court-profile" aria-live="polite">
            <div className="create-selected-court-main">
              <span className="create-selected-court-icon"><MapPin size={20} /></span>
              <div>
                <strong>{selectedCourt?.name ?? (recordCourtOptional ? "구장 미정" : "구장을 선택해 주세요")}</strong>
                <span>{selectedCourt ? getCourtAddress(selectedCourt) : recordCourtOptional ? "선택하지 않으면 구장 미정으로 저장합니다." : "코트명·주소 검색 또는 지도에서 등록 구장을 확인할 수 있습니다."}</span>
                {selectedCourt ? (
                  <em>
                    {selectedCourt.region || "지역 미정"} · {getCourtSurfaceLabel(selectedCourt)} · {getCourtLayoutLabel(selectedCourt)} · {Number(selectedCourt.reviewCount) > 0 ? `보정 ${Number(selectedCourt.adjustedRating ?? selectedCourt.rating ?? 0).toFixed(1)} (${selectedCourt.reviewCount})` : "평가 전"}
                  </em>
                ) : null}
              </div>
            </div>
            <div className="create-selected-court-actions">
              {selectedCourt?.id ? (
                <Button type="button" variant="secondary" size="sm" onClick={() => setCourtDetailCourtId(selectedCourt.id)}>
                  구장 정보
                </Button>
              ) : null}
              {selectedCourt?.id ? (
                <Button type="button" variant="secondary" size="sm" onClick={clearSelectedCourt}>
                  선택 취소
                </Button>
              ) : null}
            </div>
          </div>
          {isStandardCreateWizard ? (
            <MatchCostPolicyFields draft={draft} onChange={update} />
          ) : !isSoloRecord && !isMatchRecordRoom && !isTournamentRoom ? (
            <div className="court-reservation-row">
              <label>
                <input type="checkbox" checked={draft.courtReserved} onChange={(event) => update({ courtReserved: event.target.checked })} />
                구장예약됨
              </label>
              {draft.courtReserved ? (
                <input value={draft.courtFee} placeholder="예약 금액/메모" onChange={(event) => update({ courtFee: event.target.value })} />
              ) : null}
            </div>
          ) : null}
          {!isSoloRecord && !isMatchRecordRoom ? (
            <MeetingPointFields
              draft={draft}
              onChange={update}
              required
              timingType={draft.timingType}
            />
          ) : null}
          {isTournamentRoom ? (
            <div className="tournament-court-pool" aria-label="대회 사용 구장">
              <div>
                <span>대회 사용 구장</span>
                <strong>{selectedTournamentCourts.length}개</strong>
              </div>
              <div className="tournament-court-pool-list">
                {selectedTournamentCourts.map((court) => (
                  <span key={court.id}>
                    {court.name}
                    <button
                      type="button"
                      aria-label={`${court.name} 제외`}
                      disabled={selectedTournamentCourts.length <= 1}
                      onClick={() => removeTournamentCourt(court.id)}
                      title={`${court.name} 제외`}
                    >
                      <X size={14} />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          <div className={courtPlayWarning || (!selectedCourt && !recordCourtOptional) ? "tier-range-note tier-range-note-warning" : "tier-range-note"}>
            <div>
              <span>구장 속성</span>
              <strong>{selectedCourt ? `${getCourtSurfaceLabel(courtSummary)} / ${getCourtLayoutLabel(courtSummary)}` : recordCourtOptional ? "선택 사항" : "구장 선택 필요"}</strong>
              <em>{selectedCourt ? (courtPlayWarning || "선택한 방식과 구장 형태가 충돌하지 않습니다.") : recordCourtOptional ? "선택하지 않으면 구장 미정으로 저장합니다." : "등록된 구장을 검색 결과에서 선택해 주세요."}</em>
            </div>
            <Badge tone={courtPlayWarning || (!selectedCourt && !recordCourtOptional) ? "orange" : selectedCourt ? "green" : "neutral"}>
              {!selectedCourt ? (recordCourtOptional ? "선택" : "필수") : courtPlayWarning ? "경고" : "가능"}
            </Badge>
          </div>
        </Card>
        ) : null}

        <CourtMapPicker
          open={courtMapOpen}
          courts={registeredCourts}
          selectedCourt={selectedCourt}
          currentRegion={courtMapRegion}
          loading={courtMapDirectoryStatus.loading}
          loadError={courtMapDirectoryStatus.error}
          onClose={() => setCourtMapOpen(false)}
          onSelect={(court) => {
            selectCourt(court);
            setCourtMapOpen(false);
          }}
        />
        <CourtDetailModal
          app={app}
          courtId={courtDetailCourtId}
          open={Boolean(courtDetailCourtId)}
          onClose={() => setCourtDetailCourtId("")}
        />

        {wizardStep === 1 ? (
        <Card className="section-card full-span selector-panel">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">{isSoloRecord ? "Solo Record" : isMatchRecordRoom ? "Record Setup" : isTournamentRoom || isTeamRoom ? "Team Finder" : "Match Criteria"}</p>
              <h2>{isSoloRecord ? "개인 스탯" : isMatchRecordRoom ? "방에서 참가자 구성" : isTournamentRoom ? "초대 팀 선택" : isTeamRoom ? "방 생성 후 팀 선택" : "개인전 매칭 기준"}</h2>
            </div>
          </div>
          {isSoloRecord ? (
            <>
              <div className="create-public-note">
                <ClipboardList size={17} />
                <span>우리팀 점수와 내 득점은 따로 입력합니다. 개인 스탯은 기록 히스토리에만 남고 MMR에는 반영하지 않습니다.</span>
              </div>
              <Card className="personal-record-owner-row">
                <div>
                  <strong>{app.currentUser.name}</strong>
                  <span>{app.currentUser.position || "포지션 미설정"} · 본인 개인 스탯</span>
                </div>
                <Badge tone="green">본인</Badge>
              </Card>
              <div className="stat-stepper-list personal-record-stat-grid">
                {PLAYER_STAT_FIELDS.map((field) => (
                  <div className="stat-stepper-row" key={field.id}>
                    <div>
                      <strong>{field.id === "points" ? "내 득점" : field.label}</strong>
                      <span>{field.shortLabel}</span>
                    </div>
                    <NumericStepper
                      className="stat-numeric-stepper"
                      value={(draft.soloStats ?? {})[field.id] ?? 0}
                      max={999}
                      label={field.id === "points" ? "내 득점" : field.label}
                      clearOnFocus
                      onChange={(value) => updateSoloStat(field.id, value)}
                    />
                  </div>
                ))}
              </div>
            </>
          ) : null}
          {isTournamentRoom ? (
            <div className={tournamentMmrBlocked ? "tier-range-note tier-range-note-warning" : "tier-range-note"}>
              <div>
                <span>초대팀 MMR 차이</span>
                <strong>{tournamentTeams.length}팀 · {tournamentMmrSpread}점 차이</strong>
                <em>{draft.mmrLimitMode === "off" ? "제한 없음" : `${draft.tournamentMaxMmrGap}점 기준`}</em>
              </div>
              <Badge tone={tournamentMmrBlocked ? "orange" : "green"}>{tournamentMmrBlocked ? "차단" : "허용"}</Badge>
            </div>
          ) : null}
          {!isSoloRecord && !isMatchRecordRoom ? (
            <div className="create-eligibility-grid">
              {draft.ranked ? (
                <div className={teamTierBlocked ? "mmr-range-mode-control create-eligibility-control ui-design-borderless-surface tier-range-note-warning" : "mmr-range-mode-control create-eligibility-control ui-design-borderless-surface"}>
                  <div className="mmr-range-summary-row">
                    <div>
                      <span>경쟁전 허용구간</span>
                      <strong>{hasTeamChallenge ? `${mmrRangePolicy.label} · 양 팀 출전 가능 인원 자동 계산` : isTournamentRoom ? `${mmrRangePolicy.label} · 팀별 MMR 기준` : isTeamRoom ? `${mmrRangePolicy.label} · A팀 선택 후 확정` : roomTierRange.detail}</strong>
                      <em>{hasTeamChallenge ? "필요 인원을 채우는 최소 범위로 고정" : isTournamentRoom ? "각 팀의 조건 충족 선수 수를 검사" : isTeamRoom ? "방 모달에서 선택한 A팀 MMR 기준" : `${app.currentUser.name} 기준`} · {mmrRangePolicy.detail}</em>
                    </div>
                    <Badge tone={teamTierBlocked || teamTierWarned ? "orange" : "green"}>{teamTierBlocked ? "차단" : teamTierWarned ? "경고" : "허용"}</Badge>
                  </div>
                  <MmrRangeSelector value={draft.mmrRangeMode} disabled={hasTeamChallenge} onChange={(mmrRangeMode) => update({ mmrRangeMode })} />
                </div>
              ) : null}
              <div className={ageRestrictionBlocked ? "mmr-range-mode-control create-eligibility-control ui-design-borderless-surface tier-range-note-warning" : "mmr-range-mode-control create-eligibility-control ui-design-borderless-surface"}>
                <div className="mmr-range-summary-row">
                  <div>
                    <span>연령 제한</span>
                    <strong>{ageRestrictionOption.label}{hasTeamChallenge ? " · 자동" : ""}</strong>
                    <em>{hasTeamChallenge ? "양 팀이 출전 인원을 채우는 최소 연령 범위" : ageRestrictionOption.desc}</em>
                  </div>
                  <Badge tone={ageRestrictionBlocked ? "orange" : "green"}>{ageRestrictionBlocked ? "차단" : "허용"}</Badge>
                </div>
                <div className="ui-segmented-control segmented-control compact-segments create-choice-segments is-three age-restriction-segments" role="group" aria-label="연령 제한 허용 그룹">
                  {AGE_GROUPS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={ageRestrictionOption.allowedGroups.includes(option.id)}
                      className={ageRestrictionOption.allowedGroups.includes(option.id) ? "active" : ""}
                      disabled={hasTeamChallenge}
                      onClick={() => update({ ageRestriction: toggleAgeRestriction(draft.ageRestriction, option.id) })}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
          {isTournamentRoom ? (
            <div className="form-grid two">
              <label>
                MMR 제한
                <select value={draft.mmrLimitMode} onChange={(event) => update({ mmrLimitMode: event.target.value })}>
                  {mmrLimitOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
              </label>
              {isTournamentRoom ? (
                <label>
                  허용 MMR 차이
                  <InlineValidatedInput clearOnDirectEntry type="number" min="0" step="10" value={draft.tournamentMaxMmrGap} onChange={(event) => update({ tournamentMaxMmrGap: event.target.value })} />
                </label>
              ) : null}
              {isTournamentRoom ? (
                <label>
                  MMR 득점 룰
                  <select value={draft.tournamentMmrPolicy} onChange={(event) => update({ tournamentMmrPolicy: event.target.value })}>
                    {tournamentMmrPolicyOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                  </select>
                </label>
              ) : null}
            </div>
          ) : null}
          {isTournamentRoom ? (
            <>
              <div className="search-controls">
                <label>
                  초대 팀 검색
                  <SearchPicker
                    value={teamQuery}
                    onChange={setTeamQuery}
                    placeholder="팀명, #해시태그, 지역, 홈코트 검색"
                    items={sortedTeams}
                    remoteSearchType={remoteDirectoryEnabled ? "team" : ""}
                    floating
                    renderItem={renderCreateTeamSearchItem}
                  />
                </label>
              </div>
            </>
          ) : null}
          {isTournamentRoom ? (
            <>
              <div className="tournament-selected-strip">
                <span>선택 {tournamentTeams.length}팀 · 팀 수 제한 없음 · 2의 거듭제곱이 아니면 부전승 자동 배정</span>
                <div>
                  {tournamentTeams.map((team) => (
                    <button key={team.id} type="button" disabled={team.id === representativeTournamentTeam?.id} onClick={() => toggleTournamentTeam(team.id)}>
                      <TeamHoverCard team={team} as="span"><strong>{team.name}</strong></TeamHoverCard>
                      <em>{team.id === representativeTournamentTeam?.id ? "대표팀" : "해제"}</em>
                    </button>
                  ))}
                </div>
              </div>
              <div className="search-controls tournament-referee-search">
                <label>
                  필수 심판
                  <SearchPicker
                    value={refereeQuery}
                    onChange={setRefereeQuery}
                    placeholder="심판 이름, #해시태그, 지역 검색"
                    items={refereeSearchResults}
                    remoteSearchType={remoteDirectoryEnabled ? "referee" : ""}
                    remoteSearchOnFocus={remoteDirectoryEnabled}
                    remoteSearchContext={{ refereeThroughDate: draft.tournamentEndDate }}
                    mapRemoteItem={(user) => activePlayerIds.has(user.id) ? null : user}
                    idleItems={favoriteReferees.length ? favoriteReferees : tournamentRefereeCandidates.slice(0, 8)}
                    idleTitle={favoriteReferees.length ? "즐겨찾기 심판" : "초대 가능한 심판"}
                    title="심판 검색 결과"
                    emptyText="초대 가능한 심판 없음"
                    showIdleOnFocus
                    floating
                    closeOnResultClick
                    renderItem={renderRefereeSearchItem}
                  />
                </label>
              </div>
              <div className="tournament-selected-strip tournament-referee-selected-strip">
                <span>
                  선택 {selectedTournamentReferees.length}명 · 최소 {requiredTournamentRefereeCount}명 · 모든 대진에 중립 심판 배정 필요
                </span>
                <div>
                  {selectedTournamentReferees.map((referee) => (
                    <button key={referee.id} type="button" onClick={() => removeTournamentReferee(referee.id)}>
                      <strong>{referee.name}</strong>
                      <em>해제</em>
                    </button>
                  ))}
                </div>
              </div>
              <div className="create-public-note ui-design-borderless-surface">
                <ShieldCheck size={17} />
                <span>팀장과 필수 심판이 모두 승인한 뒤 지역관리자가 승인하면 공식 대회가 열립니다. 지역 비승인 대회도 같은 심판 조건을 충족해야 합니다.</span>
              </div>
            </>
          ) : isMatchRecordRoom ? (
            <div className="create-public-note create-match-record-setup-note ui-design-borderless-surface">
              <ClipboardList size={17} />
              <span>
                {recordComposition === "team"
                  ? "빈 경기 기록 생성 후 방장이 두 팀을 선택합니다. 각 팀장이 실제 출전 명단을 확정하고 24시간 동안 참가자 2/3 이상의 내 참가 확인과 문제 신고를 받습니다."
                  : "빈 경기 기록 생성 후 방장이 A/B 참가자를 계정으로 채웁니다. 24시간 동안 실제 참가자 2/3 이상의 내 참가 확인과 문제 신고를 받습니다."}
              </span>
            </div>
          ) : isTeamRoom ? (
            <div className="create-public-note ui-design-borderless-surface">
              <UsersRound size={17} />
              <span>
                {hasTeamChallenge
                  ? `${app.state.teams.find((team) => team.id === challengeTeamAId)?.name ?? "내 팀"}으로 방을 만든 뒤 ${app.state.teams.find((team) => team.id === challengeTeamBId)?.name ?? "라이벌 팀"} 현재 팀장에게 자동 초대합니다.`
                  : isPublicRoom
                  ? "빈 팀방을 만든 뒤 경기방에서 A팀을 선택합니다. B사이드는 상대 팀장이 참가합니다."
                  : "빈 팀방을 만든 뒤 경기방에서 A팀과 B팀을 순서대로 선택합니다. B팀 현재 팀장에게 초대 1건이 자동 생성됩니다."}
              </span>
            </div>
          ) : null}
          {!isSoloRecord && !isMatchRecordRoom && !isTournamentRoom && !isTeamRoom ? (
            <div className="create-public-note ui-design-borderless-surface">
              <Globe2 size={17} />
              <span>{isPublicRoom ? "개인전은 개인 참여만 받습니다. 팀전은 별도 팀전 분기로 만듭니다." : "비공개 개인전은 방을 만든 뒤 방모달의 빈 슬롯에서 선수를 초대합니다."}</span>
            </div>
          ) : null}
          {isPublicRoom ? (
            <div className="create-public-note ui-design-borderless-surface">
              <Globe2 size={17} />
              <span>{isTeamRoom ? "공개 팀방은 A팀 선택 후 상대 팀장이 B사이드로 참가합니다." : "공개방은 매칭 목록에 표시됩니다. 상대 사이드는 방 안의 빈 슬롯을 공개 모집합니다."}</span>
            </div>
          ) : null}
        </Card>
        ) : null}
    </>
  );
}
