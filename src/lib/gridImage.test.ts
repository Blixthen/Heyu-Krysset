import { describe, expect, it } from "vitest";
import { classifySquares, findGrid, readGrid, separateRegions, toLetterCells, type Pixels } from "./gridImage";

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

  /** Scales each pixel's brightness by `factor(x, y)`, like a photo taken in uneven light. */
  light(factor: (x: number, y: number) => number) {
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const at = (y * this.width + x) * 4;
        for (let channel = 0; channel < 3; channel += 1) this.data[at + channel] *= factor(x, y);
      }
    }
    return this;
  }

  /** Moves everything right of `x` down by `dy` px, like a page photographed a little tilted. */
  sag(x: number, dy: number) {
    for (let y = this.height - 1; y >= dy; y -= 1) {
      for (let xx = x; xx < this.width; xx += 1) {
        const from = ((y - dy) * this.width + xx) * 4;
        this.data.copyWithin((y * this.width + xx) * 4, from, from + 4);
      }
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
/** The back page's text showing through thin newsprint: faint, unlike the print. */
const showThrough: Painter = (page, left, top) => {
  for (const y of [10, 17, 24, 31]) page.fill(left + 4, top + y, 32, 3, 205);
};
/** A pale green letter square numbered in its top-left corner, as solution squares are. */
const numbered: Painter = (page, left, top) => {
  green(page, left, top);
  page.fill(left + 5, top + 5, 5, 9, 30);
};
/** A pale green clue square with a short word along its top-left, past where a number would reach. */
const greenCornerWord: Painter = (page, left, top) => {
  green(page, left, top);
  page.fill(left + 5, top + 6, 18, 3, 30);
};
/** A square printed in a strong pink: part of a picture, not a pale solution square. */
const pink: Painter = (page, left, top) => page.fill(left + 1, top + 1, SIZE - 1, SIZE - 1, [250, 150, 150]);
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

/** Crops `dx` px off the left and `dy` px off the top; a negative `dx` adds white margin instead. */
function shift(pixels: Pixels, dx: number, dy: number): Pixels {
  const width = pixels.width - dx;
  const height = pixels.height - dy;
  const data = new Uint8ClampedArray(width * height * 4).fill(WHITE);
  for (let y = 0; y < height; y += 1) {
    for (let x = Math.max(0, -dx); x < width; x += 1) {
      const from = ((y + dy) * pixels.width + x + dx) * 4;
      data.set(pixels.data.subarray(from, from + 4), (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

/**
 * The kind of the square at each lattice square, found by position: squares
 * are placed one by one along the printed lines, so their own indices can
 * differ. "missing" where no square was placed, such as in a picture.
 */
function kinds(pixels: Pixels) {
  const grid = findGrid(pixels);
  if (!grid) throw new Error("no grid found");
  const at = kindAt(pixels);
  const middle = (lines: number[], index: number) => (lines[index] + lines[index + 1]) / 2;
  return (row: number, col: number) => at(middle(grid.columns.lines, col), middle(grid.rows.lines, row));
}

/** The kind of the square containing the pixel (x, y). */
function kindAt(pixels: Pixels) {
  const grid = findGrid(pixels);
  if (!grid) throw new Error("no grid found");
  const squares = classifySquares(pixels, grid);
  return (x: number, y: number) => {
    const square = squares.find(({ box }) => box.left <= x && x < box.right && box.top <= y && y < box.bottom);
    if (!square) return "missing";
    if (square.kind !== "letter") return "other";
    return square.marked ? "marked" : "letter";
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

  it("finds squares as small as a two-page spread photographed from further away gives", () => {
    // The grid's squares are 1/60 of the photo's width and height, past the 40 across a single page has.
    const inner = new Page(20).pixels();
    const side = SIZE * 60;
    const data = new Uint8ClampedArray(side * side * 4).fill(WHITE);
    for (let y = 0; y < inner.height; y += 1) data.set(inner.data.subarray(y * inner.width * 4, (y + 1) * inner.width * 4), y * side * 4);
    const grid = findGrid({ width: side, height: side, data });
    expect([grid?.columns.step, grid?.rows.step]).toEqual([expect.closeTo(SIZE, 0), expect.closeTo(SIZE, 0)]);
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
    // A white area without grid lines gets no square at all.
    expect(kind(4, 6)).toBe("missing");
  });

  it("reads tinted letter squares but not grey blocks, also under a warm colour cast", () => {
    for (const cast of [[1, 1, 1], [1, 0.95, 0.82]] as const) {
      const kind = kinds(new Page(20).paint(2, 3, green).paint(2, 4, grey).cast([...cast]).pixels());
      expect([kind(2, 3), kind(2, 4)], `cast ${cast.join(", ")}`).toEqual(["letter", "other"]);
    }
  });

  it("reads a numbered tinted square as a marked letter square", () => {
    expect(kinds(new Page(20).paint(2, 3, numbered).pixels())(2, 3)).toBe("marked");
  });

  it("reads a dim photo of thin paper, where the back page shows through, by the paper's own white", () => {
    const page = new Page(20).paint(2, 3, showThrough).paint(5, 1, text).paint(5, 4, grey);
    const kind = kinds(page.light(() => 0.62).pixels());
    expect([kind(2, 3), kind(2, 2), kind(5, 1), kind(5, 4)]).toEqual(["letter", "letter", "other", "other"]);
  });

  it("compares squares with the white around them in a photo lit unevenly", () => {
    // Darker towards the right, down to three quarters of the light at the left.
    const page = new Page(20).paint(3, 6, grey);
    const kind = kinds(page.light((x) => 1 - (0.25 * x) / page.width).pixels());
    expect([kind(3, 0), kind(3, 5), kind(3, 7), kind(3, 6)]).toEqual(["letter", "letter", "letter", "other"]);
  });

  it("takes the white around a square only from plain grid squares, so a picture printed in the grid can't lower it", () => {
    // A busy picture filling bordered squares, with an even, too grey patch in its middle.
    let seed = 11;
    const busy: Painter = (page, left, top) => {
      for (let y = top + LINE; y < top + SIZE; y += 1) {
        for (let x = left + LINE; x < left + SIZE; x += 1) {
          seed = (seed * 1103515245 + 12345) % 2 ** 31;
          page.fill(x, y, 1, 1, 120 + (seed % 120));
        }
      }
    };
    const page = new Page(20);
    for (let row = 2; row <= 6; row += 1) for (let col = 2; col <= 6; col += 1) page.paint(row, col, busy);
    page.paint(4, 4, (target, left, top) => target.fill(left + LINE, top + LINE, SIZE - LINE, SIZE - LINE, 205));
    expect(kinds(page.pixels())(4, 4)).toBe("other");
  });

  it("finds the borders of a page photographed a little tilted, its lines off the straight lattice", () => {
    const kind = kinds(new Page(20).sag(MARGIN + 4 * SIZE + LINE + 1, 6).pixels());
    expect([kind(3, 1), kind(3, 5), kind(3, 6)]).toEqual(["letter", "letter", "letter"]);
  });

  it("does not take broken lines a little off the lattice for borders, as text or a picture's texture would give", () => {
    const page = new Page(20);
    whiteArea(page, 3, 5, 3);
    // Dashes 5 px off where rows 4 and 5 and column 6 would have their lines, inside the white area.
    for (let x = MARGIN + 5 * SIZE + 4; x < MARGIN + 8 * SIZE - 4; x += 6) {
      for (const row of [4, 5]) page.fill(x, MARGIN + row * SIZE + 5, 4, 2, 20);
    }
    for (let y = MARGIN + 3 * SIZE + 4; y < MARGIN + 6 * SIZE - 4; y += 6) page.fill(MARGIN + 6 * SIZE + 5, y, 2, 4, 20);
    expect(kinds(page.pixels())(4, 6)).toBe("missing");
  });

  it("does not take an unbroken but wandering line off the lattice for a border, as a picture's edge can be", () => {
    const page = new Page(20);
    whiteArea(page, 3, 5, 3);
    // Zigzagging 3 px either side of 5 px off rows 4 and 5 and column 6.
    for (let step = 0; step < 3 * SIZE - 8; step += 1) {
      const wobble = [0, 3, 0, -3][Math.floor(step / 4) % 4];
      for (const row of [4, 5]) page.fill(MARGIN + 5 * SIZE + 4 + step, MARGIN + row * SIZE + 5 + wobble, 1, 2, 20);
      page.fill(MARGIN + 6 * SIZE + 5 + wobble, MARGIN + 3 * SIZE + 4 + step, 2, 1, 20);
    }
    expect(kinds(page.pixels())(4, 6)).toBe("missing");
  });

  it("does not read an even, tinted area without all four borders as a letter square, as a wall in a picture is", () => {
    const page = new Page(20).paint(2, 3, green);
    // No left border, as where the grid lines end at a picture's frame.
    page.fill(MARGIN + 3 * SIZE, MARGIN + 2 * SIZE + LINE, LINE, SIZE - LINE, [180, 210, 206]);
    expect(kinds(page.pixels())(2, 3)).toBe("other");
  });

  it("does not read a tinted clue square with a word in one corner, nor a strongly coloured square, as a letter square", () => {
    const kind = kinds(new Page(20).paint(2, 3, greenCornerWord).paint(4, 5, pink).pixels());
    expect([kind(2, 3), kind(4, 5)]).toEqual(["other", "other"]);
  });

  it("keeps grey blocks out however many surround a square, if one plain grid square near it is white", () => {
    const page = new Page(20);
    for (let row = 2; row <= 6; row += 1) for (let col = 2; col <= 6; col += 1) if (!(row === 2 && col === 2)) page.paint(row, col, grey);
    expect(kinds(page.pixels())(4, 4)).toBe("other");
  });

  it("finds the paper's white on a page photographed small on a dark table", () => {
    const page = new Page(20).paint(2, 3, grey);
    const inner = page.pixels();
    const scale = 4;
    const width = inner.width * scale;
    const height = inner.height * scale;
    const data = new Uint8ClampedArray(width * height * 4).fill(60);
    for (let y = 0; y < inner.height; y += 1) data.set(inner.data.subarray(y * inner.width * 4, (y + 1) * inner.width * 4), ((y + inner.height) * width + inner.width) * 4);
    // The page's edge against the table can add a row and column to the lattice, so squares are found by where they are.
    const kind = kindAt({ width, height, data });
    const centre = (row: number, col: number) => [inner.width + MARGIN + (col + 0.5) * SIZE, inner.height + MARGIN + (row + 0.5) * SIZE] as const;
    expect([kind(...centre(2, 3)), kind(...centre(2, 4))]).toEqual(["other", "letter"]);
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

  it("does not read blank margin beside a grid cut off at the top as a letter square", () => {
    // Cut through the first row, and widen the left margin to 0.8 of a square,
    // so the lattice adds a column there that the photo's edge seems to cut off.
    const page = shift(new Page(20).pixels(), -Math.round(SIZE * 0.8 - MARGIN), MARGIN + Math.round(SIZE * 0.25));
    const kind = kinds(page);
    // Column 0 is the margin; the grid starts at column 1. Its corner, cut off
    // at the top and lined on two sides, is placed but isn't a letter square.
    expect([kind(0, 0), kind(3, 0), kind(0, 1), kind(3, 1)]).toEqual(["other", "missing", "letter", "letter"]);
  });
});

describe("toLetterCells", () => {
  it("gives letter squares in 0–1000 coordinates", () => {
    const pixels = new Page(20).paint(0, 1, text).pixels();
    const grid = findGrid(pixels)!;
    const cells = toLetterCells(pixels, classifySquares(pixels, grid));
    expect(cells).toHaveLength(COUNT * COUNT - 1);
    expect(cells[0]).toEqual({ row: 0, col: 0, x: 56, y: 56, w: 111, h: 111 });
  });
});

describe("separateRegions", () => {
  const square = (row: number, col: number) => ({ row, col, box: { left: col, top: row, right: col + 1, bottom: row + 1 }, cut: { left: false, top: false, right: false, bottom: false } });
  const region = (seed: { row: number; col: number }, squares: [number, number][]) => ({
    seed,
    squares: new Map(squares.map(([row, col]) => [`${row},${col}`, square(row, col)])),
  });

  it("numbers each region from its seed's lattice square, from 0", () => {
    const placed = separateRegions([region({ row: 2, col: 3 }, [[0, 0], [0, 1], [-1, 0]])]);
    expect(placed.map(({ row, col }) => [row, col])).toEqual([[1, 0], [1, 1], [0, 0]]);
  });

  it("moves a region whose numbers would collide with an earlier one's past its columns", () => {
    const placed = separateRegions([region({ row: 0, col: 0 }, [[0, 0], [0, 1]]), region({ row: 0, col: 1 }, [[0, 0], [0, 1]])]);
    expect(placed.map(({ row, col }) => `${row},${col}`)).toEqual(["0,0", "0,1", "0,2", "0,3"]);
  });
});

describe("readGrid", () => {
  it("reads every letter square of a grid", () => {
    const cells = readGrid(new Page(20).paint(0, 1, text).paint(2, 2, grey).pixels());
    expect(cells).toHaveLength(COUNT * COUNT - 2);
    expect(cells?.[0]).toEqual({ row: 0, col: 0, x: 56, y: 56, w: 111, h: 111 });
  });

  it("reads both pages of a spread whose grids don't line up, which one straight lattice can't", () => {
    // Everything right of column 4's left line moves down half a square, as the right page of a spread can.
    const cells = readGrid(new Page(20).sag(MARGIN + 4 * SIZE + LINE + 1, SIZE / 2).pixels());
    expect(cells).toHaveLength(COUNT * COUNT);
    // Each row of the right page sits on its own lines, half a square below the left page's.
    const tops = (right: boolean) => [...new Set(cells?.filter((cell) => cell.x > 480 === right).map((cell) => cell.y))].sort((a, b) => a - b);
    const thousandths = (px: number) => (px * 1000) / (MARGIN * 2 + COUNT * SIZE);
    // A square's edge may sit on either side of its line, LINE px wide.
    for (const [row, top] of tops(true).entries()) {
      expect(Math.abs(top - tops(false)[row] - thousandths(SIZE / 2)), `row ${row}`).toBeLessThanOrEqual(thousandths(2 * LINE));
    }
  });

  it("places the squares beside a column the photo's left edge cut short on their own lines", () => {
    // Column 0 keeps 70% of its width, so its box is narrower than the squares beside it.
    const cells = readGrid(shift(new Page(20).pixels(), MARGIN + LINE + Math.round(SIZE * 0.3), 0)) ?? [];
    const widths = cells.filter((cell) => cell.x > 0).map((cell) => cell.w);
    expect(widths.length).toBeGreaterThan(40);
    for (const width of widths) expect(width * (MARGIN + COUNT * SIZE + LINE - Math.round(SIZE * 0.3) - LINE) / 1000).toBeCloseTo(SIZE - LINE, -1);
  });

  it("keeps the squares of a row the photo's top edge cut off their size, despite a line near a side", () => {
    // Row 0 keeps 70% of its height; square (0,3) has a line 7 px inside its right side, near enough to snap to.
    const page = new Page(20).paint(0, 3, (p, left, top) => p.fill(left + SIZE - 7, top, LINE, SIZE, 20));
    const cells = readGrid(shift(page.pixels(), 0, MARGIN + Math.round(SIZE * 0.3))) ?? [];
    const top = cells.filter((cell) => cell.y === 0);
    expect(top.length).toBe(COUNT);
    const width = Math.round(((SIZE - LINE) * 1000) / (MARGIN * 2 + COUNT * SIZE));
    for (const cell of top) expect(Math.abs(cell.w - width), `square at ${cell.x}`).toBeLessThanOrEqual(10);
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
