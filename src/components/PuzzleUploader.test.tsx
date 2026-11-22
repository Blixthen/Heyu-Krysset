// @vitest-environment jsdom
import { gridCells, makePuzzle } from "@/test/fixtures";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prepareImages = vi.hoisted(() => vi.fn());
const prepareStoreCopy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/image", () => ({ prepareImages, prepareStoreCopy }));
const readGrid = vi.hoisted(() => vi.fn());
vi.mock("@/lib/gridImage", () => ({ readGrid }));

const { analyzeCrossword, keepPuzzle, PuzzleUploader, savePuzzle, storePhoto } = await import("./PuzzleUploader");

const file = new File(["x"], "kryss.jpg", { type: "image/jpeg" });

const pixels = { width: 2, height: 1, data: new Uint8ClampedArray(8) };

describe("analyzeCrossword", () => {
  beforeEach(() => {
    readGrid.mockReset().mockReturnValue(null);
    prepareImages.mockResolvedValue({ pixels, shareDataUrl: "data:image/jpeg;base64,SMALL" });
  });

  it("reads the grid in the browser and shares the small image, without any request", async () => {
    const cells = gridCells(2, 5);
    readGrid.mockReturnValue(cells);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const puzzle = await analyzeCrossword(file);

    expect(readGrid).toHaveBeenCalledWith(pixels);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(puzzle.cells).toEqual(cells);
    expect(puzzle.image).toBe("data:image/jpeg;base64,SMALL");
    expect(puzzle.id).toBeTruthy();
    expect(puzzle.createdAt).toBeGreaterThan(0);
  });

  it("explains a photo with no grid in it", async () => {
    await expect(analyzeCrossword(file)).rejects.toThrow(/Hittade inget korsord/);
  });

  it("explains a grid reading that fails with an error, and logs it", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    readGrid.mockImplementation(() => {
      throw new RangeError("bug");
    });

    await expect(analyzeCrossword(file)).rejects.toThrow(/Hittade inget korsord/);
    expect(consoleError).toHaveBeenCalledWith(expect.any(RangeError));
  });

  it("explains a browser that won't hand out the pixels, without reading the grid", async () => {
    prepareImages.mockResolvedValue({ pixels: null, shareDataUrl: "data:image/jpeg;base64,SMALL" });
    await expect(analyzeCrossword(file)).rejects.toThrow(/Webbläsaren lät oss inte läsa bilden/);
    expect(readGrid).not.toHaveBeenCalled();
  });

  it("explains unreadable images", async () => {
    prepareImages.mockRejectedValue(new DOMException("The source image could not be decoded."));
    await expect(analyzeCrossword(file)).rejects.toThrow(/Kunde inte läsa bilden/);
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

describe("savePuzzle", () => {
  it.each([
    ["it is stored", async () => Response.json({ id: "x" }), true],
    ["the server refuses", async () => Response.json({ error: "x" }, { status: 409 }), false],
    ["the request fails", () => Promise.reject(new TypeError("offline")), false],
  ])("tells whether %s", async (_name, reply, saved) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(reply));
    expect(await savePuzzle(makePuzzle())).toBe(saved);
  });
});

describe("keepPuzzle", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("saves the puzzle first, then reports the stored photo and saves it with the puzzle", async () => {
    const puzzle = makePuzzle({ id: "3f2c1a9e-8b4d-4c6e-9a1b-2d3e4f5a6b7c" });
    let finishUpload: (response: Response) => void = () => {};
    const fetchMock = vi.fn((url: string) =>
      url === "/api/photo" ? new Promise<Response>((resolve) => (finishUpload = resolve)) : Promise.resolve(Response.json({ id: "x" })),
    );
    vi.stubGlobal("fetch", fetchMock);
    prepareStoreCopy.mockResolvedValue(storeBlob);
    const onPhoto = vi.fn();

    const kept = keepPuzzle(puzzle, file, onPhoto);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const saves = () =>
      (fetchMock.mock.calls as unknown as [string, RequestInit][]).filter(([url]) => url === "/api/puzzle").map(([, init]) => JSON.parse(String(init.body)));
    expect(saves()).toEqual([puzzle]);
    expect(onPhoto).not.toHaveBeenCalled();

    finishUpload(Response.json({ id: PHOTO_ID }));
    await kept;
    expect(onPhoto).toHaveBeenCalledWith(puzzle.id, PHOTO_ID);
    expect(saves()).toEqual([puzzle, { ...puzzle, photo: PHOTO_ID }]);
  });

  it("reports a failed first save, and then the second one if it stored the puzzle after all", async () => {
    const puzzle = makePuzzle({ id: "3f2c1a9e-8b4d-4c6e-9a1b-2d3e4f5a6b7c" });
    let saves = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url === "/api/photo" ? Response.json({ id: PHOTO_ID }) : (saves += 1) === 1 ? new Response(null, { status: 502 }) : Response.json({ id: puzzle.id }),
      ),
    );
    prepareStoreCopy.mockResolvedValue(storeBlob);
    const onSaved = vi.fn();
    await keepPuzzle(puzzle, file, undefined, onSaved);
    expect(onSaved.mock.calls).toEqual([[false], [true]]);
  });

  it("reports a first save that worked only once", async () => {
    const puzzle = makePuzzle({ id: "3f2c1a9e-8b4d-4c6e-9a1b-2d3e4f5a6b7c" });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json({ id: url === "/api/photo" ? PHOTO_ID : puzzle.id })));
    prepareStoreCopy.mockResolvedValue(storeBlob);
    const onSaved = vi.fn();
    await keepPuzzle(puzzle, file, undefined, onSaved);
    expect(onSaved.mock.calls).toEqual([[true]]);
  });

  it("saves the puzzle once, without a photo, when storing the photo fails", async () => {
    const puzzle = makePuzzle({ id: "3f2c1a9e-8b4d-4c6e-9a1b-2d3e4f5a6b7c" });
    prepareStoreCopy.mockResolvedValue(null);
    const fetchMock = vi.fn(async () => Response.json({ id: "x" }));
    vi.stubGlobal("fetch", fetchMock);
    const onPhoto = vi.fn();
    await keepPuzzle(puzzle, file, onPhoto);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/puzzle");
    expect(JSON.parse(String(init.body))).toEqual(puzzle);
    expect(onPhoto).not.toHaveBeenCalled();
  });
});

describe("PuzzleUploader", () => {
  afterEach(cleanup);

  it("hands over the read puzzle and its photo, without sharing or storing anything yet", async () => {
    readGrid.mockReturnValue(gridCells(2, 5));
    prepareImages.mockResolvedValue({ pixels, shareDataUrl: "data:image/jpeg;base64,SMALL" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    prepareStoreCopy.mockReset();
    const onRead = vi.fn();
    render(<PuzzleUploader onRead={onRead} />);

    fireEvent.change(screen.getByTestId("file-input"), { target: { files: [file] } });
    await waitFor(() => expect(onRead).toHaveBeenCalledTimes(1));
    const [{ puzzle, file: photo }] = onRead.mock.calls[0];
    expect(puzzle.cells).toEqual(gridCells(2, 5));
    expect(puzzle.image).toBe("data:image/jpeg;base64,SMALL");
    expect(photo).toBe(file);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prepareStoreCopy).not.toHaveBeenCalled();
  });

  it("reports a photo that couldn't be read", async () => {
    readGrid.mockReturnValue(null);
    prepareImages.mockResolvedValue({ pixels, shareDataUrl: "data:image/jpeg;base64,SMALL" });
    const onRead = vi.fn();
    render(<PuzzleUploader onRead={onRead} />);

    fireEvent.change(screen.getByTestId("file-input"), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText(/Hittade inget korsord/)).toBeTruthy());
    expect(onRead).not.toHaveBeenCalled();
  });

  it("compact mode offers loading a new puzzle and reports errors inline", async () => {
    prepareImages.mockRejectedValue(new Error("nope"));
    const onRead = vi.fn();
    render(<PuzzleUploader compact onRead={onRead} />);
    expect(screen.getByText("Nytt korsord")).toBeTruthy();

    fireEvent.change(screen.getByTestId("file-input"), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText(/Kunde inte läsa bilden/)).toBeTruthy());
    expect(onRead).not.toHaveBeenCalled();
  });
});
