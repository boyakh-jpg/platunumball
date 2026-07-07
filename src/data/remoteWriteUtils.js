import { supabase } from "../lib/supabase.js";
import { chunkRows } from "./rowUtils.js";

export async function upsertRemoteRows(table, rows, onConflict, client = supabase) {
  if (!rows.length) return;
  for (const chunk of chunkRows(rows)) {
    const { error } = await client.from(table).upsert(chunk, onConflict ? { onConflict } : undefined);
    if (error) throw error;
  }
}

export async function upsertOptionalRemoteRows(table, rows, onConflict, client = supabase) {
  try {
    await upsertRemoteRows(table, rows, onConflict, client);
  } catch (error) {
    console.warn(`Supabase optional table write skipped: ${table}`, error.message);
  }
}

export async function softDeleteRemoteTeams(teamIds = [], client = supabase) {
  if (!teamIds.length) return;
  for (const chunk of chunkRows(teamIds)) {
    const deletedAt = new Date().toISOString();
    let response = await client.from("team_members").delete().in("team_id", chunk);
    if (response.error) throw response.error;

    response = await client.from("favorites").delete().eq("target_type", "team").in("target_id", chunk);
    if (response.error) throw response.error;

    response = await client.from("recruiting_posts").update({ status: "closed", updated_at: deletedAt }).in("team_id", chunk);
    if (response.error) throw response.error;

    response = await client.from("teams").update({ deleted_at: deletedAt, updated_at: deletedAt }).in("id", chunk);
    if (response.error) throw response.error;
  }
}

export async function replaceRemoteRecruitingApplications(postIds = [], applicationRows = [], client = supabase) {
  for (const chunk of chunkRows(postIds)) {
    const { error } = await client.from("recruiting_applications").delete().in("post_id", chunk);
    if (error) throw error;
  }

  await upsertRemoteRows("recruiting_applications", applicationRows, "post_id,player_id,kind", client);
}
