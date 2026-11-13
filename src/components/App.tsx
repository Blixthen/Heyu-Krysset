"use client";

import { NicknameForm } from "@/components/NicknameForm";
import { Room } from "@/components/Room";
import { saveNickname, useNickname } from "@/lib/nickname";

/** The whole app: the nickname form, then the room, optionally opening a stored puzzle. */
export function App({ linkedPuzzleId }: { linkedPuzzleId?: string }) {
  const nickname = useNickname();

  // null until hydrated: the nickname lives in localStorage.
  if (nickname === null) return <main className="min-h-full flex-1 bg-slate-950" />;
  if (!nickname) return <NicknameForm onJoin={saveNickname} />;
  // Keyed so that switching nickname starts a fresh connection and chat.
  return <Room key={nickname} nickname={nickname} linkedPuzzleId={linkedPuzzleId} onLeave={() => saveNickname("")} />;
}
