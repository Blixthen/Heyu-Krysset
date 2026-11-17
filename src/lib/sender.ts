"use client";

import { nextVersion } from "./reactions";

const ID_KEY = "heyu-sender-id";
const VERSION_KEY = "heyu-reaction-version";

// Fallbacks for browsers where localStorage throws (private mode, blocked storage).
let memoryId: string | null = null;
let memoryVersion = 0;

/**
 * This browser's id on its messages and reactions. It outlives a reload, so
 * a stored reaction can still be taken back and stored messages still show as
 * ours. Tabs in the same browser share it, like they share the nickname.
 */
export function senderId(): string {
  try {
    const stored = localStorage.getItem(ID_KEY);
    if (stored && stored.length <= 64) return stored;
    const id = crypto.randomUUID();
    localStorage.setItem(ID_KEY, id);
    return id;
  } catch {
    memoryId ??= crypto.randomUUID();
    return memoryId;
  }
}

/**
 * The version for this browser's next reaction change. Kept across reloads
 * and shared by its tabs, which all react as the same sender.
 */
export function takeReactionVersion(now: number): number {
  let last = memoryVersion;
  try {
    const stored = Number(localStorage.getItem(VERSION_KEY));
    if (Number.isSafeInteger(stored)) last = Math.max(last, stored);
  } catch {
    // memoryVersion holds it.
  }
  const version = nextVersion(last, now);
  memoryVersion = version;
  try {
    localStorage.setItem(VERSION_KEY, String(version));
  } catch {
    // memoryVersion holds it.
  }
  return version;
}
