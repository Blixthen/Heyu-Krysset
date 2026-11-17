import { describe, expect, it } from "vitest";
import { MAX_MESSAGES, type ChatMessage } from "./chat";
import { MAX_REACTORS, MAX_VERSION_AHEAD_MS } from "./reactions";
import {
  checkChatUpload,
  combineUploads,
  EMPTY_CHAT,
  isEmptyChat,
  MAX_STORED_REACTIONS,
  mergeChat,
  missingFrom,
  readStoredChat,
  type StoredChat,
  type StoredReaction,
} from "./storedChat";

const NOW = Date.parse("2026-11-17T12:00:00Z");

const message = (id: string, minute = 0, overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  senderId: "kim-browser",
  nickname: "Kim",
  text: `text ${id}`,
  sentAt: new Date(NOW + minute * 60_000).toISOString(),
  ...overrides,
});

const reaction = (overrides: Partial<StoredReaction> = {}): StoredReaction => ({
  messageId: "m1",
  emoji: "👍",
  senderId: "ann-browser",
  nickname: "Ann",
  on: true,
  version: NOW,
  ...overrides,
});

const chat = (messages: ChatMessage[], reactions: StoredReaction[] = []): StoredChat => ({ messages, reactions });

describe("checkChatUpload", () => {
  it("accepts a valid chat and drops extra fields", () => {
    const result = checkChatUpload(
      { messages: [{ ...message("m1"), extra: 1 }], reactions: [{ ...reaction(), extra: 2 }], extra: 3 },
      NOW,
    );
    expect(result).toEqual({ ok: true, value: chat([message("m1")], [reaction()]) });
  });

  it("leaves out each invalid item, keeping what was sent with it", () => {
    const result = checkChatUpload(
      {
        messages: [{ ...message("bad"), text: "" }, message("m1")],
        reactions: [
          { ...reaction({ senderId: "old-tab" }), version: undefined },
          // Valid to a sender whose clock is ahead, not to us.
          reaction({ senderId: "fast-clock", version: NOW + MAX_VERSION_AHEAD_MS + 1 }),
          reaction(),
        ],
      },
      NOW,
    );
    expect(result).toEqual({ ok: true, value: chat([message("m1")], [reaction()]) });
  });

  it.each([
    ["no object", null],
    ["no message list", { reactions: [] }],
    ["no reaction list", { messages: [] }],
    ["too many messages", { messages: Array.from({ length: MAX_MESSAGES + 1 }, (_, i) => message(`m${i}`)), reactions: [] }],
    [
      "too many reactions",
      { messages: [], reactions: Array.from({ length: MAX_STORED_REACTIONS + 1 }, (_, i) => reaction({ senderId: `s${i}` })) },
    ],
  ])("rejects %s", (_name, value) => {
    expect(checkChatUpload(value, NOW).ok).toBe(false);
  });
});

describe("readStoredChat", () => {
  it("keeps what is still valid of a stored chat, so a tightened rule or a slow clock loses only those items", () => {
    const stored = {
      messages: [message("m1"), { ...message("m2"), nickname: "x".repeat(100) }],
      reactions: [reaction(), reaction({ senderId: "ahead", version: NOW + MAX_VERSION_AHEAD_MS + 1 })],
    };
    expect(readStoredChat(stored, NOW)).toEqual(chat([message("m1")], [reaction()]));
  });

  it("reads anything that isn't a chat as empty", () => {
    expect(readStoredChat(null, NOW)).toEqual(EMPTY_CHAT);
    expect(readStoredChat({ messages: "x", reactions: [] }, NOW)).toEqual(EMPTY_CHAT);
  });

  it("reads no more than a full chat from a longer list", () => {
    const messages = Array.from({ length: MAX_MESSAGES + 5 }, (_, i) => message(`m${i}`, i));
    const read = readStoredChat({ messages, reactions: [] }, NOW);
    expect(read.messages).toHaveLength(MAX_MESSAGES);
    expect(read.messages[0].id).toBe("m5");
  });
});

describe("mergeChat", () => {
  it("holds every message once, in the order they were sent", () => {
    const merged = mergeChat(chat([message("b", 2), message("a", 1)]), chat([message("c", 3), message("a", 1)]));
    expect(merged.messages.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps each reaction at its newest version, removals included", () => {
    const merged = mergeChat(
      chat([message("m1")], [reaction({ version: NOW + 2, on: false }), reaction({ emoji: "😂", version: NOW })]),
      chat([], [reaction({ version: NOW + 1 }), reaction({ emoji: "😂", version: NOW + 3, on: false })]),
    );
    expect(merged.reactions).toEqual([reaction({ version: NOW + 2, on: false }), reaction({ emoji: "😂", version: NOW + 3, on: false })]);
  });

  it("gives the same chat in any order and when the same save arrives twice", () => {
    const a = chat([message("m1", 1), message("m2", 2)], [reaction({ version: NOW + 1 })]);
    const b = chat([message("m3", 3), message("m1", 1)], [reaction({ version: NOW + 5, on: false }), reaction({ messageId: "m3", version: NOW + 2 })]);
    const c = chat([message("m2", 2)], [reaction({ messageId: "m2", senderId: "kim", nickname: "Kim", version: NOW + 4 })]);
    const once = mergeChat(mergeChat(a, b), c);
    expect(mergeChat(c, mergeChat(b, a))).toEqual(once);
    expect(mergeChat(mergeChat(once, b), a)).toEqual(once);
    expect(mergeChat(once, c)).toEqual(once);
  });

  it(`keeps the newest ${MAX_MESSAGES} messages, and only reactions to those`, () => {
    const many = Array.from({ length: MAX_MESSAGES }, (_, i) => message(`n${i}`, 10 + i));
    const merged = mergeChat(chat([message("old", 0)], [reaction({ messageId: "old" })]), chat(many, [reaction({ messageId: "n0" })]));
    expect(merged.messages).toHaveLength(MAX_MESSAGES);
    expect(merged.messages.some((m) => m.id === "old")).toBe(false);
    expect(merged.reactions).toEqual([reaction({ messageId: "n0" })]);
  });

  it("drops reactions to messages it doesn't hold", () => {
    expect(mergeChat(chat([message("m1")]), chat([], [reaction({ messageId: "elsewhere" })])).reactions).toEqual([]);
  });

  it(`keeps at most ${MAX_REACTORS} reactions per emoji, the newest`, () => {
    const many = Array.from({ length: MAX_REACTORS + 2 }, (_, i) => reaction({ senderId: `s${i}`, version: NOW + i }));
    const merged = mergeChat(chat([message("m1")]), chat([], many));
    expect(merged.reactions).toHaveLength(MAX_REACTORS);
    expect(merged.reactions.some((r) => r.senderId === "s0" || r.senderId === "s1")).toBe(false);
  });

  it(`keeps at most ${MAX_STORED_REACTIONS} reactions in all`, () => {
    const messages = Array.from({ length: 30 }, (_, i) => message(`m${i}`, i));
    const reactions = messages.flatMap((m, i) =>
      Array.from({ length: MAX_REACTORS }, (_, j) => reaction({ messageId: m.id, senderId: `s${j}`, version: NOW - i * 100 - j })),
    );
    const merged = mergeChat(chat(messages), chat([], reactions));
    expect(merged.reactions).toHaveLength(MAX_STORED_REACTIONS);
    // The newest are on the first ten messages, each a hundred below the one before.
    expect(merged.reactions.every((r) => r.version > NOW - 1000)).toBe(true);
  });
});

describe("combineUploads", () => {
  it("keeps reactions to messages it doesn't hold, since the store may", () => {
    const combined = combineUploads(chat([], [reaction({ version: NOW })]), chat([message("m2")], [reaction({ version: NOW + 1, on: false })]));
    expect(combined).toEqual(chat([message("m2")], [reaction({ version: NOW + 1, on: false })]));
  });
});

describe("missingFrom", () => {
  it("is what we have that the store lacks or holds an older version of", () => {
    const stored = chat([message("m1")], [reaction({ version: NOW + 2 }), reaction({ emoji: "😂", version: NOW + 2 })]);
    const ours = chat(
      [message("m1"), message("m2", 1)],
      [reaction({ version: NOW + 1, on: false }), reaction({ emoji: "😂", version: NOW + 3, on: false }), reaction({ emoji: "🎉" })],
    );
    expect(missingFrom(stored, ours)).toEqual(
      chat([message("m2", 1)], [reaction({ emoji: "😂", version: NOW + 3, on: false }), reaction({ emoji: "🎉" })]),
    );
  });

  it("is nothing when the store holds all we have", () => {
    const stored = chat([message("m1")], [reaction()]);
    expect(isEmptyChat(missingFrom(stored, stored))).toBe(true);
    expect(isEmptyChat(missingFrom(stored, EMPTY_CHAT))).toBe(true);
  });

  it("leaves out messages older than a full store keeps, which it would drop again", () => {
    const stored = chat(Array.from({ length: MAX_MESSAGES }, (_, i) => message(`n${i}`, 10 + i)));
    const ours = chat([message("old", 0), message("new", 10 + MAX_MESSAGES)]);
    expect(missingFrom(stored, ours).messages.map((m) => m.id)).toEqual(["new"]);
  });
});
