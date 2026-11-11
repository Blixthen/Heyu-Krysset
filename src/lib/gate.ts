import { createHash, createHmac, timingSafeEqual } from "crypto";

export const GATE_COOKIE = "heyu_gate";

function hmac(password: string, label: string) {
  return createHmac("sha256", password).update(label).digest("base64url");
}

/** Cookie value proving the visitor knew the password. Rotates when the password changes. */
export function gateToken(password: string) {
  return hmac(password, "heyu-crossword-gate");
}

/**
 * Constant-time comparison that does not leak either input's length: both
 * sides are hashed to a fixed size before comparing. Empty strings never match.
 */
export function safeEqual(given: string, expected: string) {
  if (!given || !expected) return false;
  const left = createHash("sha256").update(given).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

export function hasValidGateCookie(cookie: string | undefined, password: string | undefined) {
  if (!password) return false;
  return safeEqual(cookie ?? "", gateToken(password));
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
