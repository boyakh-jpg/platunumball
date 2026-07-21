import { createClient } from "@supabase/supabase-js";
import { initialState } from "../src/lib/mockData.js";
import { runAutomaticStateMaintenance, saveNormalizedRemoteState } from "../src/data/repository.js";
import {
  TEST_PROFILE_AGE_GROUP,
  TEST_PROFILE_AGE_GROUP_SEASON,
  TEST_PROFILE_BIRTH_YEAR,
  TEST_PROFILE_SETUP_AT,
} from "../src/lib/constants.js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error("SUPABASE_URL/VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const TEST_LOGIN_PREFIX = process.env.RANKBALL_TEST_LOGIN_PREFIX || "rankball";
const DEFAULT_TEST_PASSWORD = process.env.RANKBALL_TEST_PASSWORD || "test-0000";
const TEST_AUTH_EMAIL_DOMAIN = process.env.RANKBALL_TEST_AUTH_EMAIL_DOMAIN || "rankball.test";
const SEED_REAL_TEST_AUTH = readBooleanEnv("RANKBALL_SEED_REAL_TEST_AUTH", true);
const SEED_AUTH_ONLY = readBooleanEnv("RANKBALL_SEED_AUTH_ONLY", false);
function readBooleanEnv(name, fallback = false) {
  const value = String(process.env[name] ?? "").trim().toLowerCase();
  if (!value) return fallback;
  if (["1", "true", "yes"].includes(value)) return true;
  if (["0", "false", "no"].includes(value)) return false;
  return fallback;
}

function getSeedUserNumber(userId = "", fallbackIndex = 0) {
  const match = String(userId).match(/^u(\d+)$/);
  return match ? Number(match[1]) : fallbackIndex + 1;
}

function getSeedTestLoginId(userId = "", fallbackIndex = 0) {
  const userNumber = getSeedUserNumber(userId, fallbackIndex);
  return `${TEST_LOGIN_PREFIX}-${String(userNumber).padStart(3, "0")}`;
}

function normalizeTestLoginId(testLoginId = "") {
  return String(testLoginId).trim().toLowerCase();
}

function getTestAuthEmail(testLoginId = "") {
  return `${normalizeTestLoginId(testLoginId)}@${TEST_AUTH_EMAIL_DOMAIN}`;
}

async function findAuthUserByEmail(email) {
  const perPage = 1000;
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = data?.users ?? [];
    const found = users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (found || users.length < perPage) return found ?? null;
  }
  return null;
}

async function ensureTestAuthUser(user) {
  const testLoginId = normalizeTestLoginId(user.testLoginId);
  const email = getTestAuthEmail(testLoginId);
  const metadata = {
    providerName: `${testLoginId} test`,
    testLoginId,
    profileId: user.id,
  };
  const appMetadata = { provider: "test" };
  const existing = await findAuthUserByEmail(email);
  if (existing) {
    const { data, error } = await supabase.auth.admin.updateUserById(existing.id, {
      password: user.testPassword ?? DEFAULT_TEST_PASSWORD,
      user_metadata: {
        ...(existing.user_metadata ?? {}),
        ...metadata,
      },
      app_metadata: {
        ...(existing.app_metadata ?? {}),
        ...appMetadata,
      },
    });
    if (error) throw error;
    return data?.user?.id ?? existing.id;
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: user.testPassword ?? DEFAULT_TEST_PASSWORD,
    email_confirm: true,
    user_metadata: metadata,
    app_metadata: appMetadata,
  });
  if (error) throw error;
  return data.user.id;
}

async function withRealTestAuth(state) {
  if (!SEED_REAL_TEST_AUTH) return state;

  const authUserIdsByProfileId = new Map();
  for (const user of state.users ?? []) {
    if (!user.testLoginId) continue;
    authUserIdsByProfileId.set(user.id, await ensureTestAuthUser(user));
  }

  return {
    ...state,
    users: (state.users ?? []).map((user) => (
      authUserIdsByProfileId.has(user.id)
        ? { ...user, authUserId: authUserIdsByProfileId.get(user.id) }
        : user
    )),
  };
}

async function syncExistingTestProfileAuthUsers() {
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id,test_login_id")
    .not("test_login_id", "is", null);
  if (error) throw error;

  let linked = 0;
  for (const profile of profiles ?? []) {
    const authUserId = await ensureTestAuthUser({
      id: profile.id,
      testLoginId: profile.test_login_id,
      testPassword: DEFAULT_TEST_PASSWORD,
    });
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ auth_user_id: authUserId })
      .eq("id", profile.id);
    if (updateError) throw updateError;
    linked += 1;
  }

  return { linked };
}

function withBackendTestLogins(state) {
  return {
    ...state,
    users: (state.users ?? []).map((user, index) => ({
      ...user,
      testLoginId: user.testLoginId ?? getSeedTestLoginId(user.id, index),
      testPassword: user.testPassword ?? DEFAULT_TEST_PASSWORD,
      authUserId: user.authUserId ?? null,
      birthYear: user.birthYear ?? TEST_PROFILE_BIRTH_YEAR,
      ageGroup: user.ageGroup ?? TEST_PROFILE_AGE_GROUP,
      ageGroupCheckedSeason: user.ageGroupCheckedSeason ?? TEST_PROFILE_AGE_GROUP_SEASON,
      onboardingComplete: true,
      profileVersion: user.profileVersion ?? 1,
      handleLockedAt: user.handleLockedAt ?? TEST_PROFILE_SETUP_AT,
      birthYearLockedAt: user.birthYearLockedAt ?? TEST_PROFILE_SETUP_AT,
    })),
  };
}

function withBootstrapAdminAppointment(state) {
  const adminAppointments = state.settings?.adminAppointments ?? [];
  const hasOwner = adminAppointments.some((appointment) => (
    appointment.role === "admin" &&
    appointment.grade === "owner" &&
    appointment.status !== "revoked" &&
    appointment.status !== "expired"
  ));
  if (hasOwner) return state;

  return {
    ...state,
    settings: {
      ...(state.settings ?? {}),
      adminAppointments: [
        {
          id: "seed-owner-u1",
          role: "admin",
          grade: "owner",
          userId: "u1",
          status: "active",
          startsAt: "2026-01-01T00:00:00.000Z",
          endsAt: "2030-12-31T23:59:59.000Z",
          appointedBy: "system",
          reason: "Supabase seed owner for backend simulation",
          source: "backend_seed",
          createdAt: "2026-06-26T00:00:00.000Z",
        },
        ...adminAppointments,
      ],
    },
  };
}

if (SEED_REAL_TEST_AUTH && SEED_AUTH_ONLY) {
  const result = await syncExistingTestProfileAuthUsers();
  console.log(JSON.stringify({
    ok: true,
    authOnly: true,
    testAuthLinkedProfiles: result.linked,
  }, null, 2));
  process.exit(0);
}

const state = await withRealTestAuth(withBackendTestLogins(withBootstrapAdminAppointment(runAutomaticStateMaintenance(initialState))));

await saveNormalizedRemoteState(state, { client: supabase });

console.log(JSON.stringify({
  ok: true,
  realTestAuth: SEED_REAL_TEST_AUTH,
  profiles: state.users.length,
  testLogins: state.users.filter((user) => user.testLoginId).length,
  testLoginRange: state.users.length ? `${state.users[0].testLoginId}..${state.users.at(-1).testLoginId}` : null,
  teams: state.teams.length,
  matches: state.matches.length,
  recruitingPosts: state.recruitingPosts.length,
  tournaments: state.tournaments?.length ?? 0,
  adminAppointments: state.settings?.adminAppointments?.length ?? 0,
}, null, 2));
