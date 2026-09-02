import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  getKstDayStartIso,
  summarizeDeliveries,
  summarizeDurations,
} from "../server/api/directory/adminOperations.js";
import { MATCH_SCHEDULED_NOTICE_PREFIXES } from "../shared/lib/notifications.js";
import {
  normalizeAdminQueueFocus,
  normalizeAdminSection,
} from "../shared/lib/queryPolicy.js";

const root = new URL("../", import.meta.url);
const readSource = (path) => readFile(new URL(path, root), "utf8");

test("관리자 기본 진입과 큐 초점은 허용 목록으로 정규화한다", () => {
  assert.equal(normalizeAdminSection(), "operations");
  assert.equal(normalizeAdminSection("reports"), "reports");
  assert.equal(normalizeAdminSection("unknown"), "operations");
  assert.equal(normalizeAdminQueueFocus("urgent"), "urgent");
  assert.equal(normalizeAdminQueueFocus("unknown"), "");
});

test("오늘 집계 기준은 Asia/Seoul 자정이다", () => {
  assert.equal(getKstDayStartIso("2026-09-02T03:00:00.000Z"), "2026-09-01T15:00:00.000Z");
});

test("응답·처리 시간은 실제 양끝 타임스탬프가 있는 표본만 집계한다", () => {
  const rows = [
    { created_at: "2026-09-01T00:00:00Z", assigned_at: "2026-09-01T00:10:00Z", resolved_at: "2026-09-01T00:30:00Z" },
    { created_at: "2026-09-01T01:00:00Z", assigned_at: "2026-09-01T01:20:00Z", resolved_at: null },
    { created_at: "2026-09-01T02:00:00Z", assigned_at: "2026-09-01T01:00:00Z", resolved_at: "invalid" },
  ];
  assert.deepEqual(summarizeDurations(rows, "created_at", "assigned_at"), {
    averageMs: 15 * 60 * 1000,
    sampleCount: 2,
  });
  assert.deepEqual(summarizeDurations(rows, "created_at", "resolved_at"), {
    averageMs: 30 * 60 * 1000,
    sampleCount: 1,
  });
  assert.equal(summarizeDurations([], "created_at", "resolved_at"), null);
});

test("Discord와 리마인더 상태는 bounded delivery 표본에서만 계산한다", () => {
  const now = Date.parse("2026-09-02T03:00:00Z");
  const prefix = MATCH_SCHEDULED_NOTICE_PREFIXES[0];
  const rows = [
    { id: "discord-general-sent", status: "sent", sent_at: "2026-09-02T01:00:00Z" },
    { id: "discord-general-failed", status: "failed", failed_at: "2026-09-02T02:00:00Z" },
    { id: "discord-general-queued", status: "queued", send_at: "2026-09-02T02:30:00Z" },
    { id: `discord-${prefix}-one`, status: "sent", sent_at: "2026-09-02T02:50:00Z" },
  ];

  assert.deepEqual(summarizeDeliveries(rows, now), {
    available: true,
    sampleLimit: 200,
    sampledCount: 4,
    failedLast24h: 1,
    delayedCount: 1,
    lastSentAt: "2026-09-02T02:50:00Z",
  });
  assert.deepEqual(summarizeDeliveries(rows, now, true), {
    available: true,
    sampleLimit: 200,
    sampledCount: 1,
    failedLast24h: 0,
    delayedCount: 0,
    lastSentAt: "2026-09-02T02:50:00Z",
  });
});

test("신고 운영 변경은 서버 전용 원자적 RPC와 감사 로그를 사용한다", async () => {
  const [migration, endpoint, apiIndex, operationsPanel, reportsPanel] = await Promise.all([
    readSource("supabase/migrations/20260902120000_admin_operations_control.sql"),
    readSource("server/api/admin/report-operation.js"),
    readSource("api/index.js"),
    readSource("src/pages/AdminOperationsPanel.jsx"),
    readSource("src/pages/AdminReportsPanel.jsx"),
  ]);

  assert.match(migration, /for update/i);
  assert.match(migration, /rankball_admin_level_for_profile/);
  assert.match(migration, /report_already_assigned/);
  assert.match(migration, /insert into public\.admin_audit_log/i);
  assert.match(migration, /p_actor_admin_level\s+pg_catalog\.int4/i);
  assert.doesNotMatch(migration, /pg_catalog\.integer/i);
  assert.match(migration, /set search_path = ''/i);
  assert.match(migration, /grant execute[^;]+service_role/is);
  assert.doesNotMatch(migration, /^\s*(?:delete\s+from|truncate|drop\s+table)\b/im);
  assert.match(endpoint, /rankball_admin_report_operation/);
  assert.match(apiIndex, /\["\/admin\/report-operation", route\(adminReportOperation, \["POST"\], "admin"\)\]/);
  assert.match(operationsPanel, /긴급 신고/);
  assert.match(operationsPanel, /가장 오래된 미처리/);
  assert.match(reportsPanel, /대상/);
  assert.match(reportsPanel, /증거/);
  assert.match(reportsPanel, /courtCorrection\?\.evidenceUrl/);
  assert.match(reportsPanel, /settings\?\.courtReviews/);
  assert.match(reportsPanel, /처리 이력/);
});
