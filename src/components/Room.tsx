"use client";

import { useCrosswordRoom } from "@/hooks/useCrosswordRoom";
import { useLinkedPuzzle } from "@/hooks/useLinkedPuzzle";
import { countUnread } from "@/lib/chat";
import type { CellPosition, CrosswordPuzzle } from "@/lib/crossword";
import { playerColours } from "@/lib/players";
import { restartedPuzzle } from "@/lib/storedPuzzle";
import { Grid3x3, Maximize2, Minimize2, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { ChatPanel, StatusBadge } from "./ChatPanel";
import { CellEditor } from "./CellEditor";
import { CrosswordGrid, focusCell } from "./CrosswordGrid";
import { PLAYER_COLOURS, PlayerLegend } from "./PlayerLegend";
import { keepPuzzle, PuzzleUploader, savePuzzle, type Draft } from "./PuzzleUploader";

export function Room({
  nickname,
  linkedPuzzleId,
  onLeave,
}: {
  nickname: string;
  /** A stored puzzle to open, from a permanent link. */
  linkedPuzzleId?: string;
  onLeave: () => void;
}) {
  const room = useCrosswordRoom(nickname);
  const [selectedCell, setSelectedCell] = useState<CellPosition | null>(null);
  // A photo this player read, while they check its squares before sharing it.
  const [draft, setDraft] = useState<Draft | null>(null);
  const { puzzle, letters, authors } = room.board;
  const link = useLinkedPuzzle(linkedPuzzleId, puzzle?.id, room.restorePuzzle);
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
    onPuzzle(next);
    void keepPuzzle(next, draft.file, onPhoto);
  }

  function openLinked() {
    const opened = link.open();
    if (opened) selectFirst(opened);
  }

  function onPhoto(puzzleId: string, photo: string) {
    const updated = room.attachPhoto(puzzleId, photo);
    // keepPuzzle saves only the puzzle it was given; a copy started over before the photo was stored needs it too.
    if (updated && updated.id !== puzzleId) void savePuzzle(updated);
  }

  function restart() {
    if (!puzzle || !window.confirm("Börja om korsordet? Alla bokstäver försvinner, för alla i rummet.")) return;
    const next = restartedPuzzle(puzzle, crypto.randomUUID(), Date.now());
    onPuzzle(next);
    // The same squares and photo, so only the copy needs saving for its link.
    void savePuzzle(next);
  }

  return (
    <main className="flex h-dvh max-h-dvh flex-col overflow-hidden pb-[env(safe-area-inset-bottom)]">
      {/* Phones have no room beside the title and buttons, so the photo gets its own row above them. */}
      <header className={`${shownBesideGrid("grid")} shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-slate-800 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:px-5`}>
        {/* Decoration only. The still frame stands in when the user asks for less motion. */}
        <picture className="col-span-2 justify-self-center sm:col-span-1 sm:col-start-2 sm:row-start-1">
          <source media="(prefers-reduced-motion: reduce)" srcSet="/banner-still.webp" />
          {/* Square crop of a portrait photo; 30% from the top keeps the whole face in. */}
          <img
            src="/banner.webp"
            alt=""
            className="size-24 rounded-2xl object-cover object-[50%_30%] sm:size-28 lg:size-32"
          />
        </picture>
        <div className="flex min-w-0 items-center gap-3 sm:row-start-1">
          {/* Phones need the room for the buttons beside the title. */}
          <span className="hidden size-10 shrink-0 items-center justify-center rounded-2xl bg-sky-400/15 text-sky-300 sm:flex">
            <Grid3x3 className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-50">Heyus Fredagskryss</p>
            <p className="truncate text-xs text-slate-400">Inloggad som {nickname}</p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 sm:col-start-3 sm:row-start-1">
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
          {puzzle || draft ? <PuzzleUploader compact onRead={startDraft} /> : null}
          <button
            type="button"
            onClick={onLeave}
            className="min-h-9 shrink-0 rounded-full border border-slate-700 px-3 text-xs font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white"
          >
            Byt namn
          </button>
        </div>
      </header>

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
            <PuzzleUploader onRead={startDraft} />
          )}
        </section>

        <div className={shownBesideGrid("contents")}>
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
