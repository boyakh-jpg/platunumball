import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { assetUrl } from "../../lib/assets.js";

const ballSources = [
  assetUrl("/assets/bounding_ball2.gif"),
];

const randomLoaderLabels = [
  "뛰다가 넘어졌다가 일어나는 중",
  "공 잡으려다 한 바퀴 도는 중",
  "슛 던지고 안 들어간 척하는 중",
  "패스 받고 깜짝 놀라는 중",
  "림이랑 눈싸움하는 중",
  "농구화 끈 다시 묶는 중",
  "공 따라 데굴데굴 가는 중",
  "자유투 전에 숨 고르는 중",
  "수비하다 살짝 미끄러진 중",
  "벤치에서 벌떡 일어나는 중",
];

function pickRandomLoaderLabel() {
  return randomLoaderLabels[Math.floor(Math.random() * randomLoaderLabels.length)] ?? randomLoaderLabels[0];
}

export default function BasketballLoader({ label = "불러오는 중", overlay = false, className = "", randomLabel = false }) {
  const [imageFailed, setImageFailed] = useState(false);
  const [imageIndex, setImageIndex] = useState(0);
  const [displayLabel, setDisplayLabel] = useState(() => (randomLabel ? pickRandomLoaderLabel() : label));

  useEffect(() => {
    setImageFailed(false);
    setImageIndex(0);
    setDisplayLabel(randomLabel ? pickRandomLoaderLabel() : label);
  }, [label, overlay, randomLabel]);

  const content = (
    <div className="basketball-loader">
      <span className="basketball-loader-visual" aria-hidden="true">
        {imageFailed ? null : (
          <img
            className="basketball-loader-gif"
            src={ballSources[imageIndex]}
            width="50"
            height="50"
            alt=""
            decoding="async"
            loading="eager"
            onError={() => {
              setImageIndex((currentIndex) => {
                const nextIndex = currentIndex + 1;
                if (nextIndex < ballSources.length) return nextIndex;
                setImageFailed(true);
                return currentIndex;
              });
            }}
          />
        )}
      </span>
      <span className="basketball-loader-text">{displayLabel}</span>
    </div>
  );

  if (overlay) {
    const overlayNode = (
      <div
        className={`basketball-loader-overlay ${className}`.trim()}
        role="status"
        aria-live="polite"
        aria-label={displayLabel}
        onTouchMove={(event) => event.preventDefault()}
        onWheel={(event) => event.preventDefault()}
      >
        {content}
      </div>
    );
    return typeof document === "undefined" ? overlayNode : createPortal(overlayNode, document.body);
  }

  return (
    <div className={`basketball-loader-inline ${className}`.trim()} role="status" aria-live="polite" aria-label={displayLabel}>
      {content}
    </div>
  );
}
