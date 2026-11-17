"use client";

import { chatUrl, combineUploads, EMPTY_CHAT, type StoredChat } from "@/lib/storedChat";
import { useCallback, useRef } from "react";

/**
 * How long a save may take before it is given up. A request that hangs on a
 * bad mobile connection would otherwise hold back every later save.
 */
export const CHAT_SAVE_TIMEOUT_MS = 15_000;

/** Never throws: what a failed save held goes out again after the next load (missingFrom). */
async function send(room: string, chat: StoredChat) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), CHAT_SAVE_TIMEOUT_MS);
  try {
    const response = await fetch(chatUrl(room), {
      method: "POST",
      body: JSON.stringify(chat),
      headers: { "content-type": "application/json" },
      signal: controller.signal,
    });
    // A room whose first puzzle was never stored has nowhere to keep its chat.
    if (!response.ok && response.status !== 404) console.warn("chat: saving failed", response.status);
  } catch (error) {
    console.warn("chat: saving failed", error);
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * Saves messages and reactions to a room's stored chat, one request at a
 * time per tab: what arrives meanwhile goes out together in the next one, so
 * a burst of reactions doesn't make the server retry against itself. What
 * waits is kept by room, so a save always reaches the room it was made in.
 */
export function useChatSaving(room: string | null) {
  const pending = useRef(new Map<string, StoredChat>());
  const sending = useRef(false);

  const drain = useCallback(async () => {
    sending.current = true;
    for (let next = pending.current.entries().next(); !next.done; next = pending.current.entries().next()) {
      const [target, chat] = next.value;
      pending.current.delete(target);
      await send(target, chat);
    }
    sending.current = false;
  }, []);

  return useCallback(
    (chat: StoredChat) => {
      if (!room) return;
      pending.current.set(room, combineUploads(pending.current.get(room) ?? EMPTY_CHAT, chat));
      if (!sending.current) void drain();
    },
    [drain, room],
  );
}
