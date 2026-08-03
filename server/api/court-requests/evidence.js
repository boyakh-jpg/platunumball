import { getPrivateR2Config, readR2Object } from "../_r2ImageStorage.js";
import { allowRequestMethod, readJsonBody, requireAdminContext, sendJson } from "../_supabaseAdmin.js";

export default async function handler(request, response) {
  if (!allowRequestMethod(request, response)) return;
  try {
    const context = await requireAdminContext(request);
    const body = await readJsonBody(request);
    const requestId = String(body.requestId || "").trim();
    if (!requestId) {
      sendJson(response, 400, { error: "missing_request_id" });
      return;
    }
    const { data: evidence, error } = await context.supabase
      .from("court_request_evidence")
      .select("request_id,photo_keys,field_accuracy_meters,field_distance_meters,field_captured_at,ai_model,prompt_version,ai_status,ai_confidence,ai_result,decision,auto_approved,analyzed_at")
      .eq("request_id", requestId)
      .maybeSingle();
    if (error) throw error;
    if (!evidence) {
      sendJson(response, 200, { ok: true, requestId, photos: [], evidence: null });
      return;
    }
    const config = getPrivateR2Config();
    const photos = [];
    for (const objectKey of Array.isArray(evidence.photo_keys) ? evidence.photo_keys : []) {
      const bytes = await readR2Object(config, objectKey, "court request evidence");
      photos.push(`data:image/webp;base64,${bytes.toString("base64")}`);
    }
    sendJson(response, 200, {
      ok: true,
      requestId,
      photos,
      evidence: {
        fieldAccuracyMeters: evidence.field_accuracy_meters,
        fieldDistanceMeters: evidence.field_distance_meters,
        fieldCapturedAt: evidence.field_captured_at,
        aiModel: evidence.ai_model,
        promptVersion: evidence.prompt_version,
        aiStatus: evidence.ai_status,
        aiConfidence: evidence.ai_confidence,
        aiResult: evidence.ai_result,
        decision: evidence.decision,
        autoApproved: evidence.auto_approved,
        analyzedAt: evidence.analyzed_at,
      },
    });
  } catch (error) {
    console.error("Court request evidence load failed.", error.message);
    sendJson(response, error.statusCode || 500, { error: error.message || "court_request_evidence_load_failed" });
  }
}
