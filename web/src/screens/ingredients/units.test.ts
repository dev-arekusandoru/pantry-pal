import { describe, expect, it } from "vitest";
import { ApiError } from "@/api";
import { matchUnit, unitProblems, unitProblemsText, unitText } from "./units";

const UNITS = ["oz", "cup", "fl_oz", "count", "tbsp", "handful"];

describe("matchUnit", () => {
  it("finds the listed unit for plurals, aliases and case", () => {
    expect(matchUnit("Cups", UNITS)).toBe("cup");
    expect(matchUnit("tablespoon", UNITS)).toBe("tbsp");
    expect(matchUnit("fl oz", UNITS)).toBe("fl_oz");
    expect(matchUnit("handfuls", UNITS)).toBe("handful");
  });
  it("returns null for a unit the ingredient does not have", () => {
    expect(matchUnit("pinch", UNITS)).toBeNull();
    expect(matchUnit("  ", UNITS)).toBeNull();
  });
});

describe("unitProblems", () => {
  it("reads unresolved units from a 422", () => {
    const error = new ApiError(422, "unprocessable", "Unknown unit", {
      unresolvedUnits: [{ unit: "handful", ingredientId: "ing_1", ingredientName: "Baby Spinach", suggestions: ["cup", "oz"], hint: "x" }],
    });
    const problems = unitProblems(error);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.suggestions).toEqual(["cup", "oz"]);
    expect(unitProblemsText(problems)).toContain("Add a measure for handful, or use cup, oz.");
  });
  it("reads a conversion problem", () => {
    const error = new ApiError(422, "unprocessable", "Cannot convert", {
      ingredientId: "ing_1",
      ingredientName: "Baby Spinach",
      unit: "cup",
      toUnit: "oz",
      hint: "x",
    });
    expect(unitProblems(error)[0]).toMatchObject({ unit: "cup", suggestions: ["oz"] });
  });
  it("ignores other errors", () => {
    expect(unitProblems(new ApiError(500, "x", "boom"))).toEqual([]);
    expect(unitProblems(new Error("x"))).toEqual([]);
  });
});

describe("unitText", () => {
  it("shows fl_oz as fl oz", () => {
    expect(unitText("fl_oz")).toBe("fl oz");
  });
});
