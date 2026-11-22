import { readGrid } from "@/lib/gridImage";
import { gridCells } from "@/test/fixtures";
import jpeg from "jpeg-js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { jpegSize, renderOverlay } from "./overlay";
import { CROSSWORD_PHOTOS, findProblems, photoPath, type CrosswordPhoto } from "./photos";

/** Gitignored; each run draws the readings here for checking new thresholds by eye. */
const OVERLAY_DIRECTORY = new URL("./overlays/", import.meta.url);

const photo = (minCells: number, points: Partial<CrosswordPhoto> = {}): CrosswordPhoto => ({
  name: "test",
  description: "test",
  minCells,
  letterPoints: [],
  cluePoints: [],
  ...points,
});

describe("findProblems", () => {
  const cells = gridCells(3, 4);

  it("accepts a clean grid", () => {
    expect(findProblems(photo(12), cells)).toEqual([]);
  });

  it("flags too few squares", () => {
    expect(findProblems(photo(13), cells)).toEqual(["found 12 letter squares, expected at least 13"]);
  });

  it("flags one square read twice", () => {
    const twice = [...cells, { ...cells[0], row: 9, col: 9, x: cells[0].x + 10 }];
    expect(findProblems(photo(1), twice)).toContain("cells (0,0) and (9,9) overlap");
  });

  it("flags a labelled letter square that no cell covers", () => {
    // gridCells covers 100–190 and 200–290 …; 195 falls in the gap between two cells.
    expect(findProblems(photo(1, { letterPoints: [[145, 145], [195, 145]] }), cells)).toEqual([
      "letter square at (195, 145) not found",
    ]);
  });

  it("flags a labelled clue area that a cell covers", () => {
    expect(findProblems(photo(1, { cluePoints: [[50, 50], [245, 345]] }), cells)).toEqual([
      "clue area at (245, 345) read as letter square (2,1)",
    ]);
  });
});

describe("jpegSize", () => {
  // SOI, an APP0 segment, then SOF0 for 300×200.
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0xc8, 0x01, 0x2c, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01];
  const app0 = [0xff, 0xe0, 0x00, 0x04, 0x00, 0x00];

  it("reads the size from the start-of-frame marker", () => {
    expect(jpegSize(Uint8Array.from([0xff, 0xd8, ...app0, ...sof]))).toEqual({ width: 300, height: 200 });
  });

  it("skips 0xFF fill bytes and standalone markers before it", () => {
    const padded = [0xff, 0xd8, ...app0, 0xff, 0xff, 0xff, 0xd0, ...sof];
    expect(jpegSize(Uint8Array.from(padded))).toEqual({ width: 300, height: 200 });
  });

  it("reads the real photos", () => {
    expect(jpegSize(readFileSync(photoPath(CROSSWORD_PHOTOS[0])))).toEqual({ width: 1080, height: 1432 });
  });
});

describe.each(CROSSWORD_PHOTOS)("crossword photo $name ($description)", (crossword) => {
  it("has labelled points inside the image", () => {
    const points = [...crossword.letterPoints, ...crossword.cluePoints];
    expect(points.length).toBeGreaterThanOrEqual(10);
    for (const [x, y] of points) expect([x, y].every((value) => value >= 0 && value <= 1000)).toBe(true);
  });

  it("is read by the image reading with exactly its known problems (most have none)", () => {
    const bytes = readFileSync(photoPath(crossword));
    const cells = readGrid(jpeg.decode(bytes, { useTArray: true }));

    mkdirSync(OVERLAY_DIRECTORY, { recursive: true });
    const image = { base64: bytes.toString("base64"), ...jpegSize(bytes) };
    writeFileSync(new URL(`${crossword.name}.svg`, OVERLAY_DIRECTORY), renderOverlay(crossword, image, cells ?? []));

    expect(cells, "no usable grid found").not.toBeNull();
    expect(findProblems(crossword, cells ?? [])).toEqual(crossword.knownGridProblems ?? []);
  });
});
