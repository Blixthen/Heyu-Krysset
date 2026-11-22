import type { Result } from "./result";
import { isCrosswordPuzzle, MAX_CELLS, toCrosswordPuzzle, type CrosswordPuzzle } from "./crossword";
import { isRandomId } from "./photo";
import { roomOf } from "./room";

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

/** Where the browser lists the recent puzzles from. */
export const RECENT_PUZZLES_URL = "/api/puzzles";

/** The bucket prefix of stored puzzles. */
export const PUZZLE_PREFIX = "puzzles/";

/** The most rooms the list of recent puzzles shows; puzzles expire after a week anyway. */
export const MAX_RECENT_PUZZLES = 30;

/**
 * What the list of recent puzzles shows, stored as R2 custom metadata beside
 * each puzzle, so listing reads no puzzle: parsing each one's inline image
 * would not fit the Worker's CPU budget. R2 metadata values are strings.
 */
export function puzzleMetadata(puzzle: CrosswordPuzzle): Record<string, string> {
  return {
    createdAt: String(puzzle.createdAt),
    cells: String(puzzle.cells.length),
    ...(puzzle.restartOf === undefined ? {} : { restartOf: puzzle.restartOf }),
  };
}

/** One room in the list of recent puzzles, by its newest puzzle. */
export type RecentPuzzle = {
  /** The newest puzzle in the room, which its link opens. */
  id: string;
  room: string;
  createdAt: number;
  /** How many letter squares; unknown for puzzles stored before the list. */
  cells?: number;
};

/** An object from listing the bucket. */
export type ListedObject = { key: string; uploaded: Date; customMetadata?: Record<string, string> };

function listedPuzzle(object: ListedObject): RecentPuzzle | null {
  if (!object.key.startsWith(PUZZLE_PREFIX) || !object.key.endsWith(".json")) return null;
  const id = object.key.slice(PUZZLE_PREFIX.length, -".json".length);
  if (!isRandomId(id)) return null;
  const metadata = object.customMetadata ?? {};
  const restartOf = isRandomId(metadata.restartOf) ? metadata.restartOf : undefined;
  // Puzzles stored before the list have no metadata; when they were stored stands in for when they were shared.
  const shared = Number(metadata.createdAt);
  const createdAt = Number.isSafeInteger(shared) && shared > 0 ? shared : object.uploaded.getTime();
  const cells = Number(metadata.cells);
  return {
    id,
    room: roomOf({ id, restartOf }),
    createdAt,
    ...(Number.isInteger(cells) && cells > 0 && cells <= MAX_CELLS ? { cells } : {}),
  };
}

/** The rooms of the listed puzzles, each by its newest puzzle, newest first. */
export function recentPuzzles(objects: ListedObject[]): RecentPuzzle[] {
  const newest = new Map<string, RecentPuzzle>();
  for (const object of objects) {
    const puzzle = listedPuzzle(object);
    if (!puzzle) continue;
    const kept = newest.get(puzzle.room);
    if (!kept || puzzle.createdAt > kept.createdAt) newest.set(puzzle.room, puzzle);
  }
  return [...newest.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_RECENT_PUZZLES);
}

function isRecentPuzzle(value: unknown): value is RecentPuzzle {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    isRandomId(candidate.id) &&
    isRandomId(candidate.room) &&
    typeof candidate.createdAt === "number" &&
    Number.isFinite(candidate.createdAt) &&
    (candidate.cells === undefined ||
      (Number.isInteger(candidate.cells) && (candidate.cells as number) > 0 && (candidate.cells as number) <= MAX_CELLS))
  );
}

/** The list /api/puzzles answered with, copied field by field; null if it isn't one. */
export function toRecentPuzzles(value: unknown): RecentPuzzle[] | null {
  const list = (value as { puzzles?: unknown } | null)?.puzzles;
  if (!Array.isArray(list) || list.length > MAX_RECENT_PUZZLES || !list.every(isRecentPuzzle)) return null;
  return list.map(({ id, room, createdAt, cells }) => ({ id, room, createdAt, ...(cells === undefined ? {} : { cells }) }));
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

/** The puzzle a path's link opens, or undefined for any other path. */
export function linkedPuzzleId(path: string) {
  const id = path.startsWith("/p/") ? path.slice(3) : null;
  return id !== null && isRandomId(id) ? id : undefined;
}

/**
 * Where to go after logging in: home, or a puzzle link the login interrupted.
 * Only those, so the login form can't be used to send someone elsewhere.
 */
export function safeNextPath(value: unknown) {
  if (typeof value !== "string") return "/";
  const id = linkedPuzzleId(value);
  return id ? puzzlePath(id) : "/";
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
