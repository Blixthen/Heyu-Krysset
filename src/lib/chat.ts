export type ChatMessage = {
  id: string;
  /** Random per-tab id, used to tell our own messages apart from same-named peers. */
  senderId: string;
  nickname: string;
  text: string;
  sentAt: string;
};

export const MAX_NICKNAME_LENGTH = 24;
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
