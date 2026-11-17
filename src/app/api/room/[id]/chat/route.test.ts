import { chatKey, MAX_CHAT_BYTES } from "@/lib/storedChat";
import { puzzleKey } from "@/lib/storedPuzzle";
import { createFakeBucket } from "@/test/fakeBucket";
import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ PHOTOS: undefined as unknown }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: async () => ({ env }) }));

const { GET, POST } = await import("./route");

const ROOM = "3f2c1a9e-8b4d-4c6e-9a1b-2d3e4f5a6b7c";
const OTHER = "9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const NOW = Date.now();

const message = (id: string, minute: number) => ({
  id,
  senderId: "kim-browser",
  nickname: "Kim",
  text: `text ${id}`,
  sentAt: new Date(NOW + minute * 60_000).toISOString(),
});
const reaction = (version: number, on = true) => ({ messageId: "m1", emoji: "👍", senderId: "ann-browser", nickname: "Ann", on, version });

function save(id: string, body: unknown) {
  const request = new Request(`https://kryss.test/api/room/${id}/chat`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return POST(request, { params: Promise.resolve({ id }) });
}

async function load(id: string) {
  const response = await GET(new Request(`https://kryss.test/api/room/${id}/chat`), { params: Promise.resolve({ id }) });
  return { status: response.status, body: await response.json() };
}

let bucket: ReturnType<typeof createFakeBucket>;

beforeEach(() => {
  bucket = createFakeBucket();
  bucket.seed(puzzleKey(ROOM), new TextEncoder().encode("{}"));
  env.PHOTOS = bucket;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("POST /api/room/[id]/chat", () => {
  it("adds each save to what is stored, so separate saves all load back", async () => {
    expect((await save(ROOM, { messages: [message("m1", 1)], reactions: [] })).status).toBe(204);
    expect((await save(ROOM, { messages: [message("m2", 2)], reactions: [reaction(NOW)] })).status).toBe(204);
    expect((await save(ROOM, { messages: [], reactions: [reaction(NOW - 5, false)] })).status).toBe(204);
    expect(bucket.objects.get(chatKey(ROOM))?.contentType).toBe("application/json");

    expect(await load(ROOM)).toEqual({ status: 200, body: { messages: [message("m1", 1), message("m2", 2)], reactions: [reaction(NOW)] } });
  });

  it("writes nothing when a save adds nothing new", async () => {
    await save(ROOM, { messages: [message("m1", 1)], reactions: [] });
    bucket.put.mockClear();
    expect((await save(ROOM, { messages: [message("m1", 1)], reactions: [] })).status).toBe(204);
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it("reads again and keeps both when another save lands in between", async () => {
    await save(ROOM, { messages: [message("m1", 1)], reactions: [] });
    const realGet = bucket.get.getMockImplementation()!;
    bucket.get.mockImplementationOnce(async (key: string) => {
      const object = await realGet(key);
      // Another save lands after our read, so our conditional write loses.
      bucket.seed(chatKey(ROOM), new TextEncoder().encode(JSON.stringify({ messages: [message("m1", 1), message("m2", 2)], reactions: [] })));
      return object;
    });
    expect((await save(ROOM, { messages: [message("m3", 3)], reactions: [] })).status).toBe(204);
    expect((await load(ROOM)).body.messages.map((m: { id: string }) => m.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("gives up after a bounded number of lost races", async () => {
    await save(ROOM, { messages: [message("m1", 1)], reactions: [] });
    bucket.put.mockClear();
    bucket.put.mockResolvedValue(null);
    expect((await save(ROOM, { messages: [message("m2", 2)], reactions: [] })).status).toBe(409);
    expect(bucket.put).toHaveBeenCalledTimes(4);
  });

  it("keeps the rest of a stored chat when one item in it is no longer valid", async () => {
    const stored = { messages: [message("m1", 1), { ...message("bad", 2), text: "" }], reactions: [reaction(NOW)] };
    bucket.seed(chatKey(ROOM), new TextEncoder().encode(JSON.stringify(stored)));
    expect(await load(ROOM)).toEqual({ status: 200, body: { messages: [message("m1", 1)], reactions: [reaction(NOW)] } });
    expect((await save(ROOM, { messages: [message("m3", 3)], reactions: [] })).status).toBe(204);
    expect((await load(ROOM)).body).toEqual({ messages: [message("m1", 1), message("m3", 3)], reactions: [reaction(NOW)] });
  });

  it("stores the messages sent with a reaction too far ahead of the server's clock, without the reaction", async () => {
    expect((await save(ROOM, { messages: [message("m1", 1)], reactions: [reaction(NOW + 24 * 3_600_000)] })).status).toBe(204);
    expect((await load(ROOM)).body).toEqual({ messages: [message("m1", 1)], reactions: [] });
  });

  it("replaces a stored chat that can't be read at all", async () => {
    bucket.seed(chatKey(ROOM), new TextEncoder().encode("not json"));
    expect((await save(ROOM, { messages: [message("m1", 1)], reactions: [] })).status).toBe(204);
    expect((await load(ROOM)).body.messages).toEqual([message("m1", 1)]);
  });

  it("starts no chat for a room whose puzzle isn't stored", async () => {
    expect((await save(OTHER, { messages: [message("m1", 1)], reactions: [] })).status).toBe(404);
    expect(bucket.objects.has(chatKey(OTHER))).toBe(false);
  });

  it("never touches the bucket for an id that isn't random", async () => {
    expect((await save("../x", { messages: [], reactions: [] })).status).toBe(404);
    expect(bucket.get).not.toHaveBeenCalled();
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it.each([
    ["something that isn't a chat", { messages: "m1", reactions: [] }],
    ["something that isn't JSON", "{"],
  ])("rejects %s and stores nothing", async (_name, body) => {
    expect((await save(ROOM, body)).status).toBe(400);
    expect(bucket.objects.has(chatKey(ROOM))).toBe(false);
  });

  it("rejects an upload over the size limit", async () => {
    expect((await save(ROOM, "x".repeat(MAX_CHAT_BYTES + 1))).status).toBe(413);
  });

  it("fails without the bucket binding", async () => {
    env.PHOTOS = undefined;
    expect((await save(ROOM, { messages: [], reactions: [] })).status).toBe(500);
  });
});

describe("GET /api/room/[id]/chat", () => {
  it("loads an empty chat for a room that has none yet", async () => {
    expect(await load(ROOM)).toEqual({ status: 200, body: { messages: [], reactions: [] } });
  });

  it("loads nothing for an id that isn't random", async () => {
    expect((await load("../x")).status).toBe(404);
    expect(bucket.get).not.toHaveBeenCalled();
  });

  it("reports a failed read without its details", async () => {
    bucket.get.mockRejectedValueOnce(new Error("R2 is down at 10.0.0.1"));
    const { status, body } = await load(ROOM);
    expect(status).toBe(502);
    expect(JSON.stringify(body)).not.toContain("10.0.0.1");
  });
});
