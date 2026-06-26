import { createClient } from "@supabase/supabase-js";
import { initialState } from "../src/lib/mockData.js";
import { runAutomaticStateMaintenance } from "../src/data/repository.js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const confirmCleanup = process.env.RANKBALL_CONFIRM_CLEANUP === "rankball";

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

const seedState = runAutomaticStateMaintenance(initialState);

function ids(items = []) {
  return items.map((item) => item.id).filter(Boolean);
}

function uniq(values = []) {
  return [...new Set(values.filter(Boolean))];
}

const seedIds = {
  users: ids(seedState.users),
  teams: ids(seedState.teams),
  matches: ids(seedState.matches),
  recruitingPosts: ids(seedState.recruitingPosts),
  tournaments: ids(seedState.tournaments),
  notifications: ids(seedState.notifications),
  reports: ids(seedState.reports),
  courtRequests: ids(seedState.settings?.courtRequests),
  approvedCourts: ids(seedState.settings?.approvedCourts),
  courtReviews: ids(seedState.settings?.courtReviews),
  refereeRequests: ids(seedState.settings?.refereeRequests),
  refereeExamAttempts: ids(seedState.settings?.refereeExamAttempts),
  adminAppointments: uniq(["seed-owner-u1", ...ids(seedState.settings?.adminAppointments)]),
  refereeAppointments: ids(seedState.settings?.refereeAppointments),
  adminAuditLog: ids(seedState.settings?.adminAuditLog),
  adminDisciplinaryActions: ids(seedState.settings?.adminDisciplinaryActions),
  discordDeliveries: ids(seedState.discordNotificationDeliveries),
};

async function removeByIds(table, column, values) {
  if (!values.length) return { table, count: 0, skipped: !confirmCleanup };
  if (!confirmCleanup) return { table, count: values.length, skipped: true };
  const { error } = await supabase.from(table).delete().in(column, values);
  if (error) throw error;
  return { table, count: values.length, skipped: false };
}

async function removeMatchChildren(table) {
  return removeByIds(table, "match_id", seedIds.matches);
}

async function removeRecruitingChildren(table) {
  return removeByIds(table, "post_id", seedIds.recruitingPosts);
}

async function run() {
  const results = [];

  results.push(await removeByIds("discord_notification_deliveries", "id", seedIds.discordDeliveries));
  results.push(await removeByIds("admin_disciplinary_actions", "id", seedIds.adminDisciplinaryActions));
  results.push(await removeByIds("admin_audit_log", "id", seedIds.adminAuditLog));
  results.push(await removeByIds("referee_appointments", "id", seedIds.refereeAppointments));
  results.push(await removeByIds("admin_appointments", "id", seedIds.adminAppointments));
  results.push(await removeByIds("referee_exam_attempts", "id", seedIds.refereeExamAttempts));
  results.push(await removeByIds("referee_requests", "id", seedIds.refereeRequests));
  results.push(await removeByIds("court_reviews", "id", seedIds.courtReviews));
  results.push(await removeByIds("approved_courts", "id", seedIds.approvedCourts));
  results.push(await removeByIds("court_requests", "id", seedIds.courtRequests));
  results.push(await removeByIds("reports", "id", seedIds.reports));
  results.push(await removeByIds("notifications", "id", seedIds.notifications));

  results.push(await removeByIds("tournament_teams", "tournament_id", seedIds.tournaments));
  results.push(await removeByIds("tournaments", "id", seedIds.tournaments));

  results.push(await removeRecruitingChildren("recruiting_applications"));
  results.push(await removeByIds("recruiting_posts", "id", seedIds.recruitingPosts));

  results.push(await removeMatchChildren("match_disputes"));
  results.push(await removeMatchChildren("match_approvals"));
  results.push(await removeMatchChildren("match_agreements"));
  results.push(await removeMatchChildren("player_match_stats"));
  results.push(await removeMatchChildren("match_results"));
  results.push(await removeMatchChildren("match_players"));
  results.push(await removeByIds("matches", "id", seedIds.matches));

  results.push(await removeByIds("favorites", "user_id", seedIds.users));
  results.push(await removeByIds("team_members", "team_id", seedIds.teams));
  results.push(await removeByIds("teams", "id", seedIds.teams));
  results.push(await removeByIds("profiles", "id", seedIds.users));

  console.log(JSON.stringify({
    ok: true,
    mode: confirmCleanup ? "deleted" : "dry-run",
    confirmCommand: "RANKBALL_CONFIRM_CLEANUP=rankball npm run seed:supabase:cleanup",
    results,
  }, null, 2));
}

run().catch((error) => {
  console.error("Supabase seed cleanup failed.", error);
  process.exit(1);
});
