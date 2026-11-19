import { describe, expect, it } from "vitest";
import { ApiError } from "@/api/errors";
import {
  conflictingIngredient,
  ingredientErrorMessage,
  nameProblem,
  nameProblemText,
  splitNameParts,
  unresolvedNames,
  withAlternatives,
} from "./refs";

describe("withAlternatives", () => {
  it("lists stand-ins after the name, as written", () => {
    expect(withAlternatives("Milk", [{ name: "Water" }])).toBe("Milk (or Water)");
    expect(withAlternatives("Butter", [{ name: "Olive Oil" }, { name: "Margarine" }])).toBe("Butter (or Olive Oil or Margarine)");
  });

  it("returns the bare name without stand-ins", () => {
    expect(withAlternatives("Milk", [])).toBe("Milk");
  });
});

describe("splitNameParts", () => {
  it("splits names written as a choice", () => {
    expect(splitNameParts("Milk or water")).toEqual(["Milk", "water"]);
    expect(splitNameParts("Salt and/or pepper")).toEqual(["Salt", "pepper"]);
    expect(splitNameParts("Butter / margarine")).toEqual(["Butter", "margarine"]);
  });

  it("returns one piece for a plain name", () => {
    expect(splitNameParts("Orange")).toEqual(["Orange"]);
    expect(splitNameParts("Sun-dried tomatoes")).toEqual(["Sun-dried tomatoes"]);
  });
});

const lint422 = new ApiError(422, "unprocessable", "Invalid", {
  name: "Milk or water",
  reason: 'contains "or"',
  hint: "Use the main ingredient and add the others as alternatives.",
});

const unresolved422 = new ApiError(422, "unprocessable", "Unknown ingredient", {
  unresolved: [{ name: "Unobtainium", suggestions: [], hint: "Not a food." }],
});

describe("server error details", () => {
  it("reads the naming problem and words it as sentences", () => {
    const problem = nameProblem(lint422);
    expect(problem).toEqual({ reason: 'contains "or"', hint: "Use the main ingredient and add the others as alternatives." });
    expect(nameProblemText(problem!)).toBe('Contains "or". Use the main ingredient and add the others as alternatives.');
  });

  it("reads unresolved names only from a 422 with the list", () => {
    expect(unresolvedNames(unresolved422).map((entry) => entry.name)).toEqual(["Unobtainium"]);
    expect(unresolvedNames(lint422)).toEqual([]);
    expect(unresolvedNames(new Error("boom"))).toEqual([]);
  });

  it("finds the ingredient behind an already-linked 409", () => {
    const conflict = new ApiError(409, "conflict", "Linked", { ingredientId: "ing_1", name: "Egg", fdcId: 123 });
    expect(conflictingIngredient(conflict)).toEqual({ id: "ing_1", name: "Egg" });
    // A name clash carries no fdcId: that is a real error, not a reuse.
    expect(conflictingIngredient(new ApiError(409, "conflict", "Exists", { ingredientId: "ing_2", name: "Egg" }))).toBeNull();
  });

  it("builds one message per failure kind", () => {
    expect(ingredientErrorMessage(unresolved422, "x")).toContain('"Unobtainium" is not an ingredient yet');
    expect(ingredientErrorMessage(lint422, "x")).toContain('Contains "or".');
    expect(ingredientErrorMessage(new Error("Server said no"), "x")).toBe("Server said no");
    expect(ingredientErrorMessage("odd", "Fallback")).toBe("Fallback");
  });
});
