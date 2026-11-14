"use client";

import {
  cellKey,
  chooseDirection,
  directionForTap,
  findNeighbor,
  nextInWord,
  oneLetter,
  toggleDirection,
  wordCells,
  type Authors,
  type CellPosition,
  type CrosswordPuzzle,
  type Direction,
  type LetterCell,
  type Letters,
} from "@/lib/crossword";
import { photoUrl } from "@/lib/photo";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { PLAYER_COLOURS } from "./PlayerLegend";
import { cellPlacement, ZoomablePhoto } from "./ZoomablePhoto";

const ARROWS: Record<string, { direction: Direction; rowStep: -1 | 0 | 1; colStep: -1 | 0 | 1 }> = {
  ArrowRight: { direction: "across", rowStep: 0, colStep: 1 },
  ArrowLeft: { direction: "across", rowStep: 0, colStep: -1 },
  ArrowDown: { direction: "down", rowStep: 1, colStep: 0 },
  ArrowUp: { direction: "down", rowStep: -1, colStep: 0 },
};

/** Letters are 60% of their square's width: cell.w is in thousandths of the photo's width, so cell.w / 10 cqw is the square. */
const LETTER_SIZE = 0.6 / 10;

export function cellInputId(cell: CellPosition) {
  return `cell-${cell.row}-${cell.col}`;
}

export function focusCell(cell: CellPosition) {
  document.getElementById(cellInputId(cell))?.focus();
}

export function CrosswordGrid({
  puzzle,
  letters,
  authors = {},
  colours = new Map(),
  selectedCell,
  onSelect,
  onLetter,
}: {
  puzzle: CrosswordPuzzle;
  letters: Letters;
  authors?: Authors;
  /** Each author's colour slot, from assignColours. */
  colours?: Map<string, number>;
  selectedCell: CellPosition | null;
  onSelect: (cell: CellPosition) => void;
  onLetter: (cell: CellPosition, letter: string) => void;
}) {
  // Which way typing advances. Selecting a cell picks the way its word runs;
  // arrow keys and tapping the selected cell again change it. The ref holds the
  // latest value for focus handlers that run before React re-renders.
  const [direction, setDirectionState] = useState<Direction>("across");
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const directionRef = useRef<Direction>("across");
  // Whether the cell being tapped already had focus, so a tap can switch direction.
  const wasFocused = useRef(false);
  // Set while typing or an arrow key moves focus, so that focus keeps going the
  // same way instead of being read as a tap on the next cell.
  const moving = useRef(false);

  function setDirection(next: Direction) {
    directionRef.current = next;
    setDirectionState(next);
  }

  function select(next: LetterCell) {
    onSelect({ row: next.row, col: next.col });
    moving.current = true;
    focusCell(next);
    moving.current = false;
    return next;
  }

  /** Typing stays within the word, so finishing one doesn't jump into another. */
  function step(from: LetterCell, sign: -1 | 1) {
    const next = nextInWord(puzzle.cells, from, directionRef.current, sign);
    return next ? select(next) : null;
  }

  function forward(cell: LetterCell) {
    return step(cell, 1);
  }

  function backward(cell: LetterCell) {
    return step(cell, -1);
  }

  // Walking a word scans every cell per step, so it isn't redone for each peer's letter.
  const selectedRow = selectedCell?.row;
  const selectedCol = selectedCell?.col;
  const activeWord = useMemo(() => {
    const selected = puzzle.cells.find((cell) => cell.row === selectedRow && cell.col === selectedCol);
    return new Set(selected ? wordCells(puzzle.cells, selected, direction).map((cell) => cellKey(cell.row, cell.col)) : []);
  }, [puzzle.cells, selectedRow, selectedCol, direction]);

  function onKeyDown(cell: LetterCell, letter: string, event: KeyboardEvent<HTMLInputElement>) {
    const arrow = ARROWS[event.key];
    if (arrow) {
      event.preventDefault();
      // Arrow keys roam the whole grid, jumping over clue squares. At the
      // edge nothing moves, so the direction stays with the current word.
      const next = findNeighbor(puzzle.cells, cell, arrow.rowStep, arrow.colStep);
      if (!next) return;
      setDirection(arrow.direction);
      select(next);
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
    <ZoomablePhoto image={puzzle.image}>
      {/* The sharp stored copy covers the inline one once it loads, and stays hidden if it can't. */}
      {puzzle.photo && failedPhoto !== puzzle.photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photoUrl(puzzle.photo)}
          alt=""
          className="absolute inset-0 size-full select-none"
          onError={() => setFailedPhoto(puzzle.photo ?? null)}
        />
      ) : null}
      {puzzle.cells.map((cell) => {
        const key = cellKey(cell.row, cell.col);
        const isSelected = selectedCell?.row === cell.row && selectedCell?.col === cell.col;
        const inWord = activeWord.size > 1 && activeWord.has(key);
        const letter = letters[key] ?? "";
        const slot = letter ? colours.get(authors[key] ?? "") : undefined;
        const tint = slot === undefined ? null : PLAYER_COLOURS[slot].tint;
        // In the selected word a typed letter keeps its player's tint and gets an outline instead.
        const background = letter ? (tint ?? (inWord ? "bg-sky-100/90" : "bg-white/80")) : inWord ? "bg-sky-300/35" : "bg-white/15";
        const ring = isSelected ? "ring-2 ring-sky-500 ring-inset" : inWord && tint ? "ring-1 ring-sky-400 ring-inset" : "";
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
            onPointerDown={(event) => {
              wasFocused.current = document.activeElement === event.currentTarget;
            }}
            onPointerCancel={() => {
              wasFocused.current = false;
            }}
            onClick={() => {
              if (wasFocused.current) setDirection(toggleDirection(puzzle.cells, cell, directionRef.current));
              wasFocused.current = false;
            }}
            onFocus={(event) => {
              const choose = moving.current ? chooseDirection : directionForTap;
              setDirection(choose(puzzle.cells, cell, directionRef.current));
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
              // At least 16 px, below which iOS zooms the page when a square gets focus.
              fontSize: `max(1rem, ${cell.w * LETTER_SIZE}cqw)`,
              ...cellPlacement(cell),
            }}
            className={`absolute touch-manipulation scroll-mt-3 scroll-mb-[30vh] border border-transparent text-center text-base font-bold text-slate-950 uppercase outline-none ${background} ${ring}`}
          />
        );
      })}
    </ZoomablePhoto>
  );
}
