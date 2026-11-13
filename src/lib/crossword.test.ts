import { gridCells, makePuzzle } from "@/test/fixtures";
import { describe, expect, it } from "vitest";
import {
  authorsFromPayload,
  adjacentCell,
  chooseDirection,
  directionForTap,
  toggleDirection,
  dedupeCells,
  findNeighbor,
  isCellUpdate,
  isCrosswordPuzzle,
  isImageDataUrl,
  isLetterCell,
  lettersFromPayload,
  oneLetter,
  toCrosswordPuzzle,
  wordCells,
  type LetterCell,
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

describe("authorsFromPayload", () => {
  const cells = gridCells();

  it("keeps known cells with valid nicknames", () => {
    expect(authorsFromPayload({ "0-0": "Kim", "1-1": "Ann" }, cells)).toEqual({ "0-0": "Kim", "1-1": "Ann" });
  });

  it("drops unknown keys, empty or overlong nicknames and non-strings", () => {
    expect(authorsFromPayload({ "9-9": "Kim", "0-1": "", "0-2": "x".repeat(25), "1-0": 5, "1-1": "  " }, cells)).toEqual({});
  });

  it.each([null, "x", ["Kim"]])("returns {} for %j", (value) => {
    expect(authorsFromPayload(value, cells)).toEqual({});
  });
});

describe("isCellUpdate", () => {
  it("accepts an optional author but not an invalid one", () => {
    expect(isCellUpdate({ puzzleId: "p", row: 0, col: 1, value: "A", author: "Kim" })).toBe(true);
    expect(isCellUpdate({ puzzleId: "p", row: 0, col: 1, value: "A", author: "" })).toBe(false);
    expect(isCellUpdate({ puzzleId: "p", row: 0, col: 1, value: "A", author: 7 })).toBe(false);
    expect(isCellUpdate({ puzzleId: "p", row: 0, col: 1, value: "A", author: " Kim" })).toBe(false);
  });

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

describe("words", () => {
  // A down word in column 0 and column 2, an across word on row 0 and a short
  // one on row 3; (1,1) and (2,1) are clue squares, so there is a gap there.
  //   A B C
  //   D . E
  //   F . G
  //   H I
  const positions = [[0, 0], [0, 1], [0, 2], [1, 0], [1, 2], [2, 0], [2, 2], [3, 0], [3, 1]];
  const cells: LetterCell[] = positions.map(([row, col]) => ({ row, col, x: 100 + col * 100, y: 100 + row * 100, w: 90, h: 90 }));
  const at = (row: number, col: number) => cells.find((c) => c.row === row && c.col === col)!;
  const positionsOf = (word: LetterCell[]) => word.map((c) => [c.row, c.col]);

  it("finds the adjacent cell but not one across a clue square", () => {
    expect(adjacentCell(cells, at(0, 0), 1, 0)).toBe(at(1, 0));
    expect(findNeighbor(cells, at(0, 1), 1, 0)).toBe(at(3, 1));
    expect(adjacentCell(cells, at(0, 1), 1, 0)).toBeNull();
  });

  it("treats boxes drawn tighter than the grid as neighbours, but not across a clue square", () => {
    // 30-unit boxes on a 50-unit pitch, as Gemini sometimes draws them; column 2 is a clue square.
    const tight = [0, 1, 3].map((col) => ({ row: 0, col, x: 100 + col * 50, y: 100, w: 30, h: 30 }));
    expect(adjacentCell(tight, tight[0], 0, 1)).toBe(tight[1]);
    expect(adjacentCell(tight, tight[1], 0, 1)).toBeNull();
  });

  it("switches direction on a second tap only where a word runs the other way", () => {
    expect(toggleDirection(cells, at(0, 0), "across")).toBe("down");
    expect(toggleDirection(cells, at(0, 0), "down")).toBe("across");
    expect(toggleDirection(cells, at(1, 0), "down")).toBe("down");
  });

  it("chooses the direction a word runs through the selected cell", () => {
    expect(chooseDirection(cells, at(1, 0), "across")).toBe("down");
    expect(chooseDirection(cells, at(0, 1), "down")).toBe("across");
  });

  it("keeps the current direction where an across and a down word cross", () => {
    expect(chooseDirection(cells, at(0, 0), "down")).toBe("down");
    expect(chooseDirection(cells, at(0, 0), "across")).toBe("across");
  });

  it("on a tap, prefers the direction in which the cell starts a word", () => {
    // In a full 3×3 grid, (0,1) is the middle of the across word on row 0 and the start of column 1.
    const full = gridCells(3, 3);
    const middle = full.find((c) => c.row === 0 && c.col === 1)!;
    expect(directionForTap(full, middle, "across")).toBe("down");
    // (0,2) ends "A B C" and starts the down word "C E G".
    expect(directionForTap(cells, at(0, 2), "across")).toBe("down");
    // (3,0) ends the down word in column 0 and starts "H I".
    expect(directionForTap(cells, at(3, 0), "down")).toBe("across");
  });

  it("on a tap, keeps the current direction where the cell starts both words", () => {
    expect(directionForTap(cells, at(0, 0), "down")).toBe("down");
    expect(directionForTap(cells, at(0, 0), "across")).toBe("across");
  });

  it("on a tap, follows chooseDirection where the cell starts no word", () => {
    expect(directionForTap(cells, at(0, 1), "down")).toBe("across");
    expect(directionForTap(cells, at(1, 0), "across")).toBe("down");
  });

  it("keeps the current direction for a cell in no word", () => {
    const lone = { row: 9, col: 9, x: 800, y: 800, w: 90, h: 90 };
    expect(chooseDirection([...cells, lone], lone, "down")).toBe("down");
  });

  it("lists a word's cells from first to last", () => {
    expect(positionsOf(wordCells(cells, at(1, 2), "down"))).toEqual([[0, 2], [1, 2], [2, 2]]);
    expect(positionsOf(wordCells(cells, at(0, 1), "across"))).toEqual([[0, 0], [0, 1], [0, 2]]);
    expect(positionsOf(wordCells(cells, at(0, 1), "down"))).toEqual([[0, 1]]);
  });
});
