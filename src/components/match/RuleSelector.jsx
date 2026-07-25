import InlineValidatedInput from "../common/InlineValidatedInput.jsx";
import {
  MATCH_CLOCK_MODE_OPTIONS,
  MATCH_END_CONDITION_OPTIONS,
  MATCH_PERIOD_OPTIONS,
  MATCH_RULE_NUMBER_FIELDS,
  getMatchRuleSummary,
  getMatchRuleInputValidation,
  getMatchPeriodMinutesMax,
  getMatchRulesPayload,
  normalizeMatchRules,
} from "../../lib/matchRules.js";
import { getMatchClockPresetOptions } from "../../lib/matchCreationPolicies.js";

export default function RuleSelector({ draft, onChange }) {
  const rules = normalizeMatchRules(draft, { mode: draft.mode });
  const inputValidation = getMatchRuleInputValidation(draft, { mode: draft.mode });
  const clockPresetOptions = getMatchClockPresetOptions(draft.mode);
  const updateRules = (patch) => {
    const next = { ...rules, ...patch };
    const payload = getMatchRulesPayload(next, { mode: draft.mode });
    const preservedRawNumbers = Object.fromEntries(
      MATCH_RULE_NUMBER_FIELDS
        .filter((key) => Object.prototype.hasOwnProperty.call(draft, key) && !Object.prototype.hasOwnProperty.call(patch, key))
        .map((key) => [key, draft[key]]),
    );
    onChange({ ...payload, ...preservedRawNumbers });
  };
  const updateNumber = (key, value) => onChange({ [key]: value });
  const numberValue = (key) => (
    Object.prototype.hasOwnProperty.call(draft, key) ? draft[key] : rules[key]
  );
  const periodUnitLabel = rules.periodCount === 4 ? "쿼터당 시간 (분)" : rules.periodCount === 2 ? "하프당 시간 (분)" : "경기 시간 (분)";

  return (
    <div className="match-rule-selector">
      <div className="match-clock-preset-row">
        <span>BOXTIER 경기시계</span>
        <div className="segmented-control compact-segments" role="radiogroup" aria-label="BOXTIER 경기시계 사용 여부">
          <button
            type="button"
            role="radio"
            aria-checked={rules.gameClockEnabled}
            className={rules.gameClockEnabled ? "active" : ""}
            onClick={() => updateRules({ gameClockEnabled: true })}
          >
            사용
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={!rules.gameClockEnabled}
            className={!rules.gameClockEnabled ? "active" : ""}
            onClick={() => updateRules({ gameClockEnabled: false, lastPeriodStopMinutes: 0 })}
          >
            사용 안 함
          </button>
        </div>
      </div>
      {!rules.gameClockEnabled ? (
        <small className="match-rule-summary">경기 진행과 점수 기록은 가능합니다. 경쟁전은 경기시계 미사용 MMR 반영률이 적용됩니다.</small>
      ) : null}
      {draft.visibility === "public" && rules.gameClockEnabled ? (
        <label className="switch-line">
          <input
            type="checkbox"
            checked={rules.qrAttendanceEnabled}
            onChange={(event) => updateRules({ qrAttendanceEnabled: event.target.checked })}
          />
          QR 출석 사용
          <small>5분마다 바뀌는 QR입니다. 시작 전은 정상 출석, 시작 후는 지각·같은 사이드 후보로 등록됩니다.</small>
        </label>
      ) : null}
      {rules.gameClockEnabled && clockPresetOptions.length > 1 ? <div className="match-clock-preset-row">
        <span>경기시간 프리셋</span>
        <div className="segmented-control compact-segments">
          {clockPresetOptions.map((option) => (
            <button key={option.id} type="button" onClick={() => updateRules(option.patch)}>{option.label}</button>
          ))}
        </div>
      </div> : null}
      <div className="form-grid match-rule-grid">
      <label>
        종료 기준
        <select value={rules.endCondition} onChange={(event) => updateRules({ endCondition: event.target.value })}>
          {MATCH_END_CONDITION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      {rules.endCondition === "target_or_time" ? (
      <label>
        목표 점수
        <InlineValidatedInput
          type="number"
          min="7"
          max="99"
          aria-label="목표 점수"
          value={numberValue("targetScore")}
          message={inputValidation.fieldMessages.targetScore}
          onChange={(event) => updateNumber("targetScore", event.target.value)}
        />
      </label>
      ) : null}
      <label>
        경기 구성
        <select value={rules.periodCount} onChange={(event) => updateRules({ periodCount: Number(event.target.value) })}>
          {MATCH_PERIOD_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      <label>
        {periodUnitLabel}
        <InlineValidatedInput
          type="number"
          min="1"
          max={getMatchPeriodMinutesMax(rules.periodCount)}
          aria-label={periodUnitLabel}
          value={numberValue("periodMinutes")}
          message={inputValidation.fieldMessages.periodMinutes}
          onChange={(event) => updateNumber("periodMinutes", event.target.value)}
        />
      </label>
      {rules.gameClockEnabled ? (
        <label>
          시간 운영 방식
          <select value={rules.clockMode} onChange={(event) => updateRules({ clockMode: event.target.value })}>
            {MATCH_CLOCK_MODE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      ) : null}
      {rules.gameClockEnabled && rules.clockMode === "running" ? (
        <label>
          마지막 구간 스톱 (분)
          <InlineValidatedInput
            type="number"
            min="0"
            max={rules.periodMinutes}
            aria-label="마지막 구간 스톱 (분)"
            value={numberValue("lastPeriodStopMinutes")}
            message={inputValidation.fieldMessages.lastPeriodStopMinutes}
            onChange={(event) => updateNumber("lastPeriodStopMinutes", event.target.value)}
          />
        </label>
      ) : null}
      {rules.periodCount === 4 ? (
        <label>
          쿼터 사이 휴식 (분)
          <InlineValidatedInput
            type="number"
            min="0"
            max="30"
            aria-label="쿼터 사이 휴식 (분)"
            value={numberValue("periodBreakMinutes")}
            message={inputValidation.fieldMessages.periodBreakMinutes}
            onChange={(event) => updateNumber("periodBreakMinutes", event.target.value)}
          />
        </label>
      ) : null}
      {rules.periodCount > 1 ? (
        <label>
          하프타임 (분)
          <InlineValidatedInput
            type="number"
            min="0"
            max="30"
            aria-label="하프타임 (분)"
            value={numberValue("halftimeMinutes")}
            message={inputValidation.fieldMessages.halftimeMinutes}
            onChange={(event) => updateNumber("halftimeMinutes", event.target.value)}
          />
        </label>
      ) : null}
      <label>
        연장 1회 (분)
        <InlineValidatedInput
          type="number"
          min="1"
          max="20"
          aria-label="연장 1회 (분)"
          value={numberValue("overtimeMinutes")}
          message={inputValidation.fieldMessages.overtimeMinutes}
          onChange={(event) => updateNumber("overtimeMinutes", event.target.value)}
        />
      </label>
      <label>
        사용 공
        <select value={rules.ball} onChange={(event) => updateRules({ ball: event.target.value })}>
          <option>7호 공</option>
          <option>6호 공</option>
          <option>코트 공</option>
        </select>
      </label>
      {rules.endCondition === "target_or_time" ? (
      <label className="switch-line">
        <input type="checkbox" checked={rules.winByTwo} onChange={(event) => updateRules({ winByTwo: event.target.checked })} />
        2점 차 승리
      </label>
      ) : null}
      </div>
      <small className={`match-rule-summary${inputValidation.valid ? "" : " is-invalid"}`}>
        {inputValidation.valid ? getMatchRuleSummary(rules, draft.mode) : "빨간 안내가 표시된 값을 확인해 주세요."}
      </small>
    </div>
  );
}
