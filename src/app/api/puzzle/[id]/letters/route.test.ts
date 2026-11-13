import { MAX_LETTERS_BYTES, lettersKey } from "@/lib/storedLetters";
import { puzzleKey } from "@/lib/storedPuzzle";
import { createFakeBucket } from "@/test/fakeBucket";
import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ PHOTOS: undefined as unknown }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: async () => ({ env }) }));

const { GET, PUT } = await import("./route");

const ID = "3f2c1a9e-8b4d-4c6e-9a1b-2d3e4f5a6b7c";
const OTHER = "9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const saved = { letters: { "0-0": "K", "0-1": "R" }, authors: { "0-0": "Nova" } };

function save(id: string, body: BodyInit) {
  return PUT(new Request(`https://kryss.test/api/puzzle/${id}/letters`, { method: "PUT", body }), { params: Promise.resolve({ id }) });
}

function load(id: string) {
  return GET(new Request(`https://kryss.test/api/puzzle/${id}/letters`), { params: Promise.resolve({ id }) });
}

let bucket: ReturnType<typeof createFakeBucket>;

beforeEach(() => {
  bucket = createFakeBucket();
  bucket.seed(puzzleKey(ID), new TextEncoder().encode("{}"));
  env.PHOTOS = bucket;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("PUT /api/puzzle/[id]/letters", () => {
  it("saves the letters apart from the puzzle, and they load back", async () => {
    expect((await save(ID, JSON.stringify({ ...saved, extra: true }))).status).toBe(204);
    expect(bucket.objects.get(lettersKey(ID))?.contentType).toBe("application/json");

    const loaded = await load(ID);
    expect(loaded.status).toBe(200);
    expect(await loaded.json()).toEqual(saved);
  });

  it("lets the latest save win, so a cleared square stays cleared", async () => {
    await save(ID, JSON.stringify(saved));
    expect((await save(ID, JSON.stringify({ letters: { "0-1": "R", "0-0": "" }, authors: {} }))).status).toBe(204);
    expect(await (await load(ID)).json()).toEqual({ letters: { "0-1": "R" }, authors: {} });
  });

  it("saves nothing for a puzzle that isn't stored", async () => {
    const response = await save(OTHER, JSON.stringify(saved));
    expect(response.status).toBe(404);
    expect(bucket.objects.has(lettersKey(OTHER))).toBe(false);
  });

  it("never touches the bucket for an id that isn't random", async () => {
    expect((await save("../x", JSON.stringify(saved))).status).toBe(404);
    expect(bucket.head).not.toHaveBeenCalled();
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid letters", JSON.stringify({ letters: { "0-0": "KR" }, authors: {} }), 400],
    ["something that isn't JSON", "{", 400],
    ["too much", "x".repeat(MAX_LETTERS_BYTES + 1), 413],
  ])("refuses %s", async (_name, body, status) => {
    const response = await save(ID, body);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: "Bokstäverna kunde inte sparas." });
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it("fails with a generic message when storing fails or the bucket is missing", async () => {
    bucket.put.mockRejectedValueOnce(new Error("R2 internal detail"));
    const failed = await save(ID, JSON.stringify(saved));
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ error: "Bokstäverna kunde inte sparas." });

    env.PHOTOS = undefined;
    expect((await save(ID, JSON.stringify(saved))).status).toBe(500);
  });
});

describe("GET /api/puzzle/[id]/letters", () => {
  it("answers 404 when nothing was saved, and for an id that isn't random", async () => {
    expect((await load(ID)).status).toBe(404);
    expect((await load("../x")).status).toBe(404);
    expect(bucket.get).toHaveBeenCalledTimes(1);
  });

  it("treats stored letters that fail the check as missing", async () => {
    bucket.seed(lettersKey(ID), new TextEncoder().encode(JSON.stringify({ letters: { "0-0": "<b>" }, authors: {} })));
    expect((await load(ID)).status).toBe(404);
    bucket.seed(lettersKey(ID), new TextEncoder().encode("not json"));
    expect((await load(ID)).status).toBe(404);
  });
});
