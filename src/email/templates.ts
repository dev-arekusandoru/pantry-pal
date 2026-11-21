import type { Email } from "./mailer.js";

/**
 * Transactional emails in the Rakumi look of the waitlist welcome email
 * (landing/worker/index.ts): inline styles and tables only, because email
 * clients ignore most other CSS. Copy follows ASD-STE100: short, active, plain.
 */

const SERIF = "'Kiwi Maru','Hiragino Mincho ProN',Georgia,'Times New Roman',serif";
const ROUND =
  "'Zen Maru Gothic','Hiragino Maru Gothic ProN','Arial Rounded MT Bold',ui-rounded,'Segoe UI',Helvetica,Arial,sans-serif";
const HAND = "'Klee One','Segoe Print','Bradley Hand',cursive";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** "28 November 2026", in UTC so the date does not depend on the server zone. */
export function formatEmailDate(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

interface Layout {
  /** First heading line. */
  title: string;
  /** Second heading line, drawn with the orange wavy underline. */
  accent: string;
  paragraphs: string[];
  button: { label: string; url: string };
  /** Yellow sticky note. */
  note: { title: string; body: string };
  reason: string;
}

function renderHtml(layout: Layout): string {
  const paragraphs = layout.paragraphs
    .map(
      (text) =>
        `<tr><td style="padding:16px 32px 0;font-family:${ROUND};font-size:17px;line-height:1.6;color:#542711;">${escapeHtml(text)}</td></tr>`,
    )
    .join("\n");
  const url = escapeHtml(layout.button.url);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Kiwi+Maru:wght@500&family=Klee+One:wght@400;600&family=Zen+Maru+Gothic:wght@500;700&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:#fbf3df;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fbf3df;">
<tr><td align="center" style="padding:36px 14px;">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;">
<tr><td align="center" style="padding:0;"><img src="https://rakumi.app/raku-email.png" width="120" height="120" alt="Raku, the Rakumi jar mascot" style="display:block;border:0;"></td></tr>
<tr><td align="center" style="padding:0 0 18px;font-family:${SERIF};font-size:30px;color:#542711;">Rakumi</td></tr>
</table>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;">
<tr><td align="center" style="height:22px;font-size:0;line-height:0;">
<span style="display:inline-block;width:84px;height:22px;background:#fddb72;border:1px solid #8a5a3c;border-radius:2px;opacity:.95;">&nbsp;</span>
</td></tr>
<tr><td style="background:#fffcf6;border:1px solid #d3b99b;border-radius:22px;padding:0;box-shadow:0 14px 20px -14px rgba(138,90,60,.55);">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="padding:30px 32px 0;font-family:${SERIF};font-size:32px;line-height:1.2;color:#542711;">
${escapeHtml(layout.title)}<br>
<span style="text-decoration:underline wavy #eb883b;text-decoration-thickness:2px;text-underline-offset:6px;">${escapeHtml(layout.accent)}</span>
</td></tr>
${paragraphs}
<tr><td style="padding:22px 32px 0;">
<a href="${url}" style="display:inline-block;padding:13px 20px;border-radius:14px;background:#542711;color:#fefaf0;font-family:${ROUND};font-weight:700;font-size:16px;text-decoration:none;border-bottom:4px solid #2d1205;">${escapeHtml(layout.button.label)}</a>
</td></tr>
<tr><td style="padding:14px 32px 0;font-family:${ROUND};font-size:13px;line-height:1.5;color:#7f5944;">
The button does not work? Copy this link into your browser:<br>
<a href="${url}" style="color:#7f5944;word-break:break-all;">${url}</a>
</td></tr>
<tr><td style="padding:22px 32px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="background:#fff0c2;border-radius:6px;padding:14px 16px;box-shadow:0 8px 12px -8px rgba(138,90,60,.6);border:1px solid #ecd28f;">
<div style="font-family:${HAND};font-weight:600;font-size:18px;line-height:1.4;color:#542711;">&#9998; ${escapeHtml(layout.note.title)}</div>
<div style="padding-top:4px;font-family:${HAND};font-size:17px;line-height:1.5;color:#542711;">${escapeHtml(layout.note.body)}</div>
</td></tr></table>
</td></tr>
<tr><td style="padding:26px 32px 30px;font-family:${HAND};font-size:18px;line-height:1.4;color:#542711;">
Raku and the Rakumi team
</td></tr>
</table>
</td></tr>
</table>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;">
<tr><td align="center" style="padding:18px 12px 0;font-family:${ROUND};font-size:12px;line-height:1.5;color:#7f5944;">${escapeHtml(layout.reason)}</td></tr>
</table>

</td></tr></table>
</body></html>`;
}

function renderText(layout: Layout): string {
  return [
    `${layout.title} ${layout.accent}`,
    ...layout.paragraphs,
    `${layout.button.label}: ${layout.button.url}`,
    `${layout.note.title} ${layout.note.body}`,
    "Raku and the Rakumi team",
    layout.reason,
  ].join("\n\n");
}

function build(to: string, subject: string, layout: Layout): Email {
  return { to, subject, html: renderHtml(layout), text: renderText(layout) };
}

export function verificationEmail(to: string, url: string): Email {
  return build(to, "Verify your email for Rakumi", {
    title: "Confirm your email.",
    accent: "Then cook with us.",
    paragraphs: [
      "Use the button to confirm your email address.",
      "The link works for 48 hours. You can use it one time.",
    ],
    button: { label: "Verify email", url },
    note: {
      title: "Not you?",
      body: "If you did not create a Rakumi account, ignore this email. Nothing will happen.",
    },
    reason: "You got this email because someone used this address to sign up at Rakumi.",
  });
}

export function passwordResetEmail(to: string, url: string): Email {
  return build(to, "Reset your Rakumi password", {
    title: "Choose a new password.",
    accent: "It takes a minute.",
    paragraphs: [
      "Use the button to set a new password for Rakumi.",
      "The link works for 1 hour. You can use it one time.",
    ],
    button: { label: "Reset password", url },
    note: {
      title: "Not you?",
      body: "If you did not ask for this, ignore this email. Your password does not change.",
    },
    reason: "You got this email because someone asked to reset the password for this address at Rakumi.",
  });
}

/**
 * `daysLeft` is 7 for the day-23 notice and 1 for the day-29 notice.
 * `neverSubscribed`: the account never started a trial, so the email invites
 * them to start one instead of talking about a lapsed plan.
 */
export function deletionWarningEmail(
  to: string,
  url: string,
  deleteAt: Date,
  daysLeft: number,
  neverSubscribed = false,
): Email {
  const date = formatEmailDate(deleteAt);
  const last = daysLeft <= 1;
  const subject = neverSubscribed
    ? last
      ? "Last chance: start your free Rakumi trial before tomorrow"
      : `Your Rakumi account closes on ${date}`
    : last
      ? "Last notice: Rakumi will delete your data tomorrow"
      : `Rakumi will delete your data on ${date}`;
  return build(to, subject, {
    title: neverSubscribed
      ? last ? "Last chance." : "Your pantry is waiting."
      : last ? "Last notice." : "Your plan is not active.",
    accent: neverSubscribed
      ? last ? "Your account closes tomorrow." : `Your account closes in ${daysLeft} days.`
      : last ? "Your data goes tomorrow." : `Your data goes in ${daysLeft} days.`,
    paragraphs: neverSubscribed
      ? [
          "You made a Rakumi account but did not start your free trial yet.",
          "Start it now: 14 days free, then pick monthly or yearly. Plan the week, shop once, and cook together.",
          `If you do not start a trial, we close the account and delete it on ${date}.`,
        ]
      : [
          `Your Rakumi household is locked. We will delete it, and all its data, on ${date}.`,
          "To keep your data, start a plan. Your household opens again at once.",
        ],
    button: { label: neverSubscribed ? "Start my free trial" : "Open Rakumi", url },
    note: neverSubscribed
      ? { title: "No charge for 14 days.", body: "Cancel any time before day 14 and you pay nothing." }
      : { title: "Cannot undo.", body: "We cannot restore a household after we delete it." },
    reason: neverSubscribed
      ? "You got this email because you made a Rakumi account with this address."
      : "You got this email because the Rakumi household for this address has no active plan.",
  });
}
