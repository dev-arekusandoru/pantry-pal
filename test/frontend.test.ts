import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/api/app.js";
import { households } from "../src/db/schema.js";
import { AppError, type ErrorCode } from "../src/lib/errors.js";
import { completeCookEvent } from "../src/services/cooking.js";
import { resolveIngredient } from "../src/services/ingredients.js";
import { applyMovement, getStockForIngredient } from "../src/services/pantry.js";
import { createPlan, getPlan, swapMeal, type PlanView, type SlotView } from "../src/services/plans.js";
import { createRecipe } from "../src/services/recipes.js";
import {
  completeShoppingList,
  generateShoppingList,
  getShoppingList,
  listShoppingLists,
} from "../src/services/shopping.js";
import { makeTestApp, makeTestCtx } from "./helpers.js";

function expectAppError(fn: () => unknown, code: ErrorCode): AppError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
    return error as AppError;
  }
  throw new Error(`Expected an AppError with code ${code}`);
}

// ---------------------------------------------------------------------------
// Network-trust auth
// ---------------------------------------------------------------------------

describe("PANTRYPAL_TRUST_NETWORK auth", () => {
  function trustedApp() {
    const context = makeTestCtx();
    const app = createApp({ db: context.db, now: context.ctx.now, trustNetwork: true });
    return { ...context, app };
  }

  it("lets /api/v1 requests without a token act as the household", async () => {
    const { app, household } = trustedApp();
    const response = await app.request("/api/v1/household");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: household.id });
  });

  it("still verifies a token that is sent", async () => {
    const { app, token } = trustedApp();

    const bad = await app.request("/api/v1/household", { headers: { authorization: "Bearer nope" } });
    expect(bad.status).toBe(401);

    const good = await app.request("/api/v1/household", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(good.status).toBe(200);
  });

  it("never applies to /mcp", async () => {
    const { app } = trustedApp();
    const response = await app.request("/mcp", { method: "POST" });

    expect(response.status).toBe(401);
  });

  it("is off by default", async () => {
    const { app } = makeTestApp();
    const response = await app.request("/api/v1/household");

    expect(response.status).toBe(401);
  });

  it("answers 503 with a hint when the instance has no household", async () => {
    const context = makeTestCtx();
    context.db.delete(households).run();
    const app = createApp({ db: context.db, trustNetwork: true });

    const response = await app.request("/api/v1/household");

    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("unavailable");
    expect(body.error.message).toContain("household init");
  });
});

// ---------------------------------------------------------------------------
// Static web app
// ---------------------------------------------------------------------------

describe("static web app", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pantrypal-web-"));
  mkdirSync(path.join(dir, "assets"));
  writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>PantryPal</title>");
  writeFileSync(path.join(dir, "assets", "app-abc123.js"), "console.log('hi')");
  writeFileSync(path.join(dir, "favicon.svg"), "<svg/>");
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function webApp() {
    const context = makeTestCtx();
    return createApp({ db: context.db, now: context.ctx.now, webDir: dir });
  }

  it("serves index.html at / without caching", async () => {
    const response = await webApp().request("/", { headers: { accept: "text/html" } });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("cache-control")).toBe("no-cache");
    await expect(response.text()).resolves.toContain("PantryPal");
  });

  it("caches fingerprinted assets for a year", async () => {
    const response = await webApp().request("/assets/app-abc123.js");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  it("falls back to index.html for client routes that accept HTML", async () => {
    const response = await webApp().request("/recipes/slow-cooker-chili/cook", {
      headers: { accept: "text/html,application/xhtml+xml" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-cache");
    await expect(response.text()).resolves.toContain("PantryPal");
  });

  it("does not turn missing assets or API paths into index.html", async () => {
    const app = webApp();

    expect((await app.request("/assets/missing.js", { headers: { accept: "*/*" } })).status).toBe(404);

    const api = await app.request("/api/v1/does-not-exist", { headers: { accept: "text/html" } });
    expect(api.status).toBe(401);
    expect(api.headers.get("content-type")).toContain("application/json");

    const health = await app.request("/health", { headers: { accept: "text/html" } });
    expect(health.headers.get("content-type")).toContain("application/json");
    expect((await app.request("/openapi.json", { headers: { accept: "text/html" } })).status).toBe(200);
  });

  it("serves nothing when no web directory is configured", async () => {
    const { app } = makeTestApp();
    const response = await app.request("/", { headers: { accept: "text/html" } });

    expect(response.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Ad-hoc cook
// ---------------------------------------------------------------------------

interface CookResult {
  cookEvent: {
    id: string;
    mealPlanId: string | null;
    status: string;
    cookDate: string;
    plannedServings: number;
    actualServings: number | null;
  };
  movements: { qty: number | null; refId: string | null }[];
  warnings: string[];
}

describe("POST /cook-events (ad-hoc cook)", () => {
  function kitchen() {
    const test = makeTestApp();
    const chicken = resolveIngredient(test.ctx, "chicken breast", { create: true });
    const recipe = createRecipe(test.ctx, {
      title: "Chicken skillet",
      servings: 2,
      ingredients: [{ ingredientId: chicken.id, qty: 1, unit: "lb" }],
    });
    applyMovement(test.ctx, {
      ingredientId: chicken.id,
      location: "fridge",
      kind: "set",
      qty: 3,
      unit: "lb",
      reason: "purchase",
    });
    return { ...test, chicken, recipe };
  }

  it("creates a planned cook without a plan, dated today by default", async () => {
    const { request, recipe, ctx, chicken } = kitchen();

    const { status, body } = await request<CookResult>("POST", "/api/v1/cook-events", {
      recipeId: recipe.id,
      servings: 4,
    });

    expect(status).toBe(201);
    expect(body.cookEvent).toMatchObject({
      mealPlanId: null,
      status: "planned",
      cookDate: "2026-11-01",
      plannedServings: 4,
    });
    expect(body.movements).toEqual([]);
    expect(getStockForIngredient(ctx, chicken.id)[0]!.qty).toBeCloseTo(3, 6);
  });

  it("accepts a recipe slug, a cook date and the household default servings", async () => {
    const { request, recipe, household } = kitchen();

    const { status, body } = await request<CookResult>("POST", "/api/v1/cook-events", {
      recipe: recipe.slug,
      cookDate: "2026-10-30",
    });

    expect(status).toBe(201);
    expect(body.cookEvent.cookDate).toBe("2026-10-30");
    expect(body.cookEvent.plannedServings).toBe(household.settings.defaultServings);
  });

  it("completes in the same call and decrements the pantry", async () => {
    const { request, recipe, ctx, chicken } = kitchen();

    const { status, body } = await request<CookResult>("POST", "/api/v1/cook-events", {
      recipeId: recipe.id,
      servings: 4,
      complete: true,
    });

    expect(status).toBe(201);
    expect(body.cookEvent).toMatchObject({ mealPlanId: null, status: "done", actualServings: 4 });
    // 1 lb per 2 servings, cooked for 4 → 2 lb of the 3 lb stock.
    expect(body.movements).toHaveLength(1);
    expect(body.movements[0]!.qty).toBeCloseTo(-2, 6);
    expect(body.movements[0]!.refId).toBe(body.cookEvent.id);
    expect(getStockForIngredient(ctx, chicken.id)[0]!.qty).toBeCloseTo(1, 6);

    // History tolerates the null plan, and reopening restores the stock.
    const history = await request<{ items: { id: string; mealPlanId: string | null }[] }>(
      "GET",
      "/api/v1/cook-events",
    );
    expect(history.body.items).toEqual([
      expect.objectContaining({ id: body.cookEvent.id, mealPlanId: null }),
    ]);

    const reopened = await request<CookResult>(
      "POST",
      `/api/v1/cook-events/${body.cookEvent.id}/reopen`,
    );
    expect(reopened.status).toBe(200);
    expect(reopened.body.cookEvent.status).toBe("planned");
    expect(getStockForIngredient(ctx, chicken.id)[0]!.qty).toBeCloseTo(3, 6);
  });

  it("rejects unknown recipes and missing recipe refs", async () => {
    const { request } = kitchen();

    expect((await request("POST", "/api/v1/cook-events", { recipe: "nope" })).status).toBe(404);
    expect((await request("POST", "/api/v1/cook-events", { servings: 2 })).status).toBe(400);
  });

  it("undoes a completed ad-hoc cook, restoring stock and removing the event", async () => {
    const { request, recipe, ctx, chicken } = kitchen();

    const created = await request<CookResult>("POST", "/api/v1/cook-events", {
      recipeId: recipe.id,
      servings: 2,
      complete: true,
    });
    expect(getStockForIngredient(ctx, chicken.id)[0]!.qty).toBeCloseTo(2, 6);

    const undone = await request<{ deleted: boolean; cookEvent: null; movements: unknown[] }>(
      "POST",
      `/api/v1/cook-events/${created.body.cookEvent.id}/undo`,
    );

    expect(undone.status).toBe(200);
    expect(undone.body.deleted).toBe(true);
    expect(undone.body.cookEvent).toBeNull();
    expect(undone.body.movements).toHaveLength(1);
    expect(getStockForIngredient(ctx, chicken.id)[0]!.qty).toBeCloseTo(3, 6);

    const history = await request<{ items: unknown[] }>("GET", "/api/v1/cook-events");
    expect(history.body.items).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Meal swap
// ---------------------------------------------------------------------------

/**
 * Mon dinner is cooked from a chili batch that also feeds Tue lunch (no servings,
 * so a detached lunch cook falls back to lunchBatchServings); Wed dinner is a
 * one-slot soup; Thu dinner is a freeform note; Fri has nothing.
 */
function week() {
  const test = makeTestCtx({
    settings: { dinnerServings: 3, lunchBatchServings: 6, defaultServings: 4 },
  });
  const { ctx } = test;
  const chili = createRecipe(ctx, { title: "Chili", servings: 4 });
  const soup = createRecipe(ctx, { title: "Soup", servings: 2 });
  const stew = createRecipe(ctx, { title: "Stew", servings: 4 });

  const plan = createPlan(ctx, {
    weekStart: "2026-11-02",
    status: "active",
    cookEvents: [
      { key: "chili", recipeId: chili.id, cookDate: "2026-11-02", plannedServings: 4 },
      { key: "soup", recipeId: soup.id, cookDate: "2026-11-04", plannedServings: 2 },
    ],
    slots: [
      { date: "2026-11-02", mealType: "dinner", kind: "meal", cookEventKey: "chili", servings: 2 },
      { date: "2026-11-03", mealType: "lunch", kind: "meal", cookEventKey: "chili" },
      { date: "2026-11-04", mealType: "dinner", kind: "meal", cookEventKey: "soup", servings: 2 },
      { date: "2026-11-05", mealType: "dinner", kind: "freeform", label: "Fridge clean-out" },
    ],
  });
  return { ...test, plan, chili, soup, stew };
}

function slotAt(plan: PlanView, date: string, mealType: "lunch" | "dinner"): SlotView {
  const slot = plan.days.find((day) => day.date === date)!.meals[mealType][0];
  if (!slot) throw new Error(`No ${mealType} slot on ${date}`);
  return slot;
}

describe("swapMeal", () => {
  it("with_leftovers replaces the recipe of the cook and every slot it feeds", () => {
    const { ctx, plan, stew } = week();
    const leftover = slotAt(plan, "2026-11-03", "lunch");

    const result = swapMeal(ctx, plan.id, {
      slotId: leftover.id,
      recipeId: stew.id,
      scope: "with_leftovers",
    });

    expect(slotAt(result.plan, "2026-11-02", "dinner").cookEvent?.recipeTitle).toBe("Stew");
    expect(slotAt(result.plan, "2026-11-03", "lunch").cookEvent?.recipeTitle).toBe("Stew");
    expect(result.plan.cookEvents).toHaveLength(2);
    expect(slotAt(result.plan, "2026-11-02", "dinner").cookEventId).toBe(leftover.cookEventId);
    expect(result.plan.warnings).toEqual([]);
  });

  it("this detaches a leftover slot into its own cook and leaves the batch alone", () => {
    const { ctx, plan, stew } = week();
    const leftover = slotAt(plan, "2026-11-03", "lunch");

    const result = swapMeal(ctx, plan.id, {
      slotId: leftover.id,
      recipe: "Stew",
      scope: "this",
    });

    const swapped = slotAt(result.plan, "2026-11-03", "lunch");
    expect(swapped.cookEvent).toMatchObject({ recipeId: stew.id, cookDate: "2026-11-03" });
    expect(swapped.cookEventId).not.toBe(leftover.cookEventId);
    expect(swapped.isLeftover).toBe(false);
    expect(slotAt(result.plan, "2026-11-02", "dinner").cookEvent?.recipeTitle).toBe("Chili");

    const created = result.plan.cookEvents.find((event) => event.id === swapped.cookEventId)!;
    expect(created.plannedServings).toBe(6); // lunchBatchServings: the slot has no servings
    expect(created.status).toBe("planned");
    expect(result.plan.cookEvents).toHaveLength(3);
  });

  it("this on a cook that feeds only that slot changes the recipe in place", () => {
    const { ctx, plan, stew } = week();
    const soupSlot = slotAt(plan, "2026-11-04", "dinner");

    const result = swapMeal(ctx, plan.id, {
      slotId: soupSlot.id,
      recipeId: stew.id,
      scope: "this",
    });

    const swapped = slotAt(result.plan, "2026-11-04", "dinner");
    expect(swapped.cookEventId).toBe(soupSlot.cookEventId);
    expect(swapped.cookEvent?.recipeTitle).toBe("Stew");
    expect(result.plan.cookEvents).toHaveLength(2);
  });

  it("this on the cook night of a batch detaches it; the leftovers keep the batch", () => {
    const { ctx, plan, stew } = week();
    const cookNight = slotAt(plan, "2026-11-02", "dinner");

    const result = swapMeal(ctx, plan.id, {
      slotId: cookNight.id,
      recipeId: stew.id,
      scope: "this",
    });

    const swapped = slotAt(result.plan, "2026-11-02", "dinner");
    expect(swapped.cookEvent?.recipeTitle).toBe("Stew");
    expect(swapped.cookEventId).not.toBe(cookNight.cookEventId);
    expect(result.plan.cookEvents.find((e) => e.id === swapped.cookEventId)!.plannedServings).toBe(2);
    expect(slotAt(result.plan, "2026-11-03", "lunch").cookEvent?.recipeTitle).toBe("Chili");
  });

  it.each(["this", "with_leftovers"] as const)(
    "gives a slot without a cook a new one (scope %s)",
    (scope) => {
      const { ctx, plan, stew } = week();
      const freeform = slotAt(plan, "2026-11-05", "dinner");

      const result = swapMeal(ctx, plan.id, { slotId: freeform.id, recipeId: stew.id, scope });

      const swapped = slotAt(result.plan, "2026-11-05", "dinner");
      expect(swapped).toMatchObject({ id: freeform.id, kind: "meal", label: null });
      expect(swapped.cookEvent).toMatchObject({ recipeTitle: "Stew", cookDate: "2026-11-05" });
      const created = result.plan.cookEvents.find((event) => event.id === swapped.cookEventId)!;
      expect(created.plannedServings).toBe(3); // dinnerServings
      expect(result.plan.cookEvents).toHaveLength(3);
    },
  );

  it("creates the slot when targeting a date and meal type that has none", () => {
    const { ctx, plan, stew } = week();

    const result = swapMeal(ctx, plan.id, {
      date: "2026-11-06",
      mealType: "dinner",
      recipeId: stew.id,
      scope: "this",
    });

    expect(slotAt(result.plan, "2026-11-06", "dinner").cookEvent?.recipeTitle).toBe("Stew");
    expectAppError(
      () =>
        swapMeal(ctx, plan.id, {
          date: "2026-11-20",
          mealType: "dinner",
          recipeId: stew.id,
          scope: "this",
        }),
      "validation",
    );
  });

  it("refuses to swap a cook that is already done, but lets a leftover of it detach", () => {
    const { ctx, plan, stew } = week();
    const cookNight = slotAt(plan, "2026-11-02", "dinner");
    const leftover = slotAt(plan, "2026-11-03", "lunch");
    completeCookEvent(ctx, cookNight.cookEventId!);

    expectAppError(
      () => swapMeal(ctx, plan.id, { slotId: cookNight.id, recipeId: stew.id, scope: "this" }),
      "validation",
    );
    expectAppError(
      () => swapMeal(ctx, plan.id, { slotId: leftover.id, recipeId: stew.id, scope: "with_leftovers" }),
      "validation",
    );

    const result = swapMeal(ctx, plan.id, { slotId: leftover.id, recipeId: stew.id, scope: "this" });
    expect(slotAt(result.plan, "2026-11-03", "lunch").cookEvent?.recipeTitle).toBe("Stew");
    const chiliEvent = result.plan.cookEvents.find((event) => event.id === cookNight.cookEventId)!;
    expect(chiliEvent).toMatchObject({ status: "done", recipeTitle: "Chili" });
  });

  it("rejects unknown slots, slots of another plan and unknown recipes", () => {
    const { ctx, plan, stew } = week();
    const other = createPlan(ctx, { weekStart: "2026-11-09" });

    expectAppError(
      () => swapMeal(ctx, plan.id, { slotId: "slot_nope", recipeId: stew.id, scope: "this" }),
      "not_found",
    );
    expectAppError(
      () =>
        swapMeal(ctx, other.id, {
          slotId: slotAt(plan, "2026-11-04", "dinner").id,
          recipeId: stew.id,
          scope: "this",
        }),
      "not_found",
    );
    expectAppError(
      () =>
        swapMeal(ctx, plan.id, {
          slotId: slotAt(plan, "2026-11-04", "dinner").id,
          recipe: "Nonexistent",
          scope: "this",
        }),
      "not_found",
    );
  });

  it("changes nothing when the swap fails", () => {
    const { ctx, plan, stew } = week();
    const cookNight = slotAt(plan, "2026-11-02", "dinner");
    completeCookEvent(ctx, cookNight.cookEventId!);
    const before = getPlan(ctx, plan.id);

    expectAppError(
      () => swapMeal(ctx, plan.id, { slotId: cookNight.id, recipeId: stew.id, scope: "this" }),
      "validation",
    );
    expect(getPlan(ctx, plan.id)).toEqual(before);
  });

  it("serves POST /plans/{id}/swap", async () => {
    const { db, token, ctx } = makeTestApp();
    const chili = createRecipe(ctx, { title: "Chili", servings: 4 });
    createRecipe(ctx, { title: "Stew", servings: 4 });
    const plan = createPlan(ctx, {
      weekStart: "2026-11-02",
      cookEvents: [{ key: "c", recipeId: chili.id, cookDate: "2026-11-02" }],
      slots: [{ date: "2026-11-02", mealType: "dinner", kind: "meal", cookEventKey: "c" }],
    });
    const app = createApp({ db, now: ctx.now });
    const send = (planId: string, body: unknown) =>
      app.request(`/api/v1/plans/${planId}/swap`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const slotId = slotAt(plan, "2026-11-02", "dinner").id;

    const ok = await send(plan.id, { slotId, recipe: "stew", scope: "this" });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { plan: PlanView; shoppingListStale: boolean };
    expect(body.shoppingListStale).toBe(false);
    expect(slotAt(body.plan, "2026-11-02", "dinner").cookEvent?.recipeTitle).toBe("Stew");

    expect((await send(plan.id, { slotId, recipe: "stew", scope: "sideways" })).status).toBe(400);
    expect((await send("plan_nope", { slotId, recipe: "stew", scope: "this" })).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Stale shopping lists
// ---------------------------------------------------------------------------

describe("shopping list stale flag", () => {
  it("is set by a plan change after generation and cleared by regenerating", () => {
    const { ctx, plan, stew } = week();
    const list = generateShoppingList(ctx, { mealPlanId: plan.id });
    expect(list.list.stale).toBe(false);
    expect(listShoppingLists(ctx).items[0]!.stale).toBe(false);
    expect(list.list).not.toHaveProperty("planFingerprint");

    const result = swapMeal(ctx, plan.id, {
      slotId: slotAt(plan, "2026-11-04", "dinner").id,
      recipeId: stew.id,
      scope: "this",
    });

    expect(result.shoppingListStale).toBe(true);
    expect(getShoppingList(ctx, list.list.id).list.stale).toBe(true);
    expect(listShoppingLists(ctx).items[0]!.stale).toBe(true);

    const regenerated = generateShoppingList(ctx, { mealPlanId: plan.id, listId: list.list.id });
    expect(regenerated.list.stale).toBe(false);
    expect(getShoppingList(ctx, list.list.id).list.stale).toBe(false);
  });

  it("ignores changes that don't affect what must be bought", () => {
    const { ctx, plan, stew } = week();
    const list = generateShoppingList(ctx, { mealPlanId: plan.id });
    const soupSlot = slotAt(plan, "2026-11-04", "dinner");

    // Swap away and back: same cooks, same recipes.
    swapMeal(ctx, plan.id, { slotId: soupSlot.id, recipeId: stew.id, scope: "this" });
    const back = swapMeal(ctx, plan.id, { slotId: soupSlot.id, recipe: "Soup", scope: "this" });
    expect(back.shoppingListStale).toBe(false);

    // Finishing a cook is not a plan change either.
    completeCookEvent(ctx, slotAt(plan, "2026-11-02", "dinner").cookEventId!);
    expect(getShoppingList(ctx, list.list.id).list.stale).toBe(false);
  });

  it("is never set for completed or unbound lists", () => {
    const { ctx, plan, stew } = week();
    const list = generateShoppingList(ctx, { mealPlanId: plan.id });
    const done = completeShoppingList(ctx, list.list.id);
    expect(done.list.stale).toBe(false);

    swapMeal(ctx, plan.id, {
      slotId: slotAt(plan, "2026-11-04", "dinner").id,
      recipeId: stew.id,
      scope: "this",
    });
    expect(getShoppingList(ctx, list.list.id).list.stale).toBe(false);
    expect(swapMeal(ctx, plan.id, {
      slotId: slotAt(plan, "2026-11-04", "dinner").id,
      recipeId: stew.id,
      scope: "this",
    }).shoppingListStale).toBe(false);
  });

  it("exposes stale on the REST list and detail responses", async () => {
    const test = makeTestApp();
    const { ctx, request } = test;
    const chili = createRecipe(ctx, { title: "Chili", servings: 4 });
    createRecipe(ctx, { title: "Stew", servings: 4 });
    const plan = createPlan(ctx, {
      weekStart: "2026-11-02",
      cookEvents: [{ key: "c", recipeId: chili.id, cookDate: "2026-11-02" }],
      slots: [{ date: "2026-11-02", mealType: "dinner", kind: "meal", cookEventKey: "c" }],
    });

    const generated = await request<{ list: { id: string; stale: boolean } }>(
      "POST",
      "/api/v1/shopping-lists/generate",
      { mealPlanId: plan.id },
    );
    expect(generated.body.list.stale).toBe(false);

    const swapped = await request<{ shoppingListStale: boolean }>("POST", `/api/v1/plans/${plan.id}/swap`, {
      slotId: slotAt(plan, "2026-11-02", "dinner").id,
      recipe: "Stew",
      scope: "this",
    });
    expect(swapped.body.shoppingListStale).toBe(true);

    const detail = await request<{ list: { stale: boolean } }>(
      "GET",
      `/api/v1/shopping-lists/${generated.body.list.id}`,
    );
    expect(detail.body.list.stale).toBe(true);
    const lists = await request<{ items: { stale: boolean }[] }>("GET", "/api/v1/shopping-lists");
    expect(lists.body.items[0]!.stale).toBe(true);
  });
});
