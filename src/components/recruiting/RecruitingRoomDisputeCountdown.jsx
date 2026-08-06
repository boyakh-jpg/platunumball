import { useEffect, useState } from "react";
import { formatClockTime } from "../../lib/matchClock.js";

export default function RecruitingRoomDisputeCountdown({ closesAt }) {
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const tickId = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(tickId);
  }, []);

  return (
    <span role="timer">
      이의신청 남은 시간 <strong>{formatClockTime(closesAt.getTime() - nowMs)}</strong>
    </span>
  );
}
