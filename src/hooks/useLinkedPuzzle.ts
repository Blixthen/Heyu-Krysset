"use client";

import { authorsFromPayload, lettersFromPayload, type CrosswordPuzzle } from "@/lib/crossword";
import { checkLettersUpload, lettersUrl, type SavedLetters } from "@/lib/storedLetters";
import { checkPuzzleUpload, puzzlePath, puzzleUrl } from "@/lib/storedPuzzle";
import { useCallback, useEffect, useRef, useState } from "react";

const MISSING = "Korsordet finns inte kvar.";
const UNREACHABLE = "Kunde inte hämta korsordet. Ladda om sidan för att försöka igen.";

const NO_LETTERS: SavedLetters = { letters: {}, authors: {} };

/** The letters saved for a puzzle; none if nothing was typed yet or they can't be loaded, since the puzzle opens either way. */
async function loadLetters(puzzleId: string): Promise<SavedLetters> {
  try {
    const response = await fetch(lettersUrl(puzzleId), { cache: "no-store" });
    if (response.status === 404) return NO_LETTERS;
    const saved = checkLettersUpload(await response.json().catch(() => null));
    if (response.ok && saved.ok) return saved.value;
    console.warn("letters: loading failed", response.status);
  } catch (error) {
    console.warn("letters: loading failed", error);
  }
  return NO_LETTERS;
}

/**
 * Opens a stored puzzle and its saved letters from its permanent link, and keeps the address bar on
 * the link of whatever puzzle the room shows, so it can be copied or reopened.
 *
 * Returns an error while the link can't be opened (until another puzzle
 * shows), and the linked puzzle while the room shows a different one: the
 * room's usual rules let a newer puzzle win, so the user is offered to open
 * the linked one for everyone instead of being moved on silently.
 */
export function useLinkedPuzzle(
  linkedPuzzleId: string | undefined,
  currentPuzzleId: string | undefined,
  restorePuzzle: (puzzle: CrosswordPuzzle, saved?: SavedLetters) => void,
) {
  // Kept with its letters, so opening it later doesn't start it over and overwrite them on the next save.
  const [linked, setLinked] = useState<{ puzzle: CrosswordPuzzle; saved: SavedLetters } | null>(null);
  const [failure, setFailure] = useState<{ message: string; shownWith: string | undefined } | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const currentRef = useRef(currentPuzzleId);
  useEffect(() => {
    currentRef.current = currentPuzzleId;
  }, [currentPuzzleId]);

  useEffect(() => {
    if (!linkedPuzzleId) return;
    let cancelled = false;
    void (async () => {
      let message = UNREACHABLE;
      try {
        const letters = loadLetters(linkedPuzzleId);
        const response = await fetch(puzzleUrl(linkedPuzzleId), { cache: "no-store" });
        const puzzle = checkPuzzleUpload(await response.json().catch(() => null));
        if (cancelled) return;
        if (response.ok && puzzle.ok && puzzle.value.id === linkedPuzzleId) {
          const saved = await letters;
          if (cancelled) return;
          const { cells } = puzzle.value;
          const kept = { letters: lettersFromPayload(saved.letters, cells), authors: authorsFromPayload(saved.authors, cells) };
          setLinked({ puzzle: puzzle.value, saved: kept });
          restorePuzzle(puzzle.value, kept);
          return;
        }
        if (response.status === 404) message = MISSING;
      } catch {
        if (cancelled) return;
      }
      setFailure({ message, shownWith: currentRef.current });
    })();
    return () => {
      cancelled = true;
    };
  }, [linkedPuzzleId, restorePuzzle]);

  useEffect(() => {
    if (!currentPuzzleId) return;
    const path = puzzlePath(currentPuzzleId);
    if (window.location.pathname !== path) window.history.replaceState(null, "", path);
  }, [currentPuzzleId]);

  const dismiss = useCallback(() => setDismissed(true), []);
  const elsewhere = linked && !dismissed && currentPuzzleId !== undefined && currentPuzzleId !== linked.puzzle.id ? linked : null;
  return {
    /** Why the link didn't open; gone once a different puzzle shows. */
    error: failure && failure.shownWith === currentPuzzleId ? failure.message : "",
    /** The linked puzzle, while the room shows another one and the user hasn't dismissed it. */
    elsewhere: elsewhere?.puzzle ?? null,
    /**
     * Opens the linked puzzle for everyone, with its saved letters, as the
     * newest so it wins in every tab. Returns it, or null if there is none to open.
     */
    open: () => {
      if (!elsewhere) return null;
      const puzzle = { ...elsewhere.puzzle, createdAt: Date.now() };
      setDismissed(true);
      restorePuzzle(puzzle, elsewhere.saved);
      return puzzle;
    },
    dismiss,
  };
}
