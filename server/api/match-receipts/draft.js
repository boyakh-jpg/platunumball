import { getSupabaseAdminClient } from "../_supabaseAuth.js";
import {
  allowRequestMethod,
  getAdminLevel,
  getAuthenticatedContext,
  readJsonBody,
  sendJson,
} from "../_supabaseAdmin.js";
import { loadAuthoritativeState } from "../_authoritativeState.js";
import { filterStateForProfile } from "../../lib/stateVisibility.js";
import {
  canCreatePublicMatchReceiptSnapshot,
  getMatchReceiptDraftFromMatch,
  getMatchReceiptSideTeamId,
} from "../../../src/lib/matchReceipt.js";
import { getUserHashtag } from "../../../shared/lib/handles.js";
import {
  createReceiptClonePayload,
  createCanonicalReceiptSerialSeed,
  createReceiptCapability,
  getLegacyCanonicalReceiptMatchId,
  getReceiptCapabilityCookie,
  getReceiptRequestHash,
  hashReceiptCapability,
  projectPublicReceiptDraft,
  receiptCapabilityMatches,
  sanitizeReceiptDraftPayload,
  setReceiptCapabilityCookie,
} from "./_draftSecurity.js";

function getPublicId(request) {
  return String(request.query?.publicId ?? "").trim();
}

const RECEIPT_PUBLIC_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CANONICAL_RECEIPT_FIELDS = [
  "serialSeed",
  "homeTeam",
  "awayTeam",
  "homeScore",
  "awayScore",
  "playedOn",
  "venue",
  "originalAddress",
  "format",
  "matchNature",
  "tournamentName",
  "periodScores",
  "q1Home",
  "q1Away",
  "q2Home",
  "q2Away",
  "q3Home",
  "q3Away",
  "q4Home",
  "q4Away",
  "otHome",
  "otAway",
  "homeMmr",
  "awayMmr",
  "personalMmr",
  "profileHashtag",
  "personalPoints",
  "personalRebounds",
  "personalStatsEligible",
  "hasCanonicalTeamMatch",
  "homeEmblemKey",
  "awayEmblemKey",
  "verified",
];

function isValidPublicId(value) {
  return RECEIPT_PUBLIC_ID_PATTERN.test(String(value ?? "").trim());
}

function mergeOwnedDraftPayload(storedPayload, draft) {
  const nextPayload = sanitizeReceiptDraftPayload(draft);
  if (storedPayload?._canonicalReceipt !== true) return nextPayload;
  const canonicalPayload = sanitizeReceiptDraftPayload(storedPayload, { trustedCanonical: true });
  for (const field of CANONICAL_RECEIPT_FIELDS) nextPayload[field] = canonicalPayload[field];
  return { ...nextPayload, _canonicalReceipt: true };
}

function getCanonicalTeam(teams, teamId) {
  return teams?.find((item) => String(item.id) === String(teamId)) ?? null;
}

function getCanonicalTeamMmr(team) {
  const mmr = Number(team?.mmr ?? team?.rosterMmr);
  return Number.isFinite(mmr) ? mmr : undefined;
}

async function createCanonicalPayload(request, sourceMatchId, styleDraft) {
  const context = await getAuthenticatedContext(request, { allowMissingProfile: true });
  const adminLevel = context.profileId ? await getAdminLevel(context) : 0;
  const rawState = await loadAuthoritativeState(context, {
    operation: { action: "loadMatch", matchId: sourceMatchId },
  });
  const profileId = context.profileId ?? rawState?.currentUserId ?? "";
  const state = filterStateForProfile(rawState ?? {}, profileId, adminLevel >= 30);
  const match = (state.matches ?? []).find((item) => String(item.id) === sourceMatchId);
  if (!canCreatePublicMatchReceiptSnapshot(match)) return null;

  const currentUser = (state.users ?? []).find((item) => String(item.id) === String(profileId));
  const tournament = (state.tournaments ?? []).find((item) => item.id === match.tournamentId) ?? null;
  const homeTeam = getCanonicalTeam(state.teams, getMatchReceiptSideTeamId(match, "teamA"));
  const awayTeam = getCanonicalTeam(state.teams, getMatchReceiptSideTeamId(match, "teamB"));
  const safeStyle = sanitizeReceiptDraftPayload(styleDraft);
  const canonicalDraft = getMatchReceiptDraftFromMatch(match, {
    ...safeStyle,
    serialSeed: createCanonicalReceiptSerialSeed(sourceMatchId),
    currentUserId: profileId,
    personalMmr: currentUser?.ratings?.integrated,
    profileHashtag: currentUser ? getUserHashtag(currentUser) : "",
    tournament,
    homeMmr: getCanonicalTeamMmr(homeTeam),
    awayMmr: getCanonicalTeamMmr(awayTeam),
    homeTeamRecord: homeTeam,
    awayTeamRecord: awayTeam,
  });
  return {
    payload: {
      ...sanitizeReceiptDraftPayload(canonicalDraft, { trustedCanonical: true }),
      _canonicalReceipt: true,
    },
    publicCode: match.publicCode ?? match.public_code ?? "",
  };
}

async function clonePublicPayload(supabase, publicId) {
  if (!publicId) return null;
  const { data, error } = await supabase
    .from("match_receipt_drafts")
    .select("payload,public_code")
    .eq("public_id", publicId)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (!await canExposeStoredReceiptDraft(supabase, data.payload)) return null;
  return { payload: createReceiptClonePayload(data.payload) };
}

async function canExposeStoredReceiptDraft(supabase, payload) {
  const sourceMatchId = getLegacyCanonicalReceiptMatchId(payload);
  if (!sourceMatchId) return true;
  const { data, error } = await supabase
    .from("matches")
    .select("id,status,visibility,rules")
    .eq("id", sourceMatchId)
    .maybeSingle();
  if (error) throw error;
  return canCreatePublicMatchReceiptSnapshot(data);
}

export default async function handler(request, response) {
  if (!allowRequestMethod(request, response, ["GET", "POST"])) return;

  const supabase = getSupabaseAdminClient();

  if (request.method === "GET") {
    const publicId = getPublicId(request);
    if (!publicId) return sendJson(response, 400, { error: "receipt_public_id_required" });
    if (!isValidPublicId(publicId)) return sendJson(response, 400, { error: "receipt_public_id_invalid" });
    const { data: allowed, error: rateError } = await supabase.rpc("consume_match_receipt_draft_read_quota", {
      p_request_hash: getReceiptRequestHash(request),
    });
    if (rateError) throw rateError;
    if (!allowed) return sendJson(response, 429, { error: "receipt_draft_rate_limited" });
    const { data, error } = await supabase
      .from("match_receipt_drafts")
      .select("public_id,public_code,capability_hash,payload,expires_at,claimed_at")
      .eq("public_id", publicId)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (error) throw error;
    if (!data) return sendJson(response, 404, { error: "receipt_draft_not_found" });
    if (!await canExposeStoredReceiptDraft(supabase, data.payload)) {
      return sendJson(response, 404, { error: "receipt_draft_not_found" });
    }
    const capability = getReceiptCapabilityCookie(request, data.public_id);
    const canClaim = !data.claimed_at
      && capability?.publicId === data.public_id
      && receiptCapabilityMatches(capability.secret, data.capability_hash);
    response.setHeader("Cache-Control", "private, no-store");
    return sendJson(response, 200, {
      publicId: data.public_id,
      publicCode: data.public_code,
      draft: projectPublicReceiptDraft(data.payload, { publicId: data.public_id, publicCode: data.public_code }),
      expiresAt: data.expires_at,
      claimed: Boolean(data.claimed_at),
      canClaim,
    });
  }

  const body = await readJsonBody(request, { maxBytes: 16_384, maxStringLength: 1_000 });
  const publicId = String(body.publicId ?? "").trim();
  const sourceMatchId = String(body.sourceMatchId ?? "").trim();
  const clonePublicId = String(body.clonePublicId ?? "").trim();
  if (publicId && !isValidPublicId(publicId)) {
    return sendJson(response, 400, { error: "receipt_public_id_invalid" });
  }
  if (clonePublicId && !isValidPublicId(clonePublicId)) {
    return sendJson(response, 400, { error: "receipt_public_id_invalid" });
  }

  if (publicId) {
    const { data: existing, error: existingError } = await supabase
      .from("match_receipt_drafts")
      .select("id,public_id,public_code,capability_hash,payload,expires_at,claimed_at")
      .eq("public_id", publicId)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (existingError) throw existingError;
    const capability = existing && getReceiptCapabilityCookie(request, existing.public_id);
    if (!existing || existing.claimed_at || !capability
      || capability.publicId !== existing.public_id
      || !receiptCapabilityMatches(capability.secret, existing.capability_hash)) {
      return sendJson(response, 403, { error: "receipt_capability_required" });
    }
    const payload = mergeOwnedDraftPayload(existing.payload, body.draft);
    if (!payload.homeTeam || !payload.awayTeam) {
      return sendJson(response, 400, { error: "receipt_draft_invalid" });
    }
    const { data, error } = await supabase
      .from("match_receipt_drafts")
      .update({ payload, updated_at: new Date().toISOString() })
      .eq("id", existing.id)
      .is("claimed_at", null)
      .select("public_id,public_code,expires_at")
      .maybeSingle();
    if (error) throw error;
    if (!data) return sendJson(response, 409, { error: "receipt_draft_claimed" });
    return sendJson(response, 200, {
      publicId: data.public_id,
      publicCode: data.public_code,
      serialSeed: payload.serialSeed,
      expiresAt: data.expires_at,
      draft: projectPublicReceiptDraft(payload, { publicId: data.public_id, publicCode: data.public_code }),
    });
  }

  const capability = createReceiptCapability();
  const clone = clonePublicId ? await clonePublicPayload(supabase, clonePublicId) : null;
  const canonical = sourceMatchId ? await createCanonicalPayload(request, sourceMatchId, body.draft) : null;
  const payload = sourceMatchId
    ? canonical?.payload ?? null
    : clonePublicId
      ? clone?.payload ?? null
      : sanitizeReceiptDraftPayload(body.draft);
  if (!payload) return sendJson(response, 404, {
    error: sourceMatchId ? "receipt_source_match_not_found" : "receipt_draft_not_found",
  });
  if (!payload.homeTeam || !payload.awayTeam) return sendJson(response, 400, { error: "receipt_draft_invalid" });

  const { data: allowed, error: rateError } = await supabase.rpc("consume_match_receipt_draft_quota", {
    p_request_hash: getReceiptRequestHash(request),
  });
  if (rateError) throw rateError;
  if (!allowed) return sendJson(response, 429, { error: "receipt_draft_rate_limited" });

  const { data, error } = await supabase
    .from("match_receipt_drafts")
    .insert({
      public_id: capability.publicId,
      capability_hash: hashReceiptCapability(capability.secret),
      payload,
      ...(canonical?.publicCode ? { public_code: canonical.publicCode } : {}),
    })
    .select("public_id,public_code,expires_at")
    .single();
  if (error) throw error;

  setReceiptCapabilityCookie(response, capability);
  return sendJson(response, 201, {
    publicId: data.public_id,
    publicCode: data.public_code,
    serialSeed: payload.serialSeed,
    expiresAt: data.expires_at,
    draft: projectPublicReceiptDraft(payload, { publicId: data.public_id, publicCode: data.public_code }),
  });
}
