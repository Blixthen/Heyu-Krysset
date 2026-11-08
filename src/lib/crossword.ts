/**
 * Shared crossword types and validators.
 * Coordinates are on a 0–1000 scale relative to the full image.
 */

export type LetterCell = {
  row: number;
  col: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

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
