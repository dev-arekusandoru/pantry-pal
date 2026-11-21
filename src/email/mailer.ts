import nodemailer from "nodemailer";
import type { SmtpConfig } from "../config.js";

export interface Email {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Sends one email. Tests use an in-memory fake; the server uses {@link createSmtpMailer}. */
export interface Mailer {
  send(email: Email): Promise<void>;
}

/** SMTP sender. Port 465 uses implicit TLS; other ports upgrade with STARTTLS. */
export function createSmtpMailer(config: SmtpConfig): Mailer {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    ...(config.user === null ? {} : { auth: { user: config.user, pass: config.password ?? "" } }),
  });
  return {
    async send(email) {
      await transport.sendMail({
        from: config.from,
        to: email.to,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });
    },
  };
}

/**
 * Send without waiting and without failing the caller. A slow or broken mail
 * server must not delay or break signup, and an awaited send would also let a
 * timing difference reveal whether an account exists.
 */
export function sendInBackground(mailer: Mailer, email: Email): void {
  mailer.send(email).catch((error: unknown) => {
    console.error("[pantrypal] email send failed:", error instanceof Error ? error.message : error);
  });
}
