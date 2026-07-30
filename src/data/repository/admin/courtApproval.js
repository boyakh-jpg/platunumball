import { findCourtDuplicate } from "../../../lib/courts.js";
import { getCourtDuplicateMessage } from "../../../lib/courts.js";
import { getCourtFacilityBaseName } from "../../../lib/courts.js";
import { getCourtHoopCount } from "../../../lib/courts.js";
import { getCourtLocationMatches } from "../../../lib/courts.js";
import { getCourtReservationValue } from "../../../lib/courts.js";
import { getCourtStandardName } from "../../../lib/courts.js";
import { hasAdminAccess } from "../../../lib/admin.js";
import { makeId } from "../../rowUtils.js";
import { normalizeCourtAccessType } from "../../../lib/courts.js";
import { normalizeCourtKind } from "../../../lib/courts.js";
import { normalizeCourtLayout } from "../../../lib/courts.js";
import { normalizeCourtOptionalBoolean } from "../../../lib/courts.js";
import { normalizeCourtPublicAccess } from "../../../lib/courts.js";
import { normalizeCourtSigungu } from "../../../lib/courts.js";
import { normalizeCourtSourceUrl } from "../../../lib/courts.js";
import { normalizeCourtSurfaceType } from "../../../lib/courts.js";
import { normalizeCourtType } from "../../../lib/courts.js";
import { normalizeStateSettings as normalizeSettings } from "../../stateNormalizer.js";
import { getAdminActionNotification } from "./review.js";

export function approveCourtRequest(state, requestId, approval = {}) {
  if (!hasAdminAccess(state.users.find((user) => user.id === state.currentUserId), state.settings)) {
    return {
      ...state,
      notifications: [getAdminActionNotification("관리자 권한이 없습니다."), ...state.notifications],
    };
  }
  const request = (state.settings?.courtRequests ?? []).find((item) => item.id === requestId);
  if (!request) {
    return {
      ...state,
      notifications: [getAdminActionNotification("승인할 구장 요청을 찾을 수 없습니다."), ...state.notifications],
    };
  }
  const hasOpenReport = (state.reports ?? []).some((report) => (
    report.type === "court_request" && report.targetId === requestId && report.status === "open"
  ));
  if (request.status !== "pending" || hasOpenReport) {
    return {
      ...state,
      notifications: [getAdminActionNotification("신고 검토 중이거나 종결된 구장 요청은 승인할 수 없습니다."), ...state.notifications],
    };
  }
  if (!approval.addressVerified) {
    return {
      ...state,
      notifications: [getAdminActionNotification("주소와 지도 위치 확인이 필요합니다."), ...state.notifications],
    };
  }
  const approvedSigungu = normalizeCourtSigungu(
    request.sigungu,
    request.addressText || request.roadAddress || request.jibunAddress,
    request.sido,
    request.region,
  );
  const approvedFacilityName = getCourtFacilityBaseName(
    approval.approvedName || request.facilityName || request.baseName || request.name,
    approvedSigungu,
    request.courtUnit,
  );
  const approvedName = getCourtStandardName({ ...request, name: approvedFacilityName, facilityName: approvedFacilityName });
  const approvalCourt = { ...request, name: approvedName, facilityName: approvedFacilityName, canonicalBaseName: approvedName };
  if (!approvedName) {
    return {
      ...state,
      notifications: [getAdminActionNotification("시군구와 시설명을 확인해야 합니다."), ...state.notifications],
    };
  }
  const sameLocationCourts = getCourtLocationMatches(
    approvalCourt,
    state,
    { excludeRequestId: requestId, includeRequests: false },
  );
  if (sameLocationCourts.length && !approval.multipleCourtsVerified) {
    return {
      ...state,
      notifications: [getAdminActionNotification("같은 장소의 복수 코트 여부를 확인해야 합니다."), ...state.notifications],
    };
  }
  const duplicateCourt = findCourtDuplicate(
    approvalCourt,
    state,
    { excludeRequestId: requestId, includeRequests: false },
  );
  if (duplicateCourt) {
    return {
      ...state,
      notifications: [getAdminActionNotification(getCourtDuplicateMessage(duplicateCourt)), ...state.notifications],
    };
  }
  const now = new Date().toISOString();
  const approvedCourt = {
    id: makeId("court"),
    name: approvedName,
    baseName: approvedFacilityName,
    facilityName: approvedFacilityName,
    courtUnit: request.courtUnit,
    sido: request.sido,
    sigungu: approvedSigungu,
    hashtag: request.hashtag,
    region: request.region,
    type: normalizeCourtType(request.type),
    addressText: request.addressText,
    roadAddress: request.roadAddress,
    jibunAddress: request.jibunAddress,
    addressDong: request.addressDong,
    zonecode: request.zonecode,
    detailAddress: request.detailAddress,
    locationNote: request.locationNote,
    lat: request.lat,
    lng: request.lng,
    courtKind: normalizeCourtKind(request.courtKind),
    surfaceType: normalizeCourtSurfaceType(request.surfaceType),
    courtLayout: normalizeCourtLayout(request.courtLayout),
    hoopCount: getCourtHoopCount(request),
    accessType: normalizeCourtAccessType(request.accessType, request.reservation),
    publicAccess: normalizeCourtPublicAccess(request.publicAccess),
    reservation: getCourtReservationValue(request),
    lighting: normalizeCourtOptionalBoolean(request.lighting),
    paid: normalizeCourtOptionalBoolean(request.paid),
    sourceUrl: normalizeCourtSourceUrl(request.sourceUrl),
    favorite: false,
    approvedAt: now,
    approvedBy: state.currentUserId,
    sourceRequestId: requestId,
  };
  const auditLog = {
    id: makeId("aa"),
    type: "court_approval",
    status: "committed",
    requestId,
    courtId: approvedCourt.id,
    targetUserId: request.requestedBy,
    createdAt: now,
    createdBy: state.currentUserId,
  };
  return {
    ...state,
    settings: normalizeSettings({
      ...(state.settings ?? {}),
      approvedCourts: [approvedCourt, ...(state.settings?.approvedCourts ?? [])],
      courtRequests: (state.settings?.courtRequests ?? []).map((item) => (
        item.id === requestId
          ? { ...item, name: approvedName, status: "approved", approvedAt: now, approvedBy: state.currentUserId, approvedCourtId: approvedCourt.id }
          : item
      )),
      adminAuditLog: [auditLog, ...(state.settings?.adminAuditLog ?? [])],
    }),
    notifications: [
      getAdminActionNotification("구장 등록요청이 승인되어 등록 구장에 추가되었습니다.", "team"),
      {
        id: makeId("n"),
        targetUserId: request.requestedBy,
        title: "구장 등록 승인",
        body: `${approvedName} 구장 등록요청이 승인되었습니다.`,
        tone: "team",
      },
      ...state.notifications,
    ],
  };
}
