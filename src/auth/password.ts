import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/** `scrypt$<salt>$<hash>` with base64url parts. */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const hash = scryptSync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

/** Compare a password with a stored hash in constant time. */
export function verifyPassword(stored: string, password: string): boolean {
  const [scheme, saltRaw, hashRaw] = stored.split("$");
  if (scheme !== "scrypt" || saltRaw === undefined || hashRaw === undefined) return false;
  const expected = Buffer.from(hashRaw, "base64url");
  const actual = scryptSync(password, Buffer.from(saltRaw, "base64url"), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
