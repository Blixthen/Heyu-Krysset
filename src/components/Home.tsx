"use client";

import { puzzlePath, RECENT_PUZZLES_URL, toRecentPuzzles, type RecentPuzzle } from "@/lib/storedPuzzle";
import { ChevronRight } from "lucide-react";
import { useEffect, useState, type MouseEvent } from "react";
import { AppHeader } from "./AppHeader";
import { CellEditor } from "./CellEditor";
import { PuzzleUploader, type Draft } from "./PuzzleUploader";

const LIST_FAILURE = "Kunde inte hämta korsorden. Ladda om sidan för att försöka igen.";

const SHARED_AT = new Intl.DateTimeFormat("sv-SE", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

type Recent = { status: "loading" } | { status: "failed" } | { status: "loaded"; puzzles: RecentPuzzle[] };

function useRecentPuzzles() {
  const [recent, setRecent] = useState<Recent>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(RECENT_PUZZLES_URL, { cache: "no-store" });
        const puzzles = toRecentPuzzles(await response.json().catch(() => null));
        if (!cancelled) setRecent(response.ok && puzzles ? { status: "loaded", puzzles } : { status: "failed" });
      } catch {
        if (!cancelled) setRecent({ status: "failed" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return recent;
}

/**
 * The start page: share a new crossword, which opens in a room of its own,
 * or open one of the recent ones, each in its own room.
 */
export function Home({
  nickname,
  onOpen,
  onShare,
  onLeave,
}: {
  nickname: string;
  /** Opens a recent crossword's room, by the puzzle its link opens. */
  onOpen: (puzzleId: string) => void;
  onShare: (shared: Draft) => void;
  onLeave: () => void;
}) {
  // A photo this player read, while they check its squares before sharing it.
  const [draft, setDraft] = useState<Draft | null>(null);
  const recent = useRecentPuzzles();

  function leaveDraft() {
    if (draft && !window.confirm("Släppa korsordet du kollar? Rutorna du har ändrat försvinner.")) return;
    setDraft(null);
  }

  function open(event: MouseEvent<HTMLAnchorElement>, id: string) {
    // A new tab or window opens the link itself.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    onOpen(id);
  }

  return (
    <main className="flex h-dvh max-h-dvh flex-col overflow-hidden pb-[env(safe-area-inset-bottom)]">
      <AppHeader nickname={nickname} onHome={leaveDraft} onLeave={onLeave} />
      {draft ? (
        <section className="flex min-h-0 flex-1 p-2 sm:p-4">
          <CellEditor
            key={draft.puzzle.id}
            puzzle={draft.puzzle}
            onDone={(puzzle) => onShare({ puzzle, file: draft.file })}
            onCancel={() => setDraft(null)}
          />
        </section>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 sm:p-6">
            <div className="h-72">
              <PuzzleUploader onRead={setDraft} />
            </div>
            <section aria-labelledby="recent-heading" className="flex flex-col gap-3">
              <h2 id="recent-heading" className="text-sm font-semibold text-slate-50">
                Senaste korsorden
              </h2>
              {recent.status === "loading" ? <p className="text-sm text-slate-400">Hämtar korsorden…</p> : null}
              {recent.status === "failed" ? <p className="text-sm text-amber-300">{LIST_FAILURE}</p> : null}
              {recent.status === "loaded" && recent.puzzles.length === 0 ? (
                <p className="text-sm text-slate-400">Inga korsord den senaste veckan. Dela ett ovan.</p>
              ) : null}
              {recent.status === "loaded" && recent.puzzles.length > 0 ? (
                <ul className="flex flex-col gap-2">
                  {recent.puzzles.map((puzzle) => (
                    <li key={puzzle.room}>
                      <a
                        href={puzzlePath(puzzle.id)}
                        onClick={(event) => open(event, puzzle.id)}
                        className="flex min-h-14 items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3 transition hover:border-slate-600"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-slate-50 first-letter:uppercase">
                            {SHARED_AT.format(puzzle.createdAt)}
                          </span>
                          {puzzle.cells === undefined ? null : (
                            <span className="block text-xs text-slate-400">{puzzle.cells} rutor</span>
                          )}
                        </span>
                        <ChevronRight aria-hidden className="size-4 shrink-0 text-slate-500" />
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          </div>
        </div>
      )}
    </main>
  );
}
