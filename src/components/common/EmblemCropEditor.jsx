import { useEffect, useRef, useState } from "react";
import useBodyScrollLock from "../../hooks/useBodyScrollLock.js";
import { drawEmblemCrop } from "../../lib/teamEmblem.js";
import Button from "./Button.jsx";
import ModalShell from "./ModalShell.jsx";

const DEFAULT_CROP = { zoom: 1, x: 50, y: 50 };
const DEFAULT_LABELS = Object.freeze({
  dialog: "엠블럼 이미지 편집",
  title: "엠블럼 영역 선택",
  description: "미리보기를 보면서 위치와 크기를 조정해 주세요.",
  convertedPreview: "변환된 선화 미리보기",
  loadFailed: "이미지를 읽지 못했습니다.",
  cropPreview: "엠블럼 크롭 미리보기",
  zoom: "확대·축소",
  horizontal: "가로 위치",
  vertical: "세로 위치",
  cancel: "취소",
  converting: "변환 중",
  convert: "선화로 변경",
  confirm: "확인",
});

function getRangeProgress(value, min, max) {
  return `${Math.max(0, Math.min(100, ((Number(value) - min) / (max - min)) * 100))}%`;
}

export default function EmblemCropEditor({
  file,
  pending = false,
  convertedPreview = "",
  warning = "",
  error = "",
  onCancel,
  onConvert,
  onConfirm,
  onCropChange,
  circular = false,
  labels,
}) {
  const copy = { ...DEFAULT_LABELS, ...labels };
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
    drawEmblemCrop(canvasRef.current, image, image.naturalWidth, image.naturalHeight, crop, 320, { circular });
  }, [circular, crop, image]);

  function updateCrop(name, value) {
    setCrop((current) => ({ ...current, [name]: Number(value) }));
    onCropChange?.();
  }

  if (!file) return null;

  return (
    <div className="app-confirm-backdrop emblem-crop-backdrop" role="presentation" onMouseDown={() => !pending && onCancel?.()}>
      <ModalShell className="app-confirm-dialog emblem-crop-dialog" role="dialog" aria-modal="true" aria-label={copy.dialog} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <strong>{copy.title}</strong>
          <p>{copy.description}</p>
        </header>
        <div className="emblem-crop-preview">
          {convertedPreview ? (
            <img src={convertedPreview} alt={copy.convertedPreview} />
          ) : loadFailed ? (
            <span>{copy.loadFailed}</span>
          ) : (
            <canvas ref={canvasRef} aria-label={copy.cropPreview} />
          )}
        </div>
        <div className="emblem-crop-controls">
          <label>
            {copy.zoom}
            <input type="range" min="0.5" max="3" step="0.05" value={crop.zoom} style={{ "--emblem-range-progress": getRangeProgress(crop.zoom, 0.5, 3) }} onChange={(event) => updateCrop("zoom", event.target.value)} />
          </label>
          <label>
            {copy.horizontal}
            <input type="range" min="0" max="100" step="1" value={crop.x} style={{ "--emblem-range-progress": getRangeProgress(crop.x, 0, 100) }} onChange={(event) => updateCrop("x", event.target.value)} />
          </label>
          <label>
            {copy.vertical}
            <input type="range" min="0" max="100" step="1" value={crop.y} style={{ "--emblem-range-progress": getRangeProgress(crop.y, 0, 100) }} onChange={(event) => updateCrop("y", event.target.value)} />
          </label>
        </div>
        {warning ? <p className="form-warning">{warning}</p> : null}
        {error ? <p className="emblem-crop-feedback" role="alert">{error}</p> : null}
        <div className="ui-action-row app-confirm-actions">
          <Button type="button" variant="secondary" disabled={pending} onClick={onCancel}>{copy.cancel}</Button>
          {onConvert ? (
            <Button type="button" variant="secondary" disabled={pending || !image || loadFailed} onClick={() => onConvert(crop)}>
              {pending ? copy.converting : copy.convert}
            </Button>
          ) : null}
          <Button type="button" disabled={pending || (Boolean(onConvert) && !convertedPreview)} onClick={() => onConfirm?.(crop)}>{copy.confirm}</Button>
        </div>
      </ModalShell>
    </div>
  );
}
