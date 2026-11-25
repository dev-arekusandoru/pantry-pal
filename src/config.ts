/**
 * Hosted-version configuration (email and billing), read from the environment.
 *
 * Both features are off by default, so a self-hosted instance behaves as before.
 * `loadHostedConfig` is the only place that reads these variables.
 */

export interface SmtpConfig {
  host: string;
  port: number;
  user: string | null;
  password: string | null;
  from: string;
}

export interface PolarConfig {
  server: "production" | "sandbox";
  accessToken: string;
  webhookSecret: string;
  productMonthly: string;
  productYearly: string;
}

export interface HostedConfig {
  /** Public base URL without a trailing slash. Set when email or billing is on. */
  publicUrl: string | null;
  /** Set when `PANTRYPAL_SMTP_HOST` is set (email on). */
  smtp: SmtpConfig | null;
  /** Set when `PANTRYPAL_BILLING=polar`. */
  polar: PolarConfig | null;
  /** Address the app shows as "Contact support"; null hides the link. */
  supportEmail: string | null;
}

/** A bad combination of settings; the message tells the operator what to fix. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

type Env = Record<string, string | undefined>;

function read(env: Env, name: string): string | null {
  const value = env[name]?.trim();
  return value === undefined || value === "" ? null : value;
}

function normalizePublicUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError(`PANTRYPAL_PUBLIC_URL is not a valid URL: ${raw}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ConfigError("PANTRYPAL_PUBLIC_URL must start with https:// (or http:// for local tests).");
  }
  return raw.replace(/\/+$/, "");
}

/** Parse and validate the hosted settings. Throws {@link ConfigError} on bad input. */
export function loadHostedConfig(env: Env = process.env): HostedConfig {
  const rawPublicUrl = read(env, "PANTRYPAL_PUBLIC_URL");
  const publicUrl = rawPublicUrl === null ? null : normalizePublicUrl(rawPublicUrl);

  const smtpHost = read(env, "PANTRYPAL_SMTP_HOST");
  let smtp: SmtpConfig | null = null;
  if (smtpHost !== null) {
    const rawPort = read(env, "PANTRYPAL_SMTP_PORT") ?? "465";
    const port = Number(rawPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new ConfigError(`PANTRYPAL_SMTP_PORT is not a valid port: ${rawPort}`);
    }
    const from = read(env, "PANTRYPAL_SMTP_FROM");
    if (from === null) {
      throw new ConfigError("PANTRYPAL_SMTP_FROM is required when PANTRYPAL_SMTP_HOST is set.");
    }
    smtp = {
      host: smtpHost,
      port,
      user: read(env, "PANTRYPAL_SMTP_USER"),
      password: read(env, "PANTRYPAL_SMTP_PASSWORD"),
      from,
    };
  }

  const billingMode = (read(env, "PANTRYPAL_BILLING") ?? "off").toLowerCase();
  if (billingMode !== "off" && billingMode !== "polar") {
    throw new ConfigError(`PANTRYPAL_BILLING must be "off" or "polar", not "${billingMode}".`);
  }

  let polar: PolarConfig | null = null;
  if (billingMode === "polar") {
    const missing: string[] = [];
    if (smtp === null) missing.push("PANTRYPAL_SMTP_HOST (email must be on)");
    if (publicUrl === null) missing.push("PANTRYPAL_PUBLIC_URL");
    const accessToken = read(env, "POLAR_ACCESS_TOKEN");
    const webhookSecret = read(env, "POLAR_WEBHOOK_SECRET");
    const productMonthly = read(env, "POLAR_PRODUCT_MONTHLY");
    const productYearly = read(env, "POLAR_PRODUCT_YEARLY");
    if (accessToken === null) missing.push("POLAR_ACCESS_TOKEN");
    if (webhookSecret === null) missing.push("POLAR_WEBHOOK_SECRET");
    if (productMonthly === null) missing.push("POLAR_PRODUCT_MONTHLY");
    if (productYearly === null) missing.push("POLAR_PRODUCT_YEARLY");
    if (missing.length > 0) {
      throw new ConfigError(`PANTRYPAL_BILLING=polar needs these settings: ${missing.join(", ")}.`);
    }

    const server = (read(env, "POLAR_SERVER") ?? "production").toLowerCase();
    if (server !== "production" && server !== "sandbox") {
      throw new ConfigError(`POLAR_SERVER must be "production" or "sandbox", not "${server}".`);
    }
    polar = {
      server,
      accessToken: accessToken!,
      webhookSecret: webhookSecret!,
      productMonthly: productMonthly!,
      productYearly: productYearly!,
    };
  }

  if (smtp !== null && publicUrl === null) {
    throw new ConfigError("PANTRYPAL_PUBLIC_URL is required when PANTRYPAL_SMTP_HOST is set (email links need it).");
  }

  const supportEmail = read(env, "PANTRYPAL_SUPPORT_EMAIL");
  if (supportEmail !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail)) {
    throw new ConfigError(`PANTRYPAL_SUPPORT_EMAIL is not a valid email address: ${supportEmail}`);
  }

  return { publicUrl, smtp, polar, supportEmail };
}

/** Whether email is on, without validating the rest (CLI commands use this). */
export function emailEnabled(env: Env = process.env): boolean {
  return read(env, "PANTRYPAL_SMTP_HOST") !== null;
}

/** Whether billing is on, without validating the rest (CLI commands use this). */
export function billingEnabled(env: Env = process.env): boolean {
  return (read(env, "PANTRYPAL_BILLING") ?? "off").toLowerCase() === "polar";
}
