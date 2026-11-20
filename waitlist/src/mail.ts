import { createTransport } from "nodemailer";
import type { SmtpConfig } from "./config.js";

export interface Mail {
  to: string;
  subject: string;
  text: string;
  /** Extra headers, such as `List-Unsubscribe`. */
  headers: Record<string, string>;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

export function smtpMailer(config: SmtpConfig): Mailer {
  const transport = createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    connectionTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return {
    async send(mail) {
      await transport.sendMail({ from: config.from, ...mail });
    },
  };
}
