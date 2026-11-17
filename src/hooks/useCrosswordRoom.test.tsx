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
const { SAVE_DELAY_MS } = await import("./useLetterSaving");
const { CHAT_SAVE_TIMEOUT_MS } = await import("./useChatSaving");
const { hasReacted, MAX_VERSION_AHEAD_MS } = await import("@/lib/reactions");

const TOPIC = "crossword-secret";
const ROOM = "3f2c1a9e-8b4d-4c6e-9a1b-2d3e4f5a6b7c";

function mockRoomResponse(response: () => Response) {
  const fetchMock = vi.fn(async () => response());
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const CHAT_URL = `/api/room/${ROOM}/chat`;

/** Answers /api/room with the topic and the room's chat with `stored`, recording what is saved there. */
function mockChat(stored: () => unknown) {
  return mockRoomResponseFor((url, init) => {
    if (url === CHAT_URL && init?.method === "POST") return new Response(null, { status: 204 });
    if (url === CHAT_URL) return Response.json(stored());
    return Response.json({ topic: TOPIC });
  });
}

function mockRoomResponseFor(respond: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => respond(url, init));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The chats this tab saved, in order. */
function chatSaves() {
  return vi
    .mocked(fetch)
    .mock.calls.filter(([url, init]) => url === CHAT_URL && init?.method === "POST")
    .map(([, init]) => JSON.parse(String(init?.body)));
}

/** The per-tab id this tab's presence is tracked under. */
function presenceKey(channel: { options?: unknown }) {
  return (channel.options as { config: { presence: { key: string } } }).config.presence.key;
}

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Renders the hook and waits until it has created a channel. */
async function connect() {
  const hook = renderHook(() => useCrosswordRoom("Nova", ROOM));
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

const LOADED_MARK = { ...validMessage, id: "loaded", sentAt: "2026-11-08T10:00:00.000Z" };
/** A stored chat whose only message shows when the load has landed (waitForChat). */
const MARKED_CHAT = { messages: [LOADED_MARK], reactions: [] };

/** Waits until the stored chat has loaded; reading the response takes real time, not fake. */
async function waitForChat(room: { result: { current: { messages: { id: string }[] } } }, id = LOADED_MARK.id) {
  await vi.waitFor(() => expect(room.result.current.messages.some((message) => message.id === id)).toBe(true));
}

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
      expect(room.channel().topic).toBe(`realtime:${TOPIC}:${ROOM}`);
      expect(room.result.current.status).toBe("connecting");
    });

    it("gives each crossword's room a channel of its own", async () => {
      renderHook(() => useCrosswordRoom("Nova", "other-room"));
      await flush();
      expect(fake.client!.latest!.topic).toBe(`realtime:${TOPIC}:other-room`);
    });

    it("connects to nothing until the crossword's room is known", async () => {
      renderHook(() => useCrosswordRoom("Nova", null));
      await flush();
      expect(fetch).not.toHaveBeenCalled();
      expect(fake.client!.latest).toBeUndefined();
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
      const stuck = fake.client!.channel(`${TOPIC}:${ROOM}`);
      stuck.state = "joined";
      const room = renderHook(() => useCrosswordRoom("Nova", ROOM));
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
      const room = renderHook(() => useCrosswordRoom("Nova", ROOM));
      await flush();
      expect(room.result.current.status).toBe("error");
      expect(room.result.current.connectionError).toMatch(/sb_publishable_/);
      expect(fetch).not.toHaveBeenCalled();
    });

    it("reports missing configuration", async () => {
      config.configured = false;
      const room = renderHook(() => useCrosswordRoom("Nova", ROOM));
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

  describe("reactions", () => {
    const peerReaction = { messageId: "m1", emoji: "👍", senderId: "peer", nickname: "Peer", on: true };

    it("applies a peer's reaction and drops invalid ones", async () => {
      const room = await goLive();
      act(() => room.channel().receive("reaction", { ...peerReaction, extra: "x" }));
      act(() => room.channel().receive("reaction", { ...peerReaction, emoji: "💩" }));
      expect(hasReacted(room.result.current.reactions, "m1", "👍", "peer")).toBe(true);
      expect(room.result.current.reactions.get("m1")?.size).toBe(1);
    });

    it("sends our reaction, and takes it back on a second tap", async () => {
      const room = await goLive();
      const clientId = room.result.current.clientId;
      await act(() => room.result.current.react("m1", "🎉"));
      expect(hasReacted(room.result.current.reactions, "m1", "🎉", clientId)).toBe(true);
      await act(() => room.result.current.react("m1", "🎉"));
      expect(hasReacted(room.result.current.reactions, "m1", "🎉", clientId)).toBe(false);
      const sent = room.channel().sentEvents("reaction") as { version: number }[];
      expect(sent).toEqual([
        { messageId: "m1", emoji: "🎉", senderId: clientId, nickname: "Nova", on: true, version: expect.any(Number) },
        { messageId: "m1", emoji: "🎉", senderId: clientId, nickname: "Nova", on: false, version: expect.any(Number) },
      ]);
      // Within the same millisecond too, the later change carries the higher version.
      expect(sent[1].version).toBeGreaterThan(sent[0].version);
    });

    it("keeps a peer's newest change, whatever order they arrive in", async () => {
      const room = await goLive();
      act(() => room.channel().receive("reaction", { ...peerReaction, on: false, version: 20 }));
      act(() => room.channel().receive("reaction", { ...peerReaction, version: 10 }));
      expect(hasReacted(room.result.current.reactions, "m1", "👍", "peer")).toBe(false);
    });

    it("ignores a reaction whose version is too far ahead of our clock", async () => {
      const room = await goLive();
      act(() => room.channel().receive("reaction", { ...peerReaction, version: Date.now() + MAX_VERSION_AHEAD_MS + 60_000 }));
      expect(hasReacted(room.result.current.reactions, "m1", "👍", "peer")).toBe(false);
    });

    it("takes back a reaction that could not be sent", async () => {
      const room = await goLive();
      room.channel().sendResult = "error";
      await act(() => room.result.current.react("m1", "🎉"));
      expect(hasReacted(room.result.current.reactions, "m1", "🎉", room.result.current.clientId)).toBe(false);
      expect(chatSaves()).toEqual([]);
    });
  });

  describe("stored chat", () => {
    const stored = {
      messages: [
        { ...validMessage, id: "s1", sentAt: "2026-11-08T11:00:00.000Z" },
        { ...validMessage, id: "s2", sentAt: "2026-11-08T13:00:00.000Z" },
      ],
      reactions: [{ messageId: "s1", emoji: "❤️", senderId: "peer", nickname: "Peer", on: true, version: 5 }],
    };

    it("loads the room's chat once live, in the order it was sent among what arrived live", async () => {
      mockChat(() => stored);
      const room = await connect();
      act(() => room.channel().receive("message", validMessage));
      act(() => room.channel().status("SUBSCRIBED"));
      await waitForChat(room, "s2");
      expect(fetch).toHaveBeenCalledWith(CHAT_URL, { cache: "no-store" });
      expect(room.result.current.messages.map((message) => message.id)).toEqual(["s1", "m1", "s2"]);
      expect(hasReacted(room.result.current.reactions, "s1", "❤️", "peer")).toBe(true);
    });

    it("loads again after reconnecting, and stores back what only we saw meanwhile", async () => {
      let chat: unknown = MARKED_CHAT;
      mockChat(() => chat);
      const room = await goLive();
      await waitForChat(room);
      expect(chatSaves()).toEqual([]);
      // A peer's message whose own save never landed.
      act(() => room.channel().receive("message", validMessage));
      chat = { ...stored, messages: [LOADED_MARK, ...stored.messages] };
      act(() => room.channel().status("CLOSED"));
      await flush(8000);
      act(() => room.channel().status("SUBSCRIBED"));
      await waitForChat(room, "s2");
      await flush();
      expect(room.result.current.messages.map((message) => message.id)).toEqual(["loaded", "s1", "m1", "s2"]);
      expect(chatSaves()).toEqual([{ messages: [validMessage], reactions: [] }]);
    });

    it("loads what is valid of the stored chat, leaving out the rest", async () => {
      mockChat(() => ({
        messages: [{ ...validMessage, id: "bad", text: "" }, LOADED_MARK],
        reactions: [
          { messageId: "loaded", emoji: "❤️", senderId: "peer", nickname: "Peer", on: true, version: 5 },
          // Too far ahead of our clock.
          { messageId: "loaded", emoji: "👍", senderId: "peer", nickname: "Peer", on: true, version: Date.now() + MAX_VERSION_AHEAD_MS + 60_000 },
        ],
      }));
      const room = await goLive();
      await waitForChat(room);
      expect(room.result.current.messages.map((message) => message.id)).toEqual(["loaded"]);
      expect(hasReacted(room.result.current.reactions, "loaded", "❤️", "peer")).toBe(true);
      expect(hasReacted(room.result.current.reactions, "loaded", "👍", "peer")).toBe(false);
    });

    it("marks only the first load as history; what a reconnect brings was missed", async () => {
      let chat: unknown = MARKED_CHAT;
      mockChat(() => chat);
      const room = await goLive();
      await waitForChat(room);
      chat = { messages: [LOADED_MARK, { ...validMessage, id: "missed" }], reactions: [] };
      act(() => room.channel().status("CLOSED"));
      await flush(8000);
      act(() => room.channel().status("SUBSCRIBED"));
      await waitForChat(room, "missed");
      expect(room.result.current.messages.map(({ id, history }) => ({ id, history }))).toEqual([
        { id: "loaded", history: true },
        { id: "missed", history: undefined },
      ]);
    });

    it("saves our message once it is sent, but not a peer's or one that failed", async () => {
      mockChat(() => MARKED_CHAT);
      const room = await goLive();
      await waitForChat(room);
      act(() => room.channel().receive("message", validMessage));
      await act(() => room.result.current.sendMessage("Hej"));
      room.channel().sendResult = "error";
      await act(() => room.result.current.sendMessage("Borta"));
      await flush();
      const saves = chatSaves();
      expect(saves).toHaveLength(1);
      expect(saves[0].messages).toEqual([expect.objectContaining({ text: "Hej", senderId: room.result.current.clientId })]);
    });

    it("saves our reactions with their versions, the latest last", async () => {
      mockChat(() => MARKED_CHAT);
      const room = await goLive();
      await waitForChat(room);
      await act(() => room.result.current.react("m1", "🎉"));
      await flush();
      await act(() => room.result.current.react("m1", "🎉"));
      await flush();
      const saved = chatSaves().flatMap((save) => save.reactions);
      expect(saved.map((reaction: { on: boolean }) => reaction.on)).toEqual([true, false]);
      expect(saved[1].version).toBeGreaterThan(saved[0].version);
    });

    it("sends what arrives during a save together in the next one", async () => {
      let finish: (response: Response) => void = () => {};
      mockRoomResponseFor((url, init) => {
        if (url === CHAT_URL && init?.method === "POST") return new Promise<Response>((resolve) => (finish = resolve));
        if (url === CHAT_URL) return Response.json(MARKED_CHAT);
        return Response.json({ topic: TOPIC });
      });
      const room = await goLive();
      await waitForChat(room);
      await act(() => room.result.current.sendMessage("Ett"));
      await act(() => room.result.current.sendMessage("Två"));
      await act(() => room.result.current.sendMessage("Tre"));
      expect(chatSaves()).toHaveLength(1);
      await act(async () => finish(new Response(null, { status: 204 })));
      await flush();
      // Sent within the same millisecond, so their order in the batch is up to their random ids.
      expect(chatSaves().map((save) => save.messages.map((message: { text: string }) => message.text).sort())).toEqual([["Ett"], ["Tre", "Två"]]);
    });

    it("gives up a save that hangs, so the next one still goes out", async () => {
      mockRoomResponseFor((url, init) => {
        if (url === CHAT_URL && init?.method === "POST") {
          // Never answers, but gives up when aborted, as fetch does.
          return new Promise<Response>((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
        }
        if (url === CHAT_URL) return Response.json(MARKED_CHAT);
        return Response.json({ topic: TOPIC });
      });
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const room = await goLive();
      await waitForChat(room);
      await act(() => room.result.current.sendMessage("Ett"));
      await act(() => room.result.current.sendMessage("Två"));
      expect(chatSaves()).toHaveLength(1);
      await flush(CHAT_SAVE_TIMEOUT_MS);
      expect(chatSaves()).toHaveLength(2);
    });

    it("saves to the room a message was sent in, even if the room changes while a save is out", async () => {
      const other = "9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
      const finishes: ((response: Response) => void)[] = [];
      mockRoomResponseFor((url, init) => {
        if (init?.method === "POST") return new Promise<Response>((resolve) => finishes.push(resolve));
        if (url.endsWith("/chat")) return Response.json(MARKED_CHAT);
        return Response.json({ topic: TOPIC });
      });
      const hook = renderHook(({ room }) => useCrosswordRoom("Nova", room), { initialProps: { room: ROOM } });
      await flush();
      act(() => fake.client!.latest!.status("SUBSCRIBED"));
      await waitForChat(hook);
      await act(() => hook.result.current.sendMessage("Här"));
      hook.rerender({ room: other });
      await flush();
      act(() => fake.client!.latest!.status("SUBSCRIBED"));
      await flush();
      await act(() => hook.result.current.sendMessage("Där"));
      await act(async () => finishes[0](new Response(null, { status: 204 })));
      await flush();
      const posts = vi
        .mocked(fetch)
        .mock.calls.filter(([, init]) => init?.method === "POST")
        .map(([url, init]) => [url, JSON.parse(String(init?.body)).messages.map((message: { text: string }) => message.text)]);
      expect(posts).toEqual([
        [CHAT_URL, ["Här"]],
        [`/api/room/${other}/chat`, ["Där"]],
      ]);
    });
  });

  describe("presence", () => {
    it("announces our nickname under our client id once live", async () => {
      const room = await connect();
      expect(room.channel().track).not.toHaveBeenCalled();
      act(() => room.channel().status("SUBSCRIBED"));
      await flush();
      expect(room.channel().track).toHaveBeenCalledWith({ nickname: "Nova" });
      expect(room.channel().options).toMatchObject({ config: { presence: { enabled: true } } });
    });

    it("tracks each tab apart, while messages carry the id the browser keeps across reloads", async () => {
      const first = await goLive();
      const firstKey = presenceKey(first.channel());
      first.unmount();
      const second = await goLive();
      expect(second.result.current.clientId).toBe(first.result.current.clientId);
      expect(presenceKey(second.channel())).not.toBe(firstKey);
      expect(presenceKey(second.channel())).not.toBe(second.result.current.clientId);
    });

    it("lists the valid nicknames of everyone in the room", async () => {
      const room = await goLive();
      act(() => room.channel().syncPresence({ a: [{ nickname: "Nova" }], b: [{ nickname: "Kim" }], c: [{ nickname: " bad" }] }));
      expect(room.result.current.online).toEqual(["Kim", "Nova"]);
      act(() => room.channel().syncPresence({ a: [{ nickname: "Nova" }] }));
      expect(room.result.current.online).toEqual(["Nova"]);
    });

    it("keeps the same list when a sync doesn't change the names, so nothing rerenders", async () => {
      const room = await goLive();
      act(() => room.channel().syncPresence({ a: [{ nickname: "Kim" }] }));
      const first = room.result.current.online;
      act(() => room.channel().syncPresence({ b: [{ nickname: "Kim" }] }));
      expect(room.result.current.online).toBe(first);
    });

    it("retries a failed announcement a few times, then stops", async () => {
      const room = await connect();
      room.channel().trackResult = "error";
      act(() => room.channel().status("SUBSCRIBED"));
      await flush();
      expect(room.channel().track).toHaveBeenCalledTimes(1);
      await flush(1000);
      expect(room.channel().track).toHaveBeenCalledTimes(2);
      await flush(10_000);
      expect(room.channel().track).toHaveBeenCalledTimes(4);
    });

    it("stops retrying once an announcement gets through", async () => {
      const room = await connect();
      room.channel().trackResult = "timed out";
      act(() => room.channel().status("SUBSCRIBED"));
      await flush();
      room.channel().trackResult = "ok";
      await flush(10_000);
      expect(room.channel().track).toHaveBeenCalledTimes(2);
    });

    it("announces again when a presence sync is missing us", async () => {
      const room = await goLive();
      act(() => room.channel().syncPresence({ [presenceKey(room.channel())]: [{ nickname: "Nova" }] }));
      await flush();
      expect(room.channel().track).toHaveBeenCalledTimes(1);
      act(() => room.channel().syncPresence({ other: [{ nickname: "Kim" }] }));
      await flush();
      expect(room.channel().track).toHaveBeenCalledTimes(2);
    });

    it("forgets who was online when the channel drops", async () => {
      const room = await goLive();
      act(() => room.channel().syncPresence({ a: [{ nickname: "Kim" }] }));
      act(() => room.channel().status("CHANNEL_ERROR"));
      expect(room.result.current.online).toEqual([]);
    });

    it("does not announce a nickname peers would reject", async () => {
      const hook = renderHook(() => useCrosswordRoom(" Nova", ROOM));
      await flush();
      act(() => fake.client!.latest!.status("SUBSCRIBED"));
      await flush();
      expect(fake.client!.latest!.track).not.toHaveBeenCalled();
      hook.unmount();
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

    it("attaches a stored photo to the current puzzle and shares the board again", async () => {
      const PHOTO = "3f2c1a9e-8b4d-4c6e-9a1b-2d3e4f5a6b7c";
      const room = await goLive();
      act(() => room.result.current.publishPuzzle(puzzle));
      await flush();
      // The uploader calls back with the function it had before the puzzle loaded.
      const attachPhoto = room.result.current.attachPhoto;
      act(() => room.result.current.setLetter(0, 0, "a"));
      act(() => attachPhoto(puzzle.id, PHOTO));
      await flush();
      expect(room.result.current.board.puzzle?.photo).toBe(PHOTO);
      expect(room.channel().sentEvents("puzzle").at(-1)).toEqual({
        puzzle: { ...puzzle, photo: PHOTO },
        letters: { "0-0": "A" },
        authors: { "0-0": "Nova" },
      });
    });

    it("attaches a photo stored for the puzzle the current one starts over, and returns the updated copy", async () => {
      const PHOTO = "3f2c1a9e-8b4d-4c6e-9a1b-2d3e4f5a6b7c";
      const copy = makePuzzle({ id: "copy", createdAt: puzzle.createdAt + 1, restartOf: puzzle.id });
      const room = await goLive();
      act(() => room.result.current.publishPuzzle(puzzle));
      act(() => room.result.current.publishPuzzle(copy));
      await flush();
      let updated: unknown;
      act(() => {
        updated = room.result.current.attachPhoto(puzzle.id, PHOTO);
      });
      await flush();
      expect(updated).toEqual({ ...copy, photo: PHOTO });
      expect(room.result.current.board.puzzle).toEqual({ ...copy, photo: PHOTO });
      expect(room.channel().sentEvents("puzzle").at(-1)).toEqual({ puzzle: { ...copy, photo: PHOTO }, letters: {}, authors: {} });
      let again: unknown;
      act(() => {
        again = room.result.current.attachPhoto(puzzle.id, PHOTO);
      });
      expect(again).toBeNull();
    });

    it("opens a stored puzzle in an empty room and shares it", async () => {
      const room = await goLive();
      act(() => room.result.current.restorePuzzle(puzzle));
      await flush();
      expect(room.result.current.board.puzzle).toEqual(puzzle);
      expect(room.channel().sentEvents("puzzle").at(-1)).toEqual({ puzzle, letters: {}, authors: {} });
    });

    it("opens a stored puzzle with its saved letters in an empty room, and shares them", async () => {
      const room = await goLive();
      act(() => room.result.current.restorePuzzle(puzzle, { letters: { "0-0": "K" }, authors: { "0-0": "Ola" } }));
      await flush();
      expect(room.result.current.board.letters).toEqual({ "0-0": "K" });
      expect(room.channel().sentEvents("puzzle").at(-1)).toEqual({ puzzle, letters: { "0-0": "K" }, authors: { "0-0": "Ola" } });
    });

    it("merges saved letters into the same puzzle, ours winning, and shares only letters the room lacked", async () => {
      const room = await goLive();
      act(() => room.result.current.publishPuzzle(puzzle));
      act(() => room.result.current.setLetter(0, 0, "a"));
      await flush();
      const sent = room.channel().sentEvents("puzzle").length;

      act(() => room.result.current.restorePuzzle(puzzle, { letters: { "0-0": "K" }, authors: { "0-0": "Ola" } }));
      await flush();
      expect(room.result.current.board.letters).toEqual({ "0-0": "A" });
      expect(room.channel().sentEvents("puzzle")).toHaveLength(sent);

      act(() => room.result.current.restorePuzzle(puzzle, { letters: { "0-1": "B" }, authors: { "0-1": "Ola" } }));
      await flush();
      expect(room.result.current.board.letters).toEqual({ "0-0": "A", "0-1": "B" });
      expect(room.channel().sentEvents("puzzle").at(-1)).toEqual({
        puzzle,
        letters: { "0-0": "A", "0-1": "B" },
        authors: { "0-0": "Nova", "0-1": "Ola" },
      });
    });

    it("saves the letters once typing pauses, but not for letters a peer typed", async () => {
      const room = await goLive();
      act(() => room.result.current.publishPuzzle(puzzle));
      await flush();
      const saves = () => vi.mocked(fetch).mock.calls.filter(([url]) => url === `/api/puzzle/${puzzle.id}/letters`);

      act(() => room.channel().receive("cell-update", { puzzleId: puzzle.id, row: 1, col: 1, value: "P", author: "Peer" }));
      await flush(SAVE_DELAY_MS * 2);
      expect(saves()).toEqual([]);

      act(() => room.result.current.setLetter(0, 0, "a"));
      act(() => room.result.current.setLetter(0, 1, "b"));
      await flush(SAVE_DELAY_MS - 1);
      expect(saves()).toEqual([]);
      await flush(1);
      expect(saves()).toHaveLength(1);
      expect(JSON.parse(String(saves()[0][1]?.body))).toEqual({
        letters: { "0-0": "A", "0-1": "B", "1-1": "P" },
        authors: { "0-0": "Nova", "0-1": "Nova", "1-1": "Peer" },
      });
    });

    it("keeps the room's newer puzzle over a stored older one, without sharing it", async () => {
      const room = await goLive();
      const newer = makePuzzle({ id: "newer", createdAt: puzzle.createdAt + 1 });
      act(() => room.result.current.publishPuzzle(newer));
      await flush();
      const sent = room.channel().sentEvents("puzzle").length;
      act(() => room.result.current.restorePuzzle(puzzle));
      await flush();
      expect(room.result.current.board.puzzle?.id).toBe("newer");
      expect(room.channel().sentEvents("puzzle")).toHaveLength(sent);
    });

    it("doesn't share a stored puzzle the room already has", async () => {
      const room = await goLive();
      act(() => room.result.current.publishPuzzle(puzzle));
      await flush();
      const sent = room.channel().sentEvents("puzzle").length;
      act(() => room.result.current.restorePuzzle(puzzle));
      await flush();
      expect(room.channel().sentEvents("puzzle")).toHaveLength(sent);
    });

    it("sees a peer's newer puzzle that arrived just before the link loaded, before any render", async () => {
      const room = await goLive();
      const newer = makePuzzle({ id: "newer", createdAt: puzzle.createdAt + 1 });
      act(() => {
        room.channel().receive("puzzle", { puzzle: newer, letters: {}, authors: {} });
        room.result.current.restorePuzzle(puzzle);
      });
      await flush();
      expect(room.result.current.board.puzzle?.id).toBe("newer");
      expect(room.channel().sentEvents("puzzle")).toEqual([]);
    });

    it("ignores a stored photo for a puzzle that was replaced meanwhile", async () => {
      const room = await goLive();
      act(() => room.result.current.publishPuzzle(makePuzzle({ id: "newer" })));
      await flush();
      const sent = room.channel().sentEvents("puzzle").length;
      act(() => room.result.current.attachPhoto(puzzle.id, "3f2c1a9e-8b4d-4c6e-9a1b-2d3e4f5a6b7c"));
      await flush();
      expect(room.result.current.board.puzzle?.photo).toBeUndefined();
      expect(room.channel().sentEvents("puzzle")).toHaveLength(sent);
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

