import { useEffect, useState } from "react";
import Badge from "../components/common/Badge.jsx";

export default function AdminCourtRequestEvidence({ app, requestId, verification }) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setResult(null);
    if (!requestId || !app.actions.loadCourtRequestEvidence) return undefined;
    setLoading(true);
    app.actions.loadCourtRequestEvidence(requestId)
      .then((next) => { if (active) setResult(next?.ok === false ? null : next); })
      .catch(() => { if (active) setResult(null); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [app, requestId]);

  const evidence = result?.evidence;
  if (!loading && !evidence && !verification) return null;
  const confidence = Number(evidence?.aiConfidence ?? verification?.confidence);
  const formatMeters = (value) => value !== null && value !== "" && Number.isFinite(Number(value)) ? `${Math.round(Number(value))}m` : "-";
  const photoLocation = evidence?.photoLocation ?? verification?.photoLocation;
  const locationSource = evidence?.aiResult?.locationSource ?? verification?.locationSource;
  const locationSourceLabel = {
    live_and_photo_gps: "현장·사진 위치",
    live_gps: "현장 GPS",
    photo_gps: "사진 위치",
    address_pin: "주소·핀",
  }[locationSource] ?? "위치 확인 필요";
  const photoLocationLabel = {
    matched: "일치",
    partial: "일부 확인",
    uncertain: "주의",
    mismatch: "불일치",
    unavailable: "없음",
  }[photoLocation?.status] ?? "없음";
  const aiSkipped = evidence?.aiResult?.failureReason === "court_ai_not_required";
  const aiStatusLabel = evidence?.aiStatus === "complete"
    ? "AI 확인 완료"
    : aiSkipped
      ? `AI 미실행${evidence?.aiResult?.checks?.photoCount === false ? "(사진 2장 필요)" : ""}`
      : evidence?.aiStatus === "failed" ? "AI 확인 실패" : "AI 사용 불가";
  const locatedPhotoCount = Number(photoLocation?.gpsPhotoCount ?? 0);
  const photoMaxDistance = formatMeters(photoLocation?.maxDistanceMeters);
  return (
    <section className="admin-court-evidence">
      <div>
        <strong>구장 신청 검증</strong>
        <Badge tone={evidence?.autoApproved ? "green" : evidence?.decision === "auto_approve" ? "orange" : "neutral"}>
          {loading ? "불러오는 중" : evidence?.autoApproved ? "AI 자동승인" : "관리자 검토"}
        </Badge>
      </div>
      {evidence ? <small>{aiStatusLabel} · {locationSourceLabel}{evidence.aiStatus === "complete" && Number.isFinite(confidence) ? ` · 증거 충족도 ${Math.round(confidence * 100)}%` : ""} · GPS 오차 {formatMeters(evidence.fieldAccuracyMeters)} · 핀과 {formatMeters(evidence.fieldDistanceMeters)}</small> : verification ? <small>{locationSourceLabel} · 사진 없음 · 관리자 검토</small> : null}
      {photoLocation ? <small>{locatedPhotoCount ? `사진 위치 ${locatedPhotoCount}/${photoLocation.photoCount ?? 0}장 확인` : "사진 위치정보 없음"} · {photoLocationLabel}{photoMaxDistance !== "-" ? ` · 최대 차이 ${photoMaxDistance}` : ""}</small> : null}
      {result?.photos?.length ? (
        <div className="admin-court-evidence-photos">
          {result.photos.map((photo, index) => <img key={index} src={photo} alt={`구장 검증 사진 ${index + 1}`} />)}
        </div>
      ) : null}
    </section>
  );
}
