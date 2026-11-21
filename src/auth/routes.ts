import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { accessPolicy, type Hosted, SELF_HOST } from "../hosted.js";
import { computeAccess, verifyBy } from "../access.js";
import { refreshLock } from "../billing/state.js";
import { authenticate, createAccount, getAccount } from "./accounts.js";
import { registerEmailRoutes } from "./emailRoutes.js";
import { crossOriginBlock, noStore, rateLimited, readJson, validation } from "./http.js";
import { sendVerificationLink } from "./mail.js";
import type { AppEnv } from "./middleware.js";
import { clientAddress } from "./middleware.js";
import { createSession, deleteSession, resolveSession, SESSION_COOKIE_NAME } from "./session.js";
import { Throttle } from "./throttle.js";
import type { Db } from "../db/client.js";
import { getHousehold } from "../services/households.js";

export interface AuthRouteOptions {
  db: Db;
  /** Whether `POST /auth/signup` accepts new accounts. */
  signupOpen: boolean;
  /** Clock used for session expiry (tests inject a fixed one). */
  now: () => Date;
  /** Peer address for throttling; defaults to the socket address. */
  clientKey?: (c: Context<AppEnv>) => string;
  /** Email and billing services; omit for a self-hosted instance. */
  hosted?: Hosted;
}

/** What the email routes share with the core account routes. */
export interface AuthRouteContext {
  db: Db;
  now: () => Date;
  hosted: Hosted;
  throttle: Throttle;
  clientKey: (c: Context<AppEnv>) => string;
  startSession: (c: Context<AppEnv>, accountId: string) => void;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Register the account endpoints on the root app (paths `/auth/*`).
 *
 * - `POST /auth/signup` creates an account, its household and a session.
 * - `POST /auth/login` signs in an existing account.
 * - `POST /auth/logout` deletes the session row and clears the cookie.
 * - `GET /auth/session` reports the signed-in account, its access and billing state.
 * - Email verification and password reset: see `emailRoutes.ts`.
 */
export function registerAuthRoutes(app: OpenAPIHono<AppEnv>, options: AuthRouteOptions): void {
  const { db, now } = options;
  const hosted = options.hosted ?? SELF_HOST;
  const policy = accessPolicy(hosted);
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

  const features = { email: policy.emailOn, billing: policy.billingOn };

  app.get("/auth/session", async (c) => {
    noStore(c);
    const value = getCookie(c, SESSION_COOKIE_NAME);
    const session = value === undefined ? null : resolveSession(db, value, now());
    if (session === null) {
      return c.json({ authenticated: false as const, signupOpen: options.signupOpen, features }, 200);
    }

    const account = getAccount(db, session.account.id);
    const deadline = verifyBy(policy, account);
    const billing = hosted.billing === null ? null : await hosted.billing.summary(db, session.household.id);
    return c.json(
      {
        authenticated: true as const,
        account: {
          email: account.email,
          emailVerified: account.emailVerifiedAt !== null,
          verifyBy: deadline === null ? null : deadline.toISOString(),
        },
        household: session.household,
        features,
        access: computeAccess(db, policy, session.household.id, now()),
        billing,
      },
      200,
    );
  });

  app.post("/auth/signup", async (c) => {
    noStore(c);
    const blocked = crossOriginBlock(c);
    if (blocked) return blocked;
    if (!options.signupOpen) {
      return c.json({ error: { code: "forbidden" as const, message: "Signup is closed" } }, 403);
    }

    const key = clientKey(c);
    const retryAfter = throttle.retryAfterSeconds(key);
    if (retryAfter !== null) return rateLimited(c, retryAfter);
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
      const created = now();
      const { account, household } = createAccount(db, email, password, {
        householdName,
        // With email off there is nothing to verify.
        emailVerified: !policy.emailOn,
        now: created,
      });
      // Billing on: the household starts locked until a plan starts.
      if (hosted.billing !== null) refreshLock(db, household.id, created);
      sendVerificationLink(db, hosted, account, created);
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
    const blocked = crossOriginBlock(c);
    if (blocked) return blocked;

    const key = clientKey(c);
    const retryAfter = throttle.retryAfterSeconds(key);
    if (retryAfter !== null) return rateLimited(c, retryAfter);

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
    const blocked = crossOriginBlock(c);
    if (blocked) return blocked;
    const value = getCookie(c, SESSION_COOKIE_NAME);
    if (value !== undefined) deleteSession(db, value);
    deleteCookie(c, SESSION_COOKIE_NAME, cookieOptions(0));
    return c.body(null, 204);
  });

  registerEmailRoutes(app, { db, now, hosted, throttle, clientKey, startSession });
}
