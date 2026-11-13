import type { AnalyzeFailure, Result } from "./analyze";

/**
 * Stored crossword photos. The browser uploads a sharp JPEG once to
 * /api/photo, which keeps it in R2 under a random id; peers get only the id
 * in the puzzle broadcast and load the photo from /api/photo/<id>. Pure and
 * runtime-agnostic: the crossword validators, which the server also runs,
 * check photo ids with it.
 */

/**
 * The largest upload accepted. The browser sends at most STORE_MAX_WIDTH px
 * (about 0.7 MB for a magazine spread); this leaves room for busy photos and
 * still bounds what one request can store.
 */
export const MAX_PHOTO_BYTES = 8_000_000;
export const PHOTO_MIME_TYPE = "image/jpeg";

/** crypto.randomUUID() output: ids that name stored objects, so nobody can point a URL or key elsewhere. */
const RANDOM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isRandomId(value: unknown): value is string {
  return typeof value === "string" && RANDOM_ID.test(value);
}

/** A stored photo's id. */
export const isPhotoId = isRandomId;

/** Where the browser loads a stored photo from. */
export function photoUrl(id: string) {
  return `/api/photo/${id}`;
}

/** The object key in the bucket. */
export function photoKey(id: string) {
  return `photos/${id}.jpg`;
}

/** Rejects an upload by its declared size before the body is read. */
export function checkDeclaredLength(contentLength: string | null): Result<null> {
  const length = contentLength === null ? NaN : Number(contentLength);
  if (Number.isFinite(length) && length > MAX_PHOTO_BYTES) return { ok: false, error: TOO_LARGE };
  return { ok: true, value: null };
}

const TOO_LARGE: AnalyzeFailure = { message: "Bilden är för stor.", status: 413 };
const NOT_JPEG: AnalyzeFailure = { message: "Bilden måste vara en JPEG.", status: 415 };

/** Checks an uploaded photo: a non-empty JPEG within MAX_PHOTO_BYTES, by its bytes, not only its header. */
export function checkPhotoUpload(contentType: string | null, bytes: Uint8Array): Result<Uint8Array> {
  if (contentType?.split(";")[0].trim().toLowerCase() !== PHOTO_MIME_TYPE) return { ok: false, error: NOT_JPEG };
  if (bytes.length > MAX_PHOTO_BYTES) return { ok: false, error: TOO_LARGE };
  // Every JPEG starts with an SOI marker followed by another marker.
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return { ok: false, error: NOT_JPEG };
  return { ok: true, value: bytes };
}
