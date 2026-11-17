import { MAX_MESSAGES } from "./chat";
import { MAX_NICKNAME_LENGTH } from "./players";

/** The emoji you can react with, in the order the picker and the chips show them. */
export const REACTION_EMOJI = ["👍", "❤️", "😂", "😮", "🎉", "🤔"] as const;
export type ReactionEmoji = (typeof REACTION_EMOJI)[number];

/**
 * One player adding (`on`) or removing a reaction. An explicit on/off rather
 * than a toggle, so a repeated or late event can't flip it the wrong way.
 *
 * Only the sender ever changes its own reaction, so its `version`, taken from
 * the sender's clock (nextVersion), orders every change to it without
 * comparing clocks across devices: the highest version wins, in any order and
 * however often it arrives. Tabs from before versions send none.
 */
export type Reaction = {
  messageId: string;
  emoji: ReactionEmoji;
  senderId: string;
  nickname: string;
  on: boolean;
  version?: number;
};

/** A reaction's latest state. A removal is kept, so an older "on" arriving late can't bring it back. */
export type ReactionHead = { nickname: string; on: boolean; version: number };

/** Message id → emoji → sender id → latest state. Maps, so ids from peers can't touch an object prototype. */
export type Reactions = Map<string, Map<ReactionEmoji, Map<string, ReactionHead>>>;

/** A peer can make up sender ids, so one emoji on one message counts at most this many. */
export const MAX_REACTORS = 50;

/**
 * How far ahead of our clock a version may be. A peer could otherwise send a
 * huge version for someone else's reaction and pin it forever. Generous, since
 * a phone's clock can be a little off.
 */
export const MAX_VERSION_AHEAD_MS = 15 * 60_000;

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function isReactionEmoji(value: unknown): value is ReactionEmoji {
  return REACTION_EMOJI.some((emoji) => emoji === value);
}

/** Whether a version is a positive integer no further ahead of `now` than allowed. */
export function isReactionVersion(value: unknown, now: number): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= now + MAX_VERSION_AHEAD_MS;
}

/** Validates a reaction payload from a peer, `now` being our clock. */
export function isReaction(value: unknown, now: number): value is Reaction {
  if (!value || typeof value !== "object") return false;
  const reaction = value as Partial<Record<keyof Reaction, unknown>>;
  return (
    isBoundedString(reaction.messageId, 64) &&
    isReactionEmoji(reaction.emoji) &&
    isBoundedString(reaction.senderId, 64) &&
    isBoundedString(reaction.nickname, MAX_NICKNAME_LENGTH) &&
    typeof reaction.on === "boolean" &&
    (reaction.version === undefined || isReactionVersion(reaction.version, now))
  );
}

/** Copies only the known fields, dropping anything extra a peer attached. */
export function toReaction(reaction: Reaction): Reaction {
  const { messageId, emoji, senderId, nickname, on, version } = reaction;
  return { messageId, emoji, senderId, nickname, on, ...(version === undefined ? {} : { version }) };
}

/**
 * The version for this sender's next change: past every earlier one even if
 * the clock went back, unless the last one is so far ahead that peers would
 * reject anything after it.
 */
export function nextVersion(last: number, now: number) {
  return last > now + MAX_VERSION_AHEAD_MS ? now : Math.max(last + 1, now);
}

/**
 * Whether `incoming` replaces `current` for the same reaction. The higher
 * version wins. Equal versions only come from the same change arriving twice,
 * or from tabs without versions, which keep their last-arrival rule; anything
 * else breaks the tie the same way everywhere.
 */
export function replacesHead(current: ReactionHead | undefined, incoming: ReactionHead) {
  if (!current) return true;
  if (incoming.version !== current.version) return incoming.version > current.version;
  if (incoming.version === 0) return true;
  if (incoming.on !== current.on) return !incoming.on;
  return incoming.nickname < current.nickname;
}

/**
 * Applies one player's change if it is newer than what we have. Reactions
 * are kept for at most MAX_MESSAGES messages, dropping the ones first
 * reacted to, like the chat keeps only its latest messages.
 */
export function applyReaction(reactions: Reactions, reaction: Reaction): Reactions {
  const { messageId, emoji, senderId, nickname, on } = reaction;
  const head: ReactionHead = { nickname, on, version: reaction.version ?? 0 };
  const senders = reactions.get(messageId)?.get(emoji);
  const current = senders?.get(senderId);
  if (current && current.on === on && current.nickname === nickname && current.version === head.version) return reactions;
  if (!replacesHead(current, head)) return reactions;
  // Removals count too: they hold their place, so a full emoji stays full.
  if (!current && (senders?.size ?? 0) >= MAX_REACTORS) return reactions;
  // Nothing to remove, and nothing a late "on" could be newer than.
  if (!current && !on && head.version === 0) return reactions;

  const nextSenders = new Map(senders);
  nextSenders.set(senderId, head);
  const nextEmoji = new Map(reactions.get(messageId));
  nextEmoji.set(emoji, nextSenders);
  const next = new Map(reactions);
  next.set(messageId, nextEmoji);
  for (const oldest of next.keys()) {
    if (next.size <= MAX_MESSAGES) break;
    next.delete(oldest);
  }
  return next;
}

/** Every reaction we know of with a version, removals included: what is worth storing. */
export function versionedReactions(reactions: Reactions): (Reaction & { version: number })[] {
  const list: (Reaction & { version: number })[] = [];
  for (const [messageId, byEmoji] of reactions) {
    for (const [emoji, senders] of byEmoji) {
      for (const [senderId, { nickname, on, version }] of senders) {
        if (version > 0) list.push({ messageId, emoji, senderId, nickname, on, version });
      }
    }
  }
  return list;
}

/** Whether this client has reacted to a message with an emoji. */
export function hasReacted(reactions: Reactions, messageId: string, emoji: ReactionEmoji, clientId: string) {
  return reactions.get(messageId)?.get(emoji)?.get(clientId)?.on ?? false;
}

export type ReactionChip = { emoji: ReactionEmoji; count: number; names: string[]; mine: boolean };

/** The reactions on one message, in picker order, with who reacted and whether we did. */
export function reactionChips(reactions: Reactions, messageId: string, clientId: string): ReactionChip[] {
  const byEmoji = reactions.get(messageId);
  if (!byEmoji) return [];
  return REACTION_EMOJI.flatMap((emoji) => {
    const reacted = [...(byEmoji.get(emoji) ?? [])].filter(([, head]) => head.on);
    if (reacted.length === 0) return [];
    return [{ emoji, count: reacted.length, names: reacted.map(([, head]) => head.nickname), mine: reacted.some(([id]) => id === clientId) }];
  });
}
