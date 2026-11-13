import type { Result } from "./analyze";
import { MAX_CELLS, oneLetter, type Authors, type Letters } from "./crossword";
import { isPlayerName } from "./players";

/**
 * The letters typed into a stored puzzle, kept apart from the puzzle itself:
 * the puzzle and its photo never change once saved, while the letters change
 * with every word. A copy of the puzzle under a new id therefore starts over
 * with no letters and the same photo. Pure and runtime-agnostic.
 */

export type SavedLetters = { letters: Letters; authors: Authors };

/**
 * The largest letters upload: MAX_CELLS cells, each a key like "123-45", one
 * letter and an author name of up to 24 characters, about 60 bytes, with headroom.
 */
export const MAX_LETTERS_BYTES = 200_000;

/** Where the browser saves and loads a puzzle's letters. */
export function lettersUrl(puzzleId: string) {
  return `/api/puzzle/${puzzleId}/letters`;
}

/** The object key in the bucket. */
export function lettersKey(puzzleId: string) {
  return `letters/${puzzleId}.json`;
}

const CELL_KEY = /^(0|[1-9]\d{0,3})-(0|[1-9]\d{0,3})$/;

const NOT_LETTERS = { message: "Bokstäverna kunde inte sparas.", status: 400 };

function isMap(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Checks letters to store. The server doesn't read the puzzle to know its
 * squares, so it checks only the shape; the browser keeps the squares that
 * exist when it loads them (lettersFromPayload). Cleared squares are left out.
 */
export function checkLettersUpload(value: unknown): Result<SavedLetters> {
  if (!isMap(value) || !isMap(value.letters) || !isMap(value.authors)) return { ok: false, error: NOT_LETTERS };
  const letterEntries = Object.entries(value.letters);
  const authorEntries = Object.entries(value.authors);
  if (letterEntries.length > MAX_CELLS || authorEntries.length > MAX_CELLS) return { ok: false, error: NOT_LETTERS };

  const letters: Letters = {};
  for (const [key, letter] of letterEntries) {
    if (!CELL_KEY.test(key) || typeof letter !== "string" || oneLetter(letter) !== letter) return { ok: false, error: NOT_LETTERS };
    if (letter) letters[key] = letter;
  }
  const authors: Authors = {};
  for (const [key, author] of authorEntries) {
    if (!CELL_KEY.test(key) || !isPlayerName(author)) return { ok: false, error: NOT_LETTERS };
    if (Object.hasOwn(letters, key)) authors[key] = author;
  }
  return { ok: true, value: { letters, authors } };
}

/** What to save of a board: its filled squares and who typed them. */
export function lettersToSave(letters: Letters, authors: Authors): SavedLetters {
  const saved: SavedLetters = { letters: {}, authors: {} };
  for (const [key, letter] of Object.entries(letters)) {
    if (!letter) continue;
    saved.letters[key] = letter;
    if (authors[key]) saved.authors[key] = authors[key];
  }
  return saved;
}
