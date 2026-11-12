import type { LetterCell } from "@/lib/crossword";
import type { CrosswordPhoto, Point } from "./photos";

/**
 * Draws a reading over its photo as SVG, for reviewing by eye what the
 * automatic checks can't judge: red boxes are the cells Gemini found, green
 * dots are labelled letter squares, and orange dots are labelled clue areas.
 */
export function renderOverlay(
  photo: CrosswordPhoto,
  image: { base64: string; width: number; height: number },
  cells: LetterCell[],
) {
  const { width, height } = image;
  const sx = width / 1000;
  const sy = height / 1000;
  const boxes = cells.map(
    (cell) =>
      `<rect x="${cell.x * sx}" y="${cell.y * sy}" width="${cell.w * sx}" height="${cell.h * sy}" fill="none" stroke="red" stroke-width="2"/>` +
      `<text x="${cell.x * sx + 2}" y="${cell.y * sy + 11}" font-size="10" fill="blue">${cell.row},${cell.col}</text>`,
  );
  const dot = ([x, y]: Point, color: string) =>
    `<circle cx="${x * sx}" cy="${y * sy}" r="7" fill="${color}" stroke="black" stroke-width="1.5"/>`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}">`,
    `<image width="${width}" height="${height}" xlink:href="data:image/jpeg;base64,${image.base64}"/>`,
    ...boxes,
    ...photo.letterPoints.map((point) => dot(point, "lime")),
    ...photo.cluePoints.map((point) => dot(point, "orange")),
    "</svg>",
  ].join("\n");
}

/** Pixel size from a JPEG's start-of-frame marker. */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) throw new Error("not a JPEG marker");
    const marker = bytes[offset + 1];
    // 0xFF fill bytes may pad before a marker.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // TEM and RST0–7 stand alone, with no length field.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    // SOF0–SOF15 carry the size, except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: (bytes[offset + 5] << 8) | bytes[offset + 6], width: (bytes[offset + 7] << 8) | bytes[offset + 8] };
    }
    offset += 2 + length;
  }
  throw new Error("no JPEG size found");
}
