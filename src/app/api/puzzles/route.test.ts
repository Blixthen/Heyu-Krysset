import { makePuzzle } from "@/test/fixtures";
import { createFakeBucket } from "@/test/fakeBucket";
import { puzzleKey } from "@/lib/storedPuzzle";
import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ PHOTOS: undefined as unknown }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: async () => ({ env }) }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const { GET } = await import("./route");
const { POST } = await import("../puzzle/route");

const A = "aaaaaaaa-8b4d-4c6e-9a1b-2d3e4f5a6b7c";
const B = "bbbbbbbb-8b4d-4c6e-9a1b-2d3e4f5a6b7c";
const C = "cccccccc-8b4d-4c6e-9a1b-2d3e4f5a6b7c";

function save(puzzle: object) {
  return POST(new Request("https://kryss.test/api/puzzle", { method: "POST", body: JSON.stringify(puzzle) }));
}

let bucket: ReturnType<typeof createFakeBucket>;

beforeEach(() => {
  bucket = createFakeBucket();
  env.PHOTOS = bucket;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/puzzles", () => {
  it("lists the saved puzzles by room, newest first, across pages, without reading them", async () => {
    await save(makePuzzle({ id: A, createdAt: 100 }));
    await save(makePuzzle({ id: B, createdAt: 300 }));
    await save(makePuzzle({ id: C, createdAt: 200, restartOf: A }));
    bucket.seed(`letters/${A}.json`, new Uint8Array());
    bucket.get.mockClear();

    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      puzzles: [
        { id: B, room: B, createdAt: 300, cells: 9 },
        { id: C, room: A, createdAt: 200, cells: 9 },
      ],
    });
    expect(bucket.list).toHaveBeenCalledTimes(2);
    expect(bucket.get).not.toHaveBeenCalled();
  });

  it("keeps the metadata when a puzzle's photo is filled in later", async () => {
    await save(makePuzzle({ id: A, createdAt: 100 }));
    await save(makePuzzle({ id: A, createdAt: 100, photo: B }));
    expect(bucket.objects.get(puzzleKey(A))?.customMetadata).toEqual({ createdAt: "100", cells: "9" });
  });

  it("answers with a generic error when listing fails or the bucket is missing", async () => {
    bucket.list.mockRejectedValueOnce(new Error("R2 down: internal detail"));
    const failed = await GET();
    expect(failed.status).toBe(502);
    expect(JSON.stringify(await failed.json())).not.toContain("internal detail");

    env.PHOTOS = undefined;
    expect((await GET()).status).toBe(500);
  });
});
