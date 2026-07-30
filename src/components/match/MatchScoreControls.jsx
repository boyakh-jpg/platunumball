import { useEffect, useState } from "react";
import Badge from "../common/Badge.jsx";
import Button from "../common/Button.jsx";

function getMatchScoreState(match = {}) {
  return {
    scoreA: Number(match.result?.scoreA ?? match.teamA?.score ?? 0),
    scoreB: Number(match.result?.scoreB ?? match.teamB?.score ?? 0),
    revisionA: Number(match.result?.scoreRevisionA ?? 0),
    revisionB: Number(match.result?.scoreRevisionB ?? 0),
  };
}

export default function MatchScoreControls({
  match,
  editableScoreSides = [],
  onIncrementScore = null,
  onSubmitScore = null,
  label = "실시간 팀 점수",
}) {
  const [score, setScore] = useState(() => getMatchScoreState(match));
  const [pendingSide, setPendingSide] = useState("");
  const [scoreError, setScoreError] = useState("");
  const submissionMode = typeof onSubmitScore === "function";

  useEffect(() => {
    setScore(getMatchScoreState(match));
  }, [
    match.id,
    match.result?.scoreA,
    match.result?.scoreB,
    match.result?.scoreRevisionA,
    match.result?.scoreRevisionB,
    match.teamA?.score,
    match.teamB?.score,
  ]);

  const incrementScore = async (sideName, delta) => {
    if (!onIncrementScore || pendingSide || !editableScoreSides.includes(sideName)) return;
    setPendingSide(sideName);
    setScoreError("");
    try {
      const response = await onIncrementScore(sideName, delta, {
        expectedRevisionA: score.revisionA,
        expectedRevisionB: score.revisionB,
      });
      if (response?.ok === false) {
        throw new Error(response.error || response.message || "score_update_failed");
      }
      const responseScore = response?.match ? getMatchScoreState(response.match) : null;
      setScore((current) => ({
        scoreA: Number(
          response?.scoreA
          ?? responseScore?.scoreA
          ?? current.scoreA + (sideName === "teamA" ? delta : 0)
        ),
        scoreB: Number(
          response?.scoreB
          ?? responseScore?.scoreB
          ?? current.scoreB + (sideName === "teamB" ? delta : 0)
        ),
        revisionA: Number(
          response?.scoreRevisionA
          ?? responseScore?.revisionA
          ?? current.revisionA + (sideName === "teamA" ? 1 : 0)
        ),
        revisionB: Number(
          response?.scoreRevisionB
          ?? responseScore?.revisionB
          ?? current.revisionB + (sideName === "teamB" ? 1 : 0)
        ),
      }));
    } catch (error) {
      setScoreError(String(error?.message || error?.code || "점수를 갱신하지 못했습니다."));
    } finally {
      setPendingSide("");
    }
  };

  const submitScore = async (event) => {
    event.preventDefault();
    if (!submissionMode || pendingSide) return;
    const scoreA = Number(score.scoreA);
    const scoreB = Number(score.scoreB);
    if (
      !Number.isInteger(scoreA) || scoreA < 0 || scoreA > 999
      || !Number.isInteger(scoreB) || scoreB < 0 || scoreB > 999
    ) {
      setScoreError("양 팀 점수를 0~999 정수로 입력해 주세요.");
      return;
    }
    setPendingSide("submit");
    setScoreError("");
    try {
      const response = await onSubmitScore({ scoreA, scoreB, playerStats: {} });
      if (response?.ok === false) {
        throw new Error(response.error || response.message || "score_submit_failed");
      }
    } catch (error) {
      setScoreError(String(error?.message || error?.code || "점수를 저장하지 못했습니다."));
    } finally {
      setPendingSide("");
    }
  };

  return (
    <form className="ui-match-score-control-panel" aria-label={label} onSubmit={submitScore}>
      <header>
        <div>
          <strong>{label}</strong>
          <span>{submissionMode ? "점수 입력 완료 후 참가자에게 확인 알림을 보냅니다." : "팀 점수만 저장합니다."}</span>
        </div>
        <Badge tone="neutral">개인 스탯 미기록</Badge>
      </header>
      <div className="ui-match-score-control-grid">
        {[
          { sideName: "teamA", name: match.teamA?.name ?? "A", value: score.scoreA },
          { sideName: "teamB", name: match.teamB?.name ?? "B", value: score.scoreB },
        ].map((side) => (
          <div key={side.sideName} className="ui-match-score-control-side">
            <span>{side.name}</span>
            {submissionMode && editableScoreSides.includes(side.sideName) ? (
              <input
                type="number"
                min="0"
                max="999"
                inputMode="numeric"
                aria-label={`${side.name} 점수`}
                disabled={Boolean(pendingSide)}
                value={side.value}
                onChange={(event) => setScore((current) => ({
                  ...current,
                  [side.sideName === "teamA" ? "scoreA" : "scoreB"]: event.target.value,
                }))}
              />
            ) : <strong>{side.value}</strong>}
            {!submissionMode && editableScoreSides.includes(side.sideName) ? (
              <div className="ui-match-clock-score-actions" aria-label={`${side.name} 점수 조정`}>
                {[-1, 1, 2, 3].map((delta) => (
                  <Button
                    key={delta}
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={Boolean(pendingSide)}
                    onClick={() => void incrementScore(side.sideName, delta)}
                  >
                    {delta > 0 ? `+${delta}` : delta}
                  </Button>
                ))}
              </div>
            ) : !editableScoreSides.includes(side.sideName) ? <small>읽기 전용</small> : null}
          </div>
        ))}
      </div>
      {submissionMode ? (
        <Button type="submit" disabled={Boolean(pendingSide)}>
          {pendingSide === "submit" ? "저장 중" : "점수 입력 완료"}
        </Button>
      ) : null}
      {scoreError ? <p className="ui-match-score-control-error">{scoreError}</p> : null}
    </form>
  );
}
