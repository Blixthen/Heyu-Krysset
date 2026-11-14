"use client";

import { addableCells, canFinish, editedPuzzle, toggleCell } from "@/lib/cellEditing";
import { cellKey, MIN_CELLS, type CrosswordPuzzle, type LetterCell } from "@/lib/crossword";
import { Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { cellPlacement, ZoomablePhoto } from "./ZoomablePhoto";

/**
 * Lets the player who read a photo fix its letter squares before sharing it:
 * tapping a square removes it, tapping a + next to one adds it. Optional,
 * since "Klar" shares the squares as read.
 */
export function CellEditor({
  puzzle,
  onDone,
  onCancel,
}: {
  puzzle: CrosswordPuzzle;
  /** The puzzle to share, with the fixed squares. */
  onDone: (puzzle: CrosswordPuzzle) => void;
  onCancel: () => void;
}) {
  const [cells, setCells] = useState(puzzle.cells);
  const addable = useMemo(() => addableCells(cells, puzzle.cells), [cells, puzzle.cells]);
  const ready = canFinish(cells);

  function toggle(cell: LetterCell) {
    setCells((current) => toggleCell(current, cell));
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-2">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 px-1">
        <p className="min-w-0 flex-1 text-sm text-slate-300">
          {ready
            ? "Stämmer rutorna? Tryck på en ruta för att ta bort den, eller på + för att lägga till en."
            : `Ett korsord behöver minst ${MIN_CELLS} rutor.`}
        </p>
        <span className="text-xs text-slate-400 tabular-nums">{cells.length} rutor</span>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-9 rounded-full border border-slate-700 px-3 text-xs font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white"
        >
          Avbryt
        </button>
        <button
          type="button"
          disabled={!ready}
          onClick={() => onDone(editedPuzzle(puzzle, cells, Date.now()))}
          className="min-h-9 rounded-full bg-sky-400 px-4 text-xs font-bold text-slate-950 transition hover:bg-sky-300 disabled:bg-slate-700 disabled:text-slate-400"
        >
          Klar
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <ZoomablePhoto image={puzzle.image}>
          {cells.map((cell) => (
            <button
              key={cellKey(cell.row, cell.col)}
              type="button"
              aria-label={`Ta bort rutan på rad ${cell.row + 1}, kolumn ${cell.col + 1}`}
              onClick={() => toggle(cell)}
              style={cellPlacement(cell)}
              className="group absolute flex touch-manipulation items-center justify-center border-2 border-sky-400 bg-sky-300/25 text-rose-600 hover:bg-rose-300/40"
            >
              <X className="size-1/2 opacity-0 group-hover:opacity-100" />
            </button>
          ))}
          {addable.map((cell) => (
            <button
              key={cellKey(cell.row, cell.col)}
              type="button"
              aria-label={`Lägg till en ruta på rad ${cell.row + 1}, kolumn ${cell.col + 1}`}
              onClick={() => toggle(cell)}
              style={cellPlacement(cell)}
              className="absolute flex touch-manipulation items-center justify-center border border-dashed border-emerald-500/70 text-emerald-600/80 hover:bg-emerald-300/40"
            >
              <Plus className="size-1/2" />
            </button>
          ))}
        </ZoomablePhoto>
      </div>
    </div>
  );
}
