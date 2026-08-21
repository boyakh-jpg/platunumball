export function CreateMatchPolicyReviewSection({ context }) {
  const {
    Card, MatchCreationReviewPanel, MatchCreationRulePanel, MatchOperationsPolicyFields,
    creationWizardType, draft, finalWizardStep, isMatchRecordRoom, isSoloRecord, isStandardCreateWizard,
    isTournamentRoom, matchCreationValidation, selectedCourt, selectedTournamentCourts,
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
        <Card as="fieldset" className="section-card full-span workflow-fieldset">
          <legend className="section-title-row">
            <div>
              <h2>{isSoloRecord || isMatchRecordRoom ? "기록 메모" : "약속과 메모"}</h2>
              <p className="eyebrow">{isSoloRecord || isMatchRecordRoom ? "Record Note" : "계약 조건"}</p>
            </div>
          </legend>
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
