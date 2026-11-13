// @vitest-environment jsdom
import type { Board } from "@/lib/board";
import { makePuzzle } from "@/test/fixtures";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KEEPALIVE_MAX_BYTES, SAVE_DELAY_MS, useLetterSaving } from "./useLetterSaving";

const first = makePuzzle({ id: "3f2c1a9e-8b4d-4c6e-9a1b-2d3e4f5a6b7c" });
const second = makePuzzle({ id: "9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d" });

let board: Board;
let replies: ((response: Response) => void)[];
const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => new Promise((resolve) => replies.push(resolve)));

/** Each save: where it went, what it held, and whether it may outlive the page. */
function saves() {
  return fetchMock.mock.calls.map(([url, init]) => ({ url, body: JSON.parse(String(init?.body)), keepalive: init?.keepalive }));
}

function type(letters: Board["letters"], puzzle = board.puzzle) {
  board = { puzzle, letters, authors: {} };
}

async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
}

/** Answers the oldest unanswered save. */
async function answer(status = 204) {
  const reply = replies.shift();
  await act(async () => reply?.(new Response(null, { status })));
  await wait(0);
}

const at = (puzzle: { id: string }) => `/api/puzzle/${puzzle.id}/letters`;

function render() {
  return renderHook(() => useLetterSaving(() => board));
}

beforeEach(() => {
  vi.useFakeTimers();
  board = { puzzle: first, letters: {}, authors: {} };
  replies = [];
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  setVisibility("visible");
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useLetterSaving", () => {
  it("saves the latest letters once typing pauses, in a request that outlives the page", async () => {
    const { result } = render();
    type({ "0-0": "K" });
    act(() => result.current());
    await wait(SAVE_DELAY_MS - 1);
    type({ "0-0": "K", "0-1": "R" });
    act(() => result.current());
    await wait(SAVE_DELAY_MS - 1);
    expect(saves()).toEqual([]);
    await wait(1);
    expect(saves()).toEqual([{ url: at(first), body: { letters: { "0-0": "K", "0-1": "R" }, authors: {} }, keepalive: true }]);
  });

  it("sends a save too big for keepalive as a plain request", async () => {
    const { result } = render();
    const letters = Object.fromEntries(Array.from({ length: KEEPALIVE_MAX_BYTES / 8 }, (_, index) => [`${index}-0`, "A"]));
    type(letters);
    act(() => result.current());
    await wait(SAVE_DELAY_MS);
    expect(saves()[0].keepalive).toBe(false);
  });

  it("runs one save at a time, sending what was typed meanwhile once the first is done", async () => {
    const { result } = render();
    type({ "0-0": "K" });
    act(() => result.current());
    await wait(SAVE_DELAY_MS);
    type({ "0-0": "K", "0-1": "R" });
    act(() => result.current());
    await wait(SAVE_DELAY_MS * 3);
    expect(saves()).toHaveLength(1);

    await answer();
    expect(saves().map((save) => save.body.letters)).toEqual([{ "0-0": "K" }, { "0-0": "K", "0-1": "R" }]);
  });

  it("keeps saving after a failed save", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = render();
    type({ "0-0": "K" });
    act(() => result.current());
    await wait(SAVE_DELAY_MS);
    await answer(502);
    type({ "0-0": "Q" });
    act(() => result.current());
    await wait(SAVE_DELAY_MS);
    expect(saves().map((save) => save.body.letters)).toEqual([{ "0-0": "K" }, { "0-0": "Q" }]);
  });

  it("saves the last puzzle's letters at once when typing moves to another puzzle", async () => {
    const { result } = render();
    type({ "0-0": "K" });
    act(() => result.current());
    type({ "1-1": "S" }, second);
    act(() => result.current());
    await wait(0);
    expect(saves()).toEqual([{ url: at(first), body: { letters: { "0-0": "K" }, authors: {} }, keepalive: true }]);
  });

  it("waits for a save still running for the last puzzle before saving its newer letters", async () => {
    const { result } = render();
    type({ "0-0": "K" });
    act(() => result.current());
    await wait(SAVE_DELAY_MS);
    type({ "0-0": "K", "0-1": "R" });
    act(() => result.current());
    type({ "1-1": "S" }, second);
    act(() => result.current());
    await wait(0);
    expect(saves()).toHaveLength(1);

    await answer();
    expect(saves().map((save) => [save.url, save.body.letters])).toEqual([
      [at(first), { "0-0": "K" }],
      [at(first), { "0-0": "K", "0-1": "R" }],
    ]);
  });

  it("saves the letters as they were when another puzzle replaced it before the pause ended", async () => {
    const { result } = render();
    type({ "0-0": "K" });
    act(() => result.current());
    type({}, second);
    await wait(SAVE_DELAY_MS);
    expect(saves()).toEqual([{ url: at(first), body: { letters: { "0-0": "K" }, authors: {} }, keepalive: true }]);
  });

  it.each([
    ["the tab is hidden", () => {
      setVisibility("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    }],
    ["the page is left", () => window.dispatchEvent(new Event("pagehide"))],
  ])("saves what is waiting when %s", async (_name, leave) => {
    const { result } = render();
    type({ "0-0": "K" });
    act(() => result.current());
    leave();
    await wait(0);
    expect(saves()).toEqual([{ url: at(first), body: { letters: { "0-0": "K" }, authors: {} }, keepalive: true }]);
    // Nothing is left to save once the pause ends.
    await wait(SAVE_DELAY_MS);
    expect(saves()).toHaveLength(1);
  });

  it("doesn't save when the tab becomes visible", async () => {
    const { result } = render();
    type({ "0-0": "K" });
    act(() => result.current());
    document.dispatchEvent(new Event("visibilitychange"));
    await wait(0);
    expect(saves()).toEqual([]);
  });

  it("closing the tab mid-save sends the newer letters after the running save, not alongside it", async () => {
    const { result } = render();
    type({ "0-0": "K" });
    act(() => result.current());
    await wait(SAVE_DELAY_MS);
    type({ "0-0": "Q" });
    act(() => result.current());
    window.dispatchEvent(new Event("pagehide"));
    await wait(0);
    expect(saves()).toHaveLength(1);
    await answer();
    expect(saves().map((save) => save.body.letters)).toEqual([{ "0-0": "K" }, { "0-0": "Q" }]);
  });

  it("saves what is waiting when the room closes", async () => {
    const { result, unmount } = render();
    type({ "0-0": "K" });
    act(() => result.current());
    unmount();
    await wait(0);
    expect(saves().map((save) => save.body.letters)).toEqual([{ "0-0": "K" }]);
  });

  it("keeps waiting across renders", async () => {
    const { result, rerender } = render();
    type({ "0-0": "K" });
    act(() => result.current());
    rerender();
    await wait(0);
    expect(saves()).toEqual([]);
    await wait(SAVE_DELAY_MS);
    expect(saves()).toHaveLength(1);
  });

  it("does nothing without a puzzle", async () => {
    board = { puzzle: null, letters: {}, authors: {} };
    const { result } = render();
    act(() => result.current());
    await wait(SAVE_DELAY_MS);
    window.dispatchEvent(new Event("pagehide"));
    await wait(0);
    expect(saves()).toEqual([]);
  });
});
