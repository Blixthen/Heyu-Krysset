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

describe("CrosswordGrid photo", () => {
  afterEach(cleanup);
  const PHOTO_ID = "3f2c1a9e-8b4d-4c6e-9a1b-2d3e4f5a6b7c";
  const sharp = (container: HTMLElement) => container.querySelector(`img[src="/api/photo/${PHOTO_ID}"]`);

  it("shows the inline copy, with the stored photo over it", () => {
    const { container } = render(<Harness puzzle={makePuzzle({ photo: PHOTO_ID })} />);
    expect(screen.getByAltText("Korsordet").getAttribute("src")).toBe(puzzle.image);
    expect(sharp(container)).not.toBeNull();
  });

  it("falls back to the inline copy when the stored photo can't load", () => {
    const { container } = render(<Harness puzzle={makePuzzle({ photo: PHOTO_ID })} />);
    fireEvent.error(sharp(container)!);
    expect(sharp(container)).toBeNull();
    expect(screen.getByAltText("Korsordet")).toBeTruthy();
  });

  it("shows only the inline copy for a puzzle without a stored photo", () => {
    const { container } = render(<Harness />);
    expect(container.querySelectorAll("img")).toHaveLength(1);
  });
});

describe("zoom", () => {
  afterEach(cleanup);

  const shown = () => screen.getByRole("button", { name: "Återställ zoom" }).textContent;
  const view = () => cell(0, 0).closest(".overflow-auto") as HTMLElement;

  it("zooms in and out with the buttons and resets to 100 %", () => {
    render(<Harness />);
    expect(shown()).toBe("100 %");
    const width = cell(0, 0).parentElement?.style.width;

    fireEvent.click(screen.getByRole("button", { name: "Zooma in" }));
    fireEvent.click(screen.getByRole("button", { name: "Zooma in" }));
    expect(shown()).toBe("156 %");
    expect(cell(0, 0).parentElement?.style.width).not.toBe(width);

    fireEvent.click(screen.getByRole("button", { name: "Zooma ut" }));
    expect(shown()).toBe("125 %");
    fireEvent.click(screen.getByRole("button", { name: "Återställ zoom" }));
    expect(shown()).toBe("100 %");
    expect(cell(0, 0).parentElement?.style.width).toBe(width);
  });

  it("stops at the largest zoom", () => {
    render(<Harness />);
    for (let i = 0; i < 20; i++) fireEvent.click(screen.getByRole("button", { name: "Zooma in" }));
    expect(shown()).toBe("400 %");
  });

  it("zooms with ctrl or ⌘ and the wheel, and leaves plain scrolling alone", () => {
    render(<Harness />);
    expect(fireEvent.wheel(view(), { deltaY: -200 })).toBe(true);
    expect(shown()).toBe("100 %");

    expect(fireEvent.wheel(view(), { deltaY: -200, ctrlKey: true })).toBe(false);
    expect(shown()).toBe("149 %");
    fireEvent.wheel(view(), { deltaY: 200, metaKey: true });
    expect(shown()).toBe("100 %");
  });

  it("zooms with a two-finger pinch", () => {
    render(<Harness />);
    const touches = (spread: number) => ({ touches: [{ clientX: 100, clientY: 50 }, { clientX: 100 + spread, clientY: 50 }] });
    fireEvent.touchStart(view(), touches(100));
    expect(fireEvent.touchMove(view(), touches(250))).toBe(false);
    expect(shown()).toBe("250 %");

    fireEvent.touchEnd(view(), { touches: [] });
    // One finger pans as usual.
    expect(fireEvent.touchMove(view(), { touches: [{ clientX: 0, clientY: 0 }] })).toBe(true);
    expect(shown()).toBe("250 %");
  });
});
