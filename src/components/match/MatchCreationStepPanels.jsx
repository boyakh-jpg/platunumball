import Card from "../common/Card.jsx";
import { DISPUTE_WINDOW_OPTIONS } from "../../lib/constants.js";
import RuleSelector from "./RuleSelector.jsx";
import { MatchCreationFinalSummary } from "./MatchCreationWizard.jsx";

export function MatchCreationRulePanel({
  draft,
  isTournamentRoom,
  onChange,
}) {
  return (
    <Card as="fieldset" className="section-card full-span workflow-fieldset">
      <legend className="section-title-row">
        <div>
          <h2>룰 설정</h2>
          <p className="eyebrow">규칙</p>
        </div>
      </legend>
      <RuleSelector draft={draft} onChange={onChange} />
      <div className={`form-grid two create-rules-grid${isTournamentRoom ? " has-schedule-note" : ""}`}>
        <label>
          공격권 룰
          <input value={draft.attackRule} onChange={(event) => onChange({ attackRule: event.target.value })} />
        </label>
        <label>
          파울 룰
          <input value={draft.foulRule} onChange={(event) => onChange({ foulRule: event.target.value })} />
        </label>
        <label>
          이의제기 시간
          <select value={draft.objectionWindow} onChange={(event) => onChange({ objectionWindow: event.target.value })}>
            {DISPUTE_WINDOW_OPTIONS.map((minutes) => (
              <option key={minutes} value={`${minutes}분`}>{minutes}분</option>
            ))}
          </select>
        </label>
        {isTournamentRoom ? (
          <label>
            일정 메모
            <input value={draft.tournamentScheduleNote} onChange={(event) => onChange({ tournamentScheduleNote: event.target.value })} />
          </label>
        ) : null}
      </div>
    </Card>
  );
}

export function MatchCreationReviewPanel({
  draft,
  summaryType,
  errors,
  warnings,
}) {
  return (
    <Card className="section-card full-span match-creation-review-card">
      <div className="section-title-row">
        <div>
          <p className="eyebrow">Final check</p>
          <h2>최종 확인</h2>
        </div>
      </div>
      <MatchCreationFinalSummary
        draft={draft}
        summaryType={summaryType}
        errors={errors}
        warnings={warnings}
      />
    </Card>
  );
}
