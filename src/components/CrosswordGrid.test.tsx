// @vitest-environment jsdom
import type { Authors, CellPosition, CrosswordPuzzle, Letters } from "@/lib/crossword";
import { makePuzzle } from "@/test/fixtures";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CrosswordGrid } from "./CrosswordGrid";

const puzzle = makePuzzle();

// Row 0 is an across word, then a clue square and a one-letter cell; columns 0
// and 2 are down words; (1,1) and (2,1) are clue squares.
//   A B C . H
//   D . E
//   F . G
const withClues = makePuzzle({
  cells: [[0, 0], [0, 1], [0, 2], [0, 4], [1, 0], [1, 2], [2, 0], [2, 2]].map(([row, col]) => ({
    row,
    col,
    x: 100 + col * 100,
    y: 100 + row * 100,
    w: 90,
    h: 90,
  })),
});

function Harness({
  initial = {},
  authors,
  colours,
  onLetter,
  puzzle: shown = puzzle,
}: {
  initial?: Letters;
  authors?: Authors;
  colours?: Map<string, number>;
  onLetter?: (cell: CellPosition, letter: string) => void;
  puzzle?: CrosswordPuzzle;
}) {
  const [letters, setLetters] = useState<Letters>(initial);
  const [selected, setSelected] = useState<CellPosition | null>(null);
  return (
    <CrosswordGrid
      puzzle={shown}
      letters={letters}
      authors={authors}
      colours={colours}
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
const background = (input: HTMLElement) => input.className.match(/\bbg-\S+/)?.[0];

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

  it("types downward after selecting a cell in a down word", () => {
    render(<Harness puzzle={withClues} />);
    cell(1, 2).focus();
    fireEvent.change(cell(1, 2), { target: { value: "a" } });
    expect(document.activeElement).toBe(cell(2, 2));
  });

  it("types across again after selecting a cell in an across word", () => {
    render(<Harness puzzle={withClues} />);
    cell(1, 0).focus();
    cell(0, 1).focus();
    fireEvent.change(cell(0, 1), { target: { value: "a" } });
    expect(document.activeElement).toBe(cell(0, 2));
  });

  it("switches direction when the selected cell is tapped again", () => {
    render(<Harness />);
    cell(1, 1).focus();
    fireEvent.pointerDown(cell(1, 1));
    fireEvent.click(cell(1, 1));
    fireEvent.change(cell(1, 1), { target: { value: "a" } });
    expect(document.activeElement).toBe(cell(2, 1));
  });

  it("does not switch direction after a cancelled tap", () => {
    render(<Harness />);
    cell(1, 1).focus();
    fireEvent.pointerDown(cell(1, 1));
    fireEvent.pointerCancel(cell(1, 1));
    fireEvent.click(cell(1, 1));
    fireEvent.change(cell(1, 1), { target: { value: "a" } });
    expect(document.activeElement).toBe(cell(1, 2));
  });

  it("types down from a tapped cell that starts a down word in the middle of an across word", () => {
    render(<Harness />);
    cell(0, 1).focus();
    fireEvent.change(cell(0, 1), { target: { value: "a" } });
    expect(document.activeElement).toBe(cell(1, 1));
  });

  it("keeps typing across into a cell that starts a down word", () => {
    render(<Harness />);
    cell(0, 0).focus();
    fireEvent.change(cell(0, 0), { target: { value: "a" } });
    expect(document.activeElement).toBe(cell(0, 1));
    fireEvent.change(cell(0, 1), { target: { value: "b" } });
    expect(document.activeElement).toBe(cell(0, 2));
  });

  it("keeps the word's direction when an arrow key hits the edge", () => {
    render(<Harness puzzle={withClues} />);
    cell(1, 0).focus();
    fireEvent.keyDown(cell(1, 0), { key: "ArrowLeft" });
    fireEvent.change(cell(1, 0), { target: { value: "a" } });
    expect(document.activeElement).toBe(cell(2, 0));
  });

  it("does not switch direction on the first tap", () => {
    render(<Harness />);
    fireEvent.pointerDown(cell(1, 1));
    cell(1, 1).focus();
    fireEvent.click(cell(1, 1));
    fireEvent.change(cell(1, 1), { target: { value: "a" } });
    expect(document.activeElement).toBe(cell(1, 2));
  });

  it("stops at the end of a word instead of jumping over a clue square", () => {
    render(<Harness puzzle={withClues} />);
    cell(0, 1).focus();
    fireEvent.change(cell(0, 1), { target: { value: "a" } });
    expect(document.activeElement).toBe(cell(0, 2));
    fireEvent.change(cell(0, 2), { target: { value: "b" } });
    expect(document.activeElement).toBe(cell(0, 2));
  });

  it("tints each letter by who typed it, the same colour for the same player", () => {
    render(
      <Harness
        initial={{ "0-0": "A", "0-1": "B", "1-1": "C", "0-2": "D" }}
        authors={{ "0-0": "Kim", "0-1": "Ann", "1-1": "Kim", "1-0": "Kim" }}
        colours={new Map([["Kim", 0], ["Ann", 1]])}
      />,
    );
    const kim = background(cell(0, 0));
    expect(kim).toMatch(/^bg-\w+-300\/40$/);
    expect(background(cell(1, 1))).toBe(kim);
    expect(background(cell(0, 1))).toMatch(/^bg-\w+-300\/40$/);
    expect(background(cell(0, 1))).not.toBe(kim);
    // A letter without an author stays plain, and an author without a letter shows nothing.
    expect(background(cell(0, 2))).toBe("bg-white/80");
    expect(background(cell(1, 0))).toBe("bg-white/15");
  });

  it("keeps the player's tint in the selected word and outlines it instead", () => {
    render(<Harness initial={{ "0-1": "B", "0-2": "C" }} authors={{ "0-1": "Kim" }} colours={new Map([["Kim", 0]])} />);
    const kim = background(cell(0, 1));
    act(() => cell(0, 0).focus());
    expect(background(cell(0, 1))).toBe(kim);
    expect(cell(0, 1).className).toMatch(/\bring-sky-400\b/);
    // A letter nobody is credited for still shows the word's own highlight.
    expect(background(cell(0, 2))).toBe("bg-sky-100/90");
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
    render(<Harness initial={{ "1-0": "A" }} />);
    cell(1, 1).focus();
    fireEvent.keyDown(cell(1, 1), { key: "Backspace" });
    expect(document.activeElement).toBe(cell(1, 0));
    expect(cell(1, 0).value).toBe("");
  });

  it("arrow keys stop at the edge", () => {
    render(<Harness />);
    cell(0, 2).focus();
    fireEvent.keyDown(cell(0, 2), { key: "ArrowRight" });
    expect(document.activeElement).toBe(cell(0, 2));
  });
});
