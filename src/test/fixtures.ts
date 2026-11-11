import type { CrosswordPuzzle, LetterCell } from "@/lib/crossword";

/** A 3×3 grid of 100-unit cells starting at (100, 100). */
export function gridCells(rows = 3, cols = 3): LetterCell[] {
  const cells: LetterCell[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      cells.push({ row, col, x: 100 + col * 100, y: 100 + row * 100, w: 90, h: 90 });
    }
  }
  return cells;
}

export const TINY_JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

export function makePuzzle(overrides: Partial<CrosswordPuzzle> = {}): CrosswordPuzzle {
  return {
    id: "puzzle-1",
    createdAt: 1_000,
    image: TINY_JPEG,
    cells: gridCells(),
    ...overrides,
  };
}
