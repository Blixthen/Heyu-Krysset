import { MAX_PHOTO_BYTES, photoKey } from "@/lib/photo";
import { createFakeBucket } from "@/test/fakeBucket";
import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ PHOTOS: undefined as unknown }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: async () => ({ env }) }));

const { POST } = await import("./route");
const { GET } = await import("./[id]/route");

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

function upload(body: BodyInit, headers: Record<string, string> = { "content-type": "image/jpeg" }) {
  return POST(new Request("https://kryss.test/api/photo", { method: "POST", body, headers }));
}

function fetchPhoto(id: string) {
  return GET(new Request(`https://kryss.test/api/photo/${id}`), { params: Promise.resolve({ id }) });
}

let bucket: ReturnType<typeof createFakeBucket>;

beforeEach(() => {
  bucket = createFakeBucket();
  env.PHOTOS = bucket;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/photo", () => {
  it("stores a JPEG under a new id and returns it", async () => {
    const response = await upload(JPEG);
    expect(response.status).toBe(200);
    const { id } = (await response.json()) as { id: string };
    expect(bucket.objects.get(photoKey(id))).toMatchObject({ bytes: JPEG, contentType: "image/jpeg" });
  });

  it("rejects something that isn't a JPEG without storing it", async () => {
    const response = await upload("<html>", { "content-type": "image/jpeg" });
    expect(response.status).toBe(415);
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it("rejects a declared size over the limit without reading or storing", async () => {
    const response = await upload(JPEG, { "content-type": "image/jpeg", "content-length": String(MAX_PHOTO_BYTES + 1) });
    expect(response.status).toBe(413);
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it("stops reading an undeclared body once it passes the limit, without storing it", async () => {
    let pulled = 0;
    const chunk = new Uint8Array(1_000_000);
    chunk.set(JPEG);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 50) controller.close();
        else controller.enqueue(chunk.slice());
      },
    });
    const request = new Request("https://kryss.test/api/photo", {
      method: "POST",
      body,
      headers: { "content-type": "image/jpeg" },
      duplex: "half",
    } as RequestInit);
    const response = await POST(request);
    expect(response.status).toBe(413);
    expect(pulled).toBeLessThanOrEqual(Math.ceil(MAX_PHOTO_BYTES / chunk.length) + 2);
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it("fails with a generic message when the bucket is missing or storing fails", async () => {
    env.PHOTOS = undefined;
    expect((await upload(JPEG)).status).toBe(500);
    env.PHOTOS = { ...bucket, put: async () => Promise.reject(new Error("R2 internal detail")) };
    const response = await upload(JPEG);
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain("R2 internal detail");
  });
});

describe("GET /api/photo/[id]", () => {
  it("serves a stored photo as a JPEG the browser may keep privately for a day", async () => {
    const { id } = (await (await upload(JPEG)).json()) as { id: string };
    const response = await fetchPhoto(id);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(JPEG);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("private, max-age=86400");
  });

  it("answers 404 for an unknown photo", async () => {
    expect((await fetchPhoto(crypto.randomUUID())).status).toBe(404);
  });

  it("never looks up an id that isn't a photo id", async () => {
    expect((await fetchPhoto("..%2Fsecret")).status).toBe(404);
    expect(bucket.get).not.toHaveBeenCalled();
  });
});
