"use client";

import type { DisplayMessage, RoomStatus } from "@/hooks/useCrosswordRoom";
import { formatTime, MAX_MESSAGE_LENGTH } from "@/lib/chat";
import { Send } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

const STATUS_LABELS: Record<RoomStatus, string> = {
  live: "Live",
  connecting: "Ansluter",
  error: "Ingen kontakt",
  unconfigured: "Saknar nycklar",
};

const STATUS_DOTS: Record<RoomStatus, string> = {
  live: "bg-emerald-400",
  connecting: "bg-amber-300",
  error: "bg-rose-400",
  unconfigured: "bg-amber-300",
};

export function ChatPanel({
  clientId,
  status,
  connectionError,
  sendError,
  messages,
  onSend,
  onReconnect,
}: {
  clientId: string;
  status: RoomStatus;
  connectionError: string;
  sendError: string;
  messages: DisplayMessage[];
  onSend: (text: string) => void;
  onReconnect: () => void;
}) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    onSend(text);
  }

  return (
    <aside className="flex min-h-0 flex-col border-t border-slate-800 bg-slate-900/70 lg:border-t-0 lg:border-l">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-50">Livechatt</h2>
        <span className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-2.5 py-1 text-xs text-slate-300">
          <span className={`size-2 rounded-full ${STATUS_DOTS[status]}`} />
          {STATUS_LABELS[status]}
        </span>
      </div>
      {connectionError && status !== "live" ? (
        <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-2 text-xs text-amber-300">
          <p>{connectionError}</p>
          {status === "error" ? (
            <button type="button" onClick={onReconnect} className="shrink-0 font-semibold underline">
              Försök igen
            </button>
          ) : null}
        </div>
      ) : null}

      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <p className="rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-6 text-center text-sm leading-6 text-slate-500">
            Inga meddelanden ännu. Skriv något så hör de andra det direkt.
          </p>
        ) : (
          messages.map((message) => {
            const mine = message.senderId === clientId;
            return (
              <article
                key={message.id}
                className={`max-w-[85%] rounded-2xl px-3 py-2 ${
                  mine ? "ml-auto bg-sky-400 text-slate-950" : "bg-slate-800 text-slate-100"
                } ${message.failed ? "opacity-60" : ""}`}
              >
                <div className="mb-1 flex items-center justify-between gap-3 text-[11px] opacity-80">
                  <span className="font-medium">{message.nickname}</span>
                  <time dateTime={message.sentAt}>{formatTime(message.sentAt)}</time>
                </div>
                <p className="text-sm leading-5 break-words">{message.text}</p>
                {message.failed ? <p className="mt-1 text-[11px] font-semibold">Skickades inte</p> : null}
              </article>
            );
          })
        )}
      </div>

      <form onSubmit={submit} className="border-t border-slate-800 p-3">
        {sendError ? <p className="mb-2 px-1 text-xs text-amber-300">{sendError}</p> : null}
        <div className="flex items-center gap-2">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Skriv något i crew chatten"
            maxLength={MAX_MESSAGE_LENGTH}
            aria-label="Meddelande"
            className="min-h-11 min-w-0 flex-1 touch-manipulation rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-base text-slate-100 outline-none ring-sky-400/30 placeholder:text-slate-600 focus:border-sky-400 focus:ring-4"
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            aria-label="Skicka meddelande"
            className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-sky-400 text-slate-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-500"
          >
            <Send className="size-4" />
          </button>
        </div>
      </form>
    </aside>
  );
}
