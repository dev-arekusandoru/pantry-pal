import { getCookie } from "hono/cookie";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { getAccount, getAccountByEmail, markEmailVerified, resetPassword } from "./accounts.js";
import { consumeEmailToken, emailTokenRetryAfter, voidEmailTokens } from "./emailTokens.js";
import { crossOriginBlock, noStore, notFound, rateLimited, readJson, validation } from "./http.js";
import { sendResetLink, sendVerificationLink } from "./mail.js";
import type { AppEnv } from "./middleware.js";
import { resolveSession, SESSION_COOKIE_NAME } from "./session.js";
import type { AuthRouteContext } from "./routes.js";
import type { Db } from "../db/client.js";
import { getHousehold } from "../services/households.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function invalidToken(c: Context<AppEnv>) {
  return c.json(
    { error: { code: "invalid_token" as const, message: "This link is not valid. It may have expired or been used." } },
    400,
  );
}

/**
 * Email verification and password reset (`/auth/verify-email*`, `/auth/password/*`).
 * Every route answers 404 when email is off. All are throttled per peer address.
 */
export function registerEmailRoutes(app: OpenAPIHono<AppEnv>, ctx: AuthRouteContext): void {
  const { db, now, hosted, throttle, clientKey, startSession } = ctx;

  /** Shared preamble: email on, same origin, peer not throttled. Returns a response to stop, else the throttle key. */
  function guard(c: Context<AppEnv>, scope: string): { response: Response } | { key: string } {
    noStore(c);
    if (hosted.mailer === null) return { response: notFound(c) };
    const blocked = crossOriginBlock(c);
    if (blocked) return { response: blocked };
    const key = `${scope}:${clientKey(c)}`;
    const retryAfter = throttle.retryAfterSeconds(key);
    if (retryAfter !== null) return { response: rateLimited(c, retryAfter) };
    return { key };
  }

  app.post("/auth/verify-email/send", (c) => {
    const checked = guard(c, "verify-send");
    if ("response" in checked) return checked.response;
    throttle.record(checked.key);

    const value = getCookie(c, SESSION_COOKIE_NAME);
    const session = value === undefined ? null : resolveSession(db, value, now());
    if (session === null) {
      return c.json({ error: { code: "unauthorized" as const, message: "Sign in first" } }, 401);
    }
    const account = getAccount(db, session.account.id);
    if (account.emailVerifiedAt !== null) return c.body(null, 204);

    const wait = emailTokenRetryAfter(db, account.id, "verify", now());
    if (wait !== null) return rateLimited(c, wait);
    sendVerificationLink(db, hosted, account, now());
    return c.body(null, 204);
  });

  app.post("/auth/verify-email", async (c) => {
    const checked = guard(c, "verify");
    if ("response" in checked) return checked.response;
    const body = await readJson(c);
    if (body === null) return validation(c, "Expected a JSON object");

    const token = typeof body.token === "string" ? body.token : "";
    const account = consumeEmailToken(db, token, "verify", now());
    if (account === null) {
      throttle.record(checked.key);
      return invalidToken(c);
    }
    markEmailVerified(db, account.id, now());
    return c.body(null, 204);
  });

  app.post("/auth/password/forgot", async (c) => {
    const checked = guard(c, "forgot");
    if ("response" in checked) return checked.response;
    throttle.record(checked.key);

    const body = await readJson(c);
    if (body === null) return validation(c, "Expected a JSON object");
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!EMAIL_PATTERN.test(email)) return validation(c, "Enter a valid email address");

    // The answer is the same whether or not the account exists. Per-account limits
    // skip the email silently for the same reason.
    const account = getAccountByEmail(db, email);
    if (account !== undefined && emailTokenRetryAfter(db, account.id, "reset", now()) === null) {
      sendResetLink(db, hosted, account, now());
    }
    return c.body(null, 204);
  });

  app.post("/auth/password/reset", async (c) => {
    const checked = guard(c, "reset");
    if ("response" in checked) return checked.response;
    const body = await readJson(c);
    if (body === null) return validation(c, "Expected a JSON object");

    const token = typeof body.token === "string" ? body.token : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (password.length < 8) return validation(c, "Password must be at least 8 characters");

    const result = db.transaction((tx) => {
      const handle = tx as unknown as Db;
      const account = consumeEmailToken(handle, token, "reset", now());
      if (account === null) return null;
      const updated = resetPassword(handle, account.email, password); // also ends every session
      markEmailVerified(handle, account.id, now());
      voidEmailTokens(handle, account.id, "reset", now());
      return updated;
    });
    if (result === null) {
      throttle.record(checked.key);
      return invalidToken(c);
    }

    startSession(c, result.id);
    const household = getHousehold(db, result.householdId);
    return c.json(
      { account: { email: result.email }, household: { id: household.id, name: household.name } },
      200,
    );
  });
}
