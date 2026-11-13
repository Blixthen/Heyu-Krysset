import { checkDeclaredLength, checkPhotoUpload, MAX_PHOTO_BYTES, photoKey, PHOTO_MIME_TYPE } from "@/lib/photo";
import { NextResponse } from "next/server";
import { photoBucket } from "./bucket";

const STORE_FAILURE = "Kunde inte spara bilden.";

/**
 * The body, read until it passes `max` bytes: a request without a declared
 * length (chunked) must not fill the Worker's memory. "too-large" once it
 * passes the limit; one byte over is enough for checkPhotoUpload to refuse it.
 */
async function readBounded(body: ReadableStream<Uint8Array> | null, max: number): Promise<Uint8Array | "too-large"> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > max) {
      await reader.cancel();
      return "too-large";
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/**
 * Stores an uploaded crossword photo and returns its id. Gated by the proxy,
 * so only players can store photos. The checks live in @/lib/photo.
 */
export async function POST(request: Request) {
  const declared = checkDeclaredLength(request.headers.get("content-length"));
  if (!declared.ok) return NextResponse.json({ error: declared.error.message }, { status: declared.error.status });

  const bucket = await photoBucket();
  if (!bucket) {
    console.error("photo: the PHOTOS bucket binding is missing");
    return NextResponse.json({ error: STORE_FAILURE }, { status: 500 });
  }

  let bytes: Uint8Array | "too-large";
  try {
    bytes = await readBounded(request.body, MAX_PHOTO_BYTES);
  } catch (error) {
    console.warn("photo: unreadable upload", error instanceof Error ? error.name : typeof error);
    return NextResponse.json({ error: STORE_FAILURE }, { status: 400 });
  }
  if (bytes === "too-large") return NextResponse.json({ error: "Bilden är för stor." }, { status: 413 });
  const upload = checkPhotoUpload(request.headers.get("content-type"), bytes);
  if (!upload.ok) return NextResponse.json({ error: upload.error.message }, { status: upload.error.status });

  const id = crypto.randomUUID();
  try {
    await bucket.put(photoKey(id), upload.value, { httpMetadata: { contentType: PHOTO_MIME_TYPE } });
  } catch (error) {
    console.error("photo: storing failed", error);
    return NextResponse.json({ error: STORE_FAILURE }, { status: 502 });
  }
  return NextResponse.json({ id }, { headers: { "Cache-Control": "no-store" } });
}
