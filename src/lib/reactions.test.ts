import { describe, expect, it } from "vitest";
import { MAX_MESSAGES } from "./chat";
import {
  applyReaction,
  hasReacted,
  isReaction,
  MAX_REACTORS,
  reactionChips,
  toReaction,
  type Reaction,
  type Reactions,
} from "./reactions";

const reaction = (overrides: Partial<Reaction> = {}): Reaction => ({
  messageId: "m1",
  emoji: "👍",
  senderId: "kim-tab",
  nickname: "Kim",
  on: true,
  ...overrides,
});

const apply = (...reactions: Reaction[]) => reactions.reduce<Reactions>(applyReaction, new Map());

describe("isReaction", () => {
  it("accepts a valid reaction", () => {
    expect(isReaction(reaction())).toBe(true);
    expect(isReaction(reaction({ emoji: "❤️", on: false }))).toBe(true);
  });

  it.each([
    ["an emoji outside the picker", { emoji: "💩" }],
    ["text instead of an emoji", { emoji: "<b>" }],
    ["a missing on/off", { on: undefined }],
    ["an empty message id", { messageId: "" }],
    ["an overlong nickname", { nickname: "x".repeat(25) }],
    ["an overlong sender id", { senderId: "x".repeat(65) }],
  ])("rejects %s", (_name, overrides) => {
    expect(isReaction({ ...reaction(), ...overrides })).toBe(false);
  });

  it.each([null, "👍", 5])("rejects %j", (value) => {
    expect(isReaction(value)).toBe(false);
  });
});

describe("toReaction", () => {
  it("drops fields a peer attached", () => {
    expect(toReaction({ ...reaction(), extra: "x" } as Reaction)).toEqual(reaction());
  });
});

describe("applyReaction", () => {
  it("adds reactions per message, emoji and player", () => {
    const reactions = apply(reaction(), reaction({ senderId: "ann-tab", nickname: "Ann" }), reaction({ emoji: "😂" }));
    expect(reactionChips(reactions, "m1", "ann-tab")).toEqual([
      { emoji: "👍", count: 2, names: ["Kim", "Ann"], mine: true },
      { emoji: "😂", count: 1, names: ["Kim"], mine: false },
    ]);
  });

  it("removes a reaction, and the message's entry with its last one", () => {
    const added = apply(reaction(), reaction({ emoji: "😂" }));
    const one = applyReaction(added, reaction({ on: false }));
    expect(reactionChips(one, "m1", "kim-tab")).toEqual([{ emoji: "😂", count: 1, names: ["Kim"], mine: true }]);
    expect(applyReaction(one, reaction({ emoji: "😂", on: false })).has("m1")).toBe(false);
  });

  it("returns the same state for a repeated or unknown change", () => {
    const added = apply(reaction());
    expect(applyReaction(added, reaction())).toBe(added);
    expect(applyReaction(added, reaction({ senderId: "ann-tab", on: false }))).toBe(added);
  });

  it(`counts at most ${MAX_REACTORS} players per emoji`, () => {
    const many = Array.from({ length: MAX_REACTORS + 5 }, (_, index) => reaction({ senderId: `tab-${index}` }));
    const reactions = apply(...many);
    expect(reactionChips(reactions, "m1", "x")[0].count).toBe(MAX_REACTORS);
    // Removing one makes room again.
    const freed = applyReaction(reactions, reaction({ senderId: "tab-0", on: false }));
    expect(hasReacted(applyReaction(freed, reaction({ senderId: "late" })), "m1", "👍", "late")).toBe(true);
  });

  it(`keeps reactions for at most ${MAX_MESSAGES} messages, dropping the oldest`, () => {
    const many = Array.from({ length: MAX_MESSAGES + 1 }, (_, index) => reaction({ messageId: `m${index}` }));
    const reactions = apply(...many);
    expect(reactions.size).toBe(MAX_MESSAGES);
    expect(reactions.has("m0")).toBe(false);
    expect(reactions.has(`m${MAX_MESSAGES}`)).toBe(true);
  });
});

describe("hasReacted", () => {
  it("tells whether this client reacted with that emoji", () => {
    const reactions = apply(reaction());
    expect(hasReacted(reactions, "m1", "👍", "kim-tab")).toBe(true);
    expect(hasReacted(reactions, "m1", "😂", "kim-tab")).toBe(false);
    expect(hasReacted(reactions, "m1", "👍", "ann-tab")).toBe(false);
    expect(hasReacted(reactions, "m2", "👍", "kim-tab")).toBe(false);
  });
});
