"use client";

import type { Board } from "@/lib/board";
import { lettersToSave, lettersUrl } from "@/lib/storedLetters";
import { useCallback, useEffect, useRef } from "react";

/**
 * How long typing must pause before the letters are saved. Long enough that a
 * word is one save rather than one per letter, short enough that little is
 * lost when everyone closes the tab.
 */
export const SAVE_DELAY_MS = 2000;

/**
 * Browsers refuse keepalive requests once their bodies pass 64 KiB in total;
 * a bigger save goes out as a plain request, which may not outlive the page.
 */
export const KEEPALIVE_MAX_BYTES = 60_000;

type Pending = { puzzleId: string; board: Board };
type Save = { puzzleId: string; body: string };

/** Never throws: a failed save only loses what a later one would have saved. */
async function send(save: Save) {
  try {
    const response = await fetch(lettersUrl(save.puzzleId), {
      method: "PUT",
      body: save.body,
      headers: { "content-type": "application/json" },
      // So a save that has started still lands if the tab closes.
      keepalive: new TextEncoder().encode(save.body).length <= KEEPALIVE_MAX_BYTES,
    });
    // A puzzle from before permanent links has no stored copy to save letters for.
    if (!response.ok && response.status !== 404) console.warn("letters: saving failed", response.status);
  } catch (error) {
    console.warn("letters: saving failed", error);
  }
}

/**
 * Saves the letters of the room's puzzle a moment after this player types, so
 * its permanent link brings them back. Only the player who typed saves, not
 * everyone who receives the letter; their board already holds what the
 * others typed. Saves go out one at a time, in order, so an older one can
 * never land after a newer one and win.
 *
 * `readBoard` gives the latest board. Each request keeps a copy of the board
 * at that moment, used if a different puzzle replaces it before the save.
 */
export function useLetterSaving(readBoard: () => Board) {
  const pending = useRef<Pending | null>(null);
  const timer = useRef<number | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  // Read through a ref, so a new function each render doesn't count as leaving the room (the effect below).
  const readRef = useRef(readBoard);
  useEffect(() => {
    readRef.current = readBoard;
  }, [readBoard]);

  /** Queues what is waiting, as the board is now. */
  const flush = useCallback(() => {
    const request = pending.current;
    pending.current = null;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    if (!request) return;
    const latest = readRef.current();
    const board = latest.puzzle?.id === request.puzzleId ? latest : request.board;
    const save = { puzzleId: request.puzzleId, body: JSON.stringify(lettersToSave(board.letters, board.authors)) };
    queue.current = queue.current.then(() => send(save));
  }, []);

  const saveSoon = useCallback(() => {
    const board = readRef.current();
    const puzzleId = board.puzzle?.id;
    if (!puzzleId) return;
    // Typing into a different puzzle first saves the last one.
    if (pending.current && pending.current.puzzleId !== puzzleId) flush();
    pending.current = { puzzleId, board };
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, SAVE_DELAY_MS);
  }, [flush]);

  useEffect(() => {
    // Phones often discard a tab in the background without pagehide, so
    // hiding it is the last reliable moment; leaving the room counts too.
    function onVisibility() {
      if (document.visibilityState === "hidden") flush();
    }
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [flush]);

  return saveSoon;
}
