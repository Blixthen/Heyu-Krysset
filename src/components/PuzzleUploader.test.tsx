// @vitest-environment jsdom
import { gridCells } from "@/test/fixtures";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prepareImages = vi.hoisted(() => vi.fn());
vi.mock("@/lib/image", () => ({ prepareImages }));

const { analyzeCrossword, PuzzleUploader } = await import("./PuzzleUploader");

const file = new File(["x"], "kryss.jpg", { type: "image/jpeg" });

describe("analyzeCrossword", () => {
  beforeEach(() => {
    prepareImages.mockResolvedValue({
      analyzeBase64: "HIGHRES",
      mimeType: "image/jpeg",
      shareDataUrl: "data:image/jpeg;base64,SMALL",
    });
  });

  it("sends the high-quality image to Gemini and shares the small one", async () => {
    const cells = gridCells();
    const fetchMock = vi.fn(async () => Response.json({ cells: [...cells, cells[0]] }));
    vi.stubGlobal("fetch", fetchMock);

    const puzzle = await analyzeCrossword(file);

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ image: "HIGHRES", mimeType: "image/jpeg" });
    expect(puzzle.image).toBe("data:image/jpeg;base64,SMALL");
    expect(puzzle.cells).toEqual(cells);
    expect(puzzle.id).toBeTruthy();
    expect(puzzle.createdAt).toBeGreaterThan(0);
  });

  it("surfaces the server's error message", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ error: "Hittade för få bokstavsrutor i bilden." }, { status: 502 }));
    await expect(analyzeCrossword(file)).rejects.toThrow("Hittade för få bokstavsrutor i bilden.");
  });

  it("explains unreadable images", async () => {
    prepareImages.mockRejectedValue(new DOMException("The source image could not be decoded."));
    await expect(analyzeCrossword(file)).rejects.toThrow(/Kunde inte läsa bilden/);
  });

  it("explains timeouts", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new DOMException("timed out", "TimeoutError");
    });
    await expect(analyzeCrossword(file)).rejects.toThrow(/för lång tid/);
  });

  it("rejects a malformed success response", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ cells: [{ row: 0 }] }));
    await expect(analyzeCrossword(file)).rejects.toThrow("Kunde inte tolka bilden.");
  });
});

describe("PuzzleUploader", () => {
  afterEach(cleanup);

  it("compact mode offers loading a new puzzle and reports errors inline", async () => {
    prepareImages.mockRejectedValue(new Error("nope"));
    const onPuzzle = vi.fn();
    render(<PuzzleUploader compact onPuzzle={onPuzzle} />);
    expect(screen.getByText("Nytt korsord")).toBeTruthy();

    fireEvent.change(screen.getByTestId("file-input"), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText(/Kunde inte läsa bilden/)).toBeTruthy());
    expect(onPuzzle).not.toHaveBeenCalled();
  });
});
