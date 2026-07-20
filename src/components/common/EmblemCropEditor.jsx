import { useEffect, useRef, useState } from "react";
import useBodyScrollLock from "../../hooks/useBodyScrollLock.js";
import { drawEmblemCrop } from "../../lib/teamEmblem.js";
import Button from "./Button.jsx";

const DEFAULT_CROP = { zoom: 1, x: 50, y: 50 };

export default function EmblemCropEditor({ file, pending = false, warning = "", onCancel, onConfirm }) {
  const canvasRef = useRef(null);
  const [image, setImage] = useState(null);
  const [crop, setCrop] = useState(DEFAULT_CROP);
  const [loadFailed, setLoadFailed] = useState(false);
  useBodyScrollLock(Boolean(file));

  useEffect(() => {
    if (!file) return undefined;
    const objectUrl = URL.createObjectURL(file);
    const nextImage = new Image();
    setCrop(DEFAULT_CROP);
    setImage(null);
    setLoadFailed(false);
    nextImage.onload = () => setImage(nextImage);
    nextImage.onerror = () => setLoadFailed(true);
    nextImage.src = objectUrl;
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  useEffect(() => {
    if (!image || !canvasRef.current) return;
    drawEmblemCrop(canvasRef.current, image, image.naturalWidth, image.naturalHeight, crop, 320);
  }, [crop, image]);

  if (!file) return null;

  return (
    <div className="app-confirm-backdrop emblem-crop-backdrop" role="presentation" onMouseDown={() => !pending && onCancel?.()}>
      <section className="app-confirm-dialog emblem-crop-dialog" role="dialog" aria-modal="true" aria-label="엠블럼 이미지 편집" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <strong>엠블럼 영역 선택</strong>
          <p>미리보기를 보면서 위치와 크기를 조정하세요.</p>
        </header>
        <div className="emblem-crop-preview">
          {loadFailed ? <span>이미지를 읽지 못했습니다.</span> : <canvas ref={canvasRef} aria-label="엠블럼 크롭 미리보기" />}
        </div>
        <div className="emblem-crop-controls">
          <label>
            확대·축소
            <input type="range" min="0.5" max="3" step="0.05" value={crop.zoom} onChange={(event) => setCrop((current) => ({ ...current, zoom: Number(event.target.value) }))} />
          </label>
          <label>
            가로 위치
            <input type="range" min="0" max="100" step="1" value={crop.x} onChange={(event) => setCrop((current) => ({ ...current, x: Number(event.target.value) }))} />
          </label>
          <label>
            세로 위치
            <input type="range" min="0" max="100" step="1" value={crop.y} onChange={(event) => setCrop((current) => ({ ...current, y: Number(event.target.value) }))} />
          </label>
        </div>
        {warning ? <p className="form-warning">{warning}</p> : null}
        <div className="app-confirm-actions">
          <Button type="button" variant="secondary" disabled={pending} onClick={onCancel}>취소</Button>
          <Button type="button" disabled={pending || !image || loadFailed} onClick={() => onConfirm?.(crop)}>
            {pending ? "저장 중" : "경고 확인 후 저장"}
          </Button>
        </div>
      </section>
    </div>
  );
}
