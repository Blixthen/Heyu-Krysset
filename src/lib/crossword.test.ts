import { gridCells, makePuzzle } from "@/test/fixtures";
import { describe, expect, it } from "vitest";
import {
  dedupeCells,
  findNeighbor,
  isCellUpdate,
  isCrosswordPuzzle,
  isImageDataUrl,
  isLetterCell,
  lettersFromPayload,
  oneLetter,
  toCrosswordPuzzle,
} from "./crossword";

const cell = { row: 0, col: 0, x: 10, y: 10, w: 50, h: 50 };

describe("isLetterCell", () => {
  it("accepts a well-formed cell", () => {
    expect(isLetterCell(cell)).toBe(true);
  });

  it.each([
    ["negative row", { ...cell, row: -1 }],
    ["fractional col", { ...cell, col: 1.5 }],
    ["string coordinate", { ...cell, x: "10" }],
    ["NaN", { ...cell, y: Number.NaN }],
    ["too small", { ...cell, w: 3 }],
    ["overflows right edge", { ...cell, x: 980, w: 50 }],
    ["overflows bottom edge", { ...cell, y: 990, h: 20 }],
    ["null", null],
  ])("rejects %s", (_name, value) => {
    expect(isLetterCell(value)).toBe(false);
  });
});

describe("dedupeCells", () => {
  it("keeps the first cell for each row/col and strips extra fields", () => {
    const cells = [
      { ...cell, extra: "x" },
      { ...cell, x: 500 },
      { ...cell, col: 1 },
    ];
    expect(dedupeCells(cells)).toEqual([cell, { ...cell, col: 1 }]);
  });
});

describe("oneLetter", () => {
  it("returns the last letter, upper-cased with Swedish rules", () => {
    expect(oneLetter("aö")).toBe("Ö");
    expect(oneLetter("å1!")).toBe("Å");
  });

  it("returns an empty string when there is no letter", () => {
    expect(oneLetter("12 ?")).toBe("");
    expect(oneLetter("")).toBe("");
  });
});

describe("isImageDataUrl", () => {
  it("accepts base64 jpeg, png and webp", () => {
    expect(isImageDataUrl("data:image/png;base64,AAAA")).toBe(true);
  });

  it("rejects svg and non-base64 payloads", () => {
    expect(isImageDataUrl("data:image/svg+xml;base64,AAAA")).toBe(false);
    expect(isImageDataUrl("data:image/png;base64,<script>")).toBe(false);
    expect(isImageDataUrl("https://example.com/a.png")).toBe(false);
  });
});

describe("isCrosswordPuzzle", () => {
  it("accepts a valid puzzle", () => {
    expect(isCrosswordPuzzle(makePuzzle())).toBe(true);
  });

  it.each([
    ["missing id", { id: "" }],
    ["non-numeric createdAt", { createdAt: "now" }],
    ["non-image data URL", { image: "data:text/html;base64,AAAA" }],
    ["too few cells", { cells: gridCells(2, 2) }],
    ["invalid cell", { cells: [...gridCells().slice(1), { row: 0 }] }],
    ["duplicate cells", { cells: [...gridCells(), gridCells()[0]] }],
  ])("rejects %s", (_name, overrides) => {
    expect(isCrosswordPuzzle({ ...makePuzzle(), ...overrides })).toBe(false);
  });

  it("toCrosswordPuzzle drops unknown fields", () => {
    const puzzle = makePuzzle();
    const dirty = { ...puzzle, evil: true, cells: puzzle.cells.map((c) => ({ ...c, evil: true })) };
    expect(toCrosswordPuzzle(dirty)).toEqual(puzzle);
  });
});

describe("lettersFromPayload", () => {
  const cells = gridCells();

  it("keeps known cells and normalizes letters", () => {
    expect(lettersFromPayload({ "0-0": "a", "1-1": "bc" }, cells)).toEqual({ "0-0": "A", "1-1": "C" });
  });

  it("drops unknown keys and non-string values", () => {
    expect(lettersFromPayload({ "9-9": "A", "0-1": 5, __proto__: "x" }, cells)).toEqual({});
  });

  it.each([null, "x", ["A"]])("returns {} for %j", (value) => {
    expect(lettersFromPayload(value, cells)).toEqual({});
  });
});

describe("isCellUpdate", () => {
  it("requires a puzzle id and bounded value", () => {
    expect(isCellUpdate({ puzzleId: "p", row: 0, col: 1, value: "A" })).toBe(true);
    expect(isCellUpdate({ row: 0, col: 1, value: "A" })).toBe(false);
    expect(isCellUpdate({ puzzleId: "p", row: 0, col: 1, value: "A".repeat(100) })).toBe(false);
  });
});

describe("findNeighbor", () => {
  const cells = gridCells();
  const at = (row: number, col: number) => cells.find((c) => c.row === row && c.col === col)!;

  it("moves one cell in each direction", () => {
    expect(findNeighbor(cells, at(1, 1), 0, 1)).toMatchObject({ row: 1, col: 2 });
    expect(findNeighbor(cells, at(1, 1), 0, -1)).toMatchObject({ row: 1, col: 0 });
    expect(findNeighbor(cells, at(1, 1), 1, 0)).toMatchObject({ row: 2, col: 1 });
    expect(findNeighbor(cells, at(1, 1), -1, 0)).toMatchObject({ row: 0, col: 1 });
  });

  it("returns null at the edge", () => {
    expect(findNeighbor(cells, at(0, 2), 0, 1)).toBeNull();
  });

  it("prefers the same line over a closer diagonal cell", () => {
    const from = { row: 0, col: 0, x: 0, y: 0, w: 50, h: 50 };
    const sameLine = { row: 0, col: 1, x: 200, y: 0, w: 50, h: 50 };
    const diagonal = { row: 1, col: 1, x: 60, y: 60, w: 50, h: 50 };
    expect(findNeighbor([from, sameLine, diagonal], from, 0, 1)).toBe(sameLine);
  });
});
