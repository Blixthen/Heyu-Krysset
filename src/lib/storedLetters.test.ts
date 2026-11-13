import { describe, expect, it } from "vitest";
import { MAX_CELLS } from "./crossword";
import { checkLettersUpload, lettersKey, lettersToSave, lettersUrl } from "./storedLetters";

const ID = "3f2c1a9e-8b4d-4c6e-9a1b-2d3e4f5a6b7c";

describe("lettersUrl and lettersKey", () => {
  it("keep letters apart from the puzzle", () => {
    expect(lettersUrl(ID)).toBe(`/api/puzzle/${ID}/letters`);
    expect(lettersKey(ID)).toBe(`letters/${ID}.json`);
  });
});

describe("checkLettersUpload", () => {
  it("accepts letters and their authors, copying only those fields", () => {
    const result = checkLettersUpload({ letters: { "0-0": "K", "12-3": "Å" }, authors: { "0-0": "Nova" }, extra: 1 });
    expect(result).toEqual({ ok: true, value: { letters: { "0-0": "K", "12-3": "Å" }, authors: { "0-0": "Nova" } } });
  });

  it("leaves out cleared squares and authors of squares without a letter", () => {
    const result = checkLettersUpload({ letters: { "0-0": "", "0-1": "B" }, authors: { "0-0": "Nova", "0-1": "Ola", "5-5": "Ola" } });
    expect(result).toEqual({ ok: true, value: { letters: { "0-1": "B" }, authors: { "0-1": "Ola" } } });
  });

  it.each([
    ["not an object", "KRYSS"],
    ["an array", []],
    ["missing letters", { authors: {} }],
    ["missing authors", { letters: {} }],
    ["letters as an array", { letters: ["K"], authors: {} }],
    ["a key that isn't a square", { letters: { "../x": "K" }, authors: {} }],
    ["a key with a leading zero", { letters: { "01-1": "K" }, authors: {} }],
    ["a key out of range", { letters: { "10000-1": "K" }, authors: {} }],
    ["two letters in a square", { letters: { "0-0": "KR" }, authors: {} }],
    ["a lower-case letter", { letters: { "0-0": "k" }, authors: {} }],
    ["a digit", { letters: { "0-0": "1" }, authors: {} }],
    ["a letter that isn't a string", { letters: { "0-0": 1 }, authors: {} }],
    ["an invalid author", { letters: { "0-0": "K" }, authors: { "0-0": " Nova" } }],
    ["an author for a key that isn't a square", { letters: {}, authors: { x: "Nova" } }],
  ])("rejects %s", (_name, value) => {
    expect(checkLettersUpload(value)).toEqual({ ok: false, error: { message: "Bokstäverna kunde inte sparas.", status: 400 } });
  });

  it("rejects more letters than a puzzle can have squares", () => {
    const letters = Object.fromEntries(Array.from({ length: MAX_CELLS + 1 }, (_, index) => [`${index}-0`, "A"]));
    expect(checkLettersUpload({ letters, authors: {} }).ok).toBe(false);
    delete letters["0-0"];
    expect(checkLettersUpload({ letters, authors: {} }).ok).toBe(true);
  });
});

describe("lettersToSave", () => {
  it("keeps filled squares and the authors of their letters", () => {
    expect(lettersToSave({ "0-0": "K", "0-1": "", "0-2": "S" }, { "0-0": "Nova", "0-1": "Ola" })).toEqual({
      letters: { "0-0": "K", "0-2": "S" },
      authors: { "0-0": "Nova" },
    });
  });
});
