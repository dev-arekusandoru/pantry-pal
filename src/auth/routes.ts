import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { authenticate, createAccount } from "./accounts.js";
import type { AppEnv } from "./middleware.js";
import { clientAddress, isSameOriginRequest } from "./middleware.js";
import { createSession, deleteSession, resolveSession, SESSION_COOKIE_NAME } from "./session.js";
import type { Db } from "../db/client.js";
import { getHousehold } from "../services/households.js";

/** Signup/login attempts allowed per peer inside one window. */
const AUTH_LIMIT = 10;
const AUTH_WINDOW_MS = 15 * 60_000;
const MAX_THROTTLE_ENTRIES = 2048;

interface ThrottleWindow {
  count: number;
  resetAt: number;
}

/**
 * Bounded in-memory fixed-window throttle for signup and login.
 *
 * Keys are socket peer addresses, never `X-Forwarded-For` or similar headers a
 * client can spoof.
 *
 * shortcut: the counters live in this process only, so a restart clears them and
 * several server processes do not share a limit. Move to a shared store when the
 * app runs more than one process.
 */
class Throttle {
  private readonly buckets = new Map<string, ThrottleWindow>();

  retryAfterSeconds(key: string, nowMs: number = Date.now()): number | null {
    const bucket = this.buckets.get(key);
    if (bucket === undefined || bucket.count < AUTH_LIMIT) return null;
    return bucket.resetAt > nowMs ? Math.max(1, Math.ceil((bucket.resetAt - nowMs) / 1000)) : null;
  }

  record(key: string, nowMs: number = Date.now()): void {
    let bucket = this.buckets.get(key);
    if (bucket === undefined) {
      if (this.buckets.size >= MAX_THROTTLE_ENTRIES) {
        const oldest = this.buckets.keys().next();
        if (!oldest.done) this.buckets.delete(oldest.value);
      }
      bucket = { count: 0, resetAt: nowMs + AUTH_WINDOW_MS };
      this.buckets.set(key, bucket);
    }
    if (bucket.resetAt <= nowMs) {
      bucket.count = 0;
      bucket.resetAt = nowMs + AUTH_WINDOW_MS;
    }
    bucket.count += 1;
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }
}

export interface AuthRouteOptions {
  db: Db;
  /** Whether `POST /auth/signup` accepts new accounts. */
  signupOpen: boolean;
  /** Clock used for session expiry (tests inject a fixed one). */
  now: () => Date;
  /** Peer address for throttling; defaults to the socket address. */
  clientKey?: (c: Context<AppEnv>) => string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function noStore(c: { header(name: string, value: string): void }): void {
  c.header("Cache-Control", "no-store");
  c.header("Pragma", "no-cache");
}

async function readJson(c: Context<AppEnv>): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await c.req.json();
    return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function validation(c: Context<AppEnv>, message: string) {
  return c.json({ error: { code: "validation" as const, message } }, 400);
}

/**
 * Register the account endpoints on the root app (paths `/auth/*`).
 *
 * - `POST /auth/signup` creates an account, its household and a session.
 * - `POST /auth/login` signs in an existing account.
 * - `POST /auth/logout` deletes the session row and clears the cookie.
 * - `GET /auth/session` reports the signed-in account or whether signup is open.
 */
export function registerAuthRoutes(app: OpenAPIHono<AppEnv>, options: AuthRouteOptions): void {
  const { db, now } = options;
  const throttle = new Throttle();
  const clientKey = (c: Context<AppEnv>) => options.clientKey?.(c) ?? clientAddress(c);

  // The `__Host-` cookie prefix requires Secure even on plain-HTTP loopback,
  // which browsers treat as a secure context.
  const cookieOptions = (maxAge: number) => ({
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "Lax" as const,
    maxAge,
  });

  function startSession(c: Context<AppEnv>, accountId: string): void {
    const session = createSession(db, accountId, now());
    setCookie(c, SESSION_COOKIE_NAME, session.value, cookieOptions(session.maxAge));
  }

  app.use(
    "/auth/*",
    bodyLimit({
      maxSize: 8192,
      onError: (c) =>
        c.json(
          { error: { code: "validation" as const, message: "Request body too large" } },
          413,
        ),
    }),
  );

  app.get("/auth/session", (c) => {
    noStore(c);
    const value = getCookie(c, SESSION_COOKIE_NAME);
    const session = value === undefined ? null : resolveSession(db, value, now());
    if (session === null) {
      return c.json({ authenticated: false as const, signupOpen: options.signupOpen }, 200);
    }
    return c.json(
      {
        authenticated: true as const,
        account: { email: session.account.email },
        household: session.household,
      },
      200,
    );
  });

  app.post("/auth/signup", async (c) => {
    noStore(c);
    if (!isSameOriginRequest(c)) {
      return c.json(
        { error: { code: "forbidden" as const, message: "Cross-origin request blocked" } },
        403,
      );
    }
    if (!options.signupOpen) {
      return c.json({ error: { code: "forbidden" as const, message: "Signup is closed" } }, 403);
    }

    const key = clientKey(c);
    const retryAfter = throttle.retryAfterSeconds(key);
    if (retryAfter !== null) {
      c.header("Retry-After", String(retryAfter));
      return c.json(
        { error: { code: "rate_limited" as const, message: "Too many attempts. Try again later." } },
        429,
      );
    }
    throttle.record(key);

    const body = await readJson(c);
    if (body === null) return validation(c, "Expected a JSON object");

    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const householdName =
      typeof body.householdName === "string" ? body.householdName.trim() : "";

    if (!EMAIL_PATTERN.test(email)) return validation(c, "Enter a valid email address");
    if (password.length < 8) return validation(c, "Password must be at least 8 characters");
    if (householdName === "") return validation(c, "Household name is required");

    try {
      const { account, household } = createAccount(db, email, password, { householdName });
      startSession(c, account.id);
      return c.json(
        { account: { email: account.email }, household: { id: household.id, name: household.name } },
        201,
      );
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "conflict") {
        return c.json(
          { error: { code: "conflict" as const, message: "An account with this email already exists" } },
          409,
        );
      }
      throw error;
    }
  });

  app.post("/auth/login", async (c) => {
    noStore(c);
    if (!isSameOriginRequest(c)) {
      return c.json(
        { error: { code: "forbidden" as const, message: "Cross-origin request blocked" } },
        403,
      );
    }

    const key = clientKey(c);
    const retryAfter = throttle.retryAfterSeconds(key);
    if (retryAfter !== null) {
      c.header("Retry-After", String(retryAfter));
      return c.json(
        { error: { code: "rate_limited" as const, message: "Too many attempts. Try again later." } },
        429,
      );
    }

    const body = await readJson(c);
    if (body === null) return validation(c, "Expected a JSON object");

    const email = typeof body.email === "string" ? body.email : "";
    const password = typeof body.password === "string" ? body.password : "";

    const account = email === "" || password === "" ? null : authenticate(db, email, password);
    if (account === null) {
      throttle.record(key);
      return c.json(
        { error: { code: "unauthorized" as const, message: "Invalid email or password" } },
        401,
      );
    }

    throttle.reset(key);
    startSession(c, account.id);
    const household = getHousehold(db, account.householdId);
    return c.json(
      {
        account: { email: account.email },
        household: { id: household.id, name: household.name },
      },
      200,
    );
  });

  app.post("/auth/logout", (c) => {
    noStore(c);
    if (!isSameOriginRequest(c)) {
      return c.json(
        { error: { code: "forbidden" as const, message: "Cross-origin request blocked" } },
        403,
      );
    }
    const value = getCookie(c, SESSION_COOKIE_NAME);
    if (value !== undefined) deleteSession(db, value);
    deleteCookie(c, SESSION_COOKIE_NAME, cookieOptions(0));
    return c.body(null, 204);
  });
}
