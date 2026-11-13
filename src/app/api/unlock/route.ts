import { GATE_COOKIE, gateCookieOptions, gateToken, safeEqual } from "@/lib/gate";
import { safeNextPath } from "@/lib/storedPuzzle";
import { NextResponse } from "next/server";

/**
 * Slows down password guessing. Serverless instances do not share memory, so
 * a real per-IP limiter would need external storage; a fixed delay per failed
 * attempt is a cheap, stateless deterrent.
 */
const FAILED_UNLOCK_DELAY_MS = 750;

export async function POST(request: Request) {
  const expected = process.env.APP_PASSWORD ?? "";
  let password = "";
  let next = "/";
  try {
    const form = await request.formData();
    password = String(form.get("password") ?? "");
    next = safeNextPath(form.get("next"));
  } catch {
    // Treated as a wrong password below.
  }

  if (!safeEqual(password, expected)) {
    await new Promise((resolve) => setTimeout(resolve, FAILED_UNLOCK_DELAY_MS));
    const login = new URL("/login", request.url);
    login.searchParams.set("error", "1");
    if (next !== "/") login.searchParams.set("next", next);
    return NextResponse.redirect(login, 303);
  }

  const response = NextResponse.redirect(new URL(next, request.url), 303);
  response.cookies.set(GATE_COOKIE, gateToken(expected), gateCookieOptions());
  return response;
}
