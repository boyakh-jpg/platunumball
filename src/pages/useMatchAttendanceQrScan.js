import { useEffect } from "react";
import {
  getMatchAttendanceScanErrorMessage,
  getMatchAttendanceScanSuccessMessage,
  scanMatchAttendanceQr,
} from "../lib/matchAttendance.js";

export default function useMatchAttendanceQrScan({
  attendanceQrToken,
  attendanceScanTokenRef,
  currentUserId,
  loadMatchDetail,
  queryMatchId,
  setAttendanceScanState,
  setSearchParams,
}) {
  useEffect(() => {
    attendanceScanTokenRef.current = "";
    setAttendanceScanState(null);
  }, [currentUserId, queryMatchId]);

  useEffect(() => {
    if (!attendanceQrToken || !queryMatchId || !currentUserId || attendanceScanTokenRef.current === attendanceQrToken) return undefined;
    attendanceScanTokenRef.current = attendanceQrToken;
    let cancelled = false;
    setAttendanceScanState({ pending: true, tone: "blue", message: "QR 출석 확인 중" });

    const clearAttendanceToken = () => {
      setSearchParams((current) => {
        if (current.get("attendanceQr") !== attendanceQrToken) return current;
        const next = new URLSearchParams(current);
        next.delete("attendanceQr");
        return next;
      }, { replace: true });
    };

    const scan = async () => {
      try {
        const result = await scanMatchAttendanceQr(queryMatchId, attendanceQrToken);
        if (cancelled) return;
        setAttendanceScanState({
          pending: false,
          tone: result?.attendanceStatus === "late" ? "orange" : "green",
          message: getMatchAttendanceScanSuccessMessage(result),
        });
        await loadMatchDetail?.(queryMatchId);
      } catch (error) {
        if (cancelled) return;
        setAttendanceScanState({
          pending: false,
          tone: "orange",
          message: getMatchAttendanceScanErrorMessage(error),
        });
      } finally {
        if (!cancelled) clearAttendanceToken();
      }
    };

    void scan();
    return () => {
      cancelled = true;
    };
  }, [attendanceQrToken, currentUserId, loadMatchDetail, queryMatchId, setSearchParams]);
}
