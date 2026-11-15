import { PUZZLE_PREFIX, recentPuzzles, type ListedObject } from "@/lib/storedPuzzle";
import { connection, NextResponse } from "next/server";
import { storageBucket } from "../storage";

/**
 * Pages of the listing to read at most. R2 lists 1000 objects a page, and
 * puzzles expire after a week, so one page is plenty; the cap keeps a
 * runaway bucket from eating the request.
 */
const MAX_LIST_PAGES = 5;

const LIST_FAILURE = "Kunde inte hämta korsorden.";

/**
 * The recent puzzles, one per room, newest first. Gated by the proxy. Reads
 * only the listing and the metadata stored beside each puzzle, never the
 * puzzles themselves.
 */
export async function GET() {
  // Never prerendered: the list changes with every puzzle shared.
  await connection();
  const bucket = await storageBucket();
  if (!bucket) {
    console.error("puzzles: the PHOTOS bucket binding is missing");
    return NextResponse.json({ error: LIST_FAILURE }, { status: 500 });
  }
  try {
    const objects: ListedObject[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
      const listing = await bucket.list({ prefix: PUZZLE_PREFIX, cursor, include: ["customMetadata"] });
      objects.push(...listing.objects);
      if (!listing.truncated || !listing.cursor) break;
      cursor = listing.cursor;
    }
    return NextResponse.json({ puzzles: recentPuzzles(objects) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("puzzles: listing failed", error);
    return NextResponse.json({ error: LIST_FAILURE }, { status: 502 });
  }
}
