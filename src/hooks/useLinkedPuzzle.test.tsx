// @vitest-environment jsdom
import { makePuzzle } from "@/test/fixtures";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLinkedPuzzle } from "./useLinkedPuzzle";

const ID = "3f2c1a9e-8b4d-4c6e-9a1b-2d3e4f5a6b7c";
const puzzle = makePuzzle({ id: ID });

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});

describe("useLinkedPuzzle", () => {
  const replies = (letters: () => Promise<Response>) =>
    vi.fn((url: string) => (url === `/api/puzzle/${ID}/letters` ? letters() : Promise.resolve(Response.json(puzzle))));

  it("opens the linked puzzle with its saved letters, keeping only the puzzle's squares", async () => {
    const saved = { letters: { "0-0": "K", "0-1": "R", "99-99": "X" }, authors: { "0-0": "Nova", "99-99": "Nova" } };
    const fetchMock = replies(async () => Response.json(saved));
    vi.stubGlobal("fetch", fetchMock);
    const restore = vi.fn();
    const { result } = renderHook(() => useLinkedPuzzle(ID, undefined, restore));
    await waitFor(() => expect(restore).toHaveBeenCalledWith(puzzle, { letters: { "0-0": "K", "0-1": "R" }, authors: { "0-0": "Nova" } }));
    expect(fetchMock).toHaveBeenCalledWith(`/api/puzzle/${ID}`, { cache: "no-store" });
    expect(fetchMock).toHaveBeenCalledWith(`/api/puzzle/${ID}/letters`, { cache: "no-store" });
    expect(result.current.error).toBe("");
  });

  it.each([
    ["none were saved", async () => Response.json({ error: "x" }, { status: 404 })],
    ["they can't be loaded", () => Promise.reject(new TypeError("offline"))],
    ["they are invalid", async () => Response.json({ letters: { "0-0": "KR" }, authors: {} })],
  ])("opens the puzzle without letters when %s", async (_name, letters) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", replies(letters));
    const restore = vi.fn();
    renderHook(() => useLinkedPuzzle(ID, undefined, restore));
    await waitFor(() => expect(restore).toHaveBeenCalledWith(puzzle, { letters: {}, authors: {} }));
  });

  it.each([
    ["a missing puzzle", async () => Response.json({ error: "x" }, { status: 404 }), "Korsordet finns inte kvar."],
    ["a puzzle with another id", async () => Response.json(makePuzzle({ id: crypto.randomUUID() })), "Kunde inte hämta korsordet. Ladda om sidan för att försöka igen."],
    ["an invalid puzzle", async () => Response.json({ ...puzzle, cells: [] }), "Kunde inte hämta korsordet. Ladda om sidan för att försöka igen."],
    ["a network failure", () => Promise.reject(new TypeError("offline")), "Kunde inte hämta korsordet. Ladda om sidan för att försöka igen."],
  ])("explains %s instead of opening it", async (_name, reply, message) => {
    vi.stubGlobal("fetch", vi.fn(reply));
    const restore = vi.fn();
    const { result } = renderHook(() => useLinkedPuzzle(ID, undefined, restore));
    await waitFor(() => expect(result.current.error).toBe(message));
    expect(restore).not.toHaveBeenCalled();
  });

  it("drops the error once another puzzle shows", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "x" }, { status: 404 })));
    const { result, rerender } = renderHook(({ current }) => useLinkedPuzzle(ID, current, vi.fn()), {
      initialProps: { current: undefined as string | undefined },
    });
    await waitFor(() => expect(result.current.error).toBe("Korsordet finns inte kvar."));
    rerender({ current: crypto.randomUUID() });
    expect(result.current.error).toBe("");
  });

  it("offers the linked puzzle while the room shows another, until dismissed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(puzzle)));
    const restore = vi.fn();
    const { result, rerender } = renderHook(({ current }) => useLinkedPuzzle(ID, current, restore), {
      initialProps: { current: undefined as string | undefined },
    });
    await waitFor(() => expect(restore).toHaveBeenCalled());
    expect(result.current.elsewhere).toBeNull();
    rerender({ current: ID });
    expect(result.current.elsewhere).toBeNull();
    rerender({ current: "newer" });
    expect(result.current.elsewhere).toEqual(puzzle);
    act(() => result.current.dismiss());
    expect(result.current.elsewhere).toBeNull();
  });

  it("fetches nothing without a link", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderHook(() => useLinkedPuzzle(undefined, undefined, vi.fn()));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the address bar on the link of the puzzle the room shows", () => {
    const { rerender } = renderHook(({ current }) => useLinkedPuzzle(undefined, current, vi.fn()), {
      initialProps: { current: undefined as string | undefined },
    });
    expect(window.location.pathname).toBe("/");
    rerender({ current: ID });
    expect(window.location.pathname).toBe(`/p/${ID}`);
  });
});
