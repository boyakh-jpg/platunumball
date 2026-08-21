import { useEffect, useState } from "react";
import { renderMatchReceiptPng } from "../../lib/matchReceipt.js";

export default function ThermalReceiptPreview({ draft, photoBlob, matchUrl, publicId, teamLineArtUrls }) {
  const [previewUrl, setPreviewUrl] = useState("");
  const [failed, setFailed] = useState(false);
  const isEnglish = draft.receiptLocale === "en";

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    const timer = window.setTimeout(() => {
      setFailed(false);
      renderMatchReceiptPng(draft, "story", {
        photoBlob,
        matchUrl,
        publicId,
        teamLineArtUrls,
        showPersonalTierIdentity: false,
      }).then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
      }).catch(() => {
        if (active) setFailed(true);
      });
    }, 120);

    return () => {
      active = false;
      window.clearTimeout(timer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [draft, matchUrl, photoBlob, publicId, teamLineArtUrls]);

  if (failed) return <p className="match-receipt-thermal-preview-status">{isEnglish ? "Could not render the preview." : "미리보기를 만들지 못했습니다."}</p>;
  if (!previewUrl) return <p className="match-receipt-thermal-preview-status">THERMAL PREVIEW</p>;
  return <img className="match-receipt-thermal-preview" src={previewUrl} alt={isEnglish ? "CLASSIC THERMAL receipt preview" : "CLASSIC THERMAL 영수증 미리보기"} />;
}
