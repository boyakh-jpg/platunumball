import { postServerAction } from "./serverActions.js";

export function requestMatchAttendanceQr(matchId) {
  return postServerAction("/api/matches/attendance-qr", { action: "issue", matchId });
}

export function scanMatchAttendanceQr(matchId, token) {
  return postServerAction("/api/matches/attendance-qr", { action: "scan", matchId, token });
}

export function resizeMatchForAttendance(matchId) {
  return postServerAction("/api/matches/attendance-qr", { action: "resize", matchId });
}
