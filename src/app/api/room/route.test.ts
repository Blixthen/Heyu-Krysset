import { roomTopic } from "@/lib/gate";
import { describe, expect, it, vi } from "vitest";

const connection = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection,
}));

const { GET } = await import("./route");

describe("GET /api/room", () => {
  it("returns the topic derived from the password, uncached", async () => {
    vi.stubEnv("APP_PASSWORD", "hemligt");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ topic: roomTopic("hemligt") });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("opts out of prerendering so the topic is never in build output", async () => {
    vi.stubEnv("APP_PASSWORD", "hemligt");
    await GET();
    expect(connection).toHaveBeenCalled();
  });

  it("fails without a configured password", async () => {
    vi.stubEnv("APP_PASSWORD", "");
    expect((await GET()).status).toBe(500);
  });
});
