import { createPortal } from "react-dom";
import {
  BellRing,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Power,
  RotateCcw,
  Volume2,
  VolumeX,
} from "lucide-react";
import Badge from "../common/Badge.jsx";
import Button from "../common/Button.jsx";
import QrCode from "../common/QrCode.jsx";
import {
  SHOT_CLOCK_OPTIONS,
  formatClockTime,
  getMatchClockPeriodLabel,
} from "../../lib/matchClock.js";
import "../../styles/match-clock.css";

function getClockControllerLabel(player = {}) {
  const roleLabel = player.role === "referee"
    ? "심판"
    : player.role === "reserve"
      ? "후보"
      : "출전";
  return `${player.name} · ${roleLabel}`;
}

export default function MatchClockPanelView({ context }) {
  const { activePlayers, applyResponse, attendanceQr, breakElapsedMs, breakLimitMinutes, breakLimitMs, breakOvertimeMs, breakRemainingMs, canEndMatch, canResetShotClock, clockClient, clockEditableScoreSides, closeFocusMode, configurationDirtyRef, confirmAction, controller, controllerCanEditScores, deadlineRemainingMs, deviceNotice, directScoreControlsEnabled, editableScoreSides, enableMediaControl, error, focusMode, halftimeAfterPeriod, hasRemainingPeriodTime, incrementScore, isBreak, isEnded, isHalftimeBreak, isPending, isRunning, lastMediaResetAtRef, liveClock, liveControllerCanEditScores, match, matchEndedNotifiedRef, matchRules, mediaControlEligible, mediaResetEnabled, nowMs, onEndMatch, onIncrementScore, onMatchEnded, onRosterChanged, openFocusMode, pendingAction, periodDisplayLabel, recognition, regulationEnded, requestMatchEnd, requestWakeLock, rosterRevisionRef, runAction, saveConfiguration, score, scoreError, scorePendingSide, scoreboardEnabled, selectController, selectShotClock, selectedControllerId, setActivePlayers, setAttendanceQr, setDeviceNotice, setError, setFocusMode, setNowMs, setPendingAction, setScore, setScoreError, setScorePendingSide, setSelectedControllerId, setShotClockSeconds, setSnapshot, setVolume, setWakeLockActive, setWakeLockRequested, shotClockEnabled, shotClockSeconds, showAttendanceQr, snapshot, soundedRef, testBuzzer, tied, toggleWakeLock, volume, wakeLockActive, wakeLockRef, wakeLockRequested, wakeLockRequestedRef } = context;
  if (!liveClock) {
    return (
      <section className="ui-match-clock-panel ui-panel" aria-label="경기시계">
        <strong>경기시계 불러오는 중</strong>
        {error ? <p className="ui-match-clock-error" role="alert">{error}</p> : null}
      </section>
    );
  }
  const expectedPeriodCount = Number(liveClock.expectedPeriodCount || 1);
  const singlePeriod = expectedPeriodCount === 1;
  const periodEndLabel = singlePeriod
    ? "정규 구간 종료"
    : expectedPeriodCount === 2
      ? "하프 종료"
      : "쿼터 종료";
  const nextPeriodLabel = expectedPeriodCount === 2 ? "후반 시작" : "다음 쿼터 시작";

  const clockPanel = (
    <section
      className={`ui-match-clock-panel ui-panel${focusMode ? " ui-match-clock-panel-focus" : ""}${isPending ? " ui-match-clock-panel-pending" : ""}`}
      aria-label="경기시계"
      onPointerDown={enableMediaControl}
    >
      <header className="ui-match-clock-header">
        <div>
          <span className="ui-match-clock-eyebrow">GAME CLOCK</span>
          <h3>경기시계</h3>
        </div>
        <div className="ui-match-clock-header-tools">
          <div className="ui-match-clock-badges">
            <Badge tone={isRunning ? "green" : isEnded ? "neutral" : "gold"}>
              {isRunning ? "진행 중" : isEnded ? "시계 종료" : isPending ? "시작 대기" : isBreak ? "휴식" : "일시정지"}
            </Badge>
            <Badge tone={isEnded && recognition.recognized ? "green" : "neutral"}>
              {isEnded
                ? recognition.recognized ? "정상 사용" : "미사용 처리"
                : `인정 기준 진행 ${Math.round(recognition.ratio * 100)}%`}
            </Badge>
          </div>
          {focusMode ? (
            <Button type="button" size="sm" variant="primary" onClick={() => void closeFocusMode()}>
              <Minimize2 size={16} /> 닫기
            </Button>
          ) : null}
        </div>
      </header>

      {isPending ? (
        <div className="ui-match-clock-setup">
          <div className="ui-match-clock-deadline">
            <strong>{deadlineRemainingMs > 0 ? `${formatClockTime(deadlineRemainingMs)} 안에 시계 시작` : "시계 시작 인정 시간 경과"}</strong>
            <span>경기는 계속 진행됩니다. 시계 미사용 여부는 최종 MMR 반영 전에 서버에서 검증합니다.</span>
          </div>
          {liveClock.canManage ? (
            <>
              <label className="ui-match-clock-field">
                <span>최초 시계 담당</span>
                <select
                  className="ui-control"
                  value={selectedControllerId}
                  disabled={Boolean(pendingAction)}
                  onChange={(event) => selectController(event.target.value)}
                >
                  {activePlayers.map((player) => (
                    <option key={player.id} value={player.id}>{getClockControllerLabel(player)}</option>
                  ))}
                </select>
              </label>
              <fieldset className="ui-match-clock-fieldset">
                <legend>샷클락</legend>
                <div className="ui-match-clock-option-grid">
                  {SHOT_CLOCK_OPTIONS.map((option) => (
                    <Button
                      key={option.value}
                      type="button"
                      size="sm"
                      variant={shotClockSeconds === option.value ? "primary" : "secondary"}
                      aria-pressed={shotClockSeconds === option.value}
                      disabled={Boolean(pendingAction) || !selectedControllerId}
                      onClick={() => selectShotClock(option.value)}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              </fieldset>
            </>
          ) : null}
          <div className="ui-match-clock-controller-status">
            <span>시계 담당</span>
            <strong>{controller?.name || "출전 선수 지정 대기"}</strong>
          </div>
          {liveClock.canControl ? (
            <Button
              type="button"
              size="sm"
              disabled={Boolean(pendingAction)}
              onClick={() => confirmAction("실제 경기시계를 시작할까요?", "start")}
            >
              <Play size={18} /> 경기시계 시작
            </Button>
          ) : (
            <p className="ui-match-clock-readonly">지정된 경기시계 화면에서 시작합니다.</p>
          )}
        </div>
      ) : (
        <div className={`ui-match-clock-live${shotClockEnabled ? " ui-match-clock-live-with-shot" : ""}`}>
          <div className={`ui-match-clock-display-grid${shotClockEnabled ? "" : " ui-match-clock-display-grid-single"}${showAttendanceQr ? " ui-match-clock-display-grid-with-attendance" : ""}`}>
            {showAttendanceQr ? (
              <div className="ui-match-clock-attendance-qr">
                <QrCode value={attendanceQr.value} label="지각 출석 QR 코드" expandable />
                <span>지각 출석</span>
              </div>
            ) : null}
            <div
              className={`ui-match-clock-scoreboard${scoreboardEnabled ? "" : " ui-match-clock-scoreboard-time-only"}`}
              aria-label={scoreboardEnabled ? "기록 점수판" : "경기시간"}
            >
              {scoreboardEnabled ? (
                <span className="ui-match-clock-scoreboard-label">점수판</span>
              ) : null}
              {scoreboardEnabled ? (
                <div className="ui-match-clock-team ui-match-clock-team-a">
                  <span className="ui-match-clock-team-label">A 점수</span>
                  <strong className="ui-match-clock-team-score">{score.a}</strong>
                </div>
              ) : null}
              <div className="ui-match-clock-main-time">
                <span className="ui-match-clock-main-time-label">경기시계</span>
                <strong className="ui-match-clock-period">{periodDisplayLabel}</strong>
                <time>{formatClockTime(liveClock.periodRemainingMs, { tenths: true })}</time>
                <small>{scoreboardEnabled ? "서버시간 · 점수 3초 자동 갱신" : "서버시간 기준"}</small>
              </div>
              {scoreboardEnabled ? (
                <div className="ui-match-clock-team ui-match-clock-team-b">
                  <span className="ui-match-clock-team-label">B 점수</span>
                  <strong className="ui-match-clock-team-score">{score.b}</strong>
                </div>
              ) : null}
            </div>

            {shotClockEnabled ? (
              <button
                type="button"
                className="ui-match-shot-clock"
                disabled={!canResetShotClock}
                onClick={() => void runAction("resetShot")}
                aria-label={`샷클락 ${formatClockTime(liveClock.shotRemainingMs)}. 눌러서 ${liveClock.shotClockSeconds}초로 초기화`}
              >
                <span className="ui-match-shot-clock-label">샷클락</span>
                <strong className="ui-match-shot-clock-value">{Math.ceil(liveClock.shotRemainingMs / 1000)}</strong>
                <span className="ui-match-shot-clock-action">
                  <RotateCcw size={15} aria-hidden="true" />
                  {canResetShotClock
                    ? `${liveClock.shotClockSeconds}초로 초기화`
                    : liveClock.canControl
                      ? isBreak ? "휴식 중" : "사용 종료"
                      : "읽기 전용"}
                </span>
              </button>
            ) : null}
          </div>

          {directScoreControlsEnabled && !isEnded && clockEditableScoreSides.length ? (
            <div className="ui-match-clock-score-controls" aria-label="점수 조정">
              {[
                clockEditableScoreSides.includes("teamA")
                  ? { side: "teamA", label: "A", value: score.a }
                  : null,
                clockEditableScoreSides.includes("teamB")
                  ? { side: "teamB", label: "B", value: score.b }
                  : null,
              ].filter(Boolean).map(({ side, label, value }) => (
                <div key={side} className={`ui-match-clock-score-control-side ui-match-clock-score-control-side-${label.toLowerCase()}`}>
                  <strong>{label} 점수 {value}</strong>
                  <div className="ui-match-clock-score-actions" aria-label={`${label} 점수 조정`}>
                    {[-1, 1, 2, 3].map((delta) => (
                      <Button key={delta} type="button" size="sm" variant="secondary" disabled={Boolean(scorePendingSide)} onClick={() => void incrementScore(side, delta)}>
                        {delta > 0 ? `+${delta}` : delta}
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {isBreak ? (
            <div className={`ui-match-clock-break${breakOvertimeMs > 0 ? " ui-match-clock-break-over" : ""}`} role="timer">
              <span>{regulationEnded ? "정규 구간 종료" : isHalftimeBreak ? "하프타임" : "쿼터 휴식"}</span>
              {regulationEnded ? (
                <>
                  <strong>연장 또는 시계 종료 선택</strong>
                  <small>{singlePeriod ? "단일 경기에는 다음 쿼터가 없습니다." : "설정한 정규 구간을 모두 마쳤습니다."}</small>
                </>
              ) : (
                <>
                  <strong>
                    {breakOvertimeMs > 0
                      ? `${formatClockTime(breakOvertimeMs)} 초과`
                      : `${formatClockTime(breakRemainingMs)} 남음`}
                  </strong>
                  <small>권장 휴식 {breakLimitMinutes}분 · 다음 구간 시작은 언제든 가능</small>
                </>
              )}
            </div>
          ) : null}

          {!isEnded && liveClock.canControl ? (
            <div className="ui-match-clock-actions ui-action-row">
              {isRunning && hasRemainingPeriodTime ? (
                <Button type="button" size="sm" variant="secondary" onClick={() => void runAction("pause")}>
                  <Pause size={18} /> 일시정지
                </Button>
              ) : !isBreak && hasRemainingPeriodTime ? (
                <Button type="button" size="sm" onClick={() => void runAction("resume")}>
                  <Play size={18} /> 계속
                </Button>
              ) : null}
              {!isBreak ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => confirmAction(`${getMatchClockPeriodLabel(liveClock)}를 종료할까요?`, "endPeriod")}
                >
                  {periodEndLabel}
                </Button>
              ) : null}
              {isBreak && !regulationEnded && liveClock.overtimeCount === 0 ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => confirmAction(`${nextPeriodLabel}할까요?`, "startPeriod")}
                >
                  {nextPeriodLabel}
                </Button>
              ) : null}
              {isBreak && regulationEnded && (!scoreboardEnabled || tied) ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => confirmAction(`연장 ${liveClock.overtimeCount + 1}을 시작할까요?`, "startOvertime")}
                >
                  연장 {liveClock.overtimeCount + 1} 시작
                </Button>
              ) : null}
              {!match.refereeId ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => confirmAction("경기시계 운용을 종료할까요?", "endClock")}
                >
                  시계 종료 · 인정 판정
                </Button>
              ) : null}
            </div>
          ) : null}

          {!liveClock.canControl && !isEnded ? (
            <p className="ui-match-clock-readonly">{controller?.name || "지정 담당자"}님이 시계를 조작 중입니다.</p>
          ) : null}

          {!isEnded && (liveClock.canControl || liveClock.canManage) ? (
            <details className="ui-match-clock-transfer">
              <summary>시계 담당자 변경</summary>
              <div className="ui-match-clock-player-grid">
                {activePlayers.filter((player) => player.id !== liveClock.controllerId).map((player) => (
                  <Button
                    key={player.id}
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => confirmAction(`${getClockControllerLabel(player)}에게 시계를 넘길까요? 넘긴 뒤 현재 기기에서는 조작할 수 없습니다.`, "transfer", { controllerId: player.id })}
                  >
                    {getClockControllerLabel(player)}
                  </Button>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      )}

      {canEndMatch && onEndMatch && !match.endedAt ? (
        <div className="ui-match-clock-match-actions ui-action-row">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={Boolean(pendingAction)}
            onClick={() => void requestMatchEnd()}
          >
            경기·시계 종료
          </Button>
        </div>
      ) : null}

      <div className="ui-match-clock-device-tools">
        <Button
          type="button"
          size="sm"
          variant="primary"
          aria-pressed={focusMode}
          onClick={() => void (focusMode ? closeFocusMode() : openFocusMode())}
        >
          {focusMode ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          {focusMode ? "전체화면 닫기" : "시계 전체화면"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="primary"
          aria-pressed={wakeLockRequested}
          onClick={() => void toggleWakeLock()}
        >
          <Power size={16} />
          {wakeLockActive ? "화면 유지 켜짐" : wakeLockRequested ? "화면 유지 재연결" : "화면 유지 켜기"}
        </Button>
        <Button type="button" size="sm" variant="primary" onClick={() => void testBuzzer()}>
          <BellRing size={16} /> 부저 시험
        </Button>
        <label className="ui-match-clock-volume">
          {volume > 0 ? <Volume2 size={17} /> : <VolumeX size={17} />}
          <span className="ui-match-clock-volume-label">부저 {volume}%</span>
          <input
            type="range"
            min="0"
            max="100"
            step="10"
            value={volume}
            style={{ "--match-clock-volume-progress": `${volume}%` }}
            onChange={(event) => setVolume(Number(event.target.value))}
          />
        </label>
      </div>
      {deviceNotice ? <p className="ui-match-clock-device-notice" role="status">{deviceNotice}</p> : null}
      {scoreError ? <p className="ui-match-clock-error" role="alert">{scoreError}</p> : null}

      {isEnded ? (
        <div className="ui-match-clock-result ui-status-strip">
          <strong>{recognition.recognized ? "경기시계 정상 사용" : "경기시계 미사용 처리"}</strong>
          <span>
            실제 운용 {formatClockTime(liveClock.activeElapsedMs)} · 기준 {formatClockTime(liveClock.minimumActiveMs)}
          </span>
        </div>
      ) : null}
      {error ? <p className="ui-match-clock-error" role="alert">{error}</p> : null}
    </section>
  );

  if (focusMode) {
    return createPortal(
      <div className="ui-match-clock-focus-backdrop" role="dialog" aria-modal="true" aria-label="전체화면 경기시계">
        {clockPanel}
      </div>,
      document.body,
    );
  }

  return clockPanel;
}
