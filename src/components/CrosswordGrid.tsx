"use client";

import { cellKey, findNeighbor, oneLetter, type CellPosition, type CrosswordPuzzle, type LetterCell, type Letters } from "@/lib/crossword";
import { useState, type KeyboardEvent } from "react";

type Direction = "across" | "down";

const ARROWS: Record<string, { direction: Direction; rowStep: -1 | 0 | 1; colStep: -1 | 0 | 1 }> = {
  ArrowRight: { direction: "across", rowStep: 0, colStep: 1 },
  ArrowLeft: { direction: "across", rowStep: 0, colStep: -1 },
  ArrowDown: { direction: "down", rowStep: 1, colStep: 0 },
  ArrowUp: { direction: "down", rowStep: -1, colStep: 0 },
};

export function cellInputId(cell: CellPosition) {
  return `cell-${cell.row}-${cell.col}`;
}

export function focusCell(cell: CellPosition) {
  document.getElementById(cellInputId(cell))?.focus();
}

export function CrosswordGrid({
  puzzle,
  letters,
  selectedCell,
  onSelect,
  onLetter,
}: {
  puzzle: CrosswordPuzzle;
  letters: Letters;
  selectedCell: CellPosition | null;
  onSelect: (cell: CellPosition) => void;
  onLetter: (cell: CellPosition, letter: string) => void;
}) {
  // The last arrow key pressed decides which way typing advances.
  const [direction, setDirection] = useState<Direction>("across");

  function move(from: LetterCell, rowStep: -1 | 0 | 1, colStep: -1 | 0 | 1) {
    const next = findNeighbor(puzzle.cells, from, rowStep, colStep);
    if (!next) return null;
    onSelect({ row: next.row, col: next.col });
    focusCell(next);
    return next;
  }

  function forward(cell: LetterCell) {
    return direction === "across" ? move(cell, 0, 1) : move(cell, 1, 0);
  }

  function backward(cell: LetterCell) {
    return direction === "across" ? move(cell, 0, -1) : move(cell, -1, 0);
  }

  function onKeyDown(cell: LetterCell, letter: string, event: KeyboardEvent<HTMLInputElement>) {
    const arrow = ARROWS[event.key];
    if (arrow) {
      event.preventDefault();
      setDirection(arrow.direction);
      move(cell, arrow.rowStep, arrow.colStep);
      return;
    }
    // Backspace in an empty cell steps back and clears the previous one.
    if (event.key === "Backspace" && !letter) {
      event.preventDefault();
      const previous = backward(cell);
      if (previous) onLetter(previous, "");
    }
  }

  return (
    <div className="h-full max-h-full w-full touch-pan-x touch-pan-y overflow-auto overscroll-contain [-webkit-overflow-scrolling:touch]">
      <div className="relative mx-auto w-[max(100%,920px)]">
        {/* A data: URL from a peer; next/image cannot optimize it. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={puzzle.image} alt="Korsordet" className="block h-auto w-full select-none" />
        {puzzle.cells.map((cell) => {
          const key = cellKey(cell.row, cell.col);
          const selected = selectedCell?.row === cell.row && selectedCell?.col === cell.col;
          const letter = letters[key] ?? "";
          return (
            <input
              key={key}
              id={cellInputId(cell)}
              aria-label={`Rad ${cell.row + 1}, ruta ${cell.col + 1}`}
              value={letter}
              inputMode="text"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="characters"
              spellCheck={false}
              onFocus={(event) => {
                onSelect({ row: cell.row, col: cell.col });
                const input = event.currentTarget;
                input.select();
                input.scrollIntoView?.({ block: "nearest", inline: "nearest" });
              }}
              onChange={(event) => {
                // No maxLength: typing into a filled cell replaces its letter.
                const next = oneLetter(event.target.value);
                onLetter({ row: cell.row, col: cell.col }, next);
                if (next) forward(cell);
              }}
              onKeyDown={(event) => onKeyDown(cell, letter, event)}
              style={{
                left: `${cell.x / 10}%`,
                top: `${cell.y / 10}%`,
                width: `${cell.w / 10}%`,
                height: `${cell.h / 10}%`,
              }}
              className={`absolute touch-manipulation scroll-mt-3 scroll-mb-[30vh] border border-transparent text-center text-base font-bold text-slate-950 uppercase outline-none ${
                letter ? "bg-white/80" : "bg-white/15"
              } ${selected ? "ring-2 ring-sky-500 ring-inset" : ""}`}
            />
          );
        })}
      </div>
    </div>
  );
}
