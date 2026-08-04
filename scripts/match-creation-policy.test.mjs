import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CREATE_MATCH_PAGE_SOURCE_PATHS,
  RECRUITING_PAGE_SOURCE_PATHS,
  readSourceGroupSync,
} from "./management-source-groups.mjs";
import {
  MATCH_FORMATION_OPTIONS,
  MATCH_INTENT_OPTIONS,
  MATCH_PURPOSE_OPTIONS,
  PICKUP_TEAM_ASSIGNMENT_MODE_OPTIONS,
  RECORD_COMPOSITION_OPTIONS,
  RECORD_ENTRY_MODE_OPTIONS,
  getMatchCreationPolicyPayload,
  getMatchCreationSummary,
  getMatchOperationsSummaryRows,
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
import {
  normalizePickupRecruitingOperation,
  validatePickupRecruitingShape,
  validatePickupRecruitingUpdate,
} from "../server/api/recruiting/sync-post.js";
import {
  canOperateAssignedMatchReferee,
  getRecordCreationWindowStatus,
  isEligibleReferee,
} from "../src/lib/matchUtils.js";
import {
  MATCH_CLOCK_FORCE_END_MINUTES,
  MATCH_MAX_REGULATION_MINUTES,
  getMatchClockLabel,
  getMatchPeriodMinutesMax,
  getMatchRuleDetailRows,
  getMatchRuleInputValidation,
  getMatchRulesPayload,
  normalizeMatchRules,
} from "../src/lib/matchRules.js";
import {
  acceptRecruitingInvitation,
  confirmRecruitingMatch,
  configureServerRatingAuthority,
  createRecruitingPost,
  declineRecruitingInvitation,
  interestRecruitingPost,
  inviteRecruitingPlayers,
  joinRecruitingSideParty,
  setRecruitingApplicantPlacement,
  setRecruitingRoomTeam,
} from "../src/data/repository.js";
import { SERVER_RATING_AUTHORITY } from "../server/lib/ratingAuthority.js";
import {
  MMR_RANGE_POLICIES,
  getRecruitingMmrBalancedPlacement,
  getRecruitingLobby,
  getSideMmrBalance,
  isIndividualOnlyRecruitingRoom,
  normalizeRecruitingMmrRangeMode,
} from "../src/lib/recruiting.js";
import { getTeamChallengeEligibilityPolicy } from "../src/lib/createMatchPage.js";

configureServerRatingAuthority(SERVER_RATING_AUTHORITY);

test("공개 개인 경쟁전은 평균과 사이드 내부 MMR 폭을 함께 제한한다", () => {
  const users = Object.fromEntries([
    ["host", 1200], ["low", 1000], ["high", 1400], ["mid", 1200],
  ].map(([id, mmr]) => [id, { id, ratings: { integrated: mmr } }]));
  const hiddenSpread = getSideMmrBalance({ teamA: ["low", "high"], teamB: ["host", "mid"] }, users, "normal");
  assert.equal(hiddenSpread.averageGap, 0);
  assert.equal(hiddenSpread.sides.teamA.spread, 400);
  assert.equal(hiddenSpread.allowed, false);

  const post = { visibility: "public", ranked: true, hostJoinMode: "player", mmrRangeMode: "normal", benchCapacity: 2 };
  const lobby = { sides: {
    teamA: { players: ["host"], filled: 1, capacity: 2, reserveCandidates: [] },
    teamB: { players: ["low"], filled: 1, capacity: 2, reserveCandidates: [] },
  } };
  const placement = getRecruitingMmrBalancedPlacement(post, lobby, users, ["high"]);
  assert.equal(placement.side, "teamA");
  assert.equal(placement.reserve, true);
});

test("방장과 참가자의 사이드 이동은 같은 MMR 균형 규칙을 쓴다", () => {
  const post = {
    id: "balanced-room",
    title: "균형 방",
    status: "open",
    visibility: "public",
    ranked: true,
    hostJoinMode: "player",
    hostSide: "teamA",
    playerId: "host",
    mode: "3v3",
    sideCapacity: 3,
    benchCapacity: 1,
    mmrRangeMode: "normal",
    roomState: {},
    applicants: [
      { kind: "player", playerId: "high", side: "teamA", status: "ready", reserve: false },
      { kind: "player", playerId: "low", side: "teamB", status: "ready", reserve: false },
      { kind: "player", playerId: "mid", side: "teamB", status: "ready", reserve: false },
    ],
  };
  const users = [
    { id: "host", ratings: { integrated: 1200 } },
    { id: "high", ratings: { integrated: 1400 } },
    { id: "low", ratings: { integrated: 1100 } },
    { id: "mid", ratings: { integrated: 1300 } },
  ];
  const state = { currentUserId: "host", users, teams: [], recruitingPosts: [post], notifications: [] };
  const blocked = setRecruitingApplicantPlacement(state, post.id, "high", { side: "teamB", reserve: false });
  assert.equal(blocked.recruitingPosts[0], post);
  assert.equal(blocked.notifications[0].title, "MMR 균형 이동 불가");

  const moved = setRecruitingApplicantPlacement({ ...state, currentUserId: "mid" }, post.id, "mid", { side: "teamA", reserve: false });
  assert.equal(moved.recruitingPosts[0].applicants.find((applicant) => applicant.playerId === "mid").side, "teamA");
});

test("라이벌 매치는 출전 인원을 채우는 최소 MMR·연령 범위를 고른다", () => {
  const makeTeam = (id, prefix, mmrs) => ({
    id,
    mmr: 1200,
    members: mmrs.map((_, index) => ({ userId: `${prefix}${index + 1}`, role: index === 0 ? "captain" : "member" })),
  });
  const makeUsers = (prefix, mmrs) => mmrs.map((mmr, index) => ({
    id: `${prefix}${index + 1}`,
    ageGroup: "open",
    ratings: { integrated: mmr },
  }));
  const teamA = makeTeam("team-a", "a", [1200, 1300, 1400, 1600, 1700]);
  const teamB = makeTeam("team-b", "b", [1200, 1300, 1400, 1600, 1700]);
  const users = [...makeUsers("a", [1200, 1300, 1400, 1600, 1700]), ...makeUsers("b", [1200, 1300, 1400, 1600, 1700])];

  const policy = getTeamChallengeEligibilityPolicy({ teamA, teamB, users, capacity: 3, currentUserId: "a1", ranked: true });
  assert.equal(policy?.mmrRangeMode, "normal");
  assert.equal(policy?.mmrLimitMode, "block");
  assert.equal(policy?.ageRestriction, "open");

  const narrowUsers = users.map((user) => ({ ...user, ratings: { integrated: user.id.endsWith("3") ? 1310 : 1200 } }));
  assert.equal(getTeamChallengeEligibilityPolicy({ teamA, teamB, users: narrowUsers, capacity: 3, currentUserId: "a1", ranked: true })?.mmrRangeMode, "narrow");

  const distantUsers = users.map((user) => ({ ...user, ratings: { integrated: user.id.endsWith("1") ? 1200 : 1800 } }));
  assert.equal(getTeamChallengeEligibilityPolicy({ teamA, teamB, users: distantUsers, capacity: 3, currentUserId: "a1", ranked: true })?.mmrLimitMode, "off");
});

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readPageSourceGroup = (paths) => readSourceGroupSync(
  (file) => fs.readFileSync(path.join(root, file), "utf8"),
  paths,
);
const readCssTreeSync = (file, visited = new Set()) => {
  const absolutePath = path.resolve(root, file);
  if (visited.has(absolutePath)) return "";
  visited.add(absolutePath);
  const source = fs.readFileSync(absolutePath, "utf8");
  const imports = [...source.matchAll(/@import\s+["']([^"']+\.css)["'];/g)];
  return [
    source,
    ...imports.map((match) => readCssTreeSync(path.join(path.dirname(file), match[1]), visited)),
  ].join("\n");
};
const pickupRefereeMigrationSource = fs.readFileSync(
  path.join(root, "supabase/migrations/20260725011000_preserve_pickup_referee_interest.sql"),
  "utf8",
);
const pickupRefereeWrapperMigrationSource = fs.readFileSync(
  path.join(root, "supabase/migrations/20260727093000_preserve_pickup_referee_self_interest.sql"),
  "utf8",
);
const publicTeamRepresentativeMigrationSource = fs.readFileSync(
  path.join(root, "supabase/migrations/20260725019000_public_team_representative_guard.sql"),
  "utf8",
);
const publicTeamRepresentativeApplicationMigrationSource = fs.readFileSync(
  path.join(root, "supabase/migrations/20260725021000_allow_team_representative_application.sql"),
  "utf8",
);
const teamMemberSideLeaderMigrationSource = fs.readFileSync(
  path.join(root, "supabase/migrations/20260728120000_team_member_side_leader_team_selection.sql"),
  "utf8",
);
const teamMemberPublicJoinMigrationSource = fs.readFileSync(
  path.join(root, "supabase/migrations/20260728121000_team_member_public_side_leader_join.sql"),
  "utf8",
);
const teamMemberPostGuardMigrationSource = fs.readFileSync(
  path.join(root, "supabase/migrations/20260728122000_team_member_room_post_guard.sql"),
  "utf8",
);
const declinedTeamInvitationMigrationSource = fs.readFileSync(
  path.join(root, "supabase/migrations/20260731010000_release_declined_team_invitation.sql"),
  "utf8",
);

function readCssManifest(relativePath) {
  return readCssTreeSync(relativePath);
}

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
  assert.equal(getMatchModeChangePatch({ mode: "3v3", gameClockEnabled: false }, "5v5").gameClockEnabled, false);
});

test("match rule number inputs stay editable and enforce the 70 percent regulation limit", () => {
  assert.equal(MATCH_CLOCK_FORCE_END_MINUTES, 90);
  assert.equal(MATCH_MAX_REGULATION_MINUTES, 63);
  assert.equal(getMatchPeriodMinutesMax(1), 63);
  assert.equal(getMatchPeriodMinutesMax(2), 31);
  assert.equal(getMatchPeriodMinutesMax(4), 15);

  const emptyTarget = getMatchRuleInputValidation({
    mode: "3v3",
    endCondition: "target_or_time",
    targetScore: "",
    periodCount: 1,
    periodMinutes: 12,
    overtimeMinutes: 3,
  });
  assert.equal(emptyTarget.valid, false);
  assert.equal(emptyTarget.fieldMessages.targetScore, "필수");

  const oversizedPeriod = getMatchRuleInputValidation({
    mode: "5v5",
    endCondition: "time",
    periodCount: 4,
    periodMinutes: "16",
    periodBreakMinutes: 2,
    halftimeMinutes: 10,
    overtimeMinutes: 5,
    clockMode: "stopped",
  });
  assert.equal(oversizedPeriod.valid, false);
  assert.equal(oversizedPeriod.fieldMessages.periodMinutes, "전체 최대 63분");
  assert.match(oversizedPeriod.errors.join(" "), /63분/);

  const normalized = normalizeMatchRules({ mode: "5v5", periodCount: 4, periodMinutes: 60 }, { mode: "5v5" });
  assert.equal(normalized.periodMinutes, 15);
  assert.equal(normalized.timeLimit, 60);

  const selectorSource = fs.readFileSync(path.join(root, "src/components/match/RuleSelector.jsx"), "utf8");
  assert.match(selectorSource, /updateNumber\("targetScore", event\.target\.value\)/);
  assert.doesNotMatch(selectorSource, /updateRules\(\{ targetScore: event\.target\.value \}\)/);
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
    assert.match(validation.warnings.join(" "), /팀 배치/);
    assert.equal(summary.rows.find((row) => row.label === "팀 배치")?.value, "출석 후 현장 결정");
    assert.match(summary.sentence, /현장에서 팀 배치 방식을 정합니다/);
    assert.doesNotThrow(() => validatePickupRecruitingShape(draft));
  }
});

test("legacy pickup assignment mode is preserved without locking the creation summary", () => {
  assert.deepEqual(
    PICKUP_TEAM_ASSIGNMENT_MODE_OPTIONS.map((option) => option.id),
    ["manual", "random", "mmr_balanced"],
  );
  for (const option of PICKUP_TEAM_ASSIGNMENT_MODE_OPTIONS) {
    const draft = {
      mode: "3v3",
      ...getMatchIntentPresetPatch("pickup", "3v3"),
      pickupTeamAssignmentMode: option.id,
    };
    const policy = getMatchCreationPolicyPayload(draft);
    const summary = getMatchCreationSummary(draft);
    assert.equal(policy.pickupTeamAssignmentMode, option.id);
    assert.equal(summary.rows.find((row) => row.label === "팀 배치")?.value, "출석 후 현장 결정");
    assert.match(summary.sentence, /현장에서 팀 배치 방식을 정합니다/);
  }
});

test("pickup validation normalizes stale team values while preserving an explicit competitive purpose", () => {
  const validation = getMatchCreationValidation({
    mode: "3v3",
    matchIntent: "pickup",
    matchPurpose: "competitive",
    hostJoinMode: "team",
    teamOnly: true,
    ranked: true,
    official: true,
  });
  assert.equal(validation.policy.hostJoinMode, "player");
  assert.equal(validation.policy.teamOnly, false);
  assert.equal(validation.policy.ranked, true);
  assert.equal(validation.policy.official, false);
  assert.equal(validation.errors.length, 0);
});

test("pickup creation ignores stale team state in the real reducer", () => {
  const pickupPatch = getMatchIntentPresetPatch("pickup", "3v3");
  const state = {
    currentUserId: "pickup-host",
    users: [{
      id: "pickup-host",
      name: "픽업 방장",
      region: "서울특별시",
      trustScore: 100,
      ratings: { integrated: 1200 },
    }],
    teams: [],
    settings: {},
    recruitingPosts: [],
    notifications: [],
  };
  const next = createRecruitingPost(state, {
    mode: "3v3",
    sideCapacity: 3,
    visibility: "private",
    timingType: "instant",
    hostJoinMode: "team",
    teamOnly: true,
    teamId: "stale-team",
    ranked: true,
    official: true,
    ...pickupPatch,
    rules: { ...pickupPatch },
  });
  const post = next.recruitingPosts[0];

  assert.ok(post);
  assert.equal(post.hostJoinMode, "player");
  assert.equal(post.teamOnly, false);
  assert.equal(post.teamId, null);
  assert.equal(post.ranked, false);
  assert.equal(post.official, false);
  assert.equal(post.rules.matchIntent, "pickup");
  assert.equal(next.notifications.some((item) => /팀/.test(item.title) && /필요|제한/.test(item.title)), false);
});

test("pickup invitations and joins stay individual even when a team id is submitted", () => {
  const post = {
    id: "pickup-room",
    title: "3v3 픽업",
    status: "open",
    mode: "3v3",
    sideCapacity: 3,
    benchCapacity: 3,
    visibility: "public",
    playerId: "host",
    hostSide: "teamA",
    hostJoinMode: "player",
    ranked: false,
    official: false,
    rules: { ...getMatchIntentPresetPatch("pickup", "3v3") },
    roomState: { ownerId: "host", invitations: [] },
    applicants: [],
  };
  const baseState = {
    currentUserId: "host",
    users: [
      { id: "host", name: "방장", trustScore: 100, ratings: { integrated: 1200 } },
      { id: "invitee", name: "초대 선수", trustScore: 100, ratings: { integrated: 1200 } },
    ],
    teams: [{ id: "team-a", name: "등록팀", mmr: 1200, members: [{ userId: "host" }, { userId: "invitee" }] }],
    recruitingPosts: [post],
    notifications: [],
    settings: {},
  };
  const invitedState = inviteRecruitingPlayers(baseState, post.id, {
    side: "teamA",
    playerIds: ["invitee"],
    joinMode: "team",
    teamId: "team-a",
  });
  const invitation = invitedState.recruitingPosts[0].roomState.invitations[0];
  assert.equal(invitation.joinMode, "player");
  assert.equal(invitation.teamId, null);
  assert.equal(invitation.side, null);

  const acceptedState = acceptRecruitingInvitation(
    { ...invitedState, currentUserId: "invitee" },
    post.id,
    invitation.id,
  );
  const applicant = acceptedState.recruitingPosts[0].applicants[0];
  assert.equal(applicant.kind, "player");
  assert.equal(applicant.teamId, null);
  assert.equal(applicant.side, "teamB");
});

test("filling every player slot expires remaining player invitations but keeps referee invitations", () => {
  const post = {
    id: "filled-invite-room",
    title: "1v1 초대방",
    status: "open",
    mode: "1v1",
    sideCapacity: 1,
    benchCapacity: 0,
    visibility: "private",
    playerId: "host",
    hostSide: "teamA",
    hostJoinMode: "player",
    hostReady: true,
    ranked: false,
    official: false,
    roomState: {
      ownerId: "host",
      invitations: [
        { id: "accepted", role: "player", targetUserId: "invitee", side: "teamB", status: "pending" },
        { id: "waiting", role: "player", targetUserId: "waiting", side: "teamB", status: "pending" },
        { id: "referee", role: "referee", targetUserId: "referee", status: "pending" },
      ],
    },
    applicants: [],
  };
  const state = {
    currentUserId: "invitee",
    users: ["host", "invitee", "waiting", "referee"].map((id) => ({
      id,
      name: id,
      trustScore: 100,
      ratings: { integrated: 1200 },
    })),
    teams: [],
    recruitingPosts: [post],
    notifications: [],
    settings: {},
  };

  const acceptedState = acceptRecruitingInvitation(state, post.id, "accepted");
  const invitations = acceptedState.recruitingPosts[0].roomState.invitations;
  assert.equal(invitations.find((item) => item.id === "accepted"), undefined);
  assert.equal(invitations.find((item) => item.id === "waiting")?.status, "expired");
  assert.equal(invitations.find((item) => item.id === "referee")?.status, "pending");
  assert.ok(invitations.find((item) => item.id === "waiting")?.updatedAt);
  assert.ok(acceptedState.recruitingPosts[0].roomState.playerCapacityFilledAt);
  assert.equal(
    acceptedState.notifications.some((item) => (
      item.targetUserId === "waiting"
      && item.title === "초대 종료"
      && item.body.includes("슬롯이 모두 찼습니다")
    )),
    true,
  );
  assert.equal(
    acceptedState.notifications.some((item) => (
      item.targetUserId === "host"
      && item.title === "방 정원 충족"
      && item.body.includes("경기를 확정")
    )),
    true,
  );
  assert.equal(
    acceptedState.notifications.some((item) => (
      item.targetUserId === "referee"
      && item.title === "초대 종료"
    )),
    false,
  );
});

test("pickup lobby expands a legacy team party into independent player slots", () => {
  const post = {
    id: "legacy-pickup",
    mode: "3v3",
    sideCapacity: 3,
    benchCapacity: 3,
    playerId: "host",
    hostSide: "teamA",
    hostJoinMode: "player",
    hostReady: true,
    rules: { ...getMatchIntentPresetPatch("pickup", "3v3") },
    roomState: {
      partyLeaders: { "team:team-a": "p1" },
      partySides: { "team:team-a": "teamA" },
      partyReserves: { "team:team-a": ["p3"] },
    },
    applicants: [{
      kind: "team",
      joinMode: "team",
      playerId: "p1",
      playerIds: ["p1", "p2"],
      teamId: "team-a",
      side: "teamA",
      status: "ready",
      reserve: false,
    }],
  };
  const state = {
    users: ["host", "p1", "p2", "p3"].map((id) => ({ id, name: id, ratings: { integrated: 1200 } })),
    teams: [{ id: "team-a", name: "등록팀", mmr: 1200, members: ["p1", "p2", "p3"].map((userId) => ({ userId })) }],
  };
  const lobby = getRecruitingLobby(post, state);
  assert.equal(isIndividualOnlyRecruitingRoom(post), true);
  assert.deepEqual(lobby.sides.teamA.projectedPlayers.sort(), ["host", "p1", "p2"].sort());
  assert.deepEqual(lobby.sides.teamA.reserveCandidates.map((item) => item.playerId), ["p3"]);
  assert.equal(lobby.entries.some((entry) => entry.kind === "team" || entry.teamId), false);
});

test("pickup API normalizes team payloads and blocks party mutations", () => {
  const post = { rules: { matchIntent: "pickup" } };
  const invite = normalizePickupRecruitingOperation(post, {
    action: "inviteRecruitingPlayers",
    invite: { playerIds: ["p1", "p2"], joinMode: "team", teamId: "team-a", side: "teamA" },
  });
  assert.equal(invite.invite.joinMode, "player");
  assert.equal(invite.invite.teamId, "");

  const join = normalizePickupRecruitingOperation(post, {
    action: "interestRecruitingPost",
    joinMode: "team",
    application: { joinMode: "team", teamId: "team-a", side: "teamB" },
  });
  assert.equal(join.joinMode, "player");
  assert.equal(join.application.joinMode, "player");
  assert.equal(join.application.teamId, "");

  const refereeJoin = normalizePickupRecruitingOperation(post, {
    action: "interestRecruitingPost",
    joinMode: "referee",
    application: { joinMode: "referee" },
  });
  assert.equal(refereeJoin.joinMode, "referee");
  assert.equal(refereeJoin.application.joinMode, "referee");
  assert.match(
    pickupRefereeMigrationSource,
    /normalized_operation #>> '\{application,joinMode\}'[\s\S]*?<> 'referee'/,
  );
  assert.match(
    pickupRefereeWrapperMigrationSource,
    /rankball_recruiting_management_action\(text,jsonb\)[\s\S]*?normalized_operation #>> '\{application,joinMode\}'[\s\S]*?<> 'referee'/,
  );
  assert.throws(
    () => normalizePickupRecruitingOperation(post, { action: "setRecruitingTeamPartyRoster" }),
    /pickup_party_not_allowed/,
  );
});

test("stored room rules drive pickup policy and the full modal rule summary", () => {
  const storedPost = {
    mode: "5v5",
    ranked: false,
    hostJoinMode: "player",
    teamOnly: false,
    rules: {
      ...getMatchIntentPresetPatch("pickup", "5v5"),
      periodCount: 4,
      periodMinutes: 8,
      periodBreakMinutes: 2,
      halftimeMinutes: 7,
      overtimeMinutes: 4,
      clockMode: "running",
      lastPeriodStopMinutes: 2,
      endCondition: "time",
      ball: "6호 공",
    },
  };
  const policy = getMatchCreationPolicyPayload(storedPost);
  const summary = getMatchCreationSummary(storedPost);
  const ruleRows = getMatchRuleDetailRows(storedPost.rules, storedPost.mode);

  assert.equal(policy.matchIntent, "pickup");
  assert.equal(policy.hostJoinMode, "player");
  assert.equal(policy.teamOnly, false);
  assert.equal(policy.lastPeriodStopMinutes, 2);
  assert.equal(summary.rows.find((row) => row.label === "팀 배치")?.value, "출석 후 현장 결정");
  assert.match(summary.rows.find((row) => row.label === "명단")?.value ?? "", /개인 참가/);
  assert.doesNotMatch(summary.rows.map((row) => row.value).join(" "), /사이드당 참가/);
  assert.match(summary.rows.find((row) => row.label === "경기 규칙")?.value ?? "", /마지막 2분 스톱/);
  assert.equal(ruleRows.find((row) => row.label === "휴식")?.value, "쿼터 사이 2분 · 하프타임 7분");
  assert.equal(ruleRows.find((row) => row.label === "연장")?.value, "4분");
  assert.equal(ruleRows.find((row) => row.label === "사용 공")?.value, "6호 공");
  assert.equal(getMatchRulesPayload(storedPost.rules, { mode: storedPost.mode }).lastPeriodStopMinutes, 2);
});

test("creation policy separates match purpose from team formation", () => {
  assert.deepEqual(MATCH_INTENT_OPTIONS.map((option) => option.id), ["friendly", "standard_competitive", "pickup"]);
  assert.deepEqual(MATCH_PURPOSE_OPTIONS.map((option) => option.id), ["friendly", "competitive"]);
  assert.deepEqual(MATCH_FORMATION_OPTIONS.map((option) => option.id), ["prearranged", "pickup"]);
  assert.equal(MATCH_PURPOSE_OPTIONS.some((option) => /출전/.test(option.description)), false);
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
  assert.equal(friendly.playingTimePolicy, "none");
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

test("pickup server guard allows competitive MMR but rejects team rooms, official flags, and false rotation claims", () => {
  const patch = getMatchIntentPresetPatch("pickup", "5v5");
  const draft = { mode: "5v5", ...patch, rules: { ...patch } };
  assert.throws(() => validatePickupRecruitingShape({ ...draft, hostJoinMode: "team", teamId: "team-a" }), /pickup_requires_player_room/);
  assert.doesNotThrow(() => validatePickupRecruitingShape({ ...draft, ranked: true, official: false }));
  assert.throws(() => validatePickupRecruitingShape({ ...draft, official: true }), /pickup_official_not_supported/);
  assert.throws(() => validatePickupRecruitingShape({ ...draft, playingTimePolicy: "appearance_guaranteed" }), /pickup_requires_equal_rotation/);
  assert.throws(() => validatePickupRecruitingShape({ ...draft, lineupSelectionPolicy: "automatic" }), /pickup_requires_no_fixed_starter/);
});

test("pickup room updates cannot bypass player or rotation invariants", () => {
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
  assert.doesNotThrow(() => validatePickupRecruitingUpdate(existing, { ranked: true }));
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

test("match cost inputs keep an empty editing value instead of restoring normalized zero", () => {
  const wizardSource = fs.readFileSync(path.join(root, "src/components/match/MatchCreationWizard.jsx"), "utf8");
  assert.match(wizardSource, /const getMoneyInputValue = \(fieldName\) => draft\[fieldName\] \?\? policy\[fieldName\]/);
  for (const fieldName of ["refereeFee", "recordingFee", "equipmentFee", "otherFee"]) {
    assert.match(wizardSource, new RegExp(`value=\\{getMoneyInputValue\\("${fieldName}"\\)\\}`));
  }
  assert.match(wizardSource, /value=\{freeVenue \? policy\.venueFee : getMoneyInputValue\("venueFee"\)\}/);
  assert.doesNotMatch(wizardSource, /value=\{policy\.(?:venueFee|refereeFee|recordingFee|equipmentFee|otherFee)\}\s+onChange/);
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
  const teamRecordPolicy = getScopedMatchCreationPolicyPayload({
    ...draft,
    recordComposition: "team",
  }, "match_record");
  assert.equal(teamRecordPolicy.benchCapacity, 3);
  assert.equal(teamRecordPolicy.teamCapacity, 6);
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

test("room operations keep only the clock, ball, and mode-relevant vest choices", () => {
  assert.equal(normalizeMatchRules({ gameClockEnabled: false }, { mode: "3v3" }).gameClockEnabled, false);
  assert.equal(getMatchClockLabel({ gameClockEnabled: false }, "3v3"), "사용 안 함");
  assert.match(getMatchClockLabel({ gameClockEnabled: true, clockMode: "running" }, "3v3"), /^사용 · 러닝타임/);

  assert.deepEqual(
    getMatchOperationsSummaryRows({
      mode: "3v3",
      ballProvider: "venue",
      vestsProvided: true,
      scoreboardAvailable: false,
      shotClockAvailable: true,
      statRecorderAvailable: false,
    }),
    [
      { label: "공 준비", value: "구장 제공" },
      { label: "조끼", value: "제공" },
    ],
  );

  const summary = getMatchCreationSummary({
    mode: "1v1",
    ballProvider: "participant",
    vestsProvided: true,
    scoreboardAvailable: true,
    shotClockAvailable: false,
    statRecorderAvailable: true,
  });
  assert.equal(summary.rows.find((row) => row.label === "공 준비")?.value, "참가자 제공");
  assert.equal(summary.rows.some((row) => row.label === "조끼"), false);
  assert.equal(summary.rows.some((row) => row.label === "운영 장비"), false);
  assert.equal(getMatchCreationPolicyPayload({ mode: "1v1", vestsProvided: true }).vestsProvided, false);
});

test("general prearranged matches keep only three MMR ranges and force the limit mode", () => {
  assert.deepEqual(Object.keys(MMR_RANGE_POLICIES), ["narrow", "normal", "wide"]);
  assert.ok(Object.values(MMR_RANGE_POLICIES).every((policy) => !Object.hasOwn(policy, "ratingScale")));
  assert.equal(normalizeRecruitingMmrRangeMode("standard"), "normal");

  const state = {
    currentUserId: "host",
    users: [{ id: "host", name: "방장", region: "마포", trustScore: 100, ratings: { integrated: 1200 } }],
    teams: [],
    settings: {},
    recruitingPosts: [],
    notifications: [],
  };
  const baseDraft = {
    mode: "1v1",
    sideCapacity: 1,
    visibility: "public",
    timingType: "instant",
    hostJoinMode: "player",
    formationMode: "prearranged",
    matchPurpose: "competitive",
    ranked: true,
    mmrRangeMode: "standard",
    mmrLimitMode: "off",
    rules: { formationMode: "prearranged", matchPurpose: "competitive" },
  };
  const competitive = createRecruitingPost(state, baseDraft).recruitingPosts[0];
  assert.equal(competitive.mmrRangeMode, "normal");
  assert.equal(competitive.mmrLimitMode, "block");
  assert.equal(competitive.roomState.mmrLimitMode, "block");
  assert.equal(competitive.rules.mmrLimitMode, "block");

  const friendly = createRecruitingPost(state, {
    ...baseDraft,
    matchPurpose: "friendly",
    ranked: false,
    mmrLimitMode: "block",
    rules: { formationMode: "prearranged", matchPurpose: "friendly" },
  }).recruitingPosts[0];
  assert.equal(friendly.mmrLimitMode, "off");
  assert.equal(friendly.roomState.mmrLimitMode, "off");
  assert.equal(friendly.rules.mmrLimitMode, "off");
});

test("empty team rooms select teams only through the central reducer", () => {
  const users = [
    { id: "host", name: "방장", region: "마포", trustScore: 100, ageGroup: "open", ratings: { integrated: 1200 } },
    { id: "captain-a", name: "A팀장", region: "마포", trustScore: 100, ageGroup: "open", ratings: { integrated: 1200 } },
    { id: "captain-b", name: "B팀장", region: "마포", trustScore: 100, ageGroup: "open", ratings: { integrated: 1210 } },
  ];
  const teams = [
    {
      id: "team-a",
      name: "A팀",
      mmr: 1200,
      members: [
        { userId: "captain-a", role: "captain" },
        { userId: "host", role: "regular" },
      ],
    },
    { id: "team-b", name: "B팀", mmr: 1210, members: [{ userId: "captain-b", role: "captain" }] },
    { id: "team-no-captain", name: "주장없음", mmr: 1200, members: [] },
  ];
  const state = {
    currentUserId: "host",
    users,
    teams,
    settings: {},
    recruitingPosts: [],
    notifications: [],
  };
  const created = createRecruitingPost(state, {
    title: "빈 비공개 팀방",
    mode: "1v1",
    sideCapacity: 1,
    visibility: "private",
    timingType: "instant",
    hostJoinMode: "team",
    teamOnly: true,
    formationMode: "prearranged",
    matchPurpose: "competitive",
    ranked: true,
    mmrRangeMode: "normal",
    rules: { formationMode: "prearranged", matchPurpose: "competitive", teamOnly: true },
  });
  const emptyPost = created.recruitingPosts[0];
  assert.ok(emptyPost);
  assert.equal(emptyPost.hostJoinMode, "team");
  assert.equal(emptyPost.teamOnly, true);
  assert.equal(emptyPost.teamId, null);
  assert.equal(emptyPost.targetTeamId, null);
  assert.deepEqual(emptyPost.playerIds, []);
  assert.deepEqual(emptyPost.roomState.invitations, []);

  const joinedBeforeTeamSelection = interestRecruitingPost(
    { ...created, currentUserId: "captain-b" },
    emptyPost.id,
    { joinMode: "team", teamId: "team-b", side: "teamB" },
  );
  assert.deepEqual(joinedBeforeTeamSelection.recruitingPosts[0].applicants, []);
  const confirmedBeforeTeamSelection = confirmRecruitingMatch(created, emptyPost.id);
  assert.equal(confirmedBeforeTeamSelection.recruitingPosts[0].status, "open");
  assert.equal(confirmedBeforeTeamSelection.recruitingPosts.length, 1);

  const beforeA = setRecruitingRoomTeam(created, emptyPost.id, "teamB", "team-b");
  assert.equal(beforeA.recruitingPosts[0].targetTeamId, null);
  const withA = setRecruitingRoomTeam(created, emptyPost.id, "teamA", "team-a");
  assert.equal(withA.recruitingPosts[0].teamId, "team-a");
  assert.deepEqual(withA.recruitingPosts[0].playerIds, ["host"]);
  assert.equal(withA.recruitingPosts[0].roomState.partyLeaders.host, "host");

  const withoutCaptain = setRecruitingRoomTeam(withA, emptyPost.id, "teamB", "team-no-captain");
  assert.equal(withoutCaptain.recruitingPosts[0].targetTeamId, null);
  const withB = setRecruitingRoomTeam(withA, emptyPost.id, "teamB", "team-b");
  const selectedPost = withB.recruitingPosts[0];
  assert.equal(selectedPost.targetTeamId, "team-b");
  assert.equal(selectedPost.roomState.invitations.length, 1);
  assert.deepEqual(
    selectedPost.roomState.invitations.map(({ targetUserId, teamId, joinMode, side, status }) => ({ targetUserId, teamId, joinMode, side, status })),
    [{ targetUserId: "captain-b", teamId: "team-b", joinMode: "team", side: "teamB", status: "pending" }],
  );
  const duplicate = setRecruitingRoomTeam(withB, emptyPost.id, "teamB", "team-b");
  assert.equal(duplicate.recruitingPosts[0].roomState.invitations.length, 1);

  const invitation = selectedPost.roomState.invitations[0];
  const declined = declineRecruitingInvitation(
    { ...withB, currentUserId: invitation.targetUserId },
    emptyPost.id,
    invitation.id,
  );
  assert.equal(declined.recruitingPosts[0].targetTeamId, null);
  assert.equal(declined.recruitingPosts[0].roomState.invitations.length, 0);
  const reinvited = setRecruitingRoomTeam(
    { ...declined, currentUserId: "host" },
    emptyPost.id,
    "teamB",
    "team-b",
  );
  assert.equal(reinvited.recruitingPosts[0].targetTeamId, "team-b");
  assert.equal(reinvited.recruitingPosts[0].roomState.invitations.length, 1);
});

test("team selection is routed through the server and DB authority", () => {
  const serverSource = [
    fs.readFileSync(path.join(root, "server/api/recruiting/_syncPostPolicy.js"), "utf8"),
    fs.readFileSync(path.join(root, "server/api/recruiting/_syncPostPickupPolicy.js"), "utf8"),
    fs.readFileSync(path.join(root, "server/api/recruiting/_syncPostActions.js"), "utf8"),
    fs.readFileSync(path.join(root, "server/api/recruiting/_syncPostManagementActions.js"), "utf8"),
  ].join("\n");
  const authoritativeSource = fs.readFileSync(path.join(root, "server/api/_authoritativeState.js"), "utf8");
  const schemaSource = fs.readFileSync(path.join(root, "supabase/schema.sql"), "utf8");
  assert.match(serverSource, /team_room_must_start_without_team_selection/);
  assert.match(serverSource, /operation\.action === "setRecruitingRoomTeam"/);
  assert.match(serverSource, /rankball_recruiting_set_room_team_action/);
  assert.match(serverSource, /recruiting_set_room_team_rpc_required/);
  assert.match(serverSource, /data\?\.fallback\)\s+return applyRecruitingManagementAction\(context, operation\)/);
  assert.doesNotMatch(authoritativeSource, /setRecruitingRoomTeam/u);
  assert.match(schemaSource, /create or replace function public\.rankball_recruiting_set_room_team_action/);
  assert.match(schemaSource, /recruiting_team_member_required/);
  assert.match(schemaSource, /recruiting_team_representative_ineligible/);

  const migrationName = fs.readdirSync(path.join(root, "supabase/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .find((name) => fs.readFileSync(path.join(root, "supabase/migrations", name), "utf8").includes("rankball_recruiting_set_room_team_action"));
  assert.ok(migrationName, "room team selection migration is required");
  const migrationSource = fs.readFileSync(path.join(root, "supabase/migrations", migrationName), "utf8");
  assert.match(migrationSource, /create or replace function public\.rankball_recruiting_set_room_team_action/);
  assert.match(migrationSource, /for update/);
  assert.match(migrationSource, /rankball_assert_team_event_eligible/);
  assert.match(migrationSource, /captainId/);
  assert.match(migrationSource, /recruiting_room_team_already_selected/);
  assert.match(migrationSource, /recruiting_host_team_selection_required/);
  assert.match(migrationSource, /public_team_room_side_b_direct_selection_not_allowed/);
  assert.match(migrationSource, /rankball_recruiting_team_selection_application_guard/);
  assert.match(migrationSource, /'targetUserId'/);
  assert.match(migrationSource, /'pending'/);
  assert.match(migrationSource, /target_team_id/);
  assert.doesNotMatch(migrationSource, /delete\s+from|drop\s+table|truncate\s+table/i);
  assert.match(teamMemberSideLeaderMigrationSource, /recruiting_team_member_required/);
  assert.match(teamMemberSideLeaderMigrationSource, /recruiting_team_representative_ineligible/);
  assert.match(teamMemberSideLeaderMigrationSource, /member\.user_id = safe_actor_id/);
  assert.match(teamMemberSideLeaderMigrationSource, /post_row\.allowed_age_groups,\s*false/);
  assert.doesNotMatch(teamMemberSideLeaderMigrationSource, /delete\s+from|drop\s+table|truncate\s+table/i);
  assert.match(teamMemberPostGuardMigrationSource, /rankball_recruiting_team_event_guard/);
  assert.match(teamMemberPostGuardMigrationSource, /recruiting_team_membership_required/);
  assert.match(teamMemberPostGuardMigrationSource, /recruiting_team_representative_ineligible/);
  assert.match(teamMemberPostGuardMigrationSource, /host_result->'eligiblePlayerIds'/);
  assert.doesNotMatch(teamMemberPostGuardMigrationSource, /delete\s+from|drop\s+table|truncate\s+table/i);
  assert.match(declinedTeamInvitationMigrationSource, /target_team_id = case/);
  assert.match(declinedTeamInvitationMigrationSource, /invitation->>'joinMode'.*'team'/);
  assert.match(declinedTeamInvitationMigrationSource, /invitation->>'side' = 'teamB'/);
  assert.doesNotMatch(declinedTeamInvitationMigrationSource, /delete\s+from|drop\s+table|truncate\s+table/i);
});

test("scoped recruiting confirmation loads active referee qualifications", () => {
  const stateLoaderSource = fs.readFileSync(
    path.join(root, "src/data/repository/remote/stateLoader.js"),
    "utf8",
  );
  assert.match(
    stateLoaderSource,
    /includeRefereeAppointments = includeUserScoped \|\| matchPageScope \|\| recruitingPageScope \|\| tournamentPageScope/,
  );
  assert.match(
    stateLoaderSource,
    /includeRefereeAppointments \? fetchOptionalRows\("referee_appointments"/,
  );
});

test("public team joins persist only the applying team member as side leader", () => {
  const recruitingSource = readPageSourceGroup(RECRUITING_PAGE_SOURCE_PATHS);
  const users = [
    { id: "host", name: "방장", trustScore: 100, ageGroup: "open", ratings: { integrated: 1200 } },
    { id: "captain", name: "상대 팀장", trustScore: 100, ageGroup: "open", ratings: { integrated: 1200 } },
    { id: "member", name: "상대 팀원", trustScore: 100, ageGroup: "open", ratings: { integrated: 1200 } },
  ];
  const post = {
    id: "public-team-room",
    title: "공개 팀전",
    status: "open",
    visibility: "public",
    mode: "2v2",
    sideCapacity: 2,
    benchCapacity: 2,
    hostJoinMode: "team",
    hostSide: "teamA",
    teamOnly: true,
    teamId: "host-team",
    playerId: "host",
    playerIds: ["host"],
    ranked: false,
    mmrLimitMode: "off",
    roomState: {
      ownerId: "host",
      teamOnly: true,
      mmrLimitMode: "off",
      partyLeaders: { host: "host" },
      partySides: { host: "teamA" },
      partyReserves: {},
    },
    rules: { teamOnly: true, mmrLimitMode: "off", allowedAgeGroups: [] },
    applicants: [],
  };
  const teams = [
    {
      id: "host-team",
      name: "방장팀",
      mmr: 1200,
      members: [{ userId: "host", role: "captain" }],
    },
    {
      id: "opponent-team",
      name: "상대팀",
      mmr: 1200,
      members: [
        { userId: "captain", role: "captain" },
        { userId: "member", role: "regular" },
      ],
    },
  ];
  const baseState = {
    currentUserId: "member",
    users,
    teams,
    recruitingPosts: [post],
    notifications: [],
    settings: {},
  };
  const joined = interestRecruitingPost(baseState, post.id, {
    joinMode: "team",
    teamId: "opponent-team",
    side: "teamB",
    playerIds: ["captain", "member"],
    reservePlayerIds: ["captain"],
    reserve: true,
  });
  const application = joined.recruitingPosts[0].applicants[0];

  assert.equal(application.playerId, "member");
  assert.equal(application.side, "teamB");
  assert.equal(application.reserve, false);
  assert.deepEqual(application.playerIds, ["member"]);
  assert.deepEqual(joined.recruitingPosts[0].roomState.partyReserves, {});
  assert.equal(joined.recruitingPosts[0].roomState.partyLeaders["team:opponent-team"], "member");

  const rejected = interestRecruitingPost(
    {
      ...baseState,
      currentUserId: "outsider",
      users: [...users, { id: "outsider", name: "외부인", trustScore: 100, ageGroup: "open", ratings: { integrated: 1200 } }],
    },
    post.id,
    {
      joinMode: "team",
      teamId: "opponent-team",
      side: "teamB",
      playerIds: ["outsider"],
    },
  );
  assert.equal(rejected.recruitingPosts[0].applicants.length, 0);
  assert.match(rejected.notifications[0].body, /내 팀|소속된 팀/);

  assert.match(publicTeamRepresentativeMigrationSource, /rankball_recruiting_management_action_unguarded/);
  assert.match(publicTeamRepresentativeMigrationSource, /member\.role = 'captain'/);
  assert.match(publicTeamRepresentativeMigrationSource, /recruiting_team_captain_required/);
  assert.match(publicTeamRepresentativeMigrationSource, /'playerIds', jsonb_build_array\(safe_actor_id\)/);
  assert.match(publicTeamRepresentativeMigrationSource, /'reservePlayerIds', '\[\]'::jsonb/);
  assert.match(publicTeamRepresentativeMigrationSource, /recruiting_team_side_occupied/);
  assert.match(publicTeamRepresentativeApplicationMigrationSource, /rankball_recruiting_application_event_guard/);
  assert.match(publicTeamRepresentativeApplicationMigrationSource, /post_row\.host_join_mode = 'team'/);
  assert.match(publicTeamRepresentativeApplicationMigrationSource, /new\.player_id = eligibility->>'captainId'/);
  assert.match(publicTeamRepresentativeApplicationMigrationSource, /jsonb_array_length\(coalesce\(new\.player_ids, '\[\]'::jsonb\)\) = 1/);
  assert.match(publicTeamRepresentativeApplicationMigrationSource, /team_representative_application_guard_shape_changed/);
  assert.match(teamMemberPublicJoinMigrationSource, /recruiting_team_membership_required/);
  assert.match(teamMemberPublicJoinMigrationSource, /recruiting_team_representative_ineligible/);
  assert.match(teamMemberPublicJoinMigrationSource, /eligibility->'eligiblePlayerIds'[\s\S]*\? new\.player_id/);
  assert.doesNotMatch(teamMemberPublicJoinMigrationSource, /delete\s+from|drop\s+table|truncate\s+table/i);
  assert.match(recruitingSource, /상대 팀원이 B사이드장으로 참가할 때까지 기다립니다\./);
  assert.doesNotMatch(recruitingSource, /상대 팀 현재 주장이 B사이드로 참가/);
});

test("기존 후보의 팀 파티 합류는 후보 배치와 기존 파티장을 유지한다", () => {
  const post = {
    id: "mixed-party-room",
    title: "혼합 팀 파티",
    status: "open",
    visibility: "public",
    mode: "3v3",
    sideCapacity: 3,
    benchCapacity: 3,
    hostJoinMode: "team",
    teamOnly: false,
    playerId: "host",
    roomState: { ownerId: "host", partyLeaders: {}, partyReserves: {} },
    rules: { teamOnly: false, mmrLimitMode: "off", allowedAgeGroups: [] },
    applicants: [
      { kind: "player", joinMode: "player", playerId: "leader", side: "teamB", status: "ready", reserve: false },
      { kind: "player", joinMode: "player", playerId: "reserve", side: "teamB", status: "ready", reserve: true },
    ],
  };
  const state = {
    currentUserId: "reserve",
    users: [
      { id: "host", position: "PG", trustScore: 100, ratings: { integrated: 1200 } },
      { id: "leader", position: "SG", trustScore: 100, ratings: { integrated: 1200 } },
      { id: "reserve", position: "SF", trustScore: 100, ratings: { integrated: 1200 } },
    ],
    teams: [{
      id: "team-b",
      name: "B팀",
      members: [
        { userId: "leader", role: "captain" },
        { userId: "reserve", role: "regular" },
      ],
    }],
    recruitingPosts: [post],
    notifications: [],
    settings: {},
  };

  const joined = joinRecruitingSideParty(state, post.id, "team-b", "teamB", "leader");
  const party = joined.recruitingPosts[0].applicants.find((entry) => entry.kind === "team");
  assert.equal(party.playerId, "leader");
  assert.deepEqual(party.playerIds, ["leader"]);
  assert.deepEqual(joined.recruitingPosts[0].roomState.partyReserves["team:team-b"], ["reserve"]);
  assert.equal(joined.recruitingPosts[0].roomState.partyLeaders["team:team-b"], "leader");
  assert.strictEqual(joinRecruitingSideParty(joined, post.id, "team-b", "teamB", party.id), joined);
});

test("pickup participant slots keep a fixed width and use available desktop columns", () => {
  const componentSource = fs.readFileSync(path.join(root, "src/components/match/PickupParticipantPool.jsx"), "utf8");
  const cssSource = readCssTreeSync("src/styles/recruiting-arena.css");
  assert.doesNotMatch(componentSource, /Math\.min\(8,\s*Math\.max\(1,\s*safeCapacity\)\)/);
  assert.doesNotMatch(componentSource, /--pickup-slot-columns/);
  assert.match(cssSource, /--pickup-slot-width:\s*72px/);
  assert.match(cssSource, /\.arena-lobby-modal \.pickup-room-slot-grid,[\s\S]*?inline-size:\s*100%;[\s\S]*?min-inline-size:\s*0;[\s\S]*?max-inline-size:\s*100%;/);
  assert.match(cssSource, /grid-template-columns:\s*repeat\(auto-fit,\s*var\(--pickup-slot-width\)\)/);
  assert.match(cssSource, /\.pickup-room-slot-grid \.arena-room-player-slot[\s\S]*width:\s*var\(--pickup-slot-width\)/);
  assert.doesNotMatch(cssSource, /\.arena-lobby-modal \.pickup-room-slot-grid[^{]*\{[^}]*grid-template-columns:\s*repeat\(4/);
  assert.match(cssSource, /@media \(max-width: 720px\)[\s\S]*\.pickup-room-slot-grid[\s\S]*--room-slot-inline-bleed:\s*var\(--space-2\)/);
  assert.match(cssSource, /@media \(max-width: 720px\)[\s\S]*\.pickup-room-slot-grid[\s\S]*inline-size:\s*calc\(100% \+ \(2 \* var\(--room-slot-inline-bleed\)\)\)/);
  assert.match(cssSource, /@media \(max-width: 720px\)[\s\S]*\.pickup-room-slot-grid[\s\S]*justify-content:\s*space-between/);
  assert.match(cssSource, /@media \(max-width: 720px\)[\s\S]*\.pickup-room-slot-grid[\s\S]*margin-inline:\s*calc\(-1 \* var\(--room-slot-inline-bleed\)\)/);
  assert.match(cssSource, /@media \(max-width: 720px\)[\s\S]*\.pickup-room-slot-grid[\s\S]*padding-inline:\s*0/);
});

test("mobile active and reserve slots share the side-capacity width token", () => {
  const recruitingSource = readPageSourceGroup(RECRUITING_PAGE_SOURCE_PATHS);
  const cssSource = readCssTreeSync("src/styles/recruiting-arena.css");
  assert.match(recruitingSource, /--room-side-slot-count/);
  assert.match(cssSource, /--room-slot-width:\s*min\(72px,\s*calc\(\(100dvw - 128px\) \/ var\(--room-side-slot-count,\s*4\)\)\)/);
  assert.doesNotMatch(cssSource, /@media \(max-width: 380px\)[\s\S]*?--room-slot-width:\s*74px/);
  assert.match(cssSource, /\.arena-lobby-modal \.arena-room-slot-row[\s\S]*?grid-auto-columns:\s*minmax\(var\(--room-slot-width\),\s*var\(--room-slot-width\)\)/);
  assert.match(cssSource, /\.arena-lobby-modal \.arena-side-inline-reserve \.arena-room-reserve-row,[\s\S]*?grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(var\(--room-slot-width\),\s*var\(--room-slot-width\)\)\)/);
});

test("CreateMatch persists bench capacity at top level and inside rules", () => {
  const source = readPageSourceGroup(CREATE_MATCH_PAGE_SOURCE_PATHS);
  assert.match(source, /benchCapacity: creationPolicyPayload\.benchCapacity/);
  assert.match(source, /rules:\s*\{[\s\S]*\.\.\.creationPolicyPayload/);
  assert.match(source, /teamId:\s*""[\s\S]*opponentTeamId:\s*""/);
  assert.match(source, /presetTeamAId[\s\S]*setRecruitingRoomTeam\(postId, "teamA"/);
  assert.match(source, /if \(!result \|\| result\?\.ok === false\)[\s\S]*closeRecruitingPost\(postId, "A팀 선택 실패로 생성 취소"\)/);
  assert.match(source, /else if \(!remakeDraft && createAsTeam && presetTeamAReady && effectiveVisibility === "private" && presetTeamBId\)/);
  assert.match(source, /if \(submittingRef\.current \|\| submitting\) return/);
  assert.match(source, /submittingRef\.current = true[\s\S]*finally \{[\s\S]*submittingRef\.current = false/);
  assert.match(source, /remakeDraft && draft\.remakeReinvite[\s\S]*const result = await app\.actions\.setRecruitingRoomTeam\(postId, "teamB"[\s\S]*B팀 재초대 실패로 생성 취소/);
  assert.match(source, /const result = await app\.actions\.inviteRecruitingPlayers\(postId[\s\S]*선수 재초대 실패로 생성 취소/);
  assert.match(source, /MatchCreationWizardNav/);
  assert.match(source, /wizardStep === finalWizardStep/);
  assert.doesNotMatch(source, /official:\s*true/);
  assert.doesNotMatch(source, /wizardStep === \(isMatchRecordRoom \? 5 : 1\)/);
  const wizardSource = fs.readFileSync(path.join(root, "src/components/match/MatchCreationWizard.jsx"), "utf8");
  assert.match(wizardSource, /참가를 확인한 선수만 서버 정책에 따라 개인 MMR 반영 대상/);
  assert.doesNotMatch(wizardSource, /1v1 10%|2v2 20%|3v3 35%|5v5 50%/);
  assert.doesNotMatch(wizardSource, /MMR에는 반영하지 않습니다/);
  assert.match(wizardSource, /const purposeValue = matchPurpose/);
  assert.doesNotMatch(wizardSource, /disabled=\{pickup\}/);
  assert.doesNotMatch(wizardSource, /현장 픽업은 친선전으로 고정/);
  assert.doesNotMatch(wizardSource, /\{ id: 6, label: "확인" \}/);
  assert.doesNotMatch(wizardSource, /점수판 있음|샷클락 있음|기록원 있음/);
  assert.match(wizardSource, /policy\.onCourtCount > 1/);
  assert.match(wizardSource, /조끼 준비/);
  assert.match(wizardSource, /vestsProvided:\s*event\.target\.value === "provided"/);
  assert.doesNotMatch(wizardSource, /type="checkbox" checked=\{policy\.vestsProvided\}/);
  const ruleSelectorSource = fs.readFileSync(path.join(root, "src/components/match/RuleSelector.jsx"), "utf8");
  assert.match(ruleSelectorSource, /BOXTIER 경기시계 사용 여부/);
  assert.match(ruleSelectorSource, /rules\.gameClockEnabled && rules\.clockMode === "running"/);
  assert.match(ruleSelectorSource, /winByTwo:\s*event\.target\.value === "enabled"/);
  assert.doesNotMatch(ruleSelectorSource, /type="checkbox" checked=\{rules\.winByTwo\}/);
  assert.match(source, /getScopedMatchCreationPolicyPayload\(draft, "match_record"\)/);
  assert.match(source, /getScopedMatchCreationPolicyPayload\(draft, "tournament"\)/);
  assert.match(source, /getMatchConfigurationChangePatch\(draft, \{ matchPurpose: "competitive", formationMode: "prearranged" \}\)/);
  assert.match(source, /getDefaultCreateTitle\(draft\.mode, patch\.matchIntent\)/);
  assert.match(source, /getMatchCreationWizardType\(draft, \{ recordIntent: isRecordCreateIntent \}\)/);
  assert.match(wizardSource, /step\.id === 4 \? \{ \.\.\.step, label: "구장" \}/);
  const serverSource = [
    fs.readFileSync(path.join(root, "server/api/recruiting/_syncPostHandler.js"), "utf8"),
    fs.readFileSync(path.join(root, "server/api/recruiting/_syncPostProjection.js"), "utf8"),
  ].join("\n");
  assert.match(serverSource, /validatePickupRecruitingOperation\(context, operation\)/);
  assert.match(serverSource, /rules: \{ \.\.\.\(post\.rules \?\? \{\}\), benchCapacity \}/);
  const schemaSource = fs.readFileSync(path.join(root, "supabase/schema.sql"), "utf8");
  assert.match(schemaSource, /coalesce\(draft->'rules', '\{\}'::jsonb\)/);
  const cssSource = readCssManifest("src/styles/globals.css");
  assert.doesNotMatch(cssSource, /\.match-creation-wizard-nav ol\s*\{[^}]*min-width:\s*720px/);
  assert.doesNotMatch(cssSource, /\.create-match-page input\[type="checkbox"\][\s\S]*accent-color:/);
  assert.match(cssSource, /@media \(max-width: 420px\)[\s\S]*\.match-creation-wizard-actions/);
  const recruitingSource = readPageSourceGroup(RECRUITING_PAGE_SOURCE_PATHS);
  assert.match(recruitingSource, /참가 상태[\s\S]*?joinDraft\.reserve \? "reserve" : "starter"/);
  assert.match(recruitingSource, /const reserve = event\.target\.value === "reserve"/);
  assert.doesNotMatch(recruitingSource, /arena-check-row/);
  assert.match(recruitingSource, /getMatchRuleDetailRows/);
  assert.match(recruitingSource, /selectedRoomPolicyRows/);
  assert.match(recruitingSource, /playerOnly=\{individualOnlyRoom\}/);
  assert.match(recruitingSource, /placeholder=\{playerOnly \? "선수 검색" : "선수 또는 팀 검색"\}/);
  assert.match(recruitingSource, /const currentUserInParty = Boolean\(!individualOnlyRoom/);
  assert.match(recruitingSource, /individualOnlyRoom\s*\? "내 슬롯을 누르면 A\/B 출전과 후보 위치를 변경할 수 있습니다\."/);
  assert.match(recruitingSource, /const selectedJoinPlayerIds = teamOnlyRoom[\s\S]*app\.currentUser\.id \? \[app\.currentUser\.id\] : \[\]/);
  assert.doesNotMatch(recruitingSource, /teamOnlyRoom \|\| selectedJoinPlayerIds\.length >= getRecruitingSideCapacity/);
  assert.match(recruitingSource, /<span>대표 1명 참가<\/span>/);
  assert.match(recruitingSource, /참가 후 방 안에서 사이드장이 출전·후보 명단을 확정합니다\./);
  assert.match(recruitingSource, /const sourceMatchRecordBoardFirst = Boolean\([\s\S]*Boolean\(sourceMatch\?\.refereeId\)/);
  const compactSource = [
    fs.readFileSync(path.join(root, "server/api/recruiting/_listProjection.js"), "utf8"),
    fs.readFileSync(path.join(root, "server/api/recruiting/_listProjectionCompact.js"), "utf8"),
  ].join("\n");
  assert.match(compactSource, /lastPeriodStopMinutes: rules\.lastPeriodStopMinutes/);
  assert.match(compactSource, /gameClockEnabled: rules\.gameClockEnabled/);
  assert.doesNotMatch(compactSource, /scoreboardAvailable: rules\.scoreboardAvailable|shotClockAvailable: rules\.shotClockAvailable|statRecorderAvailable: rules\.statRecorderAvailable/);
  assert.match(compactSource, /matchIntent: rules\.matchIntent/);
  const clockMigration = fs.readFileSync(path.join(root, "supabase/migrations/20260724190000_optional_match_clock_policy.sql"), "utf8");
  assert.match(clockMigration, /match_clock_disabled/);
  assert.match(clockMigration, /rules->>'gameClockEnabled'/);
  assert.doesNotMatch(clockMigration, /delete\s+from|drop\s+table|truncate\s+table/i);
  const pickupMigration = fs.readFileSync(path.join(root, "supabase/migrations/20260723100000_pickup_individual_participation_guard.sql"), "utf8");
  assert.match(pickupMigration, /pickup_party_not_allowed/);
  assert.doesNotMatch(pickupMigration, /delete\s+from/i);
  const pickupCopyMigration = fs.readFileSync(path.join(root, "supabase/migrations/20260723102500_pickup_invitation_copy_repair.sql"), "utf8");
  assert.match(pickupCopyMigration, /개인 참가 초대장이 도착했습니다/);
  assert.doesNotMatch(pickupCopyMigration, /delete\s+from/i);
  const pickupSwapMigration = fs.readFileSync(path.join(root, "supabase/migrations/20260723115000_pickup_player_swap.sql"), "utf8");
  assert.match(pickupSwapMigration, /rankball_match_swap_pickup_players/);
  assert.match(pickupSwapMigration, /pickup_swap_cross_side_required/);
  assert.match(pickupSwapMigration, /sideAssignmentStatus', 'pending'/);
  assert.doesNotMatch(pickupSwapMigration, /delete\s+from|drop\s+table|truncate\s+table/i);
});

test("심판 미선택 상태는 중복 설명 행을 표시하지 않는다", () => {
  const source = readPageSourceGroup(CREATE_MATCH_PAGE_SOURCE_PATHS);
  assert.doesNotMatch(source, /심판 초대 안 함|무심판 경기는 팀 점수만 기록|신규 자격 기준/);
  assert.match(source, /selectedReferee \? \([\s\S]*초대할 심판:[\s\S]*초대 해제/);
});

test("원격 심판 검색에서 선택한 프로필은 일반 경기 후보에 유지한다", () => {
  const source = readPageSourceGroup(CREATE_MATCH_PAGE_SOURCE_PATHS);
  assert.match(
    source,
    /const refereeCandidates = useMemo\([\s\S]*\[\.\.\.app\.state\.users, \.\.\.selectedTournamentRefereeProfiles\]/,
  );
  assert.match(
    source,
    /const selectReferee = \(user\) => \{[\s\S]*setSelectedTournamentRefereeProfiles[\s\S]*if \(isTournamentRoom\)/,
  );
  assert.match(source, /mapRemoteItem=\{\(user\) => activePlayerIds\.has\(user\.id\) \? null : user\}/);
});

test("대회 원격 팀 검색 선택은 로컬 directory 밖에서도 snapshot으로 유지한다", () => {
  const source = readPageSourceGroup(CREATE_MATCH_PAGE_SOURCE_PATHS);
  const validationEffectsSource = fs.readFileSync(
    path.join(root, "src/components/match/useCreateMatchValidationEffects.js"),
    "utf8",
  );

  assert.match(source, /const \[selectedTournamentTeamProfiles, setSelectedTournamentTeamProfiles\] = useState\(\[\]\)/);
  assert.match(source, /\[\.\.\.selectedTournamentTeamProfiles, \.\.\.app\.state\.teams\]\.map\(\(team\) => \[team\.id, team\]\)/);
  assert.match(source, /const toggleTournamentTeam = \(teamOrId\) => \{/);
  assert.match(source, /setSelectedTournamentTeamProfiles\(\(current\) => \(/);
  assert.match(source, /if \(isTournamentRoom\) toggleTournamentTeam\(team\)/);
  assert.match(validationEffectsSource, /\[\.\.\.app\.state\.teams, \.\.\.selectedTournamentTeamProfiles\]\.map\(\(team\) => team\.id\)/);
  assert.match(source, /teamIds: draft\.tournamentTeamIds/);
});

test("알파 테스트 심판은 운영 신뢰도와 무관하게 심판 검색 자격을 유지한다", () => {
  assert.equal(isEligibleReferee({
    id: "test-referee",
    testLoginId: "rankball-011",
    trustScore: 82,
  }), true);
  assert.equal(isEligibleReferee({
    id: "regular-player",
    testLoginId: "rankball-012",
    trustScore: 82,
  }), false);
});

test("심판 초대는 활성 자격만 보고 신뢰도를 다시 평가하지 않는다", () => {
  const appointment = {
    userId: "active-referee",
    role: "referee",
    grade: "candidate",
    status: "active",
  };
  assert.equal(isEligibleReferee({
    id: "active-referee",
    trustScore: 70,
  }, 90, [appointment]), true);
  assert.equal(isEligibleReferee({
    id: "active-referee",
    trustScore: 69,
  }, 90, [appointment]), true);
  assert.equal(isEligibleReferee({
    id: "active-referee",
    trustScore: 100,
  }, 90, [{ ...appointment, status: "revoked" }]), false);
});

test("경기 시작 뒤 신뢰도 자동 회수된 기존 배정 심판만 경기 완료 권한을 유지한다", () => {
  const referee = { id: "active-referee", trustScore: 69 };
  const autoRevokedAppointment = {
    userId: referee.id,
    role: "referee",
    grade: "candidate",
    status: "revoked",
    autoRevoked: true,
    revokeReason: "referee_trust_below_70",
    revokedAt: "2026-07-30T12:05:00.000Z",
  };
  assert.equal(canOperateAssignedMatchReferee(referee, {
    id: "ongoing-match",
    refereeId: referee.id,
    startedAt: "2026-07-30T12:00:00.000Z",
    status: "agreed",
  }, [autoRevokedAppointment]), true);
  assert.equal(canOperateAssignedMatchReferee(referee, {
    id: "ongoing-match",
    refereeId: referee.id,
    startedAt: "2026-07-30T12:00:00.000Z",
    status: "agreed",
  }, [{ ...autoRevokedAppointment, autoRevoked: false, revokeReason: "manual_revoke" }]), false);
  assert.equal(canOperateAssignedMatchReferee(referee, {
    id: "late-started-match",
    refereeId: referee.id,
    startedAt: "2026-07-30T12:10:00.000Z",
    status: "agreed",
  }, [autoRevokedAppointment]), false);
  assert.equal(canOperateAssignedMatchReferee(referee, {
    id: "future-match",
    refereeId: referee.id,
    status: "agreed",
  }, [autoRevokedAppointment]), false);
});

test("DB 미연결 생성 액션은 현재 state snapshot으로 결과를 판정한다", () => {
  const appActionsSource = fs.readFileSync(new URL("../src/hooks/appData/actions.js", import.meta.url), "utf8");
  const matchActionsSource = fs.readFileSync(new URL("../src/hooks/appData/actions/matchActions.js", import.meta.url), "utf8");
  const recruitingActionsSource = fs.readFileSync(new URL("../src/hooks/appData/actions/recruitingActions.js", import.meta.url), "utf8");
  assert.match(appActionsSource, /applyRecruitingPostMutation[\s\S]*if \(!isSupabaseConfigured\)[\s\S]*stateRef\.current = next;[\s\S]*applyMatchMutation[\s\S]*if \(!isSupabaseConfigured\)[\s\S]*stateRef\.current = next;/);
  assert.match(matchActionsSource, /previousState = stateRef\.current;[\s\S]*stateRef\.current = next;[\s\S]*return createdMatch\.id;/);
  assert.match(recruitingActionsSource, /previousState = stateRef\.current;[\s\S]*stateRef\.current = next;[\s\S]*return createdPost\.id;/);
});
