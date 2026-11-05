import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "./middleware.js";
import { isSameOriginRequest } from "./middleware.js";
import {
  createSessionToken,
  isPasswordConfigured,
  passwordMatches,
  SESSION_COOKIE_NAME,
  verifySessionToken,
} from "./session.js";

/** Login failures allowed per peer (and in total) inside one window. */
const LOGIN_LIMIT = 10;
const LOGIN_GLOBAL_LIMIT = 40;
const LOGIN_WINDOW_MS = 60_000;
const MAX_THROTTLE_ENTRIES = 2048;

interface ThrottleWindow {
  count: number;
  resetAt: number;
}

/**
 * Bounded, in-memory fixed-window throttle for password attempts.
 *
 * Keys are socket peer addresses, never `X-Forwarded-For` or similar headers a
 * client can spoof. A global bucket caps distributed attempts; because a tunnel
 * forwards from loopback, that global cap is usually the effective one anyway.
 */
class LoginThrottle {
  private readonly buckets = new Map<string, ThrottleWindow>();
  private readonly globalBucket: ThrottleWindow = { count: 0, resetAt: 0 };

  retryAfterSeconds(key: string, nowMs: number = Date.now()): number | null {
    const retry = (bucket: ThrottleWindow, limit: number): number | null =>
      bucket.count >= limit && bucket.resetAt > nowMs
        ? Math.max(1, Math.ceil((bucket.resetAt - nowMs) / 1000))
        : null;

    const global = retry(this.globalBucket, LOGIN_GLOBAL_LIMIT);
    if (global !== null) return global;
    const bucket = this.buckets.get(key);
    return bucket === undefined ? null : retry(bucket, LOGIN_LIMIT);
  }

  recordFailure(key: string, nowMs: number = Date.now()): void {
    this.bump(this.globalBucket, nowMs);
    this.prune(nowMs);

    let bucket = this.buckets.get(key);
    if (bucket === undefined) {
      if (this.buckets.size >= MAX_THROTTLE_ENTRIES) {
        const oldest = this.buckets.keys().next();
        if (!oldest.done) this.buckets.delete(oldest.value);
      }
      bucket = { count: 0, resetAt: nowMs + LOGIN_WINDOW_MS };
      this.buckets.set(key, bucket);
    }
    this.bump(bucket, nowMs);
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  private bump(bucket: ThrottleWindow, nowMs: number): void {
    if (bucket.resetAt <= nowMs) {
      bucket.count = 0;
      bucket.resetAt = nowMs + LOGIN_WINDOW_MS;
    }
    bucket.count += 1;
  }

  private prune(nowMs: number): void {
    if (this.buckets.size < MAX_THROTTLE_ENTRIES) return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= nowMs) this.buckets.delete(key);
    }
  }
}

export interface AuthRouteOptions {
  /** Shared browser password. Omit to disable password login. */
  browserPassword?: string;
  /** Clock used to sign and verify sessions (tests inject a fixed one). */
  now: () => Date;
  /** Peer address for throttling; defaults to no useful address. */
  clientKey?: (c: Context<AppEnv>) => string;
}

function noStore(c: { header(name: string, value: string): void }): void {
  c.header("Cache-Control", "no-store");
  c.header("Pragma", "no-cache");
}

/**
 * Register the browser-login endpoints on the root app (paths `/auth/*`).
 *
 * - `GET /auth/session` reports whether password mode is on and whether the
 *   request carries a valid session cookie.
 * - `POST /auth/login` accepts `{ "password": string }` as JSON from the app's
 *   own origin and sets the 30-day session cookie.
 * - `POST /auth/logout` clears the session cookie from the current browser.
 */
export function registerAuthRoutes(app: OpenAPIHono<AppEnv>, options: AuthRouteOptions): void {
  const passwordEnabled = isPasswordConfigured(options.browserPassword);
  const password = passwordEnabled ? options.browserPassword : undefined;
  const throttle = new LoginThrottle();

  app.get("/auth/session", (c) => {
    noStore(c);
    const authenticated =
      password !== undefined &&
      verifySessionToken(password, getCookie(c, SESSION_COOKIE_NAME) ?? "", options.now());
    return c.json({ enabled: passwordEnabled, authenticated }, 200);
  });

  app.use(
    "/auth/login",
    bodyLimit({
      maxSize: 4096,
      onError: (c) =>
        c.json(
          { error: { code: "validation" as const, message: "Request body too large" } },
          413,
        ),
    }),
  );

  app.post("/auth/login", async (c) => {
    noStore(c);
    if (password === undefined) {
      return c.json(
        { error: { code: "not_found" as const, message: "Browser login is not configured" } },
        404,
      );
    }
    if (!isSameOriginRequest(c)) {
      return c.json(
        { error: { code: "forbidden" as const, message: "Cross-origin request blocked" } },
        403,
      );
    }
    const contentType = c.req.header("content-type")?.toLowerCase() ?? "";
    if (!contentType.startsWith("application/json")) {
      return c.json(
        {
          error: {
            code: "unsupported_media_type" as const,
            message: "Content-Type must be application/json",
          },
        },
        415,
      );
    }

    const clientKey = options.clientKey?.(c) ?? "unknown";
    const nowMs = Date.now();
    const retryAfter = throttle.retryAfterSeconds(clientKey, nowMs);
    if (retryAfter !== null) {
      c.header("Retry-After", String(retryAfter));
      return c.json(
        {
          error: {
            code: "rate_limited" as const,
            message: "Too many login attempts. Try again later.",
          },
        },
        429,
      );
    }

    let supplied: unknown;
    try {
      const body: unknown = await c.req.json();
      if (typeof body === "object" && body !== null && "password" in body) {
        supplied = body.password;
      }
    } catch {
      return c.json(
        { error: { code: "validation" as const, message: "Expected a JSON body with a password" } },
        400,
      );
    }
    if (typeof supplied !== "string") {
      return c.json(
        { error: { code: "validation" as const, message: "password must be a string" } },
        400,
      );
    }

    if (!passwordMatches(password, supplied)) {
      throttle.recordFailure(clientKey, nowMs);
      return c.json(
        { error: { code: "unauthorized" as const, message: "Invalid password" } },
        401,
      );
    }

    throttle.reset(clientKey);
    const now = options.now();
    const token = createSessionToken(password, now);
    setCookie(c, SESSION_COOKIE_NAME, token.value, {
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      maxAge: token.maxAge,
    });
    return c.body(null, 204);
  });

  app.post("/auth/logout", (c) => {
    noStore(c);
    if (!isSameOriginRequest(c)) {
      return c.json(
        { error: { code: "forbidden" as const, message: "Cross-origin request blocked" } },
        403,
      );
    }
    deleteCookie(c, SESSION_COOKIE_NAME, {
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    });
    return c.body(null, 204);
  });
}
