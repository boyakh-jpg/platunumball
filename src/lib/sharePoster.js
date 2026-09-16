import { createQrMatrix } from "./qrCode.js";

// Export dimensions belong to this shared poster, independently of the screen breakpoint.
const WIDTH = 1080;
const HEIGHT = 1350;
const PADDING = 80;

function wrapText(context, text, width) {
  const lines = [];
  for (const paragraph of String(text).split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && context.measureText(`${line} ${word}`).width > width) {
        lines.push(line);
        line = "";
      }
      if (context.measureText(word).width > width) {
        for (const character of Array.from(word)) {
          if (line && context.measureText(line + character).width > width) {
            lines.push(line);
            line = "";
          }
          line += character;
        }
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line || !paragraph) lines.push(line);
  }
  return lines;
}

export async function createSharePoster(promotion, palette) {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("share_canvas_unavailable");
  if (document.fonts) {
    await Promise.all([
      document.fonts.load(`${palette.titleWeight} 88px ${palette.font}`),
      document.fonts.load(`${palette.bodyWeight} 38px ${palette.font}`),
    ]);
  }

  const font = (size, weight = palette.bodyWeight) => {
    context.font = `${weight} ${size}px ${palette.font}`;
  };
  const drawText = (text, x, y, { size = 38, width = WIDTH - PADDING * 2, lines = 2, color = palette.text, weight = palette.bodyWeight } = {}) => {
    font(size, weight);
    const wrapped = wrapText(context, text, width);
    const visible = wrapped.slice(0, lines);
    if (wrapped.length > lines) {
      let last = visible.at(-1);
      while (last && context.measureText(`${last}…`).width > width) last = Array.from(last).slice(0, -1).join("");
      visible[lines - 1] = `${last}…`;
    }
    context.fillStyle = color;
    visible.forEach((line, index) => context.fillText(line, x, y + index * size * 1.3));
    return visible.length * size * 1.3;
  };
  // Choose QR polarity from the resolved theme colors; never invert QR modules in dark mode.
  const brightness = (color) => {
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
    return red * 0.2126 + green * 0.7152 + blue * 0.0722;
  };
  const lightBackground = brightness(palette.background) > brightness(palette.text);
  const qrPaper = lightBackground ? palette.background : palette.text;
  const qrInk = lightBackground ? palette.text : palette.background;
  context.fillStyle = palette.background;
  context.fillRect(0, 0, WIDTH, HEIGHT);
  context.textBaseline = "top";

  drawText("BOXTIER", PADDING, 76, { size: 34, weight: palette.titleWeight });
  context.fillStyle = palette.accent;
  context.fillRect(PADDING, 138, WIDTH - PADDING * 2, 5);
  drawText(promotion.eyebrow || "", PADDING, 186, { size: 30, lines: 1, color: palette.accent });
  let titleSize = 88;
  font(titleSize, palette.titleWeight);
  while (titleSize > 52 && wrapText(context, promotion.title, WIDTH - PADDING * 2).length > 3) {
    titleSize -= 2;
    font(titleSize, palette.titleWeight);
  }
  const titleHeight = drawText(promotion.title, PADDING, 248, { size: titleSize, lines: 3, weight: palette.titleWeight });

  const fields = (promotion.fields || []).filter(({ value }) => value !== null && value !== undefined && String(value).trim()).slice(0, 4);
  const columns = fields.length <= 2 ? 1 : 2;
  const fieldPadding = 32;
  const fieldGap = 32;
  const rowHeight = 176;
  const fieldsTop = Math.max(464, 248 + titleHeight + 48);
  const columnWidth = (WIDTH - PADDING * 2 - fieldPadding * 2 - fieldGap * (columns - 1)) / columns;
  if (fields.length) {
    context.fillStyle = palette.surface;
    context.fillRect(PADDING, fieldsTop, WIDTH - PADDING * 2, Math.ceil(fields.length / columns) * rowHeight + fieldPadding);
  }
  fields.forEach(({ label, value }, index) => {
    const x = PADDING + fieldPadding + (index % columns) * (columnWidth + fieldGap);
    const y = fieldsTop + fieldPadding + Math.floor(index / columns) * rowHeight;
    drawText(label, x, y, { size: 28, color: palette.muted, lines: 1, width: columnWidth });
    drawText(value, x, y + 44, { size: 38, lines: 2, width: columnWidth });
  });

  const matrix = createQrMatrix(promotion.url);
  const quietZone = 4;
  const moduleSize = Math.max(1, Math.floor(210 / (matrix.length + quietZone * 2)));
  const qrSize = (matrix.length + quietZone * 2) * moduleSize;
  const qrX = WIDTH - PADDING - qrSize;
  const qrY = HEIGHT - PADDING - qrSize;
  context.fillStyle = qrPaper;
  context.fillRect(qrX, qrY, qrSize, qrSize);
  context.fillStyle = qrInk;
  matrix.forEach((row, y) => row.forEach((filled, x) => {
    if (filled) context.fillRect(qrX + (x + quietZone) * moduleSize, qrY + (y + quietZone) * moduleSize, moduleSize, moduleSize);
  }));
  const footerWidth = qrX - PADDING - 40;
  context.fillStyle = palette.surface;
  context.fillRect(PADDING, 1040, WIDTH - PADDING * 2, 3);
  drawText(promotion.actionLabel, PADDING, 1080, { size: 36, width: footerWidth, lines: 2, weight: palette.titleWeight });
  drawText(promotion.note || "", PADDING, 1190, { size: 26, width: footerWidth, lines: 2, color: palette.muted });

  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("share_image_failed")), "image/png"));
}
