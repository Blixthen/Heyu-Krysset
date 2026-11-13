"use client";

import { boardReducer, emptyBoard, photoBelongsTo, restoreAddsToRoom, type BoardAction } from "@/lib/board";
import { appendMessage, isChatMessage, MAX_MESSAGE_LENGTH, toChatMessage, type ChatMessage } from "@/lib/chat";
import {
  authorsFromPayload,
  isCellUpdate,
  isCrosswordPuzzle,
  lettersFromPayload,
  oneLetter,
  toCrosswordPuzzle,
  type CellUpdate,
  type Authors,
  type CrosswordPuzzle,
  type Letters,
} from "@/lib/crossword";
import { isPlayerName, onlineNames, sameNames } from "@/lib/players";
import { applyReaction, hasReacted, isReaction, toReaction, type Reaction, type ReactionEmoji, type Reactions } from "@/lib/reactions";
import type { SavedLetters } from "@/lib/storedLetters";
import { isSecretSupabaseKey, isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { useLetterSaving } from "./useLetterSaving";
import { useCallback, useEffect, useEffectEvent, useReducer, useRef, useState } from "react";

export type RoomStatus = "connecting" | "live" | "error" | "unconfigured";
export type DisplayMessage = ChatMessage & { failed?: boolean };

/**
 * Realtime events on the room channel:
 * - "message":      a ChatMessage
 * - "puzzle":       { puzzle, letters, authors }, the sender's full board
 * - "cell-update":  a CellUpdate for one letter and who typed it
 * - "sync-request": sent by a client that just (re)joined; one peer answers with "puzzle"
 * - "reaction":     a Reaction, one player adding or removing an emoji on a message
 * Presence, keyed by client id, tracks { nickname } for everyone in the room.
 */
const MAX_RETRIES = 4;
const SYNC_JITTER_MS = [50, 400] as const;
/** Presence announcements that fail are retried this often, after this long, before waiting for the next presence sync. */
const MAX_TRACK_RETRIES = 3;
const TRACK_RETRY_MS = 1000;

const SECRET_KEY_ERROR =
  "Nyckeln i appen är en hemlig Supabase-nyckel. Byt till publishable-nyckeln, den som börjar med sb_publishable_.";
const SHARE_ERROR = "Korsordet kunde inte delas med de andra. Försök med en mindre bild.";

class UnauthorizedError extends Error {}

async function fetchRoomTopic() {
  const response = await fetch("/api/room", { cache: "no-store" });
  if (response.status === 401) throw new UnauthorizedError("Lösenord krävs.");
  const data: unknown = await response.json().catch(() => null);
  const topic = (data as { topic?: unknown } | null)?.topic;
  if (!response.ok || typeof topic !== "string") throw new Error("Kunde inte hämta rummet.");
  return topic;
}

async function removeChannels(client: SupabaseClient, channels: RealtimeChannel[]) {
  if (channels.length === 0) return;
  await Promise.race([
    Promise.all(channels.map((channel) => client.removeChannel(channel))),
    new Promise((resolve) => window.setTimeout(resolve, 1500)),
  ]);
}

export function useCrosswordRoom(nickname: string) {
  const [clientId] = useState(() => crypto.randomUUID());
  const [status, setStatus] = useState<"connecting" | "live" | "error">("connecting");
  const [connectionError, setConnectionError] = useState("");
  const [sendError, setSendError] = useState("");
  const [shareError, setShareError] = useState("");
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [reactions, setReactions] = useState<Reactions>(() => new Map());
  const [online, setOnline] = useState<string[]>([]);
  const [board, dispatch] = useReducer(boardReducer, emptyBoard);
  // The board as of the latest action, not the latest render: callbacks that
  // run between an action and its render (a link loading as a peer's update
  // lands, an uploader calling back seconds later) must see it. The reducer
  // is pure, so running it here too gives the same board React will render.
  const boardRef = useRef(emptyBoard);
  const apply = useCallback((action: BoardAction) => {
    boardRef.current = boardReducer(boardRef.current, action);
    dispatch(action);
    return boardRef.current;
  }, []);
  const latestBoard = useCallback(() => boardRef.current, []);
  const saveLettersSoon = useLetterSaving(latestBoard);
  const [generation, setGeneration] = useState(0);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const router = useRouter();
  const readBoard = useEffectEvent(() => board);
  const readNickname = useEffectEvent(() => nickname);
  const goToLogin = useEffectEvent(() => router.replace("/login"));

  const broadcastPuzzle = useCallback(
    async (channel: RealtimeChannel, puzzle: CrosswordPuzzle, letters: Letters, authors: Authors) => {
      const result = await channel.send({
        type: "broadcast",
        event: "puzzle",
        payload: { puzzle, letters, authors },
      });
      setShareError(result === "ok" ? "" : SHARE_ERROR);
    },
    [],
  );

  useEffect(() => {
    const client = supabase;
    if (!client || !isSupabaseConfigured) return;

    let cancelled = false;
    let attempt = 0;
    let retryTimer: number | undefined;
    let syncTimer: number | undefined;
    let trackTimer: number | undefined;
    let current: RealtimeChannel | null = null;
    let topic: string | null = null;

    const retry = (message: string) => {
      channelRef.current = null;
      // Presence from a dropped channel is stale; the next sync fills it again.
      setOnline([]);
      setConnectionError(message);
      if (attempt >= MAX_RETRIES) {
        setStatus("error");
        return;
      }
      attempt += 1;
      setStatus("connecting");
      window.clearTimeout(retryTimer);
      retryTimer = window.setTimeout(() => void connect(), Math.min(1000 * 2 ** attempt, 8000));
    };

    const connect = async () => {
      try {
        topic ??= await fetchRoomTopic();
      } catch (error) {
        if (cancelled) return;
        // The gate cookie expired or the password changed.
        if (error instanceof UnauthorizedError) {
          goToLogin();
          return;
        }
        retry(error instanceof Error ? error.message : "Kunde inte hämta rummet.");
        return;
      }
      if (cancelled) return;

      // supabase.channel() returns an existing channel for the same topic, so
      // clear out our previous attempt (and any leftovers) first.
      const previous = current;
      current = null;
      const realtimeTopic = `realtime:${topic}`;
      await removeChannels(
        client,
        client.getChannels().filter((channel) => channel === previous || channel.topic === realtimeTopic),
      );
      if (cancelled) return;

      const channel = client.channel(topic, {
        config: { broadcast: { self: false }, presence: { key: clientId, enabled: true }, private: false },
      });
      if (channel.state !== "closed") {
        retry("Kanalen var fortfarande upptagen.");
        return;
      }
      current = channel;

      // Tells peers we're here. A failed announcement is retried a few times;
      // after that, a presence sync without us tries again.
      let announcing = false;
      const announce = async (tries = 0) => {
        const nickname = readNickname();
        // Peers drop a nickname that fails validation, so don't announce one.
        if (announcing || !isPlayerName(nickname)) return;
        announcing = true;
        const result = await channel.track({ nickname });
        announcing = false;
        if (result === "ok" || cancelled || current !== channel || tries >= MAX_TRACK_RETRIES) return;
        window.clearTimeout(trackTimer);
        trackTimer = window.setTimeout(() => void announce(tries + 1), TRACK_RETRY_MS);
      };

      channel
        .on("presence", { event: "sync" }, () => {
          const state = channel.presenceState();
          const next = onlineNames(state);
          setOnline((list) => (sameNames(list, next) ? list : next));
          if (channelRef.current === channel && !(clientId in state)) void announce();
        })
        .on("broadcast", { event: "message" }, ({ payload }) => {
          if (!isChatMessage(payload)) return;
          setMessages((list) => appendMessage(list, toChatMessage(payload)));
        })
        .on("broadcast", { event: "reaction" }, ({ payload }) => {
          if (!isReaction(payload)) return;
          const reaction = toReaction(payload);
          setReactions((current) => applyReaction(current, reaction));
        })
        .on("broadcast", { event: "puzzle" }, ({ payload }) => {
          const candidate = (payload as { puzzle?: unknown } | null)?.puzzle;
          if (!isCrosswordPuzzle(candidate)) return;
          const puzzle = toCrosswordPuzzle(candidate);
          // Someone else answered a sync request for our puzzle; no need for us to.
          if (readBoard().puzzle?.id === puzzle.id) window.clearTimeout(syncTimer);
          apply({
            type: "remote-puzzle",
            puzzle,
            letters: lettersFromPayload((payload as { letters?: unknown }).letters, puzzle.cells),
            authors: authorsFromPayload((payload as { authors?: unknown }).authors, puzzle.cells),
          });
        })
        .on("broadcast", { event: "cell-update" }, ({ payload }) => {
          if (!isCellUpdate(payload)) return;
          const { puzzleId, row, col, value, author } = payload;
          apply({ type: "letter", puzzleId, row, col, value, author });
        })
        .on("broadcast", { event: "sync-request" }, () => {
          if (!readBoard().puzzle) return;
          // Random jitter so that usually only one peer answers; the others
          // cancel when they see the answer arrive (see "puzzle" above).
          const [min, max] = SYNC_JITTER_MS;
          window.clearTimeout(syncTimer);
          syncTimer = window.setTimeout(
            () => {
              const { puzzle, letters, authors } = readBoard();
              if (puzzle && channelRef.current === channel) void broadcastPuzzle(channel, puzzle, letters, authors);
            },
            min + Math.random() * (max - min),
          );
        })
        .subscribe((state, error) => {
          if (cancelled || current !== channel) return;
          if (state === "SUBSCRIBED") {
            attempt = 0;
            channelRef.current = channel;
            setConnectionError("");
            setStatus("live");
            // Share what we have (peers keep the newest puzzle and merge letters),
            // then ask for anything newer.
            const { puzzle, letters, authors } = readBoard();
            if (puzzle) void broadcastPuzzle(channel, puzzle, letters, authors);
            void channel.send({ type: "broadcast", event: "sync-request", payload: {} });
            void announce();
            return;
          }
          if (state === "CHANNEL_ERROR" || state === "TIMED_OUT" || state === "CLOSED") {
            retry(error?.message ?? (state === "CLOSED" ? "Anslutningen stängdes." : "Kanalen svarade inte."));
          }
        });
    };

    void connect();

    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
      window.clearTimeout(syncTimer);
      window.clearTimeout(trackTimer);
      channelRef.current = null;
      if (current) void client.removeChannel(current);
    };
  }, [apply, broadcastPuzzle, clientId, generation]);

  const reconnect = useCallback(() => {
    setStatus("connecting");
    setConnectionError("");
    setGeneration((value) => value + 1);
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      const message: ChatMessage = {
        id: crypto.randomUUID(),
        senderId: clientId,
        nickname,
        text: text.slice(0, MAX_MESSAGE_LENGTH),
        sentAt: new Date().toISOString(),
      };
      setMessages((list) => appendMessage(list, message));
      setSendError("");

      const channel = channelRef.current;
      const result = channel
        ? await channel.send({ type: "broadcast", event: "message", payload: message })
        : "error";
      if (result === "ok") return;

      setMessages((list) => list.map((item) => (item.id === message.id ? { ...item, failed: true } : item)));
      setSendError(
        !isSupabaseConfigured
          ? "Supabase är inte konfigurerat, så ingen annan ser meddelandet."
          : channel
            ? "Meddelandet kunde inte skickas. Försök igen."
            : "Inte ansluten till kanalen ännu.",
      );
    },
    [clientId, nickname],
  );

  const react = useCallback(
    async (messageId: string, emoji: ReactionEmoji) => {
      const reaction: Reaction = { messageId, emoji, senderId: clientId, nickname, on: !hasReacted(reactions, messageId, emoji, clientId) };
      setReactions((current) => applyReaction(current, reaction));
      const result = await channelRef.current?.send({ type: "broadcast", event: "reaction", payload: reaction });
      // Nobody else saw it, so take it back rather than show a reaction only we have.
      if (result !== "ok") setReactions((current) => applyReaction(current, { ...reaction, on: !reaction.on }));
    },
    [clientId, nickname, reactions],
  );

  const publishPuzzle = useCallback(
    (puzzle: CrosswordPuzzle) => {
      apply({ type: "load", puzzle });
      setShareError("");
      // If we are offline, the puzzle is shared when the channel subscribes.
      const channel = channelRef.current;
      if (channel) void broadcastPuzzle(channel, puzzle, {}, {});
    },
    [apply, broadcastPuzzle],
  );

  const attachPhoto = useCallback(
    (puzzleId: string, photo: string): CrosswordPuzzle | null => {
      const { puzzle, letters, authors } = boardRef.current;
      // A newer puzzle replaced this one meanwhile, or it has its photo already.
      if (!puzzle || !photoBelongsTo(puzzle, puzzleId) || puzzle.photo !== undefined) return null;
      apply({ type: "photo", puzzleId, photo });
      const updated = { ...puzzle, photo };
      // Peers take the photo from a full board for the same puzzle. If we are
      // offline, it goes out with the board when the channel subscribes.
      const channel = channelRef.current;
      if (channel) void broadcastPuzzle(channel, updated, letters, authors);
      return updated;
    },
    [apply, broadcastPuzzle],
  );

  /**
   * Opens a stored puzzle and its saved letters as if a peer had shared them,
   * so the room's usual rules apply: it joins the same puzzle (merging the
   * letters, ours winning), fills an empty room, and gives way to a newer
   * puzzle the room already has. Shares the board only if that gave the room
   * something new: the puzzle, or letters nobody here had.
   */
  const restorePuzzle = useCallback(
    (puzzle: CrosswordPuzzle, saved: SavedLetters = { letters: {}, authors: {} }) => {
      const before = boardRef.current;
      const next = apply({ type: "remote-puzzle", puzzle, letters: saved.letters, authors: saved.authors });
      const channel = channelRef.current;
      if (channel && next.puzzle && restoreAddsToRoom(before, next, puzzle.id)) void broadcastPuzzle(channel, next.puzzle, next.letters, next.authors);
    },
    [apply, broadcastPuzzle],
  );

  const puzzleId = board.puzzle?.id;
  const setLetter = useCallback(
    (row: number, col: number, value: string) => {
      if (!puzzleId) return;
      // A peer drops an update whose author fails validation, so leave a bad nickname out.
      const author = isPlayerName(nickname) ? nickname : undefined;
      const update: CellUpdate = { puzzleId, row, col, value: oneLetter(value), author };
      apply({ type: "letter", ...update });
      void channelRef.current?.send({ type: "broadcast", event: "cell-update", payload: update });
      saveLettersSoon();
    },
    [apply, puzzleId, nickname, saveLettersSoon],
  );

  const configStatus: RoomStatus | null = isSecretSupabaseKey
    ? "error"
    : isSupabaseConfigured
      ? null
      : "unconfigured";

  return {
    clientId,
    status: configStatus ?? status,
    connectionError: isSecretSupabaseKey ? SECRET_KEY_ERROR : connectionError,
    sendError,
    shareError,
    messages,
    online,
    reactions,
    react,
    board,
    reconnect,
    sendMessage,
    publishPuzzle,
    attachPhoto,
    restorePuzzle,
    setLetter,
  };
}
