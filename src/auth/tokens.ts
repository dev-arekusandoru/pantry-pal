import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { apiTokens } from "../db/schema.js";
import { AppError } from "../lib/errors.js";
import { newId } from "../lib/ids.js";

export type ApiToken = typeof apiTokens.$inferSelect;

/** Token metadata safe to expose (never the hash or the secret). */
export type ApiTokenSummary = Omit<ApiToken, "tokenHash">;

/** Returned exactly once, when the token is created. */
export interface CreatedToken extends ApiTokenSummary {
  /** Plaintext secret — the only time it is available. */
  token: string;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** `pp_` + 32 random hex characters. */
export function generateToken(): string {
  return `pp_${randomBytes(16).toString("hex")}`;
}

function toSummary(row: ApiToken): ApiTokenSummary {
  const { tokenHash: _tokenHash, ...summary } = row;
  return summary;
}

/** Create a bearer token for a household; the plaintext is returned only here. */
export function createToken(db: Db, householdId: string, name: string): CreatedToken {
  const tokenName = name.trim();
  if (tokenName === "") {
    throw new AppError("validation", "Token name is required");
  }

  const token = generateToken();
  const row = db
    .insert(apiTokens)
    .values({
      id: newId("tok"),
      householdId,
      name: tokenName,
      prefix: token.slice(0, 8),
      tokenHash: hashToken(token),
    })
    .returning()
    .get();

  return { ...toSummary(row), token };
}

/** Tokens of a household, newest first (revoked ones included, flagged by `revokedAt`). */
export function listTokens(db: Db, householdId: string): ApiTokenSummary[] {
  return db
    .select()
    .from(apiTokens)
    .where(eq(apiTokens.householdId, householdId))
    .orderBy(desc(apiTokens.createdAt))
    .all()
    .map(toSummary);
}

/** Revoke a token; revoking an already-revoked token is a no-op. */
export function revokeToken(db: Db, householdId: string, id: string): ApiTokenSummary {
  const row = db
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.householdId, householdId), eq(apiTokens.id, id)))
    .get();
  if (!row) throw new AppError("not_found", `Token not found: ${id}`, { id });
  if (row.revokedAt !== null) return toSummary(row);

  const updated = db
    .update(apiTokens)
    .set({ revokedAt: new Date().toISOString() })
    .where(eq(apiTokens.id, id))
    .returning()
    .get();
  return toSummary(updated);
}

/**
 * Validate a plaintext token. Revoked tokens are ignored; on success the token's
 * `lastUsedAt` is refreshed. Returns the owning household and token id, or null.
 */
export function verifyToken(
  db: Db,
  plaintext: string,
): { householdId: string; tokenId: string } | null {
  const token = plaintext.trim();
  if (token === "" || !token.startsWith("pp_")) return null;

  const row = db
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.tokenHash, hashToken(token)), isNull(apiTokens.revokedAt)))
    .get();
  if (!row) return null;

  db.update(apiTokens)
    .set({ lastUsedAt: new Date().toISOString() })
    .where(eq(apiTokens.id, row.id))
    .run();

  return { householdId: row.householdId, tokenId: row.id };
}
