import { describe, expect, it } from "vitest";
import { appendMessage, formatTime, isChatMessage, MAX_MESSAGES, toChatMessage, type ChatMessage } from "./chat";

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
