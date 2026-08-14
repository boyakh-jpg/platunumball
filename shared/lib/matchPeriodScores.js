const PERIOD_SCORE_MAX = 999;

function toNullableScore(value) {
  if (value === "" || value === null || value === undefined) return null;
  const score = Number(value);
  return Number.isInteger(score) && score >= 0 && score <= PERIOD_SCORE_MAX ? score : null;
}

function isBlankScore(value) {
  return value === "" || value === null || value === undefined;
}

export function getMatchPeriodScoreLabels(rules = {}) {
  const periodCount = Number(rules?.periodCount ?? 1);
  if (periodCount === 4) return ["1Q", "2Q", "3Q", "4Q", "OT"];
  if (periodCount === 2) return ["1H", "2H", "OT"];
  return ["REG", "OT"];
}

export function normalizeMatchPeriodScores(source = [], rules = {}) {
  const allowedLabels = new Set(getMatchPeriodScoreLabels(rules));
  const items = Array.isArray(source) ? source : [];
  const byLabel = new Map(items.map((item) => [String(item?.label ?? "").toUpperCase(), item]));
  return [...allowedLabels].map((label) => {
    const item = byLabel.get(label) ?? {};
    return {
      label,
      scoreA: toNullableScore(item.scoreA),
      scoreB: toNullableScore(item.scoreB),
    };
  });
}

export function validateMatchPeriodScores(source = [], rules = {}, totals = {}) {
  if (!Array.isArray(source)) {
    return { valid: false, periodScores: [], error: "구간별 점수 형식이 올바르지 않습니다." };
  }
  const labels = getMatchPeriodScoreLabels(rules);
  if (source.length > labels.length) {
    return { valid: false, periodScores: [], error: "구간별 점수 개수가 경기 규칙과 맞지 않습니다." };
  }
  const populated = [];
  let blankStarted = false;
  for (const [index, item] of source.entries()) {
    const label = String(item?.label ?? "").toUpperCase();
    if (label !== labels[index]) {
      return { valid: false, periodScores: [], error: "구간별 점수 순서가 경기 규칙과 맞지 않습니다." };
    }
    const scoreABlank = isBlankScore(item?.scoreA);
    const scoreBBlank = isBlankScore(item?.scoreB);
    if (scoreABlank && scoreBBlank) {
      blankStarted = true;
      continue;
    }
    if (blankStarted) {
      return { valid: false, periodScores: [], error: "구간별 점수는 첫 구간부터 순서대로 입력해 주세요." };
    }
    if (scoreABlank || scoreBBlank) {
      return { valid: false, periodScores: [], error: "구간별 점수는 TEAM A와 TEAM B를 함께 입력해 주세요." };
    }
    const scoreA = toNullableScore(item.scoreA);
    const scoreB = toNullableScore(item.scoreB);
    if (scoreA === null || scoreB === null) {
      return { valid: false, periodScores: [], error: `구간별 점수는 0~${PERIOD_SCORE_MAX} 정수로 입력해 주세요.` };
    }
    populated.push({ label, scoreA, scoreB });
  }
  if (!populated.length) return { valid: true, periodScores: [] };
  const scoreA = populated.reduce((sum, item) => sum + item.scoreA, 0);
  const scoreB = populated.reduce((sum, item) => sum + item.scoreB, 0);
  if (scoreA !== Number(totals.scoreA) || scoreB !== Number(totals.scoreB)) {
    return { valid: false, periodScores: populated, error: "구간별 점수 합계가 최종 점수와 같아야 합니다." };
  }
  return { valid: true, periodScores: populated };
}
