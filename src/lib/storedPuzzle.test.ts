import { makePuzzle } from "@/test/fixtures";
import { describe, expect, it } from "vitest";
import { checkPuzzleUpload, compareStored, puzzleKey, puzzlePath, puzzleUrl, restartedPuzzle, safeNextPath } from "./storedPuzzle";

const ID = "3f2c1a9e-8b4d-4c6e-9a1b-2d3e4f5a6b7c";

describe("puzzle paths", () => {
  it("place a puzzle under its link, the API and the bucket", () => {
    expect([puzzlePath(ID), puzzleUrl(ID), puzzleKey(ID)]).toEqual([`/p/${ID}`, `/api/puzzle/${ID}`, `puzzles/${ID}.json`]);
  });
});

describe("checkPuzzleUpload", () => {
  it("accepts a valid puzzle with a random id, dropping unknown fields", () => {
    const puzzle = makePuzzle({ id: ID, photo: "9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d" });
    expect(checkPuzzleUpload({ ...puzzle, evil: true })).toEqual({ ok: true, value: puzzle });
  });

  it.each([
    ["an id that isn't random", makePuzzle({ id: "puzzle-1" })],
    ["an invalid puzzle", { ...makePuzzle({ id: ID }), cells: [] }],
    ["nothing", null],
  ])("rejects %s", (_name, value) => {
    expect(checkPuzzleUpload(value)).toMatchObject({ ok: false, error: { status: 400 } });
  });
});

describe("safeNextPath", () => {
  it("keeps a puzzle link", () => {
    expect(safeNextPath(`/p/${ID}`)).toBe(`/p/${ID}`);
  });

  it.each(["/", "//evil.example", "https://evil.example/p/x", `/p/${ID}/../../admin`, `/p/${ID}?x=1`, "/p/", "/login", null, 7])(
    "sends %j home",
    (value) => {
      expect(safeNextPath(value)).toBe("/");
    },
  );
});

describe("compareStored", () => {
  const stored = makePuzzle({ id: ID });
  const PHOTO = "9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

  it("lets a second save fill in the photo and nothing else", () => {
    expect(compareStored(stored, { ...stored, photo: PHOTO })).toBe("adds-photo");
    expect(compareStored(stored, stored)).toBe("same");
    expect(compareStored({ ...stored, photo: PHOTO }, stored)).toBe("same");
    expect(compareStored({ ...stored, photo: PHOTO }, { ...stored, photo: PHOTO })).toBe("same");
  });

  it.each([
    ["another photo", { photo: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d" }],
    ["another time", { createdAt: 7 }],
    ["other squares", { cells: makePuzzle().cells.slice(1) }],
  ])("refuses %s", (_name, change) => {
    const base = { ...stored, photo: PHOTO };
    expect(compareStored(base, { ...base, ...change })).toBe("conflict");
  });
});

describe("restartedPuzzle", () => {
  const original = makePuzzle({ id: "old", createdAt: 5_000, photo: "3f2c1a9e-8b4d-4c6e-9a1b-2d3e4f5a6b7c" });

  it("keeps the squares, image and photo under the new id, as of now, naming the puzzle it starts over", () => {
    expect(restartedPuzzle(original, "new", 9_000)).toEqual({ ...original, id: "new", createdAt: 9_000, restartOf: "old" });
  });

  it("names the first puzzle when started over again, since only that one's photo can still be on its way", () => {
    const again = restartedPuzzle(restartedPuzzle(original, "new", 9_000), "newer", 10_000);
    expect(again.restartOf).toBe("old");
  });

  it("is newer than the original even when this clock is behind", () => {
    expect(restartedPuzzle(original, "new", 1_000).createdAt).toBe(5_001);
  });
});
