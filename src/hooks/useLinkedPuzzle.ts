"use client";

import type { CrosswordPuzzle } from "@/lib/crossword";
import { checkPuzzleUpload, puzzlePath, puzzleUrl } from "@/lib/storedPuzzle";
import { useCallback, useEffect, useRef, useState } from "react";

const MISSING = "Korsordet finns inte kvar.";
const UNREACHABLE = "Kunde inte hämta korsordet. Ladda om sidan för att försöka igen.";

/**
 * Opens a stored puzzle from its permanent link, and keeps the address bar on
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
  restorePuzzle: (puzzle: CrosswordPuzzle) => void,
) {
  const [linked, setLinked] = useState<CrosswordPuzzle | null>(null);
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
        const response = await fetch(puzzleUrl(linkedPuzzleId), { cache: "no-store" });
        const puzzle = checkPuzzleUpload(await response.json().catch(() => null));
        if (cancelled) return;
        if (response.ok && puzzle.ok && puzzle.value.id === linkedPuzzleId) {
          setLinked(puzzle.value);
          restorePuzzle(puzzle.value);
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
  return {
    /** Why the link didn't open; gone once a different puzzle shows. */
    error: failure && failure.shownWith === currentPuzzleId ? failure.message : "",
    /** The linked puzzle, while the room shows another one and the user hasn't dismissed it. */
    elsewhere: linked && !dismissed && currentPuzzleId !== undefined && currentPuzzleId !== linked.id ? linked : null,
    dismiss,
  };
}
