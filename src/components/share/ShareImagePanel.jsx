import { useEffect, useRef, useState } from "react";
import { Download, Image, RotateCcw, Share2 } from "lucide-react";
import Button from "../common/Button.jsx";
import { canShareImageFile, getPromotionShareText, shareImageFile } from "../../lib/sharing.js";
import { createSharePoster } from "../../lib/sharePoster.js";

export default function ShareImagePanel({ content }) {
  const previewRef = useRef(null);
  const activeImageRef = useRef(null);
  const pendingRef = useRef(false);
  const [image, setImage] = useState(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("");
  const promotion = JSON.parse(content);
  const readyImage = image?.content === content ? image : null;
  const canSendImage = readyImage?.canShare === true;

  useEffect(() => {
    let active = true;
    let imageUrl;
    setImage(null);
    setFailed(false);
    setPending(false);
    setStatus("");
    const style = getComputedStyle(previewRef.current);
    createSharePoster(JSON.parse(content), {
      background: style.getPropertyValue("--bg").trim(),
      surface: style.getPropertyValue("--surface").trim(),
      text: style.getPropertyValue("--text").trim(),
      muted: style.getPropertyValue("--muted").trim(),
      accent: style.getPropertyValue("--accent-text").trim(),
      font: style.getPropertyValue("--font-body").trim(),
      titleWeight: style.getPropertyValue("--font-weight-title").trim(),
      bodyWeight: style.getPropertyValue("--font-weight-body").trim(),
    }).then((blob) => {
      if (!active) return;
      const file = new File([blob], "boxtier-share.png", { type: "image/png" });
      imageUrl = URL.createObjectURL(blob);
      const nextImage = { content, url: imageUrl, file, canShare: canShareImageFile(navigator, file) };
      activeImageRef.current = nextImage;
      setImage(nextImage);
    }).catch(() => {
      if (active) setFailed(true);
    });
    return () => {
      active = false;
      activeImageRef.current = null;
      pendingRef.current = false;
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [content, attempt]);

  async function sendImage() {
    if (!readyImage || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setStatus("");
    // The PNG is prepared before the click so the native share keeps user activation.
    const result = await shareImageFile(readyImage.file, { title: promotion.title });
    if (activeImageRef.current !== readyImage) return;
    pendingRef.current = false;
    setPending(false);
    setStatus(result === "shared" ? "이미지 공유창을 열었어요." : result === "failed" ? "이미지를 보내지 못했어요. 이미지 저장을 이용해 주세요." : "");
  }

  return (
    <div ref={previewRef} className="ui-share-preview">
      <div className="ui-share-preview-media" aria-busy={!readyImage && !failed}>
        {readyImage ? <img className="ui-share-preview-image" src={readyImage.url} width={1080} height={1350} alt={getPromotionShareText(promotion)} /> : <Image size={32} aria-hidden="true" />}
      </div>
      <div className="ui-share-preview-copy">
        <strong className="ui-share-preview-title">이미지로 공유하기</strong>
        <p>{canSendImage ? "원하는 앱을 골라 바로 보내세요." : "이미지를 저장해 단체 채팅방이나 SNS에 올려보세요."}</p>
        {readyImage ? (
          <div className="ui-action-row">
            {canSendImage ? <Button touchFriendly size="sm" onClick={sendImage} disabled={pending} aria-busy={pending}><Share2 size={16} /> 이미지 보내기</Button> : null}
            <Button touchFriendly as="a" size="sm" variant={canSendImage ? "secondary" : "primary"} href={readyImage.url} download={readyImage.file.name}>
              <Download size={16} /> 이미지 저장
            </Button>
          </div>
        ) : (
          <p className="ui-share-feedback" role="status">{failed ? "이미지를 만들지 못했어요. 문구와 링크는 공유할 수 있어요." : "공유 이미지를 준비하고 있어요."}</p>
        )}
        {failed ? <Button touchFriendly size="sm" variant="secondary" onClick={() => setAttempt((value) => value + 1)}><RotateCcw size={16} /> 다시 만들기</Button> : null}
        <p className="ui-share-preview-caption">QR을 찍으면 상세 화면으로 연결돼요.</p>
        <p className="ui-share-feedback" role="status">{status}</p>
      </div>
    </div>
  );
}
