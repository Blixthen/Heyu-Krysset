"use client";

import { MAX_NICKNAME_LENGTH } from "@/lib/players";
import { Sparkles } from "lucide-react";
import { useState, type FormEvent } from "react";
import { AuthCard, inputClassName, primaryButtonClassName } from "./AuthCard";

export function NicknameForm({ onJoin }: { onJoin: (nickname: string) => void }) {
  const [draft, setDraft] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    // Trimmed after cutting too, so a cut can't leave a trailing space that peers reject.
    const next = draft.trim().slice(0, MAX_NICKNAME_LENGTH).trim();
    if (next) onJoin(next);
  }

  return (
    <AuthCard
      showGrid
      title="Välj ditt smeknamn"
      description="Sätt ett namn så hoppar du in i lobbyn. Korsordet kommer här, och chatten går live till alla som är inne samtidigt."
    >
      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="mb-2 block text-sm text-slate-300">Smeknamn</span>
          <input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={MAX_NICKNAME_LENGTH}
            placeholder="Till exempel Nova"
            className={inputClassName}
          />
        </label>
        <button type="submit" disabled={!draft.trim()} className={primaryButtonClassName}>
          <Sparkles className="size-4" />
          Gå in i lobbyn
        </button>
      </form>
    </AuthCard>
  );
}
