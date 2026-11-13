import { cellKey, oneLetter, type Authors, type CrosswordPuzzle, type Letters } from "./crossword";

export type Board = {
  puzzle: CrosswordPuzzle | null;
  letters: Letters;
  /** Who typed each letter; a letter without an author (from an older tab) is shown untinted. */
  authors: Authors;
};

export type BoardAction =
  /** This client loaded a new puzzle. */
  | { type: "load"; puzzle: CrosswordPuzzle }
  /** A peer shared its puzzle state. */
  | { type: "remote-puzzle"; puzzle: CrosswordPuzzle; letters: Letters; authors: Authors }
  /** This client stored the puzzle's photo. */
  | { type: "photo"; puzzleId: string; photo: string }
  /** A letter was typed, locally or by a peer. */
  | { type: "letter"; puzzleId: string; row: number; col: number; value: string; author?: string };

export const emptyBoard: Board = { puzzle: null, letters: {}, authors: {} };

/**
 * The author of each non-empty letter, taken from whichever side's letter won
 * the merge, so an author never belongs to a letter that was overwritten. When
 * both sides have the same letter and only theirs knows who typed it, theirs
 * fills the gap: a board from an older tab carries no authors.
 */
function authorsFor(letters: Letters, ours: Board, theirs: { letters: Letters; authors: Authors }): Authors {
  const authors: Authors = {};
  for (const [key, letter] of Object.entries(letters)) {
    const fromThem = theirs.letters[key] === letter ? theirs.authors[key] : undefined;
    const author = Object.hasOwn(ours.letters, key) ? (ours.authors[key] ?? fromThem) : fromThem;
    if (letter && author) authors[key] = author;
  }
  return authors;
}

/** The puzzle with a stored photo filled in if it has none; a photo is never replaced. */
function withPhoto(puzzle: CrosswordPuzzle, photo: string | undefined) {
  return photo === undefined || puzzle.photo !== undefined ? puzzle : { ...puzzle, photo };
}

/**
 * Pure state transitions for the shared board. Without a server-side source of
 * truth, peers reconcile with two rules:
 * - a different puzzle only replaces ours if it is newer, so a peer that
 *   reconnects with an old puzzle cannot roll everyone back;
 * - the same puzzle merges letters, keeping our own where both have a value,
 *   so a late sync can never wipe out letters typed in the meantime, and
 *   takes their stored photo if ours has none: the uploader shares the puzzle
 *   before its photo is stored, and a tab from before stored photos drops it.
 */
export function boardReducer(state: Board, action: BoardAction): Board {
  switch (action.type) {
    case "load":
      return { puzzle: action.puzzle, letters: {}, authors: {} };

    case "remote-puzzle": {
      const current = state.puzzle;
      if (current && current.id === action.puzzle.id) {
        const letters = { ...action.letters, ...state.letters };
        return { puzzle: withPhoto(current, action.puzzle.photo), letters, authors: authorsFor(letters, state, action) };
      }
      if (current && action.puzzle.createdAt <= current.createdAt) return state;
      return { puzzle: action.puzzle, letters: action.letters, authors: authorsFor(action.letters, emptyBoard, action) };
    }

    case "photo": {
      const puzzle = state.puzzle;
      if (!puzzle || puzzle.id !== action.puzzleId) return state;
      const next = withPhoto(puzzle, action.photo);
      return next === puzzle ? state : { ...state, puzzle: next };
    }

    case "letter": {
      const puzzle = state.puzzle;
      if (!puzzle || puzzle.id !== action.puzzleId) return state;
      if (!puzzle.cells.some((cell) => cell.row === action.row && cell.col === action.col)) {
        return state;
      }
      const key = cellKey(action.row, action.col);
      const value = oneLetter(action.value);
      const previous = state.letters[key] ?? "";
      // An update without an author (from an older tab) leaves an unchanged letter's author alone.
      const author = value ? (action.author ?? (previous === value ? state.authors[key] : undefined)) : undefined;
      if (previous === value && state.authors[key] === author) return state;
      const authors = { ...state.authors };
      if (author) authors[key] = author;
      else delete authors[key];
      return { puzzle, letters: { ...state.letters, [key]: value }, authors };
    }
  }
}

function filledCount(letters: Letters) {
  return Object.values(letters).filter(Boolean).length;
}

/**
 * Whether opening a stored puzzle (and its saved letters) gave the room
 * something to share: the puzzle itself, if it took the board, or letters
 * nobody here had. Not if a newer puzzle kept the board.
 */
export function restoreAddsToRoom(before: Board, after: Board, puzzleId: string) {
  if (after.puzzle?.id !== puzzleId) return false;
  return before.puzzle?.id !== puzzleId || filledCount(after.letters) > filledCount(before.letters);
}
