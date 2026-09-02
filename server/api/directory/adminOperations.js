import { MATCH_SCHEDULED_NOTICE_PREFIXES } from "../../../shared/lib/notifications.js";
import { DISCORD_DELIVERY_COLUMNS } from "../../../shared/lib/repositoryColumns.js";
import { REQUIRED_COLUMNS } from "../system/schemaHealthRequirements.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const DELIVERY_SAMPLE_LIMIT = 200;

export function getKstDayStartIso(now = Date.now()) {
  const date = new Date(now);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return new Date(`${values.year}-${values.month}-${values.day}T00:00:00+09:00`).toISOString();
}

export function summarizeDurations(rows = [], startKey, endKey) {
  const values = rows.flatMap((row) => {
    const start = new Date(row?.[startKey] ?? "").getTime();
    const end = new Date(row?.[endKey] ?? "").getTime();
    return Number.isFinite(start) && Number.isFinite(end) && end >= start ? [end - start] : [];
  });
  if (!values.length) return null;
  return {
    averageMs: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length),
    sampleCount: values.length,
  };
}

async function readCount(query) {
  const { count, error } = await query;
  if (error) throw error;
  return Number(count ?? 0);
}

async function readOldestPending(supabase) {
  const { data, error } = await supabase
    .from("reports")
    .select("id,created_at")
    .eq("status", "open")
    .order("created_at", { ascending: true, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? { id: data.id, createdAt: data.created_at } : null;
}

async function readSchemaStatus(supabase) {
  const checks = await Promise.all(Object.entries(REQUIRED_COLUMNS).map(async ([table, columns]) => {
    const { error } = await supabase.from(table).select(columns.join(","), { head: true }).limit(1);
    return { table, ready: !error };
  }));
  const failedTables = checks.filter((check) => !check.ready).map((check) => check.table);
  return {
    ready: failedTables.length === 0,
    checkedCount: checks.length,
    failedCount: failedTables.length,
    failedTables,
  };
}

function getNoticePrefix(delivery = {}) {
  const explicit = String(delivery.payload?.noticePrefix ?? "").trim();
  if (explicit) return explicit;
  return MATCH_SCHEDULED_NOTICE_PREFIXES.find((prefix) => String(delivery.id ?? "").startsWith(`discord-${prefix}-`)) ?? "";
}

export function summarizeDeliveries(rows = [], now = Date.now(), reminderOnly = false) {
  const scoped = reminderOnly
    ? rows.filter((row) => MATCH_SCHEDULED_NOTICE_PREFIXES.includes(getNoticePrefix(row)))
    : rows;
  const lastDay = now - DAY_MS;
  const sentRows = scoped.filter((row) => Number.isFinite(new Date(row.sent_at ?? "").getTime()));
  const failedRows = scoped.filter((row) => new Date(row.failed_at ?? row.updated_at ?? "").getTime() >= lastDay && row.status === "failed");
  const delayedRows = scoped.filter((row) => row.status === "queued" && new Date(row.send_at ?? row.queued_at ?? "").getTime() < now);
  return {
    available: true,
    sampleLimit: DELIVERY_SAMPLE_LIMIT,
    sampledCount: scoped.length,
    failedLast24h: failedRows.length,
    delayedCount: delayedRows.length,
    lastSentAt: sentRows.sort((a, b) => new Date(b.sent_at) - new Date(a.sent_at))[0]?.sent_at ?? null,
  };
}

async function readDeliveryStatus(supabase, now) {
  const { data, error } = await supabase
    .from("discord_notification_deliveries")
    .select(DISCORD_DELIVERY_COLUMNS)
    .order("updated_at", { ascending: false, nullsFirst: false })
    .limit(DELIVERY_SAMPLE_LIMIT);
  if (error) {
    return {
      discordBridge: { available: false },
      reminderWorker: { available: false },
    };
  }
  return {
    discordBridge: summarizeDeliveries(data ?? [], now, false),
    reminderWorker: summarizeDeliveries(data ?? [], now, true),
  };
}

export async function loadAdminOperations(supabase, { now = Date.now() } = {}) {
  const todayStart = getKstDayStartIso(now);
  const staleBefore = new Date(now - DAY_MS).toISOString();
  const reportCount = (configure) => {
    let query = supabase.from("reports").select("id", { count: "exact", head: true });
    return readCount(configure(query));
  };
  const [urgent, pending, unassigned, stale, receivedToday, processedToday, oldestPending, durationResult, schema, delivery] = await Promise.all([
    reportCount((query) => query.eq("status", "open").eq("priority", "urgent")),
    reportCount((query) => query.eq("status", "open")),
    reportCount((query) => query.eq("status", "open").is("assigned_to", null)),
    reportCount((query) => query.eq("status", "open").lt("created_at", staleBefore)),
    reportCount((query) => query.gte("created_at", todayStart)),
    reportCount((query) => query.gte("resolved_at", todayStart)),
    readOldestPending(supabase),
    supabase.from("reports").select("created_at,assigned_at,resolved_at").or("assigned_at.not.is.null,resolved_at.not.is.null").order("updated_at", { ascending: false }).limit(200),
    readSchemaStatus(supabase),
    readDeliveryStatus(supabase, now),
  ]);
  if (durationResult.error) throw durationResult.error;
  const durationRows = durationResult.data ?? [];
  return {
    generatedAt: new Date(now).toISOString(),
    metrics: { urgent, pending, unassigned, stale, receivedToday, processedToday, oldestPending },
    timings: {
      firstResponse: summarizeDurations(durationRows, "created_at", "assigned_at"),
      processing: summarizeDurations(durationRows, "created_at", "resolved_at"),
    },
    systems: { schema, ...delivery },
  };
}
