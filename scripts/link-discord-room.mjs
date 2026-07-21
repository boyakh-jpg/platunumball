import { createClient } from "@supabase/supabase-js";
import { isDiscordSnowflake } from "../src/lib/discordProtocol.js";

const args = parseArgs(process.argv.slice(2));
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const confirmed = process.env.RANKBALL_CONFIRM_DISCORD_ROOM_LINK === "rankball" || args.confirm === "true";

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

function parseArgs(items = []) {
  const result = {};
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = items[index + 1];
    if (!next || next.startsWith("--")) {
      result[key] = "true";
      continue;
    }
    result[key] = next;
    index += 1;
  }
  return result;
}

function readRequiredArg(name) {
  const value = String(args[name] || "").trim();
  if (!value) {
    console.error(`--${name} is required.`);
    process.exit(1);
  }
  return value;
}

function readSnowflakeArg(name, required = true) {
  const value = String(args[name] || "").trim();
  if (!value && !required) return "";
  if (!isDiscordSnowflake(value)) {
    console.error(`--${name} must be a Discord snowflake.`);
    process.exit(1);
  }
  return value;
}

async function assertRecruitingPostExists(roomId) {
  const { data, error } = await supabase
    .from("recruiting_posts")
    .select("id")
    .eq("id", roomId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) {
    console.error(`Recruiting room not found: ${roomId}`);
    process.exit(1);
  }
}

async function findEnabledLink(roomId) {
  const { data, error } = await supabase
    .from("room_discord_links")
    .select("id,room_type,room_id,discord_channel_id,discord_thread_id,enabled")
    .eq("room_type", "recruiting")
    .eq("room_id", roomId)
    .eq("enabled", true)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function main() {
  const roomId = readRequiredArg("room-id");
  const disable = args.disable === "true";
  const createdBy = String(args["created-by"] || "").trim() || null;
  await assertRecruitingPostExists(roomId);
  const existing = await findEnabledLink(roomId);

  if (disable) {
    const plan = existing
      ? { action: "disable", id: existing.id, roomId }
      : { action: "noop", roomId, reason: "enabled_link_not_found" };
    console.log(JSON.stringify({ confirmed, plan }, null, 2));
    if (!confirmed || !existing) return;
    const { error } = await supabase
      .from("room_discord_links")
      .update({ enabled: false, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) throw error;
    console.log(JSON.stringify({ ok: true, disabled: true, roomId }, null, 2));
    return;
  }

  const channelId = readSnowflakeArg("channel-id");
  const threadId = readSnowflakeArg("thread-id", false) || null;
  const row = {
    room_type: "recruiting",
    room_id: roomId,
    discord_channel_id: channelId,
    discord_thread_id: threadId,
    enabled: true,
    updated_at: new Date().toISOString(),
  };
  if (createdBy || !existing) row.created_by = createdBy;
  const plan = existing
    ? { action: "update", id: existing.id, from: existing, to: row }
    : { action: "insert", to: row };
  console.log(JSON.stringify({ confirmed, plan }, null, 2));
  if (!confirmed) return;

  if (existing) {
    const { error } = await supabase
      .from("room_discord_links")
      .update(row)
      .eq("id", existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("room_discord_links")
      .insert(row);
    if (error) throw error;
  }
  console.log(JSON.stringify({ ok: true, roomId, channelId, threadId }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
