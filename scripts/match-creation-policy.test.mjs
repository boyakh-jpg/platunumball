import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MATCH_INTENT_OPTIONS,
  RECORD_COMPOSITION_OPTIONS,
  RECORD_ENTRY_MODE_OPTIONS,
  getMatchCreationPolicyPayload,
  getMatchCreationSummary,
  getMatchCreationValidation,
  getMatchCreationWizardType,
  getMatchIntentChangePatch,
  getMatchIntentPresetPatch,
  getMatchModeChangePatch,
  getModeClockPreset,
  getPersonalRecordDraftPayload,
  getRecordComposition,
  getRecordEntryMode,
  getScopedMatchCreationPolicyPayload,
} from "../src/lib/matchCreationPolicies.js";
import { validatePickupRecruitingShape, validatePickupRecruitingUpdate } from "../server/api/recruiting/sync-post.js";
import { getRecordCreationWindowStatus } from "../src/lib/matchUtils.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("all supported modes keep mode-aware active capacity and presets", () => {
  for (const [mode, expectedOnCourtCount] of [["1v1", 1], ["2v2", 2], ["3v3", 3], ["5v5", 5]]) {
    const patch = getMatchIntentPresetPatch("standard_competitive", mode);
    const policy = getMatchCreationPolicyPayload({ mode, ...patch });
    assert.equal(policy.onCourtCount, expectedOnCourtCount);
    assert.equal(policy.benchCapacity, 2);
    assert.equal(policy.teamCapacity, expectedOnCourtCount + 2);
    assert.equal(patch.playingTimePolicy, "appearance_guaranteed");
  }
});

test("all supported modes allow up to three bench slots through the shared UI option", () => {
  for (const [mode, expectedOnCourtCount] of [["1v1", 1], ["2v2", 2], ["3v3", 3], ["5v5", 5]]) {
    const policy = getMatchCreationPolicyPayload({
      mode,
      ...getMatchIntentPresetPatch("standard_competitive", mode),
      benchCapacity: 3,
    });
    assert.equal(policy.onCourtCount, expectedOnCourtCount);
    assert.equal(policy.benchCapacity, 3);
    assert.equal(policy.teamCapacity, expectedOnCourtCount + 3);
  }

  const wizardSource = fs.readFileSync(path.join(root, "src/components/match/MatchCreationWizard.jsx"), "utf8");
  assert.match(wizardSource, /BENCH_CAPACITY_OPTIONS\.map/);
});

test("small modes preserve target-score defaults while 5v5 uses the community clock", () => {
  for (const mode of ["1v1", "2v2", "3v3"]) {
    const preset = getModeClockPreset(mode);
    assert.equal(preset.endCondition, "target_or_time");
    assert.equal(preset.periodCount, 1);
    assert.equal(preset.targetScore, 21);
    assert.equal(preset.lastPeriodStopMinutes, 0);
  }
  const community = getModeClockPreset("5v5", "community");
  assert.equal(community.periodCount, 4);
  assert.equal(community.periodMinutes, 8);
  assert.equal(community.clockMode, "running");
  assert.equal(community.lastPeriodStopMinutes, 2);
  const official = getModeClockPreset("5v5", "official");
  assert.equal(official.periodMinutes, 10);
  assert.equal(official.clockMode, "stopped");
});

test("pickup preset reuses player rooms without claiming automatic rotation", () => {
  assert.equal(MATCH_INTENT_OPTIONS.some((option) => option.id === "pickup"), true);
  for (const mode of ["1v1", "2v2", "3v3", "5v5"]) {
    const patch = getMatchIntentPresetPatch("pickup", mode);
    const draft = { mode, ...patch, rules: { ...patch } };
    const policy = getMatchCreationPolicyPayload(draft);
    const validation = getMatchCreationValidation(draft);
    const summary = getMatchCreationSummary(draft);

    assert.equal(patch.hostJoinMode, "player");
    assert.equal(patch.teamOnly, false);
    assert.equal(policy.ranked, false);
    assert.equal(policy.official, false);
    assert.equal(policy.playingTimePolicy, "equal_rotation");
    assert.equal(policy.lineupSelectionPolicy, "no_fixed_starter");
    assert.equal(policy.paymentPolicy, "equal_all_confirmed");
    assert.equal(validation.errors.length, 0);
    assert.match(validation.warnings.join(" "), /자동 로테이션은 지원하지 않습니다/);
    assert.match(summary.rows.map((row) => row.value).join(" "), /고정 선발·후보 없음/);
    assert.match(summary.sentence, /수동으로 운영/);
    assert.doesNotThrow(() => validatePickupRecruitingShape(draft));
  }
});

test("pickup validation normalizes stale team and ranked draft values", () => {
  const validation = getMatchCreationValidation({
    mode: "3v3",
    matchIntent: "pickup",
    hostJoinMode: "team",
    teamOnly: true,
    ranked: true,
    official: true,
  });
  assert.equal(validation.policy.hostJoinMode, "player");
  assert.equal(validation.policy.teamOnly, false);
  assert.equal(validation.policy.ranked, false);
  assert.equal(validation.policy.official, false);
  assert.equal(validation.errors.length, 0);
});

test("creation UI exposes only friendly, competitive, and pickup intents", () => {
  assert.deepEqual(MATCH_INTENT_OPTIONS.map((option) => option.id), ["friendly", "standard_competitive", "pickup"]);
});

test("record intent selects record steps before the draft conversion effect", () => {
  assert.equal(getMatchCreationWizardType({ recordType: "match" }, { recordIntent: true }), "match_record");
  assert.equal(getMatchCreationWizardType({ recordType: "match_record" }), "match_record");
  assert.equal(getMatchCreationWizardType({ recordType: "solo" }, { recordIntent: true }), "personal_record");
  assert.equal(getMatchCreationWizardType({ recordType: "match", visibility: "tournament" }), "tournament");
});

test("record entry and composition expose no mixed mode", () => {
  assert.deepEqual(RECORD_ENTRY_MODE_OPTIONS.map((option) => option.id), ["quick", "named"]);
  assert.deepEqual(RECORD_COMPOSITION_OPTIONS.map((option) => option.id), ["individual", "team"]);
  assert.equal(getRecordEntryMode({ recordEntryMode: "named" }), "named");
  assert.equal(getRecordEntryMode({ recordEntryMode: "linked" }), "quick");
  assert.equal(getRecordComposition({ recordComposition: "team" }), "team");
  assert.equal(getRecordComposition({ recordComposition: "mixed" }), "individual");
});

test("personal and shared records accept only the previous 24 hours", () => {
  const now = new Date("2026-07-22T12:00:00.000Z");
  assert.equal(getRecordCreationWindowStatus("2026-07-22", "20:59", now).valid, true);
  assert.equal(getRecordCreationWindowStatus("2026-07-21", "21:00", now).valid, true);
  assert.equal(getRecordCreationWindowStatus("2026-07-21", "20:59", now).reason, "expired");
  assert.equal(getRecordCreationWindowStatus("2026-07-22", "21:01", now).reason, "future");
  assert.equal(getRecordCreationWindowStatus("2026-07-22", "", now).reason, "invalid");
});

test("intent and mode changes preserve unrelated user input", () => {
  const source = {
    mode: "5v5",
    ...getMatchIntentPresetPatch("standard_competitive", "5v5"),
    benchCapacity: 3,
    playingTimePolicy: "none",
    benchPaymentAcknowledged: true,
    venueFee: 50000,
    refereeFee: 10000,
    meetingPoint: "체육관 1층 출입구",
    meetBeforeMinutes: 20,
    attackRule: "커스텀 공격권",
    foulRule: "커스텀 파울",
  };
  const friendly = { ...source, ...getMatchIntentChangePatch(source, "friendly") };
  assert.equal(friendly.benchCapacity, 3);
  assert.equal(friendly.venueFee, 50000);
  assert.equal(friendly.meetingPoint, "체육관 1층 출입구");
  assert.equal(friendly.playingTimePolicy, "appearance_guaranteed");
  assert.equal(friendly.ranked, false);
  assert.equal(friendly.official, false);

  const rotationFriendly = {
    ...source,
    playingTimePolicy: "equal_rotation",
    ...getMatchIntentChangePatch({ ...source, playingTimePolicy: "equal_rotation" }, "friendly"),
  };
  assert.equal(rotationFriendly.playingTimePolicy, "equal_rotation");

  const resized = { ...source, ...getMatchModeChangePatch(source, "3v3") };
  assert.equal(resized.mode, "3v3");
  assert.equal(resized.benchCapacity, 3);
  assert.equal(resized.venueFee, 50000);
  assert.equal(resized.meetingPoint, "체육관 1층 출입구");
  assert.equal(resized.meetBeforeMinutes, 20);
  assert.equal(resized.attackRule, "커스텀 공격권");
  assert.equal(resized.foulRule, "커스텀 파울");
  assert.equal(resized.periodCount, 1);

  const customized = { ...source, periodCount: 2, periodMinutes: 9 };
  const sameMode = { ...customized, ...getMatchModeChangePatch(customized, "5v5") };
  assert.equal(sameMode.periodCount, 2);
  assert.equal(sameMode.periodMinutes, 9);
});

test("pickup server guard rejects team rooms, ranked matches, and false rotation claims", () => {
  const patch = getMatchIntentPresetPatch("pickup", "5v5");
  const draft = { mode: "5v5", ...patch, rules: { ...patch } };
  assert.throws(() => validatePickupRecruitingShape({ ...draft, hostJoinMode: "team", teamId: "team-a" }), /pickup_requires_player_room/);
  assert.throws(() => validatePickupRecruitingShape({ ...draft, ranked: true }), /pickup_must_be_unranked/);
  assert.throws(() => validatePickupRecruitingShape({ ...draft, playingTimePolicy: "appearance_guaranteed" }), /pickup_requires_equal_rotation/);
  assert.throws(() => validatePickupRecruitingShape({ ...draft, lineupSelectionPolicy: "automatic" }), /pickup_requires_no_fixed_starter/);
});

test("pickup room updates cannot bypass player, unranked, or manual rotation invariants", () => {
  const patch = getMatchIntentPresetPatch("pickup", "3v3");
  const existing = {
    mode: "3v3",
    ranked: false,
    official: false,
    rules: { ...patch },
    host_join_mode: "player",
    team_id: null,
    room_state: { teamOnly: false },
  };
  assert.doesNotThrow(() => validatePickupRecruitingUpdate(existing, { targetScore: 15 }));
  assert.throws(() => validatePickupRecruitingUpdate(existing, { ranked: true }), /pickup_must_be_unranked/);
  assert.throws(() => validatePickupRecruitingUpdate(existing, { hostJoinMode: "team" }), /pickup_requires_player_room/);
  assert.throws(() => validatePickupRecruitingUpdate(existing, { matchIntent: "standard_competitive" }), /pickup_intent_cannot_be_removed/);
  assert.throws(() => validatePickupRecruitingUpdate(existing, { playingTimePolicy: "appearance_guaranteed" }), /pickup_requires_equal_rotation/);
  assert.throws(
    () => validatePickupRecruitingUpdate({ ...existing, matchIntent: "standard_competitive", rules: { matchIntent: "standard_competitive" } }, { matchIntent: "pickup" }),
    /pickup_intent_cannot_be_added/,
  );
});

test("zero bench capacity removes bench policy and copy from the final summary", () => {
  const draft = {
    mode: "5v5",
    ...getMatchIntentPresetPatch("standard_competitive", "5v5"),
    benchCapacity: 0,
    playingTimePolicy: "none",
    paymentPolicy: "equal_all_confirmed",
    benchPaymentAcknowledged: false,
    court: "테스트 코트",
  };
  const policy = getMatchCreationPolicyPayload(draft);
  const summary = getMatchCreationSummary(draft);
  assert.equal(policy.requiresBenchPaymentAcknowledgement, false);
  assert.equal(summary.rows.some((row) => row.label === "출전 정책"), false);
  assert.doesNotMatch(summary.sentence, /후보/);
  assert.doesNotMatch(summary.rows.map((row) => row.value).join(" "), /후보/);
});

test("equal payment without playing guarantee requires explicit acknowledgement only when bench exists", () => {
  const draft = {
    mode: "3v3",
    ...getMatchIntentPresetPatch("standard_competitive", "3v3"),
    benchCapacity: 2,
    playingTimePolicy: "none",
    paymentPolicy: "equal_all_confirmed",
    benchPaymentAcknowledged: false,
  };
  assert.match(getMatchCreationValidation(draft).errors.join(" "), /확인/);
  assert.equal(getMatchCreationValidation({ ...draft, benchPaymentAcknowledged: true }).errors.length, 0);
});

test("paid venue requires structured cost", () => {
  const draft = {
    mode: "2v2",
    ...getMatchIntentPresetPatch("friendly", "2v2"),
    venuePaymentType: "paid_reserved",
    venueFee: 0,
  };
  assert.match(getMatchCreationValidation(draft).errors.join(" "), /대관료/);
  assert.match(getMatchCreationValidation({ ...draft, refereeFee: 10000 }).errors.join(" "), /대관료/);
  assert.equal(getMatchCreationValidation({ ...draft, venueFee: 10000 }).errors.length, 0);
});

test("free venue ignores stale venue fee while keeping other costs", () => {
  const policy = getMatchCreationPolicyPayload({
    mode: "3v3",
    ...getMatchIntentPresetPatch("friendly", "3v3"),
    venuePaymentType: "free_public",
    venueFee: 50000,
    refereeFee: 10000,
  });
  assert.equal(policy.venueFee, 0);
  assert.equal(policy.refereeFee, 10000);
  assert.equal(policy.totalCost, 10000);
});

test("record and tournament payloads keep only relevant creation policy", () => {
  const draft = {
    mode: "3v3",
    ...getMatchIntentPresetPatch("standard_competitive", "3v3"),
    venueFee: 50000,
    refereeFee: 10000,
    ballProvider: "venue",
    vestsProvided: true,
  };
  const recordPolicy = getScopedMatchCreationPolicyPayload(draft, "match_record");
  assert.equal(recordPolicy.benchCapacity, 0);
  assert.equal(recordPolicy.onCourtCount, 3);
  assert.equal(recordPolicy.teamCapacity, 3);
  assert.equal(recordPolicy.waitlistCapacity, 0);
  assert.equal("venueFee" in recordPolicy, false);
  assert.equal("paymentPolicy" in recordPolicy, false);
  const tournamentPolicy = getScopedMatchCreationPolicyPayload(draft, "tournament");
  assert.equal(tournamentPolicy.benchCapacity, 2);
  assert.equal(tournamentPolicy.ballProvider, "venue");
  assert.equal(tournamentPolicy.vestsProvided, true);
  assert.equal("venueFee" in tournamentPolicy, false);
  assert.deepEqual(getScopedMatchCreationPolicyPayload(draft, "personal_record"), {});
  const personalDraft = getPersonalRecordDraftPayload({ ...draft, courtFee: "50000", courtReserved: true });
  assert.equal("benchCapacity" in personalDraft, false);
  assert.equal("venueFee" in personalDraft, false);
  assert.equal("courtFee" in personalDraft, false);
  assert.equal("courtReserved" in personalDraft, false);
  assert.equal(personalDraft.mode, "3v3");
});

test("CreateMatch persists bench capacity at top level and inside rules", () => {
  const source = fs.readFileSync(path.join(root, "src/pages/CreateMatch.jsx"), "utf8");
  assert.match(source, /benchCapacity: creationPolicyPayload\.benchCapacity/);
  assert.match(source, /rules:\s*\{[\s\S]*\.\.\.creationPolicyPayload/);
  assert.match(source, /MatchCreationWizardNav/);
  assert.match(source, /wizardStep === finalWizardStep/);
  assert.doesNotMatch(source, /official:\s*true/);
  assert.doesNotMatch(source, /wizardStep === \(isMatchRecordRoom \? 5 : 1\)/);
  const wizardSource = fs.readFileSync(path.join(root, "src/components/match/MatchCreationWizard.jsx"), "utf8");
  assert.doesNotMatch(wizardSource, /\{ id: 6, label: "확인" \}/);
  assert.match(source, /getScopedMatchCreationPolicyPayload\(draft, "match_record"\)/);
  assert.match(source, /getScopedMatchCreationPolicyPayload\(draft, "tournament"\)/);
  assert.match(source, /getDefaultCreateTitle\(draft\.mode, matchIntent\)/);
  assert.match(source, /getMatchCreationWizardType\(draft, \{ recordIntent: isRecordCreateIntent \}\)/);
  assert.match(wizardSource, /step\.id === 4 \? \{ \.\.\.step, label: "구장" \}/);
  const serverSource = fs.readFileSync(path.join(root, "server/api/recruiting/sync-post.js"), "utf8");
  assert.match(serverSource, /validatePickupRecruitingOperation\(context, operation\)/);
  assert.match(serverSource, /rules: \{ \.\.\.\(post\.rules \?\? \{\}\), benchCapacity \}/);
  const schemaSource = fs.readFileSync(path.join(root, "supabase/schema.sql"), "utf8");
  assert.match(schemaSource, /coalesce\(draft->'rules', '\{\}'::jsonb\)/);
  const cssSource = fs.readFileSync(path.join(root, "src/styles/globals.css"), "utf8");
  assert.doesNotMatch(cssSource, /\.match-creation-wizard-nav ol\s*\{[^}]*min-width:\s*720px/);
});
