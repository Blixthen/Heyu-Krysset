import { GATE_COOKIE, hasValidGateCookie } from "@/lib/gate";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = new Set(["/login", "/api/unlock"]);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const allowed = hasValidGateCookie(request.cookies.get(GATE_COOKIE)?.value, process.env.APP_PASSWORD);

  if (PUBLIC_PATHS.has(pathname)) {
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
