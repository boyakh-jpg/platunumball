export default function RuleSelector({ draft, onChange }) {
  return (
    <div className="form-grid">
      <label>
        목표 점수
        <input type="number" min="7" max="31" value={draft.targetScore} onChange={(event) => onChange({ targetScore: event.target.value })} />
      </label>
      <label>
        제한 시간
        <input type="number" min="5" max="30" value={draft.timeLimit} onChange={(event) => onChange({ timeLimit: event.target.value })} />
      </label>
      <label>
        사용 공
        <select value={draft.ball} onChange={(event) => onChange({ ball: event.target.value })}>
          <option>7호 공</option>
          <option>6호 공</option>
          <option>코트 공</option>
        </select>
      </label>
      <label className="switch-line">
        <input type="checkbox" checked={draft.winByTwo} onChange={(event) => onChange({ winByTwo: event.target.checked })} />
        2점 차 승리
      </label>
    </div>
  );
}
