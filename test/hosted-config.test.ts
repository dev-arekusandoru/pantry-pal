import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { billingEnabled, ConfigError, emailEnabled, loadHostedConfig } from "../src/config.js";

const SMTP = {
  PANTRYPAL_PUBLIC_URL: "https://app.rakumi.app/",
  PANTRYPAL_SMTP_HOST: "smtp.resend.com",
  PANTRYPAL_SMTP_USER: "resend",
  PANTRYPAL_SMTP_PASSWORD: "re_key",
  PANTRYPAL_SMTP_FROM: "Rakumi <hello@rakumi.app>",
};
const POLAR = {
  PANTRYPAL_BILLING: "polar",
  POLAR_ACCESS_TOKEN: "polar_oat_x",
  POLAR_WEBHOOK_SECRET: "whsec_x",
  POLAR_PRODUCT_MONTHLY: "m",
  POLAR_PRODUCT_YEARLY: "y",
};

describe("hosted config", () => {
  it("is all off by default", () => {
    expect(loadHostedConfig({})).toEqual({ publicUrl: null, smtp: null, polar: null, supportEmail: null });
    expect(emailEnabled({})).toBe(false);
    expect(billingEnabled({})).toBe(false);
  });

  it("turns email on with the SMTP host, defaulting to port 465, and trims the public URL", () => {
    const config = loadHostedConfig(SMTP);
    expect(config.publicUrl).toBe("https://app.rakumi.app");
    expect(config.smtp).toEqual({
      host: "smtp.resend.com",
      port: 465,
      user: "resend",
      password: "re_key",
      from: "Rakumi <hello@rakumi.app>",
    });
    expect(config.polar).toBeNull();
  });

  it("turns billing on with email, public URL and the Polar settings", () => {
    const config = loadHostedConfig({ ...SMTP, ...POLAR });
    expect(config.polar).toEqual({
      server: "production",
      accessToken: "polar_oat_x",
      webhookSecret: "whsec_x",
      productMonthly: "m",
      productYearly: "y",
    });
    expect(loadHostedConfig({ ...SMTP, ...POLAR, POLAR_SERVER: "sandbox" }).polar?.server).toBe("sandbox");
  });

  it("fails fast on bad combinations", () => {
    expect(() => loadHostedConfig({ ...POLAR })).toThrow(/PANTRYPAL_SMTP_HOST[\s\S]*PANTRYPAL_PUBLIC_URL/);
    expect(() => loadHostedConfig({ ...SMTP, ...POLAR, POLAR_ACCESS_TOKEN: "" })).toThrow(/POLAR_ACCESS_TOKEN/);
    expect(() => loadHostedConfig({ ...SMTP, ...POLAR, POLAR_PRODUCT_YEARLY: undefined })).toThrow(/POLAR_PRODUCT_YEARLY/);
    expect(() => loadHostedConfig({ ...SMTP, PANTRYPAL_PUBLIC_URL: undefined })).toThrow(/PANTRYPAL_PUBLIC_URL/);
    expect(() => loadHostedConfig({ ...SMTP, PANTRYPAL_SMTP_FROM: undefined })).toThrow(/PANTRYPAL_SMTP_FROM/);
    expect(() => loadHostedConfig({ ...SMTP, PANTRYPAL_SMTP_PORT: "abc" })).toThrow(/PANTRYPAL_SMTP_PORT/);
    expect(() => loadHostedConfig({ ...SMTP, PANTRYPAL_BILLING: "stripe" })).toThrow(/PANTRYPAL_BILLING/);
    expect(() => loadHostedConfig({ ...SMTP, ...POLAR, POLAR_SERVER: "staging" })).toThrow(/POLAR_SERVER/);
    expect(() => loadHostedConfig({ ...SMTP, PANTRYPAL_PUBLIC_URL: "not a url" })).toThrow(ConfigError);
    expect(() => loadHostedConfig({ PANTRYPAL_SUPPORT_EMAIL: "support" })).toThrow(/PANTRYPAL_SUPPORT_EMAIL/);
  });

  it("reads the support email on its own, without email or billing", () => {
    expect(loadHostedConfig({ PANTRYPAL_SUPPORT_EMAIL: "support@rakumi.app" }).supportEmail).toBe("support@rakumi.app");
  });
});

describe("migration 0009", () => {
  it("marks existing accounts verified at their creation time", () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE account (id text PRIMARY KEY NOT NULL, email text NOT NULL, created_at text NOT NULL);
      CREATE TABLE household (id text PRIMARY KEY NOT NULL);
      INSERT INTO household VALUES ('hh_1');
      INSERT INTO account VALUES ('acc_1', 'a@b.co', '2026-01-02T03:04:05.000Z');`);
    const sql = readFileSync(new URL("../drizzle/0009_hosted_billing_email.sql", import.meta.url), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      if (statement.trim() !== "") db.exec(statement);
    }
    expect(db.prepare("select email_verified_at as v from account").get()).toEqual({ v: "2026-01-02T03:04:05.000Z" });
  });
});
