import { useEffect, useRef, useState } from "react";

const DEMO_PHASES = [
  { phase: "경기 전", detail: "출석 확인" },
  { phase: "경기 중", detail: "점수 · 개인 기록" },
  { phase: "경기 후", detail: "전적 · 티어 · 영수증" },
];

function getPrefersReducedMotion() {
  return typeof window !== "undefined"
    && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export default function LandingDemoFrame({ videoSrc = "", posterSrc = "" }) {
  const videoRef = useRef(null);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(getPrefersReducedMotion);

  useEffect(() => {
    const mediaQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mediaQuery) return undefined;

    const handleChange = (event) => setPrefersReducedMotion(event.matches);
    mediaQuery.addEventListener?.("change", handleChange);
    return () => mediaQuery.removeEventListener?.("change", handleChange);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoSrc) return;

    if (prefersReducedMotion) {
      video.pause();
      video.currentTime = 0;
      return;
    }

    video.play()?.catch(() => {});
  }, [prefersReducedMotion, videoSrc]);

  const showPosterState = !videoSrc || (prefersReducedMotion && !posterSrc);

  return (
    <figure className="guest-landing-demo-frame">
      <figcaption className="guest-landing-demo-caption">
        <span>제품 데모</span>
        <strong>{videoSrc ? "실제 경기 기록 화면" : "영상 준비 중"}</strong>
      </figcaption>

      <div className="guest-landing-demo-viewport">
        {showPosterState ? (
          <div
            className="guest-landing-demo-poster"
            role="img"
            aria-label="제품 데모 영상 포스터: 경기 전, 경기 중, 경기 후 기록 흐름"
          >
            <p>한 경기의 기록 흐름</p>
            <ol className="guest-landing-demo-poster-flow">
              {DEMO_PHASES.map((item, index) => (
                <li key={item.phase}>
                  <span>{item.phase}</span>
                  <strong>{item.detail}</strong>
                  {index < DEMO_PHASES.length - 1 ? <span aria-hidden="true">→</span> : null}
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <video
            ref={videoRef}
            className="guest-landing-demo-video"
            autoPlay={!prefersReducedMotion}
            muted
            playsInline
            loop={!prefersReducedMotion}
            preload="metadata"
            poster={posterSrc || undefined}
            aria-label="BoxTier 경기 기록 제품 데모"
          >
            <source src={videoSrc} type="video/mp4" />
          </video>
        )}
      </div>

      <p className="guest-landing-demo-note">
        {videoSrc
          ? "출석부터 결과 확정까지 실제 제품 흐름을 확인할 수 있습니다."
          : "최종 제품 데모 영상은 이 프레임에 연결됩니다."}
      </p>
    </figure>
  );
}
