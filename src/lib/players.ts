/**
 * Nickname rules and player colours, shared by the chat, the board and the
 * grid. Pure and runtime-agnostic, since the crossword validators that the
 * server also runs depend on it.
 */

export const MAX_NICKNAME_LENGTH = 24;

/**
 * A peer's nickname as the author of a letter: non-empty, trimmed the way
 * NicknameForm leaves it, and bounded, so a blank name can't own a colour.
 */
export function isPlayerName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_NICKNAME_LENGTH && value.trim() === value;
}

/** The slot a name hashes to (FNV-1a), before any clash is resolved. */
function preferredSlot(name: string, slots: number) {
  let hash = 0x811c9dc5;
  for (const char of name) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % slots;
}

/**
 * A colour slot for each player. Every name takes the slot it hashes to; on a
 * clash, the name later in sort order moves on to the next free slot. Every
 * tab works this out from the same synced set of names, so all agree without
 * coordinating, and colours only move when a new name clashes. With more
 * players than slots, colours repeat.
 */
export function assignColours(names: Iterable<string>, slots: number): Map<string, number> {
  const colours = new Map<string, number>();
  const taken = new Set<number>();
  for (const name of [...new Set(names)].toSorted()) {
    const preferred = preferredSlot(name, slots);
    const free = Array.from({ length: slots }, (_, step) => (preferred + step) % slots).find((slot) => !taken.has(slot));
    const slot = free ?? preferred;
    taken.add(slot);
    colours.set(name, slot);
  }
  return colours;
}
