import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import SearchPicker from "../components/common/SearchPicker.jsx";
import TeamEmblem from "../components/team/TeamEmblem.jsx";
import { ADMIN_REVIEW_ACTIONS, SUSPENSION_TIERS, getAdminReportTypeLabel, getAdminStatusLabel } from "../lib/admin.js";
import { ADMIN_USER_OPERATION_ACTIONS } from "../lib/adminUserOperations.js";
import { getCourtAccessLabel, getCourtCorrectionAttributeLabel, getCourtCorrectionFieldLabel, getCourtCorrectionProposedLabel, getCourtKindLabel, getCourtLayoutLabel, getCourtLightingLabel, getCourtPaidLabel, getCourtPublicAccessLabel, getCourtSurfaceLabel } from "../lib/courts.js";
import { getMatchHashtag } from "../lib/handles.js";
import {
  formatDate,
} from "./adminPageModel.js";
import {
  DetailList,
} from "./AdminPageParts.jsx";

function CourtRequestEvidence({ app, requestId, verification }) {
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

export function AdminDetailPanel({ controller }) {
  const {
    app,
    adminLevel,
    sectionOptions,
    section,
    view,
    queueMode,
    setQueueMode,
    queueFilter,
    appliedQueueFilter,
    loadAdminSection,
    setSelectedIdByView,
    setSelectedReportIdByScope,
    actionDraft,
    mergeAffiliationQuery,
    setMergeAffiliationQuery,
    appointmentDraft,
    appointmentUserQuery,
    setAppointmentUserQuery,
    appointmentUserSnapshot,
    courtApprovalDraft,
    courtApprovalStatus,
    reviewActionStatus,
    reviewActionPending,
    reviewActionConfirming,
    setReviewActionConfirming,
    canAdmin,
    adminViewState,
    appointments,
    appointmentUsers,
    activeAppointmentOptions,
    activeRows,
    selectedRow,
    reportOptions,
    selectedReportScope,
    userMap,
    matchMap,
    selectedReport,
    selectedReportIsVoidRestore,
    selectedCourtRequest,
    selectedCourtRequester,
    courtLocationMatches,
    approvedLocationMatches,
    courtMapHref,
    courtSourceHref,
    courtApprovalPreview,
    workflow,
    sectionCounts,
    activeAdminPage,
    activeQueueTotal,
    changeSection,
    applyQueueFilter,
    updateQueueFilter,
    clearQueueFilter,
    refreshQueue,
    visibleActionOptions,
    targetCandidates,
    selectedTargetUserId,
    actionNeedsTarget,
    actionTargetIsReporter,
    actionNeedsReplacementName,
    actionNeedsMergeTarget,
    nameModerationAction,
    reviewReasonMaxLength,
    reviewActionInvalid,
    reviewActionHighImpact,
    reviewMetrics,
    selectedNeedsAction,
    updateActionDraft,
    changeReviewActionType,
    updateAppointmentDraft,
    selectAppointmentUser,
    updateCourtApprovalDraft,
    approveSelectedCourt,
    commitSelectedAction,
    commitAppointmentAction,
  } = controller;
  return (
        <Card className="section-card admin-detail-panel">
          {selectedRow ? (
            <>
              <div className="section-title-row">
                <div>
                  <p className="eyebrow">Review Detail</p>
                  <h2>{selectedRow.title}</h2>
                  <span>{selectedRow.subtitle}</span>
                </div>
                <Badge tone={selectedNeedsAction ? "orange" : "green"}>{selectedNeedsAction ? "처리 필요" : "정리됨"}</Badge>
              </div>

              <div className="admin-review-context">
                <strong>{workflow.title}</strong>
                <span>{workflow.description}</span>
              </div>

              <div className="contract-grid">
                {reviewMetrics.map((metric) => (
                  <div key={metric.label}>
                    <span>{metric.label}</span>
                    <strong>{metric.value}</strong>
                  </div>
                ))}
              </div>

              {view === "teams" && selectedRow.team && selectedReport?.type === "team_emblem" ? (
                <section className="admin-team-emblem-detail">
                  <TeamEmblem team={selectedRow.team} size="lg" />
                  <div>
                    <strong>현재 팀 엠블럼</strong>
                    <span>{selectedRow.team.emblemSource === "upload" && selectedRow.team.emblemKey ? "사진 사용 중" : "기본값 사용 중"}</span>
                    <small>누적 위반 {selectedRow.team.emblemViolationCount ?? 0}회 · 제한 종료 {formatDate(selectedRow.team.emblemUploadBlockedUntil)}</small>
                  </div>
                </section>
              ) : null}

              {view === "teams" && ["team_name", "affiliation_name"].includes(selectedReport?.type) ? (
                <section className="admin-name-moderation-detail ui-control-surface">
                  <span>{selectedReport.type === "team_name" ? "현재 팀명" : "현재 소속명"}</span>
                  <strong>{selectedRow.team?.name ?? selectedRow.affiliation?.name ?? selectedRow.title}</strong>
                  <small>{selectedReport.type === "affiliation_name" ? `${selectedRow.affiliation?.memberCount ?? 0}명 소속` : selectedRow.team?.region ?? "지역 미정"}</small>
                </section>
              ) : null}

              {view === "courts" && selectedCourtRequest ? (
                <section className="admin-court-request-detail">
                  <div className="section-title-row">
                    <div>
                      <p className="eyebrow">Court Request</p>
                      <h3>구장 신청 상세</h3>
                    </div>
                    <Badge tone={selectedCourtRequest.status === "approved" ? "green" : selectedCourtRequest.status === "reported" ? "orange" : "neutral"}>
                      {getAdminStatusLabel(selectedCourtRequest.status)}
                    </Badge>
                  </div>
                  <div className="admin-court-facts">
                    <div><span>신청자</span><strong>{selectedCourtRequester?.name ?? "확인 필요"}</strong><em>신뢰도 {selectedCourtRequest.requestedByTrustScore ?? selectedCourtRequester?.trustScore ?? "-"}</em></div>
                    <div><span>신청 시설명</span><strong>{selectedCourtRequest.facilityName || selectedCourtRequest.baseName || selectedCourtRequest.name}</strong><em>코트 구분 {selectedCourtRequest.courtUnit || "없음"}</em></div>
                    <div><span>검색 기준 주소</span><strong>{selectedCourtRequest.searchAddressText || "별도 검색 주소 없음"}</strong><em>핀 이동 전 기준</em></div>
                    <div><span>핀 기준 실제 주소</span><strong>{selectedCourtRequest.addressText || "주소 미입력"}</strong><em>{selectedCourtRequest.detailAddress || "상세주소 없음"}</em></div>
                    <div><span>도로명 · 지번</span><strong>{selectedCourtRequest.roadAddress || "도로명 없음"}</strong><em>{selectedCourtRequest.jibunAddress || "지번 없음"}</em></div>
                    <div><span>좌표</span><strong>{selectedCourtRequest.lat != null && selectedCourtRequest.lng != null ? `${Number(selectedCourtRequest.lat).toFixed(5)}, ${Number(selectedCourtRequest.lng).toFixed(5)}` : "좌표 확인 필요"}</strong><em>핀 기준 실제 위치</em></div>
                    <div><span>구장 속성</span><strong>{getCourtSurfaceLabel(selectedCourtRequest)} · {getCourtLayoutLabel(selectedCourtRequest)}</strong><em>{selectedCourtRequest.type || "확인 필요"} · {getCourtKindLabel(selectedCourtRequest)}</em></div>
                    <div><span>이용 정보</span><strong>{getCourtAccessLabel(selectedCourtRequest)} · 공개 여부 {getCourtPublicAccessLabel(selectedCourtRequest)} · {getCourtPaidLabel(selectedCourtRequest)}</strong><em>{selectedCourtRequest.type === "야외" ? getCourtLightingLabel(selectedCourtRequest) : selectedCourtRequest.type === "실내" ? "실내/조명 입력 대상 아님" : "조명 입력 대상 미확정"}</em></div>
                    {courtSourceHref ? (
                      <div>
                        <span>공식 안내/예약 링크</span>
                        <a href={courtSourceHref} target="_blank" rel="noreferrer" className="admin-court-map-link"><ExternalLink size={15} /> 링크 열기</a>
                        <em>{courtSourceHref}</em>
                      </div>
                    ) : null}
                  </div>
                  {selectedCourtRequest.locationNote ? <p className="admin-court-note">{selectedCourtRequest.locationNote}</p> : null}
                  <CourtRequestEvidence app={app} requestId={selectedCourtRequest.id} verification={selectedCourtRequest.verification} />
                  {selectedCourtRequest.status === "pending" ? (
                    <div className="admin-court-verification">
                      <div className="admin-court-verification-head">
                        <div>
                          <strong>실재 여부 확인</strong>
                          <small>주소와 핀 위치를 확인하고 승인 구장명을 최종 확정합니다.</small>
                        </div>
                        {courtMapHref ? (
                          <a href={courtMapHref} target="_blank" rel="noreferrer" className="admin-court-map-link">
                            <ExternalLink size={16} /> 네이버 지도
                          </a>
                        ) : null}
                      </div>
                      <label>
                        승인 시설명
                        <input value={courtApprovalDraft.approvedName} onChange={(event) => updateCourtApprovalDraft({ approvedName: event.target.value })} />
                        <small>저장 이름: {courtApprovalPreview || "시군구·시설명 확인 필요"}</small>
                      </label>
                      {courtLocationMatches.length ? (
                        <div className="admin-court-location-matches">
                          <strong>같은 장소 신청·등록 {courtLocationMatches.length}개</strong>
                          {courtLocationMatches.map((candidate) => (
                            <span key={`${candidate.type}-${candidate.court.id}`}>
                              <b>{candidate.court.name}</b>
                              <em>{candidate.type === "approved" ? "등록됨" : "승인 대기"} · {candidate.court.courtUnit || "코트 구분 없음"}</em>
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <label className="admin-court-check">
                        <input type="checkbox" checked={courtApprovalDraft.addressVerified} onChange={(event) => updateCourtApprovalDraft({ addressVerified: event.target.checked })} />
                        주소·핀·지도에서 실제 구장임을 확인함
                      </label>
                      {approvedLocationMatches.length ? (
                        <label className="admin-court-check">
                          <input type="checkbox" checked={courtApprovalDraft.multipleCourtsVerified} onChange={(event) => updateCourtApprovalDraft({ multipleCourtsVerified: event.target.checked })} />
                          같은 장소지만 물리적으로 다른 코트임을 확인함
                        </label>
                      ) : null}
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={
                          !courtApprovalDraft.approvedName.trim()
                          || !courtApprovalDraft.addressVerified
                          || (approvedLocationMatches.length > 0 && !courtApprovalDraft.multipleCourtsVerified)
                          || courtApprovalStatus === "승인 중"
                        }
                        onClick={approveSelectedCourt}
                      >
                        {courtApprovalStatus === "승인 중" ? "승인 중" : "확인 후 구장 승인"}
                      </Button>
                      {courtApprovalStatus ? <small>{courtApprovalStatus}</small> : null}
                    </div>
                  ) : selectedCourtRequest.status === "reported" ? (
                    <p className="admin-court-note">신고 검토 중인 요청입니다. 신고를 처리한 뒤 승인 여부를 결정해 주세요.</p>
                  ) : selectedCourtRequest.status === "rejected" ? (
                    <p className="admin-court-note">신고가 인정되어 반려된 요청입니다. 승인할 수 없습니다.</p>
                  ) : null}
                </section>
              ) : null}

              {selectedReport ? (
              <div className="admin-action-panel ui-control-surface">
                <div>
                  <strong>{workflow.actionTitle}</strong>
                  <small>선택한 신고 한 건만 처리합니다. 직접 제재와 숨김은 경기관리자 이상만 확정할 수 있습니다.</small>
                </div>
                <div className="admin-selected-report">
                  <span><Badge tone={selectedReport.status === "open" ? "orange" : "neutral"}>{getAdminReportTypeLabel(selectedReport.type)}</Badge><strong>{selectedReport.reason}</strong></span>
                  <small>신고자 {userMap[selectedReport.by]?.name ?? selectedReport.by ?? "-"} · {formatDate(selectedReport.createdAt)}</small>
                  {selectedReport.sourceMatchId && matchMap[selectedReport.sourceMatchId] ? <small>근거 경기 {getMatchHashtag(matchMap[selectedReport.sourceMatchId])} · {matchMap[selectedReport.sourceMatchId].title}</small> : null}
                  {selectedReport.courtCorrection ? (
                    <div className="admin-court-correction">
                      <span><b>수정 항목</b>{getCourtCorrectionFieldLabel(selectedReport.courtCorrection.field)}</span>
                      {selectedReport.courtCorrection.attribute ? <span><b>세부 항목</b>{getCourtCorrectionAttributeLabel(selectedReport.courtCorrection)}</span> : null}
                      <span><b>수정 제안</b>{getCourtCorrectionProposedLabel(selectedReport.courtCorrection)}</span>
                      {selectedReport.courtCorrection.note ? <span><b>추가 설명</b>{selectedReport.courtCorrection.note}</span> : null}
                      {selectedReport.courtCorrection.evidenceUrl ? <a href={selectedReport.courtCorrection.evidenceUrl} target="_blank" rel="noreferrer">근거 링크 열기 <ExternalLink size={13} /></a> : null}
                    </div>
                  ) : null}
                </div>
                <div className="arena-field-grid">
                  <label>
                    처리할 신고
                    <select
                      value={selectedReport?.id ?? ""}
                      disabled={reviewActionPending || !reportOptions.length}
                      onChange={(event) => setSelectedReportIdByScope((current) => ({ ...current, [selectedReportScope]: event.target.value }))}
                    >
                      {!reportOptions.length ? <option value="">신고 없음</option> : null}
                      {reportOptions.map((report) => (
                        <option key={report.id} value={report.id}>
                          {getAdminStatusLabel(report.status)} · {getAdminReportTypeLabel(report.type)} · {report.reason}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    처리 유형
                    <select value={actionDraft.actionType} disabled={reviewActionPending || !visibleActionOptions.length || selectedReport.status !== "open"} onChange={(event) => changeReviewActionType(event.target.value)}>
                      {visibleActionOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                  </label>
                  {selectedReportIsVoidRestore ? (
                    <label>
                      별도 제재
                      <select value={actionDraft.penaltyType} disabled={reviewActionPending} onChange={(event) => updateActionDraft({ penaltyType: event.target.value })}>
                        <option value="">제재 없음</option>
                        <option value="public_room_suspension">공개방 참가 제한</option>
                        <option value="suspension">전체 활동 제한</option>
                      </select>
                    </label>
                  ) : null}
                  {actionNeedsReplacementName ? (
                    <label>
                      변경할 이름
                      <input
                        value={actionDraft.replacementName}
                        maxLength={actionDraft.actionType === "renameTeam" ? 14 : 40}
                        disabled={reviewActionPending}
                        onChange={(event) => updateActionDraft({ replacementName: event.target.value })}
                      />
                    </label>
                  ) : null}
                  {actionNeedsTarget ? actionTargetIsReporter ? (
                    <div className="admin-fixed-target">
                      <span>제재 대상</span>
                      <strong>신고자 · {targetCandidates[0]?.name ?? "확인 불가"}</strong>
                      <small>악성신고자 제재는 선택한 신고의 신고자에게만 적용됩니다.</small>
                    </div>
                  ) : (
                    <label>
                      대상
                      <select value={selectedTargetUserId} disabled={reviewActionPending || !targetCandidates.length} onChange={(event) => updateActionDraft({ targetUserId: event.target.value })}>
                        {!targetCandidates.length ? <option value="">검증된 대상 없음</option> : null}
                        {targetCandidates.map((user) => <option key={user.id} value={user.id}>{user.name} · 신뢰도 {user.trustScore ?? "-"}</option>)}
                      </select>
                    </label>
                  ) : null}
                </div>
                {actionNeedsMergeTarget ? (
                  <label>
                    통합할 소속
                    <SearchPicker
                      value={mergeAffiliationQuery}
                      onChange={(value) => { setMergeAffiliationQuery(value); updateActionDraft({ mergeTargetId: "" }); }}
                      placeholder="남길 소속 검색"
                      items={(adminViewState.affiliations ?? []).filter((item) => item.id !== selectedReport?.targetId && (item.status ?? "active") === "active")}
                      remoteSearchType="affiliation"
                      minSearchLength={2}
                      limit={8}
                      floating
                      closeOnResultClick
                      renderItem={(item) => (
                        <button
                          key={item.id}
                          type="button"
                          className="search-picker-result-row"
                          disabled={reviewActionPending || item.id === selectedReport?.targetId}
                          onClick={() => { setMergeAffiliationQuery(item.name); updateActionDraft({ mergeTargetId: item.id }); }}
                        >
                          <span><strong>{item.name}</strong><small>{item.memberCount ?? 0}명</small></span>
                          <b>선택</b>
                        </button>
                      )}
                    />
                  </label>
                ) : null}
                {actionNeedsTarget ? <label>
                  제재 기간
                  <select value={actionDraft.durationDays} disabled={reviewActionPending} onChange={(event) => updateActionDraft({ durationDays: Number(event.target.value) })}>
                    {SUSPENSION_TIERS.map((tier) => <option key={tier.id} value={tier.days}>{tier.label}</option>)}
                  </select>
                </label> : null}
                <label>
                  처리 사유
                  <textarea value={actionDraft.reason} maxLength={reviewReasonMaxLength} placeholder="관리자 처리 사유" disabled={reviewActionPending} onChange={(event) => updateActionDraft({ reason: event.target.value })} />
                </label>
                <label>
                  신고자 피드백
                  <textarea value={actionDraft.feedback} maxLength={500} placeholder={ADMIN_REVIEW_ACTIONS[actionDraft.actionType]?.feedback} disabled={reviewActionPending} onChange={(event) => updateActionDraft({ feedback: event.target.value })} />
                </label>
                {!visibleActionOptions.length ? <small>현재 권한으로 실행할 수 있는 처리가 없습니다.</small> : null}
                {actionDraft.actionType === "markCourtDuplicate" ? <small className="form-warning">대상 구장은 비활성화되고 중복 판정과 관리자 감사 기록이 남습니다.</small> : null}
                {actionDraft.actionType === "applyCourtCorrection" ? <small className="form-warning">표시된 제안값을 구장 DB에 반영하고 신고를 처리합니다.</small> : null}
                {reviewActionConfirming ? (
                  <div className="admin-review-confirm" role="alert">
                    <span><strong>{ADMIN_REVIEW_ACTIONS[actionDraft.actionType]?.label}</strong><small>{actionDraft.actionType === "markCourtDuplicate" ? "대상 구장을 중복으로 확정하고 서비스 노출에서 제외합니다." : actionDraft.actionType === "applyCourtCorrection" ? "구조화된 제안값을 구장 DB에 반영하고 변경·신고 처리 기록을 남깁니다." : "대상과 기간, 처리 사유를 다시 확인해 주세요. 실행 후 처리 기록이 남습니다."}</small></span>
                    <Button type="button" variant="secondary" disabled={reviewActionPending} onClick={() => setReviewActionConfirming(false)}>취소</Button>
                    <Button type="button" variant="secondary" disabled={reviewActionPending || reviewActionInvalid} onClick={commitSelectedAction}>{reviewActionPending ? "처리 중" : "확정 실행"}</Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={reviewActionPending || !selectedReport || selectedReport.status !== "open" || !visibleActionOptions.length || reviewActionInvalid}
                    onClick={() => reviewActionHighImpact ? setReviewActionConfirming(true) : commitSelectedAction()}
                  >
                    {reviewActionPending ? "처리 중" : reviewActionHighImpact ? "처리 확인" : "처리 실행"}
                  </Button>
                )}
                {selectedReportIsVoidRestore ? <small>복구는 무효 처리 전 원본 기록을 사용합니다. 50%는 기존 경기 MMR 배율의 절반을 반영합니다.</small> : null}
                {selectedReportIsVoidRestore && adminLevel < 50 ? <small>경기관리자 이상만 무효 경기 심사를 처리할 수 있습니다.</small> : null}
                {actionDraft.actionType === "resetTeamEmblem" && adminLevel < 50 ? <small>경기관리자 이상만 엠블럼을 강제 전환할 수 있습니다.</small> : null}
                {nameModerationAction && adminLevel < 50 ? <small>경기관리자 이상만 이름을 수정하거나 소속을 통합할 수 있습니다.</small> : null}
                {reviewActionStatus ? <small role="status">{reviewActionStatus}</small> : null}
                <small>같은 신고의 중복 처리는 저장 시 한 번 더 확인됩니다.</small>
              </div>
              ) : view === "matches" && selectedRow.issueCount > 0 ? (
                <div className="admin-review-context">
                  <strong>연결된 신고 없음</strong>
                  <span>이 경기에는 이의 또는 승인 대기 상태만 있습니다. 경기방에서 먼저 이의 처리 결과를 확정해 주세요.</span>
                </div>
              ) : null}

              {selectedRow.reports.length ? <DetailList title={view === "courts" ? "구장 신고" : "쌓인 신고"} empty="신고 없음">
                {selectedRow.reports.length ? selectedRow.reports.slice(0, 8).map((report) => (
                  <div key={report.id} className="admin-detail-row">
                    <span>
                      <strong>{report.reason}</strong>
                      <em>
                        {report.type === "match" && matchMap[report.targetId] ? `${getMatchHashtag(matchMap[report.targetId])} · ` : ""}
                        신고자 {userMap[report.by]?.name ?? report.by ?? "-"} · {getAdminReportTypeLabel(report.type)} · {formatDate(report.createdAt)}
                      </em>
                      {report.resolution ? <small>처리 {ADMIN_REVIEW_ACTIONS[report.resolution.actionType]?.label ?? "완료"} · {userMap[report.resolvedBy]?.name ?? report.resolvedBy ?? "관리자"} · {report.resolution.reason || "사유 없음"} · {report.resolution.feedback || "답변 없음"}</small> : null}
                    </span>
                    <Badge tone={report.status === "open" ? "orange" : "neutral"}>{getAdminStatusLabel(report.status)}</Badge>
                  </div>
                )) : null}
              </DetailList> : null}

              {view === "players" ? <DetailList title="최근 제재" empty="제재 없음">
                {selectedRow.disciplinaryActions?.length ? selectedRow.disciplinaryActions.slice(0, 8).map((action) => (
                  <div key={action.id} className="admin-detail-row">
                    <span>
                      <strong>{getAdminStatusLabel(action.status)} · {ADMIN_USER_OPERATION_ACTIONS[action.actionType ?? action.type]?.label ?? (action.actionType === "suspension" ? "전체 활동 제한" : "운영 조치")}</strong>
                      <em>{action.reason || "사유 없음"} · {formatDate(action.startsAt)} ~ {formatDate(action.endsAt)}</em>
                    </span>
                    <Badge tone={action.status === "active" ? "orange" : "neutral"}>{action.durationDays ?? "-"}일</Badge>
                  </div>
                )) : null}
              </DetailList> : null}

              {selectedRow.matches.length ? <DetailList title="관련 경기" empty="관련 경기 없음">
                {selectedRow.matches.length ? selectedRow.matches.slice(0, 8).map((match) => (
                  <div key={match.id} className="admin-detail-row">
                    <span>
                      <strong>{getMatchHashtag(match)} · {match.title ?? `${match.teamA?.name ?? "A"} vs ${match.teamB?.name ?? "B"}`}</strong>
                      <em>{match.court ?? "미정 구장"} · {match.scheduledDate ?? ""} {match.scheduledTime ?? ""}</em>
                    </span>
                    <Badge tone={match.status === "disputed" ? "orange" : "neutral"}>{getAdminStatusLabel(match.status)}</Badge>
                  </div>
                )) : null}
              </DetailList> : null}

              {view === "players" && selectedRow.courtRequests.length ? <DetailList title="구장 등록요청" empty="관련 요청 없음">
                {selectedRow.courtRequests.length ? selectedRow.courtRequests.slice(0, 8).map((request) => (
                  <div key={request.id} className="admin-detail-row">
                    <span>
                      <strong>{request.name}</strong>
                      <em>{request.addressText} · {request.hashtag ?? "해시태그 자동"}</em>
                    </span>
                    <span className="ui-action-row admin-row-actions">
                      <Badge tone={request.status === "reported" ? "orange" : request.status === "approved" ? "green" : "neutral"}>{getAdminStatusLabel(request.status)}</Badge>
                      {request.status !== "approved" ? <em>구장 신청 탭에서 확인 후 승인</em> : null}
                    </span>
                  </div>
                )) : null}
              </DetailList> : null}

              {view === "courts" && selectedRow.courtReviews?.length ? <DetailList title="구장 리뷰" empty="관련 리뷰 없음">
                {selectedRow.courtReviews?.length ? selectedRow.courtReviews.slice(0, 8).map((review) => (
                  <div key={review.id} className="admin-detail-row">
                    <span>
                      <strong>{review.courtName ?? "구장 리뷰"}</strong>
                      <em>{review.rating ?? "-"}점 · {review.memo || "메모 없음"}</em>
                    </span>
                    <Badge tone={review.status === "hidden" ? "orange" : "neutral"}>{getAdminStatusLabel(review.status ?? "active")}</Badge>
                  </div>
                )) : null}
              </DetailList> : null}
            </>
          ) : (
            <div className="ui-empty-state-compact">검토할 큐가 없습니다.</div>
          )}
        </Card>
  );
}
