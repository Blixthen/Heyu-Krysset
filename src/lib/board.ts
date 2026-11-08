import { cellKey, oneLetter, type CrosswordPuzzle, type Letters } from "./crossword";

export type Board = {
  puzzle: CrosswordPuzzle | null;
  letters: Letters;
};

export type BoardAction =
  /** This client loaded a new puzzle. */
  | { type: "load"; puzzle: CrosswordPuzzle }
  /** A peer shared its puzzle state. */
  | { type: "remote-puzzle"; puzzle: CrosswordPuzzle; letters: Letters }
  /** A letter was typed, locally or by a peer. */
  | { type: "letter"; puzzleId: string; row: number; col: number; value: string };

export const emptyBoard: Board = { puzzle: null, letters: {} };

/**
 * Pure state transitions for the shared board. Without a server-side source of
 * truth, peers reconcile with two rules:
 * - a different puzzle only replaces ours if it is newer, so a peer that
 *   reconnects with an old puzzle cannot roll everyone back;
 * - the same puzzle merges letters, keeping our own where both have a value,
 *   so a late sync can never wipe out letters typed in the meantime.
 */
export function boardReducer(state: Board, action: BoardAction): Board {
  switch (action.type) {
    case "load":
      return { puzzle: action.puzzle, letters: {} };

    case "remote-puzzle": {
      const current = state.puzzle;
      if (current && current.id === action.puzzle.id) {
        return { puzzle: current, letters: { ...action.letters, ...state.letters } };
      }
      if (current && action.puzzle.createdAt <= current.createdAt) return state;
      return { puzzle: action.puzzle, letters: action.letters };
    }

    case "letter": {
      const puzzle = state.puzzle;
      if (!puzzle || puzzle.id !== action.puzzleId) return state;
      if (!puzzle.cells.some((cell) => cell.row === action.row && cell.col === action.col)) {
        return state;
      }
      const key = cellKey(action.row, action.col);
      const value = oneLetter(action.value);
      if ((state.letters[key] ?? "") === value) return state;
      return { puzzle, letters: { ...state.letters, [key]: value } };
    }
  }
}
