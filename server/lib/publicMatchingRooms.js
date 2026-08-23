import { getSupabaseAdminClient } from "../api/_supabaseAuth.js";
import { getConfiguredPublicAppUrl } from "../api/_publicAppUrl.js";
import { fetchRecruitingPage } from "../api/recruiting/_listQueries.js";
import { attachRoomFeedCardJson } from "./roomFeedCards.js";

const SEARCH_LIMIT = 10;
const SOURCE_LIMIT = 80;
const GENERIC_QUERY_WORDS = new Set([
  "농구", "경기", "게임", "매칭", "매칭방", "방", "모집", "모집방", "추천", "찾아", "찾아줘",
  "하고", "싶어", "할", "곳", "참가", "참여", "가능", "붙", "박스티어", "boxtier",
]);

function normalizeText(value = "") {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/3\s*(대|vs|x)\s*3/gu, "3v3")
    .replace(/5\s*(대|vs|x)\s*5/gu, "5v5")
    .replace(/2\s*(대|vs|x)\s*2/gu, "2v2")
    .replace(/1\s*(대|vs|x)\s*1/gu, "1v1")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function dateInSeoul(dayOffset = 0, now = new Date()) {
  const shifted = new Date(now.getTime() + dayOffset * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(shifted);
}

function getDateConstraint(query = "", now = new Date()) {
  const normalized = normalizeText(query);
  if (normalized.includes("내일")) return dateInSeoul(1, now);
  if (normalized.includes("오늘")) return dateInSeoul(0, now);
  return normalized.match(/\b20\d{2}[ -](\d{1,2})[ -](\d{1,2})\b/u)?.[0]?.replaceAll(" ", "-") ?? "";
}

function queryTokens(query = "") {
  return [...new Set(normalizeText(query).split(/\s+/u))]
    .map((token) => token
      .replace(/(?:해줘|하고싶어|할래|할까|있는|가능한)$/u, "")
      .replace(/(?:에서|으로|에는|에게|이랑|하고|까지|부터|처럼|보다|의|에|로|을|를|은|는|이|가|와|과|할|해|줘)$/u, ""))
    .filter((token) => token && token.length > 1 && !GENERIC_QUERY_WORDS.has(token) && token !== "오늘" && token !== "내일");
}

function roomHaystack(card = {}) {
  const hour = Number(String(card.scheduledTime ?? "").slice(0, 2));
  const timePeriod = Number.isFinite(hour)
    ? hour < 12 ? "아침 오전" : hour < 18 ? "낮 오후" : "저녁 밤"
    : "";
  return normalizeText([
    card.title,
    card.region,
    card.regionKey,
    card.mode,
    card.scheduledDate,
    card.scheduledTime,
    card.scheduledAt,
    timePeriod,
    card.timingType === "instant" ? "즉시" : "예약",
    card.teamOnly ? "팀 팀전 상대팀" : "개인 픽업",
    card.refereeWanted ? "심판 모집" : "",
    card.ranked ? "랭크 정규" : "친선",
  ].filter(Boolean).join(" "));
}

function rankRoom(card = {}, query = "", now = new Date()) {
  const haystack = roomHaystack(card);
  const tokens = queryTokens(query);
  const dateConstraint = getDateConstraint(query, now);
  if (dateConstraint && String(card.scheduledDate ?? "") !== dateConstraint) return null;
  if (normalizeText(query).includes("즉시") && card.timingType !== "instant") return null;
  const matched = tokens.filter((token) => haystack.includes(token));
  if (tokens.length && matched.length !== tokens.length) return null;
  const exactPhrase = normalizeText(query);
  return matched.length * 10 + (exactPhrase && haystack.includes(exactPhrase) ? 20 : 0);
}

function roomTitle(card = {}) {
  return String(card.title || [card.region, card.mode, "농구 매칭"].filter(Boolean).join(" ") || "BoxTier 농구 매칭").trim();
}

function roomUrl(id = "", publicAppUrl = "") {
  const origin = String(publicAppUrl || getConfiguredPublicAppUrl()).trim();
  if (!origin) throw new Error("public_app_url_not_configured");
  return new URL(`/app/recruiting?post=${encodeURIComponent(id)}`, origin).toString();
}

function roomMetadata(card = {}) {
  const counts = card.listCounts && typeof card.listCounts === "object" ? card.listCounts : {};
  return {
    region: card.region || "",
    mode: card.mode || "",
    scheduledDate: card.scheduledDate || "",
    scheduledTime: card.scheduledTime || "",
    scheduledAt: card.scheduledAt || "",
    timingType: card.timingType || "",
    teamOnly: card.teamOnly === true,
    ranked: card.ranked === true,
    refereeWanted: card.refereeWanted === true,
    filled: Number(counts.filled ?? counts.participantFilled ?? 0) || 0,
    capacity: Number(counts.capacity ?? counts.participantCapacity ?? 0) || 0,
  };
}

export function searchPublicMatchingRoomCards(cards = [], query = "", options = {}) {
  const now = options.now ?? new Date();
  return (cards ?? [])
    .filter((card) => card?.visibility === "public" && card?.status === "open")
    .map((card, index) => ({ card, index, score: rankRoom(card, query, now) }))
    .filter(({ card, score }) => card?.id && score !== null)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, options.limit ?? SEARCH_LIMIT)
    .map(({ card }) => card);
}

export async function searchPublicMatchingRooms(query = "", options = {}) {
  const client = options.client ?? getSupabaseAdminClient();
  const page = await fetchRecruitingPage(client, SOURCE_LIMIT, 0, "", true, {}, false, false);
  const cards = searchPublicMatchingRoomCards(page.cards, query, options);
  return {
    results: cards.map((card) => ({
      id: card.id,
      title: roomTitle(card),
      url: roomUrl(card.id, options.publicAppUrl),
    })),
  };
}

export async function fetchPublicMatchingRoom(id = "", options = {}) {
  const safeId = String(id ?? "").trim();
  if (!safeId) return null;
  const client = options.client ?? getSupabaseAdminClient();
  const { data, error } = await client
    .from("user_room_feed")
    .select("entity_id,sort_at,relation")
    .eq("entity_type", "recruiting")
    .eq("entity_id", safeId)
    .eq("feed_scope", "public")
    .eq("relation", "region_public")
    .eq("status", "open")
    .eq("is_active", true)
    .limit(1);
  if (error) throw error;
  if (!data?.length) return null;
  const rows = await attachRoomFeedCardJson(client, data, { entityType: "recruiting" });
  const card = rows[0]?.card_json;
  if (!card?.id || card.visibility !== "public" || card.status !== "open") return null;
  const metadata = roomMetadata(card);
  const details = [
    `지역: ${metadata.region || "미정"}`,
    `방식: ${metadata.mode || "미정"}`,
    `일시: ${metadata.scheduledAt || [metadata.scheduledDate, metadata.scheduledTime].filter(Boolean).join(" ") || "미정"}`,
    `참가 현황: ${metadata.capacity > 0 ? `${metadata.filled}/${metadata.capacity}` : "방에서 확인"}`,
    `참가 방식: ${metadata.teamOnly ? "팀 단위" : "개인 참가 가능"}`,
    `경기 성격: ${metadata.ranked ? "랭크" : "친선"}`,
    `심판 모집: ${metadata.refereeWanted ? "예" : "아니오"}`,
  ];
  return {
    id: card.id,
    title: roomTitle(card),
    text: details.join("\n"),
    url: roomUrl(card.id, options.publicAppUrl),
    metadata,
  };
}
