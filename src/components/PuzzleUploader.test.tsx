// @vitest-environment jsdom
import { gridCells } from "@/test/fixtures";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prepareImages = vi.hoisted(() => vi.fn());
const prepareStoreCopy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/image", () => ({ prepareImages, prepareStoreCopy }));
const readGrid = vi.hoisted(() => vi.fn());
vi.mock("@/lib/gridImage", () => ({ readGrid }));

const { analyzeCrossword, PuzzleUploader, storePhoto } = await import("./PuzzleUploader");

const file = new File(["x"], "kryss.jpg", { type: "image/jpeg" });

const pixels = { width: 2, height: 1, data: new Uint8ClampedArray(8) };

describe("analyzeCrossword", () => {
  beforeEach(() => {
    readGrid.mockReset().mockReturnValue(null);
    vi.spyOn(console, "info").mockImplementation(() => {});
    prepareImages.mockResolvedValue({
      pixels,
      analyzeBase64: "HIGHRES",
      mimeType: "image/jpeg",
      shareDataUrl: "data:image/jpeg;base64,SMALL",
    });
  });

  it("reads the grid in the browser without calling Gemini", async () => {
    const cells = gridCells(2, 5);
    readGrid.mockReturnValue(cells);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const puzzle = await analyzeCrossword(file);

    expect(readGrid).toHaveBeenCalledWith(pixels);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(puzzle.cells).toEqual(cells);
    expect(puzzle.image).toBe("data:image/jpeg;base64,SMALL");
  });

  it("asks Gemini without reading the grid when the browser gave no pixels", async () => {
    prepareImages.mockResolvedValue({ pixels: null, analyzeBase64: "HIGHRES", mimeType: "image/jpeg", shareDataUrl: "data:image/jpeg;base64,SMALL" });
    const cells = gridCells(2, 4);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ cells })));

    expect((await analyzeCrossword(file)).cells).toEqual(cells);
    expect(readGrid).not.toHaveBeenCalled();
  });

  it("asks Gemini when the grid reading fails with an error", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    readGrid.mockImplementation(() => {
      throw new RangeError("bug");
    });
    const cells = gridCells(3, 3);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ cells })));

    expect((await analyzeCrossword(file)).cells).toEqual(cells);
    expect(consoleError).toHaveBeenCalledWith(expect.any(RangeError));
  });

  it("sends the high-quality image to Gemini when no grid is found, and shares the small one", async () => {
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

const PHOTO_ID = "3f2c1a9e-8b4d-4c6e-9a1b-2d3e4f5a6b7c";
const storeBlob = new Blob(["sharp"], { type: "image/jpeg" });

describe("storePhoto", () => {
  beforeEach(() => {
    prepareStoreCopy.mockReset().mockResolvedValue(storeBlob);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("uploads the sharp copy and returns its id", async () => {
    const fetchMock = vi.fn(async () => Response.json({ id: PHOTO_ID }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await storePhoto(file)).toBe(PHOTO_ID);
    expect(prepareStoreCopy).toHaveBeenCalledWith(file);
    expect(fetchMock).toHaveBeenCalledWith("/api/photo", expect.objectContaining({ method: "POST", body: storeBlob }));
  });

  it.each([
    ["the upload fails", () => Promise.reject(new TypeError("offline"))],
    ["the server refuses", async () => Response.json({ error: "Bilden är för stor." }, { status: 413 })],
    ["the reply has no valid id", async () => Response.json({ id: "../x" })],
  ])("gives null when %s", async (_name, reply) => {
    vi.stubGlobal("fetch", vi.fn(reply));
    expect(await storePhoto(file)).toBeNull();
  });

  it("skips the upload when the browser couldn't make the copy", async () => {
    prepareStoreCopy.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await storePhoto(file)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("PuzzleUploader", () => {
  afterEach(cleanup);

  it("shares the puzzle first, then reports the stored photo for it", async () => {
    readGrid.mockReturnValue(gridCells(2, 5));
    prepareImages.mockResolvedValue({ pixels, analyzeBase64: "HIGHRES", mimeType: "image/jpeg", shareDataUrl: "data:image/jpeg;base64,SMALL" });
    let finishUpload: (response: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => (finishUpload = resolve))));
    prepareStoreCopy.mockResolvedValue(storeBlob);
    const onPuzzle = vi.fn();
    const onPhoto = vi.fn();
    render(<PuzzleUploader onPuzzle={onPuzzle} onPhoto={onPhoto} />);

    fireEvent.change(screen.getByTestId("file-input"), { target: { files: [file] } });
    await waitFor(() => expect(onPuzzle).toHaveBeenCalledTimes(1));
    expect(onPuzzle.mock.calls[0][0].photo).toBeUndefined();
    expect(onPhoto).not.toHaveBeenCalled();

    finishUpload(Response.json({ id: PHOTO_ID }));
    await waitFor(() => expect(onPhoto).toHaveBeenCalledWith(onPuzzle.mock.calls[0][0].id, PHOTO_ID));
  });

  it("stores nothing for a photo that couldn't be read", async () => {
    readGrid.mockReturnValue(null);
    prepareImages.mockResolvedValue({ pixels, analyzeBase64: "HIGHRES", mimeType: "image/jpeg", shareDataUrl: "data:image/jpeg;base64,SMALL" });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Kunde inte tolka bilden." }, { status: 422 })));
    prepareStoreCopy.mockReset();
    render(<PuzzleUploader onPuzzle={vi.fn()} onPhoto={vi.fn()} />);

    fireEvent.change(screen.getByTestId("file-input"), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText("Kunde inte tolka bilden.")).toBeTruthy());
    expect(prepareStoreCopy).not.toHaveBeenCalled();
  });

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
