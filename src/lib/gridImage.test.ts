import { describe, expect, it } from "vitest";
import { classifySquares, findGrid, readGrid, toLetterCells, type Pixels } from "./gridImage";

/** A synthetic bildkorsord page: 8×8 squares of SIZE px with a MARGIN, lines LINE px wide. */
const SIZE = 40;
const MARGIN = 20;
const LINE = 2;
const COUNT = 8;
const WHITE = 245;

type Painter = (page: Page, left: number, top: number) => void;

class Page {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;

  constructor(lineShade: number, height = MARGIN * 2 + COUNT * SIZE) {
    this.width = MARGIN * 2 + COUNT * SIZE;
    this.height = height;
    this.data = new Uint8ClampedArray(this.width * this.height * 4).fill(WHITE);
    for (let k = 0; k <= COUNT; k += 1) {
      const at = MARGIN + k * SIZE;
      this.fill(at, MARGIN, LINE, COUNT * SIZE, lineShade);
      this.fill(MARGIN, at, COUNT * SIZE + LINE, LINE, lineShade);
    }
  }

  fill(x: number, y: number, w: number, h: number, shade: number) {
    for (let yy = Math.max(0, y); yy < Math.min(this.height, y + h); yy += 1) {
      for (let xx = Math.max(0, x); xx < Math.min(this.width, x + w); xx += 1) {
        this.data.set([shade, shade, shade, 255], (yy * this.width + xx) * 4);
      }
    }
  }

  paint(row: number, col: number, painter: Painter) {
    painter(this, MARGIN + col * SIZE, MARGIN + row * SIZE);
    return this;
  }

  pixels(): Pixels {
    return { width: this.width, height: this.height, data: this.data };
  }
}

/** Three lines of clue text across the middle. */
const text: Painter = (page, left, top) => {
  for (const y of [12, 18, 24]) page.fill(left + 8, top + y, 24, 3, 30);
};
/** A start arrow in the top-left corner. */
const arrow: Painter = (page, left, top) => {
  page.fill(left + 5, top + 5, 2, 8, 30);
  page.fill(left + 5, top + 12, 7, 2, 30);
};
/** A clue square split by a thin, light divider, one short word above and one below: its centre is otherwise blank. */
const split: Painter = (page, left, top) => {
  page.fill(left, top + 20, SIZE, 1, 190);
  page.fill(left + 13, top + 7, 14, 2, 30);
  page.fill(left + 13, top + 32, 14, 2, 30);
};
const grey: Painter = (page, left, top) => page.fill(left + 1, top + 1, SIZE - 1, SIZE - 1, 200);

/** A plain white area of a photograph (like a wall) over a block of squares: blank, but no grid lines. */
function whiteArea(page: Page, row: number, col: number, size: number) {
  page.fill(MARGIN + col * SIZE + LINE, MARGIN + row * SIZE + LINE, size * SIZE - LINE, size * SIZE - LINE, WHITE);
}

/** A photograph over a block of squares: busy pixels and no grid lines. */
function picture(page: Page, rows: number, cols: number) {
  let seed = 7;
  for (let y = MARGIN + 1; y < MARGIN + rows * SIZE; y += 1) {
    for (let x = MARGIN + 1; x < MARGIN + cols * SIZE; x += 1) {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      page.fill(x, y, 1, 1, 120 + (seed % 120));
    }
  }
}

function kinds(pixels: Pixels) {
  const grid = findGrid(pixels);
  if (!grid) throw new Error("no grid found");
  const squares = classifySquares(pixels, grid);
  return (row: number, col: number) => {
    const square = squares.find((candidate) => candidate.row === row && candidate.col === col);
    if (!square) return "missing";
    return square.kind === "letter" ? (square.marked ? "marked" : "letter") : "other";
  };
}

describe("findGrid", () => {
  it.each([
    ["black", 20],
    ["light grey", 165],
  ])("finds every line of a grid printed in %s", (_name, shade) => {
    const grid = findGrid(new Page(shade).pixels());
    const expected = Array.from({ length: COUNT + 1 }, (_, k) => MARGIN + k * SIZE);
    expect(grid?.columns.lines.map(Math.round)).toEqual(expected.map((at) => expect.closeTo(at, 0)));
    expect(grid?.rows.lines).toHaveLength(COUNT + 1);
    expect(grid?.rows.step).toBeCloseTo(SIZE, 0);
  });

  it("keeps the line spacing despite a picture over part of the grid", () => {
    const page = new Page(20);
    picture(page, 3, 4);
    expect(findGrid(page.pixels())?.columns.step).toBeCloseTo(SIZE, 0);
  });

  it("returns null for a page without a grid", () => {
    const blank = { width: 200, height: 200, data: new Uint8ClampedArray(200 * 200 * 4).fill(WHITE) };
    expect(findGrid(blank)).toBeNull();
  });
});

describe("classifySquares", () => {
  it("tells letter squares from clues, blocks and pictures", () => {
    const page = new Page(20)
      .paint(5, 1, text)
      .paint(5, 2, arrow)
      .paint(5, 3, split)
      .paint(5, 4, grey);
    picture(page, 3, 4);
    whiteArea(page, 3, 5, 3);
    const kind = kinds(page.pixels());
    expect(kind(5, 0)).toBe("letter");
    expect(kind(5, 1)).toBe("other");
    expect(kind(5, 2)).toBe("marked");
    expect(kind(5, 3)).toBe("other");
    expect(kind(5, 4)).toBe("other");
    expect(kind(1, 1)).toBe("other");
    expect(kind(1, 6)).toBe("letter");
    expect(kind(4, 6)).toBe("other");
  });

  it("reads squares cut off by the photo's bottom edge", () => {
    const croppedHeight = MARGIN + (COUNT - 1) * SIZE + Math.round(SIZE * 0.75);
    const kind = kinds(new Page(20, croppedHeight).pixels());
    expect(kind(COUNT - 1, 3)).toBe("letter");
  });
});

describe("toLetterCells", () => {
  it("gives letter squares in 0–1000 coordinates", () => {
    const pixels = new Page(20).paint(0, 1, text).pixels();
    const grid = findGrid(pixels)!;
    const cells = toLetterCells(pixels, grid, classifySquares(pixels, grid));
    expect(cells).toHaveLength(COUNT * COUNT - 1);
    expect(cells[0]).toEqual({ row: 0, col: 0, x: 56, y: 56, w: 111, h: 111 });
  });
});

describe("readGrid", () => {
  it("reads every letter square of a grid", () => {
    const cells = readGrid(new Page(20).paint(0, 1, text).paint(2, 2, grey).pixels());
    expect(cells).toHaveLength(COUNT * COUNT - 2);
    expect(cells?.[0]).toEqual({ row: 0, col: 0, x: 56, y: 56, w: 111, h: 111 });
  });

  it("returns null for a page without a grid", () => {
    expect(readGrid({ width: 200, height: 200, data: new Uint8ClampedArray(200 * 200 * 4).fill(WHITE) })).toBeNull();
  });

  it("returns null when too few squares are blank to be a crossword", () => {
    const page = new Page(20);
    for (let row = 0; row < COUNT; row += 1) {
      for (let col = 0; col < COUNT; col += 1) if (row > 0 || col > 6) page.paint(row, col, text);
    }
    expect(readGrid(page.pixels())).toBeNull();
  });
});
