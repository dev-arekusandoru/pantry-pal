import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../../auth/middleware.js";
import { registerHealthRoutes } from "./health.js";

/** The API sub-app mounted at `/api/v1`. */
export type ApiApp = OpenAPIHono<AppEnv>;

/**
 * Route registrars mounted under `/api/v1`.
 *
 * To add an area: create `src/api/routes/<area>.ts` exporting
 * `register<Area>Routes(app: ApiApp)`, then append it to this array.
 * `createApp` iterates the list in order.
 */
export const routeRegistrars: Array<(app: ApiApp) => void> = [registerHealthRoutes];
