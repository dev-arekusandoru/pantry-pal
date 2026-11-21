import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { accounts, emailTokens, sessions } from "../src/db/schema.js";
import { passwordResetEmail, verificationEmail } from "../src/email/templates.js";
import {
  DAY_MS,
  makeHostedApp,
  ORIGIN,
  PASSWORD,
  PUBLIC_URL,
  tokenFrom,
  type HostedTestApp,
} from "./hosted-helpers.js";

const NEW_PASSWORD = "a brand new passphrase";
const post = (app: HostedTestApp, path: string, body?: unknown, cookie?: string) =>
  app.request("POST", path, {
    headers: { origin: ORIGIN },
    ...(body === undefined ? {} : { body }),
    ...(cookie === undefined ? {} : { cookie }),
  });

describe("signup email", () => {
  it("sends a verification email with a link to the public URL", async () => {
    const app = makeHostedApp({ billing: false });
    await app.signup("cook@example.com");

    expect(app.mailer.sent).toHaveLength(1);
    const email = app.mailer.sent[0]!;
    expect(email.to).toBe("cook@example.com");
    expect(email.subject).toContain("Verify");
    expect(email.text).toContain(`${PUBLIC_URL}/verify-email?token=`);
    expect(email.html).toContain(`${PUBLIC_URL}/verify-email?token=`);
    expect(email.html).toContain("https://rakumi.app/raku-email.png");
    const account = app.db.select().from(accounts).get()!;
    expect(account.emailVerifiedAt).toBeNull();
  });

  it("still signs up when the mail server is down", async () => {
    const app = makeHostedApp({ billing: false });
    app.mailer.failing = true;
    const { cookie } = await app.signup();
    expect((await app.request("GET", "/auth/session", { cookie })).status).toBe(200);
  });

  it("sends nothing and marks the account verified when email is off", async () => {
    const app = makeHostedApp({ email: false, billing: false });
    await app.signup();
    expect(app.mailer.sent).toHaveLength(0);
    expect(app.db.select().from(accounts).get()?.emailVerifiedAt).not.toBeNull();
    for (const [path, body] of [
      ["/auth/verify-email", { token: "x" }],
      ["/auth/verify-email/send", undefined],
      ["/auth/password/forgot", { email: "cook@example.com" }],
      ["/auth/password/reset", { token: "x", password: NEW_PASSWORD }],
    ] as const) {
      expect((await post(app, path, body)).status).toBe(404);
    }
  });

  it("escapes values in templates", () => {
    const email = verificationEmail("a@b.co", 'https://x.test/?a=1&b="2"');
    expect(email.html).toContain("a=1&amp;b=&quot;2&quot;");
    expect(email.html).not.toContain('b="2"');
    expect(passwordResetEmail("a@b.co", "https://x.test/r?token=t").text).toContain("https://x.test/r?token=t");
  });
});

describe("verify email", () => {
  it("verifies once; the token cannot be reused", async () => {
    const app = makeHostedApp({ billing: false });
    await app.signup();
    const token = tokenFrom(app.mailer.sent[0]);

    expect((await post(app, "/auth/verify-email", { token })).status).toBe(204);
    expect(app.db.select().from(accounts).get()?.emailVerifiedAt).toBe(app.now().toISOString());

    const again = await post(app, "/auth/verify-email", { token });
    expect(again.status).toBe(400);
    expect(again.body).toMatchObject({ error: { code: "invalid_token" } });
  });

  it("rejects an expired token (48 hours) and an unknown token", async () => {
    const app = makeHostedApp({ billing: false });
    await app.signup();
    const token = tokenFrom(app.mailer.sent[0]);

    app.setNow(new Date(app.now().getTime() + 48 * 60 * 60_000 + 1000));
    const expired = await post(app, "/auth/verify-email", { token });
    expect(expired.status).toBe(400);
    expect(expired.body).toMatchObject({ error: { code: "invalid_token" } });
    expect((await post(app, "/auth/verify-email", { token: "nope" })).status).toBe(400);
    expect((await post(app, "/auth/verify-email", {})).status).toBe(400);
    expect(app.db.select().from(accounts).get()?.emailVerifiedAt).toBeNull();
  });

  it("accepts a token just before it expires", async () => {
    const app = makeHostedApp({ billing: false });
    await app.signup();
    const token = tokenFrom(app.mailer.sent[0]);
    app.setNow(new Date(app.now().getTime() + 48 * 60 * 60_000 - 1000));
    expect((await post(app, "/auth/verify-email", { token })).status).toBe(204);
  });

  it("stores only a hash of the token", async () => {
    const app = makeHostedApp({ billing: false });
    await app.signup();
    const token = tokenFrom(app.mailer.sent[0]);
    const row = app.db.select().from(emailTokens).get()!;
    expect(row.tokenHash).not.toBe(token);
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it("does not use a reset token as a verification token", async () => {
    const app = makeHostedApp({ billing: false });
    await app.signup();
    await post(app, "/auth/password/forgot", { email: "cook@example.com" });
    const resetToken = tokenFrom(app.mailer.sent[1]);
    expect((await post(app, "/auth/verify-email", { token: resetToken })).status).toBe(400);
  });
});

describe("resend verification", () => {
  it("needs a session", async () => {
    const app = makeHostedApp({ billing: false });
    expect((await post(app, "/auth/verify-email/send")).status).toBe(401);
  });

  it("allows one per 60 seconds, then 5 per day, with Retry-After", async () => {
    const app = makeHostedApp({ billing: false });
    const { cookie } = await app.signup(); // link 1
    const tick = (ms: number) => app.setNow(new Date(app.now().getTime() + ms));

    const tooSoon = await post(app, "/auth/verify-email/send", undefined, cookie);
    expect(tooSoon.status).toBe(429);
    expect(Number(tooSoon.headers.get("retry-after"))).toBe(60);

    tick(61_000);
    expect((await post(app, "/auth/verify-email/send", undefined, cookie)).status).toBe(204); // 2
    tick(61_000);
    expect((await post(app, "/auth/verify-email/send", undefined, cookie)).status).toBe(204); // 3
    tick(61_000);
    expect((await post(app, "/auth/verify-email/send", undefined, cookie)).status).toBe(204); // 4
    tick(61_000);
    expect((await post(app, "/auth/verify-email/send", undefined, cookie)).status).toBe(204); // 5
    expect(app.mailer.sent).toHaveLength(5);

    tick(61_000);
    const daily = await post(app, "/auth/verify-email/send", undefined, cookie);
    expect(daily.status).toBe(429);
    expect(Number(daily.headers.get("retry-after"))).toBeGreaterThan(3600);
    expect(app.mailer.sent).toHaveLength(5);

    tick(DAY_MS);
    expect((await post(app, "/auth/verify-email/send", undefined, cookie)).status).toBe(204);
  });

  it("does nothing for a verified account", async () => {
    const app = makeHostedApp({ billing: false });
    const { cookie } = await app.signup();
    await post(app, "/auth/verify-email", { token: tokenFrom(app.mailer.sent[0]) });
    app.setNow(new Date(app.now().getTime() + 120_000));
    expect((await post(app, "/auth/verify-email/send", undefined, cookie)).status).toBe(204);
    expect(app.mailer.sent).toHaveLength(1);
  });
});

describe("forgot password", () => {
  it("answers the same for known and unknown emails", async () => {
    const app = makeHostedApp({ billing: false });
    await app.signup("known@example.com");
    app.mailer.sent.length = 0;

    const known = await post(app, "/auth/password/forgot", { email: "known@example.com" });
    const unknown = await post(app, "/auth/password/forgot", { email: "nobody@example.com" });

    expect(known.status).toBe(204);
    expect(unknown.status).toBe(204);
    expect(known.body).toEqual(unknown.body);
    expect([...known.headers.entries()].sort()).toEqual([...unknown.headers.entries()].sort());
    expect(app.mailer.sent).toHaveLength(1);
    expect(app.mailer.sent[0]?.to).toBe("known@example.com");
    expect(app.mailer.sent[0]?.text).toContain(`${PUBLIC_URL}/reset-password?token=`);
    expect(app.mailer.to("nobody@example.com")).toHaveLength(0);
  });

  it("matches the email case-insensitively and rejects malformed input", async () => {
    const app = makeHostedApp({ billing: false });
    await app.signup("known@example.com");
    app.mailer.sent.length = 0;
    expect((await post(app, "/auth/password/forgot", { email: " Known@Example.com " })).status).toBe(204);
    expect(app.mailer.sent).toHaveLength(1);
    expect((await post(app, "/auth/password/forgot", { email: "nope" })).status).toBe(400);
  });

  it("throttles by peer address", async () => {
    const app = makeHostedApp({ billing: false });
    for (let i = 0; i < 10; i++) {
      expect((await post(app, "/auth/password/forgot", { email: `u${i}@example.com` })).status).toBe(204);
    }
    const blocked = await post(app, "/auth/password/forgot", { email: "late@example.com" });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).not.toBeNull();
  });

  it("sends at most one link per minute per account, silently", async () => {
    const app = makeHostedApp({ billing: false });
    await app.signup("known@example.com");
    app.mailer.sent.length = 0;
    await post(app, "/auth/password/forgot", { email: "known@example.com" });
    const second = await post(app, "/auth/password/forgot", { email: "known@example.com" });
    expect(second.status).toBe(204);
    expect(app.mailer.sent).toHaveLength(1);
  });
});

describe("reset password", () => {
  async function requestReset(app: HostedTestApp, email = "cook@example.com") {
    const before = app.mailer.sent.length;
    await post(app, "/auth/password/forgot", { email });
    expect(app.mailer.sent).toHaveLength(before + 1);
    return tokenFrom(app.mailer.sent[before]);
  }

  it("sets the password, ends every session, verifies the email and signs in", async () => {
    const app = makeHostedApp({ billing: false });
    const { cookie: oldCookie } = await app.signup();
    const token = await requestReset(app);
    expect(app.db.select().from(sessions).all()).toHaveLength(1);

    const response = await post(app, "/auth/password/reset", { token, password: NEW_PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ account: { email: "cook@example.com" }, household: { name: "Test Kitchen" } });
    // Old session is gone, the new cookie works.
    expect((await app.request("GET", "/api/v1/household", { cookie: oldCookie })).status).toBe(401);
    const newCookie = response.headers.get("set-cookie")!.split(";")[0]!;
    expect(newCookie).not.toBe(oldCookie);
    expect((await app.request("GET", "/api/v1/household", { cookie: newCookie })).status).toBe(200);
    expect(app.db.select().from(sessions).all()).toHaveLength(1);
    expect(app.db.select().from(accounts).get()?.emailVerifiedAt).not.toBeNull();

    const oldLogin = await post(app, "/auth/login", { email: "cook@example.com", password: PASSWORD });
    expect(oldLogin.status).toBe(401);
    const newLogin = await post(app, "/auth/login", { email: "cook@example.com", password: NEW_PASSWORD });
    expect(newLogin.status).toBe(200);
  });

  it("works once", async () => {
    const app = makeHostedApp({ billing: false });
    await app.signup();
    const token = await requestReset(app);
    expect((await post(app, "/auth/password/reset", { token, password: NEW_PASSWORD })).status).toBe(200);
    const again = await post(app, "/auth/password/reset", { token, password: "yet another passphrase" });
    expect(again.status).toBe(400);
    expect(again.body).toMatchObject({ error: { code: "invalid_token" } });
  });

  it("expires after 1 hour", async () => {
    const app = makeHostedApp({ billing: false });
    await app.signup();
    const token = await requestReset(app);
    app.setNow(new Date(app.now().getTime() + 60 * 60_000 + 1000));
    expect((await post(app, "/auth/password/reset", { token, password: NEW_PASSWORD })).status).toBe(400);
  });

  it("voids older reset links when a new one is requested", async () => {
    const app = makeHostedApp({ billing: false });
    await app.signup();
    const first = await requestReset(app);
    app.setNow(new Date(app.now().getTime() + 120_000));
    const second = await requestReset(app);

    expect((await post(app, "/auth/password/reset", { token: first, password: NEW_PASSWORD })).status).toBe(400);
    expect((await post(app, "/auth/password/reset", { token: second, password: NEW_PASSWORD })).status).toBe(200);
  });

  it("keeps the token usable after a too-short password", async () => {
    const app = makeHostedApp({ billing: false });
    await app.signup();
    const token = await requestReset(app);
    expect((await post(app, "/auth/password/reset", { token, password: "short" })).status).toBe(400);
    expect((await post(app, "/auth/password/reset", { token, password: NEW_PASSWORD })).status).toBe(200);
  });

  it("cannot use a verification token", async () => {
    const app = makeHostedApp({ billing: false });
    await app.signup();
    const verifyToken = tokenFrom(app.mailer.sent[0]);
    expect((await post(app, "/auth/password/reset", { token: verifyToken, password: NEW_PASSWORD })).status).toBe(400);
  });

  it("rejects cross-origin posts", async () => {
    const app = makeHostedApp({ billing: false });
    const response = await app.request("POST", "/auth/password/forgot", {
      body: { email: "a@b.co" },
      headers: { origin: "https://evil.example" },
    });
    expect(response.status).toBe(403);
  });
});

describe("account rows", () => {
  it("keeps email tokens only for their account (cascade on delete)", async () => {
    const app = makeHostedApp({ billing: false });
    const { householdId } = await app.signup();
    expect(app.db.select().from(emailTokens).all()).toHaveLength(1);
    const { households } = await import("../src/db/schema.js");
    app.db.delete(households).where(eq(households.id, householdId)).run();
    expect(app.db.select().from(emailTokens).all()).toHaveLength(0);
  });
});
