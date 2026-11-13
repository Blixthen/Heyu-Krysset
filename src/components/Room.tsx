"use client";

import { useCrosswordRoom } from "@/hooks/useCrosswordRoom";
import { useLinkedPuzzle } from "@/hooks/useLinkedPuzzle";
import { countUnread } from "@/lib/chat";
import type { CellPosition, CrosswordPuzzle } from "@/lib/crossword";
import { playerColours } from "@/lib/players";
import { restartedPuzzle } from "@/lib/storedPuzzle";
import { Grid3x3, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { ChatPanel } from "./ChatPanel";
import { CrosswordGrid, focusCell } from "./CrosswordGrid";
import { PLAYER_COLOURS, PlayerLegend } from "./PlayerLegend";
import { PuzzleUploader, savePuzzle } from "./PuzzleUploader";

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
  const unread = chatOpen ? 0 : countUnread(room.messages, lastSeenId, room.clientId);

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

  function openLinked() {
    const opened = link.open();
    if (opened) selectFirst(opened);
  }

  function onPhoto(puzzleId: string, photo: string) {
    const updated = room.attachPhoto(puzzleId, photo);
    // The uploader saves only the puzzle it uploaded; a copy started over before the photo was stored needs it too.
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
      <header className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-slate-800 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:px-5">
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
          <span className="flex size-10 items-center justify-center rounded-2xl bg-sky-400/15 text-sky-300">
            <Grid3x3 className="size-5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-50">Heyus Fredagskryss</p>
            <p className="text-xs text-slate-400">Inloggad som {nickname}</p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 sm:col-start-3 sm:row-start-1">
          {puzzle ? (
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
          {puzzle ? <PuzzleUploader compact onPuzzle={onPuzzle} onPhoto={onPhoto} /> : null}
          <button
            type="button"
            onClick={onLeave}
            className="min-h-11 rounded-full border border-slate-700 px-3 py-1.5 text-sm font-bold text-slate-300 transition hover:border-slate-500 hover:text-white"
          >
            Byt namn
          </button>
        </div>
      </header>

      {link.error ? (
        <p className="shrink-0 border-b border-slate-800 px-4 py-2 text-xs text-amber-300">{link.error}</p>
      ) : null}
      {link.elsewhere ? (
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
          chatOpen ? "grid-rows-[minmax(0,1fr)_minmax(9.5rem,36dvh)]" : "grid-rows-[minmax(0,1fr)_auto]"
        } lg:grid-cols-[minmax(0,1fr)_380px] lg:grid-rows-1`}
      >
        <section className="flex min-h-0 items-stretch justify-center overflow-hidden p-2 sm:p-4">
          {puzzle ? (
            <div className="flex min-h-0 w-full flex-col gap-2">
              <PlayerLegend colours={colours} />
              <div className="min-h-0 flex-1">
                <CrosswordGrid
                  puzzle={puzzle}
                  letters={letters}
                  authors={authors}
                  colours={colours}
                  selectedCell={selectedCell}
                  onSelect={setSelectedCell}
                  onLetter={(cell, letter) => room.setLetter(cell.row, cell.col, letter)}
                />
              </div>
            </div>
          ) : (
            <PuzzleUploader onPuzzle={onPuzzle} onPhoto={onPhoto} />
          )}
        </section>

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
    </main>
  );
}
