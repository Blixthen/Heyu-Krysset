import { GATE_COOKIE, gateToken } from "@/lib/gate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const PASSWORD = "hemligt";

function unlock(password?: string, next?: string) {
  const body = new FormData();
  if (password !== undefined) body.set("password", password);
  if (next !== undefined) body.set("next", next);
  return POST(new Request("https://kryss.test/api/unlock", { method: "POST", body }));
}

describe("POST /api/unlock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("APP_PASSWORD", PASSWORD);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sets the gate cookie and redirects home on the right password", async () => {
    const response = await unlock(PASSWORD);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://kryss.test/");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${GATE_COOKIE}=${gateToken(PASSWORD)}`);
    expect(cookie.toLowerCase()).toContain("httponly");
  });

  it("goes on to the puzzle link the login interrupted, and only to that", async () => {
    const link = "/p/3f2c1a9e-8b4d-4c6e-9a1b-2d3e4f5a6b7c";
    expect((await unlock(PASSWORD, link)).headers.get("location")).toBe(`https://kryss.test${link}`);
    expect((await unlock(PASSWORD, "//evil.example")).headers.get("location")).toBe("https://kryss.test/");
  });

  it("keeps the puzzle link when the password is wrong", async () => {
    const link = "/p/3f2c1a9e-8b4d-4c6e-9a1b-2d3e4f5a6b7c";
    const pending = unlock("wrong", link);
    await vi.runAllTimersAsync();
    const location = new URL((await pending).headers.get("location") ?? "");
    expect([location.pathname, location.searchParams.get("next")]).toEqual(["/login", link]);
  });

  it("delays and redirects back to login on a wrong password", async () => {
    let settled = false;
    const pending = unlock("wrong").then((response) => {
      settled = true;
      return response;
    });

    await vi.advanceTimersByTimeAsync(500);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(500);

    const response = await pending;
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://kryss.test/login?error=1");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("rejects a password that is a prefix of the real one", async () => {
    const pending = unlock(PASSWORD.slice(0, 3));
    await vi.runAllTimersAsync();
    expect((await pending).headers.get("location")).toContain("error=1");
  });

  it("rejects everything when APP_PASSWORD is unset", async () => {
    vi.stubEnv("APP_PASSWORD", "");
    const pending = unlock("");
    await vi.runAllTimersAsync();
    expect((await pending).headers.get("location")).toContain("error=1");
  });

  it("treats a malformed body as a wrong password", async () => {
    const pending = POST(new Request("https://kryss.test/api/unlock", { method: "POST", body: "{" }));
    await vi.runAllTimersAsync();
    expect((await pending).headers.get("location")).toContain("error=1");
  });
});
