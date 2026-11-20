import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { parseConfig, type Config } from "../src/config.js";
import { openDb, Store } from "../src/db.js";
import type { Mail, Mailer } from "../src/mail.js";

const ORIGIN = "https://pantry.example";

function setup(options: { failMail?: boolean; smtp?: boolean } = {}) {
  const config: Config = parseConfig(
    {
      publicUrl: "https://wl.example/",
      sites: { pantry: { name: "PantryPal", origins: [ORIGIN] } },
      trustedIpHeader: "x-ip",
    },
    { WAITLIST_SECRET: "0123456789abcdef" },
  );
  const store = new Store(openDb(":memory:"));
  const sent: Mail[] = [];
  const mailer: Mailer = {
    async send(mail) {
      if (options.failMail) throw new Error("smtp down");
      sent.push(mail);
    },
  };
  let now = new Date("2026-11-20T10:00:00Z");
  const wl = createApp({ config, store, mailer: options.smtp === false ? undefined : mailer, now: () => now });
  const post = (body: unknown, headers: Record<string, string> = {}, site = "pantry") =>
    wl.app.request(`/v1/sites/${site}/subscribe`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, "x-ip": "1.1.1.1", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  return { ...wl, store, sent, post, advance: (ms: number) => (now = new Date(now.getTime() + ms)) };
}

describe("subscribe", () => {
  it("stores a normalized address once and sends one welcome email", async () => {
    const t = setup();
    expect((await t.post({ email: "  Ann@Example.COM " })).status).toBe(200);
    expect((await t.post({ email: "ann@example.com" })).status).toBe(200);
    await t.drain();

    expect(t.store.list()).toHaveLength(1);
    expect(t.store.list()[0]!.email).toBe("ann@example.com");
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]!.to).toBe("ann@example.com");
    expect(t.sent[0]!.text).toContain("https://wl.example/v1/unsubscribe?token=");
    expect(t.sent[0]!.headers["List-Unsubscribe"]).toMatch(/^<https:\/\/wl\.example\/v1\/unsubscribe\?token=/);
  });

  it("still saves the address when the email cannot be sent, and tries again on the next signup", async () => {
    const t = setup({ failMail: true });
    expect((await t.post({ email: "ann@example.com" })).status).toBe(200);
    await t.drain();
    expect(t.store.list()).toHaveLength(1);
    expect(t.store.list()[0]!.welcomeSentAt).toBeNull();
  });

  it("saves addresses without email when no SMTP is configured", async () => {
    const t = setup({ smtp: false });
    expect((await t.post({ email: "ann@example.com" })).status).toBe(200);
    expect(t.store.list()).toHaveLength(1);
  });

  it("rejects bad addresses and bad JSON", async () => {
    const t = setup();
    expect((await t.post({ email: "nope" })).status).toBe(400);
    expect((await t.post({})).status).toBe(400);
    expect((await t.post("{oops")).status).toBe(400);
    expect(t.store.list()).toHaveLength(0);
  });

  it("ignores bot submissions that fill the hidden field, without telling the bot", async () => {
    const t = setup();
    const res = await t.post({ email: "bot@example.com", website: "http://spam" });
    expect(res.status).toBe(200);
    expect(t.store.list()).toHaveLength(0);
  });

  it("answers CORS preflight and allows only the configured origins", async () => {
    const t = setup();
    const pre = await t.app.request("/v1/sites/pantry/subscribe", { method: "OPTIONS", headers: { origin: ORIGIN } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe(ORIGIN);

    const bad = await t.post({ email: "ann@example.com" }, { origin: "https://evil.example" });
    expect(bad.status).toBe(403);
    expect(t.store.list()).toHaveLength(0);

    expect((await t.post({ email: "ann@example.com" }, {}, "nope")).status).toBe(404);
  });

  it("limits each client, then lets them back in after the window", async () => {
    const t = setup();
    for (let i = 0; i < 5; i++) expect((await t.post({ email: `a${i}@example.com` })).status).toBe(200);
    const blocked = await t.post({ email: "late@example.com" });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    // Another client is not affected.
    expect((await t.post({ email: "b@example.com" }, { "x-ip": "2.2.2.2" })).status).toBe(200);

    t.advance(11 * 60_000);
    expect((await t.post({ email: "late@example.com" })).status).toBe(200);
  });
});

describe("unsubscribe", () => {
  async function subscribed() {
    const t = setup();
    await t.post({ email: "ann@example.com" });
    await t.drain();
    const token = /token=([^\s>]+)/.exec(t.sent[0]!.text)![1]!;
    return { t, token };
  }

  it("needs a POST: opening the link changes nothing", async () => {
    const { t, token } = await subscribed();
    const get = await t.app.request(`/v1/unsubscribe?token=${token}`);
    expect(get.status).toBe(200);
    expect(t.store.list()).toHaveLength(1);

    const post = await t.app.request(`/v1/unsubscribe?token=${token}`, { method: "POST" });
    expect(post.status).toBe(200);
    expect(t.store.list()).toHaveLength(0);
  });

  it("rejects a forged token", async () => {
    const { t, token } = await subscribed();
    const forged = `${token.split(".")[0]}.${"0".repeat(32)}`;
    expect((await t.app.request(`/v1/unsubscribe?token=${forged}`, { method: "POST" })).status).toBe(400);
    expect((await t.app.request("/v1/unsubscribe?token=1", { method: "POST" })).status).toBe(400);
    expect(t.store.list()).toHaveLength(1);
  });

  it("puts a returning address back on the list without a second welcome email", async () => {
    const { t, token } = await subscribed();
    await t.app.request(`/v1/unsubscribe?token=${token}`, { method: "POST" });
    await t.post({ email: "ann@example.com" });
    await t.drain();
    expect(t.store.list()).toHaveLength(1);
    expect(t.sent).toHaveLength(1);
  });
});

describe("config", () => {
  const env = { WAITLIST_SECRET: "0123456789abcdef" };
  const base = { publicUrl: "https://wl.example", sites: { a: { name: "A", origins: [ORIGIN] } } };

  it("refuses a short secret, an origin with a path, and SMTP without a password", () => {
    expect(() => parseConfig(base, { WAITLIST_SECRET: "short" })).toThrow(/WAITLIST_SECRET/);
    expect(() => parseConfig({ ...base, sites: { a: { name: "A", origins: [`${ORIGIN}/`] } } }, env)).toThrow(/origin/);
    expect(() =>
      parseConfig({ ...base, smtp: { host: "h", user: "u", from: "f@x.y" } }, env),
    ).toThrow(/SMTP_PASSWORD/);
  });
});
