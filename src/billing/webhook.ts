import { createHmac, timingSafeEqual } from "node:crypto";

/** Standard Webhooks: reject timestamps further than this from now, in either direction. */
export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookVerificationError";
  }
}

export interface WebhookHeaders {
  id: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
}

/**
 * HMAC keys a Polar secret can mean. Polar documents two schemes:
 * - Standard Webhooks (secrets made on or after 2026-09-08): the part after
 *   `whsec_` is base64; its decoded bytes are the key.
 * - Polar HMAC (older secrets): the key is the UTF-8 bytes of the whole
 *   `whsec_...` string.
 * The signature header does not say which one signed it, so both are tried
 * (the official SDKs do the same).
 */
function candidateKeys(secret: string): Buffer[] {
  const encoded = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  return [Buffer.from(encoded, "base64"), Buffer.from(secret, "utf8")];
}

/**
 * Verify a Standard Webhooks signature over the raw request body. Signed content
 * is `<webhook-id>.<webhook-timestamp>.<body>`; the header holds space-separated
 * `v1,<base64 hmac-sha256>` entries and any one may match.
 */
export function verifyWebhookSignature(
  rawBody: string,
  headers: WebhookHeaders,
  secret: string,
  nowMs: number,
): void {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) throw new WebhookVerificationError("Missing webhook headers");

  const seconds = Number(timestamp);
  if (!Number.isInteger(seconds)) throw new WebhookVerificationError("Invalid webhook timestamp");
  if (Math.abs(nowMs / 1000 - seconds) > WEBHOOK_TOLERANCE_SECONDS) {
    throw new WebhookVerificationError("Webhook timestamp is outside the allowed window");
  }

  const content = `${id}.${timestamp}.${rawBody}`;
  const expected = candidateKeys(secret).map((key) => createHmac("sha256", key).update(content).digest());

  for (const entry of signature.split(" ")) {
    const [version, value] = entry.split(",");
    if (version !== "v1" || value === undefined) continue;
    const actual = Buffer.from(value, "base64");
    if (expected.some((digest) => digest.length === actual.length && timingSafeEqual(digest, actual))) return;
  }
  throw new WebhookVerificationError("No matching webhook signature");
}
