import { createHash, timingSafeEqual } from "node:crypto";

export const AUTH_COOKIE = "tutor_auth";

/** Cookie value derived from the LAN password (the password itself is never stored in the browser). */
export const tokenFor = (password: string) => createHash("sha256").update(`tutor:${password}`).digest("hex");

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
