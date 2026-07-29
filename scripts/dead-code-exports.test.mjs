import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const retiredExportsByModule = new Map([
  ["../src/lib/handles.js", ["getSafeInitial", "findCourtByHashtag"]],
  ["../src/lib/profileIcons.js", ["isSelectableProfileIcon"]],
  ["../src/lib/refereeExamBank.js", ["getRefereeExamSet"]],
  ["../src/lib/recruiting.js", ["getRoomClosePenalty"]],
  ["../src/lib/matchUtils.js", ["getMatchPlayerDisputePoints"]],
  ["../src/lib/constants.js", [
    "DISPUTE_WINDOW_MAX_MINUTES",
    "RECORDABLE_RESERVE_SOURCES",
    "TIER_QUOTES",
  ]],
  ["../src/lib/ratingPolicy.js", ["RATING_POLICY_MODE_IDS"]],
  ["../src/lib/roomFlow.js", ["ROOM_CHANGE_CONSENT_LEAD_HOURS"]],
  ["../src/lib/tier.js", ["getTierQuote"]],
  ["../src/data/repository.js", ["addMatchLatePlayer", "removeMatchLatePlayer"]],
  ["../server/lib/ratingPolicy.js", [
    "RATING_POLICY_FIELDS",
    "cloneRatingPolicy",
    "getRatingPolicyValue",
    "normalizeRatingPolicy",
    "setRatingPolicyValue",
  ]],
]);

test("retired helper exports stay removed", async () => {
  for (const [modulePath, exportNames] of retiredExportsByModule) {
    const module = await import(modulePath);
    exportNames.forEach((exportName) => {
      assert.equal(
        Object.prototype.hasOwnProperty.call(module, exportName),
        false,
        `${modulePath} must not restore ${exportName}`,
      );
    });
  }
});

test("trimmed helper modules keep their active public behavior", async () => {
  const [
    handles,
    profileIcons,
    refereeExamBank,
    recruiting,
    matchUtils,
  ] = await Promise.all([
    import("../src/lib/handles.js"),
    import("../src/lib/profileIcons.js"),
    import("../src/lib/refereeExamBank.js"),
    import("../src/lib/recruiting.js"),
    import("../src/lib/matchUtils.js"),
  ]);

  assert.equal(handles.stripHandle("#Boy Akh"), "boyakh");
  assert.equal(
    handles.findUserByHashtag([{ id: "u1", hashtag: "#box1" }], "#box1")?.id,
    "u1",
  );
  assert.match(handles.getCourtHashtag({ id: "court-1" }), /^#/);

  assert.equal(
    profileIcons.getProfileIcon(profileIcons.DEFAULT_PROFILE_ICON_ID)?.id,
    profileIcons.DEFAULT_PROFILE_ICON_ID,
  );
  assert.equal(
    profileIcons.getProfileIconAchievementState(
      profileIcons.DEFAULT_PROFILE_ICON_ID,
      {},
      [profileIcons.DEFAULT_PROFILE_ICON_ID],
    )?.unlocked,
    true,
  );

  const exam = refereeExamBank.createRefereeExamSet("dead-code-smoke", 3);
  assert.equal(exam.questionIds.length, 3);
  assert.equal(exam.questions.length, 3);
  assert.equal("answerIndex" in exam.questions[0], false);
  assert.equal(
    refereeExamBank.gradeRefereeExamByQuestionIds(exam.questionIds, {}).total,
    3,
  );

  assert.equal(recruiting.getRecruitingRoomOwnerId({ createdBy: "host" }), "host");
  assert.equal(recruiting.isRecruitingRoomOwner({ createdBy: "host" }, "host"), true);

  assert.equal(
    matchUtils.getMatchResultRevision({
      result: { revision: 2, scoreRevisionA: 5, scoreRevisionB: 3 },
    }),
    5,
  );
});

test("retired recorder policy and match actions stay removed", async () => {
  const [{ DEFAULT_RATING_POLICY }, syncMatchSource] = await Promise.all([
    import("../server/lib/ratingPolicy.js"),
    readFile(new URL("../server/api/matches/sync-match.js", import.meta.url), "utf8"),
  ]);

  assert.equal(
    Object.prototype.hasOwnProperty.call(DEFAULT_RATING_POLICY.trust, "candidateRecorderReward"),
    false,
  );
  assert.doesNotMatch(
    syncMatchSource,
    /RETIRED_RECORDER_MATCH_ACTIONS|match_recorder_flow_retired/u,
  );
  [
    "approveMatchRecorderTakeover",
    "cancelMatchRecorderTakeover",
    "rejectMatchRecorderTakeover",
    "requestMatchRecorderTakeover",
    "setMatchDualScoreRecorderSide",
    "handoffMatchRecorder",
  ].forEach((action) => {
    assert.doesNotMatch(syncMatchSource, new RegExp(`["']${action}["']`, "u"));
  });
});

test("unused authoritative wrappers stay removed", async () => {
  const [authoritativeSource, syncMatchSource, recruitingListSource] = await Promise.all([
    readFile(new URL("../server/api/_authoritativeState.js", import.meta.url), "utf8"),
    readFile(new URL("../server/api/matches/sync-match.js", import.meta.url), "utf8"),
    readFile(new URL("../server/api/recruiting/list.js", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(authoritativeSource, /\bapplyAuthoritativeTournamentOperation\b/u);
  assert.doesNotMatch(syncMatchSource, /\bcommitMatchRating\b/u);
  assert.doesNotMatch(recruitingListSource, /\bfetchCurrentUserRecruitingPostIds\b/u);
  assert.doesNotMatch(recruitingListSource, /\bloadLocalRecruitingFeedList\b/u);
});
