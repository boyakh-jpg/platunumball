import { normalizeMatchPeriodScores } from "../../../shared/lib/matchPeriodScores.js";

const SCORE_PATTERN = /^\d{0,3}$/;

export default function MatchPeriodScoreFields({
  rules,
  value = [],
  onChange,
  editableScoreSides = ["teamA", "teamB"],
  teamALabel = "TEAM A",
  teamBLabel = "TEAM B",
  disabled = false,
  readOnly = false,
  needsReview = false,
}) {
  const periodScores = normalizeMatchPeriodScores(value, rules);
  const updateScore = (index, sideName, rawValue) => {
    if (!SCORE_PATTERN.test(rawValue)) return;
    const scoreKey = sideName === "teamA" ? "scoreA" : "scoreB";
    onChange?.(periodScores.map((item, itemIndex) => (
      itemIndex === index
        ? { ...item, [scoreKey]: rawValue === "" ? null : Number(rawValue) }
        : item
    )));
  };

  if (readOnly) {
    return (
      <fieldset className="match-period-score-fields">
        <legend>구간별 점수</legend>
        <table className="match-period-score-summary" aria-label="구간별 점수">
          <thead><tr><th scope="col">팀</th>{periodScores.map(({ label }) => <th scope="col" key={label}>{label}</th>)}</tr></thead>
          <tbody>
            <tr><th scope="row">{teamALabel}</th>{periodScores.map((item) => <td key={item.label}>{item.scoreA ?? "—"}</td>)}</tr>
            <tr><th scope="row">{teamBLabel}</th>{periodScores.map((item) => <td key={item.label}>{item.scoreB ?? "—"}</td>)}</tr>
          </tbody>
        </table>
        <small>{needsReview
          ? "구간별 점수 확인이 필요합니다. 경기 종료 후 방장·심판이 최종 기록에서 수정할 수 있습니다."
          : "전광판 점수를 구간별로 자동 기록합니다. 종료 후 최종 기록에서 수정할 수 있습니다."}</small>
      </fieldset>
    );
  }

  return (
    <fieldset className="match-period-score-fields">
      <legend>구간별 점수</legend>
      <div className="match-period-score-head" aria-hidden="true">
        <span>구간</span>
        <span>{teamALabel}</span>
        <span>{teamBLabel}</span>
      </div>
      {periodScores.map((item, index) => (
        <div className="match-period-score-row" key={item.label}>
          <strong>{item.label}</strong>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            aria-label={`${item.label} ${teamALabel} 점수`}
            disabled={disabled || !editableScoreSides.includes("teamA")}
            value={item.scoreA ?? ""}
            onChange={(event) => updateScore(index, "teamA", event.target.value)}
          />
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            aria-label={`${item.label} ${teamBLabel} 점수`}
            disabled={disabled || !editableScoreSides.includes("teamB")}
            value={item.scoreB ?? ""}
            onChange={(event) => updateScore(index, "teamB", event.target.value)}
          />
        </div>
      ))}
      <small>자동 기록된 구간별 점수를 확인하고 필요할 때 수정하세요. 합계는 최종 점수와 같아야 합니다.</small>
    </fieldset>
  );
}
