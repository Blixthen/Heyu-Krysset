import { isPhotoId, photoKey, PHOTO_MIME_TYPE } from "@/lib/photo";
import { NextResponse } from "next/server";
import { photoBucket } from "../bucket";

/** A day: long enough for a crossword session, short next to a password change or the bucket's expiry. */
const PHOTO_CACHE_SECONDS = 86_400;

/**
 * Serves a stored crossword photo. Gated by the proxy like every other route,
 * so the photo is as private as the room. A photo never changes once stored,
 * so this user's browser may keep it, but only for PHOTO_CACHE_SECONDS: a
 * changed password should lock out former players' cached copies soon too.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isPhotoId(id)) return NextResponse.json({ error: "Bilden finns inte." }, { status: 404 });

  const bucket = await photoBucket();
  if (!bucket) {
    console.error("photo: the PHOTOS bucket binding is missing");
    return NextResponse.json({ error: "Kunde inte hämta bilden." }, { status: 500 });
  }

  let object;
  try {
    object = await bucket.get(photoKey(id));
  } catch (error) {
    console.error("photo: reading failed", error);
    return NextResponse.json({ error: "Kunde inte hämta bilden." }, { status: 502 });
  }
  if (!object) return NextResponse.json({ error: "Bilden finns inte." }, { status: 404 });

  return new Response(object.body, {
    headers: {
      // Always JPEG: uploads are checked, and a fixed type keeps a stored file from being served as anything else.
      "Content-Type": PHOTO_MIME_TYPE,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": `private, max-age=${PHOTO_CACHE_SECONDS}`,
    },
  });
}
