import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, Database, RadioTower } from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import { formatDate } from "./adminPageModel.js";

function formatDuration(milliseconds) {
  if (!Number.isFinite(milliseconds)) return "-";
  const minutes = Math.round(milliseconds / 60000);
  if (minutes < 60) return `${minutes}분`;
  const hours = Math.round(minutes / 6) / 10;
  return hours < 24 ? `${hours}시간` : `${Math.round(hours / 2.4) / 10}일`;
}

function Metric({ label, value, detail, tone = "neutral", onClick, disabled = false }) {
  return (
    <button type="button" className={`admin-operation-metric ${tone}`} disabled={disabled} onClick={onClick}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
      <ArrowRight size={17} aria-hidden="true" />
    </button>
  );
}

function DeliveryStatus({ icon: Icon, title, status, sampleLabel }) {
  return (
    <div className="admin-system-status ui-panel">
      <Icon size={19} aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        {!status?.available ? (
          <span>canonical delivery 소스를 확인할 수 없음</span>
        ) : (
          <>
            <span>최근 실패 {status.failedLast24h}건 · 지연 {status.delayedCount}건</span>
            <small>{sampleLabel} 최대 {status.sampleLimit}건 중 {status.sampledCount}건 · 최근 성공 {formatDate(status.lastSentAt)}</small>
          </>
        )}
      </div>
    </div>
  );
}

export default function AdminOperationsPanel({ controller }) {
  const { app, activeAdminPage, navigateToReportQueue, refreshQueue } = controller;
  const operations = activeAdminPage?.operations;
  const metrics = operations?.metrics;
  const isLoading = app.adminStatus?.loading && app.adminStatus?.section === "operations";
  const hasError = app.adminStatus?.error && app.adminStatus?.section === "operations";

  if (!operations) {
    return (
      <Card className="section-card admin-queue-state" role={hasError ? "alert" : "status"}>
        <strong>{hasError ? "운영 현황을 불러오지 못했습니다." : "운영 현황을 불러오는 중입니다."}</strong>
        {hasError ? <Button type="button" variant="secondary" onClick={refreshQueue}>다시 시도</Button> : null}
      </Card>
    );
  }

  const oldest = metrics.oldestPending;
  return (
    <div className="admin-operations-dashboard">
      <section className="admin-operation-metrics" aria-label="신고 운영 지표">
        <Metric label="긴급 신고" value={metrics.urgent} detail="사람이 긴급 지정한 미처리" tone="danger" onClick={() => navigateToReportQueue("urgent")} />
        <Metric label="미처리 신고" value={metrics.pending} detail="현재 열린 전체 신고" onClick={() => navigateToReportQueue()} />
        <Metric label="미배정 신고" value={metrics.unassigned} detail="담당자가 없는 미처리" tone="warning" onClick={() => navigateToReportQueue("unassigned")} />
        <Metric label="24시간 이상 경과" value={metrics.stale} detail="접수 후 24시간 초과" tone="warning" onClick={() => navigateToReportQueue("stale")} />
        <Metric label="오늘 접수" value={metrics.receivedToday} detail="한국 시간 기준" onClick={() => navigateToReportQueue("receivedToday", "history")} />
        <Metric label="오늘 처리" value={metrics.processedToday} detail="실제 resolved_at 기준" onClick={() => navigateToReportQueue("processedToday", "history")} />
        <Metric
          label="가장 오래된 미처리"
          value={oldest ? formatDate(oldest.createdAt) : "없음"}
          detail={oldest ? "해당 신고 상세로 이동" : "현재 미처리 신고 없음"}
          disabled={!oldest}
          onClick={() => oldest && navigateToReportQueue("oldest", "pending", oldest.id)}
        />
      </section>

      <div className="admin-operation-lower-grid">
        <Card className="section-card admin-operation-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Measured timing</p>
              <h2>실제 처리 시간</h2>
            </div>
            <Clock3 size={21} aria-hidden="true" />
          </div>
          {operations.timings.firstResponse || operations.timings.processing ? (
            <div className="admin-timing-list">
              {operations.timings.firstResponse ? (
                <div className="ui-panel"><span>첫 담당 배정까지</span><strong>{formatDuration(operations.timings.firstResponse.averageMs)}</strong><small>실제 assigned_at {operations.timings.firstResponse.sampleCount}건</small></div>
              ) : null}
              {operations.timings.processing ? (
                <div className="ui-panel"><span>접수부터 처리까지</span><strong>{formatDuration(operations.timings.processing.averageMs)}</strong><small>실제 resolved_at {operations.timings.processing.sampleCount}건</small></div>
              ) : null}
            </div>
          ) : <div className="ui-empty-state-compact">실제 배정·처리 시간 표본이 없습니다.</div>}
        </Card>

        <Card className="section-card admin-operation-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Read only</p>
              <h2>시스템 상태</h2>
            </div>
            <Badge tone={operations.systems.schema.ready ? "team" : "warning"}>{operations.systems.schema.ready ? "스키마 준비" : "스키마 확인 필요"}</Badge>
          </div>
          <div className="admin-system-list">
            <div className="admin-system-status ui-panel">
              {operations.systems.schema.ready ? <CheckCircle2 size={19} /> : <AlertTriangle size={19} />}
              <div>
                <strong>운영 스키마</strong>
                <span>{operations.systems.schema.checkedCount}개 테이블 검사 · 실패 {operations.systems.schema.failedCount}개</span>
                {operations.systems.schema.failedTables.length ? <small>{operations.systems.schema.failedTables.join(", ")}</small> : null}
              </div>
            </div>
            <DeliveryStatus icon={RadioTower} title="Discord 브리지" status={operations.systems.discordBridge} sampleLabel="최근 delivery" />
            <DeliveryStatus icon={Database} title="리마인더 worker" status={operations.systems.reminderWorker} sampleLabel="최근 리마인더 delivery" />
          </div>
          <small className="admin-operation-generated">조회 시각 {formatDate(operations.generatedAt)} · 읽기 전용</small>
        </Card>
      </div>
      {isLoading ? <span className="admin-operation-refresh" role="status">갱신 중</span> : null}
    </div>
  );
}
