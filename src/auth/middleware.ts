import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { Context, MiddlewareHandler } from "hono";
import { households } from "../db/schema.js";
import type { Db } from "../db/client.js";
import { makeCtx, type Ctx } from "../context.js";
import { verifyToken } from "./tokens.js";
import { isPasswordConfigured, SESSION_COOKIE_NAME, verifySessionToken } from "./session.js";

/** Hono environment for authenticated routes: `c.var.ctx` is always set. */
export type AppEnv = { Variables: { ctx: Ctx } };

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
   * Network-trust mode: a request with no `Authorization` header acts as the
   * instance's single household. Ignored when browser password login is on.
   */
  trustNetwork?: boolean;
  /**
   * Shared password for browser sessions. When set, a valid session cookie also
   * authenticates `/api/v1`; anonymous network trust is disabled.
   */
  browserPassword?: string;
}

/**
 * Auth middleware for `/api/v1` and `/mcp`.
 *
 * Precedence: a sent `Authorization` header is always verified as a bearer token
 * (an invalid one is a 401 even when a session cookie is present). Otherwise, in
 * password mode, a valid session cookie authenticates the request; cookie-based
 * unsafe requests must pass the same-origin check. Without password mode the
 * legacy network-trust and bearer behaviour applies. `/mcp` never accepts cookies
 * because it is mounted with an auth middleware that has no password configured.
 */
export function createAuthMiddleware(
  db: Db,
  now: () => Date = () => new Date(),
  options: AuthMiddlewareOptions = {},
): MiddlewareHandler<AppEnv> {
  const passwordMode = isPasswordConfigured(options.browserPassword);
  const password = passwordMode ? options.browserPassword : undefined;

  return createMiddleware<AppEnv>(async (c, next) => {
    c.header("Vary", "Authorization, Cookie");

    function singleHousehold(): Ctx | Response {
      const household = db.select({ id: households.id }).from(households).limit(1).get();
      if (!household) {
        return c.json(
          {
            error: {
              code: "unavailable" as const,
              message:
                "No household exists yet. Run `pantrypal household init --name <name>` first.",
            },
          },
          503,
        );
      }
      return makeCtx(db, household.id, now);
    }

    const header = c.req.header("authorization");
    const hasHeader = header !== undefined && header.trim() !== "";

    if (hasHeader) {
      const token = extractBearerToken(header);
      const verified = token ? verifyToken(db, token) : null;
      if (!verified) {
        return c.json(
          { error: { code: "unauthorized" as const, message: "Missing or invalid API token" } },
          401,
        );
      }
      c.set("ctx", makeCtx(db, verified.householdId, now));
      await next();
      return;
    }

    if (password !== undefined) {
      const value = getCookie(c, SESSION_COOKIE_NAME);
      if (value !== undefined && verifySessionToken(password, value, now())) {
        if (SAFE_METHODS[c.req.method.toUpperCase()] !== true && !isSameOriginRequest(c)) {
          return c.json(
            { error: { code: "forbidden" as const, message: "Cross-origin request blocked" } },
            403,
          );
        }
        const ctx = singleHousehold();
        if (ctx instanceof Response) return ctx;
        c.header("Cache-Control", "no-store");
        c.set("ctx", ctx);
        await next();
        return;
      }
      return c.json(
        { error: { code: "unauthorized" as const, message: "Missing or invalid browser session" } },
        401,
      );
    }

    if (options.trustNetwork === true) {
      const ctx = singleHousehold();
      if (ctx instanceof Response) return ctx;
      c.set("ctx", ctx);
      await next();
      return;
    }

    return c.json(
      { error: { code: "unauthorized" as const, message: "Missing or invalid API token" } },
      401,
    );
  });
}
