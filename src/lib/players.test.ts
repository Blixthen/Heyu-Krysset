import { describe, expect, it } from "vitest";
import { assignColours, isPlayerName, MAX_NICKNAME_LENGTH, MAX_ONLINE, onlineNames } from "./players";

describe("isPlayerName", () => {
  it("accepts a trimmed, bounded name", () => {
    expect(isPlayerName("Kim")).toBe(true);
    expect(isPlayerName("x".repeat(MAX_NICKNAME_LENGTH))).toBe(true);
  });

  it.each(["", "   ", " Kim", "Kim ", "x".repeat(MAX_NICKNAME_LENGTH + 1), 7, null])("rejects %j", (value) => {
    expect(isPlayerName(value)).toBe(false);
  });
});

describe("assignColours", () => {
  // Ann, Liv and Åsa all hash to slot 0; Kim hashes to 4 and Ida to 3.
  it("moves clashing names to the next free slot, in sort order", () => {
    expect(Object.fromEntries(assignColours(["Åsa", "Kim", "Liv", "Ann"], 8))).toEqual({ Ann: 0, Kim: 4, Liv: 1, Åsa: 2 });
  });

  it("gives every tab the same colours, whatever order it saw the names in", () => {
    const names = ["Åsa", "Kim", "Liv", "Ann", "Kim"];
    expect(assignColours(names.toReversed(), 8)).toEqual(assignColours(names, 8));
  });

  it("keeps everyone's colour when a name without a clash joins", () => {
    const before = assignColours(["Ann", "Kim", "Liv"], 8);
    const after = assignColours(["Ann", "Kim", "Liv", "Ida"], 8);
    for (const [name, slot] of before) expect(after.get(name)).toBe(slot);
    expect(after.get("Ida")).toBe(3);
  });

  it("uses every slot before repeating one", () => {
    const names = Array.from({ length: 9 }, (_, index) => `spelare ${index}`);
    const slots = [...assignColours(names, 8).values()];
    expect(new Set(slots).size).toBe(8);
    expect(slots.every((slot) => slot >= 0 && slot < 8)).toBe(true);
  });
});

describe("onlineNames", () => {
  it("lists each valid nickname once, in sort order", () => {
    const state = {
      a: [{ nickname: "Liv", presence_ref: "1" }],
      b: [{ nickname: "Ann", presence_ref: "2" }, { nickname: "Liv", presence_ref: "3" }],
    };
    expect(onlineNames(state)).toEqual(["Ann", "Liv"]);
  });

  it("drops nicknames that fail validation and entries that aren't lists", () => {
    const state = { a: [{ nickname: " Kim" }, { nickname: 7 }, null, {}], b: "Ida", c: [{ nickname: "Åsa" }] };
    expect(onlineNames(state)).toEqual(["Åsa"]);
  });

  it.each([null, undefined, "Kim", 7])("gives no names for %j", (state) => {
    expect(onlineNames(state)).toEqual([]);
  });

  it(`keeps at most ${MAX_ONLINE} names`, () => {
    const state = Object.fromEntries(Array.from({ length: MAX_ONLINE + 5 }, (_, i) => [`k${i}`, [{ nickname: `P${String(i).padStart(2, "0")}` }]]));
    const names = onlineNames(state);
    expect(names).toHaveLength(MAX_ONLINE);
    expect(names[0]).toBe("P00");
  });
});
