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
 * A colour slot for each name, after the ones already in `assigned`. Every
 * name takes the slot it hashes to; on a clash, the name later in sort order
 * moves on to the next free slot. Tabs that see the same names agree without
 * coordinating. With more names than slots, colours repeat.
 */
export function assignColours(
  names: Iterable<string>,
  slots: number,
  assigned: ReadonlyMap<string, number> = new Map(),
): Map<string, number> {
  const colours = new Map(assigned);
  const taken = new Set(assigned.values());
  for (const name of [...new Set(names)].filter((name) => !assigned.has(name)).toSorted()) {
    const preferred = preferredSlot(name, slots);
    const free = Array.from({ length: slots }, (_, step) => (preferred + step) % slots).find((slot) => !taken.has(slot));
    const slot = free ?? preferred;
    taken.add(slot);
    colours.set(name, slot);
  }
  return colours;
}

/**
 * Colours for the players who typed letters, then for those only online, in
 * the slots left over. Letters are the same synced board in every tab, so
 * their colours agree everywhere and don't move when someone just watching
 * comes or goes. A watcher's colour may move once they type.
 */
export function playerColours(authors: Iterable<string>, online: Iterable<string>, slots: number) {
  return assignColours(online, slots, assignColours(authors, slots));
}

/**
 * A peer can open any number of tabs, so presence yields at most this many
 * names (the first found, so a flood can still crowd others out, but the
 * work stays bounded); colours repeat past PLAYER_COLOURS anyway.
 */
export const MAX_ONLINE = 50;

/**
 * The names of the players in the room, from a Supabase presence state
 * (presence key → the payloads that client tracked). Peers choose what they
 * track, so each nickname is validated; duplicates (one player in two tabs)
 * collapse.
 */
export function onlineNames(state: unknown): string[] {
  if (!state || typeof state !== "object") return [];
  const names = new Set<string>();
  for (const metas of Object.values(state)) {
    if (!Array.isArray(metas)) continue;
    for (const meta of metas) {
      const nickname = (meta as { nickname?: unknown } | null)?.nickname;
      if (isPlayerName(nickname)) names.add(nickname);
      if (names.size >= MAX_ONLINE) return [...names].toSorted();
    }
  }
  return [...names].toSorted();
}

/** Whether two sorted name lists are the same, so an unchanged presence sync needn't rerender. */
export function sameNames(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((name, index) => name === b[index]);
}
