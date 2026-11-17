import { MAX_NICKNAME_LENGTH } from "./players";

export type ChatMessage = {
  id: string;
  /** The sender's browser id (senderId in sender.ts), used to tell our own messages apart from same-named peers. */
  senderId: string;
  nickname: string;
  text: string;
  sentAt: string;
};

export const MAX_MESSAGE_LENGTH = 500;
export const MAX_MESSAGES = 200;

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

/** Validates a chat payload from a peer. Anything else is dropped before render. */
export function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<Record<keyof ChatMessage, unknown>>;
  return (
    isBoundedString(message.id, 64) &&
    isBoundedString(message.senderId, 64) &&
    isBoundedString(message.nickname, MAX_NICKNAME_LENGTH) &&
    isBoundedString(message.text, MAX_MESSAGE_LENGTH) &&
    isBoundedString(message.sentAt, 40) &&
    Number.isFinite(Date.parse(message.sentAt))
  );
}

/** Copies only the known fields, dropping anything extra a peer attached. */
export function toChatMessage(message: ChatMessage): ChatMessage {
  return {
    id: message.id,
    senderId: message.senderId,
    nickname: message.nickname,
    text: message.text,
    sentAt: message.sentAt,
  };
}

const timeFormat = new Intl.DateTimeFormat("sv-SE", { hour: "2-digit", minute: "2-digit" });

/** Formats as HH:MM; never throws, even on an invalid timestamp. */
export function formatTime(iso: string) {
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? timeFormat.format(date) : "";
}

/** Appends a message unless one with the same id exists, keeping the list bounded. */
export function appendMessage<T extends { id: string }>(list: T[], message: T) {
  if (list.some((item) => item.id === message.id)) return list;
  const next = [...list, message];
  return next.length > MAX_MESSAGES ? next.slice(next.length - MAX_MESSAGES) : next;
}

/**
 * Messages from others that arrived after `lastSeenId`, apart from the
 * history loaded on joining, which was said before we came. If that message
 * is no longer in the list (trimmed, or nothing seen yet), every message counts.
 */
export function countUnread(messages: (ChatMessage & { history?: boolean })[], lastSeenId: string | null, clientId: string) {
  const seenAt = lastSeenId === null ? -1 : messages.findIndex((message) => message.id === lastSeenId);
  return messages.slice(seenAt + 1).filter((message) => message.senderId !== clientId && !message.history).length;
}

/** Oldest first by when they were sent; the id settles a tie, so every tab orders them alike. */
export function compareMessages(a: ChatMessage, b: ChatMessage) {
  return Date.parse(a.sentAt) - Date.parse(b.sentAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Adds stored messages we don't have, in the order they were sent, keeping
 * the newest MAX_MESSAGES. Ours win for an id both have, so a message we
 * failed to send stays marked.
 */
export function mergeMessages<T extends ChatMessage>(list: T[], incoming: T[]) {
  const known = new Set(list.map((message) => message.id));
  const added = incoming.filter((message) => !known.has(message.id));
  if (added.length === 0) return list;
  const merged = [...list, ...added].sort(compareMessages);
  return merged.length > MAX_MESSAGES ? merged.slice(merged.length - MAX_MESSAGES) : merged;
}
