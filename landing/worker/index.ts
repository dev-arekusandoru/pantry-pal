// Cloudflare Worker: takes a waitlist signup from the landing page and adds the
// address to Resend as a contact. It holds the Resend API key so the page never
// sees it. Setup: docs/host/waitlist.md.

interface Env {
  /** Secret: Resend API key. Set with `wrangler secret put RESEND_API_KEY`. */
  RESEND_API_KEY: string;
  /** Comma-separated page origins that may post, e.g. `https://example.com`. */
  ALLOWED_ORIGINS: string;
  /** Optional: add each contact to this Resend segment. */
  RESEND_SEGMENT_ID?: string;
}

const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const allowed = env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean);
    const origin = request.headers.get("Origin") ?? "";
    if (!allowed.includes(origin)) return json({ error: "origin_not_allowed" }, 403);
    const cors = { "Access-Control-Allow-Origin": origin, Vary: "Origin" };

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: { ...cors, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type" },
      });
    }
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, cors);

    const text = await request.text();
    if (text.length > 2048) return json({ error: "too_large" }, 413, cors);
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return json({ error: "invalid_json" }, 400, cors);
    }

    // Hidden field that people leave empty and bots fill in. Pretend it worked.
    if (typeof body.website === "string" && body.website !== "") return json({ ok: true }, 200, cors);

    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (email.length > 254 || !EMAIL.test(email)) return json({ error: "invalid_email" }, 400, cors);

    const response = await fetch("https://api.resend.com/contacts", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        unsubscribed: false,
        ...(env.RESEND_SEGMENT_ID ? { segments: [{ id: env.RESEND_SEGMENT_ID }] } : {}),
      }),
    });
    if (response.ok) return json({ ok: true }, 200, cors);

    // A repeat signup is fine. Anything else is our problem, not the visitor's.
    const detail = await response.text();
    if (response.status < 500 && /already|exist/i.test(detail)) return json({ ok: true }, 200, cors);
    console.error(`Resend ${response.status}: ${detail}`);
    return json({ error: "upstream" }, 502, cors);
  },
};
