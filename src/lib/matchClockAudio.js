const ERROR_LABELS = Object.freeze({
  invalid_shot_clock_seconds: "샷클락은 사용 안 함, 24초, 30초, 1분 중에서 선택해 주세요.",
  match_clock_configure_forbidden: "경기시계 시작 전 방장 또는 배정 심판만 담당자와 샷클락을 변경할 수 있습니다.",
  match_clock_forbidden: "이 경기의 시계를 볼 권한이 없습니다.",
  match_clock_controller_must_be_active: "현재 출전·후보 선수 또는 심판만 시계를 받을 수 있습니다.",
  match_clock_start_forbidden: "지정된 시계 담당 선수만 시작할 수 있습니다.",
  match_clock_resume_forbidden: "남은 경기시간이 없습니다. 쿼터 종료를 눌러주세요.",
  match_clock_transfer_forbidden: "시계 담당자 또는 경기 관리자만 넘길 수 있습니다.",
  match_clock_overtime_requires_tie: "동점일 때만 연장을 시작할 수 있습니다.",
  match_clock_disabled: "이 경기는 BOXTIER 모바일 전광판을 사용하지 않습니다.",
  server_actions_disabled: "서버 기능이 꺼져 있어 경기시계를 사용할 수 없습니다.",
});

const BUZZER_PATTERNS = Object.freeze({
  control: Object.freeze([
    { durationMs: 1000, frequency: 20, gain: 0.0001 },
  ]),
  shot: Object.freeze([
    { durationMs: 260, frequency: 980 },
  ]),
  period: Object.freeze([
    { durationMs: 1500, frequency: 780 },
  ]),
  warning: Object.freeze([
    { durationMs: 170, frequency: 900 },
    { durationMs: 130, frequency: 0 },
    { durationMs: 170, frequency: 900 },
  ]),
});

let matchClockControlMediaElement = null;
let buzzerAudioContext = null;
const buzzerMediaUrls = new Map();

export function getMatchClockErrorLabel(error) {
  const code = String(error?.code || error?.message || "");
  return ERROR_LABELS[code] || "경기시계 처리에 실패했습니다.";
}

function writeWavText(view, offset, value) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function getBuzzerMediaUrl(patternName) {
  if (buzzerMediaUrls.has(patternName)) return buzzerMediaUrls.get(patternName);
  const pattern = BUZZER_PATTERNS[patternName] || BUZZER_PATTERNS.period;
  const sampleRate = 22050;
  const totalSamples = pattern.reduce(
    (total, segment) => total + Math.round((segment.durationMs / 1000) * sampleRate),
    0,
  );
  const buffer = new ArrayBuffer(44 + totalSamples * 2);
  const view = new DataView(buffer);
  writeWavText(view, 0, "RIFF");
  view.setUint32(4, 36 + totalSamples * 2, true);
  writeWavText(view, 8, "WAVE");
  writeWavText(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeWavText(view, 36, "data");
  view.setUint32(40, totalSamples * 2, true);

  let sampleOffset = 0;
  pattern.forEach((segment) => {
    const segmentSamples = Math.round((segment.durationMs / 1000) * sampleRate);
    for (let index = 0; index < segmentSamples; index += 1) {
      const edgeFade = Math.min(1, index / 80, (segmentSamples - index - 1) / 160);
      const wave = segment.frequency > 0
        ? Math.sign(Math.sin((2 * Math.PI * segment.frequency * index) / sampleRate))
        : 0;
      view.setInt16(
        44 + sampleOffset * 2,
        Math.round(wave * edgeFade * 30000 * Number(segment.gain ?? 1)),
        true,
      );
      sampleOffset += 1;
    }
  });

  const url = URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
  buzzerMediaUrls.set(patternName, url);
  return url;
}

function getMatchClockControlMediaElement() {
  if (matchClockControlMediaElement) return matchClockControlMediaElement;
  matchClockControlMediaElement = new Audio();
  matchClockControlMediaElement.preload = "auto";
  matchClockControlMediaElement.loop = true;
  matchClockControlMediaElement.setAttribute("playsinline", "");
  matchClockControlMediaElement.setAttribute("webkit-playsinline", "");
  matchClockControlMediaElement.setAttribute("aria-hidden", "true");
  matchClockControlMediaElement.hidden = true;
  matchClockControlMediaElement.src = getBuzzerMediaUrl("control");
  document.body.appendChild(matchClockControlMediaElement);
  matchClockControlMediaElement.load();
  return matchClockControlMediaElement;
}

function setMatchClockMediaPlaybackState(state) {
  if (!("mediaSession" in navigator)) return;
  try {
    navigator.mediaSession.playbackState = state;
  } catch {
    // Unsupported media-session state must not block the game clock.
  }
}

export async function activateMatchClockMediaSession() {
  try {
    const mediaElement = getMatchClockControlMediaElement();
    if ("mediaSession" in navigator && "MediaMetadata" in window) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: "BOXTIER 모바일 전광판",
        artist: "재생·일시정지로 샷클락 초기화",
      });
    }
    if (mediaElement.paused) await mediaElement.play();
    setMatchClockMediaPlaybackState("playing");
    return true;
  } catch {
    setMatchClockMediaPlaybackState("none");
    return false;
  }
}

export function deactivateMatchClockMediaSession() {
  if (matchClockControlMediaElement) {
    matchClockControlMediaElement.pause();
    matchClockControlMediaElement.currentTime = 0;
  }
  setMatchClockMediaPlaybackState("none");
}

export async function playMatchClockBuzzer(patternName = "period", volume = 1) {
  if (volume <= 0) return false;
  try {
    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor) return false;
    buzzerAudioContext ??= new AudioContextConstructor();
    if (buzzerAudioContext.state === "suspended") await buzzerAudioContext.resume();
    const gainValue = Math.min(1, Math.max(0, volume)) * 0.35;
    let segmentStart = buzzerAudioContext.currentTime;
    (BUZZER_PATTERNS[patternName] || BUZZER_PATTERNS.period).forEach((segment) => {
      const segmentEnd = segmentStart + segment.durationMs / 1000;
      if (segment.frequency > 0) {
        const oscillator = buzzerAudioContext.createOscillator();
        const gain = buzzerAudioContext.createGain();
        oscillator.type = "square";
        oscillator.frequency.value = segment.frequency;
        gain.gain.setValueAtTime(0, segmentStart);
        gain.gain.linearRampToValueAtTime(gainValue, segmentStart + 0.005);
        gain.gain.setValueAtTime(gainValue, Math.max(segmentStart + 0.005, segmentEnd - 0.01));
        gain.gain.linearRampToValueAtTime(0, segmentEnd);
        oscillator.connect(gain).connect(buzzerAudioContext.destination);
        oscillator.start(segmentStart);
        oscillator.stop(segmentEnd);
      }
      segmentStart = segmentEnd;
    });
    return true;
  } catch {
    return false;
  }
}
