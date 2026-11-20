import { describe, expect, it } from "vitest";
import { appendMessage, countUnread, formatTime, isChatMessage, MAX_MESSAGES, mergeMessages, toChatMessage, type ChatMessage } from "./chat";

const message: ChatMessage = {
  id: "m1",
  senderId: "client-1",
  nickname: "Nova",
  text: "Hej!",
  sentAt: "2026-11-08T12:34:00.000Z",
};

describe("isChatMessage", () => {
  it("accepts a valid message", () => {
    expect(isChatMessage(message)).toBe(true);
  });

  // Each of these used to reach render and crash every client in the room.
  it.each([
    ["invalid sentAt", { sentAt: "not a date" }],
    ["object text", { text: { toString: "x" } }],
    ["object nickname", { nickname: {} }],
    ["missing senderId", { senderId: undefined }],
    ["empty text", { text: "" }],
    ["oversized text", { text: "a".repeat(501) }],
    ["oversized nickname", { nickname: "a".repeat(25) }],
  ])("rejects %s", (_name, overrides) => {
    expect(isChatMessage({ ...message, ...overrides })).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(isChatMessage(null)).toBe(false);
    expect(isChatMessage("hi")).toBe(false);
  });
});

describe("toChatMessage", () => {
  it("drops unknown fields", () => {
    expect(toChatMessage({ ...message, failed: true } as ChatMessage)).toEqual(message);
  });
});

describe("formatTime", () => {
  it("formats as HH:MM", () => {
    expect(formatTime(message.sentAt)).toMatch(/^\d{2}:\d{2}$/);
  });

  it("returns an empty string instead of throwing on invalid input", () => {
    expect(formatTime("garbage")).toBe("");
  });
});

describe("appendMessage", () => {
  it("ignores duplicate ids", () => {
    const list = [message];
    expect(appendMessage(list, { ...message })).toBe(list);
  });

  it("keeps only the newest messages", () => {
    let list: ChatMessage[] = [];
    for (let index = 0; index < MAX_MESSAGES + 5; index += 1) {
      list = appendMessage(list, { ...message, id: `m${index}` });
    }
    expect(list).toHaveLength(MAX_MESSAGES);
    expect(list[0].id).toBe("m5");
    expect(list.at(-1)?.id).toBe(`m${MAX_MESSAGES + 4}`);
  });
});

describe("countUnread", () => {
  const message = (id: string, senderId: string): ChatMessage => ({ id, senderId, nickname: "N", text: "t", sentAt: "" });
  const messages = [message("a", "peer"), message("b", "me"), message("c", "peer"), message("d", "peer")];

  it("counts others' messages after the last one seen", () => {
    expect(countUnread(messages, "b", "me")).toBe(2);
    expect(countUnread(messages, "d", "me")).toBe(0);
  });

  it("does not count our own messages", () => {
    expect(countUnread(messages, "a", "me")).toBe(2);
  });

  it("counts everything when nothing was seen or the seen message was trimmed", () => {
    expect(countUnread(messages, null, "me")).toBe(3);
    expect(countUnread(messages, "gone", "me")).toBe(3);
  });

  it("does not count the history loaded on joining, only what came after it", () => {
    const withHistory = [{ ...message("h1", "peer"), history: true }, { ...message("h2", "peer"), history: true }, message("new", "peer")];
    expect(countUnread(withHistory, null, "me")).toBe(1);
  });
});

describe("mergeMessages", () => {
  const at = (id: string, minute: number): ChatMessage => ({
    id,
    senderId: "s",
    nickname: "Kim",
    text: id,
    sentAt: `2026-11-17T12:${String(minute).padStart(2, "0")}:00.000Z`,
  });

  it("adds stored messages we lack, in the order they were sent", () => {
    const merged = mergeMessages([at("b", 2), at("d", 4)], [at("a", 1), at("b", 2), at("c", 3)]);
    expect(merged.map((message) => message.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps our copy of a message both have, so a failed mark stays", () => {
    const ours = [{ ...at("a", 1), failed: true }];
    expect(mergeMessages(ours, [{ ...at("a", 1), failed: false }])).toBe(ours);
  });

  it("orders messages sent at the same moment by id", () => {
    expect(mergeMessages([at("y", 1)], [at("x", 1)]).map((message) => message.id)).toEqual(["x", "y"]);
  });

  it(`keeps the newest ${MAX_MESSAGES}`, () => {
    const stored = Array.from({ length: MAX_MESSAGES }, (_, index) => at(`s${index}`, 10 + (index % 40)));
    const merged = mergeMessages([at("old", 0)], stored);
    expect(merged).toHaveLength(MAX_MESSAGES);
    expect(merged.some((message) => message.id === "old")).toBe(false);
  });
});
