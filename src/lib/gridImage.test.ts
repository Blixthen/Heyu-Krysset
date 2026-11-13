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

  fill(x: number, y: number, w: number, h: number, shade: number | [r: number, g: number, b: number]) {
    const [r, g, b] = typeof shade === "number" ? [shade, shade, shade] : shade;
    for (let yy = Math.max(0, y); yy < Math.min(this.height, y + h); yy += 1) {
      for (let xx = Math.max(0, x); xx < Math.min(this.width, x + w); xx += 1) {
        this.data.set([r, g, b, 255], (yy * this.width + xx) * 4);
      }
    }
  }

  paint(row: number, col: number, painter: Painter) {
    painter(this, MARGIN + col * SIZE, MARGIN + row * SIZE);
    return this;
  }

  /** Scales every channel, like a photo taken under coloured light. */
  cast(factors: [r: number, g: number, b: number]) {
    for (let at = 0; at < this.data.length; at += 4) {
      for (let channel = 0; channel < 3; channel += 1) this.data[at + channel] *= factors[channel];
    }
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
/** A letter square with a short clue in a strip along its top, ruled off by a line to the side borders. */
const strip: Painter = (page, left, top) => {
  page.fill(left, top + 10, SIZE, 1, 30);
  page.fill(left + 10, top + 4, 20, 3, 30);
};
/** A clue square with one short word near its top and no line: the word must not pass for a strip's line. */
const word: Painter = (page, left, top) => page.fill(left + 8, top + 12, 24, 2, 30);
const grey: Painter = (page, left, top) => page.fill(left + 1, top + 1, SIZE - 1, SIZE - 1, 200);
/** A letter square printed pale green, as solution words often are: darker than the paper, like the grey block. */
const green: Painter = (page, left, top) => page.fill(left + 1, top + 1, SIZE - 1, SIZE - 1, [180, 210, 206]);
/** A clue square printed pale green, a short word near the top and one near the bottom, its centre blank and no divider. */
const greenClue: Painter = (page, left, top) => {
  green(page, left, top);
  page.fill(left + 13, top + 9, 14, 2, 30);
  page.fill(left + 13, top + 29, 14, 2, 30);
};

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

/**
 * Crops `dx` px off the left and `dy` px off the top, keeping `width` px; a
 * negative `dx` adds white margin instead, and past the right side is white too.
 */
function shift(pixels: Pixels, dx: number, dy: number, width = pixels.width - dx): Pixels {
  if (dy < 0) throw new Error("shift only crops the top");
  const height = pixels.height - dy;
  const data = new Uint8ClampedArray(width * height * 4).fill(WHITE);
  for (let y = 0; y < height; y += 1) {
    for (let x = Math.max(0, -dx); x < Math.min(width, pixels.width - dx); x += 1) {
      const from = ((y + dy) * pixels.width + x + dx) * 4;
      data.set(pixels.data.subarray(from, from + 4), (y * width + x) * 4);
    }
  }
  return { width, height, data };
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
      .paint(5, 4, grey)
      .paint(6, 1, strip)
      .paint(6, 2, word);
    picture(page, 3, 4);
    whiteArea(page, 3, 5, 3);
    const kind = kinds(page.pixels());
    expect(kind(5, 0)).toBe("letter");
    expect(kind(5, 1)).toBe("other");
    expect(kind(5, 2)).toBe("marked");
    expect(kind(5, 3)).toBe("other");
    expect(kind(5, 4)).toBe("other");
    expect(kind(6, 1)).toBe("marked");
    expect(kind(6, 2)).toBe("other");
    expect(kind(1, 1)).toBe("other");
    expect(kind(1, 6)).toBe("letter");
    expect(kind(4, 6)).toBe("other");
  });

  it("reads tinted letter squares but not grey blocks, also under a warm colour cast", () => {
    for (const cast of [[1, 1, 1], [1, 0.95, 0.82]] as const) {
      const kind = kinds(new Page(20).paint(2, 3, green).paint(2, 4, grey).cast([...cast]).pixels());
      expect([kind(2, 3), kind(2, 4)], `cast ${cast.join(", ")}`).toEqual(["letter", "other"]);
    }
  });

  it("does not read a tinted clue square with a blank centre as a marked letter square", () => {
    expect(kinds(new Page(20).paint(2, 3, greenClue).pixels())(2, 3)).toBe("other");
  });

  it("does not read a neutral grey block as tinted on cream paper", () => {
    const kind = kinds(new Page(20).cast([1, 0.96, 0.86]).paint(2, 4, grey).paint(2, 3, green).pixels());
    expect([kind(2, 3), kind(2, 4)]).toEqual(["letter", "other"]);
  });

  it("reads squares cut off by the photo's bottom edge", () => {
    const croppedHeight = MARGIN + (COUNT - 1) * SIZE + Math.round(SIZE * 0.75);
    const kind = kinds(new Page(20, croppedHeight).pixels());
    expect(kind(COUNT - 1, 3)).toBe("letter");
  });

  it("reads squares cut off by the photo's left and bottom edges, also beside a block, but not a clue square there", () => {
    const croppedHeight = MARGIN + (COUNT - 1) * SIZE + Math.round(SIZE * 0.75);
    // Drop the margin and the left line, so the first column has no left border either.
    // Square (3,0) also has an unprinted right side: a grey block whose fill covers the line, as some magazines print them.
    const block: Painter = (page, left, top) => page.fill(left, top + LINE, SIZE, SIZE - LINE, 200);
    const page = new Page(20, croppedHeight).paint(COUNT - 2, 0, text).paint(3, 1, block);
    const kind = kinds(shift(page.pixels(), MARGIN + LINE + 2, 0));
    expect([kind(COUNT - 1, 0), kind(COUNT - 2, 0), kind(COUNT - 1, 1), kind(3, 0), kind(3, 1)]).toEqual([
      "letter",
      "other",
      "letter",
      "letter",
      "other",
    ]);
  });

  it("reads a square cut off by the photo's right edge beside a block", () => {
    // Square (3, last) has only its top and bottom printed: the block to its left hides that line.
    const block: Painter = (page, left, top) => page.fill(left, top + LINE, SIZE + LINE, SIZE - LINE, 200);
    const page = new Page(20).paint(3, COUNT - 2, block).paint(5, COUNT - 1, text);
    const width = MARGIN + (COUNT - 1) * SIZE + Math.round(SIZE * 0.75);
    const kind = kinds(shift(page.pixels(), 0, 0, width));
    expect([kind(3, COUNT - 1), kind(3, COUNT - 2), kind(5, COUNT - 1), kind(4, COUNT - 1)]).toEqual([
      "letter",
      "other",
      "other",
      "letter",
    ]);
  });

  it("reads a square cut off at the top beside a block, but not blank margin beside the grid", () => {
    // Cut through the first row, and widen the left margin to 0.8 of a square,
    // so the lattice adds a column there that the photo's edge seems to cut off.
    // A block in the first row hides the line to its left, so the square
    // before it is read only thanks to its cut-off top.
    const block: Painter = (page, left, top) => page.fill(left, top + LINE, SIZE + LINE, SIZE - LINE, 200);
    const grid = new Page(20).paint(0, 2, block).pixels();
    const page = shift(grid, -Math.round(SIZE * 0.8 - MARGIN), MARGIN + Math.round(SIZE * 0.25));
    const kind = kinds(page);
    // Column 0 is the margin; the grid starts at column 1.
    expect([kind(0, 0), kind(3, 0), kind(0, 1), kind(3, 1), kind(0, 2)]).toEqual(["other", "other", "letter", "letter", "letter"]);
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
