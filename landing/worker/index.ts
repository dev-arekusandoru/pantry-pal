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
  /** Sender of the welcome email, on a domain verified in Resend. */
  WELCOME_FROM: string;
}

const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

interface Ctx {
  waitUntil(promise: Promise<unknown>): void;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const WELCOME_TEXT =
  "Thanks for joining the Rakumi waitlist.\n\nWe will email you once when Rakumi opens. Nothing else until then.\n\nRaku and the Rakumi team";

// Inline styles and tables only: email clients ignore most other CSS. Web fonts
// load in clients that allow them (Apple Mail); the rest use the fallbacks.
const WELCOME_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Kiwi+Maru:wght@500&family=Klee+One:wght@400;600&family=Zen+Maru+Gothic:wght@500;700&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:#fbf3df;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fbf3df;">
<tr><td align="center" style="padding:36px 14px;">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;">
<tr><td align="center" style="padding:0;"><img src="https://rakumi.app/raku-email.png" width="120" height="120" alt="Raku, the Rakumi jar mascot" style="display:block;border:0;"></td></tr>
<tr><td align="center" style="padding:0 0 10px;font-family:'Kiwi Maru','Hiragino Mincho ProN',Georgia,'Times New Roman',serif;font-size:30px;color:#542711;">Rakumi</td></tr>
<tr><td align="center" style="padding:0 0 18px;">
<span style="display:inline-block;padding:5px 14px;border-radius:6px;background:#542711;color:#fefaf0;font-family:'Klee One','Segoe Print','Bradley Hand',cursive;font-weight:600;font-size:16px;">Dinner, figured out.</span>
</td></tr>
</table>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;">
<tr><td align="center" style="height:22px;font-size:0;line-height:0;">
<span style="display:inline-block;width:84px;height:22px;background:#fddb72;border:1px solid #8a5a3c;border-radius:2px;opacity:.95;">&nbsp;</span>
</td></tr>
<tr><td style="background:#fffcf6;border:1px solid #d3b99b;border-radius:22px;padding:0;box-shadow:0 14px 20px -14px rgba(138,90,60,.55);">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="padding:30px 32px 0;font-family:'Kiwi Maru','Hiragino Mincho ProN',Georgia,'Times New Roman',serif;font-size:34px;line-height:1.2;color:#542711;">
You're on the list.<br>
<span style="text-decoration:underline wavy #eb883b;text-decoration-thickness:2px;text-underline-offset:6px;">See you at dinner.</span>
</td></tr>
<tr><td style="padding:20px 32px 0;font-family:'Zen Maru Gothic','Hiragino Maru Gothic ProN','Arial Rounded MT Bold',ui-rounded,'Segoe UI',Helvetica,Arial,sans-serif;font-size:17px;line-height:1.6;color:#542711;">
Thanks for joining the Rakumi waitlist. Plan the week, shop once, and cook together, all in one cozy place.
</td></tr>
<tr><td style="padding:18px 32px 0;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="padding:0 6px 6px 0;"><span style="display:inline-block;padding:5px 11px;border-radius:999px;background:#fff0c2;border:1px solid #e0c58a;font-family:'Zen Maru Gothic','Hiragino Maru Gothic ProN','Arial Rounded MT Bold',ui-rounded,'Segoe UI',Helvetica,Arial,sans-serif;font-weight:700;font-size:14px;color:#542711;">Meals</span></td>
<td style="padding:0 6px 6px 0;"><span style="display:inline-block;padding:5px 11px;border-radius:999px;background:#d9f6dc;border:1px solid #9fd3a6;font-family:'Zen Maru Gothic','Hiragino Maru Gothic ProN','Arial Rounded MT Bold',ui-rounded,'Segoe UI',Helvetica,Arial,sans-serif;font-weight:700;font-size:14px;color:#542711;">Pantry</span></td>
<td style="padding:0 6px 6px 0;"><span style="display:inline-block;padding:5px 11px;border-radius:999px;background:#fee8ec;border:1px solid #e8b3bf;font-family:'Zen Maru Gothic','Hiragino Maru Gothic ProN','Arial Rounded MT Bold',ui-rounded,'Segoe UI',Helvetica,Arial,sans-serif;font-weight:700;font-size:14px;color:#542711;">Recipes</span></td>
<td style="padding:0 0 6px 0;"><span style="display:inline-block;padding:5px 11px;border-radius:999px;background:#d7efff;border:1px solid #9cc7e3;font-family:'Zen Maru Gothic','Hiragino Maru Gothic ProN','Arial Rounded MT Bold',ui-rounded,'Segoe UI',Helvetica,Arial,sans-serif;font-weight:700;font-size:14px;color:#542711;">Groceries</span></td>
</tr></table>
</td></tr>
<tr><td style="padding:14px 32px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="background:#fff0c2;border-radius:6px;padding:14px 16px;box-shadow:0 8px 12px -8px rgba(138,90,60,.6);border:1px solid #ecd28f;">
<div style="font-family:'Klee One','Segoe Print','Bradley Hand',cursive;font-weight:600;font-size:18px;line-height:1.4;color:#542711;">&#9998; What happens next</div>
<div style="padding-top:4px;font-family:'Klee One','Segoe Print','Bradley Hand',cursive;font-size:17px;line-height:1.5;color:#542711;">We will email you <b>once</b>, when Rakumi opens. Your first 14 days are free. Nothing else until then.</div>
</td></tr></table>
</td></tr>
<tr><td style="padding:22px 32px 0;font-family:'Zen Maru Gothic','Hiragino Maru Gothic ProN','Arial Rounded MT Bold',ui-rounded,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#7f5944;">
Curious while you wait? The code is open for anyone to read.
</td></tr>
<tr><td style="padding:12px 32px 0;">
<a href="https://github.com/dev-arekusandoru/pantry-pal" style="display:inline-block;padding:13px 20px;border-radius:14px;background:#542711;color:#fefaf0;font-family:'Zen Maru Gothic','Hiragino Maru Gothic ProN','Arial Rounded MT Bold',ui-rounded,'Segoe UI',Helvetica,Arial,sans-serif;font-weight:700;font-size:16px;text-decoration:none;border-bottom:4px solid #2d1205;">&#9733; Star on GitHub</a>
</td></tr>
<tr><td style="padding:26px 32px 30px;font-family:'Klee One','Segoe Print','Bradley Hand',cursive;font-size:18px;line-height:1.4;color:#542711;">
Raku and the Rakumi team
</td></tr>
</table>
</td></tr>
</table>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;">
<tr><td align="center" style="padding:18px 12px 0;font-family:'Zen Maru Gothic','Hiragino Maru Gothic ProN','Arial Rounded MT Bold',ui-rounded,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#7f5944;">You got this email because you joined the waitlist at rakumi.app.</td></tr>
</table>

</td></tr></table>
</body></html>`;

// One welcome email per new address. Best effort: a failure is logged, never shown.
const sendWelcome = async (env: Env, email: string) => {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.WELCOME_FROM,
      to: [email],
      subject: "You're on the Rakumi waitlist",
      html: WELCOME_HTML,
      text: WELCOME_TEXT,
    }),
  });
  if (!response.ok) console.error(`Welcome email ${response.status}: ${await response.text()}`);
};

export default {
  async fetch(request: Request, env: Env, ctx: Ctx): Promise<Response> {
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
    if (response.ok) {
      ctx.waitUntil(sendWelcome(env, email));
      return json({ ok: true }, 200, cors);
    }

    // A repeat signup is fine. Anything else is our problem, not the visitor's.
    const detail = await response.text();
    if (response.status < 500 && /already|exist/i.test(detail)) return json({ ok: true }, 200, cors);
    console.error(`Resend ${response.status}: ${detail}`);
    return json({ error: "upstream" }, 502, cors);
  },
};
