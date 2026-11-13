import { MAX_MESSAGES } from "./chat";
import { MAX_NICKNAME_LENGTH } from "./players";

/** The emoji you can react with, in the order the picker and the chips show them. */
export const REACTION_EMOJI = ["👍", "❤️", "😂", "😮", "🎉", "🤔"] as const;
export type ReactionEmoji = (typeof REACTION_EMOJI)[number];

/**
 * One player adding (`on`) or removing a reaction. An explicit on/off rather
 * than a toggle, so a repeated or late event can't flip it the wrong way.
 */
export type Reaction = { messageId: string; emoji: ReactionEmoji; senderId: string; nickname: string; on: boolean };

/** Message id → emoji → sender id → nickname. Maps, so ids from peers can't touch an object prototype. */
export type Reactions = Map<string, Map<ReactionEmoji, Map<string, string>>>;

/** A peer can make up sender ids, so one emoji on one message counts at most this many. */
export const MAX_REACTORS = 50;

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function isReactionEmoji(value: unknown): value is ReactionEmoji {
  return REACTION_EMOJI.some((emoji) => emoji === value);
}

/** Validates a reaction payload from a peer. */
export function isReaction(value: unknown): value is Reaction {
  if (!value || typeof value !== "object") return false;
  const reaction = value as Partial<Record<keyof Reaction, unknown>>;
  return (
    isBoundedString(reaction.messageId, 64) &&
    isReactionEmoji(reaction.emoji) &&
    isBoundedString(reaction.senderId, 64) &&
    isBoundedString(reaction.nickname, MAX_NICKNAME_LENGTH) &&
    typeof reaction.on === "boolean"
  );
}

/** Copies only the known fields, dropping anything extra a peer attached. */
export function toReaction(reaction: Reaction): Reaction {
  const { messageId, emoji, senderId, nickname, on } = reaction;
  return { messageId, emoji, senderId, nickname, on };
}

/**
 * Adds or removes one player's reaction. Reactions are kept for at most
 * MAX_MESSAGES messages, dropping the ones first reacted to, like the chat
 * keeps only its latest messages.
 */
export function applyReaction(reactions: Reactions, reaction: Reaction): Reactions {
  const { messageId, emoji, senderId, nickname, on } = reaction;
  const senders = reactions.get(messageId)?.get(emoji);
  if (on ? senders?.get(senderId) === nickname || (senders?.size ?? 0) >= MAX_REACTORS : !senders?.has(senderId)) {
    return reactions;
  }
  const nextSenders = new Map(senders);
  if (on) nextSenders.set(senderId, nickname);
  else nextSenders.delete(senderId);
  const nextEmoji = new Map(reactions.get(messageId));
  if (nextSenders.size > 0) nextEmoji.set(emoji, nextSenders);
  else nextEmoji.delete(emoji);
  const next = new Map(reactions);
  if (nextEmoji.size > 0) next.set(messageId, nextEmoji);
  else next.delete(messageId);
  for (const oldest of next.keys()) {
    if (next.size <= MAX_MESSAGES) break;
    next.delete(oldest);
  }
  return next;
}

/** Whether this client has reacted to a message with an emoji. */
export function hasReacted(reactions: Reactions, messageId: string, emoji: ReactionEmoji, clientId: string) {
  return reactions.get(messageId)?.get(emoji)?.has(clientId) ?? false;
}

export type ReactionChip = { emoji: ReactionEmoji; count: number; names: string[]; mine: boolean };

/** The reactions on one message, in picker order, with who reacted and whether we did. */
export function reactionChips(reactions: Reactions, messageId: string, clientId: string): ReactionChip[] {
  const byEmoji = reactions.get(messageId);
  if (!byEmoji) return [];
  return REACTION_EMOJI.flatMap((emoji) => {
    const senders = byEmoji.get(emoji);
    if (!senders) return [];
    return [{ emoji, count: senders.size, names: [...senders.values()], mine: senders.has(clientId) }];
  });
}
