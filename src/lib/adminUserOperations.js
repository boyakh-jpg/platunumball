export const ADMIN_USER_OPERATION_ACTIONS = Object.freeze({
  warning: {
    label: "경고 알림",
    description: "서비스 이용은 막지 않고 사용자에게 운영 경고를 보냅니다.",
  },
  publicRoomSuspend: {
    label: "공개방 이용 제한",
    description: "공개 모집방 생성·참가만 선택한 기간 동안 제한합니다.",
  },
  suspendTarget: {
    label: "전체 활동 제한",
    description: "로그인 외 주요 서비스 활동을 선택한 기간 동안 제한합니다.",
  },
});

export const ADMIN_USER_RISK_SIGNAL_META = Object.freeze({
  active_discipline: { label: "활성 제재", description: "현재 적용 중인 운영 제재가 있습니다." },
  repeated_open_reports: { label: "미처리 신고 반복", description: "현재 열린 피신고가 3건 이상입니다." },
  open_report: { label: "미처리 신고", description: "현재 열린 피신고가 있습니다." },
  repeated_received_reports: { label: "최근 피신고 반복", description: "최근 30일 피신고가 5건 이상입니다." },
  received_reports: { label: "최근 피신고", description: "최근 30일 피신고가 2건 이상입니다." },
  very_low_trust: { label: "신뢰도 매우 낮음", description: "현재 신뢰도가 50 미만입니다." },
  low_trust: { label: "신뢰도 낮음", description: "현재 신뢰도가 70 미만입니다." },
  repeated_cancelled_matches: { label: "경기 취소 반복", description: "최근 30일 참가 경기 취소가 3건 이상입니다." },
  high_room_creation: { label: "방 생성 급증", description: "최근 30일 모집방 생성이 20건 이상입니다." },
  high_report_filing: { label: "신고 제출 급증", description: "최근 30일 신고 제출이 15건 이상입니다." },
});

const ACTION_IDS = new Set(Object.keys(ADMIN_USER_OPERATION_ACTIONS));
const SUSPENSION_DAYS = new Set([3, 7, 14, 28, 42, 56, 168, 280]);

export function normalizeAdminUserOperationAction(value = "") {
  const action = String(value ?? "").trim();
  return ACTION_IDS.has(action) ? action : "warning";
}

export function normalizeAdminUserOperationDuration(value = 3) {
  const days = Number(value);
  return SUSPENSION_DAYS.has(days) ? days : 3;
}

export function validateAdminUserOperationDraft(draft = {}) {
  const targetUserId = String(draft.targetUserId ?? draft.userId ?? "").trim();
  const actionType = String(draft.actionType ?? "").trim();
  const reason = String(draft.reason ?? "").trim();
  const message = String(draft.message ?? "").trim();
  if (!targetUserId) return "대상 사용자를 선택하세요.";
  if (!ACTION_IDS.has(actionType)) return "허용된 운영 조치를 선택하세요.";
  if (reason.length < 4 || reason.length > 300) return "관리 사유를 4~300자로 입력하세요.";
  if (message.length < 4 || message.length > 500) return "사용자 안내를 4~500자로 입력하세요.";
  if (actionType !== "warning" && !SUSPENSION_DAYS.has(Number(draft.durationDays))) return "허용된 제재 기간을 선택하세요.";
  return "";
}

export function getAdminUserRiskMeta(score = 0) {
  const value = Math.max(0, Number(score) || 0);
  if (value >= 60) return { id: "high", label: "우선 검토", tone: "orange" };
  if (value >= 30) return { id: "review", label: "검토 필요", tone: "gold" };
  if (value >= 10) return { id: "watch", label: "주의 신호", tone: "blue" };
  return { id: "normal", label: "일반", tone: "neutral" };
}

export function getAdminUserRiskSignals(signalIds = []) {
  return [...new Set(Array.isArray(signalIds) ? signalIds : [])]
    .map((id) => ({ id, ...(ADMIN_USER_RISK_SIGNAL_META[id] ?? { label: id, description: "운영 검토가 필요한 신호입니다." }) }));
}
