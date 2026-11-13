import { isRandomId } from "@/lib/photo";
import { checkPuzzleUpload, puzzleKey } from "@/lib/storedPuzzle";
import { NextResponse } from "next/server";
import { storageBucket } from "../../storage";

const NOT_FOUND = "Korsordet finns inte kvar.";

/** Serves a stored puzzle for its permanent link. Gated by the proxy, like the room. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isRandomId(id)) return NextResponse.json({ error: NOT_FOUND }, { status: 404 });

  const bucket = await storageBucket();
  if (!bucket) {
    console.error("puzzle: the PHOTOS bucket binding is missing");
    return NextResponse.json({ error: "Kunde inte hämta korsordet." }, { status: 500 });
  }

  let text: string;
  try {
    const object = await bucket.get(puzzleKey(id));
    if (!object) return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    text = await new Response(object.body).text();
  } catch (error) {
    console.error("puzzle: reading failed", error);
    return NextResponse.json({ error: "Kunde inte hämta korsordet." }, { status: 502 });
  }
  // Checked again on the way out: what is stored should never be trusted more than what was sent.
  let stored: unknown = null;
  try {
    stored = JSON.parse(text);
  } catch {
    // Reported as missing below.
  }
  const puzzle = checkPuzzleUpload(stored);
  if (!puzzle.ok || puzzle.value.id !== id) {
    console.error("puzzle: stored puzzle is invalid", id);
    return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
  }
  return NextResponse.json(puzzle.value, { headers: { "Cache-Control": "no-store" } });
}
