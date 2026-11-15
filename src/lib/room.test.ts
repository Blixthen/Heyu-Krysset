import { makePuzzle } from "@/test/fixtures";
import { describe, expect, it } from "vitest";
import { roomChannel, roomOf } from "./room";

describe("roomOf", () => {
  it("is a puzzle's own id, or for a copy started over, the first puzzle's", () => {
    expect(roomOf(makePuzzle({ id: "first" }))).toBe("first");
    expect(roomOf(makePuzzle({ id: "copy", restartOf: "first" }))).toBe("first");
  });
});

describe("roomChannel", () => {
  it("joins the secret topic and the room, so each room has a channel of its own", () => {
    expect(roomChannel("crossword-abc", "first")).toBe("crossword-abc:first");
    expect(roomChannel("crossword-abc", "first")).not.toBe(roomChannel("crossword-abc", "second"));
    expect(roomChannel("crossword-abc", "first")).not.toBe(roomChannel("crossword-xyz", "first"));
  });
});
