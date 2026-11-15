"use client";

import { useCrosswordRoom } from "@/hooks/useCrosswordRoom";
import { useLinkedPuzzle } from "@/hooks/useLinkedPuzzle";
import { countUnread } from "@/lib/chat";
import type { CellPosition, CrosswordPuzzle } from "@/lib/crossword";
import { playerColours } from "@/lib/players";
import type { SavedLetters } from "@/lib/storedLetters";
import { restartedPuzzle } from "@/lib/storedPuzzle";
import { roomOf } from "@/lib/room";
import { Maximize2, Minimize2, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "./AppHeader";
import { ChatPanel, StatusBadge } from "./ChatPanel";
import { CellEditor } from "./CellEditor";
import { CrosswordGrid, focusCell } from "./CrosswordGrid";
import { PLAYER_COLOURS, PlayerLegend } from "./PlayerLegend";
import { keepPuzzle, PuzzleUploader, savePuzzle, type Draft } from "./PuzzleUploader";

/**
 * One crossword's room (roomOf), at its permanent link: the puzzle from the
 * link, or one this player just shared, which opens in a room of its own.
 */
export function Room({
  nickname,
  linkedPuzzleId,
  shared: sharedProp,
  onSharedTaken,
  onShare,
  onHome,
  onLeave,
}: {
  nickname: string;
  /** The stored puzzle the link opens. */
  linkedPuzzleId?: string;
  /** A crossword this player just shared, opening its room. */
  shared?: Draft;
  /** The room took the crossword just shared; a room mounted later, after a nickname change, opens it by its link. */
  onSharedTaken?: () => void;
  /** This player shared a new crossword from here; it gets a room of its own. */
  onShare: (shared: Draft) => void;
  onHome: () => void;
  onLeave: () => void;
}) {
  // Kept from the first render: the room is this crossword's however the prop changes.
  const [shared] = useState(sharedProp);
  const [linkedRoom, setLinkedRoom] = useState<string | null>(null);
  const room = useCrosswordRoom(nickname, shared ? roomOf(shared.puzzle) : linkedRoom);
  const [selectedCell, setSelectedCell] = useState<CellPosition | null>(null);
  // A photo this player read, while they check its squares before sharing it.
  const [draft, setDraft] = useState<Draft | null>(null);
  const { puzzle, letters, authors } = room.board;
  const { restorePuzzle } = room;
  const openStored = useCallback(
    (stored: CrosswordPuzzle, saved?: SavedLetters) => {
      // The room is the stored puzzle's, known once it loads.
      setLinkedRoom(roomOf(stored));
      restorePuzzle(stored, saved);
    },
    [restorePuzzle],
  );
  const link = useLinkedPuzzle(shared ? undefined : linkedPuzzleId, puzzle?.id, openStored);
  // Everyone in the room gets a colour as soon as presence lists them, from
  // the same names in every tab; typists keep theirs whoever comes and goes.
  const { online } = room;
  const colours = useMemo(
    () => playerColours(Object.values(authors), online, PLAYER_COLOURS.length),
    [online, authors],
  );
  // On phones the chat folds down to a bar so the crossword gets the screen;
  // on wide screens it is always shown beside the grid.
  const [chatOpen, setChatOpen] = useState(false);
  const [lastSeenId, setLastSeenId] = useState<string | null>(null);
  // Only the crossword and the notices about it, so a phone shows more of it.
  // The header and chat are hidden rather than unmounted, so a half-written
  // message survives.
  const [gridOnly, setGridOnly] = useState(false);
  const showGridOnly = gridOnly && Boolean(puzzle) && !draft;
  /** The display a part has, or hidden while only the crossword shows. */
  const shownBesideGrid = (display: string) => (showGridOnly ? "hidden" : display);
  // An open chat is out of sight too while only the crossword shows.
  const unread = chatOpen && !showGridOnly ? 0 : countUnread(room.messages, lastSeenId, room.clientId);
  const unreadLabel = unread > 99 ? "99+" : String(unread);

  function startDraft(next: Draft) {
    // Checking the squares needs the whole view, and sharing them shouldn't hide it again.
    setGridOnly(false);
    setDraft(next);
  }

  function toggleChat() {
    if (chatOpen) setLastSeenId(room.messages.at(-1)?.id ?? null);
    setChatOpen(!chatOpen);
  }

  function selectFirst(shown: CrosswordPuzzle) {
    const first = shown.cells[0];
    setSelectedCell(first ? { row: first.row, col: first.col } : null);
    if (first) requestAnimationFrame(() => focusCell(first));
  }

  function onPuzzle(next: CrosswordPuzzle) {
    // Whatever puzzle the user picks now, the link's is no longer the point.
    link.dismiss();
    room.publishPuzzle(next);
    selectFirst(next);
  }

  function shareDraft(next: CrosswordPuzzle) {
    if (!draft) return;
    setDraft(null);
    // A new crossword gets a room of its own; this one keeps its puzzle.
    onShare({ puzzle: next, file: draft.file });
  }

  function openLinked() {
    const opened = link.open();
    if (opened) selectFirst(opened);
  }

  // The photo stored for the crossword just shared, for saving its link again.
  const sharedPhoto = useRef<string | undefined>(undefined);

  function onPhoto(puzzleId: string, photo: string) {
    if (puzzleId === shared?.puzzle.id) sharedPhoto.current = photo;
    const updated = room.attachPhoto(puzzleId, photo);
    // keepPuzzle saves only the puzzle it was given; a copy started over before the photo was stored needs it too.
    if (updated && updated.id !== puzzleId) void savePuzzle(updated);
  }

  // A crossword just shared fills its new room, once, and is stored for its link.
  const opened = useRef(false);
  // Whether the link of the crossword just shared failed to save, so nobody else can open it.
  const [unsaved, setUnsaved] = useState(false);
  useEffect(() => {
    if (!shared || opened.current) return;
    opened.current = true;
    onPuzzle(shared.puzzle);
    void keepPuzzle(shared.puzzle, shared.file, onPhoto, (ok) => setUnsaved(!ok));
    onSharedTaken?.();
  });

  async function saveAgain() {
    // The crossword shared, whose link the others were given, even if it was started over since.
    if (!shared) return;
    const photo = sharedPhoto.current;
    setUnsaved(!(await savePuzzle(photo ? { ...shared.puzzle, photo } : shared.puzzle)));
  }

  // A link that can't open has no room to join, so there is no chat to show either.
  const noRoom = !puzzle && Boolean(link.error);

  function restart() {
    if (!puzzle || !window.confirm("Börja om korsordet? Alla bokstäver försvinner, för alla i rummet.")) return;
    const next = restartedPuzzle(puzzle, crypto.randomUUID(), Date.now());
    onPuzzle(next);
    // The same squares and photo, so only the copy needs saving for its link.
    void savePuzzle(next);
  }

  return (
    <main className="flex h-dvh max-h-dvh flex-col overflow-hidden pb-[env(safe-area-inset-bottom)]">
      <AppHeader
        nickname={nickname}
        onHome={onHome}
        onLeave={onLeave}
        className={shownBesideGrid("grid")}
        actions={
          <>
            {/* Hidden while a photo is being checked: the puzzle it would start over is out of sight. */}
            {puzzle && !draft ? (
              <button
                type="button"
                onClick={restart}
                aria-label="Börja om"
                className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-slate-700 px-3 text-xs font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white"
              >
                <RotateCcw className="size-3.5" />
                {/* Phones only fit the icon beside the other buttons. */}
                <span className="hidden sm:inline">Börja om</span>
              </button>
            ) : null}
            <PuzzleUploader compact onRead={startDraft} />
          </>
        }
      />

      {link.error ? (
        <p className="shrink-0 border-b border-slate-800 px-4 py-2 text-xs text-amber-300">{link.error}</p>
      ) : null}
      {link.elsewhere && !draft ? (
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-800 px-4 py-2 text-xs text-amber-300">
          <p>Rummet har ett annat korsord än det i länken.</p>
          <button
            type="button"
            onClick={openLinked}
            className="font-bold text-amber-200 underline underline-offset-2 hover:text-white"
          >
            Öppna länkens korsord
          </button>
          <button type="button" onClick={link.dismiss} className="text-slate-400 hover:text-white">
            Stäng
          </button>
        </div>
      ) : null}
      {unsaved ? (
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-800 px-4 py-2 text-xs text-amber-300">
          <p>Korsordet kunde inte sparas, så ingen annan kan öppna det än.</p>
          <button type="button" onClick={() => void saveAgain()} className="font-bold text-amber-200 underline underline-offset-2 hover:text-white">
            Försök igen
          </button>
        </div>
      ) : null}
      {room.shareError ? (
        <p className="shrink-0 border-b border-slate-800 px-4 py-2 text-xs text-amber-300">{room.shareError}</p>
      ) : null}

      <div
        className={`grid min-h-0 flex-1 ${
          showGridOnly
            ? "grid-rows-1"
            : `${chatOpen ? "grid-rows-[minmax(0,1fr)_minmax(9.5rem,36dvh)]" : "grid-rows-[minmax(0,1fr)_auto]"} lg:grid-cols-[minmax(0,1fr)_380px] lg:grid-rows-1`
        }`}
      >
        <section className="flex min-h-0 items-stretch justify-center overflow-hidden p-2 sm:p-4">
          {draft ? (
            // Keyed by puzzle, so a new photo starts over with its own squares.
            <CellEditor key={draft.puzzle.id} puzzle={draft.puzzle} onDone={shareDraft} onCancel={() => setDraft(null)} />
          ) : puzzle ? (
            <div className="min-h-0 w-full">
              <CrosswordGrid
                puzzle={puzzle}
                letters={letters}
                authors={authors}
                colours={colours}
                selectedCell={selectedCell}
                onSelect={setSelectedCell}
                onLetter={(cell, letter) => room.setLetter(cell.row, cell.col, letter)}
                toolbar={
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <PlayerLegend colours={colours} />
                    </div>
                    {/* The chat that shows these is hidden, and typing without a connection reaches no one. */}
                    {showGridOnly && room.status !== "live" ? (
                      <>
                        <StatusBadge status={room.status} />
                        {room.status === "error" ? (
                          <button type="button" onClick={room.reconnect} className="shrink-0 text-xs font-semibold text-amber-300 underline">
                            Försök igen
                          </button>
                        ) : null}
                      </>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setGridOnly(!showGridOnly)}
                      aria-label={
                        showGridOnly ? (unread > 0 ? `Visa allt, ${unreadLabel} nya meddelanden` : "Visa allt") : "Visa bara korsordet"
                      }
                      className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs font-semibold text-slate-100 hover:bg-slate-800"
                    >
                      {showGridOnly ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
                      <span className="hidden sm:inline">{showGridOnly ? "Visa allt" : "Bara korsordet"}</span>
                      {showGridOnly && unread > 0 ? (
                        <span className="rounded-full bg-sky-400 px-1.5 text-xs font-bold text-slate-950">{unreadLabel}</span>
                      ) : null}
                    </button>
                  </div>
                }
              />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 text-center text-sm text-slate-400">
              <p>{link.error || "Hämtar korsordet…"}</p>
              {link.error ? (
                <button type="button" onClick={onHome} className="font-semibold text-sky-300 underline underline-offset-2 hover:text-white">
                  Till alla korsord
                </button>
              ) : null}
            </div>
          )}
        </section>

        <div className={noRoom ? "hidden" : shownBesideGrid("contents")}>
          <ChatPanel
            clientId={room.clientId}
            status={room.status}
            connectionError={room.connectionError}
            sendError={room.sendError}
            messages={room.messages}
            reactions={room.reactions}
            onSend={(text) => void room.sendMessage(text)}
            onReact={(messageId, emoji) => void room.react(messageId, emoji)}
            onReconnect={room.reconnect}
            open={chatOpen}
            unread={unread}
            onToggle={toggleChat}
          />
        </div>
      </div>
    </main>
  );
}
