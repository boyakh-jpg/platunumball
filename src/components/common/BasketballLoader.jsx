import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const ballSources = [
  "https://pub-ace5b2a3eb5a41dfba7488c3de616118.r2.dev/assets/bounding_ball2.gif",
];

export default function BasketballLoader({ label = "불러오는 중", overlay = false, className = "" }) {
  const [imageFailed, setImageFailed] = useState(false);
  const [imageIndex, setImageIndex] = useState(0);

  useEffect(() => {
    setImageFailed(false);
    setImageIndex(0);
  }, [label, overlay]);

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
      <span className="basketball-loader-text">{label}</span>
    </div>
  );

  if (overlay) {
    const overlayNode = (
      <div
        className={`basketball-loader-overlay ${className}`.trim()}
        role="status"
        aria-live="polite"
        aria-label={label}
        onTouchMove={(event) => event.preventDefault()}
        onWheel={(event) => event.preventDefault()}
      >
        {content}
      </div>
    );
    return typeof document === "undefined" ? overlayNode : createPortal(overlayNode, document.body);
  }

  return (
    <div className={`basketball-loader-inline ${className}`.trim()} role="status" aria-live="polite" aria-label={label}>
      {content}
    </div>
  );
}
