import { cellKey, isLetterCell, MAX_CELLS, MIN_CELLS, toLetterCell, type CrosswordPuzzle, type LetterCell } from "./crossword";

/**
 * Fixing the letter squares a photo reading found, before the puzzle is
 * shared: squares can be removed, and added next to the ones there are.
 * While editing, a square added above row 0 or left of column 0 has a
 * negative index; finishedCells renumbers them before sharing.
 */

/** A candidate overlapping a square already there by more than this share of its area is the same square under another index. */
const MAX_OVERLAP = 0.5;

const STEPS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
] as const;

type Axis = "row" | "col";

/** The squares grouped by their index along one axis. */
function byIndex(cells: LetterCell[], axis: Axis) {
  const groups = new Map<number, LetterCell[]>();
  for (const cell of cells) {
    const group = groups.get(cell[axis]);
    if (group) group.push(cell);
    else groups.set(cell[axis], [cell]);
  }
  return groups;
}

/**
 * Where a square goes along one axis (x and w for a column, y and h for a
 * row), at index `at`. Squares in the same column (or row) share its
 * position, so the nearest of them is used; with none, the pitch between
 * `from` and the nearest square on its line is extrapolated, since grid
 * lines are often wider apart than the squares drawn between them.
 */
function placeAlong(
  columns: Map<number, LetterCell[]>,
  rows: Map<number, LetterCell[]>,
  from: LetterCell,
  axis: Axis,
  at: number,
) {
  const across: Axis = axis === "col" ? "row" : "col";
  const sameIndex = axis === "col" ? columns : rows;
  const sameLine = axis === "col" ? rows : columns;
  const pos = (cell: LetterCell) => (axis === "col" ? { start: cell.x, size: cell.w } : { start: cell.y, size: cell.h });
  let best: LetterCell | null = null;
  for (const cell of sameIndex.get(at) ?? []) {
    if (!best || Math.abs(cell[across] - from[across]) < Math.abs(best[across] - from[across])) best = cell;
  }
  if (best) return pos(best);
  let pitch = pos(from).size;
  let nearest = Number.POSITIVE_INFINITY;
  for (const cell of sameLine.get(from[across]) ?? []) {
    const apart = cell[axis] - from[axis];
    if (apart === 0 || Math.abs(apart) >= nearest) continue;
    nearest = Math.abs(apart);
    pitch = (pos(cell).start - pos(from).start) / apart;
  }
  return { start: pos(from).start + pitch * (at - from[axis]), size: pos(from).size };
}

function overlap(a: LetterCell, b: LetterCell) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? (w * h) / (a.w * a.h) : 0;
}

/**
 * The squares bucketed by position, in buckets as big as the biggest square:
 * a square overlapping another has its centre within one bucket of the
 * other's, whatever their indices (Gemini's can be off), so finding overlaps
 * only looks at nearby squares.
 */
function byPosition(cells: LetterCell[]) {
  const size = Math.max(1, ...cells.map((cell) => Math.max(cell.w, cell.h)));
  const bucket = (cell: LetterCell) => [Math.floor((cell.x + cell.w / 2) / size), Math.floor((cell.y + cell.h / 2) / size)];
  const buckets = new Map<string, LetterCell[]>();
  for (const cell of cells) {
    const key = bucket(cell).join();
    const group = buckets.get(key);
    if (group) group.push(cell);
    else buckets.set(key, [cell]);
  }
  /** Whether a candidate covers a square already there. */
  return (cell: LetterCell) => {
    const [bx, by] = bucket(cell);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        if ((buckets.get([bx + dx, by + dy].join()) ?? []).some((other) => overlap(cell, other) > MAX_OVERLAP)) return true;
      }
    }
    return false;
  };
}

/** Inside the photo and big enough, ignoring the index, which may be negative while editing. */
function fitsPhoto(cell: LetterCell) {
  return isLetterCell({ ...cell, row: 0, col: 0 });
}

/**
 * The squares that can be added: those right above, below, left and right
 * of a square there is, plus any the reading found and the player removed,
 * so a removal can be undone. None that cover a square already there, and
 * none once the puzzle is full.
 */
export function addableCells(cells: LetterCell[], found: LetterCell[]): LetterCell[] {
  if (cells.length >= MAX_CELLS) return [];
  const columns = byIndex(cells, "col");
  const rows = byIndex(cells, "row");
  const covered = byPosition(cells);
  const taken = new Set(cells.map((cell) => cellKey(cell.row, cell.col)));
  const addable = new Map<string, LetterCell>();
  const offer = (cell: LetterCell) => {
    const key = cellKey(cell.row, cell.col);
    if (!taken.has(key) && !addable.has(key) && fitsPhoto(cell) && !covered(cell)) addable.set(key, cell);
  };
  found.forEach(offer);
  for (const from of cells) {
    for (const [rowStep, colStep] of STEPS) {
      const row = from.row + rowStep;
      const col = from.col + colStep;
      if (taken.has(cellKey(row, col))) continue;
      const x = placeAlong(columns, rows, from, "col", col);
      const y = placeAlong(columns, rows, from, "row", row);
      offer({ row, col, x: x.start, y: y.start, w: x.size, h: y.size });
    }
  }
  return [...addable.values()];
}

/** Removes the square at the cell's index if there is one, otherwise adds the cell. */
export function toggleCell(cells: LetterCell[], cell: LetterCell): LetterCell[] {
  const key = cellKey(cell.row, cell.col);
  const kept = cells.filter((other) => cellKey(other.row, other.col) !== key);
  return kept.length < cells.length ? kept : [...cells, toLetterCell(cell)];
}

/** Whether the edited squares still make a puzzle. */
export function canFinish(cells: LetterCell[]) {
  return cells.length >= MIN_CELLS && cells.length <= MAX_CELLS;
}

/**
 * The edited squares, ready to share: indices start at 0 again, and the
 * squares are in reading order, so the first one selected is top left.
 */
export function finishedCells(cells: LetterCell[]): LetterCell[] {
  const rowShift = Math.max(0, -Math.min(...cells.map((cell) => cell.row)));
  const colShift = Math.max(0, -Math.min(...cells.map((cell) => cell.col)));
  return cells
    .map((cell) => toLetterCell({ ...cell, row: cell.row + rowShift, col: cell.col + colShift }))
    .sort((a, b) => a.row - b.row || a.col - b.col);
}

/**
 * The read puzzle with its edited squares, as shared at `now`. Dated when
 * shared rather than when read, since the newest puzzle wins: one someone
 * else shared while this one was being edited mustn't win over it.
 */
export function editedPuzzle(puzzle: CrosswordPuzzle, cells: LetterCell[], now: number): CrosswordPuzzle {
  return { ...puzzle, createdAt: Math.max(now, puzzle.createdAt), cells: finishedCells(cells) };
}
