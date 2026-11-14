import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, safeEqual, tokenFor } from "@/lib/auth";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Access control for a personal app:
 * - local mode (default): the server listens on 127.0.0.1 only; requests whose
 *   Host is not local are refused (DNS-rebinding protection).
 * - LAN mode (phone access): every request needs the password cookie.
 * - state-changing API calls must come from the app's own origin, so another
 *   website open in the browser cannot drive the app or spend tokens.
 */
export function proxy(req: NextRequest) {
  const password = process.env.TUTOR_LAN_PASSWORD;
  const path = req.nextUrl.pathname;
  const host = req.headers.get("host") ?? "";
  const hostname = host.replace(/:\d+$/, "");

  if (!password && !LOCAL_HOSTS.has(hostname)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  if (path.startsWith("/api/") && req.method !== "GET" && req.method !== "HEAD") {
    const origin = req.headers.get("origin");
    if (origin) {
      let originHost = "";
      try {
        originHost = new URL(origin).host;
      } catch {}
      if (originHost !== host) return NextResponse.json({ error: "Запрос с чужого сайта отклонён" }, { status: 403 });
    }
  }

  if (!password) return NextResponse.next();
  if (path === "/login" || path === "/api/login") return NextResponse.next();

  const token = req.cookies.get(AUTH_COOKIE)?.value;
  if (token && safeEqual(token, tokenFor(password))) return NextResponse.next();

  if (path.startsWith("/api/")) return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // Static build assets and the app icon need no check.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
