import { CreateMatchIntentSection } from "./CreateMatchIntentSection.jsx";
import { CreateMatchDetailsSection } from "./CreateMatchDetailsSection.jsx";
import { CreateMatchCourtRosterSection } from "./CreateMatchCourtRosterSection.jsx";
import { CreateMatchPolicyReviewSection } from "./CreateMatchPolicyReviewSection.jsx";

export function CreateMatchLayout({ context }) {
  const {
    Badge, MatchCreationWizardActions, MatchCreationWizardNav, creationWizardSteps, draft, embedded, finalWizardStep,
    getRoomRemakeWarningCopy, goToWizardStep, isMatchRecordRoom, isRecordCreateIntent, isSoloRecord, isTournamentRoom, navigate,
    onCancel, remakeDraft, setDraft, submit, submitDisabled, submitFeedback, submitting,
    wizardStep,
  } = context;

  return (
<form
      className="page-stack create-match-page"
      onSubmit={(event) => event.preventDefault()}
      onPointerDownCapture={(event) => {
        const activeElement = event.currentTarget.ownerDocument.activeElement;
        if (activeElement?.tagName === "INPUT" && activeElement.type === "number" && activeElement.value === "" && activeElement !== event.target) {
          activeElement.blur();
        }
      }}
    >
      {!embedded ? <header className={`page-header create-match-hero ui-page-hero ui-design-app-hero ${isRecordCreateIntent ? "is-record" : "is-match"}`}>
        <div className="ui-page-hero__copy">
          <p className="eyebrow">{isRecordCreateIntent ? "RecordMatch" : "CreateMatch"}</p>
          <h1>{isRecordCreateIntent ? "기록하기" : "경기/대회 만들기"}</h1>
          {remakeDraft ? <Badge tone="orange">취소된 방 설정을 불러왔습니다. 새 일정을 확인해 주세요.</Badge> : null}
          {remakeDraft ? <p className="form-warning">{getRoomRemakeWarningCopy(remakeDraft.remakeExpectedCount)}</p> : null}
          {remakeDraft?.remakeInviteCount ? (
            <label className="room-remake-reinvite">
              <input
                type="checkbox"
                checked={Boolean(draft.remakeReinvite)}
                onChange={(event) => setDraft((current) => ({ ...current, remakeReinvite: event.target.checked }))}
              />
              <span>
                <strong>
                  {remakeDraft.remakeTeamBId
                    ? "이전 상대 팀에 새 초대장 보내기"
                    : `이전 참가자 ${remakeDraft.remakeInviteCount}명 다시 초대`}
                </strong>
                <small>기존 참가 상태는 복사하지 않으며 새 방에서 다시 수락해야 합니다.</small>
              </span>
            </label>
          ) : null}
        </div>
      </header> : null}

      <MatchCreationWizardNav currentStep={wizardStep} steps={creationWizardSteps} onStepChange={goToWizardStep} />

      <div className="content-grid wide-left">
        <CreateMatchIntentSection context={context} />

        <CreateMatchDetailsSection context={context} />

        <CreateMatchCourtRosterSection context={context} />

        <CreateMatchPolicyReviewSection context={context} />
      </div>
      <MatchCreationWizardActions
        currentStep={wizardStep}
        steps={creationWizardSteps}
        onStepChange={goToWizardStep}
        submitLabel={wizardStep === finalWizardStep
          ? isSoloRecord
            ? "기록 저장"
            : isMatchRecordRoom
              ? "경기 기록 만들기"
              : isTournamentRoom
                ? "대회 생성"
                : "경기 생성"
          : ""}
        submitDisabled={submitDisabled || submitting}
        submitFeedback={wizardStep === finalWizardStep ? submitFeedback : ""}
        onSubmit={submit}
        onCancel={() => {
          if (onCancel) onCancel();
          else navigate("/app");
        }}
      />
    </form>
  );
}
