import { readBounded } from "@/lib/bytes";
import type { CrosswordPuzzle } from "@/lib/crossword";
import { MAX_PUZZLE_BYTES, checkPuzzleUpload, compareStored, puzzleKey } from "@/lib/storedPuzzle";
import { NextResponse } from "next/server";
import { storageBucket } from "../storage";

const SAVE_FAILURE = "Korsordet kunde inte sparas.";
const ALREADY_SAVED = "Korsordet är redan sparat.";

function failure(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function saved(id: string) {
  return NextResponse.json({ id }, { headers: { "Cache-Control": "no-store" } });
}

function encode(puzzle: CrosswordPuzzle) {
  return new TextEncoder().encode(JSON.stringify(puzzle));
}

const JSON_METADATA = { contentType: "application/json" };

/**
 * Stores a puzzle behind its permanent link. Gated by the proxy. The first
 * save creates it; a later one may only add the photo id it was missing
 * (compareStored), so nobody can swap out a puzzle others have a link to.
 * Both writes are conditional in R2, so concurrent saves can't both win.
 */
export async function POST(request: Request) {
  const bucket = await storageBucket();
  if (!bucket) {
    console.error("puzzle: the PHOTOS bucket binding is missing");
    return failure(SAVE_FAILURE, 500);
  }

  let body: unknown;
  try {
    const bytes = await readBounded(request.body, MAX_PUZZLE_BYTES);
    if (bytes === "too-large") return failure("Korsordet är för stort.", 413);
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    console.warn("puzzle: unreadable upload", error instanceof Error ? error.name : typeof error);
    return failure(SAVE_FAILURE, 400);
  }
  const upload = checkPuzzleUpload(body);
  if (!upload.ok) return failure(upload.error.message, upload.error.status);
  const puzzle = upload.value;
  const key = puzzleKey(puzzle.id);

  try {
    if (await bucket.put(key, encode(puzzle), { httpMetadata: JSON_METADATA, onlyIf: { etagDoesNotMatch: "*" } })) {
      return saved(puzzle.id);
    }
    const existing = await bucket.get(key);
    const stored = existing ? checkPuzzleUpload(JSON.parse(await new Response(existing.body).text())) : null;
    if (!existing || !stored?.ok) return failure(ALREADY_SAVED, 409);
    const relation = compareStored(stored.value, puzzle);
    if (relation === "same") return saved(puzzle.id);
    if (relation === "conflict") return failure(ALREADY_SAVED, 409);
    // Only if nobody changed it since we read it.
    const updated = await bucket.put(key, encode(puzzle), { httpMetadata: JSON_METADATA, onlyIf: { etagMatches: existing.etag } });
    return updated ? saved(puzzle.id) : failure(ALREADY_SAVED, 409);
  } catch (error) {
    console.error("puzzle: storing failed", error);
    return failure(SAVE_FAILURE, 502);
  }
}
