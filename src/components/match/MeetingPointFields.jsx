import { MEET_BEFORE_MINUTE_OPTIONS } from "../../lib/matchRules.js";

export default function MeetingPointFields({ draft, onChange, required = false, timingType = "scheduled" }) {
  return (
    <div className="meeting-point-fields">
      <label>
        구체적인 만남 장소 {required ? <span aria-hidden="true">*</span> : null}
        <input
          value={draft.meetingPoint ?? ""}
          maxLength={120}
          required={required}
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
      <small>구장 이름과 별도로 실제로 만날 출입구·층·코트 번호를 적어 주세요.</small>
    </div>
  );
}
