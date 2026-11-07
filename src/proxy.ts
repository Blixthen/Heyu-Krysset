import { GATE_COOKIE, gateToken, passwordsMatch } from "@/lib/gate";
import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const password = process.env.APP_PASSWORD ?? "";
  const expected = password ? gateToken(password) : "";
  const allowed = Boolean(expected) && passwordsMatch(request.cookies.get(GATE_COOKIE)?.value ?? "", expected);

  if (pathname === "/login" || pathname === "/api/unlock") {
    if (pathname === "/login" && allowed) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  if (allowed) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Lösenord krävs." }, { status: 401 });
  }

  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
