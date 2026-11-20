import { describe, expect, it } from "vitest";
import { MAX_MESSAGES } from "./chat";
import {
  applyReaction,
  hasReacted,
  isReaction,
  MAX_REACTORS,
  MAX_VERSION_AHEAD_MS,
  nextVersion,
  reactionChips,
  replacesHead,
  toReaction,
  versionedReactions,
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

const NOW = Date.parse("2026-11-17T12:00:00Z");

const apply = (...reactions: Reaction[]) => reactions.reduce<Reactions>(applyReaction, new Map());

describe("isReaction", () => {
  it("accepts a valid reaction", () => {
    expect(isReaction(reaction(), NOW)).toBe(true);
    expect(isReaction(reaction({ emoji: "❤️", on: false }), NOW)).toBe(true);
    expect(isReaction(reaction({ version: NOW + MAX_VERSION_AHEAD_MS }), NOW)).toBe(true);
  });

  it.each([
    ["an emoji outside the picker", { emoji: "💩" }],
    ["text instead of an emoji", { emoji: "<b>" }],
    ["a missing on/off", { on: undefined }],
    ["an empty message id", { messageId: "" }],
    ["an overlong nickname", { nickname: "x".repeat(25) }],
    ["an overlong sender id", { senderId: "x".repeat(65) }],
    ["a version too far ahead of our clock, which would pin the reaction", { version: NOW + MAX_VERSION_AHEAD_MS + 1 }],
    ["a zero version", { version: 0 }],
    ["a fractional version", { version: 1.5 }],
    ["a version that isn't a number", { version: "9" }],
  ])("rejects %s", (_name, overrides) => {
    expect(isReaction({ ...reaction(), ...overrides }, NOW)).toBe(false);
  });

  it.each([null, "👍", 5])("rejects %j", (value) => {
    expect(isReaction(value, NOW)).toBe(false);
  });
});

describe("toReaction", () => {
  it("drops fields a peer attached", () => {
    expect(toReaction({ ...reaction(), extra: "x" } as Reaction)).toEqual(reaction());
    expect(toReaction({ ...reaction({ version: 7 }), extra: "x" } as Reaction)).toEqual(reaction({ version: 7 }));
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

  it("removes a reaction", () => {
    const added = apply(reaction(), reaction({ emoji: "😂" }));
    const one = applyReaction(added, reaction({ on: false }));
    expect(reactionChips(one, "m1", "kim-tab")).toEqual([{ emoji: "😂", count: 1, names: ["Kim"], mine: true }]);
    expect(reactionChips(applyReaction(one, reaction({ emoji: "😂", on: false })), "m1", "kim-tab")).toEqual([]);
  });

  it("keeps the newest version, whatever order the changes arrive in", () => {
    const changes = [reaction({ version: 10 }), reaction({ on: false, version: 20 }), reaction({ version: 30 }), reaction({ on: false, version: 40 })];
    const orders = [changes, [...changes].reverse(), [changes[2], changes[0], changes[3], changes[1]]];
    for (const order of orders) {
      expect(hasReacted(apply(...order), "m1", "👍", "kim-tab")).toBe(false);
    }
    expect(hasReacted(apply(...changes.slice(0, 3).reverse()), "m1", "👍", "kim-tab")).toBe(true);
  });

  it("remembers a removal, so a late older reaction can't bring it back", () => {
    expect(hasReacted(apply(reaction({ on: false, version: 5 }), reaction({ version: 4 })), "m1", "👍", "kim-tab")).toBe(false);
    expect(hasReacted(apply(reaction({ version: 4 }), reaction({ on: false, version: 5 }), reaction({ version: 4 })), "m1", "👍", "kim-tab")).toBe(false);
  });

  it("lets the last change win between tabs without versions, as before", () => {
    const reactions = apply(reaction(), reaction({ on: false }), reaction());
    expect(hasReacted(reactions, "m1", "👍", "kim-tab")).toBe(true);
  });

  it("forgets an unversioned removal of a reaction it never saw", () => {
    const reactions = apply(reaction({ on: false }));
    expect(reactions.size).toBe(0);
  });

  it("returns the same state for a repeated or unknown change", () => {
    const added = apply(reaction());
    expect(applyReaction(added, reaction())).toBe(added);
    expect(applyReaction(added, reaction({ senderId: "ann-tab", on: false }))).toBe(added);
  });

  it("returns the same state for an older change", () => {
    const added = apply(reaction({ version: 9 }));
    expect(applyReaction(added, reaction({ on: false, version: 8 }))).toBe(added);
  });

  it(`counts at most ${MAX_REACTORS} players per emoji`, () => {
    const many = Array.from({ length: MAX_REACTORS + 5 }, (_, index) => reaction({ senderId: `tab-${index}` }));
    const reactions = apply(...many);
    expect(reactionChips(reactions, "m1", "x")[0].count).toBe(MAX_REACTORS);
    // A removal keeps its place, or a peer could cycle made-up ids past the limit.
    const freed = applyReaction(reactions, reaction({ senderId: "tab-0", on: false }));
    expect(reactionChips(freed, "m1", "x")[0].count).toBe(MAX_REACTORS - 1);
    expect(hasReacted(applyReaction(freed, reaction({ senderId: "late" })), "m1", "👍", "late")).toBe(false);
    expect(hasReacted(applyReaction(freed, reaction({ senderId: "tab-0" })), "m1", "👍", "tab-0")).toBe(true);
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

describe("replacesHead", () => {
  const head = { nickname: "Kim", on: true, version: 5 };

  it("takes a higher version and keeps a lower one out", () => {
    expect(replacesHead(head, { ...head, on: false, version: 6 })).toBe(true);
    expect(replacesHead(head, { ...head, on: false, version: 4 })).toBe(false);
    expect(replacesHead(undefined, head)).toBe(true);
  });

  it("breaks a tie the same way from either side", () => {
    const off = { ...head, on: false };
    expect(replacesHead(head, off)).toBe(true);
    expect(replacesHead(off, head)).toBe(false);
    const ann = { ...head, nickname: "Ann" };
    expect(replacesHead(head, ann)).toBe(true);
    expect(replacesHead(ann, head)).toBe(false);
    expect(replacesHead(head, { ...head })).toBe(false);
  });
});

describe("nextVersion", () => {
  it("follows the clock, and stays past the last version if the clock went back", () => {
    expect(nextVersion(0, NOW)).toBe(NOW);
    expect(nextVersion(NOW - 100, NOW)).toBe(NOW);
    expect(nextVersion(NOW + 100, NOW)).toBe(NOW + 101);
  });

  it("starts over from the clock when the last version is so far ahead that peers would reject the next", () => {
    expect(nextVersion(NOW + MAX_VERSION_AHEAD_MS + 1, NOW)).toBe(NOW);
  });
});

describe("versionedReactions", () => {
  it("lists every versioned reaction, removals included, and leaves out unversioned ones", () => {
    const reactions = apply(reaction({ version: 3 }), reaction({ senderId: "ann-tab", nickname: "Ann", on: false, version: 4 }), reaction({ emoji: "😂", senderId: "old-tab" }));
    expect(versionedReactions(reactions)).toEqual([
      reaction({ version: 3 }),
      reaction({ senderId: "ann-tab", nickname: "Ann", on: false, version: 4 }),
    ]);
  });
});
