import { readBounded } from "@/lib/bytes";
import { isRandomId } from "@/lib/photo";
import { MAX_LETTERS_BYTES, checkLettersUpload, lettersKey } from "@/lib/storedLetters";
import { puzzleKey } from "@/lib/storedPuzzle";
import { NextResponse } from "next/server";
import { storageBucket } from "../../../storage";

const SAVE_FAILURE = "Bokstäverna kunde inte sparas.";
const LOAD_FAILURE = "Kunde inte hämta bokstäverna.";
const NO_PUZZLE = "Korsordet finns inte kvar.";
const NO_LETTERS = "Inga sparade bokstäver.";

type Context = { params: Promise<{ id: string }> };

function failure(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Saves the letters typed into a stored puzzle. Gated by the proxy. The last
 * save wins: every player sees the same board, so the latest save holds what
 * everyone typed, and a cleared square must be able to stay cleared.
 */
export async function PUT(request: Request, { params }: Context) {
  const { id } = await params;
  if (!isRandomId(id)) return failure(NO_PUZZLE, 404);
  const bucket = await storageBucket();
  if (!bucket) {
    console.error("letters: the PHOTOS bucket binding is missing");
    return failure(SAVE_FAILURE, 500);
  }

  let body: unknown;
  try {
    const bytes = await readBounded(request.body, MAX_LETTERS_BYTES);
    if (bytes === "too-large") return failure(SAVE_FAILURE, 413);
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    console.warn("letters: unreadable upload", error instanceof Error ? error.name : typeof error);
    return failure(SAVE_FAILURE, 400);
  }
  const upload = checkLettersUpload(body);
  if (!upload.ok) return failure(upload.error.message, upload.error.status);

  try {
    // Only for a stored puzzle, so letters never pile up under ids nobody can open.
    if (!(await bucket.head(puzzleKey(id)))) return failure(NO_PUZZLE, 404);
    await bucket.put(lettersKey(id), new TextEncoder().encode(JSON.stringify(upload.value)), {
      httpMetadata: { contentType: "application/json" },
    });
  } catch (error) {
    console.error("letters: storing failed", error);
    return failure(SAVE_FAILURE, 502);
  }
  return new NextResponse(null, { status: 204 });
}

/** Loads the letters saved for a stored puzzle, for its permanent link. */
export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  if (!isRandomId(id)) return failure(NO_LETTERS, 404);
  const bucket = await storageBucket();
  if (!bucket) {
    console.error("letters: the PHOTOS bucket binding is missing");
    return failure(LOAD_FAILURE, 500);
  }

  let text: string;
  try {
    const object = await bucket.get(lettersKey(id));
    if (!object) return failure(NO_LETTERS, 404);
    text = await new Response(object.body).text();
  } catch (error) {
    console.error("letters: reading failed", error);
    return failure(LOAD_FAILURE, 502);
  }
  let stored: unknown = null;
  try {
    stored = JSON.parse(text);
  } catch {
    // Reported as missing below.
  }
  // Checked again on the way out, like stored puzzles.
  const saved = checkLettersUpload(stored);
  if (!saved.ok) {
    console.error("letters: stored letters are invalid", id);
    return failure(NO_LETTERS, 404);
  }
  return NextResponse.json(saved.value, { headers: { "Cache-Control": "no-store" } });
}
