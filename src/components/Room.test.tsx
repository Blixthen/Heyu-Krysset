// @vitest-environment jsdom
import { emptyBoard } from "@/lib/board";
import { gridCells, makePuzzle } from "@/test/fixtures";
import type { CrosswordPuzzle } from "@/lib/crossword";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const room = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/hooks/useCrosswordRoom", () => ({ useCrosswordRoom: () => room.current }));
// The real uploader, with its latest onRead kept so a test can hand over a read photo,
// and keepPuzzle mocked so a test can report a stored photo through its onPhoto.
const uploader = vi.hoisted(() => ({
  onRead: undefined as ((draft: { puzzle: CrosswordPuzzle; file: File }) => void) | undefined,
  keepPuzzle: vi.fn(),
}));
vi.mock("./PuzzleUploader", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./PuzzleUploader")>();
  const { createElement } = await import("react");
  return {
    ...actual,
    keepPuzzle: uploader.keepPuzzle,
    PuzzleUploader: (props: Parameters<typeof actual.PuzzleUploader>[0]) => {
      uploader.onRead = props.onRead;
      return createElement(actual.PuzzleUploader, props);
    },
  };
});

const { Room } = await import("./Room");

function roomState(overrides: object = {}) {
  return {
    clientId: "me",
    status: "live",
    connectionError: "",
    sendError: "",
    shareError: "",
    messages: [],
    online: [],
    reactions: new Map(),
    react: vi.fn(),
    restorePuzzle: vi.fn(),
    attachPhoto: vi.fn(),
    board: emptyBoard,
    reconnect: vi.fn(),
    sendMessage: vi.fn(),
    publishPuzzle: vi.fn(),
    setLetter: vi.fn(),
    ...overrides,
  };
}

describe("Room", () => {
  beforeEach(() => uploader.keepPuzzle.mockClear());
  afterEach(cleanup);

  it("shows the uploader when there is no puzzle", () => {
    room.current = roomState();
    render(<Room nickname="Nova" onLeave={() => {}} />);
    expect(screen.getByText("Här hamnar korsordet")).toBeTruthy();
    expect(screen.queryByText("Nytt korsord")).toBeNull();
    expect(screen.queryByRole("button", { name: "Börja om" })).toBeNull();
  });

  it("lets you replace an existing puzzle", () => {
    room.current = roomState({ board: { puzzle: makePuzzle(), letters: {}, authors: {} } });
    render(<Room nickname="Nova" onLeave={() => {}} />);
    expect(screen.getByText("Nytt korsord")).toBeTruthy();
    expect(screen.getAllByRole("textbox").length).toBeGreaterThan(1);
  });

  it("lets the player fix the squares of a read photo before sharing it, and keeps it once shared", () => {
    const publishPuzzle = vi.fn();
    room.current = roomState({ publishPuzzle });
    render(<Room nickname="Nova" onLeave={() => {}} />);
    const read = makePuzzle({ id: "3f2c1a9e-8b4d-4c6e-9a1b-2d3e4f5a6b7c", createdAt: 1_000 });
    const file = new File(["x"], "kryss.jpg");
    act(() => uploader.onRead?.({ puzzle: read, file }));
    expect(publishPuzzle).not.toHaveBeenCalled();
    expect(screen.queryByText("Här hamnar korsordet")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Ta bort rutan på rad 2, kolumn 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Lägg till en ruta på rad 1, kolumn 4" }));
    fireEvent.click(screen.getByRole("button", { name: "Klar" }));

    const shared = publishPuzzle.mock.calls[0][0];
    const cells = [...gridCells().filter((cell) => !(cell.row === 1 && cell.col === 1)), { row: 0, col: 3, x: 400, y: 100, w: 90, h: 90 }];
    expect(shared).toEqual({ ...read, createdAt: shared.createdAt, cells: cells.sort((a, b) => a.row - b.row || a.col - b.col) });
    // Newer than anything shared while it was being fixed.
    expect(shared.createdAt).toBeGreaterThan(read.createdAt);
    expect(uploader.keepPuzzle).toHaveBeenCalledWith(shared, file, expect.any(Function));
  });

  it("hides starting over while a new photo's squares are checked, since its puzzle is out of sight", () => {
    room.current = roomState({ board: { puzzle: makePuzzle(), letters: {}, authors: {} } });
    render(<Room nickname="Nova" onLeave={() => {}} />);
    expect(screen.getByRole("button", { name: "Börja om" })).toBeTruthy();
    act(() => uploader.onRead?.({ puzzle: makePuzzle({ id: "next" }), file: new File(["x"], "kryss.jpg") }));
    expect(screen.queryByRole("button", { name: "Börja om" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Avbryt" }));
    expect(screen.getByRole("button", { name: "Börja om" })).toBeTruthy();
  });

  it("shares nothing when fixing the squares is cancelled", () => {
    const publishPuzzle = vi.fn();
    room.current = roomState({ publishPuzzle });
    render(<Room nickname="Nova" onLeave={() => {}} />);
    act(() => uploader.onRead?.({ puzzle: makePuzzle(), file: new File(["x"], "kryss.jpg") }));

    fireEvent.click(screen.getByRole("button", { name: "Avbryt" }));
    expect(screen.getByText("Här hamnar korsordet")).toBeTruthy();
    expect(publishPuzzle).not.toHaveBeenCalled();
    expect(uploader.keepPuzzle).not.toHaveBeenCalled();
  });

  it("starts the same crossword over as a new puzzle for everyone, with its own saved link", async () => {
    const original = makePuzzle({ id: "3f2c1a9e-8b4d-4c6e-9a1b-2d3e4f5a6b7c", createdAt: 1_000, photo: "9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d" });
    const fetchMock = vi.fn(async () => Response.json({}));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const publishPuzzle = vi.fn();
    room.current = roomState({ board: { puzzle: original, letters: { "0-0": "K" }, authors: {} }, publishPuzzle });
    render(<Room nickname="Nova" onLeave={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Börja om" }));
    const restarted = publishPuzzle.mock.calls[0][0];
    expect(restarted.id).not.toBe(original.id);
    expect(restarted.createdAt).toBeGreaterThan(original.createdAt);
    expect({ ...restarted, id: original.id, createdAt: original.createdAt }).toEqual({ ...original, restartOf: original.id });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/puzzle", expect.objectContaining({ method: "POST" })));
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual(restarted);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("saves a copy started over once the photo of the puzzle it copies is stored", async () => {
    const PHOTO = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
    const original = makePuzzle({ id: "3f2c1a9e-8b4d-4c6e-9a1b-2d3e4f5a6b7c" });
    const copy = makePuzzle({ id: "9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d", restartOf: original.id, photo: PHOTO });
    const fetchMock = vi.fn(async () => Response.json({}));
    vi.stubGlobal("fetch", fetchMock);
    const attachPhoto = vi.fn((puzzleId: string) => (puzzleId === original.id ? copy : null));
    room.current = roomState({ board: { puzzle: copy, letters: {}, authors: {} }, attachPhoto });
    render(<Room nickname="Nova" onLeave={() => {}} />);
    act(() => uploader.onRead?.({ puzzle: original, file: new File(["x"], "kryss.jpg") }));
    fireEvent.click(screen.getByRole("button", { name: "Klar" }));
    const onPhoto = uploader.keepPuzzle.mock.calls.at(-1)?.[2] as (puzzleId: string, photo: string) => void;

    onPhoto(original.id, PHOTO);
    expect(attachPhoto).toHaveBeenCalledWith(original.id, PHOTO);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/puzzle");
    expect(JSON.parse(String(init.body))).toEqual(copy);

    // A photo for the puzzle itself is keepPuzzle's to save.
    attachPhoto.mockReturnValue({ ...copy });
    onPhoto(copy.id, PHOTO);
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("keeps the letters when starting over isn't confirmed", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const publishPuzzle = vi.fn();
    room.current = roomState({ board: { puzzle: makePuzzle(), letters: { "0-0": "K" }, authors: {} }, publishPuzzle });
    render(<Room nickname="Nova" onLeave={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Börja om" }));
    expect(confirm).toHaveBeenCalled();
    expect(publishPuzzle).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("lists the players who typed letters, with the colour their letters have", () => {
    const board = { puzzle: makePuzzle(), letters: { "0-0": "A", "0-1": "B" }, authors: { "0-0": "Liv", "0-1": "Ann" } };
    room.current = roomState({ board });
    render(<Room nickname="Nova" onLeave={() => {}} />);
    const players = screen.getAllByRole("listitem").filter((item) => item.closest('[aria-label="Spelare"]'));
    expect(players.map((item) => item.textContent)).toEqual(["Ann", "Liv"]);
    // Ann and Liv hash to the same colour, so Liv moves on to another; each dot matches its letters' tint.
    const dot = (item: Element) => item.querySelector("span")?.className.match(/\bbg-(\w+)-300\b/)?.[1];
    const tint = (label: string) => screen.getByLabelText(label).className.match(/\bbg-(\w+)-300\/40\b/)?.[1];
    expect(dot(players[0])).toBe(tint("Rad 1, ruta 2"));
    expect(dot(players[1])).toBe(tint("Rad 1, ruta 1"));
    expect(dot(players[0])).not.toBe(dot(players[1]));
  });

  it("gives a colour to everyone in the room before they type, after those who typed", () => {
    const board = { puzzle: makePuzzle(), letters: { "0-0": "A" }, authors: { "0-0": "Liv" } };
    room.current = roomState({ board, online: ["Ann", "Nova"] });
    render(<Room nickname="Nova" onLeave={() => {}} />);
    const players = screen.getAllByRole("listitem").filter((item) => item.closest('[aria-label="Spelare"]'));
    expect(players.map((item) => item.textContent)).toEqual(["Liv", "Ann", "Nova"]);
  });

  it("keeps a typist's letter colour when someone watching clashes with it, or leaves", () => {
    const board = { puzzle: makePuzzle(), letters: { "0-0": "A" }, authors: { "0-0": "Liv" } };
    const tint = () => screen.getByLabelText("Rad 1, ruta 1").className.match(/\bbg-(\w+)-300\/40\b/)?.[1];
    // Ann sorts before Liv and hashes to the same colour.
    room.current = roomState({ board, online: ["Ann", "Liv"] });
    const { rerender } = render(<Room nickname="Liv" onLeave={() => {}} />);
    const watched = tint();
    room.current = roomState({ board, online: ["Liv"] });
    rerender(<Room nickname="Liv" onLeave={() => {}} />);
    expect(tint()).toBe(watched);
    expect(watched).toBeTruthy();
  });

  it("folds the chat on phones and counts messages that arrive while it is folded", () => {
    const message = (id: string) => ({ id, senderId: "peer", nickname: "Kim", text: id, sentAt: "" });
    room.current = roomState({ messages: [message("m1")] });
    const { rerender } = render(<Room nickname="Nova" onLeave={() => {}} />);
    const toggle = () => screen.getByRole("button", { name: /Livechatt/ });
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(toggle().textContent).toContain("1 nya");

    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(toggle().textContent).not.toContain("nya");

    fireEvent.click(toggle());
    expect(toggle().textContent).not.toContain("nya");
    room.current = roomState({ messages: [message("m1"), message("m2"), message("m3")] });
    rerender(<Room nickname="Nova" onLeave={() => {}} />);
    expect(toggle().textContent).toContain("2 nya");
  });

  it("shows the banner photo behind the header, still when less motion is asked for", () => {
    room.current = roomState();
    render(<Room nickname="Nova" onLeave={() => {}} />);
    const header = screen.getByRole("banner");
    expect(header.querySelector("img")?.getAttribute("src")).toBe("/banner.webp");
    const still = header.querySelector('source[media="(prefers-reduced-motion: reduce)"]');
    expect(still?.getAttribute("srcset")).toBe("/banner-still.webp");
    // Decorative (empty alt), so screen readers skip it.
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("offers to open the linked puzzle when the room shows another, sharing it as the newest with its saved letters", async () => {
    const linked = makePuzzle({ id: "3f2c1a9e-8b4d-4c6e-9a1b-2d3e4f5a6b7c", createdAt: 1_000 });
    const saved = { letters: { "0-0": "K" }, authors: { "0-0": "Ola" } };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url.endsWith("/letters") ? saved : linked)));
    const restorePuzzle = vi.fn();
    const publishPuzzle = vi.fn();
    room.current = roomState({ board: { puzzle: makePuzzle({ id: "today", createdAt: 2_000 }), letters: {}, authors: {} }, restorePuzzle, publishPuzzle });
    render(<Room nickname="Nova" linkedPuzzleId={linked.id} onLeave={() => {}} />);

    await waitFor(() => expect(restorePuzzle).toHaveBeenCalledWith(linked, saved));
    fireEvent.click(screen.getByRole("button", { name: "Öppna länkens korsord" }));
    // Restored, not loaded empty, so the next save can't wipe its saved letters.
    expect(publishPuzzle).not.toHaveBeenCalled();
    const [opened, letters] = restorePuzzle.mock.calls[1];
    expect({ ...opened, createdAt: 0 }).toEqual({ ...linked, createdAt: 0 });
    expect(opened.createdAt).toBeGreaterThan(2_000);
    expect(letters).toEqual(saved);
    expect(screen.queryByRole("button", { name: "Öppna länkens korsord" })).toBeNull();
    vi.unstubAllGlobals();
  });

  it("hides the offer to open the linked puzzle while a new photo's squares are checked", async () => {
    const linked = makePuzzle({ id: "3f2c1a9e-8b4d-4c6e-9a1b-2d3e4f5a6b7c", createdAt: 1_000 });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url.endsWith("/letters") ? Response.json({}, { status: 404 }) : Response.json(linked))));
    room.current = roomState({ board: { puzzle: makePuzzle({ id: "today", createdAt: 2_000 }), letters: {}, authors: {} } });
    render(<Room nickname="Nova" linkedPuzzleId={linked.id} onLeave={() => {}} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Öppna länkens korsord" })).toBeTruthy());

    act(() => uploader.onRead?.({ puzzle: makePuzzle({ id: "next" }), file: new File(["x"], "kryss.jpg") }));
    expect(screen.queryByRole("button", { name: "Öppna länkens korsord" })).toBeNull();
    vi.unstubAllGlobals();
  });

  it("shows share errors", () => {
    room.current = roomState({ shareError: "Korsordet kunde inte delas med de andra." });
    render(<Room nickname="Nova" onLeave={() => {}} />);
    expect(screen.getByText("Korsordet kunde inte delas med de andra.")).toBeTruthy();
  });
});
