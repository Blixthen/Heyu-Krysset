import { MAX_PUZZLE_BYTES, puzzleKey } from "@/lib/storedPuzzle";
import { createFakeBucket } from "@/test/fakeBucket";
import { makePuzzle } from "@/test/fixtures";
import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ PHOTOS: undefined as unknown }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: async () => ({ env }) }));

const { POST } = await import("./route");
const { GET } = await import("./[id]/route");

const ID = "3f2c1a9e-8b4d-4c6e-9a1b-2d3e4f5a6b7c";
const puzzle = makePuzzle({ id: ID });
const PHOTO = "9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const OTHER_PHOTO = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

function save(body: BodyInit) {
  return POST(new Request("https://kryss.test/api/puzzle", { method: "POST", body, headers: { "content-type": "application/json" } }));
}

function load(id: string) {
  return GET(new Request(`https://kryss.test/api/puzzle/${id}`), { params: Promise.resolve({ id }) });
}

let bucket: ReturnType<typeof createFakeBucket>;

beforeEach(() => {
  bucket = createFakeBucket();
  env.PHOTOS = bucket;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("POST /api/puzzle", () => {
  it("stores a puzzle, and the link loads it back", async () => {
    const response = await save(JSON.stringify({ ...puzzle, evil: true }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: ID });
    expect(bucket.objects.get(puzzleKey(ID))?.contentType).toBe("application/json");

    const loaded = await load(ID);
    expect(loaded.status).toBe(200);
    expect(await loaded.json()).toEqual(puzzle);
  });

  it("never changes a stored puzzle, beyond filling in its photo", async () => {
    await save(JSON.stringify(puzzle));
    expect((await save(JSON.stringify({ ...puzzle, createdAt: 99 }))).status).toBe(409);
    expect((await save(JSON.stringify(puzzle))).status).toBe(200);
    expect(await (await load(ID)).json()).toEqual(puzzle);

    const withPhoto = { ...puzzle, photo: PHOTO };
    expect((await save(JSON.stringify(withPhoto))).status).toBe(200);
    expect(await (await load(ID)).json()).toEqual(withPhoto);
    expect((await save(JSON.stringify({ ...puzzle, photo: OTHER_PHOTO }))).status).toBe(409);
    expect((await save(JSON.stringify(puzzle))).status).toBe(200);
    expect(await (await load(ID)).json()).toEqual(withPhoto);
  });

  it("writes only if nothing is stored, so two first saves can't both win", async () => {
    await save(JSON.stringify(puzzle));
    expect(bucket.put.mock.calls[0][2]).toMatchObject({ onlyIf: { etagDoesNotMatch: "*" } });
  });

  it("adds the photo only if the puzzle didn't change since it was read", async () => {
    await save(JSON.stringify(puzzle));
    // Another save lands between our read and our write.
    const realGet = bucket.get.getMockImplementation()!;
    bucket.get.mockImplementationOnce(async (key: string) => {
      const object = await realGet(key);
      bucket.seed(key, new TextEncoder().encode(JSON.stringify({ ...puzzle, photo: OTHER_PHOTO })));
      return object;
    });
    expect((await save(JSON.stringify({ ...puzzle, photo: PHOTO }))).status).toBe(409);
    expect(((await (await load(ID)).json()) as { photo: string }).photo).toBe(OTHER_PHOTO);
  });

  it.each([
    ["an invalid puzzle", JSON.stringify({ ...puzzle, cells: [] }), 400],
    ["an id that isn't random", JSON.stringify(makePuzzle()), 400],
    ["something that isn't JSON", "{nope", 400],
    ["a body over the limit", " ".repeat(MAX_PUZZLE_BYTES + 1), 413],
  ])("rejects %s without storing it", async (_name, body, status) => {
    expect((await save(body)).status).toBe(status);
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it("fails with a generic message when the bucket is missing", async () => {
    env.PHOTOS = undefined;
    expect((await save(JSON.stringify(puzzle))).status).toBe(500);
  });
});

describe("GET /api/puzzle/[id]", () => {
  it("answers 404 for an unknown puzzle, and never looks up an id that isn't random", async () => {
    expect((await load(crypto.randomUUID())).status).toBe(404);
    expect((await load("puzzle-1")).status).toBe(404);
    expect(bucket.get).toHaveBeenCalledTimes(1);
  });

  it("treats a stored puzzle under another puzzle's link as missing", async () => {
    const other = makePuzzle({ id: crypto.randomUUID() });
    bucket.seed(puzzleKey(ID), new TextEncoder().encode(JSON.stringify(other)));
    expect((await load(ID)).status).toBe(404);
  });

  it("treats a stored object that isn't a valid puzzle as missing", async () => {
    bucket.seed(puzzleKey(ID), new TextEncoder().encode('{"id":"x"}'));
    expect((await load(ID)).status).toBe(404);
  });
});
