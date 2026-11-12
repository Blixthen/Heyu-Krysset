import { interpretReply, parseAnalyzeRequest } from "@/lib/analyze";
import { gridCells } from "@/test/fixtures";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CROSSWORD_PHOTOS,
  findProblems,
  readPhotoBase64,
  replyPath,
  type CrosswordPhoto,
  type RecordedReply,
} from "./photos";

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

describe.each(CROSSWORD_PHOTOS)("crossword photo $name ($description)", (crossword) => {
  it("has labelled points inside the image", () => {
    const points = [...crossword.letterPoints, ...crossword.cluePoints];
    expect(points.length).toBeGreaterThanOrEqual(10);
    for (const [x, y] of points) expect([x, y].every((value) => value >= 0 && value <= 1000)).toBe(true);
  });

  it("is accepted as an upload", () => {
    const input = parseAnalyzeRequest({ image: readPhotoBase64(crossword), mimeType: "image/jpeg" });
    expect(input.ok).toBe(true);
  });

  // Separate from the replay, which may be an expected failure: a missing
  // recording must always fail.
  it("has a recorded Gemini reply", () => {
    expect(existsSync(replyPath(crossword)), "no recorded reply; run `pnpm eval:record`").toBe(true);
  });

  // A reading with a known issue is expected to fail, so CI turns red once a
  // prompt or model change fixes it and the knownIssue can be removed.
  (crossword.knownIssue ? it.fails : it)(`replays its recorded Gemini reply into a usable grid${crossword.knownIssue ? ` (known issue: ${crossword.knownIssue})` : ""}`, () => {
    const recorded = JSON.parse(readFileSync(replyPath(crossword), "utf8")) as RecordedReply;
    expect(typeof recorded.reply.text).toBe("string");

    const result = interpretReply(recorded.reply);
    expect(result, `recorded with ${recorded.model}`).toMatchObject({ ok: true });
    if (result.ok) expect(findProblems(crossword, result.value)).toEqual([]);
  });
});
