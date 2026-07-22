import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const PRODUCTION_RESET_CONFIRMATION = "RESET_PRODUCTION_GAME_DATA";
export const PRODUCTION_PROJECT_REF = "olzxextphxpniwiiwwda";

export const REQUIRED_MIGRATIONS = Object.freeze([
  "20260722225000",
  "20260722225500",
  "20260722225600",
  "20260722225700",
]);

export const DELETE_TABLES = Object.freeze([
  "admin_disciplinary_actions",
  "discord_notification_deliveries",
  "match_agreements",
  "match_approvals",
  "match_disputes",
  "match_player_competitive_snapshots",
  "match_players",
  "match_record_archives",
  "match_record_participants",
  "match_record_refresh_queue",
  "match_record_teams",
  "match_results",
  "matches",
  "notifications",
  "player_match_stats",
  "profile_match_summaries",
  "recruiting_applications",
  "recruiting_posts",
  "reports",
  "room_chat_messages",
  "room_discord_links",
  "room_feed_cards",
  "team_invitations",
  "tournament_teams",
  "tournaments",
  "user_room_feed",
]);

export const RATING_RESET_TABLES = Object.freeze([
  "affiliations",
  "approved_courts",
  "courts",
  "profiles",
  "teams",
]);

export const PRESERVE_TABLES = Object.freeze([
  "admin_appointments",
  "admin_audit_log",
  "court_facility_info",
  "court_import_batches",
  "court_import_rows",
  "court_name_change_log",
  "court_name_evidence",
  "court_requests",
  "court_reviews",
  "court_source_records",
  "favorites",
  "profile_icon_unlocks",
  "rating_policy",
  "referee_appointments",
  "referee_exam_attempts",
  "referee_requests",
  "seasons",
  "team_members",
]);

export const EXPECTED_PUBLIC_TABLES = Object.freeze(
  [...DELETE_TABLES, ...RATING_RESET_TABLES, ...PRESERVE_TABLES].sort(),
);

const MANAGEMENT_API_ORIGIN = "https://api.supabase.com";
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [key, ...valueParts] = line.split("=");
    if (!key || process.env[key]) continue;
    process.env[key] = valueParts.join("=").replace(/^["']|["']$/g, "");
  }
}

function readArgumentValue(argv, name) {
  const prefix = `${name}=`;
  const matched = argv.find((argument) => argument.startsWith(prefix));
  return matched ? matched.slice(prefix.length).trim() : "";
}

export function parseResetArguments(argv = []) {
  return {
    execute: argv.includes("--execute"),
    projectRef: readArgumentValue(argv, "--project-ref"),
    confirmation: readArgumentValue(argv, "--confirm-production-reset"),
  };
}

function getProjectRefFromUrl(value = "") {
  try {
    const hostname = new URL(value).hostname;
    const projectRef = hostname.endsWith(".supabase.co") ? hostname.split(".")[0] : "";
    return PROJECT_REF_PATTERN.test(projectRef) ? projectRef : "";
  } catch {
    return "";
  }
}

function readLinkedProjectRef() {
  const path = "supabase/.temp/project-ref";
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8").trim();
}

export function resolveProjectRef({ projectRef = "" } = {}) {
  const configuredCandidates = [
    process.env.SUPABASE_PROJECT_REF,
    process.env.SUPABASE_PROJECT_ID,
    getProjectRefFromUrl(process.env.SUPABASE_URL),
    getProjectRefFromUrl(process.env.VITE_SUPABASE_URL),
    readLinkedProjectRef(),
  ].map((value) => String(value || "").trim()).filter(Boolean);
  const configuredRefs = [...new Set(configuredCandidates.filter((value) => PROJECT_REF_PATTERN.test(value)))];
  const explicitRef = String(projectRef || "").trim();
  if (explicitRef && !PROJECT_REF_PATTERN.test(explicitRef)) throw new Error("--project-ref 형식이 올바르지 않습니다.");
  if (explicitRef && configuredRefs.some((value) => value !== explicitRef)) {
    throw new Error("--project-ref와 연결된 Supabase project ref가 다릅니다.");
  }
  if (explicitRef) return explicitRef;
  if (configuredRefs.length > 1) throw new Error("서로 다른 Supabase project ref가 설정되어 있습니다.");
  if (!configuredRefs[0]) throw new Error("Supabase project ref를 확인할 수 없습니다.");
  return configuredRefs[0];
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function quoteLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function makeSqlTextArray(values) {
  return `array[${values.map(quoteLiteral).join(", ")}]::text[]`;
}

export function buildBackupSchemaName(date = new Date()) {
  const timestamp = date.toISOString().replace(/\D/g, "").slice(0, 14);
  return `rankball_reset_backup_${timestamp}z`;
}

function getTableAction(tableName) {
  if (DELETE_TABLES.includes(tableName)) return "delete";
  if (RATING_RESET_TABLES.includes(tableName)) return "rating_reset";
  return "preserve";
}

export function validateRemoteCatalog(tableNames = [], foreignKeys = []) {
  const remote = [...new Set(tableNames)].sort();
  const missing = EXPECTED_PUBLIC_TABLES.filter((tableName) => !remote.includes(tableName));
  const unexpected = remote.filter((tableName) => !EXPECTED_PUBLIC_TABLES.includes(tableName));
  const unsafeInboundForeignKeys = foreignKeys.filter((foreignKey) => (
    DELETE_TABLES.includes(foreignKey.target_table)
      && !DELETE_TABLES.includes(foreignKey.source_table)
  ));
  return {
    ok: missing.length === 0 && unexpected.length === 0 && unsafeInboundForeignKeys.length === 0,
    missing,
    unexpected,
    unsafeInboundForeignKeys,
  };
}

export function validateRequiredMigrations(migrationVersions = []) {
  const applied = new Set(migrationVersions.map(String));
  const missing = REQUIRED_MIGRATIONS.filter((version) => !applied.has(version));
  return { ok: missing.length === 0, missing };
}

function buildCatalogAssertionSql() {
  const expected = makeSqlTextArray(EXPECTED_PUBLIC_TABLES);
  return `
do $catalog$
declare
  actual_tables text[];
  missing_tables text[];
  unexpected_tables text[];
begin
  select coalesce(array_agg(tablename order by tablename), '{}'::text[])
    into actual_tables
  from pg_catalog.pg_tables
  where schemaname = 'public';

  select coalesce(array_agg(expected_table), '{}'::text[])
    into missing_tables
  from unnest(${expected}) as expected_table
  where not (expected_table = any(actual_tables));

  select coalesce(array_agg(actual_table), '{}'::text[])
    into unexpected_tables
  from unnest(actual_tables) as actual_table
  where not (actual_table = any(${expected}));

  if cardinality(missing_tables) > 0 or cardinality(unexpected_tables) > 0 then
    raise exception 'rankball_reset_catalog_mismatch missing=% unexpected=%', missing_tables, unexpected_tables;
  end if;
end
$catalog$;`;
}

function buildManifestInsertSql(backupSchema, tableName) {
  const action = getTableAction(tableName);
  return `insert into ${quoteIdentifier(backupSchema)}.reset_manifest
    (table_name, action, source_count)
  select ${quoteLiteral(tableName)}, ${quoteLiteral(action)}, count(*)::bigint
  from public.${quoteIdentifier(tableName)};`;
}

function buildFullBackupSql(backupSchema, tableName) {
  return `create table ${quoteIdentifier(backupSchema)}.${quoteIdentifier(tableName)}
    as table public.${quoteIdentifier(tableName)} with data;
  update ${quoteIdentifier(backupSchema)}.reset_manifest
  set backup_count = (select count(*)::bigint from ${quoteIdentifier(backupSchema)}.${quoteIdentifier(tableName)})
  where table_name = ${quoteLiteral(tableName)};`;
}

function buildRatingSnapshotSql(backupSchema) {
  return `create table ${quoteIdentifier(backupSchema)}.affiliations_match_snapshot as
  select id, score, wins, losses, updated_at
  from public.affiliations;

create table ${quoteIdentifier(backupSchema)}.approved_courts_match_snapshot as
  select id, completed_match_count, recommendation_score, metrics_updated_at, updated_at
  from public.approved_courts;

create table ${quoteIdentifier(backupSchema)}.courts_match_snapshot as
  select id, completed_match_count, recommendation_score, metrics_updated_at
  from public.courts;

create table ${quoteIdentifier(backupSchema)}.profiles_rating_snapshot as
  select id, ratings, trust_score, streak, updated_at
  from public.profiles;

create table ${quoteIdentifier(backupSchema)}.teams_rating_snapshot as
  select id, mmr, wins, losses, updated_at
  from public.teams;

update ${quoteIdentifier(backupSchema)}.reset_manifest
set backup_count = (select count(*)::bigint from ${quoteIdentifier(backupSchema)}.affiliations_match_snapshot)
where table_name = 'affiliations';

update ${quoteIdentifier(backupSchema)}.reset_manifest
set backup_count = (select count(*)::bigint from ${quoteIdentifier(backupSchema)}.approved_courts_match_snapshot)
where table_name = 'approved_courts';

update ${quoteIdentifier(backupSchema)}.reset_manifest
set backup_count = (select count(*)::bigint from ${quoteIdentifier(backupSchema)}.courts_match_snapshot)
where table_name = 'courts';

update ${quoteIdentifier(backupSchema)}.reset_manifest
set backup_count = (select count(*)::bigint from ${quoteIdentifier(backupSchema)}.profiles_rating_snapshot)
where table_name = 'profiles';

update ${quoteIdentifier(backupSchema)}.reset_manifest
set backup_count = (select count(*)::bigint from ${quoteIdentifier(backupSchema)}.teams_rating_snapshot)
where table_name = 'teams';`;
}

function buildAfterCountSql(backupSchema, tableName) {
  return `update ${quoteIdentifier(backupSchema)}.reset_manifest
  set after_count = (select count(*)::bigint from public.${quoteIdentifier(tableName)})
  where table_name = ${quoteLiteral(tableName)};`;
}

export function buildProductionResetSql({ backupSchema, projectRef }) {
  if (!/^rankball_reset_backup_\d{14}z$/.test(backupSchema)) throw new Error("백업 스키마 이름이 안전하지 않습니다.");
  if (!PROJECT_REF_PATTERN.test(projectRef)) throw new Error("Supabase project ref가 올바르지 않습니다.");

  const targetLocks = [...DELETE_TABLES].sort().map((tableName) => `public.${quoteIdentifier(tableName)}`).join(", ");
  const resetLocks = RATING_RESET_TABLES.map((tableName) => `public.${quoteIdentifier(tableName)}`).join(", ");
  const truncateTargets = [...DELETE_TABLES].sort().map((tableName) => `public.${quoteIdentifier(tableName)}`).join(",\n  ");
  const manifestInserts = EXPECTED_PUBLIC_TABLES.map((tableName) => buildManifestInsertSql(backupSchema, tableName)).join("\n");
  const fullBackups = [...DELETE_TABLES].sort().map((tableName) => buildFullBackupSql(backupSchema, tableName)).join("\n");
  const afterCounts = EXPECTED_PUBLIC_TABLES.map((tableName) => buildAfterCountSql(backupSchema, tableName)).join("\n");

  return `begin isolation level serializable;
set local lock_timeout = '10s';
set local statement_timeout = '10min';
select pg_advisory_xact_lock(hashtext('rankball-production-game-data-reset-v1'));

${buildCatalogAssertionSql()}

lock table ${targetLocks} in access exclusive mode;
lock table ${resetLocks} in share row exclusive mode;

create schema ${quoteIdentifier(backupSchema)};
revoke all on schema ${quoteIdentifier(backupSchema)} from public, anon, authenticated;

create table ${quoteIdentifier(backupSchema)}.reset_run (
  project_ref text not null,
  started_at timestamptz not null,
  completed_at timestamptz,
  confirmation text not null
);

insert into ${quoteIdentifier(backupSchema)}.reset_run
  (project_ref, started_at, confirmation)
values
  (${quoteLiteral(projectRef)}, clock_timestamp(), ${quoteLiteral(PRODUCTION_RESET_CONFIRMATION)});

create table ${quoteIdentifier(backupSchema)}.reset_manifest (
  table_name text primary key,
  action text not null check (action in ('delete', 'rating_reset', 'preserve')),
  source_count bigint not null,
  backup_count bigint,
  after_count bigint
);

create table ${quoteIdentifier(backupSchema)}.column_snapshot as
select table_name, ordinal_position, column_name, data_type, udt_name, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = any(${makeSqlTextArray(EXPECTED_PUBLIC_TABLES)})
order by table_name, ordinal_position;

create table ${quoteIdentifier(backupSchema)}.foreign_key_snapshot as
select
  constraint_row.conname as constraint_name,
  source_namespace.nspname as source_schema,
  source.relname as source_table,
  target_namespace.nspname as target_schema,
  target.relname as target_table,
  pg_get_constraintdef(constraint_row.oid, true) as definition
from pg_constraint constraint_row
join pg_class source on source.oid = constraint_row.conrelid
join pg_namespace source_namespace on source_namespace.oid = source.relnamespace
join pg_class target on target.oid = constraint_row.confrelid
join pg_namespace target_namespace on target_namespace.oid = target.relnamespace
where constraint_row.contype = 'f'
  and (source_namespace.nspname = 'public' or target_namespace.nspname = 'public');

${manifestInserts}

${fullBackups}

${buildRatingSnapshotSql(backupSchema)}

revoke all on all tables in schema ${quoteIdentifier(backupSchema)} from public, anon, authenticated;

truncate table
  ${truncateTargets}
restart identity;

update public.affiliations
set score = 0,
    wins = 0,
    losses = 0,
    updated_at = now()
where score is distinct from 0
   or wins is distinct from 0
   or losses is distinct from 0;

update public.approved_courts
set completed_match_count = 0,
    recommendation_score = round(adjusted_rating::numeric, 3),
    metrics_updated_at = now()
where completed_match_count is distinct from 0
   or recommendation_score is distinct from round(adjusted_rating::numeric, 3);

update public.courts
set completed_match_count = 0,
    recommendation_score = round(adjusted_rating::numeric, 3),
    metrics_updated_at = now()
where completed_match_count is distinct from 0
   or recommendation_score is distinct from round(adjusted_rating::numeric, 3);

update public.profiles
set ratings = '{"integrated":1200,"modes":{"1v1":1200,"2v2":1200,"3v3":1200,"5v5":1200}}'::jsonb,
    trust_score = 80,
    streak = 0,
    updated_at = now();

update public.teams
set mmr = 1200,
    wins = 0,
    losses = 0,
    updated_at = now();

${afterCounts}

do $verify$
declare
  failed_backup text[];
  nonempty_deleted text[];
  changed_preserved text[];
  changed_reset_counts text[];
  invalid_affiliations bigint;
  invalid_approved_courts bigint;
  invalid_courts bigint;
  invalid_profiles bigint;
  invalid_teams bigint;
begin
  select coalesce(array_agg(table_name order by table_name), '{}'::text[])
    into failed_backup
  from ${quoteIdentifier(backupSchema)}.reset_manifest
  where action in ('delete', 'rating_reset')
    and backup_count is distinct from source_count;

  select coalesce(array_agg(table_name order by table_name), '{}'::text[])
    into nonempty_deleted
  from ${quoteIdentifier(backupSchema)}.reset_manifest
  where action = 'delete'
    and after_count <> 0;

  select coalesce(array_agg(table_name order by table_name), '{}'::text[])
    into changed_preserved
  from ${quoteIdentifier(backupSchema)}.reset_manifest
  where action = 'preserve'
    and after_count is distinct from source_count;

  select coalesce(array_agg(table_name order by table_name), '{}'::text[])
    into changed_reset_counts
  from ${quoteIdentifier(backupSchema)}.reset_manifest
  where action = 'rating_reset'
    and after_count is distinct from source_count;

  select count(*)::bigint into invalid_affiliations
  from public.affiliations
  where score is distinct from 0
     or wins is distinct from 0
     or losses is distinct from 0;

  select count(*)::bigint into invalid_approved_courts
  from public.approved_courts
  where completed_match_count is distinct from 0
     or recommendation_score is distinct from round(adjusted_rating::numeric, 3);

  select count(*)::bigint into invalid_courts
  from public.courts
  where completed_match_count is distinct from 0
     or recommendation_score is distinct from round(adjusted_rating::numeric, 3);

  select count(*)::bigint into invalid_profiles
  from public.profiles
  where ratings is distinct from '{"integrated":1200,"modes":{"1v1":1200,"2v2":1200,"3v3":1200,"5v5":1200}}'::jsonb
     or trust_score is distinct from 80
     or streak is distinct from 0;

  select count(*)::bigint into invalid_teams
  from public.teams
  where mmr is distinct from 1200
     or wins is distinct from 0
     or losses is distinct from 0;

  if cardinality(failed_backup) > 0 then
    raise exception 'rankball_reset_backup_count_mismatch tables=%', failed_backup;
  end if;
  if cardinality(nonempty_deleted) > 0 then
    raise exception 'rankball_reset_nonempty_tables tables=%', nonempty_deleted;
  end if;
  if cardinality(changed_preserved) > 0 then
    raise exception 'rankball_reset_preserved_count_changed tables=%', changed_preserved;
  end if;
  if cardinality(changed_reset_counts) > 0 then
    raise exception 'rankball_reset_identity_count_changed tables=%', changed_reset_counts;
  end if;
  if invalid_affiliations > 0 or invalid_approved_courts > 0 or invalid_courts > 0 or invalid_profiles > 0 or invalid_teams > 0 then
    raise exception 'rankball_reset_rating_verification_failed affiliations=% approved_courts=% courts=% profiles=% teams=%',
      invalid_affiliations,
      invalid_approved_courts,
      invalid_courts,
      invalid_profiles,
      invalid_teams;
  end if;
end
$verify$;

update ${quoteIdentifier(backupSchema)}.reset_run
set completed_at = clock_timestamp();

commit;

select
  ${quoteLiteral(backupSchema)}::text as backup_schema,
  (select count(*)::int from ${quoteIdentifier(backupSchema)}.reset_manifest where action = 'delete') as deleted_table_count,
  (select coalesce(sum(source_count), 0)::bigint from ${quoteIdentifier(backupSchema)}.reset_manifest where action = 'delete') as deleted_row_count,
  (select source_count from ${quoteIdentifier(backupSchema)}.reset_manifest where table_name = 'profiles') as reset_profile_count,
  (select source_count from ${quoteIdentifier(backupSchema)}.reset_manifest where table_name = 'teams') as reset_team_count;`;
}

async function managementRequest(path, { method = "GET", body } = {}) {
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  if (!accessToken) throw new Error("SUPABASE_ACCESS_TOKEN 환경변수가 필요합니다.");
  const response = await fetch(`${MANAGEMENT_API_ORIGIN}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const responseText = await response.text();
  const responseBody = responseText ? JSON.parse(responseText) : null;
  if (!response.ok) {
    const message = responseBody?.message || responseBody?.error || `HTTP ${response.status}`;
    throw new Error(`Supabase Management API 요청 실패: ${message}`);
  }
  return responseBody;
}

async function runDatabaseQuery(projectRef, query) {
  return managementRequest(`/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    body: { query },
  });
}

function normalizeRows(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

async function readRemoteCatalog(projectRef) {
  const tables = normalizeRows(await runDatabaseQuery(projectRef, `
select tablename as table_name
from pg_catalog.pg_tables
where schemaname = 'public'
order by tablename;`));
  const foreignKeys = normalizeRows(await runDatabaseQuery(projectRef, `
select
  source.relname as source_table,
  target.relname as target_table,
  constraint_row.conname as constraint_name,
  pg_get_constraintdef(constraint_row.oid, true) as definition
from pg_constraint constraint_row
join pg_class source on source.oid = constraint_row.conrelid
join pg_namespace source_namespace on source_namespace.oid = source.relnamespace
join pg_class target on target.oid = constraint_row.confrelid
join pg_namespace target_namespace on target_namespace.oid = target.relnamespace
where constraint_row.contype = 'f'
  and source_namespace.nspname = 'public'
order by source.relname, constraint_row.conname;`));
  const migrations = normalizeRows(await runDatabaseQuery(projectRef, `
select version
from supabase_migrations.schema_migrations
where version = any(${makeSqlTextArray(REQUIRED_MIGRATIONS)})
order by version;`));
  const tableNames = tables.map((row) => row.table_name);
  const countQuery = tableNames.map((tableName) => (
    `select ${quoteLiteral(tableName)}::text as table_name, count(*)::bigint as row_count from public.${quoteIdentifier(tableName)}`
  )).join(" union all ");
  const counts = normalizeRows(await runDatabaseQuery(projectRef, countQuery));
  return { tableNames, foreignKeys, counts, migrationVersions: migrations.map((row) => row.version) };
}

function summarizeCounts(counts = []) {
  const countMap = Object.fromEntries(counts.map((row) => [row.table_name, Number(row.row_count || 0)]));
  const sum = (tables) => tables.reduce((total, tableName) => total + (countMap[tableName] || 0), 0);
  return {
    deleteRows: sum(DELETE_TABLES),
    resetProfiles: countMap.profiles || 0,
    resetTeams: countMap.teams || 0,
    preservedRows: sum(PRESERVE_TABLES),
    tables: EXPECTED_PUBLIC_TABLES.map((tableName) => ({
      table: tableName,
      action: getTableAction(tableName),
      rows: countMap[tableName] || 0,
    })),
  };
}

export function assertExecutionConfirmation(args, resolvedProjectRef) {
  if (!args.execute) return;
  if (!args.projectRef) throw new Error("실행 시 --project-ref=<production-ref>를 직접 지정해야 합니다.");
  if (args.projectRef !== resolvedProjectRef) throw new Error("지정한 production project ref가 실제 대상과 다릅니다.");
  if (resolvedProjectRef !== PRODUCTION_PROJECT_REF) throw new Error("승인된 production project ref가 아닙니다.");
  if (args.confirmation !== PRODUCTION_RESET_CONFIRMATION) {
    throw new Error(`실행 시 --confirm-production-reset=${PRODUCTION_RESET_CONFIRMATION}가 필요합니다.`);
  }
}

async function main() {
  loadEnvFile(".env.local");
  loadEnvFile(".env.production");

  const args = parseResetArguments(process.argv.slice(2));
  const projectRef = resolveProjectRef(args);
  assertExecutionConfirmation(args, projectRef);

  const project = await managementRequest(`/v1/projects/${projectRef}`);
  const catalog = await readRemoteCatalog(projectRef);
  const catalogValidation = validateRemoteCatalog(catalog.tableNames, catalog.foreignKeys);
  const migrationValidation = validateRequiredMigrations(catalog.migrationVersions);
  const countSummary = summarizeCounts(catalog.counts);
  const target = {
    environment: "production",
    projectRef,
    name: project?.name ?? "",
    region: project?.region ?? "",
    status: project?.status ?? "",
  };

  console.log(JSON.stringify({
    ok: catalogValidation.ok && migrationValidation.ok,
    mode: args.execute ? "execute" : "dry-run",
    target,
    catalogValidation,
    migrationValidation,
    countSummary,
    authUsers: "untouched",
    r2Objects: "untouched",
  }, null, 2));

  if (!catalogValidation.ok) throw new Error("원격 public 스키마가 초기화 allowlist와 다릅니다. 실행을 중단합니다.");
  if (!migrationValidation.ok) throw new Error("필수 경기 정책 migration이 아직 적용되지 않았습니다. 실행을 중단합니다.");
  if (!args.execute) {
    console.log(`DRY RUN: 실제 변경 없음. 실행하려면 --execute --project-ref=${projectRef} --confirm-production-reset=${PRODUCTION_RESET_CONFIRMATION}`);
    return;
  }

  const backupSchema = buildBackupSchemaName();
  const sql = buildProductionResetSql({ backupSchema, projectRef });
  const result = await runDatabaseQuery(projectRef, sql);
  console.log(JSON.stringify({ ok: true, mode: "executed", target, result }, null, 2));
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
