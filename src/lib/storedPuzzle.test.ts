import { gridCells, makePuzzle } from "@/test/fixtures";
import { MAX_CELLS } from "./crossword";
import { describe, expect, it } from "vitest";
import {
  checkPuzzleUpload,
  compareStored,
  MAX_RECENT_PUZZLES,
  puzzleKey,
  puzzleMetadata,
  puzzlePath,
  puzzleUrl,
  recentPuzzles,
  restartedPuzzle,
  safeNextPath,
  toRecentPuzzles,
} from "./storedPuzzle";

const ID = "3f2c1a9e-8b4d-4c6e-9a1b-2d3e4f5a6b7c";
const A = "aaaaaaaa-8b4d-4c6e-9a1b-2d3e4f5a6b7c";
const B = "bbbbbbbb-8b4d-4c6e-9a1b-2d3e4f5a6b7c";
const C = "cccccccc-8b4d-4c6e-9a1b-2d3e4f5a6b7c";

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

describe("puzzleMetadata", () => {
  it("keeps what the list shows, as strings", () => {
    const puzzle = makePuzzle({ id: A, createdAt: 5_000, cells: gridCells(2, 3) });
    expect(puzzleMetadata(puzzle)).toEqual({ createdAt: "5000", cells: "6" });
    expect(puzzleMetadata({ ...puzzle, restartOf: B })).toEqual({ createdAt: "5000", cells: "6", restartOf: B });
  });
});

describe("recentPuzzles", () => {
  const listed = (id: string, metadata?: Record<string, string>, uploaded = 1_000) => ({
    key: puzzleKey(id),
    uploaded: new Date(uploaded),
    customMetadata: metadata,
  });

  it("lists each room once, by its newest puzzle, newest room first", () => {
    const list = recentPuzzles([
      listed(A, { createdAt: "100", cells: "40" }),
      listed(B, { createdAt: "300", cells: "20" }),
      listed(C, { createdAt: "200", cells: "40", restartOf: A }),
    ]);
    expect(list).toEqual([
      { id: B, room: B, createdAt: 300, cells: 20 },
      { id: C, room: A, createdAt: 200, cells: 40 },
    ]);
  });

  it("dates a puzzle stored before the list by when it was stored, without a count", () => {
    expect(recentPuzzles([listed(A, undefined, 7_000)])).toEqual([{ id: A, room: A, createdAt: 7_000 }]);
    expect(recentPuzzles([listed(A, { createdAt: "soon", cells: "-1" }, 7_000)])).toEqual([{ id: A, room: A, createdAt: 7_000 }]);
  });

  it("ignores other objects and a restartOf that isn't an id", () => {
    const list = recentPuzzles([
      { key: `letters/${A}.json`, uploaded: new Date(1) },
      { key: "puzzles/not-an-id.json", uploaded: new Date(1) },
      listed(B, { createdAt: "10", restartOf: "../x" }),
    ]);
    expect(list).toEqual([{ id: B, room: B, createdAt: 10 }]);
  });

  it("lists at most MAX_RECENT_PUZZLES rooms, the newest", () => {
    const ids = Array.from({ length: MAX_RECENT_PUZZLES + 5 }, (_, index) => `${String(index).padStart(8, "0")}-8b4d-4c6e-9a1b-2d3e4f5a6b7c`);
    const list = recentPuzzles(ids.map((id, index) => listed(id, { createdAt: String(index + 1) })));
    expect(list).toHaveLength(MAX_RECENT_PUZZLES);
    expect(list[0].createdAt).toBe(MAX_RECENT_PUZZLES + 5);
  });
});

describe("toRecentPuzzles", () => {
  it("copies a valid list field by field", () => {
    const list = [{ id: B, room: A, createdAt: 10, cells: 4, evil: true }, { id: A, room: A, createdAt: 5 }];
    expect(toRecentPuzzles({ puzzles: list })).toEqual([{ id: B, room: A, createdAt: 10, cells: 4 }, { id: A, room: A, createdAt: 5 }]);
  });

  it("rejects anything else", () => {
    expect(toRecentPuzzles(null)).toBeNull();
    expect(toRecentPuzzles({ puzzles: "x" })).toBeNull();
    expect(toRecentPuzzles({ puzzles: [{ id: "x", room: A, createdAt: 1 }] })).toBeNull();
    expect(toRecentPuzzles({ puzzles: [{ id: A, room: A, createdAt: "1" }] })).toBeNull();
    expect(toRecentPuzzles({ puzzles: [{ id: A, room: A, createdAt: 1, cells: MAX_CELLS + 1 }] })).toBeNull();
    expect(toRecentPuzzles({ puzzles: [{ id: A, room: A, createdAt: 1, cells: MAX_CELLS }] })).toHaveLength(1);
  });
});
