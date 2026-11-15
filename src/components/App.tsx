"use client";

import { Home } from "@/components/Home";
import { NicknameForm } from "@/components/NicknameForm";
import { Room } from "@/components/Room";
import { saveNickname, useNickname } from "@/lib/nickname";
import { linkedPuzzleId, puzzlePath } from "@/lib/storedPuzzle";
import { useEffect, useState } from "react";
import type { Draft } from "./PuzzleUploader";

/** What shows: the start page, or a crossword's room by the puzzle its link opens (and, just shared, that puzzle). */
type View = { puzzleId?: undefined } | { puzzleId: string; shared?: Draft };

/**
 * The whole app: the nickname form, then the start page or a crossword's
 * room. Moving between them updates the address without loading a page, so a
 * crossword just shared opens straight away and Back returns to the list.
 */
export function App({ linkedPuzzleId: initial }: { linkedPuzzleId?: string }) {
  const nickname = useNickname();
  const [view, setView] = useState<View>(initial ? { puzzleId: initial } : {});

  useEffect(() => {
    const onPopState = () => {
      const puzzleId = linkedPuzzleId(window.location.pathname);
      setView(puzzleId ? { puzzleId } : {});
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function go(next: View) {
    window.history.pushState(null, "", next.puzzleId ? puzzlePath(next.puzzleId) : "/");
    setView(next);
  }

  // null until hydrated: the nickname lives in localStorage.
  if (nickname === null) return <main className="min-h-full flex-1 bg-slate-950" />;
  if (!nickname) return <NicknameForm onJoin={saveNickname} />;
  const leave = () => saveNickname("");
  if (!view.puzzleId) {
    return (
      <Home
        nickname={nickname}
        onOpen={(puzzleId) => go({ puzzleId })}
        onShare={(shared) => go({ puzzleId: shared.puzzle.id, shared })}
        onLeave={leave}
      />
    );
  }
  return (
    // Keyed so that another crossword, or another nickname, starts a fresh connection and chat.
    <Room
      key={`${nickname}:${view.puzzleId}`}
      nickname={nickname}
      linkedPuzzleId={view.puzzleId}
      shared={view.shared}
      onSharedTaken={() => setView((current) => (current.puzzleId ? { puzzleId: current.puzzleId } : current))}
      onShare={(shared) => go({ puzzleId: shared.puzzle.id, shared })}
      onHome={() => go({})}
      onLeave={leave}
    />
  );
}
