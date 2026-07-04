import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { assetUrl } from "../../lib/assets.js";

const ballSources = [
  assetUrl("/assets/bounding_ball2.gif"),
];

const randomLoaderLabels = [
  "경기 기록이 바람에 날아가 주워오는 중",
  "뛰다 넘어져 천천히 돌아오는 중",
  "공이 멀리 날아가 주워오는 중",
  "숨이 차서 잠깐 걸어오는 중",
  "기록지가 살짝 접혀 펴는 중",
  "작전판에서 빈칸을 채우는 중",
  "수비 사이로 결과를 꺼내오는 중",
  "림 맞고 튄 정보를 다시 잡는 중",
  "기록지가 땀에 젖어 해독하는 중",
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
