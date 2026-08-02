import { MapPin, Send } from "lucide-react";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import Badge from "../components/common/Badge.jsx";
import SearchPicker from "../components/common/SearchPicker.jsx";
import { COURT_REQUEST_TRUST_MIN } from "../lib/constants.js";
import { COURT_ACCESS_OPTIONS, COURT_KIND_OPTIONS, COURT_LAYOUT_OPTIONS, COURT_PUBLIC_ACCESS_OPTIONS, COURT_SOURCE_URL_MAX_LENGTH, COURT_SURFACE_OPTIONS, COURT_TYPE_OPTIONS, getCourtAccessLabel, getCourtKindLabel, getCourtLayoutLabel, getCourtPaidLabel, getCourtPublicAccessLabel, getCourtSurfaceLabel, normalizeCourtFacilityName } from "../lib/courts.js";
import { getAdminStatusLabel } from "../lib/admin.js";
import { COURT_COST_OPTIONS, COURT_LIGHTING_OPTIONS, formatCourtDistance } from "./settingsPageModel.js";

import { SettingsReportCard } from "./SettingsReportCard.jsx";
export default function SettingsSideColumn({ controller }) {
  const {
    app,
    blockedUserIds,
    setBlockUserId,
    blockUserQuery,
    setBlockUserQuery,
    blockSavePending,
    blockSaveStatus,
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
    courtAddressSearchPending,
    courtPinPending,
    courtSubmitPending,
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
<aside className="page-stack settings-side-column">
          <Card className="section-card settings-block-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">차단</p>
                <h2>플레이어 숨김</h2>
              </div>
              <Badge tone={blockedUserIds.length ? "orange" : "neutral"}>{blockedUserIds.length}명</Badge>
            </div>
            <form className="form-stack" onSubmit={submitBlock}>
              <SearchPicker
                value={blockUserQuery}
                onChange={(value) => {
                  setBlockUserQuery(value);
                  setBlockUserId("");
                }}
                placeholder="이름 또는 해시태그 검색"
                items={blockableUsers}
                remoteSearchType="player"
                mapRemoteItem={(item) => item.player ?? item}
                title="플레이어 검색 결과"
                emptyText="검색 결과 없음"
                floating
                closeOnResultClick
                renderItem={renderBlockUserSearchItem}
              />
              <Button type="submit" variant="secondary" disabled={!selectedBlockUserId || blockSavePending}>{blockSavePending ? "저장 중" : "차단"}</Button>
              {blockSaveStatus ? <small role="status">{blockSaveStatus}</small> : null}
            </form>
            <div className="compact-list ui-support-list">
              {blockedUserIds.length ? blockedUserIds.map((userId) => (
                <div key={userId}>
                  <span>{userMap[userId]?.name ?? app.state.settings?.blockedUserProfiles?.[userId]?.name ?? "플레이어"}</span>
                  <button type="button" disabled={blockSavePending} onClick={() => releaseBlock(userId)}>해제</button>
                </div>
              )) : <div><span>차단한 플레이어가 없습니다.</span><strong>0</strong></div>}
            </div>
          </Card>

          <Card className="section-card settings-court-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Court</p>
                <h2>구장 등록요청</h2>
              </div>
              <Badge tone={canSubmitCourtRequest ? "green" : "orange"}>신뢰도 {currentTrustScore}</Badge>
            </div>
            <div className={canSubmitCourtRequest ? "tier-range-note" : "tier-range-note tier-range-note-warning"}>
              <div>
                <span>등록 권한</span>
                <strong>{currentTrustScore < COURT_REQUEST_TRUST_MIN ? "등록 제한" : courtDuplicate ? "중복 확인 필요" : courtNearbyReviewRequired && !courtNearbyConfirmed ? "근처 구장 확인 필요" : courtSourceUrlInvalid ? "링크 확인 필요" : "등록 가능"}</strong>
                <em>{courtDuplicateMessage || (courtNearbyReviewRequired && !courtNearbyConfirmed ? "근처 등록·검토 중 구장을 확인하고 체크해 주세요." : courtSourceUrlInvalid ? "공식 안내 링크는 https:// 주소만 사용할 수 있습니다." : `신뢰도 ${COURT_REQUEST_TRUST_MIN}점 이상 필요 · 허위 등록은 운영 정책에 따라 신뢰도 차감`)}</em>
              </div>
              <MapPin size={22} />
            </div>
            {canOpenCourtRequestForm ? (
              <form className="form-stack" onSubmit={submitCourtRequest}>
                <div className="settings-address-search">
                  <label>
                    근처 주소 검색
                    <input
                      value={courtAddressQuery}
                      onChange={(event) => {
                        setCourtAddressQuery(event.target.value);
                        setNaverAddressResults([]);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          searchCourtAddress();
                        }
                      }}
                      placeholder="구장 근처 도로명, 건물명 검색"
                    />
                  </label>
                  <div className="settings-address-actions">
                    <Button type="button" variant="secondary" onClick={searchCourtAddress} disabled={courtAddressSearchPending || !courtAddressQuery.trim()}>
                      {courtAddressSearchPending ? "주소 찾는 중" : "근처 주소 찾기"}
                    </Button>
                    <Button type="button" variant="secondary" onClick={pickCourtMapPin} disabled={courtPinPending || courtSubmitPending || !courtAddressSelected || !naverMapKeyReady}>
                      {courtPinPending ? "위치 확인 중" : "실제 위치 확정"}
                    </Button>
                  </div>
                  {naverAddressResults.length ? (
                    <div className="settings-address-results">
                      {naverAddressResults.map((result) => (
                        <button key={result.id} type="button" onClick={() => selectNaverAddress(result)}>
                          <strong>{result.roadAddress || result.addressText}</strong>
                          <span>{result.jibunAddress || result.addressText}</span>
                          <em>지도 이동 기준</em>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {courtLookupStatus ? <small>{courtLookupStatus}</small> : null}
                </div>
                <div className="form-grid two">
                  <label>
                    시설/장소명
                    <input
                      value={courtDraft.name}
                      placeholder="예: 보라매공원"
                      onChange={(event) => updateCourtDraft({ name: event.target.value, buildingName: "" })}
                      onBlur={(event) => updateCourtDraft({ name: normalizeCourtFacilityName(event.target.value), buildingName: "" })}
                    />
                  </label>
                  <label>
                    코트 구분 {courtRequiresUnit ? "(필수)" : "(선택)"}
                    <input value={courtDraft.courtUnit} placeholder="예: 1코트, B코트, 실내" onChange={(event) => updateCourtDraft({ courtUnit: event.target.value })} />
                  </label>
                </div>
                <div className="settings-place-name-actions">
                  <small>핀 주소의 시군구와 시설명을 합쳐 `시군구 + 시설명 + 농구장`으로 저장합니다.</small>
                  {courtDraft.buildingName ? <small>주소 건물명 `{courtDraft.buildingName}` 자동 반영 · 직접 수정하면 수동 시설명을 사용</small> : null}
                </div>
                {courtDisplayName ? (
                  <div className="arena-mini-note">
                    <div>
                      <span>저장 구장명</span>
                      <strong>{courtDisplayName}</strong>
                      <em>시군구·시설/장소명·코트 구분으로 자동 생성 · 해시태그 자동 부여</em>
                    </div>
                    <MapPin size={18} />
                  </div>
                ) : null}
                {courtPinConfirmed && courtNearbyCandidates.length ? (
                  <div className="arena-mini-note arena-mini-note-warning settings-nearby-courts">
                    <div className="section-title-row settings-nearby-courts-head">
                      <div>
                        <span>근처 등록·검토 중 구장</span>
                        <strong>{courtNearbyCandidates.length}개 확인</strong>
                      </div>
                      <MapPin size={18} />
                    </div>
                    <div className="settings-nearby-court-list">
                      {courtNearbyCandidates.map((item) => (
                        <div key={`${item.type}:${item.court?.id ?? item.court?.name}`}>
                          <span>
                            <b>{item.court?.name ?? "구장"}</b>
                            <small>{item.court?.addressText || item.court?.roadAddress || item.court?.jibunAddress || "주소 미확인"}</small>
                          </span>
                          <em>{item.type === "approved" ? "등록됨" : "검토 중"} · {item.sameLocation ? "같은 장소" : formatCourtDistance(item.distanceMeters)}</em>
                        </div>
                      ))}
                    </div>
                    {courtRequiresUnit ? <small>같은 장소 후보가 있습니다. 실제로 다른 코트라면 코트 구분을 입력해 주세요.</small> : null}
                    <label className="settings-nearby-confirm">
                      <input type="checkbox" checked={courtNearbyConfirmed} onChange={(event) => setCourtNearbyConfirmed(event.target.checked)} />
                      <span>위 구장과 중복이 아닌지 확인했습니다.</span>
                    </label>
                  </div>
                ) : null}
                {courtAddressSelected ? (
                  <div className="arena-mini-note">
                    <div>
                      <span>{courtPinConfirmed ? "핀 기준 실제 주소" : "검색 기준 주소"}</span>
                      <strong>{courtDraft.addressText}</strong>
                      <em>{courtPinConfirmed ? "지도 위치와 주소를 확인했습니다." : naverMapKeyReady ? "지도 핀으로 최종 주소를 확정해 주세요." : "지도 기능을 준비 중입니다."}</em>
                    </div>
                    <MapPin size={18} />
                  </div>
                ) : null}
                <label>
                  상세주소
                  <input value={courtDraft.detailAddress} placeholder="예: 체육관 B1, 남문 출입구" onChange={(event) => updateCourtDraft({ detailAddress: event.target.value })} />
                </label>
                {courtDuplicate ? (
                  <div className="arena-mini-note arena-mini-note-warning">
                    <div>
                      <span>중복 확인</span>
                      <strong>{courtDuplicate.court?.name ?? "기존 구장"}</strong>
                      <em>{courtDuplicateMessage}</em>
                    </div>
                    <MapPin size={18} />
                  </div>
                ) : null}
                <div className="form-grid two">
                  <label>
                    유형
                    <select
                      value={courtDraft.type}
                      onChange={(event) => updateCourtDraft({
                        type: event.target.value,
                        ...(event.target.value === "야외" ? {} : { lighting: null }),
                      })}
                    >
                      {COURT_TYPE_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                  </label>
                  <label>
                    구장 분류
                    <select value={courtDraft.courtKind} onChange={(event) => updateCourtDraft({ courtKind: event.target.value })}>
                      {COURT_KIND_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                  </label>
                </div>
                <div className="form-grid two">
                  <label>
                    바닥
                    <select value={courtDraft.surfaceType} onChange={(event) => updateCourtDraft({ surfaceType: event.target.value })}>
                      {COURT_SURFACE_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                  </label>
                  <label>
                    코트 형태
                    <select value={courtDraft.courtLayout} onChange={(event) => updateCourtDraft({ courtLayout: event.target.value })}>
                      {COURT_LAYOUT_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                  </label>
                </div>
                <div className="arena-mini-note">
                  <div>
                    <span>구장 속성</span>
                    <strong>{getCourtSurfaceLabel(courtDraft)} · {getCourtLayoutLabel(courtDraft)}</strong>
                    <em>{courtDraft.type} · {getCourtKindLabel(courtDraft)} · {getCourtAccessLabel(courtDraft)} · 공개 여부 {getCourtPublicAccessLabel(courtDraft)} · {getCourtPaidLabel(courtDraft)}</em>
                  </div>
                  <MapPin size={18} />
                </div>
                <div className="form-grid two">
                  <label>
                    이용 방식
                    <select value={courtDraft.accessType} onChange={(event) => updateCourtDraft({ accessType: event.target.value })}>
                      {COURT_ACCESS_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                  </label>
                  <label>
                    공개 여부
                    <select value={courtDraft.publicAccess} onChange={(event) => updateCourtDraft({ publicAccess: event.target.value })}>
                      {COURT_PUBLIC_ACCESS_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                  </label>
                </div>
                <label>
                  비용
                  <select
                    value={courtDraft.paid === true ? "paid" : courtDraft.paid === false ? "free" : "unknown"}
                    onChange={(event) => updateCourtDraft({
                      paid: COURT_COST_OPTIONS.find((option) => option.id === event.target.value)?.value ?? null,
                    })}
                  >
                    {COURT_COST_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                  </select>
                </label>
                <small>실제 이용 권한을 아는 경우에만 공개 또는 비공개를 선택해 주세요. 지도만으로는 추정하지 않습니다.</small>
                {courtDraft.type === "야외" ? (
                  <label>
                    야간 조명
                    <select
                      value={courtDraft.lighting === true ? "yes" : courtDraft.lighting === false ? "no" : "unknown"}
                      onChange={(event) => updateCourtDraft({
                        lighting: COURT_LIGHTING_OPTIONS.find((option) => option.id === event.target.value)?.value ?? null,
                      })}
                    >
                      {COURT_LIGHTING_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                  </label>
                ) : null}
                <label>
                  공식 안내/예약 링크 (선택)
                  <input
                    type="url"
                    inputMode="url"
                    maxLength={COURT_SOURCE_URL_MAX_LENGTH}
                    value={courtDraft.sourceUrl}
                    placeholder="https://..."
                    aria-invalid={courtSourceUrlInvalid || undefined}
                    onChange={(event) => updateCourtDraft({ sourceUrl: event.target.value })}
                  />
                  <small>{courtSourceUrlInvalid ? "https:// 주소만 입력할 수 있습니다." : "공식 시설 안내나 예약 페이지가 있을 때만 입력해 주세요."}</small>
                </label>
                <label>
                  찾아가는 메모
                  <textarea value={courtDraft.locationNote} placeholder="예: 나들목 지나 오른쪽 두 번째 골대" onChange={(event) => updateCourtDraft({ locationNote: event.target.value })} />
                </label>
                <Button type="submit" variant="secondary" disabled={courtSubmitPending || courtPinPending || !canSubmitCourtRequest || !courtDisplayName || !courtAddressSelected || !courtHasMapPin || !courtPinConfirmed}>
                  <Send size={16} /> {courtSubmitPending ? "저장 중" : "등록요청"}
                </Button>
              </form>
            ) : null}
            <div className="compact-list ui-support-list">
              {courtRequests.slice(0, 4).map((request) => {
                const requester = userMap[request.requestedBy];
                const alreadyReported = app.state.reports?.some((report) => (
                  report.type === "court_request" &&
                  report.targetId === request.id &&
                  report.by === app.currentUserId &&
                  report.status !== "dismissed"
                ));
                const canReportRequest = request.requestedBy !== app.currentUserId
                  && ["pending", "reported"].includes(request.status ?? "pending")
                  && !alreadyReported;
                return (
                  <div key={request.id}>
                    <span>{request.name} · {request.addressText} · 공개 여부 {getCourtPublicAccessLabel(request)} · {requester?.name ?? "요청자"} 신뢰도 {request.requestedByTrustScore ?? requester?.trustScore ?? "-"}</span>
                    <strong>{getAdminStatusLabel(request.status)}</strong>
                    <button type="button" disabled={!canReportRequest} onClick={() => reportCourtRequest(request)}>
                      {alreadyReported ? "신고됨" : "신고 선택"}
                    </button>
                  </div>
                );
              })}
              {!courtRequests.length ? <div className="settings-court-empty"><span>요청한 구장이 없습니다.</span></div> : null}
            </div>
          </Card>

<SettingsReportCard controller={controller} />

        </aside>
  );
}
