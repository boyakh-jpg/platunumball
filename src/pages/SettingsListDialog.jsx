import { useEffect } from "react";
import { createPortal } from "react-dom";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import { getAdminStatusLabel } from "../lib/admin.js";
import { getCourtPublicAccessLabel } from "../lib/courts.js";
import { getSettingsReportTargetName } from "./settingsPageModel.js";

export default function SettingsListDialog({ kind, controller, onClose, onOpenDetail }) {
  useEffect(() => {
    if (!kind) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [kind, onClose]);

  if (!kind || typeof document === "undefined") return null;
  const {
    app, blockedUserIds, blockSavePending, releaseBlock, userMap, matchMap,
    courtRequests, approvedCourts, courtReviews, reportCourtRequest,
  } = controller;
  const reports = app.state.reports ?? [];
  const isReports = kind === "reports";
  const isBlocks = kind === "blocks";
  const title = isReports ? "신고 목록" : isBlocks ? "차단 플레이어" : "구장 신청 목록";
  const count = isReports ? reports.length : isBlocks ? blockedUserIds.length : courtRequests.length;
  const openDetail = (detail) => {
    onClose();
    onOpenDetail(detail);
  };

  return createPortal(
    <div className="app-confirm-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="app-confirm-dialog settings-activity-dialog settings-list-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-list-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="section-title-row">
          <strong id="settings-list-dialog-title">{title}</strong>
          <Badge tone={count ? "orange" : "neutral"}>{count}{isBlocks ? "명" : "건"}</Badge>
        </div>
        <div className="compact-list ui-support-list">
          {isReports ? reports.map((report) => (
            <div key={report.id} className="settings-history-row">
              <span>{getSettingsReportTargetName(report, { courtRequests, approvedCourts, courtReviews, teams: app.state.teams, userMap, matchMap })} · {report.reason}</span>
              <strong>{getAdminStatusLabel(report.status)}</strong>
              <button type="button" className="ui-compact-action" onClick={() => openDetail({ kind: "report", item: report })}>보기</button>
            </div>
          )) : null}
          {isBlocks ? blockedUserIds.map((userId) => (
            <div key={userId} className="settings-history-row">
              <span>{userMap[userId]?.name ?? app.state.settings?.blockedUserProfiles?.[userId]?.name ?? "플레이어"}</span>
              <div className="settings-list-actions">
                <button type="button" className="ui-compact-action" onClick={() => openDetail({ kind: "block", item: { userId } })}>보기</button>
                <button type="button" className="ui-compact-action" disabled={blockSavePending} onClick={() => releaseBlock(userId)}>해제</button>
              </div>
            </div>
          )) : null}
          {!isReports && !isBlocks ? courtRequests.map((request) => {
            const requester = userMap[request.requestedBy];
            const alreadyReported = reports.some((report) => (
              report.type === "court_request" && report.targetId === request.id
              && report.by === app.currentUserId && report.status !== "dismissed"
            ));
            const canReportRequest = request.requestedBy !== app.currentUserId
              && ["pending", "reported"].includes(request.status ?? "pending") && !alreadyReported;
            return (
              <div key={request.id} className="settings-history-row">
                <span>{request.name} · {request.addressText} · 공개 여부 {getCourtPublicAccessLabel(request)} · {requester?.name ?? "요청자"} 신뢰도 {request.requestedByTrustScore ?? requester?.trustScore ?? "-"}</span>
                <strong>{getAdminStatusLabel(request.status)}</strong>
                <div className="settings-list-actions">
                  <button type="button" className="ui-compact-action" onClick={() => openDetail({ kind: "courtRequest", item: request })}>보기</button>
                  <button type="button" className="ui-compact-action" disabled={!canReportRequest} onClick={() => { reportCourtRequest(request); onClose(); }}>
                    {alreadyReported ? "신고됨" : "신고 선택"}
                  </button>
                </div>
              </div>
            );
          }) : null}
          {!count ? <div className="ui-empty-state-compact">{isReports ? "신고 내역이 없습니다." : isBlocks ? "차단한 플레이어가 없습니다." : "요청한 구장이 없습니다."}</div> : null}
        </div>
        <div className="ui-action-row app-confirm-actions">
          <Button type="button" variant="secondary" autoFocus onClick={onClose}>닫기</Button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
