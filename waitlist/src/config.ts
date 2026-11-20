import { readFileSync } from "node:fs";

export interface SiteConfig {
  /** Name used in the welcome email. */
  name: string;
  /** Browser origins allowed to post to this site's endpoint, e.g. `https://example.com`. */
  origins: string[];
  /** Welcome email. `{{name}}` and `{{unsubscribeUrl}}` are replaced. */
  welcome: { subject: string; text: string };
}

export interface SmtpConfig {
  host: string;
  port: number;
  /** TLS from the first byte (port 465). Default false (STARTTLS). */
  secure: boolean;
  user: string;
  password: string;
  /** From header, e.g. `PantryPal <hello@example.com>`. */
  from: string;
}

export interface Config {
  /** Public base URL of this service. Used for unsubscribe links. */
  publicUrl: string;
  /** Key for signing unsubscribe links. */
  secret: string;
  /** Request header that holds the client IP behind a proxy, e.g. `cf-connecting-ip`. Unset = socket address. */
  trustedIpHeader: string | undefined;
  /** Unset = no email is sent. */
  smtp: SmtpConfig | undefined;
  sites: Record<string, SiteConfig>;
}

export const DEFAULT_WELCOME = {
  subject: "You're on the {{name}} waitlist",
  text: [
    "Thanks for joining the {{name}} waitlist.",
    "",
    "We'll send you one email when there is room for you. There is nothing else you need to do.",
    "",
    "You did not sign up? Ignore this email, or remove your address here:",
    "{{unsubscribeUrl}}",
    "",
  ].join("\n"),
};

const SITE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function fail(message: string): never {
  throw new Error(`waitlist config: ${message}`);
}

function str(value: unknown, where: string): string {
  if (typeof value !== "string" || value.trim() === "") fail(`${where} must be a non-empty string`);
  return value.trim();
}

/** Parse the JSON config file plus secrets from the environment. */
export function parseConfig(raw: unknown, env: Record<string, string | undefined>): Config {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) fail("the file must hold a JSON object");
  const file = raw as Record<string, unknown>;

  const secret = env.WAITLIST_SECRET ?? "";
  if (secret.length < 16) fail("set WAITLIST_SECRET to a random string of at least 16 characters");

  const publicUrl = str(file.publicUrl, "publicUrl").replace(/\/+$/, "");
  try {
    new URL(publicUrl);
  } catch {
    fail("publicUrl must be a full URL");
  }

  let smtp: SmtpConfig | undefined;
  if (file.smtp !== undefined) {
    const s = file.smtp as Record<string, unknown>;
    const password = env.SMTP_PASSWORD ?? "";
    if (password === "") fail("set SMTP_PASSWORD in the environment when smtp is configured");
    smtp = {
      host: str(s.host, "smtp.host"),
      port: typeof s.port === "number" ? s.port : 587,
      secure: s.secure === true,
      user: str(s.user, "smtp.user"),
      password,
      from: str(s.from, "smtp.from"),
    };
  }

  if (typeof file.sites !== "object" || file.sites === null) fail("sites must be an object");
  const sites: Record<string, SiteConfig> = {};
  for (const [id, value] of Object.entries(file.sites)) {
    if (!SITE_ID.test(id)) fail(`site id "${id}" must be lowercase letters, digits, and hyphens`);
    const s = value as Record<string, unknown>;
    if (!Array.isArray(s.origins) || s.origins.length === 0) fail(`sites.${id}.origins must list at least one origin`);
    const origins = s.origins.map((o, i) => {
      const origin = str(o, `sites.${id}.origins[${i}]`);
      try {
        const url = new URL(origin);
        if (url.origin !== origin) throw new Error();
      } catch {
        fail(`sites.${id}.origins[${i}] must be an origin like https://example.com (no path, no trailing slash)`);
      }
      return origin;
    });
    const welcome = (s.welcome ?? DEFAULT_WELCOME) as Record<string, unknown>;
    sites[id] = {
      name: str(s.name, `sites.${id}.name`),
      origins,
      welcome: {
        subject: str(welcome.subject ?? DEFAULT_WELCOME.subject, `sites.${id}.welcome.subject`),
        text: str(welcome.text ?? DEFAULT_WELCOME.text, `sites.${id}.welcome.text`),
      },
    };
  }
  if (Object.keys(sites).length === 0) fail("define at least one site");

  const header = typeof file.trustedIpHeader === "string" ? file.trustedIpHeader.trim().toLowerCase() : "";
  return { publicUrl, secret, trustedIpHeader: header === "" ? undefined : header, smtp, sites };
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const path = env.WAITLIST_CONFIG ?? "waitlist.config.json";
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    fail(`cannot read ${path}. Set WAITLIST_CONFIG to the file path`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    fail(`${path} is not valid JSON (${(error as Error).message})`);
  }
  return parseConfig(raw, env);
}
