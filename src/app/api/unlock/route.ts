import { GATE_COOKIE, gateCookieOptions, gateToken, passwordsMatch } from "@/lib/gate";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const form = await request.formData();
  const password = String(form.get("password") ?? "");
  const expected = process.env.APP_PASSWORD ?? "";
  const login = new URL("/login", request.url);

  if (!expected || !passwordsMatch(password, expected)) {
    login.searchParams.set("error", "1");
    return NextResponse.redirect(login, 303);
  }

  const response = NextResponse.redirect(new URL("/", request.url), 303);
  response.cookies.set(GATE_COOKIE, gateToken(expected), gateCookieOptions());
  return response;
}
