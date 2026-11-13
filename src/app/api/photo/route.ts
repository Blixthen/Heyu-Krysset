import { checkDeclaredLength, checkPhotoUpload, MAX_PHOTO_BYTES, photoKey, PHOTO_MIME_TYPE } from "@/lib/photo";
import { NextResponse } from "next/server";
import { readBounded } from "@/lib/bytes";
import { storageBucket } from "../storage";

const STORE_FAILURE = "Kunde inte spara bilden.";

/**
 * Stores an uploaded crossword photo and returns its id. Gated by the proxy,
 * so only players can store photos. The checks live in @/lib/photo.
 */
export async function POST(request: Request) {
  const declared = checkDeclaredLength(request.headers.get("content-length"));
  if (!declared.ok) return NextResponse.json({ error: declared.error.message }, { status: declared.error.status });

  const bucket = await storageBucket();
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
