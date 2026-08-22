import { useEffect, useRef, useState } from "react";
import { renderMatchReceiptPreviewCanvas } from "../../lib/matchReceipt.js";

export default function ThermalReceiptPreview({ draft, photoBlob, matchUrl, publicId, teamLineArtUrls, photoGestureHandlers = null, suspendRender = false }) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [aspectRatio, setAspectRatio] = useState("9 / 16");
  const canvasRef = useRef(null);
  const generationRef = useRef(0);
  const isEnglish = draft.receiptLocale === "en";

  useEffect(() => {
    if (suspendRender) return undefined;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const frame = window.requestAnimationFrame(() => {
      setFailed(false);
      renderMatchReceiptPreviewCanvas(draft, "story", {
        photoBlob,
        matchUrl,
        publicId,
        teamLineArtUrls,
        showPersonalTierIdentity: false,
      }).then((renderedCanvas) => {
        if (generationRef.current !== generation || !canvasRef.current) return;
        const target = canvasRef.current;
        target.width = renderedCanvas.width;
        target.height = renderedCanvas.height;
        target.getContext("2d").drawImage(renderedCanvas, 0, 0);
        setAspectRatio(`${renderedCanvas.width} / ${renderedCanvas.height}`);
        setReady(true);
      }).catch(() => {
        if (generationRef.current === generation) setFailed(true);
      });
    });

    return () => {
      generationRef.current += 1;
      window.cancelAnimationFrame(frame);
    };
  }, [draft, matchUrl, photoBlob, publicId, teamLineArtUrls, suspendRender]);

  return (
    <div className="match-receipt-thermal-preview-frame" style={{ "--thermal-receipt-preview-aspect": aspectRatio }} aria-busy={!ready && !failed}>
      <canvas
        ref={canvasRef}
        className="match-receipt-thermal-preview"
        width="1080"
        height="1920"
        role="img"
        aria-label={isEnglish ? "CLASSIC THERMAL receipt preview" : "CLASSIC THERMAL 영수증 미리보기"}
      />
      {!ready || failed ? (
        <p className="match-receipt-thermal-preview-status">
          {failed ? (isEnglish ? "Could not render the preview." : "미리보기를 만들지 못했습니다.") : "THERMAL PREVIEW"}
        </p>
      ) : null}
      {draft.includePhoto && photoBlob && photoGestureHandlers ? (
        <div
          className="match-receipt-thermal-photo-hitarea"
          role="img"
          aria-label={isEnglish ? "Adjust game or team photo" : "경기·팀 사진 위치 조정"}
          {...photoGestureHandlers}
        />
      ) : null}
    </div>
  );
}
