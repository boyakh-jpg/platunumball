import { Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import Button from "../common/Button.jsx";
import InlineValidatedInput from "../common/InlineValidatedInput.jsx";
import { BENCH_CAPACITY_OPTIONS } from "../../lib/constants.js";
import {
  COST_ROUND_UNIT_OPTIONS,
  MATCH_FORMATION_OPTIONS,
  MATCH_PURPOSE_OPTIONS,
  PAYMENT_POLICY_OPTIONS,
  PICKUP_ROTATION_MODE_OPTIONS,
  PLAYING_TIME_POLICY_OPTIONS,
  REFUND_POLICY_OPTIONS,
  VENUE_PAYMENT_TYPE_OPTIONS,
  VENUE_SECURED_OPTIONS,
  VESTS_PROVIDED_OPTIONS,
  getMatchCreationPolicyPayload,
  getMatchCreationSummary,
} from "../../lib/matchCreationPolicies.js";

export const MATCH_CREATION_STEPS = Object.freeze([
  { id: 1, label: "기본 설정" },
  { id: 3, label: "규칙·운영" },
  { id: 4, label: "구장·비용" },
]);

export function getMatchCreationSteps(summaryType = "match") {
  if (summaryType === "personal_record") {
    return [
      { id: 1, label: "기록" },
      { id: 5, label: "확인·저장" },
    ];
  }
  if (summaryType === "match_record") {
    return [{ id: 1, label: "경기 기록" }];
  }
  if (summaryType === "tournament") {
    return MATCH_CREATION_STEPS.map((step) => step.id === 1
      ? { ...step, label: "대회 기본" }
      : step.id === 3
        ? { ...step, label: "규칙·일정" }
        : step.id === 4 ? { ...step, label: "구장" } : step);
  }
  return MATCH_CREATION_STEPS;
}

export function MatchCreationWizardNav({ currentStep, steps = MATCH_CREATION_STEPS, onStepChange }) {
  if (steps.length < 2) return null;
  const currentIndex = Math.max(0, steps.findIndex((step) => step.id === currentStep));
  return (
    <nav className="match-creation-wizard-nav" aria-label="경기 만들기 단계">
      <ol className={`step-count-${steps.length}`}>
        {steps.map((step, index) => (
          <li key={step.id} className={currentStep === step.id ? "active" : index < currentIndex ? "complete" : ""}>
            <button type="button" aria-current={currentStep === step.id ? "step" : undefined} onClick={() => onStepChange(step.id)}>
              <span>{index < currentIndex ? <Check size={14} /> : index + 1}</span>
              <strong>{step.label}</strong>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function MatchCreationWizardActions({
  currentStep,
  steps = MATCH_CREATION_STEPS,
  onStepChange,
  onCancel,
  submitLabel = "",
  submitDisabled = false,
  submitFeedback = "",
  onSubmit,
}) {
  const currentIndex = Math.max(0, steps.findIndex((step) => step.id === currentStep));
  const previousStep = steps[currentIndex - 1];
  const nextStep = steps[currentIndex + 1];
  const singleStep = steps.length < 2;
  const edgeStep = !previousStep || !nextStep;
  const lastStep = Boolean(previousStep && !nextStep);
  return (
    <div className={`match-creation-wizard-actions${singleStep ? " is-single-step" : ""}${edgeStep ? " is-edge-step" : ""}${lastStep ? " is-last-step" : ""}`}>
      <span className="match-creation-wizard-secondary-actions">
        <Button type="button" variant="secondary" onClick={onCancel}>
          <X size={16} /> 취소하기
        </Button>
        {previousStep ? (
          <Button type="button" variant="secondary" onClick={() => onStepChange(previousStep.id)}>
            <ChevronLeft size={17} /> 이전
          </Button>
        ) : null}
      </span>
      <span className="match-creation-wizard-primary-actions">
        {submitFeedback ? <small className="create-submit-warning">{submitFeedback}</small> : null}
        {nextStep ? (
          <Button type="button" onClick={() => onStepChange(nextStep.id)}>
            다음 <ChevronRight size={17} />
          </Button>
        ) : submitLabel ? (
          <Button type="button" disabled={submitDisabled} onClick={onSubmit}>{submitLabel}</Button>
        ) : null}
      </span>
    </div>
  );
}

export function MatchIntentPresetSelector({ matchPurpose, formationMode, onPurposeSelect, onFormationSelect, formationLocked = false }) {
  const pickup = formationMode === "pickup";
  const purposeValue = matchPurpose;
  return (
    <div className="match-intent-axis-grid">
      <div className="match-intent-axis">
        <span className="field-label create-choice-heading">경기 목적</span>
        <div className="match-intent-preset-grid" role="radiogroup" aria-label="경기 목적">
          {MATCH_PURPOSE_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={purposeValue === option.id}
              className={purposeValue === option.id ? "ui-choice-tile active" : "ui-choice-tile"}
              title={option.description}
              onClick={() => {
                if (purposeValue !== option.id) onPurposeSelect(option.id);
              }}
            >
              <strong>{option.label}</strong>
              <span>{option.description}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="match-intent-axis">
        <span className="field-label create-choice-heading">팀 구성</span>
        <div className="match-intent-preset-grid" role="radiogroup" aria-label="팀 구성 방식">
          {MATCH_FORMATION_OPTIONS.map((option) => {
            const active = pickup ? option.id === "pickup" : option.id === "prearranged";
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={active}
                className={active ? "ui-choice-tile active" : "ui-choice-tile"}
                disabled={formationLocked && option.id === "pickup"}
                onClick={() => {
                  if (option.id !== formationMode) onFormationSelect(option.id);
                }}
              >
                <strong>{option.label}</strong>
                <span>{option.description}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function MatchRosterPolicyFields({ draft, onChange }) {
  const policy = getMatchCreationPolicyPayload(draft);
  const pickup = policy.formationMode === "pickup";
  return (
    <div className="match-roster-policy-fields">
      <div className="field-block">
        <span className="field-label">{pickup ? "추가 참가 인원" : "후보 정원"}</span>
        <div className="ui-segmented-control segmented-control compact-segments match-bench-capacity-control">
          {BENCH_CAPACITY_OPTIONS.map((benchCapacity) => (
            <button
              key={benchCapacity}
              type="button"
              className={policy.benchCapacity === benchCapacity ? "active" : ""}
              aria-label={benchCapacity === 0 ? (pickup ? "추가 참가자 없음" : "후보 없음") : pickup ? `추가 참가자 ${benchCapacity * 2}명` : `후보 ${benchCapacity}명`}
              onClick={() => onChange({
                benchCapacity,
                benchPaymentAcknowledged: benchCapacity === 0 || draft.playingTimePolicy !== "none",
              })}
            >
              {benchCapacity === 0 ? "없음" : `${pickup ? benchCapacity * 2 : benchCapacity}명`}
            </button>
          ))}
        </div>
        <small>{pickup
          ? `출전 ${policy.onCourtCount * 2}명${policy.waitingPlayerCapacity > 0 ? ` + 통합 대기 ${policy.waitingPlayerCapacity}명` : " · 대기 없음"}입니다.`
          : `출전 ${policy.onCourtCount}명${policy.benchCapacity > 0 ? ` + 후보 ${policy.benchCapacity}명` : " · 후보 없음"}, 사이드당 ${policy.teamCapacity}명입니다.`}</small>
      </div>
      {pickup ? (
        <div className="match-pickup-rotation-fields">
          <div className="field-block">
            <span className="field-label">팀 나누기</span>
            <strong>출석 후 현장 결정</strong>
            <small>출석자끼리 현장 직접, 완전 랜덤, MMR 균형 중 하나를 정합니다.</small>
          </div>
          <div className="field-block">
            <span className="field-label">균등 교대 기준</span>
            <div className="ui-segmented-control segmented-control create-choice-segments is-three" role="radiogroup" aria-label="균등 교대 기준">
              {PICKUP_ROTATION_MODE_OPTIONS.map((option) => (
                <button key={option.id} type="button" role="radio" aria-checked={policy.rotationMode === option.id} className={policy.rotationMode === option.id ? "active" : ""} onClick={() => onChange({ rotationMode: option.id })}>
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          {policy.rotationMode === "interval" ? (
            <label>
              교대 간격
              <select value={policy.rotationIntervalMinutes} onChange={(event) => onChange({ rotationIntervalMinutes: Number(event.target.value) })}>
                {[3, 5, 7, 10].map((minutes) => <option key={minutes} value={minutes}>{minutes}분</option>)}
              </select>
            </label>
          ) : null}
          <small>최종 배치는 방장 또는 심판이 확정합니다.</small>
        </div>
      ) : policy.benchCapacity > 0 ? (
        <div className="field-block">
          <span className="field-label">후보 출전 정책</span>
          <div className="ui-segmented-control segmented-control create-choice-segments is-three" role="radiogroup" aria-label="후보 출전 정책">
            {PLAYING_TIME_POLICY_OPTIONS.map((option) => (
              <button key={option.id} type="button" role="radio" aria-checked={policy.playingTimePolicy === option.id} className={policy.playingTimePolicy === option.id ? "active" : ""} onClick={() => onChange({ playingTimePolicy: option.id, benchPaymentAcknowledged: option.id !== "none" })}>
                {option.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function MatchCostPolicyFields({ draft, onChange }) {
  const policy = getMatchCreationPolicyPayload(draft);
  const paidVenue = policy.venuePaymentType === "paid_reserved" || policy.venuePaymentType === "paid_not_reserved";
  const freeVenue = policy.venuePaymentType === "free_public" || policy.venuePaymentType === "first_come_public";
  const getMoneyInputValue = (fieldName) => draft[fieldName] ?? policy[fieldName];
  return (
    <div className="match-cost-policy-fields">
      <div className="form-grid two">
        <label>
          구장 비용 유형
          <select value={policy.venuePaymentType} onChange={(event) => {
            const venuePaymentType = event.target.value;
            onChange({
              venuePaymentType,
              courtReserved: venuePaymentType === "paid_reserved",
              venueSecured: venuePaymentType === "first_come_public" ? "first_come" : venuePaymentType === "paid_not_reserved" ? "unconfirmed" : "confirmed",
            });
          }}>
            {VENUE_PAYMENT_TYPE_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <div className="field-block">
          <span className="field-label">구장 확보 상태</span>
          <div className="ui-segmented-control segmented-control create-choice-segments is-three" role="radiogroup" aria-label="구장 확보 상태">
            {VENUE_SECURED_OPTIONS.map((option) => (
              <button key={option.id} type="button" role="radio" aria-checked={policy.venueSecured === option.id} className={policy.venueSecured === option.id ? "active" : ""} onClick={() => onChange({ venueSecured: option.id })}>
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="match-cost-components-grid">
        <label>대관료<InlineValidatedInput clearOnDirectEntry type="number" min="0" step="100" value={freeVenue ? policy.venueFee : getMoneyInputValue("venueFee")} disabled={freeVenue} onChange={(event) => onChange({ venueFee: event.target.value, courtFee: event.target.value })} /></label>
        <label>심판비<InlineValidatedInput clearOnDirectEntry type="number" min="0" step="100" value={getMoneyInputValue("refereeFee")} onChange={(event) => onChange({ refereeFee: event.target.value })} /></label>
        <label>기록비<InlineValidatedInput clearOnDirectEntry type="number" min="0" step="100" value={getMoneyInputValue("recordingFee")} onChange={(event) => onChange({ recordingFee: event.target.value })} /></label>
        <label>장비비<InlineValidatedInput clearOnDirectEntry type="number" min="0" step="100" value={getMoneyInputValue("equipmentFee")} onChange={(event) => onChange({ equipmentFee: event.target.value })} /></label>
        <label>기타비<InlineValidatedInput clearOnDirectEntry type="number" min="0" step="100" value={getMoneyInputValue("otherFee")} onChange={(event) => onChange({ otherFee: event.target.value })} /></label>
      </div>
      <div className="form-grid two">
        <label>
          비용 분담
          <select value={policy.paymentPolicy} onChange={(event) => onChange({ paymentPolicy: event.target.value, benchPaymentAcknowledged: false })}>
            {PAYMENT_POLICY_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <div className="field-block">
          <span className="field-label">1인 금액 반올림</span>
          <div className="ui-segmented-control segmented-control create-choice-segments" role="radiogroup" aria-label="1인 금액 반올림">
            {COST_ROUND_UNIT_OPTIONS.map((option) => (
              <button key={option.id} type="button" role="radio" aria-checked={policy.costRoundUnit === option.id} className={policy.costRoundUnit === option.id ? "active" : ""} onClick={() => onChange({ costRoundUnit: option.id })}>
                {option.label}
              </button>
            ))}
          </div>
        </div>
        {paidVenue ? (
          <label>
            무료 취소 마감
            <select value={policy.freeCancellationHours} onChange={(event) => onChange({ freeCancellationHours: Number(event.target.value) })}>
              <option value={24}>경기 24시간 전</option>
              <option value={12}>경기 12시간 전</option>
              <option value={6}>경기 6시간 전</option>
              <option value={0}>무료 취소 없음</option>
            </select>
          </label>
        ) : null}
        {paidVenue ? (
          <div className="field-block">
            <span className="field-label">환불 기준</span>
            <div className="ui-segmented-control segmented-control create-choice-segments is-three" role="radiogroup" aria-label="환불 기준">
              {REFUND_POLICY_OPTIONS.map((option) => (
                <button key={option.id} type="button" role="radio" aria-checked={policy.refundPolicy === option.id} className={policy.refundPolicy === option.id ? "active" : ""} onClick={() => onChange({ refundPolicy: option.id })}>
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <div className="match-cost-summary" aria-live="polite">
        <span>예상 총비용</span>
        <strong>{policy.totalCost.toLocaleString("ko-KR")}원</strong>
        {policy.estimatedFeePerPlayer > 0 ? <em>1인 약 {policy.estimatedFeePerPlayer.toLocaleString("ko-KR")}원</em> : null}
      </div>
      {policy.requiresBenchPaymentAcknowledgement ? (
        <label className="match-bench-payment-acknowledgement">
          <input type="checkbox" checked={policy.benchPaymentAcknowledged} onChange={(event) => onChange({ benchPaymentAcknowledged: event.target.checked })} />
          <span>후보도 동일한 참가비를 부담하며 출전은 보장되지 않음을 확인합니다.</span>
        </label>
      ) : null}
    </div>
  );
}

export function MatchOperationsPolicyFields({ draft, onChange }) {
  const policy = getMatchCreationPolicyPayload(draft);
  return (
    <div className="match-operations-policy-fields">
      <div className="form-grid two match-operations-core-grid">
        <label>
          경기 공 준비
          <select value={policy.ballProvider} onChange={(event) => onChange({ ballProvider: event.target.value })}>
            <option value="host">방장 제공</option>
            <option value="venue">구장 제공</option>
            <option value="participant">참가자 제공</option>
            <option value="unknown">현장 협의</option>
          </select>
        </label>
        {policy.onCourtCount > 1 ? (
          <div className="field-block">
            <span className="field-label">조끼 준비</span>
            <div className="ui-segmented-control segmented-control create-choice-segments" role="radiogroup" aria-label="조끼 준비">
              {VESTS_PROVIDED_OPTIONS.map((option) => (
                <button key={option.id} type="button" role="radio" aria-checked={policy.vestsProvided === option.value} className={policy.vestsProvided === option.value ? "active" : ""} onClick={() => onChange({ vestsProvided: option.value })}>
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function MatchCreationFinalSummary({ draft, summaryType = "match", errors = [], warnings = [] }) {
  const summary = getMatchCreationSummary(draft);
  const personalRecordRows = [
    { label: "기록 유형", value: "개인 기록" },
    { label: "입력 방식", value: draft.recordEntryMode === "named" ? "이름 기록" : "빠른 기록" },
    { label: "공개 상태", value: draft.visibility === "public" ? "공개 · 프로필 기록에 표시" : "비공개 · 나만 열람" },
    { label: "경기 방식", value: draft.mode || "1v1" },
    { label: "점수", value: `${draft.soloScoreFor || 0} : ${draft.soloScoreAgainst || 0}` },
    { label: "구장", value: draft.court || "구장 미정" },
    { label: "종료 일시", value: [draft.scheduledDate, draft.scheduledTime].filter(Boolean).join(" ") || "일시 미정" },
  ];
  const hiddenLabels = summaryType === "match_record"
    ? new Set(["경기 목적", "팀 구성", "비용"])
    : summaryType === "tournament"
      ? new Set(["경기 목적", "팀 구성", "비용", "일정"])
      : new Set();
  const scopedRows = summary.rows.filter((row) => !hiddenLabels.has(row.label));
  const matchRecordRows = [
    { label: "기록 유형", value: "경기 기록" },
    { label: "구성 방식", value: draft.recordComposition === "team" ? "팀 구성" : "개인 구성" },
    { label: "경기 방식", value: draft.mode || "5v5" },
    { label: "구장", value: draft.court || "구장 미정" },
    { label: "시작 일시", value: [draft.scheduledDate, draft.scheduledTime].filter(Boolean).join(" ") || "일시 미정" },
  ];
  const tournamentRows = [
    { label: "대회 방식", value: draft.tournamentFormat === "tournament" ? "토너먼트" : "리그" },
    ...scopedRows,
    { label: "기간", value: [draft.scheduledDate, draft.tournamentEndDate].filter(Boolean).join(" ~ ") || "기간 미정" },
  ];
  const rows = summaryType === "personal_record"
    ? personalRecordRows
    : summaryType === "match_record"
      ? matchRecordRows
      : summaryType === "tournament"
        ? tournamentRows
        : scopedRows;
  const sentence = summaryType === "personal_record"
    ? "입력한 경기 결과와 개인 스탯을 내 기록으로 저장합니다."
    : summaryType === "match_record"
      ? "빈 경기 기록을 만든 뒤 참가자 또는 팀을 구성합니다. 정해진 확인 기간 안에 참가를 확인한 선수만 서버 정책에 따라 개인 MMR 반영 대상이 되며 팀 MMR은 반영하지 않습니다."
      : summaryType === "tournament"
        ? "선택한 참가팀·명단·규칙·구장 운영값으로 대회를 만듭니다."
        : summary.sentence;
  return (
    <div className="match-creation-final-summary">
      <div className="match-creation-summary-grid ui-design-borderless-list">
        {rows.map((row) => (
          <div key={row.label}>
            <span>{row.label}</span>
            <strong>{row.value}</strong>
          </div>
        ))}
      </div>
      <p>{sentence}</p>
      {errors.length ? (
        <div className="match-creation-validation-list is-error ui-design-borderless-surface">
          <strong>생성 전 확인 필요</strong>
          {errors.map((message) => <span key={message}>{message}</span>)}
        </div>
      ) : null}
      {warnings.length ? (
        <div className="match-creation-validation-list is-warning ui-design-borderless-surface">
          <strong>운영 주의</strong>
          {warnings.map((message) => <span key={message}>{message}</span>)}
        </div>
      ) : null}
      {!errors.length ? <div className="match-creation-ready ui-design-borderless-surface"><Check size={17} /> 생성 가능한 설정입니다.</div> : null}
    </div>
  );
}
