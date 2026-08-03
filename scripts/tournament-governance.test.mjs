import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  getAcceptedTournamentRefereeIds,
  getRequiredTournamentRefereeCount,
  getTournamentRefereePoolValidation,
  getTournamentSanctionLabel,
  getTournamentUncoveredTeamPairs,
  doTournamentMatchSchedulesOverlap,
  isTournamentGovernanceEnabled,
  isTournamentRefereeAuthorized,
  isTournamentRefereeNeutral,
} from "../src/lib/tournamentGovernance.js";
import {
  activateTournamentSanction,
  assignTournamentMatchReferee,
  forfeitTournamentMatch,
  declineTournamentReferee,
  rejectTournamentRegion,
  requestMatchRefereeAbsence,
  updateTournamentMatchSchedule,
  configureServerRatingAuthority,
} from "../src/data/repository.js";
import { SERVER_RATING_AUTHORITY } from "../server/lib/ratingAuthority.js";

configureServerRatingAuthority(SERVER_RATING_AUTHORITY);

const root = new URL("../", import.meta.url);
const readSource = (path) => readFile(new URL(path, root), "utf8");

test("대회 몰수는 선수 MMR을 제외하고 마지막 대진의 우승팀을 확정한다", () => {
  const match = {
    id: "forfeit-final",
    tournamentId: "tournament-forfeit",
    tournamentFormat: "tournament",
    tournamentRound: 1,
    tournamentFixture: 1,
    status: "agreed",
    scheduledDate: "2026-01-01",
    scheduledTime: "12:00",
    teamA: { name: "A팀", teamId: "team-a", players: ["a1"] },
    teamB: { name: "B팀", teamId: "team-b", players: ["b1"] },
    rules: {},
  };
  const state = {
    currentUserId: "owner",
    users: [],
    teams: [],
    notifications: [],
    settings: {},
    matches: [match],
    tournaments: [{
      id: "tournament-forfeit",
      title: "몰수 검증 대회",
      status: "active",
      format: "tournament",
      createdBy: "owner",
      bracket: { bracketSize: 2, rounds: [] },
    }],
  };

  const next = forfeitTournamentMatch(state, "tournament-forfeit", match.id, "teamA", "A팀 불참");
  const result = next.matches[0];

  assert.equal(result.status, "confirmed");
  assert.deepEqual(result.result, {
    scoreA: 0,
    scoreB: 1,
    playerStats: {},
    statSubmissions: {},
    submittedBy: "owner",
    submittedAt: result.result.submittedAt,
  });
  assert.deepEqual(result.mmrExcludedPlayerIds.sort(), ["a1", "b1"]);
  assert.equal(result.rules.forfeit.mmrCommitted, false);
  assert.equal(next.tournaments[0].status, "closed");
  assert.equal(next.tournaments[0].bracket.championTeamId, "team-b");
});

const users = [
  { id: "referee-a", trustScore: 95 },
  { id: "referee-b", trustScore: 92 },
];
const refereeAppointments = users.map((user) => ({
  id: `appointment-${user.id}`,
  userId: user.id,
  role: "referee",
  grade: "candidate",
  status: "active",
  startsAt: "2026-01-01T00:00:00.000Z",
  endsAt: "2099-12-31T23:59:59.000Z",
}));
const teams = [
  { id: "team-a", members: [{ userId: "player-a", role: "captain" }] },
  { id: "team-b", members: [{ userId: "player-b", role: "captain" }] },
  { id: "team-c", members: [{ userId: "player-c", role: "captain" }] },
];

test("팀 수에 따라 필수 심판 수가 2·3·4명으로 증가한다", () => {
  assert.equal(getRequiredTournamentRefereeCount(1), 0);
  assert.equal(getRequiredTournamentRefereeCount(2), 2);
  assert.equal(getRequiredTournamentRefereeCount(4), 2);
  assert.equal(getRequiredTournamentRefereeCount(5), 3);
  assert.equal(getRequiredTournamentRefereeCount(8), 3);
  assert.equal(getRequiredTournamentRefereeCount(9), 4);
  assert.equal(isTournamentGovernanceEnabled({ rules: { governanceVersion: 2 } }), true);
  assert.equal(isTournamentGovernanceEnabled({ rules: {} }), false);
  assert.equal(isTournamentGovernanceEnabled(null), false);
});

test("대회 심판 안내는 신뢰도를 재평가하지 않고 유효 자격만 설명한다", async () => {
  const [validationController, creationRepository] = await Promise.all([
    readSource("src/components/match/useCreateMatchValidationController.js"),
    readSource("src/data/repository/tournaments/creation.js"),
  ]);
  for (const source of [validationController, creationRepository]) {
    assert.match(source, /대회 주최자는 대회 종료일까지 유효한 자격심판이어야 합니다\./u);
    assert.match(source, /대회 종료일까지 유효한 자격이 없는 심판이 포함되어 있습니다\./u);
    assert.doesNotMatch(source, /대회 주최자는 신뢰도/u);
    assert.doesNotMatch(source, /자격 또는 신뢰도 조건/u);
  }
});

test("활성 대회에서 승인된 기존 심판은 신뢰도 자동 회수 뒤에만 대회를 완료한다", () => {
  const referee = { id: "referee-low", trustScore: 69 };
  const autoRevokedAppointment = {
    userId: referee.id,
    role: "referee",
    grade: "candidate",
    status: "revoked",
    autoRevoked: true,
    revokeReason: "referee_trust_below_70",
    revokedAt: "2026-07-30T12:05:00.000Z",
  };
  assert.equal(isTournamentRefereeAuthorized({
    status: "active",
    startedAt: "2026-07-30T12:00:00.000Z",
    refereeIds: [referee.id],
    refereeStatuses: { [referee.id]: "accepted" },
  }, referee, [autoRevokedAppointment]), true);
  assert.equal(isTournamentRefereeAuthorized({
    status: "active",
    startedAt: "2026-07-30T12:00:00.000Z",
    refereeIds: [referee.id],
    refereeStatuses: { [referee.id]: "accepted" },
  }, referee, [{ ...autoRevokedAppointment, autoRevoked: false, revokeReason: "manual_revoke" }]), false);
  assert.equal(isTournamentRefereeAuthorized({
    status: "active",
    startedAt: "2026-07-30T12:10:00.000Z",
    refereeIds: [referee.id],
    refereeStatuses: { [referee.id]: "accepted" },
  }, referee, [autoRevokedAppointment]), false);
  assert.equal(isTournamentRefereeAuthorized({
    status: "draft",
    startedAt: "2026-07-30T12:00:00.000Z",
    refereeIds: [referee.id],
    refereeStatuses: { [referee.id]: "accepted" },
  }, referee, [autoRevokedAppointment]), false);
});

test("공식·지역 비승인 모두 승인된 중립 심판 풀을 요구한다", () => {
  const tournament = {
    teamIds: teams.map((team) => team.id),
    refereeIds: users.map((user) => user.id),
    refereeStatuses: { "referee-a": "accepted", "referee-b": "accepted" },
    rules: { teamRosterSnapshot: { teams: {} } },
  };
  const validation = getTournamentRefereePoolValidation({
    tournament,
    teams,
    users,
    refereeAppointments,
    requireAccepted: true,
  });
  assert.equal(validation.allowed, true);
  assert.deepEqual(getAcceptedTournamentRefereeIds(tournament), ["referee-a", "referee-b"]);
  assert.deepEqual(getTournamentUncoveredTeamPairs(tournament, teams), []);
  assert.equal(SERVER_RATING_AUTHORITY.getTournamentRatingScale(false), 0.8);
  assert.equal(getTournamentSanctionLabel({ sanctionStatus: "community" }), "지역 비승인 대회");
});

test("양 팀 소속 심판만 남으면 해당 대진을 중립 커버리지 실패로 판정한다", () => {
  const affiliatedTeams = [
    { ...teams[0], members: [...teams[0].members, { userId: "referee-a", role: "regular" }] },
    { ...teams[1], members: [...teams[1].members, { userId: "referee-b", role: "regular" }] },
  ];
  const tournament = {
    teamIds: affiliatedTeams.map((team) => team.id),
    refereeIds: users.map((user) => user.id),
    refereeStatuses: { "referee-a": "accepted", "referee-b": "accepted" },
    rules: { teamRosterSnapshot: { teams: {} } },
  };
  assert.equal(isTournamentRefereeNeutral(tournament, "referee-a", "team-a", "team-b", affiliatedTeams), false);
  assert.equal(isTournamentRefereeNeutral(tournament, "referee-b", "team-a", "team-b", affiliatedTeams), false);
  assert.deepEqual(getTournamentUncoveredTeamPairs(tournament, affiliatedTeams), [
    { teamAId: "team-a", teamBId: "team-b" },
  ]);
});

function makeGovernedTournamentState() {
  return {
    currentUserId: "organizer",
    users: [
      { id: "organizer", trustScore: 95 },
      ...users,
    ],
    teams: [
      { id: "team-a", name: "A", members: [{ userId: "organizer", role: "captain" }] },
      { id: "team-b", name: "B", members: [{ userId: "player-b", role: "captain" }] },
    ],
    tournaments: [{
      id: "tournament-1",
      title: "심판 검증 대회",
      region: "마포",
      status: "draft",
      format: "league",
      mode: "3v3",
      ranked: true,
      courtId: "court-1",
      endDate: "2099-12-30",
      teamIds: ["team-a", "team-b"],
      teamStatuses: { "team-a": "accepted", "team-b": "accepted" },
      refereeIds: ["referee-a", "referee-b"],
      refereeStatuses: { "referee-a": "accepted", "referee-b": "accepted" },
      rules: {
        governanceVersion: 2,
        teamRosterSnapshot: {
          teams: {
            "team-a": { representativeMemberIds: ["organizer"] },
            "team-b": { representativeMemberIds: ["player-b"] },
          },
        },
      },
      matchIds: [],
      createdBy: "organizer",
    }],
    matches: [],
    notifications: [],
    settings: {
      refereeAppointments: [
        ...refereeAppointments,
        {
          id: "appointment-organizer",
          userId: "organizer",
          role: "referee",
          grade: "candidate",
          status: "active",
          startsAt: "2026-01-01T00:00:00.000Z",
          endsAt: "2099-12-31T23:59:59.000Z",
        },
      ],
      approvedCourts: [{ id: "court-1", name: "테스트 코트", status: "active" }],
    },
  };
}

test("지역 비승인 대회도 승인 심판을 자동 배정하고 MMR 0.8을 경기 원본에 저장한다", () => {
  const state = makeGovernedTournamentState();
  const next = activateTournamentSanction(state, "tournament-1", "community");
  assert.equal(next.tournaments[0].status, "active");
  assert.equal(next.tournaments[0].official, false);
  assert.equal(next.tournaments[0].rules.ratingScale, 0.8);
  assert.equal(next.matches.length, 1);
  assert.ok(["referee-a", "referee-b"].includes(next.matches[0].refereeId));
  assert.equal(next.matches[0].rules.ratingScale, 0.8);
});

test("개최 시점에도 주최자 심판 자격을 다시 확인한다", () => {
  const state = makeGovernedTournamentState();
  const ineligibleOrganizer = {
    ...state,
    settings: {
      ...state.settings,
      refereeAppointments: state.settings.refereeAppointments.filter(
        (appointment) => appointment.userId !== "organizer",
      ),
    },
  };
  const blocked = activateTournamentSanction(ineligibleOrganizer, "tournament-1", "community");
  assert.equal(blocked.tournaments[0].status, "draft");
  assert.equal(blocked.matches.length, 0);
});

test("지역관리자 비승인 뒤에도 필수 심판 조건을 유지한 채 주최자가 개최한다", () => {
  const state = makeGovernedTournamentState();
  const reviewed = rejectTournamentRegion({
    ...state,
    currentUserId: "region-manager",
    users: [...state.users, { id: "region-manager", trustScore: 95, region: "마포" }],
    settings: {
      ...state.settings,
      adminAppointments: [{
        id: "appointment-region-manager",
        userId: "region-manager",
        role: "admin",
        grade: "regionManager",
        status: "active",
        source: "server_context",
        payload: { region: "마포" },
      }],
    },
  }, "tournament-1", "지역 일정 조정 필요");
  assert.equal(reviewed.tournaments[0].sanctionStatus, "regional_rejected");
  assert.equal(reviewed.matches.length, 0);

  const started = activateTournamentSanction({
    ...reviewed,
    currentUserId: "organizer",
  }, "tournament-1", "community");
  assert.equal(started.tournaments[0].status, "active");
  assert.equal(started.tournaments[0].sanctionStatus, "community");
  assert.ok(started.matches[0].refereeId);
});

test("다른 지역 지역관리자는 대회를 승인하거나 반려할 수 없다", () => {
  const state = makeGovernedTournamentState();
  const attemptedState = {
    ...state,
    currentUserId: "region-manager",
    users: [...state.users, { id: "region-manager", trustScore: 95, region: "성수" }],
    settings: {
      ...state.settings,
      adminAppointments: [{
        id: "appointment-region-manager",
        userId: "region-manager",
        role: "admin",
        grade: "regionManager",
        status: "active",
        source: "server_context",
        payload: { region: "성수" },
      }],
    },
  };
  const reviewed = rejectTournamentRegion(attemptedState, "tournament-1", "다른 지역");
  assert.equal(reviewed, attemptedState);
});

test("대회 활성화 뒤에는 확정 심판이 일방적으로 거절할 수 없다", () => {
  const active = activateTournamentSanction(makeGovernedTournamentState(), "tournament-1", "community");
  const result = declineTournamentReferee({
    ...active,
    currentUserId: "referee-a",
  }, "tournament-1");
  assert.equal(result.tournaments[0].refereeStatuses["referee-a"], "accepted");
});

test("운영 대회는 심판 미출석을 무심판 경기로 전환하지 않는다", () => {
  const active = activateTournamentSanction(makeGovernedTournamentState(), "tournament-1", "community");
  const requested = requestMatchRefereeAbsence(active, active.matches[0].id);
  assert.equal(requested, active);
});

test("심판 승인 부족과 경기시간 구간 중복 배정은 로컬 시뮬레이션에서도 막는다", () => {
  const state = makeGovernedTournamentState();
  const missingApproval = {
    ...state,
    tournaments: [{
      ...state.tournaments[0],
      refereeStatuses: { "referee-a": "accepted", "referee-b": "invited" },
    }],
  };
  const blockedStart = activateTournamentSanction(missingApproval, "tournament-1", "community");
  assert.equal(blockedStart.matches.length, 0);
  assert.equal(blockedStart.tournaments[0].status, "draft");

  const active = activateTournamentSanction(state, "tournament-1", "community");
  const match = active.matches[0];
  const conflictState = {
    ...active,
    matches: [
      { ...match, scheduledDate: "2026-08-01", scheduledTime: "14:00" },
      {
        ...match,
        id: "other-match",
        tournamentId: "other-tournament",
        refereeId: "referee-b",
        scheduledDate: "2026-08-01",
        scheduledTime: "14:05",
      },
    ],
  };
  const assigned = assignTournamentMatchReferee(
    conflictState,
    "tournament-1",
    match.id,
    "referee-b",
  );
  assert.equal(assigned, conflictState);
});

test("대회 일정 변경도 승인 중립 심판 자격과 새 일정 중복을 검증한다", () => {
  const active = activateTournamentSanction(makeGovernedTournamentState(), "tournament-1", "community");
  const match = active.matches[0];
  const scheduledDateValue = new Date();
  scheduledDateValue.setDate(scheduledDateValue.getDate() + 1);
  const scheduledDate = [
    scheduledDateValue.getFullYear(),
    String(scheduledDateValue.getMonth() + 1).padStart(2, "0"),
    String(scheduledDateValue.getDate()).padStart(2, "0"),
  ].join("-");
  const schedule = { scheduledDate, scheduledTime: "14:00", courtId: "court-1" };

  const unaccepted = {
    ...active,
    tournaments: [{
      ...active.tournaments[0],
      refereeStatuses: { ...active.tournaments[0].refereeStatuses, [match.refereeId]: "invited" },
    }],
  };
  const unacceptedResult = updateTournamentMatchSchedule(unaccepted, "tournament-1", match.id, schedule);
  assert.equal(unacceptedResult.matches[0].scheduledDate, "");
  assert.match(unacceptedResult.notifications[0].body, /승인 중립 심판/);

  const conflict = {
    ...active,
    matches: [
      match,
      {
        ...match,
        id: "conflicting-match",
        tournamentId: "other-tournament",
        scheduledDate,
        scheduledTime: "14:05",
      },
    ],
  };
  const conflictResult = updateTournamentMatchSchedule(conflict, "tournament-1", match.id, schedule);
  assert.equal(conflictResult.matches[0].scheduledDate, "");
  assert.match(conflictResult.notifications[0].body, /일정이 겹칩니다/);

  const updated = updateTournamentMatchSchedule(active, "tournament-1", match.id, schedule);
  assert.equal(updated.matches[0].scheduledDate, scheduledDate);
  assert.equal(updated.matches[0].scheduledTime, "14:00");
});

test("심판 일정은 예상 경기 종료 시각과 맞닿으면 겹치지 않는다", () => {
  const match = {
    scheduledDate: "2026-08-01",
    scheduledTime: "14:00",
    rules: { periodCount: 1, periodMinutes: 12, overtimeMinutes: 3 },
  };
  assert.equal(doTournamentMatchSchedulesOverlap(match, {
    ...match,
    scheduledTime: "14:05",
  }), true);
  assert.equal(doTournamentMatchSchedulesOverlap(match, {
    ...match,
    scheduledTime: "14:20",
  }), false);
});

test("DB 권위 흐름은 비승인 대회에도 심판과 중립성·일정 충돌·시작 가드를 둔다", async () => {
  const [migration, consistencyMigration, ambiguityFixMigration, scopedVariableFixMigration] = await Promise.all([
    readSource("supabase/migrations/20260725023000_tournament_referee_sanction_flow.sql"),
    readSource("supabase/migrations/20260726090000_match_policy_consistency.sql"),
    readSource("supabase/migrations/20260727091000_fix_tournament_referee_variable_ambiguity.sql"),
    readSource("supabase/migrations/20260727092000_scope_tournament_referee_variables.sql"),
  ]);
  const server = await readSource("server/api/tournaments/sync-tournament.js");
  for (const action of [
    "approveTournamentReferee",
    "declineTournamentReferee",
    "inviteTournamentReferee",
    "approveTournamentRegion",
    "rejectTournamentRegion",
    "startCommunityTournament",
    "assignTournamentMatchReferee",
  ]) {
    assert.match(server, new RegExp(`"${action}"`));
    assert.match(migration, new RegExp(`'${action}'`));
  }
  assert.match(migration, /sanction_status not in \('approved', 'community'\)/);
  assert.match(migration, /'sanctionFactor', 0\.8/);
  assert.match(migration, /rankball_tournament_approval_ready\(tournament_row\.id\)/);
  assert.match(migration, /tournament_referee_schedule_conflict/);
  assert.match(migration, /tournament_referee_not_neutral/);
  assert.match(migration, /rankball_tournament_referee_eligible\(match_row\.referee_id, tournament_row\.end_date\)/);
  assert.match(migration, /rankball_assign_neutral_tournament_referee\(\s*tournament_row\.id,\s*match_row\.id,\s*match_row\.referee_id\s*\)/);
  assert.doesNotMatch(migration, /if match_row\.referee_id is null then\s*assignment_result/);
  assert.match(migration, /rankball_match_start_action_guarded_pre_tournament_referee/);
  assert.match(migration, /governanceVersion/);
  assert.match(consistencyMigration, /appointment\.ends_at >= case[\s\S]*p_through_date \+ 1/);
  assert.match(consistencyMigration, /appointment\.payload->>'region'/);
  assert.match(consistencyMigration, /tstzrange\([\s\S]*&& tstzrange\(/);
  assert.match(consistencyMigration, /referee_active_match_conflict/);
  assert.match(consistencyMigration, /tournament_referee_replacement_required/);
  assert.match(consistencyMigration, /new\.referee_absence_request is distinct from old\.referee_absence_request/);
  assert.match(consistencyMigration, /active_tournament_referee_decline_locked/);
  assert.doesNotMatch(consistencyMigration, /delete\s+from|drop\s+table|truncate\s+table/i);
  assert.match(ambiguityFixMigration, /pg_get_functiondef\(/);
  assert.match(ambiguityFixMigration, /#variable_conflict use_variable/);
  assert.match(ambiguityFixMigration, /execute function_definition/);
  assert.match(scopedVariableFixMigration, /safe_referee_ids jsonb/);
  assert.match(scopedVariableFixMigration, /referee_statuses = safe_referee_statuses/);
  assert.match(scopedVariableFixMigration, /replace\(function_definition, '#variable_conflict use_variable', ''\)/);
});
