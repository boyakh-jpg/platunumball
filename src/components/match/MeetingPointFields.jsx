import InlineValidatedInput from "../common/InlineValidatedInput.jsx";
import { MEET_BEFORE_MINUTE_OPTIONS } from "../../lib/matchRules.js";

export default function MeetingPointFields({ draft, onChange, required = false, timingType = "scheduled" }) {
  const meetingPoint = String(draft.meetingPoint ?? "");
  const meetingPointMessage = required
    ? meetingPoint.trim().length === 0
      ? "필수"
      : meetingPoint.trim().length < 2 ? "2자 이상" : ""
    : "";

  return (
    <div className="meeting-point-fields">
      <label>
        구체적인 만남 장소
        <InlineValidatedInput
          className={required ? "meeting-point-required" : ""}
          value={meetingPoint}
          message={meetingPointMessage}
          aria-label="구체적인 만남 장소"
          maxLength={120}
          required={required}
          aria-required={required}
          placeholder="예: 체육관 1층 안내데스크 앞, 2번 코트 출입구"
          onChange={(event) => onChange({ meetingPoint: event.target.value })}
        />
      </label>
      {timingType !== "instant" ? (
        <label>
          집합 시간
          <select value={Number(draft.meetBeforeMinutes ?? 15)} onChange={(event) => onChange({ meetBeforeMinutes: Number(event.target.value) })}>
            {MEET_BEFORE_MINUTE_OPTIONS.map((minutes) => <option key={minutes} value={minutes}>경기 시작 {minutes}분 전</option>)}
          </select>
        </label>
      ) : null}
    </div>
  );
}
