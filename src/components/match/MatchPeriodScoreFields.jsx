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
      <small>구간별 합계는 최종 점수와 같아야 합니다. 입력하지 않아도 저장할 수 있습니다.</small>
    </fieldset>
  );
}
