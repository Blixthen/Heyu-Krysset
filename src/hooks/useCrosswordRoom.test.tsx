// @vitest-environment jsdom
import { createFakeSupabase } from "@/test/fakeSupabase";
import { makePuzzle } from "@/test/fixtures";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ client: null as ReturnType<typeof createFakeSupabase> | null }));
const config = vi.hoisted(() => ({ configured: true, secret: false }));
const router = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return config.configured ? fake.client : null;
  },
  get isSupabaseConfigured() {
    return config.configured;
  },
  get isSecretSupabaseKey() {
    return config.secret;
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const { useCrosswordRoom } = await import("./useCrosswordRoom");

const TOPIC = "crossword-secret";

function mockRoomResponse(response: () => Response) {
  const fetchMock = vi.fn(async () => response());
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Renders the hook and waits until it has created a channel. */
async function connect() {
  const hook = renderHook(() => useCrosswordRoom("Nova"));
  await flush();
  return { ...hook, channel: () => fake.client!.latest! };
}

async function goLive() {
  const room = await connect();
  act(() => room.channel().status("SUBSCRIBED"));
  await flush();
  return room;
}

const validMessage = {
  id: "m1",
  senderId: "peer",
  nickname: "Peer",
  text: "Hej",
  sentAt: "2026-11-08T12:00:00.000Z",
};

describe("useCrosswordRoom", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fake.client = createFakeSupabase();
    config.configured = true;
    config.secret = false;
    router.replace.mockReset();
    mockRoomResponse(() => Response.json({ topic: TOPIC }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("connection", () => {
    it("joins the topic handed out by /api/room, not a guessable name", async () => {
      const room = await connect();
      expect(fetch).toHaveBeenCalledWith("/api/room", { cache: "no-store" });
      expect(room.channel().topic).toBe(`realtime:${TOPIC}`);
      expect(room.result.current.status).toBe("connecting");
    });

    it("goes live and asks peers for the current puzzle", async () => {
      const room = await goLive();
      expect(room.result.current.status).toBe("live");
      expect(room.channel().sentEvents("sync-request")).toHaveLength(1);
    });

    it("sends the user to /login when the gate cookie is no longer valid", async () => {
      mockRoomResponse(() => Response.json({ error: "Lösenord krävs." }, { status: 401 }));
      await connect();
      expect(router.replace).toHaveBeenCalledWith("/login");
      expect(fake.client!.channels).toHaveLength(0);
    });

    it("retries with backoff and gives up after a bounded number of attempts", async () => {
      const room = await connect();
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        act(() => room.channel().status("CHANNEL_ERROR", new Error("boom")));
        expect(room.result.current.status).toBe("connecting");
        await flush(8000);
      }
      act(() => room.channel().status("CHANNEL_ERROR", new Error("boom")));
      expect(room.result.current.status).toBe("error");
      expect(room.result.current.connectionError).toBe("boom");
      const created = fake.client!.channels.length;
      await flush(60_000);
      expect(fake.client!.channels).toHaveLength(created);
    });

    it("treats CLOSED as a disconnect instead of staying 'live'", async () => {
      const room = await goLive();
      act(() => room.channel().status("CLOSED"));
      expect(room.result.current.status).toBe("connecting");
      expect(room.result.current.connectionError).toBe("Anslutningen stängdes.");
    });

    it("can reconnect manually after giving up", async () => {
      const room = await connect();
      for (let attempt = 0; attempt <= 4; attempt += 1) {
        act(() => room.channel().status("TIMED_OUT"));
        await flush(8000);
      }
      expect(room.result.current.status).toBe("error");
      act(() => room.result.current.reconnect());
      await flush();
      act(() => room.channel().status("SUBSCRIBED"));
      expect(room.result.current.status).toBe("live");
    });

    it("gives up instead of spinning when the old channel will not close", async () => {
      fake.client!.removeChannel = async () => "ok"; // never actually removes
      const stuck = fake.client!.channel(TOPIC);
      stuck.state = "joined";
      const room = renderHook(() => useCrosswordRoom("Nova"));
      await flush(60_000);
      expect(room.result.current.status).toBe("error");
    });

    it("removes the channel on unmount", async () => {
      const room = await goLive();
      const channel = room.channel();
      room.unmount();
      expect(channel.removed).toBe(true);
    });

    it("reports a secret Supabase key without connecting", async () => {
      config.secret = true;
      config.configured = false;
      const room = renderHook(() => useCrosswordRoom("Nova"));
      await flush();
      expect(room.result.current.status).toBe("error");
      expect(room.result.current.connectionError).toMatch(/sb_publishable_/);
      expect(fetch).not.toHaveBeenCalled();
    });

    it("reports missing configuration", async () => {
      config.configured = false;
      const room = renderHook(() => useCrosswordRoom("Nova"));
      expect(room.result.current.status).toBe("unconfigured");
    });
  });

  describe("chat", () => {
    it("accepts valid messages from peers and strips extra fields", async () => {
      const room = await goLive();
      act(() => room.channel().receive("message", { ...validMessage, html: "<b>x</b>" }));
      expect(room.result.current.messages).toEqual([validMessage]);
    });

    it.each([
      ["invalid timestamp", { ...validMessage, sentAt: "nope" }],
      ["object text", { ...validMessage, text: { a: 1 } }],
      ["missing sender", { ...validMessage, senderId: undefined }],
      ["null", null],
    ])("drops a message with %s instead of crashing", async (_name, payload) => {
      const room = await goLive();
      act(() => room.channel().receive("message", payload));
      expect(room.result.current.messages).toEqual([]);
    });

    it("tags our messages with our client id", async () => {
      const room = await goLive();
      await act(() => room.result.current.sendMessage("Hej"));
      const [sent] = room.channel().sentEvents("message") as { senderId: string }[];
      expect(sent.senderId).toBe(room.result.current.clientId);
    });

    it("marks a message as failed when sending fails", async () => {
      const room = await goLive();
      room.channel().sendResult = "error";
      await act(() => room.result.current.sendMessage("Hej"));
      expect(room.result.current.messages[0]).toMatchObject({ text: "Hej", failed: true });
      expect(room.result.current.sendError).toMatch(/kunde inte skickas/);
    });

    it("marks a message as failed when not connected yet", async () => {
      const room = await connect();
      await act(() => room.result.current.sendMessage("Hej"));
      expect(room.result.current.messages[0].failed).toBe(true);
      expect(room.result.current.sendError).toBe("Inte ansluten till kanalen ännu.");
    });
  });

  describe("puzzle sync", () => {
    const puzzle = makePuzzle();

    it("broadcasts a newly loaded puzzle", async () => {
      const room = await goLive();
      act(() => room.result.current.publishPuzzle(puzzle));
      await flush();
      expect(room.channel().sentEvents("puzzle")).toEqual([{ puzzle, letters: {}, authors: {} }]);
      expect(room.result.current.board.puzzle).toBe(puzzle);
    });

    it("shows an error when the puzzle broadcast is rejected (e.g. too large)", async () => {
      const room = await goLive();
      room.channel().sendResult = "error";
      act(() => room.result.current.publishPuzzle(puzzle));
      await flush();
      expect(room.result.current.shareError).toMatch(/kunde inte delas/);
    });

    it("shares a puzzle loaded while offline once connected", async () => {
      const room = await connect();
      act(() => room.result.current.publishPuzzle(puzzle));
      act(() => room.channel().status("SUBSCRIBED"));
      await flush();
      expect(room.channel().sentEvents("puzzle")).toEqual([{ puzzle, letters: {}, authors: {} }]);
    });

    it("answers a sync request after a short jitter", async () => {
      const room = await goLive();
      act(() => room.result.current.publishPuzzle(puzzle));
      act(() => room.result.current.setLetter(0, 0, "a"));
      await flush();
      room.channel().sent.length = 0;

      act(() => room.channel().receive("sync-request", {}));
      expect(room.channel().sentEvents("puzzle")).toHaveLength(0);
      await flush(400);
      expect(room.channel().sentEvents("puzzle")).toEqual([{ puzzle, letters: { "0-0": "A" }, authors: { "0-0": "Nova" } }]);
    });

    it("does not answer if another peer answers first", async () => {
      const room = await goLive();
      act(() => room.result.current.publishPuzzle(puzzle));
      await flush();
      room.channel().sent.length = 0;

      act(() => room.channel().receive("sync-request", {}));
      act(() => room.channel().receive("puzzle", { puzzle, letters: {} }));
      await flush(1000);
      expect(room.channel().sentEvents("puzzle")).toHaveLength(0);
    });

    it("ignores sync requests when it has no puzzle", async () => {
      const room = await goLive();
      act(() => room.channel().receive("sync-request", {}));
      await flush(1000);
      expect(room.channel().sentEvents("puzzle")).toHaveLength(0);
    });

    it("merges a peer's letters without losing ours", async () => {
      const room = await goLive();
      act(() => room.result.current.publishPuzzle(puzzle));
      act(() => room.result.current.setLetter(0, 0, "x"));
      act(() => room.channel().receive("puzzle", { puzzle, letters: { "0-0": "A", "0-1": "B" } }));
      expect(room.result.current.board.letters).toEqual({ "0-0": "X", "0-1": "B" });
    });

    it("ignores invalid puzzle payloads", async () => {
      const room = await goLive();
      act(() => room.channel().receive("puzzle", { puzzle: { ...puzzle, image: "javascript:alert(1)" } }));
      expect(room.result.current.board.puzzle).toBeNull();
    });

    it("sends cell updates tagged with the puzzle id and our nickname", async () => {
      const room = await goLive();
      act(() => room.result.current.publishPuzzle(puzzle));
      act(() => room.result.current.setLetter(1, 2, "q"));
      expect(room.channel().sentEvents("cell-update")).toEqual([
        { puzzleId: puzzle.id, row: 1, col: 2, value: "Q", author: "Nova" },
      ]);
      expect(room.result.current.board.authors).toEqual({ "1-2": "Nova" });
    });

    it("takes the author from a peer's cell update and full board", async () => {
      const room = await goLive();
      act(() => room.result.current.publishPuzzle(puzzle));
      act(() => room.channel().receive("cell-update", { puzzleId: puzzle.id, row: 0, col: 1, value: "y", author: "Peer" }));
      act(() => room.channel().receive("puzzle", { puzzle, letters: { "0-2": "B" }, authors: { "0-2": "Kim", "9-9": "Kim" } }));
      expect(room.result.current.board.authors).toEqual({ "0-1": "Peer", "0-2": "Kim" });
    });

    it("applies peer cell updates only for the current puzzle", async () => {
      const room = await goLive();
      act(() => room.result.current.publishPuzzle(puzzle));
      act(() => room.channel().receive("cell-update", { puzzleId: "old", row: 0, col: 0, value: "Z" }));
      act(() => room.channel().receive("cell-update", { puzzleId: puzzle.id, row: 0, col: 1, value: "y" }));
      act(() => room.channel().receive("cell-update", { row: 0, col: 2, value: "W" }));
      expect(room.result.current.board.letters).toEqual({ "0-1": "Y" });
    });
  });
});

