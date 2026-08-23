import { createHash } from "node:crypto";

const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");

export function inspectReceiptPng(png) {
  if (!Buffer.isBuffer(png)) throw new Error("receipt_png_not_buffer");
  if (png.length < 45 || !png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error("receipt_png_signature_invalid");
  }

  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let sawImageData = false;
  let sawImageEnd = false;
  while (offset + 12 <= png.length) {
    const dataLength = png.readUInt32BE(offset);
    const chunkEnd = offset + 12 + dataLength;
    if (chunkEnd > png.length) throw new Error("receipt_png_truncated");

    const chunkType = png.toString("ascii", offset + 4, offset + 8);
    if (offset === PNG_SIGNATURE.length && chunkType !== "IHDR") {
      throw new Error("receipt_png_header_missing");
    }
    if (chunkType === "IHDR") {
      if (dataLength !== 13 || width || height) throw new Error("receipt_png_header_invalid");
      width = png.readUInt32BE(offset + 8);
      height = png.readUInt32BE(offset + 12);
      if (!width || !height) throw new Error("receipt_png_dimensions_invalid");
    } else if (chunkType === "IDAT") {
      sawImageData = true;
    } else if (chunkType === "IEND") {
      if (dataLength !== 0 || chunkEnd !== png.length) throw new Error("receipt_png_end_invalid");
      sawImageEnd = true;
      break;
    }
    offset = chunkEnd;
  }

  if (!width || !height || !sawImageData || !sawImageEnd) throw new Error("receipt_png_incomplete");
  return {
    byteLength: png.length,
    width,
    height,
    sha256: createHash("sha256").update(png).digest("hex"),
  };
}
