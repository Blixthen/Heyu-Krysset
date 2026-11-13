import { GATE_COOKIE, gateToken } from "@/lib/gate";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { proxy } from "./proxy";

function request(path: string, cookie?: string) {
  const headers = cookie ? { cookie: `${GATE_COOKIE}=${cookie}` } : undefined;
  return new NextRequest(new URL(path, "https://kryss.test"), { headers });
}

const PASSWORD = "hemligt";

describe("proxy", () => {
  beforeEach(() => {
    vi.stubEnv("APP_PASSWORD", PASSWORD);
  });

  it("redirects locked pages to /login", () => {
    const response = proxy(request("/"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://kryss.test/login");
  });

  it("keeps a puzzle link through the login, but nothing else", () => {
    const id = "3f2c1a9e-8b4d-4c6e-9a1b-2d3e4f5a6b7c";
    expect(proxy(request(`/p/${id}`)).headers.get("location")).toBe(`https://kryss.test/login?next=%2Fp%2F${id}`);
    expect(proxy(request("/p/not-a-puzzle")).headers.get("location")).toBe("https://kryss.test/login");
  });

  it("sends a logged-in visitor on /login to the puzzle link they came for", () => {
    const id = "3f2c1a9e-8b4d-4c6e-9a1b-2d3e4f5a6b7c";
    const cookie = gateToken(PASSWORD);
    expect(proxy(request(`/login?next=/p/${id}`, cookie)).headers.get("location")).toBe(`https://kryss.test/p/${id}`);
    expect(proxy(request("/login?next=//evil.example", cookie)).headers.get("location")).toBe("https://kryss.test/");
  });

  it("answers locked API calls with 401 JSON", async () => {
    for (const path of ["/api/room", "/api/analyze-crossword", "/api/photo", "/api/puzzle", "/api/puzzle/3f2c1a9e-8b4d-4c6e-9a1b-2d3e4f5a6b7c"]) {
      const response = proxy(request(path));
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Lösenord krävs." });
    }
  });

  it("lets unlocked visitors through", () => {
    const response = proxy(request("/api/room", gateToken(PASSWORD)));
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("rejects a cookie from an old password", () => {
    expect(proxy(request("/api/room", gateToken("old"))).status).toBe(401);
  });

  it("always allows the login page and unlock endpoint", () => {
    expect(proxy(request("/login")).headers.get("x-middleware-next")).toBe("1");
    expect(proxy(request("/api/unlock")).headers.get("x-middleware-next")).toBe("1");
  });

  it("sends unlocked visitors away from /login", () => {
    const response = proxy(request("/login", gateToken(PASSWORD)));
    expect(response.headers.get("location")).toBe("https://kryss.test/");
  });

  it("fails closed when APP_PASSWORD is not set", () => {
    vi.stubEnv("APP_PASSWORD", "");
    expect(proxy(request("/api/room", gateToken(""))).status).toBe(401);
  });
});
