import { NextResponse } from "next/server";
import { AUTH_COOKIE, safeEqual, tokenFor } from "@/lib/auth";

// Brute-force guard: a handful of attempts per minute for the whole server.
const g = globalThis as unknown as { __tutorLogin?: number[] };
const attempts = (g.__tutorLogin ??= []);

export async function POST(req: Request) {
  const password = process.env.TUTOR_LAN_PASSWORD;
  if (!password) return NextResponse.json({ ok: true });

  const now = Date.now();
  while (attempts.length && now - attempts[0] > 60_000) attempts.shift();
  if (attempts.length >= 8) {
    return NextResponse.json({ error: "Слишком много попыток. Подожди минуту." }, { status: 429 });
  }
  attempts.push(now);

  const body = (await req.json().catch(() => ({}))) as { password?: string };
  if (!safeEqual(String(body.password ?? "").trim(), password)) {
    return NextResponse.json({ error: "Неверный пароль" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, tokenFor(password), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}
