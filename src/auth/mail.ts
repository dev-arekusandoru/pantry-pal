import type { Db } from "../db/client.js";
import { sendInBackground } from "../email/mailer.js";
import { passwordResetEmail, verificationEmail } from "../email/templates.js";
import type { Hosted } from "../hosted.js";
import type { Account } from "./accounts.js";
import { issueEmailToken } from "./emailTokens.js";

/** Issue a verification token and email the link. No-op when email is off. Never throws on mail errors. */
export function sendVerificationLink(db: Db, hosted: Hosted, account: Account, now: Date): void {
  if (hosted.mailer === null || hosted.publicUrl === null) return;
  const token = issueEmailToken(db, account.id, "verify", now);
  const url = `${hosted.publicUrl}/verify-email?token=${encodeURIComponent(token)}`;
  sendInBackground(hosted.mailer, verificationEmail(account.email, url));
}

/** Issue a reset token (voiding older ones) and email the link. No-op when email is off. */
export function sendResetLink(db: Db, hosted: Hosted, account: Account, now: Date): void {
  if (hosted.mailer === null || hosted.publicUrl === null) return;
  const token = issueEmailToken(db, account.id, "reset", now);
  const url = `${hosted.publicUrl}/reset-password?token=${encodeURIComponent(token)}`;
  sendInBackground(hosted.mailer, passwordResetEmail(account.email, url));
}
