import { useEffect, useRef, useState } from "react";
import { renderMatchReceiptPng } from "../../lib/matchReceipt.js";

export default function ThermalReceiptPreview({ draft, photoBlob, matchUrl, publicId, teamLineArtUrls, photoGestureHandlers = null, suspendRender = false }) {
  const [previewUrl, setPreviewUrl] = useState("");
  const [failed, setFailed] = useState(false);
  const previewUrlRef = useRef("");
  const isEnglish = draft.receiptLocale === "en";

  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  useEffect(() => {
    if (suspendRender) return undefined;
    let active = true;
    const timer = window.setTimeout(() => {
      setFailed(false);
      renderMatchReceiptPng(draft, "story", {
        photoBlob,
        matchUrl,
        publicId,
        teamLineArtUrls,
        showPersonalTierIdentity: false,
      }).then((blob) => {
        const objectUrl = URL.createObjectURL(blob);
        if (!active) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = objectUrl;
        setPreviewUrl(objectUrl);
      }).catch(() => {
        if (active) setFailed(true);
      });
    }, 120);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [draft, matchUrl, photoBlob, publicId, teamLineArtUrls, suspendRender]);

  if (failed) return <p className="match-receipt-thermal-preview-status">{isEnglish ? "Could not render the preview." : "미리보기를 만들지 못했습니다."}</p>;
  if (!previewUrl) return <p className="match-receipt-thermal-preview-status">THERMAL PREVIEW</p>;
  return (
    <div className="match-receipt-thermal-preview-frame">
      <img className="match-receipt-thermal-preview" src={previewUrl} alt={isEnglish ? "CLASSIC THERMAL receipt preview" : "CLASSIC THERMAL 영수증 미리보기"} />
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
