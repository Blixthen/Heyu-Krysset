import { makePuzzle } from "@/test/fixtures";
import { describe, expect, it } from "vitest";
import { boardReducer, emptyBoard, type Board } from "./board";

const puzzle = makePuzzle();

function withLetters(letters: Board["letters"], authors: Board["authors"] = {}): Board {
  return { puzzle, letters, authors };
}

describe("boardReducer", () => {
  it("load replaces the puzzle and clears letters", () => {
    const next = boardReducer(withLetters({ "0-0": "A" }), { type: "load", puzzle: makePuzzle({ id: "new" }) });
    expect(next.puzzle?.id).toBe("new");
    expect(next.letters).toEqual({});
    expect(next.authors).toEqual({});
  });

  describe("remote-puzzle", () => {
    it("adopts a puzzle when we have none", () => {
      const next = boardReducer(emptyBoard, { type: "remote-puzzle", puzzle, letters: { "0-0": "A" }, authors: { "0-0": "Kim" } });
      expect(next).toEqual({ puzzle, letters: { "0-0": "A" }, authors: { "0-0": "Kim" } });
    });

    it("merges letters for the same puzzle without overwriting our own", () => {
      const state = withLetters({ "0-0": "X", "0-1": "" });
      const next = boardReducer(state, {
        type: "remote-puzzle",
        puzzle,
        letters: { "0-0": "A", "0-1": "B", "0-2": "C" },
        authors: {},
      });
      expect(next.letters).toEqual({ "0-0": "X", "0-1": "", "0-2": "C" });
    });

    it("keeps the author of whichever letter wins the merge", () => {
      const state = withLetters({ "0-0": "X", "0-1": "", "0-3": "Q" }, { "0-0": "Ann" });
      const next = boardReducer(state, {
        type: "remote-puzzle",
        puzzle,
        letters: { "0-0": "A", "0-1": "B", "0-2": "C", "0-3": "D" },
        authors: { "0-0": "Kim", "0-1": "Kim", "0-2": "Kim", "0-3": "Kim" },
      });
      // 0-1 stays cleared and 0-3 keeps our unattributed letter, so neither takes Kim's name.
      expect(next.authors).toEqual({ "0-0": "Ann", "0-2": "Kim" });
    });

    it("takes their author for the same letter when ours has none, as after an older tab's sync", () => {
      const state = withLetters({ "0-0": "A", "0-1": "B" });
      const next = boardReducer(state, {
        type: "remote-puzzle",
        puzzle,
        letters: { "0-0": "A", "0-1": "Z" },
        authors: { "0-0": "Kim", "0-1": "Kim" },
      });
      // 0-1 kept our different letter, so Kim's name for Z doesn't apply to it.
      expect(next.authors).toEqual({ "0-0": "Kim" });
    });

    it("drops authors of empty letters from a newer puzzle", () => {
      const newer = makePuzzle({ id: "newer", createdAt: puzzle.createdAt + 1 });
      const next = boardReducer(withLetters({}), {
        type: "remote-puzzle",
        puzzle: newer,
        letters: { "0-0": "A", "0-1": "" },
        authors: { "0-0": "Kim", "0-1": "Kim" },
      });
      expect(next.authors).toEqual({ "0-0": "Kim" });
    });

    it("replaces our puzzle with a newer one", () => {
      const newer = makePuzzle({ id: "newer", createdAt: puzzle.createdAt + 1 });
      const next = boardReducer(withLetters({ "0-0": "X" }), { type: "remote-puzzle", puzzle: newer, letters: {}, authors: {} });
      expect(next).toEqual({ puzzle: newer, letters: {}, authors: {} });
    });

    it("ignores an older or equally old puzzle (no rollback by a stale peer)", () => {
      const state = withLetters({ "0-0": "X" });
      for (const createdAt of [puzzle.createdAt - 1, puzzle.createdAt]) {
        const stale = makePuzzle({ id: "stale", createdAt });
        expect(boardReducer(state, { type: "remote-puzzle", puzzle: stale, letters: {}, authors: {} })).toBe(state);
      }
    });
  });

  describe("letter", () => {
    it("sets a normalized letter", () => {
      const next = boardReducer(withLetters({}), { type: "letter", puzzleId: puzzle.id, row: 0, col: 0, value: "ä" });
      expect(next.letters).toEqual({ "0-0": "Ä" });
    });

    it("records who typed a letter, and forgets it when the letter is cleared", () => {
      const typed = boardReducer(withLetters({}), { type: "letter", puzzleId: puzzle.id, row: 0, col: 1, value: "B", author: "Kim" });
      expect(typed.authors).toEqual({ "0-1": "Kim" });
      const cleared = boardReducer(typed, { type: "letter", puzzleId: puzzle.id, row: 0, col: 1, value: "", author: "Kim" });
      expect(cleared.authors).toEqual({});
    });

    it("gives the letter to whoever typed it last, even the same letter", () => {
      const state = withLetters({ "0-0": "A", "0-1": "B" }, { "0-0": "Ann", "0-1": "Ann" });
      const same = boardReducer(state, { type: "letter", puzzleId: puzzle.id, row: 0, col: 0, value: "A", author: "Kim" });
      expect(same.authors).toEqual({ "0-0": "Kim", "0-1": "Ann" });
      // A tab from before authors existed sends none: the letter is no longer Ann's.
      const old = boardReducer(state, { type: "letter", puzzleId: puzzle.id, row: 0, col: 1, value: "C" });
      expect(old.authors).toEqual({ "0-0": "Ann" });
    });

    it("keeps the author when a tab without authors resends the same letter", () => {
      const state = withLetters({ "0-0": "A" }, { "0-0": "Ann" });
      expect(boardReducer(state, { type: "letter", puzzleId: puzzle.id, row: 0, col: 0, value: "a" })).toBe(state);
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
      const state = withLetters({ "0-0": "A" }, { "0-0": "Kim" });
      expect(boardReducer(state, { type: "letter", puzzleId: puzzle.id, row: 0, col: 0, value: "a", author: "Kim" })).toBe(state);
    });

    it("ignores letters when there is no puzzle", () => {
      expect(boardReducer(emptyBoard, { type: "letter", puzzleId: "x", row: 0, col: 0, value: "A" })).toBe(emptyBoard);
    });
  });
});
