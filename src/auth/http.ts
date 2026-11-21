import type { Context } from "hono";
import type { AppEnv } from "./middleware.js";
import { isSameOriginRequest } from "./middleware.js";

/** Shared helpers of the `/auth/*` and `/billing/*` handlers. */

export function noStore(c: { header(name: string, value: string): void }): void {
  c.header("Cache-Control", "no-store");
  c.header("Pragma", "no-cache");
}

export async function readJson(c: Context<AppEnv>): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await c.req.json();
    return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function validation(c: Context<AppEnv>, message: string) {
  return c.json({ error: { code: "validation" as const, message } }, 400);
}

/** A 403 response when an unsafe request does not come from the app's own origin; otherwise null. */
export function crossOriginBlock(c: Context<AppEnv>) {
  if (isSameOriginRequest(c)) return null;
  return c.json({ error: { code: "forbidden" as const, message: "Cross-origin request blocked" } }, 403);
}

export function rateLimited(c: Context<AppEnv>, retryAfter: number) {
  c.header("Retry-After", String(retryAfter));
  return c.json(
    { error: { code: "rate_limited" as const, message: "Too many attempts. Try again later." } },
    429,
  );
}

export function notFound(c: Context<AppEnv>) {
  return c.json({ error: { code: "not_found" as const, message: "Not found" } }, 404);
}
