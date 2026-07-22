import {
  MATCH_CLOCK_MODE_OPTIONS,
  MATCH_END_CONDITION_OPTIONS,
  MATCH_PERIOD_OPTIONS,
  getMatchRuleSummary,
  getMatchRulesPayload,
  normalizeMatchRules,
} from "../../lib/matchRules.js";
import { getMatchClockPresetOptions } from "../../lib/matchCreationPolicies.js";

export default function RuleSelector({ draft, onChange }) {
  const rules = normalizeMatchRules(draft, { mode: draft.mode });
  const lastPeriodStopMinutes = rules.clockMode === "running"
    ? Math.max(0, Math.min(rules.periodMinutes, Number(draft.lastPeriodStopMinutes) || 0))
    : 0;
  const clockPresetOptions = getMatchClockPresetOptions(draft.mode);
  const updateRules = (patch) => {
    const next = { ...rules, lastPeriodStopMinutes, ...patch };
    onChange({
      ...getMatchRulesPayload(next, { mode: draft.mode }),
      lastPeriodStopMinutes: next.clockMode === "running"
        ? Math.max(0, Math.min(Number(next.periodMinutes) || 0, Number(next.lastPeriodStopMinutes) || 0))
        : 0,
    });
  };
  const periodUnitLabel = rules.periodCount === 4 ? "쿼터당 시간 (분)" : rules.periodCount === 2 ? "하프당 시간 (분)" : "경기 시간 (분)";

  return (
    <div className="match-rule-selector">
      <div className="match-clock-preset-row">
        <span>경기시간 프리셋</span>
        <div className="segmented-control compact-segments">
          {clockPresetOptions.map((option) => (
            <button key={option.id} type="button" onClick={() => updateRules(option.patch)}>{option.label}</button>
          ))}
        </div>
      </div>
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
        <input type="number" min="7" max="99" value={rules.targetScore} onChange={(event) => updateRules({ targetScore: event.target.value })} />
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
        <input type="number" min="1" max="60" value={rules.periodMinutes} onChange={(event) => updateRules({ periodMinutes: event.target.value })} />
      </label>
      <label>
        경기 시계
        <select value={rules.clockMode} onChange={(event) => updateRules({ clockMode: event.target.value })}>
          {MATCH_CLOCK_MODE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      {rules.clockMode === "running" ? (
        <label>
          마지막 구간 스톱 (분)
          <input type="number" min="0" max={rules.periodMinutes} value={lastPeriodStopMinutes} onChange={(event) => updateRules({ lastPeriodStopMinutes: event.target.value })} />
        </label>
      ) : null}
      {rules.periodCount === 4 ? (
        <label>
          쿼터 사이 휴식 (분)
          <input type="number" min="0" max="30" value={rules.periodBreakMinutes} onChange={(event) => updateRules({ periodBreakMinutes: event.target.value })} />
        </label>
      ) : null}
      {rules.periodCount > 1 ? (
        <label>
          하프타임 (분)
          <input type="number" min="0" max="30" value={rules.halftimeMinutes} onChange={(event) => updateRules({ halftimeMinutes: event.target.value })} />
        </label>
      ) : null}
      <label>
        연장 1회 (분)
        <input type="number" min="1" max="20" value={rules.overtimeMinutes} onChange={(event) => updateRules({ overtimeMinutes: event.target.value })} />
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
      <small className="match-rule-summary">
        {getMatchRuleSummary(rules, draft.mode)}
        {lastPeriodStopMinutes > 0 ? ` · 마지막 ${lastPeriodStopMinutes}분 스톱` : ""}
      </small>
    </div>
  );
}
