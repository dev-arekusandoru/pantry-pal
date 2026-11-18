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

export interface RequestOptions {
  body?: unknown;
  /** Cookie header value (`name=value`). */
  cookie?: string;
  /** Bearer token; sent as `Authorization` when set. */
  token?: string;
  headers?: Record<string, string>;
}

export interface AppResponse<T> {
  status: number;
  body: T;
  headers: Headers;
}

export interface AuthTestApp {
  db: Db;
  app: OpenAPIHono<AppEnv>;
  now: () => Date;
  request<T = unknown>(
    method: string,
    path: string,
    options?: RequestOptions,
  ): Promise<AppResponse<T>>;
}

/**
 * Empty migrated database plus an app, for tests that start from signup. Unlike
 * {@link makeTestApp}, no household or token exists yet.
 */
export function makeAuthApp(
  options: { signupOpen?: boolean; now?: Date | (() => Date) } = {},
): AuthTestApp {
  const { db } = openDb(":memory:");
  runMigrations(db);
  const now = clockFrom(options.now);
  const app = createApp({
    db,
    now,
    ...(options.signupOpen === undefined ? {} : { signupOpen: options.signupOpen }),
  });

  async function request<T = unknown>(
    method: string,
    path: string,
    requestOptions: RequestOptions = {},
  ): Promise<AppResponse<T>> {
    const headers: Record<string, string> = { ...requestOptions.headers };
    if (requestOptions.body !== undefined) headers["content-type"] = "application/json";
    if (requestOptions.cookie !== undefined) headers.cookie = requestOptions.cookie;
    if (requestOptions.token !== undefined) headers.authorization = `Bearer ${requestOptions.token}`;

    const response = await app.request(path, {
      method,
      headers,
      ...(requestOptions.body === undefined ? {} : { body: JSON.stringify(requestOptions.body) }),
    });
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = text === "" ? null : JSON.parse(text);
    } catch {
      parsed = text;
    }
    return { status: response.status, body: parsed as T, headers: response.headers };
  }

  return { db, app, now, request };
}

/** The `name=value` pair from a response's `Set-Cookie` header. */
export function sessionCookie(response: { headers: Headers }): string {
  const pair = response.headers.get("set-cookie")?.split(";")[0]?.trim();
  if (pair === undefined || pair === "") throw new Error("expected a Set-Cookie header");
  return pair;
}
