import { describe, expect, it } from "vitest";
import { assignColours, isPlayerName, MAX_NICKNAME_LENGTH } from "./players";

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
