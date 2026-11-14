// @vitest-environment jsdom
import { MIN_CELLS } from "@/lib/crossword";
import { gridCells, makePuzzle } from "@/test/fixtures";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CellEditor } from "./CellEditor";

const removeButton = (row: number, col: number) => screen.getByRole("button", { name: `Ta bort rutan på rad ${row}, kolumn ${col}` });
const addButton = (row: number, col: number) => screen.getByRole("button", { name: `Lägg till en ruta på rad ${row}, kolumn ${col}` });

describe("CellEditor", () => {
  afterEach(cleanup);

  it("shares the squares as read when nothing is changed", () => {
    const onDone = vi.fn();
    render(<CellEditor puzzle={makePuzzle()} onDone={onDone} onCancel={() => {}} />);
    expect(screen.getByText("9 rutor")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Klar" }));
    const shared = onDone.mock.calls[0][0];
    expect(shared).toEqual({ ...makePuzzle(), createdAt: shared.createdAt });
    expect(shared.createdAt).toBeGreaterThan(makePuzzle().createdAt);
  });

  it("offers a removed square back, and renumbers a square added above the top row", () => {
    const onDone = vi.fn();
    render(<CellEditor puzzle={makePuzzle()} onDone={onDone} onCancel={() => {}} />);
    fireEvent.click(removeButton(3, 3));
    expect(screen.getByText("8 rutor")).toBeTruthy();
    fireEvent.click(addButton(3, 3));
    fireEvent.click(addButton(0, 1));
    fireEvent.click(screen.getByRole("button", { name: "Klar" }));

    const { cells } = onDone.mock.calls[0][0];
    expect(cells).toHaveLength(10);
    expect(cells[0]).toEqual({ row: 0, col: 0, x: 100, y: 0, w: 90, h: 90 });
    expect(cells.at(-1)).toEqual({ row: 3, col: 2, x: 300, y: 300, w: 90, h: 90 });
  });

  it("won't share fewer squares than a puzzle needs", () => {
    const onDone = vi.fn();
    render(<CellEditor puzzle={makePuzzle({ cells: gridCells(1, MIN_CELLS) })} onDone={onDone} onCancel={() => {}} />);
    fireEvent.click(removeButton(1, 1));
    expect(screen.getByText(`Ett korsord behöver minst ${MIN_CELLS} rutor.`)).toBeTruthy();
    const done = screen.getByRole("button", { name: "Klar" });
    expect(done.hasAttribute("disabled")).toBe(true);
    fireEvent.click(done);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("cancels", () => {
    const onCancel = vi.fn();
    render(<CellEditor puzzle={makePuzzle()} onDone={() => {}} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Avbryt" }));
    expect(onCancel).toHaveBeenCalled();
  });
});
