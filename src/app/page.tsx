"use client";

import { isSecretSupabaseKey, isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { Camera, Grid3x3, ImagePlus, Loader2, Send, Sparkles } from "lucide-react";
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";

type ChatMessage = {
  id: string;
  nickname: string;
  text: string;
  sentAt: string;
};

const NICKNAME_KEY = "heyu-crossword-nickname";

type CellPosition = { row: number; col: number };

type LetterCell = {
  row: number;
  col: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

type CrosswordPuzzle = {
  image: string;
  cells: LetterCell[];
};

function cellKey(row: number, col: number) {
  return `${row}-${col}`;
}

function unit(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1000;
}

function isLetterCell(value: unknown): value is LetterCell {
  if (!value || typeof value !== "object") return false;
  const cell = value as { row?: unknown; col?: unknown; x?: unknown; y?: unknown; w?: unknown; h?: unknown };
  return (
    typeof cell.row === "number" &&
    Number.isInteger(cell.row) &&
    cell.row >= 0 &&
    typeof cell.col === "number" &&
    Number.isInteger(cell.col) &&
    cell.col >= 0 &&
    unit(cell.x) &&
    unit(cell.y) &&
    unit(cell.w) &&
    unit(cell.h) &&
    (cell.w as number) >= 4 &&
    (cell.h as number) >= 4
  );
}

function isCrosswordPuzzle(value: unknown): value is CrosswordPuzzle {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { image?: unknown; cells?: unknown };
  return (
    typeof candidate.image === "string" &&
    candidate.image.startsWith("data:image/") &&
    Array.isArray(candidate.cells) &&
    candidate.cells.length >= 8 &&
    candidate.cells.every(isLetterCell)
  );
}

function oneLetter(value: string) {
  const chars = [...value.toLocaleUpperCase("sv-SE")];
  for (let index = chars.length - 1; index >= 0; index -= 1) {
    if (/^\p{L}$/u.test(chars[index])) return chars[index];
  }
  return "";
}

function isCellUpdate(value: unknown): value is { row: number; col: number; value: string } {
  if (!value || typeof value !== "object") return false;
  const update = value as { row?: unknown; col?: unknown; value?: unknown };
  return (
    typeof update.row === "number" &&
    Number.isInteger(update.row) &&
    update.row >= 0 &&
    typeof update.col === "number" &&
    Number.isInteger(update.col) &&
    update.col >= 0 &&
    typeof update.value === "string"
  );
}

function lettersFromPayload(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const letters: Record<string, string> = {};
  for (const [key, letter] of Object.entries(value)) {
    if (typeof letter === "string") letters[key] = oneLetter(letter);
  }
  return letters;
}

function CrosswordGrid({
  puzzle,
  letters,
  selectedCell,
  onSelect,
  onLetter,
}: {
  puzzle: CrosswordPuzzle;
  letters: Record<string, string>;
  selectedCell: CellPosition | null;
  onSelect: (cell: CellPosition) => void;
  onLetter: (cell: CellPosition, letter: string) => void;
}) {
  function focusToward(cell: LetterCell, rowStep: number, colStep: number) {
    const originX = cell.x + cell.w / 2;
    const originY = cell.y + cell.h / 2;
    let best: LetterCell | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const candidate of puzzle.cells) {
      if (candidate.row === cell.row && candidate.col === cell.col) continue;
      const dx = candidate.x + candidate.w / 2 - originX;
      const dy = candidate.y + candidate.h / 2 - originY;
      if (colStep === 1 && dx < cell.w * 0.35) continue;
      if (colStep === -1 && dx > -cell.w * 0.35) continue;
      if (rowStep === 1 && dy < cell.h * 0.35) continue;
      if (rowStep === -1 && dy > -cell.h * 0.35) continue;
      const along = colStep !== 0 ? dx * colStep : dy * rowStep;
      const cross = colStep !== 0 ? Math.abs(dy) : Math.abs(dx);
      const score = along + cross * 3;
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    if (!best) return;
    onSelect({ row: best.row, col: best.col });
    document.getElementById(`cell-${best.row}-${best.col}`)?.focus();
  }

  return (
    <div className="h-full max-h-full w-full touch-pan-x touch-pan-y overflow-auto overscroll-contain [-webkit-overflow-scrolling:touch]">
      <div className="relative mx-auto w-[max(100%,920px)]">
        <img src={puzzle.image} alt="Korsordet" className="block h-auto w-full select-none" />
        {puzzle.cells.map((cell) => {
          const key = cellKey(cell.row, cell.col);
          const selected = selectedCell?.row === cell.row && selectedCell?.col === cell.col;
          const letter = letters[key] ?? "";
          return (
            <input
              key={key}
              id={`cell-${cell.row}-${cell.col}`}
              aria-label={`Rad ${cell.row + 1}, ruta ${cell.col + 1}`}
              value={letter}
              maxLength={1}
              inputMode="text"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="characters"
              spellCheck={false}
              onFocus={(event) => {
                onSelect({ row: cell.row, col: cell.col });
                const input = event.currentTarget;
                input.select();
                input.scrollIntoView({ block: "nearest", inline: "nearest" });
              }}
              onChange={(event) =>
                onLetter({ row: cell.row, col: cell.col }, oneLetter(event.target.value))
              }
              onKeyDown={(event) => {
                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  focusToward(cell, 0, 1);
                } else if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  focusToward(cell, 0, -1);
                } else if (event.key === "ArrowDown") {
                  event.preventDefault();
                  focusToward(cell, 1, 0);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  focusToward(cell, -1, 0);
                }
              }}
              style={{
                left: `${cell.x / 10}%`,
                top: `${cell.y / 10}%`,
                width: `${cell.w / 10}%`,
                height: `${cell.h / 10}%`,
              }}
              className={`absolute touch-manipulation scroll-mt-3 scroll-mb-[30vh] border border-transparent bg-white/15 text-center text-base font-bold text-slate-950 uppercase outline-none ${
                letter ? "bg-white/80" : ""
              } ${selected ? "ring-2 ring-sky-500 ring-inset" : ""}`}
            />
          );
        })}
      </div>
    </div>
  );
}

function formatTime(iso: string) {
  return new Intl.DateTimeFormat("sv-SE", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export default function Home() {
  const [nickname, setNickname] = useState("");
  const [draftName, setDraftName] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<
    "idle" | "connecting" | "live" | "error" | "unconfigured"
  >("idle");
  const [sendError, setSendError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [isMounted, setIsMounted] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState("");
  const [crossword, setCrossword] = useState<CrosswordPuzzle | null>(null);
  const [letters, setLetters] = useState<Record<string, string>>({});
  const [selectedCell, setSelectedCell] = useState<CellPosition | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const crosswordRef = useRef<CrosswordPuzzle | null>(null);
  const lettersRef = useRef<Record<string, string>>({});
  const liveRef = useRef(false);
  const focusGridRef = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  crosswordRef.current = crossword;
  lettersRef.current = letters;

  useEffect(() => {
    const saved = localStorage.getItem(NICKNAME_KEY);
    if (saved) setNickname(saved);
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!nickname) return;

    const client = supabase;
    if (isSecretSupabaseKey) {
      setStatus("error");
      setConnectionError(
        "Nyckeln i appen är en hemlig Supabase-nyckel. Byt till publishable-nyckeln, den som börjar med sb_publishable_.",
      );
      return;
    }
    if (!client || !isSupabaseConfigured) {
      setStatus("unconfigured");
      return;
    }

    setStatus("connecting");
    setConnectionError("");
    let cancelled = false;
    let attempt = 0;
    let retryTimer = 0;
    let activeChannel: RealtimeChannel | null = null;

    const sharePuzzle = () => {
      const puzzle = crosswordRef.current;
      const channel = channelRef.current;
      if (!puzzle || !channel || !liveRef.current) return;
      void channel.send({
        type: "broadcast",
        event: "puzzle",
        payload: { ...puzzle, letters: lettersRef.current },
      });
    };

    const connect = async () => {
      if (cancelled) return;
      const stale = client
        .getChannels()
        .filter((channel) => channel.topic === "realtime:crossword");
      if (stale.length > 0) {
        await Promise.race([
          Promise.all(stale.map((channel) => client.removeChannel(channel))),
          new Promise((resolve) => window.setTimeout(resolve, 1500)),
        ]);
      }
      if (cancelled) return;

      const channel = client.channel("crossword", {
        config: { broadcast: { self: false }, private: false },
      });
      if (channel.state !== "closed") {
        await client.removeChannel(channel);
        if (cancelled) return;
        window.clearTimeout(retryTimer);
        retryTimer = window.setTimeout(() => void connect(), 400);
        return;
      }

      activeChannel = channel;
      channelRef.current = channel;

      channel
        .on("broadcast", { event: "message" }, ({ payload }) => {
          const message = payload as ChatMessage;
          if (!message?.id || !message.text) return;
          setMessages((current) =>
            current.some((item) => item.id === message.id)
              ? current
              : [...current, message],
          );
        })
        .on("broadcast", { event: "puzzle" }, ({ payload }) => {
          if (!isCrosswordPuzzle(payload)) return;
          const letters = lettersFromPayload(
            (payload as { letters?: unknown }).letters,
          );
          setCrossword({ image: payload.image, cells: payload.cells });
          if (letters) setLetters(letters);
        })
        .on("broadcast", { event: "cell-update" }, ({ payload }) => {
          if (!isCellUpdate(payload)) return;
          const letter = oneLetter(payload.value);
          setLetters((current) => ({
            ...current,
            [cellKey(payload.row, payload.col)]: letter,
          }));
        })
        .on("presence", { event: "join" }, () => {
          sharePuzzle();
        })
        .subscribe((status, error) => {
          console.log("Supabase connection status:", status, error);
          if (cancelled) return;
          if (status === "SUBSCRIBED") {
            attempt = 0;
            liveRef.current = true;
            setConnectionError("");
            setStatus("live");
            void channel.track({ nickname });
            sharePuzzle();
            return;
          }
          if (status !== "CHANNEL_ERROR" && status !== "TIMED_OUT") return;

          liveRef.current = false;
          const message = error instanceof Error ? error.message : "Kanalen svarade inte.";
          setConnectionError(message);
          if (attempt >= 4) {
            setStatus("error");
            return;
          }
          attempt += 1;
          setStatus("connecting");
          window.clearTimeout(retryTimer);
          retryTimer = window.setTimeout(() => {
            void connect();
          }, Math.min(1000 * 2 ** attempt, 8000));
        });
    };

    void connect();

    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
      liveRef.current = false;
      channelRef.current = null;
      if (activeChannel) void client.removeChannel(activeChannel);
    };
  }, [nickname]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (!crossword || !focusGridRef.current) return;
    focusGridRef.current = false;
    const first = crossword.cells[0];
    if (!first) return;
    setSelectedCell({ row: first.row, col: first.col });
    const id = `cell-${first.row}-${first.col}`;
    const frame = requestAnimationFrame(() => document.getElementById(id)?.focus());
    return () => cancelAnimationFrame(frame);
  }, [crossword]);

  function join(event: FormEvent) {
    event.preventDefault();
    const next = draftName.trim().slice(0, 24);
    if (!next) return;
    localStorage.setItem(NICKNAME_KEY, next);
    setNickname(next);
  }

  function leave() {
    localStorage.removeItem(NICKNAME_KEY);
    setNickname("");
    setDraftName("");
    setMessages([]);
    setStatus("idle");
    setSendError("");
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    const channel = channelRef.current;
    if (!text || !nickname) return;

    const message: ChatMessage = {
      id: crypto.randomUUID(),
      nickname,
      text,
      sentAt: new Date().toISOString(),
    };

    setMessages((current) => [...current, message]);
    setDraft("");
    setSendError("");

    if (!channel || status !== "live") {
      setSendError(
        isSupabaseConfigured
          ? "Inte ansluten till kanalen ännu."
          : "Fyll i Supabase-nycklarna i .env.local för att skicka till de andra.",
      );
      return;
    }

    const result = await channel.send({
      type: "broadcast",
      event: "message",
      payload: message,
    });

    if (result !== "ok") {
      setSendError("Meddelandet kunde inte skickas. Försök igen.");
    }
  }

  async function prepareImage(file: File) {
    const bitmap = await createImageBitmap(file);
    const maxWidth = 1400;
    const scale = Math.min(1, maxWidth / bitmap.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Kunde inte läsa bilden.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
    const comma = dataUrl.indexOf(",");
    return { dataUrl, base64: dataUrl.slice(comma + 1), mimeType: "image/jpeg" };
  }

  async function onImageSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setIsAnalyzing(true);
    setAnalyzeError("");

    try {
      const image = await prepareImage(file);
      const response = await fetch("/api/analyze-crossword", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: image.base64,
          mimeType: image.mimeType,
        }),
        signal: AbortSignal.timeout(70_000),
      });
      const data: unknown = await response.json();
      console.log(data);
      if (
        response.ok &&
        data &&
        typeof data === "object" &&
        Array.isArray((data as { cells?: unknown }).cells) &&
        (data as { cells: unknown[] }).cells.every(isLetterCell)
      ) {
        const puzzle = { image: image.dataUrl, cells: (data as { cells: LetterCell[] }).cells };
        focusGridRef.current = true;
        lettersRef.current = {};
        crosswordRef.current = puzzle;
        setCrossword(puzzle);
        setLetters({});
        setSelectedCell(null);
        if (channelRef.current && liveRef.current) {
          void channelRef.current.send({
            type: "broadcast",
            event: "puzzle",
            payload: { ...puzzle, letters: {} },
          });
        }
        return;
      }
      const message =
        data && typeof data === "object" && "error" in data && typeof data.error === "string"
          ? data.error
          : "Kunde inte tolka bilden.";
      setAnalyzeError(message);
    } catch (error) {
      console.error(error);
      const timedOut =
        (error instanceof DOMException && error.name === "TimeoutError") ||
        (error instanceof Error && error.name === "AbortError");
      setAnalyzeError(
        timedOut ? "Tolkningen tog för lång tid. Försök igen." : "Kunde inte skicka bilden.",
      );
    } finally {
      setIsAnalyzing(false);
    }
  }

  if (!isMounted) {
    return <main className="min-h-full flex-1 bg-slate-950" />;
  }

  if (!nickname) {
    return (
      <main className="relative flex min-h-dvh flex-1 items-center justify-center overflow-y-auto px-4 py-8">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.16),_transparent_42%),radial-gradient(circle_at_bottom_right,_rgba(168,85,247,0.14),_transparent_36%)]" />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.08)_1px,transparent_1px)] bg-[size:28px_28px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />

        <section className="relative w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900/80 p-8 shadow-2xl shadow-black/40 backdrop-blur">
          <div className="mb-8 flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-sky-400/15 text-sky-300">
              <Grid3x3 className="size-5" />
            </span>
            <div>
              <p className="text-xs font-medium text-sky-300">
                Heyus Fredagskryss
              </p>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-50">
                Välj ditt smeknamn
              </h1>
            </div>
          </div>

          <p className="mb-6 text-sm leading-6 text-slate-400">
            Sätt ett namn så hoppar du in i lobbyn. Korsordet kommer här, och
            chatten går live till alla som är inne samtidigt.
          </p>

          <form onSubmit={join} className="space-y-4">
            <label className="block">
              <span className="mb-2 block text-sm text-slate-300">Smeknamn</span>
              <input
                autoFocus
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                maxLength={24}
                placeholder="Till exempel Nova"
                className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-base text-slate-100 outline-none ring-sky-400/40 placeholder:text-slate-600 focus:border-sky-400 focus:ring-4"
              />
            </label>
            <button
              type="submit"
              disabled={!draftName.trim()}
              className="flex min-h-12 w-full touch-manipulation items-center justify-center gap-2 rounded-2xl bg-sky-400 px-4 py-3 text-base font-medium text-slate-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            >
              <Sparkles className="size-4" />
              Gå in i lobbyn
            </button>
          </form>
        </section>
      </main>
    );
  }

  const statusLabel =
    status === "live"
      ? "Live"
      : status === "connecting"
        ? "Ansluter"
        : status === "error"
          ? "Ingen kontakt"
          : status === "unconfigured"
            ? "Saknar nycklar"
            : "Väntar";

  return (
    <main className="flex h-dvh max-h-dvh flex-col overflow-hidden pb-[env(safe-area-inset-bottom)]">
      <header className="flex shrink-0 items-center justify-between border-b border-slate-800 px-4 py-3 sm:px-5">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-2xl bg-sky-400/15 text-sky-300">
            <Grid3x3 className="size-5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-50">Heyus Fredagskryss</p>
            <p className="text-xs text-slate-400">Inloggad som {nickname}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={leave}
          className="min-h-11 rounded-full border border-slate-700 px-3 py-1.5 text-sm font-bold text-slate-300 transition hover:border-slate-500 hover:text-white"
        >
          Byt namn
        </button>
      </header>

      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(9.5rem,36dvh)] lg:grid-cols-[minmax(0,1fr)_380px] lg:grid-rows-1">
        <section className="flex min-h-0 items-stretch justify-center overflow-hidden p-2 sm:p-4">
          {crossword ? (
            <CrosswordGrid
              puzzle={crossword}
              letters={letters}
              selectedCell={selectedCell}
              onSelect={setSelectedCell}
              onLetter={(cell, letter) => {
                const key = cellKey(cell.row, cell.col);
                setLetters((current) => ({ ...current, [key]: letter }));
                lettersRef.current = { ...lettersRef.current, [key]: letter };
                setSelectedCell(cell);
                if (channelRef.current && liveRef.current) {
                  void channelRef.current.send({
                    type: "broadcast",
                    event: "cell-update",
                    payload: { row: cell.row, col: cell.col, value: letter },
                  });
                }
              }}
            />
          ) : (
            <div className="flex h-full min-h-0 w-full flex-col items-center justify-center overflow-auto rounded-3xl border border-dashed border-slate-700 bg-slate-900/50 px-5 py-8 text-center">
              <span className="mb-5 flex size-16 items-center justify-center rounded-3xl bg-slate-800 text-sky-300">
                <Grid3x3 className="size-8" />
              </span>
              <h2 className="text-2xl font-semibold tracking-tight text-slate-50">
                Här hamnar korsordet
              </h2>
              <p className="mt-3 max-w-md text-sm leading-6 text-slate-400">
                {isAnalyzing
                  ? "Gemini läser av rutnätet. Det tar en liten stund."
                  : "Fota korsordet eller ladda upp en skärmdump. Bilden blir kvar, och ni skriver i rutorna."}
              </p>
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={onImageSelected}
              />
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onImageSelected}
              />
              <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  disabled={isAnalyzing}
                  onClick={() => cameraInputRef.current?.click()}
                  className="inline-flex min-h-12 touch-manipulation items-center gap-2 rounded-2xl bg-sky-400 px-4 py-3 text-base font-medium text-slate-950 transition hover:bg-sky-300 disabled:cursor-wait disabled:bg-slate-700 disabled:text-slate-300"
                >
                  {isAnalyzing ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
                  {isAnalyzing ? "Tolkar…" : "Ta foto"}
                </button>
                <button
                  type="button"
                  disabled={isAnalyzing}
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex min-h-12 touch-manipulation items-center gap-2 rounded-2xl border border-slate-600 px-4 py-3 text-base font-medium text-slate-100 transition hover:border-slate-400 disabled:cursor-wait disabled:text-slate-500"
                >
                  <ImagePlus className="size-4" />
                  Ladda upp bild
                </button>
              </div>
              {analyzeError ? (
                <p className="mt-3 max-w-md text-sm text-rose-300">{analyzeError}</p>
              ) : null}
            </div>
          )}
        </section>

        <aside className="flex min-h-0 flex-col border-t border-slate-800 bg-slate-900/70 lg:border-t-0 lg:border-l">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-50">Livechatt</h2>
              <p className="text-xs text-slate-500">Kanal crossword</p>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-2.5 py-1 text-xs text-slate-300">
              <span
                className={`size-2 rounded-full ${
                  status === "live"
                    ? "bg-emerald-400"
                    : status === "error"
                      ? "bg-rose-400"
                      : "bg-amber-300"
                }`}
              />
              {statusLabel}
            </span>
          </div>
          {connectionError && status !== "live" ? (
            <p className="border-b border-slate-800 px-4 py-2 text-xs text-amber-300">
              {connectionError}
            </p>
          ) : null}

          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.length === 0 ? (
              <p className="rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-6 text-center text-sm leading-6 text-slate-500">
                Inga meddelanden ännu. Skriv något så hör de andra det direkt.
              </p>
            ) : (
              messages.map((message) => {
                const mine = message.nickname === nickname;
                return (
                  <article
                    key={message.id}
                    className={`max-w-[85%] rounded-2xl px-3 py-2 ${
                      mine
                        ? "ml-auto bg-sky-400 text-slate-950"
                        : "bg-slate-800 text-slate-100"
                    }`}
                  >
                    <div className="mb-1 flex items-center justify-between gap-3 text-[11px] opacity-80">
                      <span className="font-medium">{message.nickname}</span>
                      <time dateTime={message.sentAt}>{formatTime(message.sentAt)}</time>
                    </div>
                    <p className="text-sm leading-5 break-words">{message.text}</p>
                  </article>
                );
              })
            )}
          </div>

          <form onSubmit={sendMessage} className="border-t border-slate-800 p-3">
            {sendError ? (
              <p className="mb-2 px-1 text-xs text-amber-300">{sendError}</p>
            ) : null}
            <div className="flex items-center gap-2">
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Skriv något i crew chatten"
                maxLength={500}
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
      </div>
    </main>
  );
}
