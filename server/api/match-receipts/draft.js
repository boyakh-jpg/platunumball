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

function getCanonicalTeamMmr(teams, teamId) {
  const team = teams?.find((item) => String(item.id) === String(teamId));
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
  const safeStyle = sanitizeReceiptDraftPayload(styleDraft);
  const canonicalDraft = getMatchReceiptDraftFromMatch(match, {
    ...safeStyle,
    serialSeed: createCanonicalReceiptSerialSeed(sourceMatchId),
    currentUserId: profileId,
    personalMmr: currentUser?.ratings?.integrated,
    profileHashtag: currentUser ? getUserHashtag(currentUser) : "",
    tournament,
    homeMmr: getCanonicalTeamMmr(state.teams, getMatchReceiptSideTeamId(match, "teamA")),
    awayMmr: getCanonicalTeamMmr(state.teams, getMatchReceiptSideTeamId(match, "teamB")),
  });
  return {
    ...sanitizeReceiptDraftPayload(canonicalDraft, { trustedCanonical: true }),
    _canonicalReceipt: true,
  };
}

async function clonePublicPayload(supabase, publicId) {
  if (!publicId) return null;
  const { data, error } = await supabase
    .from("match_receipt_drafts")
    .select("payload")
    .eq("public_id", publicId)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (!await canExposeStoredReceiptDraft(supabase, data.payload)) return null;
  return sanitizeReceiptDraftPayload(projectPublicReceiptDraft(data.payload));
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
    const { data, error } = await supabase
      .from("match_receipt_drafts")
      .select("public_id,capability_hash,payload,expires_at,claimed_at")
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
      draft: projectPublicReceiptDraft(data.payload),
      expiresAt: data.expires_at,
      claimed: Boolean(data.claimed_at),
      canClaim,
    });
  }

  const body = await readJsonBody(request, { maxBytes: 16_384, maxStringLength: 1_000 });
  const sourceMatchId = String(body.sourceMatchId ?? "").trim();
  const clonePublicId = String(body.clonePublicId ?? "").trim();
  const payload = sourceMatchId
    ? await createCanonicalPayload(request, sourceMatchId, body.draft)
    : clonePublicId
      ? await clonePublicPayload(supabase, clonePublicId)
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

  const capability = createReceiptCapability();
  const { data, error } = await supabase
    .from("match_receipt_drafts")
    .insert({
      public_id: capability.publicId,
      capability_hash: hashReceiptCapability(capability.secret),
      payload,
    })
    .select("public_id,expires_at")
    .single();
  if (error) throw error;

  setReceiptCapabilityCookie(response, capability);
  return sendJson(response, 201, {
    publicId: data.public_id,
    serialSeed: payload.serialSeed,
    expiresAt: data.expires_at,
  });
}
