import { useEffect, useRef, useState } from "react";
import { Download, RotateCcw } from "lucide-react";
import Button from "../common/Button.jsx";
import { getPromotionShareText } from "../../lib/sharing.js";
import { createSharePoster } from "../../lib/sharePoster.js";

export default function ShareImagePanel({ content }) {
  const previewRef = useRef(null);
  const [image, setImage] = useState(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const promotion = JSON.parse(content);
  const readyImage = image?.content === content ? image : null;

  useEffect(() => {
    let active = true;
    let imageUrl;
    setFailed(false);
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
      imageUrl = URL.createObjectURL(blob);
      setImage({ content, url: imageUrl });
    }).catch(() => {
      if (active) setFailed(true);
    });
    return () => {
      active = false;
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [content, attempt]);

  return (
    <div ref={previewRef} className="ui-share-preview">
      <div className="ui-share-preview-copy">
        <strong>이미지 한 장으로 공유하세요</strong>
        <p>저장한 이미지를 단체 채팅방이나 SNS에 올리세요. QR을 찍으면 상세 화면이 열려요.</p>
        {readyImage ? (
          <Button touchFriendly as="a" size="sm" href={readyImage.url} download="boxtier-share.png">
            <Download size={16} /> 이미지 저장
          </Button>
        ) : (
          <p className="ui-share-feedback" role="status">{failed ? "이미지를 만들지 못했어요. 문구와 링크는 공유할 수 있어요." : "공유 이미지를 준비하고 있어요."}</p>
        )}
        {failed ? <Button touchFriendly size="sm" variant="secondary" onClick={() => setAttempt((value) => value + 1)}><RotateCcw size={16} /> 다시 만들기</Button> : null}
      </div>
      {readyImage ? <img className="ui-share-preview-image" src={readyImage.url} width={1080} height={1350} alt={getPromotionShareText(promotion)} /> : null}
    </div>
  );
}
