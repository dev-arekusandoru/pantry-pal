import type { AccessPolicy } from "./access.js";
import { Billing } from "./billing/service.js";
import type { HostedConfig } from "./config.js";
import { createSmtpMailer, type Mailer } from "./email/mailer.js";

/** Runtime services of the hosted version. All null = self-host: nothing changes. */
export interface Hosted {
  /** Public base URL without a trailing slash; set when email or billing is on. */
  publicUrl: string | null;
  /** Set when email is on. */
  mailer: Mailer | null;
  /** Set when billing is on. */
  billing: Billing | null;
  /** Address the app shows as "Contact support"; null hides the link. */
  supportEmail: string | null;
}

export const SELF_HOST: Hosted = { publicUrl: null, mailer: null, billing: null, supportEmail: null };

export function accessPolicy(hosted: Hosted): AccessPolicy {
  return { emailOn: hosted.mailer !== null, billingOn: hosted.billing !== null };
}

/** Build the services for a validated config. */
export function createHosted(config: HostedConfig, now?: () => Date): Hosted {
  const mailer = config.smtp === null ? null : createSmtpMailer(config.smtp);
  const billing =
    config.polar === null || config.publicUrl === null
      ? null
      : new Billing({ config: config.polar, publicUrl: config.publicUrl, ...(now ? { now } : {}) });
  return { publicUrl: config.publicUrl, mailer, billing, supportEmail: config.supportEmail };
}
