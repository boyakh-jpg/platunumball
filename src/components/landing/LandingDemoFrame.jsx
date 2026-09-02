import { useEffect, useRef, useState } from "react";
import { assetUrl } from "../../lib/assets.js";

const DEFAULT_VIDEO_SOURCES = Object.freeze([
  { src: assetUrl("/assets/showcase/landing-product-demo.webm"), type: "video/webm" },
  { src: assetUrl("/assets/showcase/landing-product-demo.mp4"), type: "video/mp4" },
]);
const DEFAULT_POSTER_SRC = assetUrl("/assets/showcase/landing-product-demo-poster.webp");

const DEMO_PHASES = [
  { phase: "경기 전", detail: "출석 확인" },
  { phase: "경기 중", detail: "점수 · 개인 기록" },
  { phase: "경기 후", detail: "전적 · 티어 · 영수증" },
];

function getPrefersReducedMotion() {
  return typeof window !== "undefined"
    && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export default function LandingDemoFrame({
  videoSources = DEFAULT_VIDEO_SOURCES,
  posterSrc = DEFAULT_POSTER_SRC,
}) {
  const videoRef = useRef(null);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(getPrefersReducedMotion);
  const hasVideo = videoSources.length > 0;

  useEffect(() => {
    const mediaQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mediaQuery) return undefined;

    const handleChange = (event) => setPrefersReducedMotion(event.matches);
    mediaQuery.addEventListener?.("change", handleChange);
    return () => mediaQuery.removeEventListener?.("change", handleChange);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !hasVideo) return;

    if (prefersReducedMotion) {
      video.pause();
      video.currentTime = 0;
      return;
    }

    video.play()?.catch(() => {});
  }, [hasVideo, prefersReducedMotion]);

  const showPosterState = !hasVideo || (prefersReducedMotion && !posterSrc);

  return (
    <figure className="guest-landing-demo-frame">
      <div className="guest-landing-demo-viewport">
        {showPosterState ? (
          <div
            className="guest-landing-demo-poster"
            role="img"
            aria-label="제품 데모 영상 포스터: 경기 전, 경기 중, 경기 후 기록 흐름"
          >
            <p>한 경기의 기록 흐름</p>
            <ol className="guest-landing-demo-poster-flow">
              {DEMO_PHASES.map((item) => (
                <li key={item.phase}>
                  <span>{item.phase}</span>
                  <strong>{item.detail}</strong>
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
            {videoSources.map((source) => (
              <source key={source.src} src={source.src} type={source.type} />
            ))}
          </video>
        )}
      </div>
    </figure>
  );
}
