import { gridCells, makePuzzle } from "@/test/fixtures";
import { describe, expect, it } from "vitest";
import { addableCells, canFinish, editedPuzzle, finishedCells, toggleCell } from "./cellEditing";
import { cellKey, MAX_CELLS, MIN_CELLS, type LetterCell } from "./crossword";

const keys = (cells: LetterCell[]) => cells.map((cell) => cellKey(cell.row, cell.col)).sort();
const at = (cells: LetterCell[], row: number, col: number) => cells.find((cell) => cell.row === row && cell.col === col);

describe("addableCells", () => {
  it("offers the squares right around the ones there are, on the same lattice", () => {
    // Squares 90 wide on a 100 pitch, from (100, 100).
    const cells = gridCells(2, 2);
    const addable = addableCells(cells, cells);
    expect(keys(addable)).toEqual(["-1-0", "-1-1", "0--1", "0-2", "1--1", "1-2", "2-0", "2-1"]);
    expect(at(addable, 0, 2)).toEqual({ row: 0, col: 2, x: 300, y: 100, w: 90, h: 90 });
    expect(at(addable, 2, 1)).toEqual({ row: 2, col: 1, x: 200, y: 300, w: 90, h: 90 });
    expect(at(addable, -1, 0)).toEqual({ row: -1, col: 0, x: 100, y: 0, w: 90, h: 90 });
  });

  it("lines a new square up with the others in its row and column", () => {
    // Row 1 has its own height, and column 3 is set apart from column 2.
    const cells: LetterCell[] = [
      { row: 0, col: 2, x: 200, y: 100, w: 50, h: 50 },
      { row: 1, col: 2, x: 200, y: 160, w: 50, h: 70 },
      { row: 0, col: 3, x: 270, y: 100, w: 40, h: 50 },
      { row: 0, col: 5, x: 400, y: 100, w: 50, h: 50 },
    ];
    expect(at(addableCells(cells, cells), 1, 3)).toEqual({ row: 1, col: 3, x: 270, y: 160, w: 40, h: 70 });
  });

  it("leaves out squares outside the photo and squares already covered under another index", () => {
    const cells: LetterCell[] = [
      { row: 0, col: 0, x: 0, y: 0, w: 100, h: 100 },
      { row: 0, col: 1, x: 100, y: 0, w: 100, h: 100 },
      // An irregular index from Gemini: right where (1, 0) would go.
      { row: 4, col: 0, x: 10, y: 100, w: 100, h: 100 },
    ];
    const addable = keys(addableCells(cells, cells));
    expect(addable).not.toContain("-1-0");
    expect(addable).not.toContain("0--1");
    expect(addable).not.toContain("1-0");
    expect(addable).toContain("1-1");
  });

  it("offers a removed square again, even with nothing left beside it", () => {
    const found = gridCells(1, 3);
    const lone = { row: 9, col: 9, x: 800, y: 800, w: 50, h: 50 };
    const addable = addableCells(found, [...found, lone]);
    expect(at(addable, 9, 9)).toEqual(lone);
    expect(at(addableCells([...found, lone], [...found, lone]), 9, 9)).toBeUndefined();
  });

  it("doesn't offer a removed square back on top of one added in its place", () => {
    const top = gridCells(1, 3);
    // Misnumbered by Gemini: it sits where (1, 0) belongs.
    const stray = { row: 4, col: 0, x: 100, y: 200, w: 90, h: 90 };
    const added = toggleCell(top, at(addableCells(top, [...top, stray]), 1, 0) as LetterCell);
    expect(at(addableCells(top, [...top, stray]), 4, 0)).toEqual(stray);
    expect(at(addableCells(added, [...top, stray]), 4, 0)).toBeUndefined();
  });

  it("finds overlaps between squares far apart in index on a full-size grid quickly", () => {
    const cells = Array.from({ length: 1900 }, (_, index) => ({ row: Math.floor(index / 50), col: index % 50, x: (index % 50) * 20, y: Math.floor(index / 50) * 20, w: 18, h: 18 }));
    const started = performance.now();
    expect(addableCells(cells, cells).length).toBeGreaterThan(0);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("offers nothing once the puzzle is full", () => {
    const full = Array.from({ length: MAX_CELLS }, (_, index) => ({ row: index, col: 0, x: 0, y: 0, w: 5, h: 5 }));
    expect(addableCells(full, [])).toEqual([]);
    expect(addableCells(full.slice(1), []).length).toBeGreaterThan(0);
  });
});

describe("toggleCell", () => {
  it("removes a square that is there and adds one that isn't", () => {
    const cells = gridCells(1, 3);
    const removed = toggleCell(cells, { ...cells[1], x: 999 });
    expect(keys(removed)).toEqual(["0-0", "0-2"]);
    const added = toggleCell(removed, { ...cells[1], extra: true } as LetterCell);
    expect(added.at(-1)).toEqual(cells[1]);
  });
});

describe("canFinish", () => {
  it("needs as many squares as a puzzle", () => {
    expect(canFinish(gridCells(1, MIN_CELLS))).toBe(true);
    expect(canFinish(gridCells(1, MIN_CELLS - 1))).toBe(false);
  });
});

describe("finishedCells", () => {
  it("numbers from 0 again and puts the squares in reading order", () => {
    const cells: LetterCell[] = [
      { row: 1, col: 0, x: 100, y: 200, w: 90, h: 90 },
      { row: -1, col: 1, x: 200, y: 0, w: 90, h: 90 },
      { row: 0, col: -2, x: 0, y: 100, w: 90, h: 90 },
    ];
    expect(finishedCells(cells)).toEqual([
      { row: 0, col: 3, x: 200, y: 0, w: 90, h: 90 },
      { row: 1, col: 0, x: 0, y: 100, w: 90, h: 90 },
      { row: 2, col: 2, x: 100, y: 200, w: 90, h: 90 },
    ]);
  });

  it("keeps indices that already start at 0 or later", () => {
    const cells = [{ row: 3, col: 2, x: 0, y: 0, w: 90, h: 90 }];
    expect(finishedCells(cells)).toEqual(cells);
  });
});

describe("editedPuzzle", () => {
  it("shares the edited squares, dated now", () => {
    const read = makePuzzle({ createdAt: 1_000 });
    const cells = [...gridCells(1, 8), { row: -1, col: 0, x: 100, y: 0, w: 90, h: 90 }];
    expect(editedPuzzle(read, cells, 5_000)).toEqual({ ...read, createdAt: 5_000, cells: finishedCells(cells) });
  });

  it("is never older than when it was read, even with the clock set back", () => {
    expect(editedPuzzle(makePuzzle({ createdAt: 9_000 }), gridCells(), 5_000).createdAt).toBe(9_000);
  });
});
