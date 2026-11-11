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

/** Reads a letters map from a peer, keeping only keys that exist in the puzzle. */
export function lettersFromPayload(value: unknown, cells: LetterCell[]): Letters {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const valid = new Set(cells.map((cell) => cellKey(cell.row, cell.col)));
  const letters: Letters = {};
  for (const [key, letter] of Object.entries(value)) {
    if (valid.has(key) && typeof letter === "string") letters[key] = oneLetter(letter);
  }
  return letters;
}

export type CellUpdate = { puzzleId: string; row: number; col: number; value: string };

export function isCellUpdate(value: unknown): value is CellUpdate {
  if (!value || typeof value !== "object") return false;
  const update = value as Partial<Record<keyof CellUpdate, unknown>>;
  return (
    typeof update.puzzleId === "string" &&
    isIndex(update.row) &&
    isIndex(update.col) &&
    typeof update.value === "string" &&
    update.value.length <= 8
  );
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
