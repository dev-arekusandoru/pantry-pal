import { describe, expect, it } from "vitest";
import { filterByStatusView, isInStatusView, isNewToTry, type RecipeStatus } from "./filter";

const recipe = (id: string, status: RecipeStatus) => ({ id, status });

const RECIPES = [
  recipe("rotation", "rotation"),
  recipe("new", "want_to_try"),
  recipe("never", "never"),
  recipe("archived", "archived"),
];

describe("filterByStatusView", () => {
  it("shows rotation and want-to-try recipes in the default view", () => {
    expect(filterByStatusView(RECIPES, "box").map((r) => r.id)).toEqual(["rotation", "new"]);
  });

  it("keeps never and archived recipes out of the default view", () => {
    const ids = filterByStatusView(RECIPES, "box").map((r) => r.id);
    expect(ids).not.toContain("never");
    expect(ids).not.toContain("archived");
  });

  it("shows only never recipes in the never view", () => {
    expect(filterByStatusView(RECIPES, "never").map((r) => r.id)).toEqual(["never"]);
  });

  it("never shows archived recipes in any view", () => {
    expect(isInStatusView("archived", "box")).toBe(false);
    expect(isInStatusView("archived", "never")).toBe(false);
  });
});

describe("isNewToTry", () => {
  it("tags only want-to-try recipes", () => {
    expect(isNewToTry("want_to_try")).toBe(true);
    expect(isNewToTry("rotation")).toBe(false);
    expect(isNewToTry("never")).toBe(false);
    expect(isNewToTry("archived")).toBe(false);
  });
});
