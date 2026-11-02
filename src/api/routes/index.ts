import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../../auth/middleware.js";
import { registerHealthRoutes } from "./health.js";
import { registerHouseholdRoutes } from "./household.js";
import { registerIngredientRoutes } from "./ingredients.js";
import { registerPantryRoutes } from "./pantry.js";
import { registerPlansRoutes } from "./plans.js";
import { registerRecipeRoutes } from "./recipes.js";
import { registerRuleRoutes } from "./rules.js";
import { registerShoppingRoutes } from "./shopping.js";

/** The API sub-app mounted at `/api/v1`. */
export type ApiApp = OpenAPIHono<AppEnv>;

/**
 * Route registrars mounted under `/api/v1`.
 *
 * To add an area: create `src/api/routes/<area>.ts` exporting
 * `register<Area>Routes(app: ApiApp)`, then append it to this array.
 * `createApp` iterates the list in order.
 */
export const routeRegistrars: Array<(app: ApiApp) => void> = [
  registerHealthRoutes,
  // Must stay above registerPantryRoutes: `/pantry/availability` is a static
  // path inside the `/pantry/:id` namespace and Hono matches registration order.
  registerShoppingRoutes,
  registerIngredientRoutes,
  registerPantryRoutes,
  registerPlansRoutes,
  registerRecipeRoutes,
  registerRuleRoutes,
  registerHouseholdRoutes,
];
