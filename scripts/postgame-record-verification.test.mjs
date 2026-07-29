import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  getDuePostgameRecordNotifications,
  getPostgameRecordDecisionEligibility,
  getPostgameRecordVerification,
} from "../src/lib/postgameRecordVerification.js";
import { SERVER_RATING_AUTHORITY } from "../server/lib/ratingAuthority.js";

const submittedAt = "2026-07-23T00:00:00.000Z";
const players = Array.from({ length: 14 }, (_item, index) => `player-${index + 1}`);

function makeRecord(overrides = {}) {
  return {
    status: "approval",
    recordType: "match_record",
    mode: "5v5",
    ranked: true,
    createdBy: players[0],
    teamA: { players: players.slice(0, 7) },
    teamB: { players: players.slice(7) },
    result: { scoreA: 21, scoreB: 18, submittedAt },
    rules: {
      recordType: "match_record",
      participantAcceptedIds: players,
    },
    approvals: {
      teamA: players.slice(0, 7),
      teamB: players.slice(7),
    },
    ...overrides,
  };
}

test("14명 중 10명 이상 확인하면 2/3 기준을 충족한다", () => {
  const match = makeRecord({
    approvals: { teamA: players.slice(0, 7), teamB: players.slice(7, 10) },
  });
  const status = getPostgameRecordVerification(match, { now: "2026-07-23T00:10:00.000Z" });
  assert.equal(status.verificationStatus, "confirmed");
  assert.equal(status.approvalThreshold, 10);
  assert.equal(status.canConfirmFully, true);
  assert.equal(status.canAutoApprove, false);
  assert.deepEqual(status.unconfirmedIds, players.slice(10));
  assert.deepEqual(status.verifiedPlayerIds, players.slice(0, 10));
});

test("1v1·2v2·3v3·5v5 확인 기준과 개인 MMR 배율을 고정한다", () => {
  for (const [mode, participantCount, threshold, scale] of [
    ["1v1", 2, 2, 0.1],
    ["2v2", 4, 3, 0.2],
    ["3v3", 6, 4, 0.35],
    ["5v5", 10, 7, 0.5],
  ]) {
    const modePlayers = players.slice(0, participantCount);
    const teamSize = participantCount / 2;
    const approved = modePlayers.slice(0, threshold);
    const status = getPostgameRecordVerification(makeRecord({
      mode,
      teamA: { players: modePlayers.slice(0, teamSize) },
      teamB: { players: modePlayers.slice(teamSize) },
      rules: { recordType: "match_record", participantAcceptedIds: approved },
      approvals: { teamA: approved.slice(0, teamSize), teamB: approved.slice(teamSize) },
    }));
    assert.equal(status.approvalThreshold, threshold);
    assert.equal(status.mmrScale, undefined);
    assert.equal(SERVER_RATING_AUTHORITY.getPostgameRecordMmrScale({ mode }), scale);
    assert.equal(status.canApplyPersonalMmr, true);
    assert.equal(status.canApplyTeamMmr, false);
  }
});

test("사후 기록 24시간은 결과 제출 시각부터 계산한다", () => {
  const status = getPostgameRecordVerification(makeRecord({
    createdAt: "2026-07-22T23:00:00.000Z",
    result: { scoreA: 21, scoreB: 18, submittedAt: "2026-07-23T12:00:00.000Z" },
    approvals: { teamA: players.slice(0, 7), teamB: players.slice(7, 9) },
  }), { now: "2026-07-23T23:00:00.000Z" });
  assert.equal(status.expired, false);
  assert.equal(status.verificationStatus, "partial");
  assert.equal(status.confirmationOpenedAt, "2026-07-23T12:00:00.000Z");
});

test("24시간 뒤 2/3 미달이면 확인 부족으로 남기고 무응답자를 승인하지 않는다", () => {
  const match = makeRecord({
    rules: { recordType: "match_record", participantAcceptedIds: players.slice(0, 9) },
    approvals: { teamA: players.slice(0, 7), teamB: players.slice(7, 9) },
  });
  const status = getPostgameRecordVerification(match, { now: "2026-07-24T00:00:00.000Z" });
  assert.equal(status.expired, true);
  assert.equal(status.requiresReview, false);
  assert.equal(status.verificationStatus, "insufficient");
  assert.deepEqual(status.unconfirmedIds, players.slice(9));
  assert.deepEqual(status.verifiedPlayerIds, players.slice(0, 9));
  assert.equal(status.canConfirmFully, false);
  assert.equal(status.canAutoFinalize, false);
});

test("명시적으로 반대하면 disputed가 되고 전체 통계 확정을 막는다", () => {
  const match = makeRecord({ recordRejectedIds: [players[13]] });
  const status = getPostgameRecordVerification(match);
  assert.equal(status.verificationStatus, "disputed");
  assert.deepEqual(status.rejectedIds, [players[13]]);
  assert.equal(status.canConfirmFully, false);
  assert.ok(status.playerStatExcludedIds.includes(players[13]));
});

test("사후 기록방은 개인 스탯을 생성하지 않는다", () => {
  const match = makeRecord({
    rules: { recordType: "match_record", participantAcceptedIds: [] },
    approvals: { teamA: players.slice(0, 7), teamB: players.slice(7, 13) },
  });
  const status = getPostgameRecordVerification(match, { now: "2026-07-23T00:10:00.000Z" });
  assert.deepEqual(status.playerStatEligibleIds, []);
  assert.deepEqual(status.participationUnconfirmedIds, [players[13]]);
  assert.deepEqual(status.playerStatExcludedIds, players);
});

test("사후 기록은 확인자 개인 MMR만 모드별 비율로 반영하고 팀 MMR은 금지한다", () => {
  const status = getPostgameRecordVerification(makeRecord());
  assert.equal(status.verificationStatus, "confirmed");
  assert.equal(status.ranked, true);
  assert.equal(status.mmrScale, undefined);
  assert.equal(SERVER_RATING_AUTHORITY.getPostgameRecordMmrScale({ mode: "5v5" }), 0.5);
  assert.equal(status.mmrPolicy, "verified_participants_partial");
  assert.equal(status.canApplyPersonalMmr, true);
  assert.equal(status.canApplyTeamMmr, false);
});

test("본인이 아닌 참가자의 승인 대리는 허용하지 않는다", () => {
  assert.equal(getPostgameRecordDecisionEligibility(makeRecord(), players[13]).allowed, true);
  assert.deepEqual(
    getPostgameRecordDecisionEligibility(makeRecord(), "room-owner-not-player"),
    { allowed: false, reason: "실제 참가자만 본인의 참가와 결과를 확인할 수 있음" },
  );
});

test("즉시·1시간 알림은 기준 미달 기록의 미확인자에게만 보낸다", () => {
  const match = makeRecord({
    approvals: { teamA: players.slice(0, 7), teamB: players.slice(7, 9) },
    recordNotificationSentKeys: ["postgame_record_approval_0m"],
  });
  const notifications = getDuePostgameRecordNotifications(match, { now: "2026-07-23T01:01:00.000Z" });
  assert.deepEqual(notifications.map((event) => event.afterMinutes), [60]);
  assert.ok(notifications.every((event) => event.targetUserIds.length === 5));
});

test("24시간 만료 후에는 확인 독촉 알림을 더 만들지 않는다", () => {
  const match = makeRecord({
    approvals: { teamA: players.slice(0, 7), teamB: players.slice(7, 9) },
  });
  const notifications = getDuePostgameRecordNotifications(match, { now: "2026-07-24T00:00:00.000Z" });
  assert.deepEqual(notifications, []);
});

test("별도 참가 확인 경로 없이 본인 승인 한 번으로 참가와 결과를 함께 확인한다", async () => {
  const [serverSource, clientSource, singleApprovalMigration, consistencyMigration] = await Promise.all([
    readFile(new URL("../server/api/matches/sync-match.js", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/useAppData.js", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260723114000_match_record_single_final_approval.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260726090000_match_policy_consistency.sql", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(serverSource, /rankball_match_record_participation_action/);
  assert.doesNotMatch(clientSource, /confirmMatchRecordParticipation/);
  assert.match(serverSource, /MATCH_RECORD_APPROVAL_NOTICE_PREFIXES/);
  assert.match(serverSource, /getPostgameRecordVerification/);
  assert.match(serverSource, /POSTGAME_RECORD_REMINDER_MINUTES\.forEach/);
  assert.match(serverSource, /\["submitMatchResult", "approveMatch", "finalizeMatch"\]/);
  assert.match(serverSource, /\["submitMatchResult", "approveMatch", "finalizeMatch", "resolveMatchDispute", "forfeitTournamentMatch"\]\.includes\(operation\.action\)/);
  assert.match(singleApprovalMigration, /match_record_participation_required/);
  assert.match(singleApprovalMigration, /execute replace/);
  assert.match(singleApprovalMigration, /recordApprovalMode/);
  assert.match(singleApprovalMigration, /recordApproverIds/);
  assert.match(singleApprovalMigration, /update public\.matches match_row/);
  assert.doesNotMatch(singleApprovalMigration, /delete\s+from|drop\s+table|truncate\s+table/i);
  assert.match(consistencyMigration, /match_auto_finalization_not_due/);
  assert.match(consistencyMigration, /rankball_normalize_dispute_minutes\(current_match\.dispute_minutes\)/);
  assert.match(consistencyMigration, /now_at < result_submitted_at \+ make_interval/);
  assert.match(consistencyMigration, /revoke all on function public\.rankball_match_record_participation_action/);
  assert.doesNotMatch(consistencyMigration, /delete\s+from|drop\s+table|truncate\s+table/i);
});
test("개인 기록만 생성자 본인 스탯을 저장하고 무심판 일반 경기 스탯은 계속 차단한다", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20260727131000_personal_record_stat_guard_exception.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /match_record_type in \('solo', 'personal_record'\)/);
  assert.match(migration, /new\.user_id = match_creator_id/);
  assert.match(migration, /new\.recorded_by/);
  assert.match(migration, /no_referee_personal_stats_forbidden/);
  assert.doesNotMatch(migration, /delete\s+from|drop\s+table|truncate\s+table/i);
});

test("개인 기록 공개 범위와 별도 통계는 공식 통계·업적에서 분리된다", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20260727132000_personal_record_visibility_and_summary.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /profile_personal_record_summaries/);
  assert.match(migration, /record_type text not null default 'match'/);
  assert.match(migration, /visibility text not null default 'private'/);
  assert.match(migration, /owner_profile_id text/);
  assert.match(migration, /not in \('solo', 'personal_record'\)/);
  assert.match(migration, /match_row\.created_by = profile_id/);
  assert.doesNotMatch(migration, /delete\s+from|drop\s+table|truncate\s+table/i);
});

test("referee stat submissions preserve the authoritative team score", async () => {
  const repository = await readFile(new URL("../src/data/repository.js", import.meta.url), "utf8");
  const matchUtils = await readFile(new URL("../shared/lib/matchUtils.js", import.meta.url), "utf8");

  assert.match(repository, /matchRecordRoom \? result\.scoreA : currentResult\?\.scoreA/);
  assert.match(repository, /matchRecordRoom \? result\.scoreB : currentResult\?\.scoreB/);
  assert.doesNotMatch(repository, /const nextScoreA = getMergedResultScore/);
  assert.match(matchUtils, /const canEnterSharedRecordScore = Boolean/);
  assert.match(matchUtils, /match\.rules\?\.recordSetupReady === true/);
  assert.match(matchUtils, /match\.status === "disputed"[\s\S]*\? \[\]/);
});

test("통합 확정 migration은 3분 수동 승인과 24시간·2/3 사후 기록 정책을 강제한다", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20260728150000_unified_match_finalization_policy.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /p_disputes_acknowledged boolean/);
  assert.match(migration, /submitted_at \+ interval '3 minutes'/);
  assert.match(migration, /manualFinalizationAudit/);
  assert.match(migration, /ceil\(required_count \* 2\.0 \/ 3\.0\)/);
  assert.match(migration, /current_match\.created_at \+ interval '24 hours'/);
  assert.match(migration, /when '1v1' then 0\.10/);
  assert.match(migration, /when '5v5' then 0\.50/);
  assert.match(migration, /match_record_mmr_audits/);
  assert.match(migration, /50 - used_mode_delta/);
  assert.match(migration, /30 - used_integrated_delta/);
  assert.match(migration, /current_match\.rules->>'recordType'.*<> 'match_record'/s);
  assert.doesNotMatch(migration, /insert into public\.player_match_stats/i);
  assert.doesNotMatch(migration, /delete\s+from|drop\s+table|truncate\s+table/i);
});
