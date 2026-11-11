// @vitest-environment jsdom
import type { CellPosition, Letters } from "@/lib/crossword";
import { makePuzzle } from "@/test/fixtures";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CrosswordGrid } from "./CrosswordGrid";

const puzzle = makePuzzle();

function Harness({ initial = {}, onLetter }: { initial?: Letters; onLetter?: (cell: CellPosition, letter: string) => void }) {
  const [letters, setLetters] = useState<Letters>(initial);
  const [selected, setSelected] = useState<CellPosition | null>(null);
  return (
    <CrosswordGrid
      puzzle={puzzle}
      letters={letters}
      selectedCell={selected}
      onSelect={setSelected}
      onLetter={(cell, letter) => {
        onLetter?.(cell, letter);
        setLetters((current) => ({ ...current, [`${cell.row}-${cell.col}`]: letter }));
      }}
    />
  );
}

const cell = (row: number, col: number) => screen.getByLabelText(`Rad ${row + 1}, ruta ${col + 1}`) as HTMLInputElement;

describe("CrosswordGrid", () => {
  afterEach(cleanup);

  it("renders one input per cell", () => {
    render(<Harness />);
    expect(screen.getAllByRole("textbox")).toHaveLength(puzzle.cells.length);
  });

  it("upper-cases input and advances across by default", () => {
    render(<Harness />);
    cell(0, 0).focus();
    fireEvent.change(cell(0, 0), { target: { value: "ö" } });
    expect(cell(0, 0).value).toBe("Ö");
    expect(document.activeElement).toBe(cell(0, 1));
  });

  it("advances downward after an up/down arrow was used", () => {
    render(<Harness />);
    cell(0, 0).focus();
    fireEvent.keyDown(cell(0, 0), { key: "ArrowDown" });
    expect(document.activeElement).toBe(cell(1, 0));
    fireEvent.change(cell(1, 0), { target: { value: "a" } });
    expect(document.activeElement).toBe(cell(2, 0));
  });

  it("replaces the letter when typing into a filled cell", () => {
    render(<Harness initial={{ "0-0": "A" }} />);
    fireEvent.change(cell(0, 0), { target: { value: "AB" } });
    expect(cell(0, 0).value).toBe("B");
  });

  it("does not advance on non-letters", () => {
    const onLetter = vi.fn();
    render(<Harness onLetter={onLetter} />);
    cell(0, 0).focus();
    fireEvent.change(cell(0, 0), { target: { value: "1" } });
    expect(onLetter).toHaveBeenCalledWith({ row: 0, col: 0 }, "");
    expect(document.activeElement).toBe(cell(0, 0));
  });

  it("backspace in an empty cell steps back and clears the previous cell", () => {
    render(<Harness initial={{ "0-0": "A" }} />);
    cell(0, 1).focus();
    fireEvent.keyDown(cell(0, 1), { key: "Backspace" });
    expect(document.activeElement).toBe(cell(0, 0));
    expect(cell(0, 0).value).toBe("");
  });

  it("arrow keys stop at the edge", () => {
    render(<Harness />);
    cell(0, 2).focus();
    fireEvent.keyDown(cell(0, 2), { key: "ArrowRight" });
    expect(document.activeElement).toBe(cell(0, 2));
  });
});
