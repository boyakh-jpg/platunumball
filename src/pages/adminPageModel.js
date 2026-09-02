import { Activity, BellRing, ClipboardList, Database, Gauge, MapPin, ShieldAlert, ShieldCheck, SlidersHorizontal, UserRound } from "lucide-react";
import { ADMIN_REVIEW_ACTIONS } from "../lib/admin.js";

export const ADMIN_SECTION_OPTIONS = [
  { id: "operations", group: "운영 현황", label: "운영 현황", caption: "지금 처리할 업무", icon: Gauge },
  { id: "reports", group: "신고·검토", label: "신고 큐", caption: "전체 신고와 배정", icon: BellRing },
  { id: "courts", group: "신고·검토", label: "구장 신청", caption: "등록 신청과 구장 신고", icon: MapPin },
  { id: "players", group: "신고·검토", label: "플레이어 신고", caption: "신고와 징계", icon: UserRound },
  { id: "matches", group: "신고·검토", label: "경기 심사", caption: "기록 오류와 이의", icon: ClipboardList },
  { id: "teams", group: "신고·검토", label: "팀·소속", caption: "이름과 엠블럼 신고", icon: ShieldAlert },
  { id: "courtDb", group: "데이터 관리", label: "구장 DB", caption: "전체 조회·이름·이력", icon: Database, minLevel: 50 },
  { id: "userOps", group: "데이터 관리", label: "사용자 운영", caption: "가입자·통계·제재", icon: Activity, minLevel: 50 },
  { id: "appointments", group: "권한·정책", label: "권한 관리", caption: "심판과 관리자 임명", icon: ShieldCheck },
  { id: "ratingPolicy", group: "권한·정책", label: "MMR·신뢰도", caption: "이벤트 반영 정책", icon: SlidersHorizontal, ownerOnly: true },
];

export const ADMIN_SECTION_GROUPS = ["운영 현황", "신고·검토", "데이터 관리", "권한·정책"];

export const ADMIN_QUEUE_FOCUS_LABELS = {
  urgent: "긴급 신고",
  unassigned: "미배정 신고",
  stale: "24시간 이상 경과",
  receivedToday: "오늘 접수",
  processedToday: "오늘 처리",
  oldest: "가장 오래된 미처리",
};

export const ACTION_OPTIONS = Object.entries(ADMIN_REVIEW_ACTIONS).map(([id, meta]) => ({ id, ...meta }));

export const APPOINTMENT_ACTION_OPTIONS = [
  { id: "appointReferee", label: "심판 임명" },
  { id: "appointAdmin", label: "관리자 임명" },
  { id: "extendAppointment", label: "임명 연장" },
  { id: "revokeAppointment", label: "임명 회수" },
];

export const REVIEW_WORKFLOW_COPY = {
  courts: {
    title: "구장 신청·신고",
    queueTitle: "구장 처리 대기열",
    actionTitle: "구장 신고 처리",
    description: "신청 정보와 위치를 먼저 확인하고, 신고가 있는 경우에만 신고 조치를 처리합니다.",
  },
  players: {
    title: "플레이어 신고",
    queueTitle: "플레이어 신고 대기열",
    actionTitle: "플레이어 최종판단",
    description: "선수를 누르면 해당 플레이어에게 쌓인 신고와 제재 이력을 보고 최종판단합니다.",
  },
  matches: {
    title: "경기 심사",
    queueTitle: "경기 심사 대기열",
    actionTitle: "경기 최종판단",
    description: "경기 신고, 기록 오류, 이의 상태를 경기 단위로 확인합니다.",
  },
  teams: {
    title: "팀·소속 신고",
    queueTitle: "팀·소속 처리 대기열",
    actionTitle: "이름·엠블럼 최종판단",
    description: "팀 엠블럼과 팀명·소속명을 확인합니다. 이름 수정과 소속 통합은 경기관리자 이상만 처리합니다.",
  },
};

export const REVIEW_QUEUE_FILTER_PLACEHOLDERS = {
  courts: "구장 신청명·주소 또는 신고 사유",
  players: "신고 사유 또는 제재 상태",
  matches: "경기명·구장 또는 신고 사유",
  teams: "신고 사유",
};

export function isPendingCourtRequest(request = {}) {
  return ["pending", "reported"].includes(request.status ?? "pending");
}

export function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return date.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function appointmentStatusLabel(status) {
  if (status === "active") return "활성";
  if (status === "pending") return "대기";
  if (status === "revoked") return "회수";
  if (status === "expired") return "만료";
  return "상태 확인 중";
}
