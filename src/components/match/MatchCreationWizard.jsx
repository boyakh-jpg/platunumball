import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import Button from "../common/Button.jsx";
import { BENCH_CAPACITY_OPTIONS, DEFAULT_BENCH_CAPACITY } from "../../lib/constants.js";
import {
  MATCH_INTENT_OPTIONS,
  PAYMENT_POLICY_OPTIONS,
  PLAYING_TIME_POLICY_OPTIONS,
  VENUE_PAYMENT_TYPE_OPTIONS,
  VENUE_SECURED_OPTIONS,
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
      { id: 1, label: "기록 기본" },
      { id: 4, label: "구장" },
      { id: 5, label: "메모" },
    ];
  }
  if (summaryType === "match_record") {
    return [
      { id: 1, label: "기록 기본" },
      { id: 3, label: "기록 규칙" },
      { id: 4, label: "구장" },
      { id: 5, label: "메모" },
    ];
  }
  if (summaryType === "tournament") {
    return MATCH_CREATION_STEPS.map((step) => step.id === 1
      ? { ...step, label: "대회 기본" }
      : step.id === 3 ? { ...step, label: "규칙·일정" } : step);
  }
  return MATCH_CREATION_STEPS;
}

export function MatchCreationWizardNav({ currentStep, steps = MATCH_CREATION_STEPS, onStepChange }) {
  const currentIndex = Math.max(0, steps.findIndex((step) => step.id === currentStep));
  return (
    <nav className="match-creation-wizard-nav" aria-label="경기 만들기 단계">
      <ol>
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

export function MatchCreationWizardActions({ currentStep, steps = MATCH_CREATION_STEPS, onStepChange }) {
  const currentIndex = Math.max(0, steps.findIndex((step) => step.id === currentStep));
  const previousStep = steps[currentIndex - 1];
  const nextStep = steps[currentIndex + 1];
  return (
    <div className="match-creation-wizard-actions">
      {previousStep ? (
        <Button type="button" variant="secondary" onClick={() => onStepChange(previousStep.id)}>
          <ChevronLeft size={17} /> 이전
        </Button>
      ) : <span />}
      {nextStep ? (
        <Button type="button" onClick={() => onStepChange(nextStep.id)}>
          다음 <ChevronRight size={17} />
        </Button>
      ) : null}
    </div>
  );
}

export function MatchIntentPresetSelector({ value, benchCapacity = DEFAULT_BENCH_CAPACITY, onSelect }) {
  return (
    <div className="match-intent-preset-grid" role="radiogroup" aria-label="경기 성격">
      {MATCH_INTENT_OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={value === option.id}
          className={value === option.id ? "active" : ""}
          onClick={() => onSelect(option.id)}
        >
          <strong>{option.label}</strong>
          <span>{benchCapacity > 0 || option.id === "pickup"
            ? option.description
            : option.id === "friendly"
              ? "MMR을 반영하지 않는 친선 경기입니다."
              : "MMR을 반영하는 경쟁 경기입니다."}</span>
        </button>
      ))}
    </div>
  );
}

export function MatchRosterPolicyFields({ draft, onChange }) {
  const policy = getMatchCreationPolicyPayload(draft);
  const pickup = policy.matchIntent === "pickup";
  return (
    <div className="match-roster-policy-fields">
      <div className="field-block">
        <span className="field-label">{pickup ? "사이드 참가 인원" : "사이드 명단"}</span>
        <div className="segmented-control compact-segments match-bench-capacity-control">
          {BENCH_CAPACITY_OPTIONS.map((benchCapacity) => (
            <button
              key={benchCapacity}
              type="button"
              className={policy.benchCapacity === benchCapacity ? "active" : ""}
              onClick={() => onChange({
                benchCapacity,
                benchPaymentAcknowledged: benchCapacity === 0 || draft.playingTimePolicy !== "none",
              })}
            >
              {policy.onCourtCount}+{benchCapacity}
            </button>
          ))}
        </div>
        <small>{pickup
          ? `코트 ${policy.onCourtCount}명과 순환 대기 ${policy.benchCapacity}명입니다. 고정 후보로 지정하지 않습니다.`
          : `출전 ${policy.onCourtCount}명 기준입니다.`}</small>
      </div>
      {pickup ? (
        <div className="field-block">
          <span className="field-label">운영 방식</span>
          <strong>현장 팀배정 · 방장 수동 순환</strong>
          <small>자동 로테이션은 지원하지 않습니다. 방장이 현장에서 팀과 교대 순서를 정합니다.</small>
        </div>
      ) : policy.benchCapacity > 0 ? (
        <label>
          후보 출전 정책
          <select
            value={policy.playingTimePolicy}
            onChange={(event) => onChange({
              playingTimePolicy: event.target.value,
              benchPaymentAcknowledged: event.target.value !== "none",
            })}
          >
            {PLAYING_TIME_POLICY_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
      ) : null}
    </div>
  );
}

export function MatchCostPolicyFields({ draft, onChange }) {
  const policy = getMatchCreationPolicyPayload(draft);
  const paidVenue = policy.venuePaymentType === "paid_reserved" || policy.venuePaymentType === "paid_not_reserved";
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
        <label>
          구장 확보 상태
          <select value={policy.venueSecured} onChange={(event) => onChange({ venueSecured: event.target.value })}>
            {VENUE_SECURED_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
      </div>
      <div className="match-cost-components-grid">
        <label>대관료<input type="number" min="0" step="100" value={policy.venueFee} onChange={(event) => onChange({ venueFee: event.target.value, courtFee: event.target.value })} /></label>
        <label>심판비<input type="number" min="0" step="100" value={policy.refereeFee} onChange={(event) => onChange({ refereeFee: event.target.value })} /></label>
        <label>기록비<input type="number" min="0" step="100" value={policy.recordingFee} onChange={(event) => onChange({ recordingFee: event.target.value })} /></label>
        <label>장비비<input type="number" min="0" step="100" value={policy.equipmentFee} onChange={(event) => onChange({ equipmentFee: event.target.value })} /></label>
        <label>기타비<input type="number" min="0" step="100" value={policy.otherFee} onChange={(event) => onChange({ otherFee: event.target.value })} /></label>
      </div>
      <div className="form-grid two">
        <label>
          비용 분담
          <select value={policy.paymentPolicy} onChange={(event) => onChange({ paymentPolicy: event.target.value, benchPaymentAcknowledged: false })}>
            {PAYMENT_POLICY_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <label>
          1인 금액 반올림
          <select value={policy.costRoundUnit} onChange={(event) => onChange({ costRoundUnit: Number(event.target.value) })}>
            <option value={100}>100원 단위</option>
            <option value={500}>500원 단위</option>
          </select>
        </label>
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
          <label>
            환불 기준
            <select value={policy.refundPolicy} onChange={(event) => onChange({ refundPolicy: event.target.value })}>
              <option value="full_before_deadline">마감 전 전액 환불</option>
              <option value="no_refund">환불 없음</option>
              <option value="custom">별도 협의</option>
            </select>
          </label>
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
      <div className="form-grid two">
        <label>
          공 제공
          <select value={policy.ballProvider} onChange={(event) => onChange({ ballProvider: event.target.value })}>
            <option value="host">방장 제공</option>
            <option value="venue">구장 제공</option>
            <option value="participant">참가자 제공</option>
            <option value="unknown">현장 협의</option>
          </select>
        </label>
      </div>
      <div className="toggle-pair match-equipment-toggle-grid">
        <label><input type="checkbox" checked={policy.vestsProvided} onChange={(event) => onChange({ vestsProvided: event.target.checked })} /> 조끼 제공</label>
        <label><input type="checkbox" checked={policy.scoreboardAvailable} onChange={(event) => onChange({ scoreboardAvailable: event.target.checked })} /> 점수판 있음</label>
        <label><input type="checkbox" checked={policy.shotClockAvailable} onChange={(event) => onChange({ shotClockAvailable: event.target.checked })} /> 샷클락 있음</label>
        <label><input type="checkbox" checked={policy.statRecorderAvailable} onChange={(event) => onChange({ statRecorderAvailable: event.target.checked })} /> 기록원 있음</label>
      </div>
    </div>
  );
}

export function MatchCreationFinalSummary({ draft, summaryType = "match", errors = [], warnings = [] }) {
  const summary = getMatchCreationSummary(draft);
  const personalRecordRows = [
    { label: "기록 유형", value: "개인 기록" },
    { label: "경기 방식", value: draft.mode || "1v1" },
    { label: "점수", value: `${draft.soloScoreFor || 0} : ${draft.soloScoreAgainst || 0}` },
    { label: "구장", value: draft.court || "구장 미정" },
    { label: "날짜", value: draft.scheduledDate || "날짜 미정" },
  ];
  const hiddenLabels = summaryType === "match_record"
    ? new Set(["경기 성격", "비용"])
    : summaryType === "tournament"
      ? new Set(["경기 성격", "비용", "일정"])
      : new Set();
  const scopedRows = summary.rows.filter((row) => !hiddenLabels.has(row.label));
  const matchRecordRows = [
    ...scopedRows,
    { label: "기록 확인", value: draft.summaryConfirmationTarget || "확인 대상 선택 필요" },
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
      ? "입력한 명단과 규칙으로 경기 기록 확인방을 만듭니다. MMR에는 반영하지 않습니다."
      : summaryType === "tournament"
        ? "선택한 참가팀·명단·규칙·구장 운영값으로 대회를 만듭니다."
        : summary.sentence;
  return (
    <div className="match-creation-final-summary">
      <div className="match-creation-summary-grid">
        {rows.map((row) => (
          <div key={row.label}>
            <span>{row.label}</span>
            <strong>{row.value}</strong>
          </div>
        ))}
      </div>
      <p>{sentence}</p>
      {errors.length ? (
        <div className="match-creation-validation-list is-error">
          <strong>생성 전 확인 필요</strong>
          {errors.map((message) => <span key={message}>{message}</span>)}
        </div>
      ) : null}
      {warnings.length ? (
        <div className="match-creation-validation-list is-warning">
          <strong>운영 주의</strong>
          {warnings.map((message) => <span key={message}>{message}</span>)}
        </div>
      ) : null}
      {!errors.length ? <div className="match-creation-ready"><Check size={17} /> 생성 가능한 설정입니다.</div> : null}
    </div>
  );
}
