"use client";

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "heyu-crossword-nickname";
const listeners = new Set<() => void>();

// Fallback for browsers where localStorage throws (private mode, blocked storage).
let memoryValue = "";

function read() {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return memoryValue;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function saveNickname(value: string) {
  memoryValue = value;
  try {
    if (value) localStorage.setItem(STORAGE_KEY, value);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // memoryValue already holds it.
  }
  for (const listener of listeners) listener();
}

/** The saved nickname, "" if none, or null during server render / hydration. */
export function useNickname(): string | null {
  return useSyncExternalStore(subscribe, read, () => null);
}
