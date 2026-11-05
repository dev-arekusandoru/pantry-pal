import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Password-backed browser sessions.
 *
 * There is no session table: a cookie is a signed
 * `v1.<issued>.<expires>.<nonce>.<mac>` token whose HMAC key is derived from
 * the shared password. Rotating
 * `PANTRYPAL_PASSWORD` therefore invalidates every existing browser session,
 * without a separate server-side secret. Login is stateless, so logout clears
 * the current browser's cookie (ending its access); a copied cookie remains
 * valid until it expires or the password rotates. Use a long random password:
 * anyone holding both a cookie and the ability to guess offline can test guesses.
 */

/**
 * Name of the browser session cookie. The `__Host-` prefix makes browsers reject
 * cookies with a `Domain` attribute or another path, preventing a sibling/parent
 * domain from planting or shadowing the session cookie.
 */
export const SESSION_COOKIE_NAME = "__Host-pantrypal_session";

/** Browser sessions last 30 days. */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

const TOKEN_VERSION = "v1";
const KEY_LABEL = "pantrypal-session-key-v1";

function sessionKey(password: string): Buffer {
  return createHmac("sha256", KEY_LABEL).update(password, "utf8").digest();
}

function sign(password: string, payload: string): string {
  return createHmac("sha256", sessionKey(password)).update(payload, "utf8").digest("base64url");
}

export interface SessionToken {
  /** Cookie value to send to the browser. */
  value: string;
  /** Remaining lifetime in seconds (the cookie `Max-Age`). */
  maxAge: number;
  expiresAt: Date;
}

/** Create a signed session token valid for {@link SESSION_TTL_SECONDS} from `now`. */
export function createSessionToken(password: string, now: Date): SessionToken {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const expiresAt = issuedAt + SESSION_TTL_SECONDS;
  // A random nonce makes every login token distinct even within the same second.
  const nonce = randomBytes(16).toString("base64url");
  const payload = `${TOKEN_VERSION}.${issuedAt}.${expiresAt}.${nonce}`;
  return {
    value: `${payload}.${sign(password, payload)}`,
    maxAge: SESSION_TTL_SECONDS,
    expiresAt: new Date(expiresAt * 1000),
  };
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Verify a session cookie value: correct signature, correct version, not expired
 * and not issued implausibly far in the future. Any tampering yields `false`.
 */
export function verifySessionToken(password: string, value: string, now: Date): boolean {
  const parts = value.split(".");
  if (parts.length !== 5) return false;

  const [version, issuedRaw, expiresRaw, nonce, signature] = parts;
  if (version !== TOKEN_VERSION || signature === undefined) return false;
  if (nonce === undefined || !/^[A-Za-z0-9_-]{16,64}$/.test(nonce)) return false;
  if (!/^\d{1,12}$/.test(issuedRaw ?? "") || !/^\d{1,12}$/.test(expiresRaw ?? "")) return false;

  const issuedAt = Number(issuedRaw);
  const expiresAt = Number(expiresRaw);
  if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt)) return false;
  if (expiresAt <= issuedAt) return false;

  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (expiresAt <= nowSeconds) return false;
  // Allow a small clock skew for the issuing server, but reject future tokens.
  if (issuedAt > nowSeconds + 60) return false;

  const payload = `${version}.${issuedAt}.${expiresAt}.${nonce}`;
  return constantTimeEqual(sign(password, payload), signature);
}

/**
 * Compare a supplied password with the configured one in constant time.
 * Both sides are hashed first so inputs of different lengths are comparable.
 */
export function passwordMatches(expected: string, supplied: string): boolean {
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  const suppliedDigest = createHash("sha256").update(supplied, "utf8").digest();
  return timingSafeEqual(expectedDigest, suppliedDigest);
}

/** True when a configured password value enables browser login. */
export function isPasswordConfigured(password: string | undefined): password is string {
  return typeof password === "string" && password.length > 0;
}
