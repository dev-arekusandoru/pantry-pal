import { z } from "@hono/zod-openapi";

export const apiTokenSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    prefix: z.string().describe("First characters of the secret, to tell tokens apart."),
    createdAt: z.string(),
    lastUsedAt: z.string().nullable(),
  })
  .openapi("ApiToken");

export const apiTokenListSchema = z.object({ items: z.array(apiTokenSchema) }).openapi("ApiTokenList");

export const createTokenSchema = z
  .object({ name: z.string().trim().min(1).max(80).describe("Label, e.g. the app that uses the token.") })
  .openapi("CreateApiTokenInput");

export const createdTokenSchema = apiTokenSchema
  .extend({ token: z.string().describe("The secret. Shown only in this response.") })
  .openapi("CreatedApiToken");

export const tokenIdParamSchema = z.object({ id: z.string().min(1).describe("Token id.") });
