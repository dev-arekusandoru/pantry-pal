import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { Context, MiddlewareHandler } from "hono";
import type { Db } from "../db/client.js";
import { makeCtx, type Ctx } from "../context.js";
import { resolveSession, SESSION_COOKIE_NAME } from "./session.js";
import { verifyToken } from "./tokens.js";

/** Hono environment for authenticated routes: `c.var.ctx` is always set. */
export type AppEnv = { Variables: { ctx: Ctx; authKind: "session" | "token" } };

/** Extract the token from `Authorization: Bearer <token>` (case-insensitive scheme). */
export function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header.trim());
  return match?.[1] ?? null;
}

/** Methods that do not change state and therefore need no CSRF check. */
const SAFE_METHODS: Record<string, true> = { GET: true, HEAD: true, OPTIONS: true };

/** Hostnames for which plain-HTTP origins are accepted during local development. */
const LOOPBACK_HOSTS: Record<string, true> = {
  localhost: true,
  "127.0.0.1": true,
  "[::1]": true,
};

/**
 * Whether an unsafe request provably comes from the app's own origin.
 *
 * An `Origin` header is required (browsers send it for every cross-origin
 * unsafe request and for same-origin fetch POSTs). It must be `https:` — except
 * for loopback development hosts — and its host must equal the request `Host`
 * exactly. `X-Forwarded-Host` is deliberately ignored: it is client-controlled
 * unless a proxy overwrites it, and Cloudflare Tunnel preserves `Host`. The
 * request URL's host is used only when no `Host` header exists (in-process tests).
 */
export function isSameOriginRequest(c: Context): boolean {
  if (c.req.header("sec-fetch-site") === "cross-site") return false;

  const origin = c.req.header("origin");
  if (origin === undefined || origin === "" || origin === "null") return false;

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }
  if (originUrl.protocol !== "https:" && !(
    originUrl.protocol === "http:" && LOOPBACK_HOSTS[originUrl.hostname] === true
  )) {
    return false;
  }

  let requestHost = c.req.header("host")?.trim().toLowerCase() ?? "";
  if (requestHost === "") {
    try {
      requestHost = new URL(c.req.url).host.toLowerCase();
    } catch {
      return false;
    }
  }
  return requestHost !== "" && originUrl.host.toLowerCase() === requestHost;
}

/** Best-effort peer address from the actual socket; never from client headers. */
export function clientAddress(c: Context): string {
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  return env?.incoming?.socket?.remoteAddress ?? "unknown";
}

export interface AuthMiddlewareOptions {
  /**
   * Accept a browser session cookie. Default true; `/mcp` turns it off so only
   * bearer tokens reach the MCP endpoint.
   */
  allowSession?: boolean;
}

/**
 * Auth middleware for `/api/v1` and `/mcp`.
 *
 * A sent `Authorization` header is always verified as a bearer token (an invalid
 * one is a 401 even when a session cookie is present). Otherwise a session
 * cookie authenticates its own account's household; cookie-based unsafe requests
 * must pass the same-origin check.
 */
export function createAuthMiddleware(
  db: Db,
  now: () => Date = () => new Date(),
  options: AuthMiddlewareOptions = {},
): MiddlewareHandler<AppEnv> {
  return createMiddleware<AppEnv>(async (c, next) => {
    c.header("Vary", "Authorization, Cookie");

    const header = c.req.header("authorization");
    if (header !== undefined && header.trim() !== "") {
      const token = extractBearerToken(header);
      const verified = token ? verifyToken(db, token) : null;
      if (!verified) {
        return c.json(
          { error: { code: "unauthorized" as const, message: "Missing or invalid API token" } },
          401,
        );
      }
      c.set("authKind", "token");
      c.set("ctx", makeCtx(db, verified.householdId, now));
      await next();
      return;
    }

    const value = options.allowSession === false ? undefined : getCookie(c, SESSION_COOKIE_NAME);
    if (value !== undefined) {
      const session = resolveSession(db, value, now());
      if (session !== null) {
        if (SAFE_METHODS[c.req.method.toUpperCase()] !== true && !isSameOriginRequest(c)) {
          return c.json(
            { error: { code: "forbidden" as const, message: "Cross-origin request blocked" } },
            403,
          );
        }
        c.header("Cache-Control", "no-store");
        c.set("authKind", "session");
        c.set("ctx", makeCtx(db, session.household.id, now));
        await next();
        return;
      }
    }

    return c.json(
      { error: { code: "unauthorized" as const, message: "Missing or invalid API token" } },
      401,
    );
  });
}
