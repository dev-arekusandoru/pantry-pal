import { createHmac, timingSafeEqual } from "node:crypto";
import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Config, SiteConfig } from "./config.js";
import { normalizeEmail, type Store } from "./db.js";
import type { Mailer } from "./mail.js";

/** Subscribe attempts allowed per client inside one window. */
const LIMIT = 5;
const WINDOW_MS = 10 * 60_000;
const MAX_BUCKETS = 4096;

export interface AppOptions {
  config: Config;
  store: Store;
  /** Unset = no email is sent. */
  mailer?: Mailer | undefined;
  now?: () => Date;
}

export interface WaitlistApp {
  app: Hono;
  /** Resolves when every welcome email in flight has finished (tests, shutdown). */
  drain(): Promise<void>;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
  `<meta name="robots" content="noindex"><title>${escapeHtml(title)}</title>` +
  `<body style="font:18px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#542711;background:#fbf3df">` +
  `<h1 style="font-size:1.5rem">${escapeHtml(title)}</h1>${body}</body></html>`;

export function createApp({ config, store, mailer, now = () => new Date() }: AppOptions): WaitlistApp {
  const app = new Hono();
  const pending = new Set<Promise<void>>();
  const buckets = new Map<string, { count: number; resetAt: number }>();

  const sign = (id: number) => createHmac("sha256", config.secret).update(`unsubscribe:${id}`).digest("hex").slice(0, 32);
  const tokenFor = (id: number) => `${id}.${sign(id)}`;
  const unsubscribeUrl = (id: number) => `${config.publicUrl}/v1/unsubscribe?token=${tokenFor(id)}`;

  function subscriberFromToken(token: string | undefined) {
    const [idPart, mac] = (token ?? "").split(".");
    const id = Number(idPart);
    if (!Number.isInteger(id) || id < 1 || mac === undefined) return undefined;
    const expected = Buffer.from(sign(id));
    const given = Buffer.from(mac);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return undefined;
    return store.get(id);
  }

  /** Behind a proxy the socket address is the proxy, so the configured header decides. */
  function clientKey(c: Context): string {
    if (config.trustedIpHeader !== undefined) {
      const value = c.req.header(config.trustedIpHeader)?.split(",")[0]?.trim();
      if (value) return value;
    }
    try {
      return getConnInfo(c).remote.address ?? "unknown";
    } catch {
      return "unknown";
    }
  }

  /** Returns seconds to wait when the client is over the limit, else records the attempt. */
  function throttle(key: string): number | null {
    const at = now().getTime();
    let bucket = buckets.get(key);
    if (bucket === undefined || bucket.resetAt <= at) {
      if (bucket === undefined && buckets.size >= MAX_BUCKETS) {
        const oldest = buckets.keys().next();
        if (!oldest.done) buckets.delete(oldest.value);
      }
      bucket = { count: 0, resetAt: at + WINDOW_MS };
      buckets.set(key, bucket);
    }
    if (bucket.count >= LIMIT) return Math.max(1, Math.ceil((bucket.resetAt - at) / 1000));
    bucket.count += 1;
    return null;
  }

  function sendWelcome(site: SiteConfig, id: number, to: string): void {
    if (mailer === undefined) return;
    const fill = (t: string) => t.replaceAll("{{name}}", site.name).replaceAll("{{unsubscribeUrl}}", unsubscribeUrl(id));
    const task = mailer
      .send({
        to,
        subject: fill(site.welcome.subject),
        text: fill(site.welcome.text),
        headers: {
          "List-Unsubscribe": `<${unsubscribeUrl(id)}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      })
      .then(() => store.markWelcomeSent(id, now()))
      .catch((error: unknown) => {
        console.error(`[waitlist] welcome email to subscriber ${id} failed:`, error instanceof Error ? error.message : error);
      })
      .finally(() => pending.delete(task));
    pending.add(task);
  }

  app.get("/health", (c) => c.json({ ok: true }));

  // CORS per site. This keeps other websites' scripts out of a browser; it is not authentication.
  app.use("/v1/sites/:site/subscribe", async (c, next) => {
    const site = config.sites[c.req.param("site")];
    if (site === undefined) return c.json({ error: "unknown_site" }, 404);
    const origin = c.req.header("origin");
    if (origin !== undefined) {
      if (!site.origins.includes(origin)) return c.json({ error: "origin_not_allowed" }, 403);
      c.header("Access-Control-Allow-Origin", origin);
      c.header("Vary", "Origin");
    }
    if (c.req.method === "OPTIONS") {
      c.header("Access-Control-Allow-Methods", "POST");
      c.header("Access-Control-Allow-Headers", "Content-Type");
      c.header("Access-Control-Max-Age", "86400");
      return c.body(null, 204);
    }
    await next();
  });

  app.post("/v1/sites/:site/subscribe", bodyLimit({ maxSize: 2048, onError: (c) => c.json({ error: "too_large" }, 413) }), async (c) => {
    const siteId = c.req.param("site");
    const site = config.sites[siteId]!;

    const wait = throttle(clientKey(c));
    if (wait !== null) {
      c.header("Retry-After", String(wait));
      return c.json({ error: "rate_limited" }, 429);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const fields = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};

    // Hidden field that people leave empty and bots fill in. Pretend it worked.
    if (typeof fields.website === "string" && fields.website !== "") return c.json({ ok: true });

    const email = normalizeEmail(fields.email);
    if (email === null) return c.json({ error: "invalid_email" }, 400);

    const subscriber = store.add(siteId, email, now());
    // Send once per address, so the form cannot be used to mail someone repeatedly.
    if (subscriber.welcomeSentAt === null) sendWelcome(site, subscriber.id, email);
    return c.json({ ok: true });
  });

  // A mail scanner may open links, so GET only shows a button. POST does the change
  // (and answers mail clients that use one-click unsubscribe).
  app.get("/v1/unsubscribe", (c) => {
    const subscriber = subscriberFromToken(c.req.query("token"));
    if (subscriber === undefined) return c.html(page("Link not valid", "<p>This link is not valid.</p>"), 400);
    const site = config.sites[subscriber.site];
    return c.html(
      page(
        "Unsubscribe",
        `<p>Remove ${escapeHtml(subscriber.email)} from the ${escapeHtml(site?.name ?? "waitlist")} waitlist?</p>` +
          `<form method="post"><button type="submit" style="font:inherit;padding:.5rem 1rem">Unsubscribe</button></form>`,
      ),
    );
  });

  app.post("/v1/unsubscribe", (c) => {
    const subscriber = subscriberFromToken(c.req.query("token"));
    if (subscriber === undefined) return c.html(page("Link not valid", "<p>This link is not valid.</p>"), 400);
    store.unsubscribe(subscriber.id, now());
    return c.html(page("You are unsubscribed", "<p>We removed your address. You will get no more email from us.</p>"));
  });

  return { app, drain: async () => void (await Promise.all([...pending])) };
}
