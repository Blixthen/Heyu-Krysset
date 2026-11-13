"use client";

import { useCrosswordRoom } from "@/hooks/useCrosswordRoom";
import { countUnread } from "@/lib/chat";
import type { CellPosition, CrosswordPuzzle } from "@/lib/crossword";
import { assignColours } from "@/lib/players";
import { Grid3x3 } from "lucide-react";
import { useMemo, useState } from "react";
import { ChatPanel } from "./ChatPanel";
import { CrosswordGrid, focusCell } from "./CrosswordGrid";
import { PLAYER_COLOURS, PlayerLegend } from "./PlayerLegend";
import { PuzzleUploader } from "./PuzzleUploader";

export function Room({ nickname, onLeave }: { nickname: string; onLeave: () => void }) {
  const room = useCrosswordRoom(nickname);
  const [selectedCell, setSelectedCell] = useState<CellPosition | null>(null);
  const { puzzle, letters, authors } = room.board;
  const colours = useMemo(() => assignColours(Object.values(authors), PLAYER_COLOURS.length), [authors]);
  // On phones the chat folds down to a bar so the crossword gets the screen;
  // on wide screens it is always shown beside the grid.
  const [chatOpen, setChatOpen] = useState(false);
  const [lastSeenId, setLastSeenId] = useState<string | null>(null);
  const unread = chatOpen ? 0 : countUnread(room.messages, lastSeenId, room.clientId);

  function toggleChat() {
    if (chatOpen) setLastSeenId(room.messages.at(-1)?.id ?? null);
    setChatOpen(!chatOpen);
  }

  function onPuzzle(next: CrosswordPuzzle) {
    room.publishPuzzle(next);
    const first = next.cells[0];
    setSelectedCell(first ? { row: first.row, col: first.col } : null);
    if (first) requestAnimationFrame(() => focusCell(first));
  }

  return (
    <main className="flex h-dvh max-h-dvh flex-col overflow-hidden pb-[env(safe-area-inset-bottom)]">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-800 px-4 py-3 sm:px-5">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-2xl bg-sky-400/15 text-sky-300">
            <Grid3x3 className="size-5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-50">Heyus Fredagskryss</p>
            <p className="text-xs text-slate-400">Inloggad som {nickname}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {puzzle ? <PuzzleUploader compact onPuzzle={onPuzzle} /> : null}
          <button
            type="button"
            onClick={onLeave}
            className="min-h-11 rounded-full border border-slate-700 px-3 py-1.5 text-sm font-bold text-slate-300 transition hover:border-slate-500 hover:text-white"
          >
            Byt namn
          </button>
        </div>
      </header>

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
            <PuzzleUploader onPuzzle={onPuzzle} />
          )}
        </section>

        <ChatPanel
          clientId={room.clientId}
          status={room.status}
          connectionError={room.connectionError}
          sendError={room.sendError}
          messages={room.messages}
          onSend={(text) => void room.sendMessage(text)}
          onReconnect={room.reconnect}
          open={chatOpen}
          unread={unread}
          onToggle={toggleChat}
        />
      </div>
    </main>
  );
}
