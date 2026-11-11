"use client";

/**
 * Upper bound for the image we broadcast to peers. Supabase Realtime limits
 * broadcast payload size (lower on the free plan), and the payload also
 * carries the cell list and letters, so we leave headroom.
 */
export const SHARE_IMAGE_BUDGET = 180_000;

const ANALYZE_MAX_WIDTH = 1400;
const SHARE_WIDTHS = [1400, 1200, 1000, 850];
const SHARE_QUALITIES = [0.75, 0.6, 0.5];

function render(bitmap: ImageBitmap, maxWidth: number, quality: number) {
  const scale = Math.min(1, maxWidth / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Kunde inte läsa bilden.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

function base64Of(dataUrl: string) {
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

/**
 * Produces two JPEGs from the same photo: a high-quality one for Gemini to
 * read, and a smaller one that fits in a realtime broadcast. Cell coordinates
 * are relative (0–1000), so they apply to both.
 */
export async function prepareImages(file: File) {
  const bitmap = await createImageBitmap(file);
  try {
    const analyze = base64Of(render(bitmap, ANALYZE_MAX_WIDTH, 0.82));
    let share = "";
    search: for (const width of SHARE_WIDTHS) {
      for (const quality of SHARE_QUALITIES) {
        share = render(bitmap, width, quality);
        if (base64Of(share).length <= SHARE_IMAGE_BUDGET) break search;
      }
    }
    return { analyzeBase64: analyze, mimeType: "image/jpeg", shareDataUrl: share };
  } finally {
    bitmap.close();
  }
}
