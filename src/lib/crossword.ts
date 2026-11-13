import { isPlayerName } from "./players";

/**
 * Shared crossword types and validators. Used by both the browser (to validate
 * realtime payloads from peers) and the server (to validate Gemini output).
 * Coordinates are integers-ish on a 0–1000 scale relative to the full image.
 */

export type LetterCell = {
  row: number;
  col: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type CrosswordPuzzle = {
  id: string;
  /** Epoch millis; the newest puzzle wins when peers disagree. */
  createdAt: number;
  image: string;
  cells: LetterCell[];
};

export type Letters = Record<string, string>;
/** The nickname of whoever typed each letter, keyed like Letters. */
export type Authors = Record<string, string>;

export type CellPosition = { row: number; col: number };

export const MIN_CELLS = 8;
export const MAX_CELLS = 2000;
const SCALE = 1000;
const MIN_CELL_SIZE = 4;

export function cellKey(row: number, col: number) {
  return `${row}-${col}`;
}

function isIndex(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 10_000;
}

function isUnit(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= SCALE;
}

export function isLetterCell(value: unknown): value is LetterCell {
  if (!value || typeof value !== "object") return false;
  const cell = value as Partial<Record<keyof LetterCell, unknown>>;
  return (
    isIndex(cell.row) &&
    isIndex(cell.col) &&
    isUnit(cell.x) &&
    isUnit(cell.y) &&
    isUnit(cell.w) &&
    isUnit(cell.h) &&
    cell.w >= MIN_CELL_SIZE &&
    cell.h >= MIN_CELL_SIZE &&
    cell.x + cell.w <= SCALE &&
    cell.y + cell.h <= SCALE
  );
}

/** Copies only the known fields, dropping anything extra a sender attached. */
export function toLetterCell(cell: LetterCell): LetterCell {
  return { row: cell.row, col: cell.col, x: cell.x, y: cell.y, w: cell.w, h: cell.h };
}

/** Keeps the first cell for each (row, col) so keys stay unique. */
export function dedupeCells(cells: LetterCell[]) {
  const seen = new Set<string>();
  const unique: LetterCell[] = [];
  for (const cell of cells) {
    const key = cellKey(cell.row, cell.col);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(toLetterCell(cell));
  }
  return unique;
}

/** Returns the last letter in the input, upper-cased, or "" if there is none. */
export function oneLetter(value: string) {
  const chars = [...value.toLocaleUpperCase("sv-SE")];
  for (let index = chars.length - 1; index >= 0; index -= 1) {
    if (/^\p{L}$/u.test(chars[index])) return chars[index];
  }
  return "";
}

const IMAGE_DATA_URL = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

export function isImageDataUrl(value: unknown): value is string {
  return typeof value === "string" && IMAGE_DATA_URL.test(value);
}

export function isCrosswordPuzzle(value: unknown): value is CrosswordPuzzle {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Record<keyof CrosswordPuzzle, unknown>>;
  if (
    typeof candidate.id !== "string" ||
    candidate.id.length === 0 ||
    candidate.id.length > 64 ||
    typeof candidate.createdAt !== "number" ||
    !Number.isFinite(candidate.createdAt) ||
    !isImageDataUrl(candidate.image) ||
    !Array.isArray(candidate.cells) ||
    candidate.cells.length < MIN_CELLS ||
    candidate.cells.length > MAX_CELLS ||
    !candidate.cells.every(isLetterCell)
  ) {
    return false;
  }
  const keys = new Set(candidate.cells.map((cell: LetterCell) => cellKey(cell.row, cell.col)));
  return keys.size === candidate.cells.length;
}

/** Strips a received puzzle down to its known fields. */
export function toCrosswordPuzzle(puzzle: CrosswordPuzzle): CrosswordPuzzle {
  return {
    id: puzzle.id,
    createdAt: puzzle.createdAt,
    image: puzzle.image,
    cells: puzzle.cells.map(toLetterCell),
  };
}

/** Reads a map keyed by cell from a peer, keeping puzzle cells whose value `read` accepts. */
function cellMapFromPayload(value: unknown, cells: LetterCell[], read: (entry: unknown) => string | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const valid = new Set(cells.map((cell) => cellKey(cell.row, cell.col)));
  const map: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    const accepted = valid.has(key) ? read(entry) : null;
    if (accepted !== null) map[key] = accepted;
  }
  return map;
}

/** Reads a letters map from a peer, keeping only keys that exist in the puzzle. */
export function lettersFromPayload(value: unknown, cells: LetterCell[]): Letters {
  return cellMapFromPayload(value, cells, (letter) => (typeof letter === "string" ? oneLetter(letter) : null));
}

/** Reads an authors map from a peer, keeping only puzzle cells and valid nicknames. */
export function authorsFromPayload(value: unknown, cells: LetterCell[]): Authors {
  return cellMapFromPayload(value, cells, (author) => (isPlayerName(author) ? author : null));
}

/** `author` is optional: tabs from before it existed send updates without one. */
export type CellUpdate = { puzzleId: string; row: number; col: number; value: string; author?: string };

export function isCellUpdate(value: unknown): value is CellUpdate {
  if (!value || typeof value !== "object") return false;
  const update = value as Partial<Record<keyof CellUpdate, unknown>>;
  return (
    typeof update.puzzleId === "string" &&
    isIndex(update.row) &&
    isIndex(update.col) &&
    typeof update.value === "string" &&
    update.value.length <= 8 &&
    (update.author === undefined || isPlayerName(update.author))
  );
}

export type Direction = "across" | "down";

/**
 * The widest empty gap (in cell sizes, edge to edge) between two cells of the
 * same word. Neighbours share a grid line, or sit a little apart when boxes
 * are drawn tighter than the grid, while a clue square in between leaves a
 * gap of about a whole cell.
 */
const MAX_WORD_GAP = 0.75;
/** How far off the line (in cell sizes, centre to centre) a neighbour in the same word may sit. */
const MAX_WORD_DRIFT = 0.5;

/** The cell right next to `from` in a direction, or null if a clue square, picture or edge comes first. */
export function adjacentCell(cells: LetterCell[], from: LetterCell, rowStep: -1 | 0 | 1, colStep: -1 | 0 | 1) {
  const next = findNeighbor(cells, from, rowStep, colStep);
  if (!next) return null;
  const dx = Math.abs(next.x + next.w / 2 - (from.x + from.w / 2));
  const dy = Math.abs(next.y + next.h / 2 - (from.y + from.h / 2));
  const gap = colStep !== 0 ? (dx - (from.w + next.w) / 2) / from.w : (dy - (from.h + next.h) / 2) / from.h;
  const drift = colStep !== 0 ? dy / from.h : dx / from.w;
  return gap <= MAX_WORD_GAP && drift <= MAX_WORD_DRIFT ? next : null;
}

/** The next (sign 1) or previous (sign -1) cell of the word through `from`, or null at the word's end. */
export function nextInWord(cells: LetterCell[], from: LetterCell, direction: Direction, sign: -1 | 1) {
  return direction === "across" ? adjacentCell(cells, from, 0, sign) : adjacentCell(cells, from, sign, 0);
}

export function otherDirection(direction: Direction): Direction {
  return direction === "across" ? "down" : "across";
}

/** Whether a word of two or more letters runs through the cell in a direction. */
export function hasWord(cells: LetterCell[], cell: LetterCell, direction: Direction) {
  return nextInWord(cells, cell, direction, 1) !== null || nextInWord(cells, cell, direction, -1) !== null;
}

/**
 * The typing direction for a newly selected cell: the current one if a word
 * runs that way through it, otherwise the other way if one does. A cell in
 * both an across and a down word keeps the current direction.
 */
export function chooseDirection(cells: LetterCell[], cell: LetterCell, current: Direction): Direction {
  if (hasWord(cells, cell, current)) return current;
  return toggleDirection(cells, cell, current);
}

/**
 * The typing direction for a cell the user tapped. A cell that starts a word
 * in only one direction is where you begin typing that word, even in the
 * middle of a word the other way; otherwise as chooseDirection.
 */
export function directionForTap(cells: LetterCell[], cell: LetterCell, current: Direction): Direction {
  const starts = (["across", "down"] as const).filter(
    (direction) => nextInWord(cells, cell, direction, -1) === null && nextInWord(cells, cell, direction, 1) !== null,
  );
  return starts.length === 1 ? starts[0] : chooseDirection(cells, cell, current);
}

/** The direction after tapping the selected cell again: the other way, if a word runs that way. */
export function toggleDirection(cells: LetterCell[], cell: LetterCell, current: Direction): Direction {
  const other = otherDirection(current);
  return hasWord(cells, cell, other) ? other : current;
}

/** The cells of the word through `cell` in a direction, first to last. */
export function wordCells(cells: LetterCell[], cell: LetterCell, direction: Direction) {
  const word = [cell];
  // Bounded by the cell count, so a malformed peer grid can't loop forever.
  for (let at = cell; word.length <= cells.length; ) {
    const before = nextInWord(cells, at, direction, -1);
    if (!before || word.includes(before)) break;
    word.unshift(before);
    at = before;
  }
  for (let at = cell; word.length <= cells.length; ) {
    const after = nextInWord(cells, at, direction, 1);
    if (!after || word.includes(after)) break;
    word.push(after);
    at = after;
  }
  return word;
}

/**
 * Finds the nearest cell in a direction, using geometry rather than row/col
 * indices because bildkorsord grids are irregular. Cross-axis distance is
 * weighted so that we prefer staying on the same line.
 */
export function findNeighbor(
  cells: LetterCell[],
  from: LetterCell,
  rowStep: -1 | 0 | 1,
  colStep: -1 | 0 | 1,
): LetterCell | null {
  const originX = from.x + from.w / 2;
  const originY = from.y + from.h / 2;
  let best: LetterCell | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of cells) {
    if (candidate.row === from.row && candidate.col === from.col) continue;
    const dx = candidate.x + candidate.w / 2 - originX;
    const dy = candidate.y + candidate.h / 2 - originY;
    if (colStep === 1 && dx < from.w * 0.35) continue;
    if (colStep === -1 && dx > -from.w * 0.35) continue;
    if (rowStep === 1 && dy < from.h * 0.35) continue;
    if (rowStep === -1 && dy > -from.h * 0.35) continue;
    const along = colStep !== 0 ? dx * colStep : dy * rowStep;
    const cross = colStep !== 0 ? Math.abs(dy) : Math.abs(dx);
    const score = along + cross * 3;
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}
