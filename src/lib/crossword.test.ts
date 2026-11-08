import { describe, expect, it } from "vitest";
import { dedupeCells, isLetterCell } from "./crossword";

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
