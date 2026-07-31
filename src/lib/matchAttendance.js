import { postServerAction } from "./serverActions.js";
import { getMatchReservePlayerIds, getMatchSidePlayerIds } from "./matchUtils.js";
import { isPracticeEntity } from "./practiceMode.js";

const MATCH_ATTENDANCE_SCAN_ERROR_LABELS = Object.freeze({
  match_attendance_qr_expired: "QR 유효시간이 끝났습니다. 경기시계의 최신 QR을 다시 스캔해 주세요.",
  match_attendance_qr_invalid: "유효하지 않은 출석 QR입니다.",
  match_attendance_player_not_registered: "이 경기에 사전 등록된 명단이 없어 QR 출석할 수 없습니다.",
  match_attendance_qr_disabled: "이 경기는 QR 출석을 사용하지 않습니다.",
  match_attendance_not_checkin_time: "경기 시작 20분 전부터 QR 출석할 수 있습니다.",
  match_late_attendance_requires_no_show: "경기 시작 시 미출석 처리된 선수만 지각 합류할 수 있습니다.",
  match_late_attendance_requires_live_match: "진행 중인 경기의 미출석 선수만 지각 합류할 수 있습니다.",
  match_late_reserve_full: "내 사이드의 후보 3명이 모두 차서 지각 후보로 등록할 수 없습니다. 현장 운영자에게 알려 주세요.",
});

export function getPracticeMatchAttendanceQrResponse(match = {}) {
  const bySide = Object.fromEntries(["teamA", "teamB"].map((sideName) => {
    const playerIds = [...new Set([
      ...getMatchSidePlayerIds(match, sideName),
      ...getMatchReservePlayerIds(match, sideName),
    ])];
    const checkedInIds = new Set(match.attendance?.[sideName] ?? []);
    const checkedInCount = playerIds.filter((playerId) => checkedInIds.has(playerId)).length;
    return [sideName, {
      total: playerIds.length,
      onTime: checkedInCount,
      late: 0,
      pending: playerIds.length - checkedInCount,
    }];
  }));
  const requiredCount = bySide.teamA.total + bySide.teamB.total;
  const checkedInCount = bySide.teamA.onTime + bySide.teamB.onTime;
  const allCheckedIn = requiredCount > 0 && checkedInCount === requiredCount;
  return {
    ok: true,
    matchId: match.id,
    qr: null,
    canResize: false,
    summary: { bySide },
    startStatus: {
      checkinOpen: true,
      scheduledStartReached: false,
      allCheckedIn,
      checkedInCount,
      requiredCount,
      missingCount: requiredCount - checkedInCount,
      canStart: allCheckedIn,
      blockReason: allCheckedIn ? "" : "attendance_pending",
    },
  };
}

export function requestMatchAttendanceQr(matchOrId) {
  if (isPracticeEntity(matchOrId)) {
    return Promise.resolve(getPracticeMatchAttendanceQrResponse(matchOrId));
  }
  const matchId = typeof matchOrId === "object" ? matchOrId?.id : matchOrId;
  return postServerAction("/api/matches/attendance-qr", { action: "issue", matchId });
}

export function scanMatchAttendanceQr(matchId, token) {
  return postServerAction("/api/matches/attendance-qr", { action: "scan", matchId, token });
}

export function resizeMatchForAttendance(matchId) {
  return postServerAction("/api/matches/attendance-qr", { action: "resize", matchId });
}

export function getMatchAttendanceScanSuccessMessage(result = {}) {
  if (result.attendanceStatus === "late") return "지각 출석 완료 · 같은 사이드 후보로 등록됐습니다.";
  if (result.alreadyCheckedIn) return "이미 출석 완료된 경기입니다.";
  return "정상 출석이 완료됐습니다.";
}

export function getMatchAttendanceScanErrorMessage(error) {
  const code = String(error?.code || error?.message || "");
  return MATCH_ATTENDANCE_SCAN_ERROR_LABELS[code]
    || "QR 출석 처리에 실패했습니다. 현장 운영자에게 알려 주세요.";
}
