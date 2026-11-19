import { describe, expect, it } from "vitest";
import { createToken, revokeToken } from "../src/auth/tokens.js";
import { makeAuthApp, sessionCookie, type AuthTestApp } from "./helpers.js";

/**
 * Two accounts created through the public signup endpoint. Every resource below
 * belongs to household A; household B must not reach it by id.
 */

const ORIGIN = "http://localhost";
const PASSWORD = "correct horse battery candle";

interface SignupBody {
  account: { email: string };
  household: { id: string; name: string };
}

interface RecipeBody {
  id: string;
  slug: string;
  ingredients: { id: string; ingredientId: string }[];
}

interface PantryBody {
  item: { id: string };
}

interface ListBody {
  list: { id: string };
  items: { id: string }[];
}

async function signUp(app: AuthTestApp, email: string, householdName: string) {
  const response = await app.request<SignupBody>("POST", "/auth/signup", {
    body: { email, password: PASSWORD, householdName },
    headers: { origin: ORIGIN },
  });
  expect(response.status).toBe(201);
  return { cookie: sessionCookie(response), ...response.body };
}

function as(app: AuthTestApp, cookie: string, method: string, path: string, body?: unknown) {
  return app.request(method, path, { cookie, body, headers: { origin: ORIGIN } });
}

interface Fixture {
  app: AuthTestApp;
  a: { cookie: string; household: { id: string } };
  b: { cookie: string; household: { id: string } };
  tokenA: { token: string; id: string };
  tokenB: { token: string; id: string };
  recipe: RecipeBody;
  pantryItemId: string;
  memberId: string;
  ruleId: string;
  planId: string;
  listId: string;
  listItemId: string;
}

async function fixture(): Promise<Fixture> {
  const app = makeAuthApp();
  const a = await signUp(app, "a@example.com", "Household A");
  const b = await signUp(app, "b@example.com", "Household B");

  const recipe = await as(app, a.cookie, "POST", "/api/v1/recipes", {
    title: "A secret chili",
    servings: 2,
    // Onions, raw: recipes link USDA foods instead of creating ingredients from free text.
    ingredients: [{ fdcId: 170000, name: "Onion", qty: 1, unit: "lb" }],
  });
  expect(recipe.status).toBe(201);
  const recipeBody = recipe.body as RecipeBody;
  const ingredientId = recipeBody.ingredients[0]?.ingredientId;
  expect(ingredientId).toBeDefined();

  const pantry = await as(app, a.cookie, "POST", "/api/v1/pantry/set", {
    ingredientId,
    qty: 2,
    unit: "lb",
  });
  expect(pantry.status).toBe(200);
  const pantryItemId = (pantry.body as PantryBody).item.id;

  const member = await as(app, a.cookie, "POST", "/api/v1/household/members", {
    name: "Alice",
  });
  expect(member.status).toBe(201);

  const rule = await as(app, a.cookie, "POST", "/api/v1/rules", {
    scope: "keyword",
    severity: "forbidden",
    targetText: "peanut",
  });
  expect(rule.status).toBe(201);

  const plan = await as(app, a.cookie, "POST", "/api/v1/plans", {
    weekStart: "2026-11-02",
    title: "A week",
  });
  expect(plan.status).toBe(201);

  const list = await as(app, a.cookie, "POST", "/api/v1/shopping-lists", {
    title: "A list",
    items: [{ name: "paper towels", qty: 1, unit: "roll" }],
  });
  expect(list.status).toBe(201);
  const listBody = list.body as ListBody;

  const tokenA = createToken(app.db, a.household.id, "a-token");
  const tokenB = createToken(app.db, b.household.id, "b-token");

  return {
    app,
    a,
    b,
    tokenA,
    tokenB,
    recipe: recipeBody,
    pantryItemId,
    memberId: (member.body as { id: string }).id,
    ruleId: (rule.body as { id: string }).id,
    planId: (plan.body as { id: string }).id,
    listId: listBody.list.id,
    listItemId: listBody.items[0]?.id ?? "",
  };
}

describe("household isolation over REST", () => {
  it("lists only the signed-in household's rows", async () => {
    const { app, a, b } = await fixture();
    const collections = [
      "/api/v1/recipes",
      "/api/v1/pantry",
      "/api/v1/plans",
      "/api/v1/shopping-lists",
      "/api/v1/rules",
      "/api/v1/household/members",
    ];

    for (const path of collections) {
      const asB = await as(app, b.cookie, "GET", path);
      expect(asB.status, path).toBe(200);
      expect((asB.body as { items: unknown[] }).items, path).toEqual([]);
    }

    const asA = await as(app, a.cookie, "GET", "/api/v1/recipes");
    expect((asA.body as { items: unknown[] }).items).toHaveLength(1);
  });

  it("cannot read household A's rows by id", async () => {
    const { app, b, recipe, pantryItemId, planId, listId } = await fixture();

    const paths = [
      `/api/v1/recipes/${recipe.id}`,
      `/api/v1/pantry/${pantryItemId}`,
      `/api/v1/plans/${planId}`,
      `/api/v1/shopping-lists/${listId}`,
    ];

    for (const path of paths) {
      const response = await as(app, b.cookie, "GET", path);
      expect(response.status, path).toBe(404);
      expect(response.body, path).toMatchObject({ error: { code: "not_found" } });
    }
  });

  it("cannot update or delete household A's rows by id", async () => {
    const { app, b, recipe, pantryItemId, memberId, ruleId, planId, listId } = await fixture();

    const attempts: [string, string, unknown?][] = [
      ["PATCH", `/api/v1/recipes/${recipe.id}`, { title: "stolen" }],
      ["DELETE", `/api/v1/recipes/${recipe.id}`],
      ["PATCH", `/api/v1/pantry/${pantryItemId}`, { qty: 0 }],
      ["DELETE", `/api/v1/pantry/${pantryItemId}`],
      ["PATCH", `/api/v1/plans/${planId}`, { title: "stolen" }],
      ["DELETE", `/api/v1/plans/${planId}`],
      ["PATCH", `/api/v1/shopping-lists/${listId}`, { title: "stolen" }],
      ["DELETE", `/api/v1/shopping-lists/${listId}`],
    ];

    for (const [method, path, body] of attempts) {
      const response = await as(app, b.cookie, method, path, body);
      expect(response.status, `${method} ${path}`).toBe(404);
    }

    // Rules and members use their own verbs.
    for (const [method, path] of [
      ["PATCH", `/api/v1/rules/${ruleId}`],
      ["DELETE", `/api/v1/rules/${ruleId}`],
      ["PATCH", `/api/v1/household/members/${memberId}`],
      ["DELETE", `/api/v1/household/members/${memberId}`],
    ] as const) {
      const response = await as(app, b.cookie, method, path, { name: "stolen", severity: "avoid" });
      expect(response.status, `${method} ${path}`).toBe(404);
    }
  });

  it("cannot reach household A's shopping item through its own list", async () => {
    const { app, b, listItemId } = await fixture();

    const own = await as(app, b.cookie, "POST", "/api/v1/shopping-lists", { title: "B list" });
    expect(own.status).toBe(201);
    const ownId = (own.body as ListBody).list.id;

    const response = await as(
      app,
      b.cookie,
      "PATCH",
      `/api/v1/shopping-lists/${ownId}/items/${listItemId}`,
      { qty: 9 },
    );
    expect(response.status).toBe(404);

    const check = await as(app, b.cookie, "POST", `/api/v1/shopping-lists/${ownId}/check`, {
      checks: [{ itemId: listItemId, checked: true }],
    });
    expect(check.status).not.toBe(200);
  });

  it("keeps household A's data reachable for household A", async () => {
    const { app, a, recipe, planId, listId } = await fixture();

    for (const path of [
      `/api/v1/recipes/${recipe.id}`,
      `/api/v1/plans/${planId}`,
      `/api/v1/shopping-lists/${listId}`,
    ]) {
      expect((await as(app, a.cookie, "GET", path)).status, path).toBe(200);
    }
  });
});

describe("household isolation over MCP", () => {
  interface ToolResult {
    isError?: boolean;
    content: { type: string; text: string }[];
  }

  async function callTool(
    app: AuthTestApp,
    token: string,
    name: string,
    args: unknown,
  ): Promise<{ isError: boolean; payload: unknown }> {
    const response = await app.request<{
      result?: ToolResult;
    }>("POST", "/mcp", {
      token,
      body: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } },
      headers: { accept: "application/json, text/event-stream" },
    });
    expect(response.status).toBe(200);
    const result = response.body.result;
    expect(result).toBeDefined();
    return {
      isError: result?.isError === true,
      payload: JSON.parse(result?.content[0]?.text ?? "null") as unknown,
    };
  }

  it("does not resolve household A's ids with household B's token", async () => {
    const { app, tokenB, recipe, planId, listId } = await fixture();

    for (const [tool, args] of [
      ["recipe_get", { idOrSlug: recipe.id }],
      ["plan_get", { plan: planId }],
      ["shopping_get", { shoppingListId: listId }],
    ] as const) {
      const { isError, payload } = await callTool(app, tokenB.token, tool, args);
      expect(isError, tool).toBe(true);
      expect(payload, tool).toMatchObject({ error: { code: "not_found" } });
    }
  });

  it("lists only household B's rows", async () => {
    const { app, b, tokenB } = await fixture();

    for (const tool of ["recipe_search", "pantry_query", "rules_list", "shopping_get"]) {
      const { isError, payload } = await callTool(app, tokenB.token, tool, {});
      expect(isError, tool).toBe(false);
      const body = payload as { items?: unknown[]; household?: { id: string }; id?: string };
      if (body.items !== undefined) expect(body.items, tool).toEqual([]);
    }

    const household = await callTool(app, tokenB.token, "household_get", {});
    expect(household.payload).toMatchObject({ household: { id: b.household.id } });
  });
});

describe("token isolation", () => {
  it("does not let one household revoke another household's token", async () => {
    const { app, b, tokenA } = await fixture();

    expect(() => revokeToken(app.db, b.household.id, tokenA.id)).toThrowError(
      /Token not found/,
    );
  });

  it("scopes a bearer token to its own household", async () => {
    const { app, tokenA, recipe } = await fixture();

    const response = await app.request<{ items: { id: string }[] }>("GET", "/api/v1/recipes", {
      token: tokenA.token,
    });
    expect(response.body).toMatchObject({ items: [{ id: recipe.id }] });
  });
});
