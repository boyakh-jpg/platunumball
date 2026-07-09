import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const confirmed = process.env.RANKBALL_CONFIRM_AUTH_BULK === "rankball";
const cleanupMode = process.argv.includes("--cleanup");
const hasSupabaseCredentials = Boolean(url && serviceRoleKey);

if (!hasSupabaseCredentials && confirmed) {
  console.error("SUPABASE_URL/VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}

const supabase = hasSupabaseCredentials ? createClient(url, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
}) : null;

const ACCOUNT_COUNT = readIntegerEnv("RANKBALL_AUTH_BULK_COUNT", 150);
const ACCOUNT_START = readIntegerEnv("RANKBALL_AUTH_BULK_START", 1);
const LOGIN_PREFIX = process.env.RANKBALL_AUTH_BULK_PREFIX || "rankball-integrity";
const PROFILE_PREFIX = process.env.RANKBALL_AUTH_BULK_PROFILE_PREFIX || "seed-integrity-u";
const EMAIL_DOMAIN = process.env.RANKBALL_TEST_AUTH_EMAIL_DOMAIN || "rankball.test";
const DEFAULT_PASSWORD = process.env.RANKBALL_AUTH_BULK_PASSWORD || process.env.RANKBALL_TEST_PASSWORD || "test-0000";
const NOW = new Date().toISOString();

function readIntegerEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function pad(value) {
  return String(value).padStart(3, "0");
}

function buildAccounts() {
  return Array.from({ length: ACCOUNT_COUNT }, (_, index) => {
    const number = ACCOUNT_START + index;
    const suffix = pad(number);
    const testLoginId = `${LOGIN_PREFIX}-${suffix}`.toLowerCase();
    const profileId = `${PROFILE_PREFIX}${suffix}`;
    const hashtag = `#${LOGIN_PREFIX.replace(/[^a-z0-9]/gi, "")}${suffix}`.toLowerCase();
    const trustScore = number % 10 === 0 ? 35 : number % 7 === 0 ? 60 : 90;
    return {
      number,
      suffix,
      profileId,
      testLoginId,
      email: `${testLoginId}@${EMAIL_DOMAIN}`,
      password: DEFAULT_PASSWORD,
      name: `무결성테스트 ${suffix}`,
      hashtag,
      trustScore,
      position: ["PG", "SG", "SF", "PF", "C"][index % 5],
      avatarColor: ["#ef4444", "#f97316", "#14b8a6", "#3b82f6", "#8b5cf6"][index % 5],
    };
  });
}

async function listAuthUsersByEmail() {
  if (!supabase) return new Map();
  const byEmail = new Map();
  const perPage = 1000;
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = data?.users ?? [];
    users.forEach((user) => {
      if (user.email) byEmail.set(user.email.toLowerCase(), user);
    });
    if (users.length < perPage) break;
  }
  return byEmail;
}

async function ensureAuthUsers(accounts) {
  const existingByEmail = await listAuthUsersByEmail();
  const results = [];

  for (const account of accounts) {
    const existing = existingByEmail.get(account.email.toLowerCase());
    if (!confirmed) {
      results.push({ email: account.email, profileId: account.profileId, action: existing ? "would-update" : "would-create", verified: Boolean(supabase) });
      continue;
    }

    const userPayload = {
      password: account.password,
      email_confirm: true,
      user_metadata: {
        providerName: `${account.testLoginId} bulk`,
        testLoginId: account.testLoginId,
        profileId: account.profileId,
        seedGroup: "abuse-integrity",
      },
      app_metadata: { provider: "test", seedGroup: "abuse-integrity" },
    };

    if (existing) {
      const { data, error } = await supabase.auth.admin.updateUserById(existing.id, userPayload);
      if (error) throw error;
      results.push({ email: account.email, profileId: account.profileId, authUserId: data?.user?.id ?? existing.id, action: "updated" });
    } else {
      const { data, error } = await supabase.auth.admin.createUser({
        email: account.email,
        ...userPayload,
      });
      if (error) throw error;
      results.push({ email: account.email, profileId: account.profileId, authUserId: data.user.id, action: "created" });
    }
  }

  return results;
}

function toProfileRows(accounts, authResults) {
  const authByProfileId = new Map(authResults.map((result) => [result.profileId, result.authUserId ?? null]));
  return accounts
    .filter((account) => authByProfileId.has(account.profileId))
    .map((account) => ({
      id: account.profileId,
      auth_user_id: authByProfileId.get(account.profileId),
      test_login_id: account.testLoginId,
      name: account.name,
      handle: account.hashtag,
      hashtag: account.hashtag,
      birth_year: 2000,
      age_group: "open",
      age_group_checked_season: "2026-h1",
      region: "서울특별시 마포구",
      region_sido: "서울특별시",
      region_district: "마포구",
      position: account.position,
      avatar_color: account.avatarColor,
      trust_score: account.trustScore,
      ratings: { integrated: 1000, modes: {} },
      onboarding_complete: true,
      profile_version: 1,
      handle_locked_at: NOW,
      birth_year_locked_at: NOW,
      updated_at: NOW,
    }));
}

async function upsertProfiles(accounts, authResults) {
  if (!confirmed) return [];
  const rows = toProfileRows(accounts, authResults);
  const { error } = await supabase.from("profiles").upsert(rows, { onConflict: "id" });
  if (error) throw error;
  return rows.map((row) => ({ profileId: row.id, authUserId: row.auth_user_id, action: "upserted" }));
}

async function deleteProfiles(accounts) {
  const ids = accounts.map((account) => account.profileId);
  if (!confirmed) return { count: ids.length, skipped: true };
  const { error } = await supabase.from("profiles").delete().in("id", ids);
  if (error) throw error;
  return { count: ids.length, skipped: false };
}

async function deleteAuthUsers(accounts) {
  const existingByEmail = await listAuthUsersByEmail();
  if (!supabase) return accounts.map((account) => ({ email: account.email, profileId: account.profileId, action: "would-delete", verified: false }));
  const targets = accounts
    .map((account) => existingByEmail.get(account.email.toLowerCase()))
    .filter(Boolean);

  if (!confirmed) return targets.map((user) => ({ email: user.email, authUserId: user.id, action: "would-delete" }));

  const results = [];
  for (const user of targets) {
    const { error } = await supabase.auth.admin.deleteUser(user.id);
    if (error) throw error;
    results.push({ email: user.email, authUserId: user.id, action: "deleted" });
  }
  return results;
}

async function runSeed() {
  const accounts = buildAccounts();
  const authResults = await ensureAuthUsers(accounts);
  const profileResults = await upsertProfiles(accounts, authResults);
  console.log(JSON.stringify({
    ok: true,
    mode: confirmed ? "seeded" : "dry-run",
    confirmCommand: "RANKBALL_CONFIRM_AUTH_BULK=rankball npm run seed:supabase:auth-bulk",
    count: accounts.length,
    first: accounts[0]?.testLoginId ?? null,
    last: accounts.at(-1)?.testLoginId ?? null,
    auth: summarizeActions(authResults),
    profiles: confirmed ? profileResults.length : accounts.length,
  }, null, 2));
}

async function runCleanup() {
  const accounts = buildAccounts();
  const profileResult = await deleteProfiles(accounts);
  const authResults = await deleteAuthUsers(accounts);
  console.log(JSON.stringify({
    ok: true,
    mode: confirmed ? "deleted" : "dry-run",
    confirmCommand: "RANKBALL_CONFIRM_AUTH_BULK=rankball npm run seed:supabase:auth-bulk:cleanup",
    count: accounts.length,
    profiles: profileResult,
    auth: summarizeActions(authResults),
  }, null, 2));
}

function summarizeActions(results = []) {
  return results.reduce((summary, result) => {
    const action = result.action || "unknown";
    summary[action] = (summary[action] ?? 0) + 1;
    return summary;
  }, {});
}

(cleanupMode ? runCleanup() : runSeed()).catch((error) => {
  console.error("Supabase Auth bulk seed failed.", error);
  process.exit(1);
});
