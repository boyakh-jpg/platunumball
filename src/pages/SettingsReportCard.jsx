import { Database, MapPin } from "lucide-react";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import Badge from "../components/common/Badge.jsx";
import SearchPicker from "../components/common/SearchPicker.jsx";
import ProfileEmblem from "../components/profile/ProfileEmblem.jsx";
import TeamEmblem from "../components/team/TeamEmblem.jsx";
import { REPORT_REASONS, REPORT_TARGET_TYPES } from "../lib/reportReasons.js";
import { formatStatLine } from "../lib/matchUtils.js";
import { getMatchHashtag } from "../lib/handles.js";
import { getAdminStatusLabel } from "../lib/admin.js";
import {
  getMatchReportTitle,
  getReportTargetLabel,
  getReportTargetPlaceholder,
  getReportTargetEmptyText,
} from "./settingsPageModel.js";

export function SettingsReportCard({ controller }) {
  const {
    app,
    blockedUserIds,
    setBlockUserId,
    blockUserQuery,
    setBlockUserQuery,
    blockSavePending,
    setReportMatchId,
    reportReason,
    setReportReason,
    reportTargetQuery,
    setReportTargetQuery,
    setReportCourtRequestId,
    setReportCourtId,
    setReportCourtReviewId,
    setReportTeamId,
    setReportRemoteTarget,
    reportMemo,
    setReportMemo,
    setReportedUserIds,
    reportSubmitPending,
    reportSubmitStatus,
    reportMatchesLoading,
    reportMatchesError,
    courtAddressQuery,
    setCourtAddressQuery,
    naverAddressResults,
    setNaverAddressResults,
    courtLookupStatus,
    courtPinConfirmed,
    courtNearbyConfirmed,
    setCourtNearbyConfirmed,
    courtDraft,
    userMap,
    matchMap,
    courtRequests,
    approvedCourts,
    courtReviews,
    currentTrustScore,
    naverMapKeyReady,
    courtAddressSelected,
    courtDisplayName,
    courtHasMapPin,
    courtNearbyCandidates,
    courtRequiresUnit,
    courtNearbyReviewRequired,
    courtDuplicate,
    courtDuplicateMessage,
    courtSourceUrlInvalid,
    canOpenCourtRequestForm,
    canSubmitCourtRequest,
    blockableUsers,
    selectedBlockUserId,
    reportTargetType,
    isVoidRestoreReport,
    reportNeedsMatchData,
    selectedReportMatch,
    selectedReportCourtRequest,
    selectedReportCourt,
    selectedReportCourtReview,
    selectedReportTeam,
    selectedTeamHasUploadedEmblem,
    reportParticipantRows,
    selectedReportedUserIds,
    reportTargetSearchItems,
    reportRemoteSearchTypes,
    mapRemoteReportTarget,
    canSubmitReport,
    changeReportTargetQuery,
    renderReportTargetSearchItem,
    submitBlock,
    renderBlockUserSearchItem,
    releaseBlock,
    submitReport,
    updateCourtDraft,
    searchCourtAddress,
    pickCourtMapPin,
    selectNaverAddress,
    submitCourtRequest,
    reportCourtRequest,
    toggleReportedUser,
  } = controller;
  return (
          <Card className="section-card settings-report-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">신고</p>
                <h2>신고 접수</h2>
              </div>
              <Badge tone={app.state.reports?.length ? "orange" : "neutral"}>{app.state.reports?.length ?? 0}건</Badge>
            </div>
            <form className="form-stack" onSubmit={submitReport}>
              <label>
                사유
                <select
                  value={reportReason}
                  onChange={(event) => {
                    setReportReason(event.target.value);
                    setReportTargetQuery("");
                    setReportMatchId("");
                    setReportCourtRequestId("");
                    setReportCourtId("");
                    setReportCourtReviewId("");
                    setReportTeamId("");
                    setReportRemoteTarget(null);
                    setReportedUserIds([]);
                  }}
                >
                  <option value="">신고 사유 선택</option>
                  {REPORT_REASONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
                </select>
              </label>
              {reportReason ? (
                <div className="settings-address-search report-target-search">
                  <label>
                    {getReportTargetLabel(reportTargetType)}
                    <SearchPicker
                      value={reportTargetQuery}
                      onChange={changeReportTargetQuery}
                      placeholder={getReportTargetPlaceholder(reportTargetType)}
                      items={reportTargetSearchItems}
                      idleItems={reportTargetSearchItems}
                      remoteSearchType={reportRemoteSearchTypes}
                      remoteLimit={12}
                      mapRemoteItem={mapRemoteReportTarget}
                      idleTitle="선택 가능한 대상"
                      emptyText={reportNeedsMatchData && reportMatchesLoading
                        ? "신고 가능한 경기 확인 중"
                        : reportMatchesError || getReportTargetEmptyText(reportTargetType)}
                      showIdleOnFocus
                      fieldClassName="admin-account-search"
                      renderItem={renderReportTargetSearchItem}
                    />
                  </label>
                  <small>
                    {reportTargetType === REPORT_TARGET_TYPES.courtRequest
                      ? "허위 구장 등록은 타인의 검토 대기·신고 상태 등록요청만 표시됩니다."
                      : reportTargetType === REPORT_TARGET_TYPES.court
                        ? "승인된 구장 중 위치·상태·중복 확인이 필요한 대상만 선택합니다."
                        : reportTargetType === REPORT_TARGET_TYPES.courtReview
                          ? "내가 작성하지 않은 구장 리뷰만 신고할 수 있습니다."
                          : reportTargetType === REPORT_TARGET_TYPES.teamName
                            ? "내가 팀장인 팀은 신고할 수 없습니다."
                            : reportTargetType === REPORT_TARGET_TYPES.teamEmblem
                              ? "사용자가 올린 사진 엠블럼만 신고할 수 있습니다."
                              : reportTargetType === REPORT_TARGET_TYPES.mixed
                                ? "경기는 최근 7일 내 내 경기만, 구장과 리뷰는 신고 가능한 공개 대상만 검색됩니다."
                                : isVoidRestoreReport
                                  ? "최근 7일 안에 무효 처리됐고 내가 복구 요청할 수 있는 경기만 표시됩니다."
                                  : "최근 7일 내 내가 출전했거나 후보로 등록된 경기 안에서만 검색됩니다."}
                  </small>
                </div>
              ) : (
                <div className="ui-empty-state-compact ui-support-copy">신고 사유를 먼저 선택해 주세요.</div>
              )}
              {selectedReportCourt ? (
                <div className="arena-mini-note">
                  <div>
                    <span>선택 구장</span>
                    <strong>{selectedReportCourt.name}</strong>
                    <em>{selectedReportCourt.addressText || "주소 미정"}</em>
                  </div>
                  <MapPin size={18} />
                </div>
              ) : null}
              {selectedReportCourtReview ? (
                <div className="arena-mini-note">
                  <div>
                    <span>선택 리뷰</span>
                    <strong>{selectedReportCourtReview.courtName || "구장 리뷰"}</strong>
                    <em>{selectedReportCourtReview.rating ?? "-"}점 · {userMap[selectedReportCourtReview.reviewerId]?.name ?? "작성자"}</em>
                  </div>
                  <MapPin size={18} />
                </div>
              ) : null}
              {selectedReportMatch ? (
                <div className="arena-mini-note">
                  <div>
                    <span>선택 경기기록</span>
                    <strong>{getMatchReportTitle(selectedReportMatch)}</strong>
                    <em>{getMatchHashtag(selectedReportMatch)} · {selectedReportMatch.court || "구장 미정"}</em>
                  </div>
                  <Database size={18} />
                </div>
              ) : null}
              {selectedReportCourtRequest ? (
                <div className="arena-mini-note">
                  <div>
                    <span>선택 구장요청</span>
                    <strong>{selectedReportCourtRequest.name}</strong>
                    <em>{selectedReportCourtRequest.addressText || "주소 미정"}</em>
                  </div>
                  <MapPin size={18} />
                </div>
              ) : null}
              {selectedReportTeam ? (
                <div className="arena-mini-note report-team-note">
                  <div>
                    <span>선택 팀</span>
                    <strong>{selectedReportTeam.name}</strong>
                    <em>{selectedReportTeam.region || "지역 미정"} · {selectedReportTeam.homeCourt || "홈코트 미정"}</em>
                    {reportTargetType === REPORT_TARGET_TYPES.teamEmblem && !selectedTeamHasUploadedEmblem ? <small>사진 엠블럼을 사용 중인 팀만 신고할 수 있습니다.</small> : null}
                  </div>
                  <TeamEmblem team={selectedReportTeam} size="sm" />
                </div>
              ) : null}
              {selectedReportMatch && reportTargetType !== REPORT_TARGET_TYPES.match ? (
                <div className="report-player-picker">
                  <span>신고 대상</span>
                  <div>
                    {reportParticipantRows.map((row) => {
                      const checked = selectedReportedUserIds.includes(row.userId);
                      return (
                        <button key={row.userId} type="button" className={checked ? "ui-choice-tile selected" : "ui-choice-tile"} onClick={() => toggleReportedUser(row.userId)}>
                          <ProfileEmblem user={row.user} className="small" />
                          <span className="report-player-info">
                            <strong>{row.user.name}</strong>
                            <em>{row.sideLabel} · {row.teamName} · {row.role} · {row.user.position}</em>
                            <small>{formatStatLine(row.stats)}</small>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <small>{reportTargetType === REPORT_TARGET_TYPES.player ? "플레이어 신고는 한 번에 한 명만 선택합니다." : "선택하지 않으면 경기 기록 전체 신고로 접수됩니다."}</small>
                </div>
              ) : null}
              <label>
                상세 메모
                <textarea
                  value={reportMemo}
                  minLength={isVoidRestoreReport ? 10 : undefined}
                  placeholder={isVoidRestoreReport ? "복구가 필요한 이유를 10자 이상 적어 주세요." : "상황을 짧게 적어 주세요."}
                  onChange={(event) => setReportMemo(event.target.value)}
                />
                {isVoidRestoreReport ? <small>{reportMemo.trim().length}/10자 이상</small> : null}
              </label>
              <Button type="submit" variant="secondary" disabled={!canSubmitReport || reportSubmitPending}>{reportSubmitPending ? "저장 중" : "신고 접수"}</Button>
              {reportSubmitStatus ? <small role="status">{reportSubmitStatus}</small> : null}
            </form>
            <div className="compact-list ui-support-list">
              {app.state.reports?.slice(0, 4).map((report) => (
                <div key={report.id}>
                  <span>{
                    report.type === "court_request"
                      ? courtRequests.find((request) => request.id === report.targetId)?.name ?? "구장 등록요청"
                      : report.type === "court"
                        ? approvedCourts.find((court) => court.id === report.targetId)?.name ?? "구장"
                      : report.type === "court_review"
                          ? courtReviews.find((review) => review.id === report.targetId)?.courtName ?? "구장 리뷰"
                          : report.type === "team_name" || report.type === "team_emblem"
                            ? app.state.teams.find((team) => team.id === report.targetId)?.name ?? report.teamName ?? "팀"
                          : report.type === "player"
                            ? userMap[report.targetId]?.name ?? "플레이어"
                          : matchMap[report.targetId]
                            ? `${getMatchHashtag(matchMap[report.targetId])} ${matchMap[report.targetId].title ?? "경기"}`
                            : "경기"
                  } · {report.reason}</span>
                  <strong>{getAdminStatusLabel(report.status)}</strong>
                </div>
              ))}
            </div>
          </Card>
  );
}
