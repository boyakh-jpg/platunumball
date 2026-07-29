export const HIGH_IMPACT_ADMIN_REVIEW_ACTIONS = Object.freeze([
  "applyCourtCorrection",
  "markCourtDuplicate",
  "maliciousReporter",
  "suspendTarget",
  "refereeDiscipline",
  "hideCourt",
  "hideCourtReview",
  "resetTeamEmblem",
  "renameTeam",
  "renameAffiliation",
  "mergeAffiliation",
  "keepMatchVoid",
  "restoreMatchHalf",
  "restoreMatchFull",
]);

const HIGH_IMPACT_ADMIN_REVIEW_ACTION_SET = new Set(HIGH_IMPACT_ADMIN_REVIEW_ACTIONS);

export function isHighImpactAdminReviewAction(actionType = "") {
  return HIGH_IMPACT_ADMIN_REVIEW_ACTION_SET.has(actionType);
}
