// @vitest-environment jsdom
import { emptyBoard } from "@/lib/board";
import { gridCells, makePuzzle } from "@/test/fixtures";
import type { CrosswordPuzzle } from "@/lib/crossword";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const room = vi.hoisted(() => ({ current: null as unknown, joined: [] as (string | null)[] }));
vi.mock("@/hooks/useCrosswordRoom", () => ({
  useCrosswordRoom: (_nickname: string, joined: string | null) => {
    room.joined.push(joined);
    return room.current;
  },
}));
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
  beforeEach(() => {
    uploader.keepPuzzle.mockClear();
    room.joined = [];
  });
  afterEach(cleanup);

  it("waits for the crossword before joining any room", () => {
    room.current = roomState();
    render(<Room nickname="Nova" onShare={() => {}} onHome={() => {}} onLeave={() => {}} />);
    expect(screen.getByText("Hämtar korsordet…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Börja om" })).toBeNull();
    expect(room.joined.every((joined) => joined === null)).toBe(true);
  });

  it("goes to all the crosswords from the title", () => {
    const onHome = vi.fn();
    room.current = roomState();
    render(<Room nickname="Nova" onShare={() => {}} onHome={onHome} onLeave={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Alla korsord" }));
    expect(onHome).toHaveBeenCalledOnce();
  });

  it("opens a crossword just shared in its own room, once, and keeps it for its link", () => {
    const shared = makePuzzle({ id: "3f2c1a9e-8b4d-4c6e-9a1b-2d3e4f5a6b7c" });
    const file = new File(["x"], "kryss.jpg");
    const publishPuzzle = vi.fn();
    room.current = roomState({ publishPuzzle });
    const { rerender } = render(<Room nickname="Nova" shared={{ puzzle: shared, file }} onShare={() => {}} onHome={() => {}} onLeave={() => {}} />);
    rerender(<Room nickname="Nova" shared={{ puzzle: shared, file }} onShare={() => {}} onHome={() => {}} onLeave={() => {}} />);
    expect(room.joined.at(-1)).toBe(shared.id);
    expect(publishPuzzle).toHaveBeenCalledExactlyOnceWith(shared);
    expect(uploader.keepPuzzle).toHaveBeenCalledExactlyOnceWith(shared, file, expect.any(Function), expect.any(Function));
  });

  it("keeps the crossword just shared after the app forgets it, and says it took it", () => {
    const shared = makePuzzle({ id: "3f2c1a9e-8b4d-4c6e-9a1b-2d3e4f5a6b7c" });
    const file = new File(["x"], "kryss.jpg");
    const onSharedTaken = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({}, { status: 404 })));
    room.current = roomState({ board: { puzzle: shared, letters: {}, authors: {} } });
    const props = { nickname: "Nova", linkedPuzzleId: shared.id, onShare: () => {}, onHome: () => {}, onLeave: () => {} };
    const { rerender } = render(<Room {...props} shared={{ puzzle: shared, file }} onSharedTaken={onSharedTaken} />);
    expect(onSharedTaken).toHaveBeenCalledOnce();
    rerender(<Room {...props} onSharedTaken={onSharedTaken} />);
    expect(room.joined.at(-1)).toBe(shared.id);
    // Not loaded from its link, which may not be saved yet.
    expect(fetch).not.toHaveBeenCalled();
    expect(uploader.keepPuzzle).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("saves the crossword shared again, with its photo, even after it was started over", async () => {
    const PHOTO = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
    const shared = makePuzzle({ id: "3f2c1a9e-8b4d-4c6e-9a1b-2d3e4f5a6b7c" });
    const copy = makePuzzle({ id: "9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d", restartOf: shared.id });
    const fetchMock = vi.fn(async () => Response.json({ id: shared.id }));
    vi.stubGlobal("fetch", fetchMock);
    room.current = roomState({ board: { puzzle: copy, letters: {}, authors: {} }, attachPhoto: vi.fn(() => null) });
    render(<Room nickname="Nova" shared={{ puzzle: shared, file: new File(["x"], "k.jpg") }} onShare={() => {}} onHome={() => {}} onLeave={() => {}} />);
    const [, , onPhoto, onSaved] = uploader.keepPuzzle.mock.calls.at(-1) as [unknown, unknown, (id: string, photo: string) => void, (ok: boolean) => void];
    act(() => {
      onSaved(false);
      onPhoto(shared.id, PHOTO);
    });
    fireEvent.click(screen.getByRole("button", { name: "Försök igen" }));
    await waitFor(() => expect(screen.queryByText(/kunde inte sparas/)).toBeNull());
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ ...shared, photo: PHOTO });
    vi.unstubAllGlobals();
  });

  it("shows no chat or connection when the link can't open, since there is no room to join", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({}, { status: 404 })));
    room.current = roomState({ status: "connecting" });
    render(<Room nickname="Nova" linkedPuzzleId="3f2c1a9e-8b4d-4c6e-9a1b-2d3e4f5a6b7c" onShare={() => {}} onHome={() => {}} onLeave={() => {}} />);
    expect(await screen.findByRole("button", { name: "Till alla korsord" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Livechatt/ }).closest(".hidden")).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it("joins a copy started over in the room of the crossword it copies", () => {
    const copy = makePuzzle({ id: "9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d", restartOf: "3f2c1a9e-8b4d-4c6e-9a1b-2d3e4f5a6b7c" });
    room.current = roomState();
    render(<Room nickname="Nova" shared={{ puzzle: copy, file: new File(["x"], "k.jpg") }} onShare={() => {}} onHome={() => {}} onLeave={() => {}} />);
    expect(room.joined.at(-1)).toBe("3f2c1a9e-8b4d-4c6e-9a1b-2d3e4f5a6b7c");
  });

  it("says when a crossword just shared couldn't be saved, since nobody else can open it, and saves it again", async () => {
    const shared = makePuzzle({ id: "3f2c1a9e-8b4d-4c6e-9a1b-2d3e4f5a6b7c" });
    const fetchMock = vi.fn(async () => Response.json({ id: shared.id }));
    vi.stubGlobal("fetch", fetchMock);
    room.current = roomState({ board: { puzzle: shared, letters: {}, authors: {} } });
    render(<Room nickname="Nova" shared={{ puzzle: shared, file: new File(["x"], "k.jpg") }} onShare={() => {}} onHome={() => {}} onLeave={() => {}} />);
    const onSaved = uploader.keepPuzzle.mock.calls.at(-1)?.[3] as (ok: boolean) => void;
    expect(screen.queryByText(/kunde inte sparas/)).toBeNull();

    act(() => onSaved(false));
    fireEvent.click(screen.getByRole("button", { name: "Försök igen" }));
    await waitFor(() => expect(screen.queryByText(/kunde inte sparas/)).toBeNull());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/puzzle");
    expect(JSON.parse(String(init.body))).toEqual(shared);
    vi.unstubAllGlobals();
  });

  it("lets you replace an existing puzzle", () => {
    room.current = roomState({ board: { puzzle: makePuzzle(), letters: {}, authors: {} } });
    render(<Room nickname="Nova" onShare={() => {}} onHome={() => {}} onLeave={() => {}} />);
    expect(screen.getByText("Nytt korsord")).toBeTruthy();
    expect(screen.getAllByRole("textbox").length).toBeGreaterThan(1);
  });

  it("lets the player fix the squares of a read photo, then opens it in a room of its own", () => {
    const publishPuzzle = vi.fn();
    const onShare = vi.fn();
    room.current = roomState({ board: { puzzle: makePuzzle(), letters: {}, authors: {} }, publishPuzzle });
    render(<Room nickname="Nova" onShare={onShare} onHome={() => {}} onLeave={() => {}} />);
    const read = makePuzzle({ id: "3f2c1a9e-8b4d-4c6e-9a1b-2d3e4f5a6b7c", createdAt: 1_000 });
    const file = new File(["x"], "kryss.jpg");
    act(() => uploader.onRead?.({ puzzle: read, file }));
    expect(screen.queryByLabelText("Rad 1, ruta 1")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Ta bort rutan på rad 2, kolumn 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Lägg till en ruta på rad 1, kolumn 4" }));
    fireEvent.click(screen.getByRole("button", { name: "Klar" }));

    const { puzzle: shared, file: sharedFile } = onShare.mock.calls[0][0];
    const cells = [...gridCells().filter((cell) => !(cell.row === 1 && cell.col === 1)), { row: 0, col: 3, x: 400, y: 100, w: 90, h: 90 }];
    expect(shared).toEqual({ ...read, createdAt: shared.createdAt, cells: cells.sort((a, b) => a.row - b.row || a.col - b.col) });
    expect(shared.createdAt).toBeGreaterThan(read.createdAt);
    expect(sharedFile).toBe(file);
    // This room keeps its own crossword.
    expect(publishPuzzle).not.toHaveBeenCalled();
    expect(uploader.keepPuzzle).not.toHaveBeenCalled();
  });

  it("hides starting over while a new photo's squares are checked, since its puzzle is out of sight", () => {
    room.current = roomState({ board: { puzzle: makePuzzle(), letters: {}, authors: {} } });
    render(<Room nickname="Nova" onShare={() => {}} onHome={() => {}} onLeave={() => {}} />);
    expect(screen.getByRole("button", { name: "Börja om" })).toBeTruthy();
    act(() => uploader.onRead?.({ puzzle: makePuzzle({ id: "next" }), file: new File(["x"], "kryss.jpg") }));
    expect(screen.queryByRole("button", { name: "Börja om" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Avbryt" }));
    expect(screen.getByRole("button", { name: "Börja om" })).toBeTruthy();
  });

  it("shares nothing when fixing the squares is cancelled", () => {
    const publishPuzzle = vi.fn();
    const onShare = vi.fn();
    room.current = roomState({ board: { puzzle: makePuzzle(), letters: {}, authors: {} }, publishPuzzle });
    render(<Room nickname="Nova" onShare={onShare} onHome={() => {}} onLeave={() => {}} />);
    act(() => uploader.onRead?.({ puzzle: makePuzzle({ id: "next" }), file: new File(["x"], "kryss.jpg") }));

    fireEvent.click(screen.getByRole("button", { name: "Avbryt" }));
    expect(screen.getByLabelText("Rad 1, ruta 1")).toBeTruthy();
    expect(onShare).not.toHaveBeenCalled();
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
    render(<Room nickname="Nova" onShare={() => {}} onHome={() => {}} onLeave={() => {}} />);

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
    render(<Room nickname="Nova" shared={{ puzzle: original, file: new File(["x"], "kryss.jpg") }} onShare={() => {}} onHome={() => {}} onLeave={() => {}} />);
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
    render(<Room nickname="Nova" onShare={() => {}} onHome={() => {}} onLeave={() => {}} />);

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
    render(<Room nickname="Nova" onShare={() => {}} onHome={() => {}} onLeave={() => {}} />);
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
    render(<Room nickname="Nova" onShare={() => {}} onHome={() => {}} onLeave={() => {}} />);
    const players = screen.getAllByRole("listitem").filter((item) => item.closest('[aria-label="Spelare"]'));
    expect(players.map((item) => item.textContent)).toEqual(["Liv", "Ann", "Nova"]);
  });

  it("keeps a typist's letter colour when someone watching clashes with it, or leaves", () => {
    const board = { puzzle: makePuzzle(), letters: { "0-0": "A" }, authors: { "0-0": "Liv" } };
    const tint = () => screen.getByLabelText("Rad 1, ruta 1").className.match(/\bbg-(\w+)-300\/40\b/)?.[1];
    // Ann sorts before Liv and hashes to the same colour.
    room.current = roomState({ board, online: ["Ann", "Liv"] });
    const { rerender } = render(<Room nickname="Liv" onShare={() => {}} onHome={() => {}} onLeave={() => {}} />);
    const watched = tint();
    room.current = roomState({ board, online: ["Liv"] });
    rerender(<Room nickname="Liv" onShare={() => {}} onHome={() => {}} onLeave={() => {}} />);
    expect(tint()).toBe(watched);
    expect(watched).toBeTruthy();
  });

  it("folds the chat on phones and counts messages that arrive while it is folded", () => {
    const message = (id: string) => ({ id, senderId: "peer", nickname: "Kim", text: id, sentAt: "" });
    room.current = roomState({ messages: [message("m1")] });
    const { rerender } = render(<Room nickname="Nova" onShare={() => {}} onHome={() => {}} onLeave={() => {}} />);
    const toggle = () => screen.getByRole("button", { name: /Livechatt/ });
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(toggle().textContent).toContain("1 nya");

    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(toggle().textContent).not.toContain("nya");

    fireEvent.click(toggle());
    expect(toggle().textContent).not.toContain("nya");
    room.current = roomState({ messages: [message("m1"), message("m2"), message("m3")] });
    rerender(<Room nickname="Nova" onShare={() => {}} onHome={() => {}} onLeave={() => {}} />);
    expect(toggle().textContent).toContain("2 nya");
  });

  it("shows only the crossword until the default view is asked for again, keeping a half-written message", () => {
    room.current = roomState({ board: { puzzle: makePuzzle(), letters: {}, authors: {} } });
    render(<Room nickname="Nova" onShare={() => {}} onHome={() => {}} onLeave={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Livechatt/ }));
    fireEvent.change(screen.getByLabelText("Meddelande"), { target: { value: "halvklart" } });
    const header = screen.getByText("Heyus Fredagskryss").closest("header");
    const chat = screen.getByRole("button", { name: /Livechatt/ }).closest(".contents, .hidden");
    expect(header?.classList.contains("hidden")).toBe(false);
    expect(chat?.classList.contains("hidden")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Visa bara korsordet" }));
    expect(header?.classList.contains("hidden")).toBe(true);
    expect(chat?.classList.contains("hidden")).toBe(true);
    expect(screen.getByLabelText("Rad 1, ruta 1")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Visa allt" }));
    expect(header?.classList.contains("hidden")).toBe(false);
    expect(chat?.classList.contains("hidden")).toBe(false);
    expect((screen.getByLabelText("Meddelande") as HTMLInputElement).value).toBe("halvklart");
  });

  it("keeps notices and errors in sight while only the crossword shows", () => {
    room.current = roomState({ board: { puzzle: makePuzzle(), letters: {}, authors: {} }, shareError: "Korsordet kunde inte delas med de andra." });
    render(<Room nickname="Nova" onShare={() => {}} onHome={() => {}} onLeave={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Visa bara korsordet" }));
    expect(screen.getByText("Korsordet kunde inte delas med de andra.").className).not.toContain("hidden");
  });

  it("shows a lost connection and a way to reconnect while the chat is hidden", () => {
    const reconnect = vi.fn();
    room.current = roomState({ board: { puzzle: makePuzzle(), letters: {}, authors: {} }, status: "error", reconnect });
    render(<Room nickname="Nova" onShare={() => {}} onHome={() => {}} onLeave={() => {}} />);
    expect(screen.queryByRole("button", { name: "Försök igen" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Visa bara korsordet" }));
    expect(screen.getAllByText("Ingen kontakt").some((badge) => !badge.closest(".hidden"))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Försök igen" }));
    expect(reconnect).toHaveBeenCalledOnce();
  });

  it("counts new messages on the way back while only the crossword shows, even with the chat open", () => {
    const message = (id: string) => ({ id, senderId: "peer", nickname: "Kim", text: id, sentAt: "" });
    room.current = roomState({ board: { puzzle: makePuzzle(), letters: {}, authors: {} }, messages: [message("m1")] });
    const { rerender } = render(<Room nickname="Nova" onShare={() => {}} onHome={() => {}} onLeave={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Livechatt/ }));
    fireEvent.click(screen.getByRole("button", { name: "Visa bara korsordet" }));
    room.current = roomState({ board: { puzzle: makePuzzle(), letters: {}, authors: {} }, messages: [message("m1"), message("m2")] });
    rerender(<Room nickname="Nova" onShare={() => {}} onHome={() => {}} onLeave={() => {}} />);
    expect(screen.getByRole("button", { name: "Visa allt, 2 nya meddelanden" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Visa allt/ }));
    expect(screen.getByRole("button", { name: /Livechatt/ }).textContent).not.toContain("nya");
  });

  it("doesn't go back to only the crossword by itself after a new photo is checked", () => {
    room.current = roomState({ board: { puzzle: makePuzzle(), letters: {}, authors: {} } });
    render(<Room nickname="Nova" onShare={() => {}} onHome={() => {}} onLeave={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Visa bara korsordet" }));
    act(() => uploader.onRead?.({ puzzle: makePuzzle({ id: "next" }), file: new File(["x"], "kryss.jpg") }));
    fireEvent.click(screen.getByRole("button", { name: "Avbryt" }));
    expect(screen.getByText("Heyus Fredagskryss").closest("header")?.classList.contains("hidden")).toBe(false);
    expect(screen.getByRole("button", { name: "Visa bara korsordet" })).toBeTruthy();
  });

  it("offers no crossword-only view without a crossword", () => {
    room.current = roomState();
    render(<Room nickname="Nova" onShare={() => {}} onHome={() => {}} onLeave={() => {}} />);
    expect(screen.queryByRole("button", { name: "Visa bara korsordet" })).toBeNull();
  });

  it("shows the banner photo behind the header, still when less motion is asked for", () => {
    room.current = roomState();
    render(<Room nickname="Nova" onShare={() => {}} onHome={() => {}} onLeave={() => {}} />);
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
    render(<Room nickname="Nova" linkedPuzzleId={linked.id} onShare={() => {}} onHome={() => {}} onLeave={() => {}} />);

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
    render(<Room nickname="Nova" linkedPuzzleId={linked.id} onShare={() => {}} onHome={() => {}} onLeave={() => {}} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Öppna länkens korsord" })).toBeTruthy());

    act(() => uploader.onRead?.({ puzzle: makePuzzle({ id: "next" }), file: new File(["x"], "kryss.jpg") }));
    expect(screen.queryByRole("button", { name: "Öppna länkens korsord" })).toBeNull();
    vi.unstubAllGlobals();
  });

  it("shows share errors", () => {
    room.current = roomState({ shareError: "Korsordet kunde inte delas med de andra." });
    render(<Room nickname="Nova" onShare={() => {}} onHome={() => {}} onLeave={() => {}} />);
    expect(screen.getByText("Korsordet kunde inte delas med de andra.")).toBeTruthy();
  });
});
