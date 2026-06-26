import { createClient } from "@supabase/supabase-js";
import { initialState } from "../src/lib/mockData.js";
import { runAutomaticStateMaintenance, saveNormalizedRemoteState } from "../src/data/repository.js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
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

function getSeedUserNumber(userId = "", fallbackIndex = 0) {
  const match = String(userId).match(/^u(\d+)$/);
  return match ? Number(match[1]) : fallbackIndex + 1;
}

function getSeedTestLoginId(userId = "", fallbackIndex = 0) {
  const userNumber = getSeedUserNumber(userId, fallbackIndex);
  return `${TEST_LOGIN_PREFIX}-${String(userNumber).padStart(3, "0")}`;
}

function withBackendTestLogins(state) {
  return {
    ...state,
    users: (state.users ?? []).map((user, index) => ({
      ...user,
      testLoginId: user.testLoginId ?? getSeedTestLoginId(user.id, index),
      testPassword: user.testPassword ?? DEFAULT_TEST_PASSWORD,
      authUserId: user.authUserId ?? null,
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

const state = withBackendTestLogins(withBootstrapAdminAppointment(runAutomaticStateMaintenance(initialState)));

await saveNormalizedRemoteState(state, { client: supabase });

console.log(JSON.stringify({
  ok: true,
  profiles: state.users.length,
  testLogins: state.users.filter((user) => user.testLoginId).length,
  testLoginRange: state.users.length ? `${state.users[0].testLoginId}..${state.users.at(-1).testLoginId}` : null,
  teams: state.teams.length,
  matches: state.matches.length,
  recruitingPosts: state.recruitingPosts.length,
  tournaments: state.tournaments?.length ?? 0,
  adminAppointments: state.settings?.adminAppointments?.length ?? 0,
}, null, 2));
