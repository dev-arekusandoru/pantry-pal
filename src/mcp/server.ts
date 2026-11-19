import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { packageVersion } from "../api/routes/health.js";
import type { Ctx } from "../context.js";
import { registerHouseholdTools } from "./tools/household.js";
import { registerNutritionTools } from "./tools/nutrition.js";
import { registerPantryTools } from "./tools/pantry.js";
import { registerPlanningTools } from "./tools/planning.js";
import { registerRecipeTools } from "./tools/recipes.js";
import { registerShoppingTools } from "./tools/shopping.js";

export const MCP_SERVER_NAME = "pantrypal";

/**
 * Instructions sent with `initialize`: the rules an agent must follow to use
 * PantryPal correctly instead of re-implementing pantry arithmetic.
 */
export const MCP_INSTRUCTIONS = [
  "PantryPal is the household's pantry, recipe, meal-plan and shopping backend.",
  "You pick the meals, portions and substitutions; the server does all quantity math: unit conversion, recipe scaling, plan demand, availability and shopping deltas. Send numbers and choices, never converted or summed quantities.",
  "Ids are prefixed strings (hh_, mem_, ing_, rcp_, plan_, ce_, slot_, prep_, sl_, sli_, pi_, mv_) and are stable; pass them between calls instead of re-reading. Ingredient references also accept names and aliases, but ids are exact.",
  "Ingredients are controlled: nothing creates an ingredient from free text. Call find_ingredient first, then use the existing ingredient (ingredientId or its exact name) or a USDA food (fdcId with name) on recipe lines, pantry lines and rules. One ingredient per name: put \"x or y\" in alternatives, sizes in the unit (large) and preparation in prepNote. create_custom_ingredient is a last resort.",
  "Check dietary rules before adding a recipe to a plan: rules_list, then recipe_check for a recipe or recipe_check with ingredient names for a proposed line. A violation with a conditionNote is a judgement call you must make and explain.",
  "A leftover is a meal slot that points at an earlier cook event; batch cooking is one cook event feeding several later slots. Never model leftovers as a second cook.",
  "Record cooking with cook_complete (it decrements the pantry) and shopping trips with shopping_complete (it writes purchases into stock). Do not adjust stock twice for the same event.",
  'Unknown pantry amounts need a kitchen check, not zero: qty null means present-but-unmeasured.',
].join(" ");

/** Build the MCP server for one authenticated request's context. */
export function createMcpServer(ctx: Ctx): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: packageVersion() },
    { instructions: MCP_INSTRUCTIONS },
  );

  registerHouseholdTools(server, ctx);
  registerPantryTools(server, ctx);
  registerRecipeTools(server, ctx);
  registerNutritionTools(server, ctx);
  registerPlanningTools(server, ctx);
  registerShoppingTools(server, ctx);

  return server;
}
