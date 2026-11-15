// @vitest-environment jsdom
import { makePuzzle } from "@/test/fixtures";
import type { CrosswordPuzzle } from "@/lib/crossword";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The real uploader, with its latest onRead kept so a test can hand over a read photo.
const uploader = vi.hoisted(() => ({ onRead: undefined as ((draft: { puzzle: CrosswordPuzzle; file: File }) => void) | undefined }));
vi.mock("./PuzzleUploader", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./PuzzleUploader")>();
  const { createElement } = await import("react");
  return {
    ...actual,
    PuzzleUploader: (props: Parameters<typeof actual.PuzzleUploader>[0]) => {
      uploader.onRead = props.onRead;
      return createElement(actual.PuzzleUploader, props);
    },
  };
});

const { Home } = await import("./Home");

const A = "aaaaaaaa-8b4d-4c6e-9a1b-2d3e4f5a6b7c";
const B = "bbbbbbbb-8b4d-4c6e-9a1b-2d3e4f5a6b7c";

function list(response: Response | Promise<never>) {
  const fetchMock = vi.fn(async () => response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderHome(overrides: Partial<Parameters<typeof Home>[0]> = {}) {
  return render(<Home nickname="Nova" onOpen={() => {}} onShare={() => {}} onLeave={() => {}} {...overrides} />);
}

describe("Home", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("lists the recent crosswords, each opening its own room by its link", async () => {
    const fetchMock = list(
      Response.json({
        puzzles: [
          { id: B, room: A, createdAt: Date.UTC(2026, 10, 14, 18, 30), cells: 120 },
          { id: A, room: B, createdAt: Date.UTC(2026, 10, 7, 18, 30) },
        ],
      }),
    );
    const onOpen = vi.fn();
    renderHome({ onOpen });
    const links = await screen.findAllByRole("link");
    expect(fetchMock).toHaveBeenCalledWith("/api/puzzles", { cache: "no-store" });
    expect(links.map((link) => link.getAttribute("href"))).toEqual([`/p/${B}`, `/p/${A}`]);
    expect(links[0].textContent).toContain("14 november");
    expect(links[0].textContent).toContain("120 rutor");
    expect(links[1].textContent).not.toContain("rutor");

    fireEvent.click(links[0]);
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(B);
    // A new tab opens the link itself.
    fireEvent.click(links[1], { metaKey: true });
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("says when there are none, or the list can't be loaded", async () => {
    list(Response.json({ puzzles: [] }));
    renderHome();
    expect(await screen.findByText(/Inga korsord/)).toBeTruthy();
    cleanup();

    list(Response.json({ error: "Kunde inte hämta korsorden." }, { status: 502 }));
    renderHome();
    expect(await screen.findByText(/Kunde inte hämta korsorden/)).toBeTruthy();
    cleanup();

    list(Promise.reject(new Error("offline")));
    renderHome();
    expect(await screen.findByText(/Kunde inte hämta korsorden/)).toBeTruthy();
  });

  it("lets the player fix a read photo's squares, then shares it", async () => {
    list(Response.json({ puzzles: [] }));
    const onShare = vi.fn();
    renderHome({ onShare });
    await screen.findByText(/Inga korsord/);
    const read = makePuzzle({ id: A, createdAt: 1_000 });
    const file = new File(["x"], "kryss.jpg");
    act(() => uploader.onRead?.({ puzzle: read, file }));
    expect(screen.queryByText("Senaste korsorden")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Klar" }));
    const shared = onShare.mock.calls[0][0];
    expect(shared.file).toBe(file);
    expect(shared.puzzle).toEqual({ ...read, createdAt: shared.puzzle.createdAt });
    expect(shared.puzzle.createdAt).toBeGreaterThan(read.createdAt);
  });

  it("asks before the title throws away a photo being checked", async () => {
    list(Response.json({ puzzles: [] }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderHome();
    act(() => uploader.onRead?.({ puzzle: makePuzzle({ id: A }), file: new File(["x"], "kryss.jpg") }));
    fireEvent.click(screen.getByRole("button", { name: "Alla korsord" }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Klar" })).toBeTruthy();

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Alla korsord" }));
    expect(screen.getByText("Senaste korsorden")).toBeTruthy();
    confirm.mockRestore();
  });

  it("goes back to the list when checking a photo is cancelled", async () => {
    list(Response.json({ puzzles: [] }));
    const onShare = vi.fn();
    renderHome({ onShare });
    act(() => uploader.onRead?.({ puzzle: makePuzzle({ id: A }), file: new File(["x"], "kryss.jpg") }));
    fireEvent.click(screen.getByRole("button", { name: "Avbryt" }));
    expect(screen.getByText("Senaste korsorden")).toBeTruthy();
    expect(onShare).not.toHaveBeenCalled();
  });
});
