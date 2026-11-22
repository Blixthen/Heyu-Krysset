"use client";

/**
 * Upper bound for the image we broadcast to peers. Supabase Realtime limits
 * broadcast payload size (lower on the free plan), and the payload also
 * carries the cell list and letters, so we leave headroom.
 */
export const SHARE_IMAGE_BUDGET = 180_000;

/** Wide enough for readGrid to find small squares, small enough for a phone's memory (about 11 MB of pixels). */
const READ_MAX_WIDTH = 1400;
/**
 * The stored photo's width: clue text on a two-page magazine spread is still
 * readable at 2400 px and clear at 3000, about 0.7 MB as a JPEG.
 */
const STORE_MAX_WIDTH = 3000;
/** …and at most this many pixels, so a tall scan stays under iOS Safari's canvas limit (16.7M). */
const STORE_MAX_PIXELS = 12_000_000;
const STORE_QUALITY = 0.8;
const SHARE_WIDTHS = [1400, 1200, 1000, 850];
const SHARE_QUALITIES = [0.75, 0.6, 0.5];

function draw(bitmap: ImageBitmap, maxWidth: number) {
  const scale = Math.min(1, maxWidth / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Kunde inte läsa bilden.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return { canvas, context };
}

function render(bitmap: ImageBitmap, maxWidth: number, quality: number) {
  return draw(bitmap, maxWidth).canvas.toDataURL("image/jpeg", quality);
}

/**
 * The canvas's pixels, or null if the browser refuses to hand them out
 * (fingerprinting protection, canvas memory limits).
 */
function readPixels(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D) {
  try {
    return context.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    return null;
  }
}

function base64Of(dataUrl: string) {
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

function toJpegBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/**
 * Prepares one photo for reading and sharing: the pixels for reading the grid
 * in the browser (null if the browser refuses), and a smaller JPEG that fits
 * in a realtime broadcast. Cell coordinates are relative (0–1000), so they
 * apply to both.
 */
export async function prepareImages(file: File) {
  const bitmap = await createImageBitmap(file);
  try {
    const { canvas, context } = draw(bitmap, READ_MAX_WIDTH);
    const pixels = readPixels(canvas, context);
    let share = "";
    search: for (const width of SHARE_WIDTHS) {
      for (const quality of SHARE_QUALITIES) {
        share = render(bitmap, width, quality);
        if (base64Of(share).length <= SHARE_IMAGE_BUDGET) break search;
      }
    }
    return { pixels, shareDataUrl: share };
  } finally {
    bitmap.close();
  }
}

/**
 * A sharp JPEG of the photo to store, or null if the browser can't make one
 * (a canvas over its memory limit, no encoder): the stored copy is optional.
 * Made after the puzzle is shared, so it neither delays the grid reading nor
 * adds to its memory.
 */
export async function prepareStoreCopy(file: File): Promise<Blob | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  try {
    const scale = Math.min(1, Math.sqrt(STORE_MAX_PIXELS / (bitmap.width * bitmap.height)));
    const width = Math.min(STORE_MAX_WIDTH, Math.floor(bitmap.width * scale));
    return await toJpegBlob(draw(bitmap, width).canvas, STORE_QUALITY);
  } catch {
    return null;
  } finally {
    bitmap.close();
  }
}
