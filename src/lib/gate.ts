import { createHmac, timingSafeEqual } from "crypto";

export const GATE_COOKIE = "heyu_gate";

export function gateToken(password: string) {
  return createHmac("sha256", password).update("heyu-crossword-gate").digest("base64url");
}

export function passwordsMatch(given: string, expected: string) {
  const left = Buffer.from(given);
  const right = Buffer.from(expected);
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function gateCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  };
}
