// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_VERSION_AHEAD_MS } from "./reactions";

const NOW = Date.parse("2026-11-17T12:00:00Z");

// Fresh module per test, so its in-memory fallbacks start empty.
async function load() {
  vi.resetModules();
  return import("./sender");
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("senderId", () => {
  it("keeps the same id across reloads", async () => {
    const first = (await load()).senderId();
    expect((await load()).senderId()).toBe(first);
  });

  it("makes a new id when the stored one is too long to send", async () => {
    localStorage.setItem("heyu-sender-id", "x".repeat(65));
    expect((await load()).senderId()).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("keeps one id in memory when storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { senderId } = await load();
    expect(senderId()).toBe(senderId());
  });
});

describe("takeReactionVersion", () => {
  it("rises with every change, even within one millisecond and across reloads", async () => {
    const first = (await load()).takeReactionVersion(NOW);
    const second = (await load()).takeReactionVersion(NOW);
    expect(first).toBe(NOW);
    expect(second).toBe(NOW + 1);
  });

  it("starts over from the clock when the stored version is too far ahead", async () => {
    localStorage.setItem("heyu-reaction-version", String(NOW + MAX_VERSION_AHEAD_MS + 1));
    expect((await load()).takeReactionVersion(NOW)).toBe(NOW);
  });

  it("still rises when storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { takeReactionVersion } = await load();
    expect(takeReactionVersion(NOW)).toBe(NOW);
    expect(takeReactionVersion(NOW)).toBe(NOW + 1);
  });
});
