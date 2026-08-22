import { createReceiptCanvas } from "./receiptCanvasRuntime.js";

export function getReceiptRotationCoverScale(rotation, aspect) {
  const radians = Math.abs(Number(rotation) || 0) * Math.PI / 180;
  const safeAspect = Math.max(0.01, Number(aspect) || 1);
  const cosine = Math.abs(Math.cos(radians));
  const sine = Math.abs(Math.sin(radians));
  return Math.max(cosine + sine / safeAspect, cosine + sine * safeAspect);
}

export function getReceiptPhotoTransform(value, aspect, options = {}) {
  const fallbackFocus = options.defaultPhotoFocus || { x: 0, y: 0 };
  const photoX = options.defaultPhoto ? fallbackFocus.x : Number(value.photoX) || 0;
  const photoY = options.defaultPhoto ? fallbackFocus.y : Number(value.photoY) || 0;
  const photoZoom = Math.max(1, Number(value.photoZoom) || 1);
  const photoRotation = Number(value.photoRotation) || 0;
  const panRange = Math.max(0, photoZoom - 1) / 2;
  return {
    photoX,
    photoY,
    photoZoom,
    photoRotation,
    positionX: (100 - photoX) / 200,
    positionY: (100 - photoY) / 200,
    shiftXRatio: panRange * photoX / 100,
    shiftYRatio: panRange * photoY / 100,
    scale: getReceiptRotationCoverScale(photoRotation, aspect) * photoZoom,
  };
}

export function getReceiptPhotoStyle(value, aspect, options = {}) {
  const transform = getReceiptPhotoTransform(value, aspect, options);
  return {
    "--receipt-photo-position-x": `${transform.positionX * 100}%`,
    "--receipt-photo-position-y": `${transform.positionY * 100}%`,
    "--receipt-photo-shift-x": `${transform.shiftXRatio * 100}%`,
    "--receipt-photo-shift-y": `${transform.shiftYRatio * 100}%`,
    "--receipt-photo-scale": transform.scale,
    "--receipt-photo-rotation": `${transform.photoRotation}deg`,
  };
}

export function drawReceiptCoverPhoto(ctx, image, rect, value, options = {}) {
  const transform = getReceiptPhotoTransform(value, rect.width / rect.height, options);
  const cover = Math.max(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
  const width = image.naturalWidth * cover;
  const height = image.naturalHeight * cover;
  const frame = createReceiptCanvas(rect.width, rect.height);
  const frameCtx = frame.getContext("2d");
  if (!frameCtx) throw new Error("receipt_photo_canvas_unavailable");
  frameCtx.filter = options.filter || "none";
  frameCtx.drawImage(
    image,
    -(width - rect.width) * transform.positionX,
    -(height - rect.height) * transform.positionY,
    width,
    height,
  );

  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.width, rect.height);
  ctx.clip();
  ctx.translate(
    rect.x + rect.width / 2 + rect.width * transform.shiftXRatio,
    rect.y + rect.height / 2 + rect.height * transform.shiftYRatio,
  );
  ctx.rotate(transform.photoRotation * Math.PI / 180);
  ctx.scale(transform.scale, transform.scale);
  ctx.drawImage(frame, -rect.width / 2, -rect.height / 2);
  ctx.restore();
}
