import { useMemo, useState } from "react";
import { AlertTriangle, ClipboardList, MapPin, ShieldCheck, UserRound } from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import Card from "../components/common/Card.jsx";
import { ADMIN_BACKEND_TODO, buildAdminReviewModel, hasAdminAccess } from "../lib/admin.js";

const VIEW_OPTIONS = [
  { id: "courts", label: "구장별", icon: MapPin },
  { id: "players", label: "플레이어별", icon: UserRound },
  { id: "matches", label: "경기별", icon: ClipboardList },
];

function statusLabel(status) {
  if (status === "resolved") return "처리됨";
  if (status === "dismissed") return "기각";
  if (status === "reported") return "신고됨";
  if (status === "disputed") return "이의제기";
  if (status === "open") return "대기";
  return status || "대기";
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return date.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function DetailList({ title, empty, children }) {
  return (
    <div className="admin-detail-list">
      <strong>{title}</strong>
      <div>{children ?? <span className="admin-empty-line">{empty}</span>}</div>
    </div>
  );
}

export default function Admin({ app }) {
  const [view, setView] = useState("courts");
  const [selectedIdByView, setSelectedIdByView] = useState({});
  const canAdmin = hasAdminAccess(app.currentUser);
  const model = useMemo(() => buildAdminReviewModel(app.state), [app.state]);
  const activeRows = model[view] ?? [];
  const selectedId = selectedIdByView[view];
  const selectedRow = activeRows.find((row) => row.id === selectedId) ?? activeRows[0] ?? null;

  if (!canAdmin) {
    return (
      <div className="page-stack admin-page">
        <Card className="section-card admin-denied-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Admin</p>
              <h1>관리자 권한 없음</h1>
            </div>
            <ShieldCheck size={22} />
          </div>
          <p>관리자 메뉴는 권한자에게만 표시됩니다.</p>
          <small>{ADMIN_BACKEND_TODO}</small>
        </Card>
      </div>
    );
  }

  return (
    <div className="page-stack admin-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Admin Console</p>
          <h1>관리자 메뉴</h1>
        </div>
        <Badge tone="orange">mock 권한</Badge>
      </header>

      <div className="admin-summary-grid">
        <Card className="section-card">
          <span>대기 신고</span>
          <strong>{model.summary.openReportCount}</strong>
          <em>처리 필요</em>
        </Card>
        <Card className="section-card">
          <span>전체 신고</span>
          <strong>{model.summary.reportCount}</strong>
          <em>누적</em>
        </Card>
        <Card className="section-card">
          <span>문제 경기</span>
          <strong>{model.summary.matchIssueCount}</strong>
          <em>신고/이의</em>
        </Card>
        <Card className="section-card">
          <span>구장 요청</span>
          <strong>{model.summary.courtRequestCount}</strong>
          <em>등록/허위 검토</em>
        </Card>
      </div>

      <Card className="section-card admin-backend-note">
        <AlertTriangle size={18} />
        <span>{ADMIN_BACKEND_TODO}</span>
      </Card>

      <div className="admin-workbench">
        <Card className="section-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Sorted Queue</p>
              <h2>검토 큐</h2>
            </div>
            <Badge tone="blue">{activeRows.length}건</Badge>
          </div>

          <div className="segmented-control">
            {VIEW_OPTIONS.map((option) => {
              const Icon = option.icon;
              return (
                <button key={option.id} type="button" className={view === option.id ? "active" : ""} onClick={() => setView(option.id)}>
                  <Icon size={15} /> {option.label}
                </button>
              );
            })}
          </div>

          <div className="admin-sort-list">
            {activeRows.map((row) => (
              <button
                key={row.id}
                type="button"
                className={selectedRow?.id === row.id ? "admin-sort-row active" : "admin-sort-row"}
                onClick={() => setSelectedIdByView((current) => ({ ...current, [view]: row.id }))}
              >
                <span>
                  <strong>{row.title}</strong>
                  <em>{row.subtitle}</em>
                </span>
                <span className="admin-sort-counts">
                  <b>{row.issueCount ?? row.openCount}</b>
                  <small>이슈</small>
                  <b>{row.reportCount}</b>
                  <small>신고</small>
                </span>
              </button>
            ))}
          </div>
        </Card>

        <Card className="section-card admin-detail-panel">
          {selectedRow ? (
            <>
              <div className="section-title-row">
                <div>
                  <p className="eyebrow">Review Detail</p>
                  <h2>{selectedRow.title}</h2>
                  <span>{selectedRow.subtitle}</span>
                </div>
                <Badge tone={selectedRow.openCount ? "orange" : "green"}>{selectedRow.openCount ? "처리 필요" : "정리됨"}</Badge>
              </div>

              <div className="contract-grid">
                <div>
                  <span>신고</span>
                  <strong>{selectedRow.reportCount}</strong>
                </div>
                <div>
                  <span>이슈</span>
                  <strong>{selectedRow.issueCount ?? selectedRow.openCount}</strong>
                </div>
                <div>
                  <span>경기</span>
                  <strong>{selectedRow.matchCount ?? 0}</strong>
                </div>
                <div>
                  <span>구장요청</span>
                  <strong>{selectedRow.courtRequestCount ?? 0}</strong>
                </div>
              </div>

              <DetailList title="쌓인 신고" empty="신고 없음">
                {selectedRow.reports.length ? selectedRow.reports.slice(0, 8).map((report) => (
                  <div key={report.id} className="admin-detail-row">
                    <span>
                      <strong>{report.reason}</strong>
                      <em>{report.type} · {formatDate(report.createdAt)}</em>
                    </span>
                    <Badge tone={report.status === "open" ? "orange" : "neutral"}>{statusLabel(report.status)}</Badge>
                  </div>
                )) : null}
              </DetailList>

              <DetailList title="관련 경기" empty="관련 경기 없음">
                {selectedRow.matches.length ? selectedRow.matches.slice(0, 8).map((match) => (
                  <div key={match.id} className="admin-detail-row">
                    <span>
                      <strong>{match.title ?? `${match.teamA?.name ?? "A"} vs ${match.teamB?.name ?? "B"}`}</strong>
                      <em>{match.court ?? "미정 구장"} · {match.scheduledDate ?? ""} {match.scheduledTime ?? ""}</em>
                    </span>
                    <Badge tone={match.status === "disputed" ? "orange" : "neutral"}>{statusLabel(match.status)}</Badge>
                  </div>
                )) : null}
              </DetailList>

              <DetailList title="구장 등록요청" empty="관련 요청 없음">
                {selectedRow.courtRequests.length ? selectedRow.courtRequests.slice(0, 8).map((request) => (
                  <div key={request.id} className="admin-detail-row">
                    <span>
                      <strong>{request.name}</strong>
                      <em>{request.addressText} · {request.lat ?? "-"}, {request.lng ?? "-"}</em>
                    </span>
                    <Badge tone={request.status === "reported" ? "orange" : "neutral"}>{statusLabel(request.status)}</Badge>
                  </div>
                )) : null}
              </DetailList>
            </>
          ) : (
            <div className="empty-state">검토할 큐가 없습니다.</div>
          )}
        </Card>
      </div>
    </div>
  );
}
