import { describe, expect, it } from "vitest";
import { gateToken, hasValidGateCookie, roomTopic, safeEqual } from "./gate";

describe("safeEqual", () => {
  it("matches equal strings", () => {
    expect(safeEqual("hunter2", "hunter2")).toBe(true);
  });

  it("rejects different strings, including different lengths", () => {
    expect(safeEqual("hunter2", "hunter3")).toBe(false);
    expect(safeEqual("short", "a much longer password")).toBe(false);
  });

  it("never matches empty strings", () => {
    expect(safeEqual("", "")).toBe(false);
    expect(safeEqual("", "x")).toBe(false);
  });
});

describe("tokens", () => {
  it("derives distinct, deterministic values per password", () => {
    expect(gateToken("a")).toBe(gateToken("a"));
    expect(gateToken("a")).not.toBe(gateToken("b"));
    expect(roomTopic("a")).not.toBe(roomTopic("b"));
  });

  it("does not reuse the gate cookie as the room topic", () => {
    expect(roomTopic("a")).not.toContain(gateToken("a"));
    expect(roomTopic("a")).toMatch(/^crossword-[A-Za-z0-9_-]{32}$/);
  });
});

describe("hasValidGateCookie", () => {
  it("accepts the token for the current password", () => {
    expect(hasValidGateCookie(gateToken("pw"), "pw")).toBe(true);
  });

  it("rejects a token for an old password", () => {
    expect(hasValidGateCookie(gateToken("old"), "new")).toBe(false);
  });

  it("fails closed when no password is configured", () => {
    expect(hasValidGateCookie(gateToken(""), undefined)).toBe(false);
    expect(hasValidGateCookie(undefined, "")).toBe(false);
  });
});
