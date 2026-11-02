import type { OpenAPIHono } from "@hono/zod-openapi";
import { createApp } from "../src/api/app.js";
import { createToken } from "../src/auth/tokens.js";
import type { AppEnv } from "../src/auth/middleware.js";
import { makeCtx, type Ctx } from "../src/context.js";
import { openDb, runMigrations, type Db } from "../src/db/client.js";
import type { HouseholdSettings } from "../src/db/schema.js";
import { createHousehold, type Household } from "../src/services/households.js";

/** Deterministic default clock for tests: 2026-11-01T12:00:00.000Z. */
export const FIXED_NOW = new Date("2026-11-01T12:00:00.000Z");

export interface TestCtxOptions {
  /** Fixed instant or a mutable clock. Defaults to {@link FIXED_NOW}. */
  now?: Date | (() => Date);
  settings?: Partial<HouseholdSettings>;
  householdName?: string;
}

export interface TestContext {
  db: Db;
  ctx: Ctx;
  household: Household;
  /** Plaintext bearer token for this household. */
  token: string;
}

export interface TestApp extends TestContext {
  app: OpenAPIHono<AppEnv>;
  request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: T }>;
}

function clockFrom(now: Date | (() => Date) | undefined): () => Date {
  if (now === undefined) {
    const fixed = FIXED_NOW.getTime();
    return () => new Date(fixed);
  }
  if (now instanceof Date) {
    const fixed = now.getTime();
    return () => new Date(fixed);
  }
  return now;
}

/** In-memory database with migrations applied, plus a household and one API token. */
export function makeTestCtx(options: TestCtxOptions = {}): TestContext {
  const { db } = openDb(":memory:");
  runMigrations(db);

  const household = createHousehold(db, {
    name: options.householdName ?? "Test Household",
    ...(options.settings === undefined ? {} : { settings: options.settings }),
  });
  const ctx = makeCtx(db, household.id, clockFrom(options.now));
  const { token } = createToken(db, household.id, "test");

  return { db, ctx, household, token };
}

/** API app wired to a test context; `request` sends a bearer-authenticated JSON request. */
export function makeTestApp(options: TestCtxOptions = {}): TestApp {
  const context = makeTestCtx(options);
  const app = createApp({ db: context.db, now: context.ctx.now });

  async function request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: T }> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${context.token}`,
    };
    if (body !== undefined) headers["content-type"] = "application/json";

    const response = await app.request(path, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = text === "" ? null : JSON.parse(text);
    } catch {
      parsed = text;
    }
    return { status: response.status, body: parsed as T };
  }

  return { ...context, app, request };
}
