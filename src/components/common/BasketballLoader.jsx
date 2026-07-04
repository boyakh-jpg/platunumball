import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { assetUrl } from "../../lib/assets.js";

const ballSources = [
  assetUrl("/assets/bounding_ball2.gif"),
];

const randomLoaderLabels = [
  "공이 튀는 길을 따라가는 중",
  "패스가 돌아오는 길을 기다리는 중",
  "림 맞고 튄 정보를 다시 잡는 중",
  "작전판에서 빈칸을 채우는 중",
  "느린 패스를 끝까지 받아내는 중",
  "벤치까지 굴러간 공을 주워오는 중",
  "기록지가 살짝 접혀 펴는 중",
  "자유투처럼 한 박자 고르는 중",
  "수비 사이로 결과를 꺼내오는 중",
  "마지막 리바운드를 챙겨오는 중",
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
