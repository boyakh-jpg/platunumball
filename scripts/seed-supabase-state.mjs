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

const state = runAutomaticStateMaintenance(initialState);

await saveNormalizedRemoteState(state, { client: supabase });

console.log(JSON.stringify({
  ok: true,
  profiles: state.users.length,
  teams: state.teams.length,
  matches: state.matches.length,
  recruitingPosts: state.recruitingPosts.length,
  tournaments: state.tournaments?.length ?? 0,
}, null, 2));
