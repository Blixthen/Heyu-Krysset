import type { Result } from "./analyze";
import { compareMessages, isChatMessage, MAX_MESSAGES, toChatMessage, type ChatMessage } from "./chat";
import { isReaction, isReactionVersion, MAX_REACTORS, replacesHead, toReaction, type Reaction } from "./reactions";

/**
 * A room's chat, stored so that players who join later or come back after
 * dropping out see what was said. Messages are a set that only grows (each
 * has its own id and never changes) and each reaction keeps only its newest
 * version, so mergeChat gives the same result in any order and however often
 * the same things arrive. Saving again after a failure is therefore always
 * safe, and the store needs no log. Pure and runtime-agnostic.
 */

export type StoredReaction = Reaction & { version: number };
export type StoredChat = { messages: ChatMessage[]; reactions: StoredReaction[] };

export const EMPTY_CHAT: StoredChat = { messages: [], reactions: [] };

/**
 * The most reactions kept, removals included. Far more than friends react
 * with, while keeping the stored chat small enough to parse within the
 * Worker's CPU budget.
 */
export const MAX_STORED_REACTIONS = 500;

/**
 * The largest chat upload: MAX_MESSAGES messages of up to MAX_MESSAGE_LENGTH
 * characters, about 1.6 kB each with multi-byte text, and MAX_STORED_REACTIONS
 * reactions of about 200 bytes. A message of escaped control characters could
 * be larger, but nobody types those; such an upload is refused, not stored.
 */
export const MAX_CHAT_BYTES = 450_000;

/** Where the browser saves and loads a room's chat. */
export function chatUrl(room: string) {
  return `/api/room/${room}/chat`;
}

/** The object key in the bucket. */
export function chatKey(room: string) {
  return `chat/${room}.json`;
}

const NOT_CHAT = { message: "Chatten kunde inte sparas.", status: 400 };

function isStoredReaction(value: unknown, now: number): value is StoredReaction {
  return isReaction(value, now) && isReactionVersion(value.version, now);
}

function toStoredReaction(reaction: StoredReaction): StoredReaction {
  return { ...toReaction(reaction), version: reaction.version };
}

function isChatShape(value: unknown): value is { messages: unknown[]; reactions: unknown[] } {
  if (!value || typeof value !== "object") return false;
  const { messages, reactions } = value as { messages?: unknown; reactions?: unknown };
  return Array.isArray(messages) && Array.isArray(reactions);
}

/** The valid messages and reactions, copied; the rest is dropped one by one, so one bad item never costs the others. */
function validItems(messages: unknown[], reactions: unknown[], now: number): StoredChat {
  return {
    messages: messages.filter(isChatMessage).map(toChatMessage),
    reactions: reactions.filter((reaction) => isStoredReaction(reaction, now)).map(toStoredReaction),
  };
}

/**
 * Checks a chat to store: no more messages and reactions than a stored chat
 * holds, keeping the valid ones. A reaction can be valid to its sender and
 * not to us (their clock is ahead of ours, MAX_VERSION_AHEAD_MS), so a bad
 * one is left out rather than failing the messages sent with it.
 */
export function checkChatUpload(value: unknown, now: number): Result<StoredChat> {
  if (!isChatShape(value) || value.messages.length > MAX_MESSAGES || value.reactions.length > MAX_STORED_REACTIONS) {
    return { ok: false, error: NOT_CHAT };
  }
  return { ok: true, value: validItems(value.messages, value.reactions, now) };
}

/**
 * A stored chat read back, keeping whatever of it is still valid, so a rule
 * tightened since it was stored, or a clock behind its writer's, loses only
 * the items it rules out. Nothing is kept of anything that isn't a chat.
 */
export function readStoredChat(value: unknown, now: number): StoredChat {
  if (!isChatShape(value)) return EMPTY_CHAT;
  // Sliced before checking, so a long list costs no more than a full chat.
  return validItems(value.messages.slice(-MAX_MESSAGES), value.reactions.slice(-MAX_STORED_REACTIONS), now);
}

function sameMessage(a: ChatMessage, b: ChatMessage) {
  return a.senderId === b.senderId && a.nickname === b.nickname && a.text === b.text && a.sentAt === b.sentAt;
}

function reactionKey({ messageId, emoji, senderId }: Reaction) {
  return JSON.stringify([messageId, emoji, senderId]);
}

/**
 * Both chats together: every message once, oldest first, the newest
 * MAX_MESSAGES of them; each reaction at its newest version, only on those
 * messages, at most MAX_REACTORS per emoji and MAX_STORED_REACTIONS in all,
 * keeping the newest.
 */
export function mergeChat(a: StoredChat, b: StoredChat): StoredChat {
  return merge(a, b, true);
}

/**
 * Two uploads together, waiting to go out as one. Unlike mergeChat it keeps
 * reactions to messages it doesn't hold, since the store may hold them.
 */
export function combineUploads(a: StoredChat, b: StoredChat): StoredChat {
  return merge(a, b, false);
}

function merge(a: StoredChat, b: StoredChat, onlyOnKeptMessages: boolean): StoredChat {
  const byId = new Map<string, ChatMessage>();
  for (const message of [...a.messages, ...b.messages]) {
    const kept = byId.get(message.id);
    if (!kept) byId.set(message.id, message);
    // Ids are random, so two different messages under one id are a peer's doing; still pick one the same way everywhere.
    else if (!sameMessage(kept, message) && JSON.stringify(message) < JSON.stringify(kept)) byId.set(message.id, message);
  }
  const messages = [...byId.values()].sort(compareMessages).slice(-MAX_MESSAGES);
  const kept = new Set(messages.map((message) => message.id));

  const heads = new Map<string, StoredReaction>();
  for (const reaction of [...a.reactions, ...b.reactions]) {
    if (onlyOnKeptMessages && !kept.has(reaction.messageId)) continue;
    const key = reactionKey(reaction);
    if (replacesHead(heads.get(key), reaction)) heads.set(key, reaction);
  }
  const newestFirst = [...heads.values()].sort((x, y) => y.version - x.version || (reactionKey(x) < reactionKey(y) ? -1 : 1));
  const perEmoji = new Map<string, number>();
  const reactions: StoredReaction[] = [];
  for (const reaction of newestFirst) {
    if (reactions.length >= MAX_STORED_REACTIONS) break;
    const emojiKey = JSON.stringify([reaction.messageId, reaction.emoji]);
    const count = perEmoji.get(emojiKey) ?? 0;
    if (count >= MAX_REACTORS) continue;
    perEmoji.set(emojiKey, count + 1);
    reactions.push(reaction);
  }
  reactions.reverse();
  return { messages, reactions };
}

/**
 * What we have that the stored chat lacks: messages it doesn't hold and
 * reactions it has an older version of, or none. Sent back after loading, so
 * a save that failed, or a message only we and a peer who left saw, still
 * reaches the store.
 */
export function missingFrom(stored: StoredChat, ours: StoredChat): StoredChat {
  const storedIds = new Set(stored.messages.map((message) => message.id));
  const storedHeads = new Map(stored.reactions.map((reaction) => [reactionKey(reaction), reaction]));
  // A full store has dropped its oldest messages; ours from before then would be dropped again.
  const oldest = stored.messages.length >= MAX_MESSAGES ? stored.messages[0] : undefined;
  return {
    messages: ours.messages.filter((message) => !storedIds.has(message.id) && (!oldest || compareMessages(message, oldest) > 0)),
    reactions: ours.reactions.filter((reaction) => {
      const head = storedHeads.get(reactionKey(reaction));
      return !head || replacesHead(head, reaction);
    }),
  };
}

export function isEmptyChat(chat: StoredChat) {
  return chat.messages.length === 0 && chat.reactions.length === 0;
}
