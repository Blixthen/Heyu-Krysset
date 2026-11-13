import { vi } from "vitest";

type Handler = (message: { payload: unknown }) => void;
type SubscribeCallback = (state: string, error?: Error) => void;
type Sent = { type: string; event: string; payload: unknown };

/** Minimal stand-in for a Supabase RealtimeChannel. */
export class FakeChannel {
  state = "closed";
  removed = false;
  sent: Sent[] = [];
  sendResult: "ok" | "error" | "timed out" = "ok";
  presence: Record<string, unknown> = {};
  private handlers = new Map<string, Handler>();
  private onStatus: SubscribeCallback | null = null;

  constructor(
    readonly topic: string,
    readonly options?: unknown,
  ) {}

  on(type: string, filter: { event: string }, handler: Handler) {
    this.handlers.set(`${type}:${filter.event}`, handler);
    return this;
  }

  subscribe(callback: SubscribeCallback) {
    this.state = "joining";
    this.onStatus = callback;
    return this;
  }

  send = vi.fn(async (message: Sent) => {
    this.sent.push(message);
    return this.sendResult;
  });

  track = vi.fn<(payload: unknown) => Promise<"ok">>(async () => "ok");

  presenceState() {
    return this.presence;
  }

  /** Simulates the server syncing presence: key → tracked payloads. */
  syncPresence(state: Record<string, unknown>) {
    this.presence = state;
    this.handlers.get("presence:sync")?.({ payload: undefined });
  }

  /** Simulates the server reporting a channel status. */
  status(state: string, error?: Error) {
    if (state === "SUBSCRIBED") this.state = "joined";
    this.onStatus?.(state, error);
  }

  /** Simulates a broadcast from a peer. */
  receive(event: string, payload: unknown) {
    this.handlers.get(`broadcast:${event}`)?.({ payload });
  }

  sentEvents(event: string) {
    return this.sent.filter((message) => message.event === event).map((message) => message.payload);
  }
}

export function createFakeSupabase() {
  const channels: FakeChannel[] = [];
  return {
    channels,
    get latest() {
      return channels.at(-1);
    },
    channel(topic: string, options?: unknown) {
      const existing = channels.find((channel) => channel.topic === `realtime:${topic}` && !channel.removed);
      if (existing) return existing;
      const channel = new FakeChannel(`realtime:${topic}`, options);
      channels.push(channel);
      return channel;
    },
    getChannels() {
      return channels.filter((channel) => !channel.removed);
    },
    async removeChannel(channel: FakeChannel) {
      channel.removed = true;
      channel.state = "closed";
      return "ok";
    },
  };
}
