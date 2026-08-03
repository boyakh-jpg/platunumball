export function CreateMatchPolicyReviewSection({ context }) {
  const {
    Button, Card, MatchCreationReviewPanel, MatchCreationRulePanel, MatchOperationsPolicyFields, SearchPicker,
    clearSelectedCourt, courtQuery, creationWizardType, draft, favoriteCourts,
    finalWizardStep, getCourtAddress, getCourtSearchText, isMatchRecordRoom, isSoloRecord, isStandardCreateWizard,
    isTournamentRoom, matchCreationValidation, remoteDirectoryEnabled, renderCourtSearchItem,
    selectedCourt, selectedTournamentCourts, setCourtQuery, sortedCourts,
    submitDisabledReason, update, wizardStep,
  } = context;

  return (
    <>
{!isSoloRecord && wizardStep === 3 ? (
          <MatchCreationRulePanel
            draft={draft}
            isTournamentRoom={isTournamentRoom}
            onChange={update}
          />
        ) : null}

        {wizardStep === 3 || wizardStep === 5 || (isMatchRecordRoom && wizardStep === 1) ? (
        <Card className="section-card full-span">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">{isSoloRecord || isMatchRecordRoom ? "Record Note" : "계약 조건"}</p>
              <h2>{isSoloRecord || isMatchRecordRoom ? "기록 메모" : "약속과 메모"}</h2>
            </div>
          </div>
          {isStandardCreateWizard || isTournamentRoom ? (
            <MatchOperationsPolicyFields draft={draft} onChange={update} />
          ) : null}
          {!isSoloRecord && !isMatchRecordRoom ? (
            <label className="memo-label">
              약속/벌칙 메모
              <textarea value={draft.stakes} onChange={(event) => update({ stakes: event.target.value })} />
            </label>
          ) : null}
          <label className="memo-label">
            경기 메모
            <textarea value={draft.memo} onChange={(event) => update({ memo: event.target.value })} />
          </label>
          {isSoloRecord || isMatchRecordRoom ? (
            <div className="field-block create-record-court-field">
              <span className="field-label">경기 구장</span>
              <SearchPicker
                value={courtQuery}
                onChange={setCourtQuery}
                placeholder="코트명·주소 검색"
                items={sortedCourts}
                idleItems={favoriteCourts.length ? favoriteCourts : sortedCourts.slice(0, 10)}
                idleTitle={favoriteCourts.length ? "즐겨찾는 구장" : "내 지역 추천 구장"}
                title="구장 검색 결과"
                emptyText="등록 구장 없음"
                showIdleOnFocus
                floating
                closeOnResultClick
                remoteSearchType={remoteDirectoryEnabled ? "court" : ""}
                getSearchText={getCourtSearchText}
                renderItem={renderCourtSearchItem}
              />
              <div className="stat-integrity-note create-record-court-selection">
                <span>{selectedCourt ? `${selectedCourt.name} · ${getCourtAddress(selectedCourt)}` : "선택하지 않으면 구장 미정으로 저장합니다."}</span>
                {selectedCourt ? <Button type="button" variant="secondary" size="sm" onClick={clearSelectedCourt}>선택 취소</Button> : null}
              </div>
            </div>
          ) : null}
        </Card>
        ) : null}

        {wizardStep === finalWizardStep ? (
          <MatchCreationReviewPanel
            draft={{
              ...draft,
              summaryConfirmationTarget: "",
              court: isTournamentRoom
                ? selectedTournamentCourts.map((court) => court.name).join(", ") || selectedCourt?.name || draft.court
                : selectedCourt?.name ?? draft.court ?? "",
            }}
            summaryType={creationWizardType}
            errors={Array.from(new Set([
              ...(!isSoloRecord ? matchCreationValidation.ruleErrors : []),
              ...(isStandardCreateWizard ? matchCreationValidation.policyErrors : []),
              ...(submitDisabledReason ? [submitDisabledReason] : []),
            ]))}
            warnings={isStandardCreateWizard ? matchCreationValidation.warnings : []}
          />
        ) : null}
    </>
  );
}
