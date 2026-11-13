import type { Result } from "./analyze";
import { isCrosswordPuzzle, toCrosswordPuzzle, type CrosswordPuzzle } from "./crossword";
import { isRandomId } from "./photo";

/**
 * Stored puzzles, behind a permanent link. The uploader saves the puzzle
 * (squares, inline image and photo id) once, in the same bucket as photos;
 * /p/<id> loads it back, so a puzzle outlives everyone leaving the room.
 * Pure and runtime-agnostic, like the crossword validators it uses.
 */

/**
 * The largest stored puzzle: the inline image (at most SHARE_IMAGE_BUDGET,
 * 180 kB) plus up to MAX_CELLS cells of about 50 bytes, with headroom.
 */
export const MAX_PUZZLE_BYTES = 600_000;

/** The page that opens a stored puzzle. */
export function puzzlePath(id: string) {
  return `/p/${id}`;
}

/** Where the browser loads a stored puzzle from. */
export function puzzleUrl(id: string) {
  return `/api/puzzle/${id}`;
}

/** The object key in the bucket. */
export function puzzleKey(id: string) {
  return `puzzles/${id}.json`;
}

const NOT_A_PUZZLE = { message: "Korsordet kunde inte sparas.", status: 400 };

/** Checks a puzzle to store: valid, with a random id so its link can't be guessed or collide. */
export function checkPuzzleUpload(value: unknown): Result<CrosswordPuzzle> {
  if (!isCrosswordPuzzle(value) || !isRandomId(value.id)) return { ok: false, error: NOT_A_PUZZLE };
  return { ok: true, value: toCrosswordPuzzle(value) };
}

/**
 * How a puzzle sent for saving relates to the one stored under its id. The
 * uploader saves a puzzle as soon as it is shared and again once its photo is
 * stored, so the second save may only fill in a photo; anything else would
 * change a puzzle others already have the link to.
 */
export function compareStored(stored: CrosswordPuzzle, incoming: CrosswordPuzzle): "same" | "adds-photo" | "conflict" {
  const { photo: storedPhoto, ...storedRest } = stored;
  const { photo: incomingPhoto, ...incomingRest } = incoming;
  if (JSON.stringify(storedRest) !== JSON.stringify(incomingRest)) return "conflict";
  if (storedPhoto === incomingPhoto || incomingPhoto === undefined) return "same";
  return storedPhoto === undefined ? "adds-photo" : "conflict";
}

/**
 * Where to go after logging in: home, or a puzzle link the login interrupted.
 * Only those, so the login form can't be used to send someone elsewhere.
 */
export function safeNextPath(value: unknown) {
  if (typeof value !== "string") return "/";
  const id = value.startsWith("/p/") ? value.slice(3) : null;
  return id !== null && isRandomId(id) ? puzzlePath(id) : "/";
}

/**
 * The same crossword started over: the squares, image and photo under a new
 * id, so it gets no letters and its own link, while the old link keeps the old
 * letters. Newer than the original, so it replaces it in every tab. It names
 * the first puzzle it starts over, so a photo still being stored for that one
 * reaches it (boardReducer's "photo").
 */
export function restartedPuzzle(puzzle: CrosswordPuzzle, id: string, now: number): CrosswordPuzzle {
  return { ...puzzle, id, createdAt: Math.max(now, puzzle.createdAt + 1), restartOf: puzzle.restartOf ?? puzzle.id };
}
