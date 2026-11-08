import { makePuzzle } from "@/test/fixtures";
import { describe, expect, it } from "vitest";
import { boardReducer, emptyBoard, type Board } from "./board";

const puzzle = makePuzzle();

function withLetters(letters: Board["letters"]): Board {
  return { puzzle, letters };
}

describe("boardReducer", () => {
  it("load replaces the puzzle and clears letters", () => {
    const next = boardReducer(withLetters({ "0-0": "A" }), { type: "load", puzzle: makePuzzle({ id: "new" }) });
    expect(next.puzzle?.id).toBe("new");
    expect(next.letters).toEqual({});
  });

  describe("remote-puzzle", () => {
    it("adopts a puzzle when we have none", () => {
      const next = boardReducer(emptyBoard, { type: "remote-puzzle", puzzle, letters: { "0-0": "A" } });
      expect(next).toEqual({ puzzle, letters: { "0-0": "A" } });
    });

    it("merges letters for the same puzzle without overwriting our own", () => {
      const state = withLetters({ "0-0": "X", "0-1": "" });
      const next = boardReducer(state, {
        type: "remote-puzzle",
        puzzle,
        letters: { "0-0": "A", "0-1": "B", "0-2": "C" },
      });
      expect(next.letters).toEqual({ "0-0": "X", "0-1": "", "0-2": "C" });
    });

    it("replaces our puzzle with a newer one", () => {
      const newer = makePuzzle({ id: "newer", createdAt: puzzle.createdAt + 1 });
      const next = boardReducer(withLetters({ "0-0": "X" }), { type: "remote-puzzle", puzzle: newer, letters: {} });
      expect(next).toEqual({ puzzle: newer, letters: {} });
    });

    it("ignores an older or equally old puzzle (no rollback by a stale peer)", () => {
      const state = withLetters({ "0-0": "X" });
      for (const createdAt of [puzzle.createdAt - 1, puzzle.createdAt]) {
        const stale = makePuzzle({ id: "stale", createdAt });
        expect(boardReducer(state, { type: "remote-puzzle", puzzle: stale, letters: {} })).toBe(state);
      }
    });
  });

  describe("letter", () => {
    it("sets a normalized letter", () => {
      const next = boardReducer(withLetters({}), { type: "letter", puzzleId: puzzle.id, row: 0, col: 0, value: "ä" });
      expect(next.letters).toEqual({ "0-0": "Ä" });
    });

    it("ignores updates for another puzzle", () => {
      const state = withLetters({});
      expect(boardReducer(state, { type: "letter", puzzleId: "other", row: 0, col: 0, value: "A" })).toBe(state);
    });

    it("ignores updates for cells that do not exist", () => {
      const state = withLetters({});
      expect(boardReducer(state, { type: "letter", puzzleId: puzzle.id, row: 9, col: 9, value: "A" })).toBe(state);
    });

    it("returns the same state when nothing changes", () => {
      const state = withLetters({ "0-0": "A" });
      expect(boardReducer(state, { type: "letter", puzzleId: puzzle.id, row: 0, col: 0, value: "a" })).toBe(state);
    });

    it("ignores letters when there is no puzzle", () => {
      expect(boardReducer(emptyBoard, { type: "letter", puzzleId: "x", row: 0, col: 0, value: "A" })).toBe(emptyBoard);
    });
  });
});
