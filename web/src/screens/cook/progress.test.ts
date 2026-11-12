import { beforeEach, describe, expect, it } from "vitest";
import {
  clearCookProgress,
  isResumable,
  readCookProgress,
  saveCookProgress,
} from "./progress";

const slug = "slow-cooker-chili";
const saved = {
  step: 2,
  stepCount: 5,
  servings: 4,
  cookEvent: "ce_test",
  savedAt: "2026-11-03T12:00:00.000Z",
};

beforeEach(() => localStorage.clear());

describe("cook progress", () => {
  it("round-trips progress per recipe and clears it", () => {
    saveCookProgress(slug, saved);
    saveCookProgress("other", { ...saved, step: 1 });

    expect(readCookProgress(slug)).toEqual(saved);
    expect(readCookProgress("other")?.step).toBe(1);
    expect(readCookProgress("missing")).toBeNull();

    clearCookProgress(slug);
    expect(readCookProgress(slug)).toBeNull();
    expect(readCookProgress("other")?.step).toBe(1);
  });

  it("ignores corrupt storage", () => {
    localStorage.setItem("pantrypal.cook-progress.v1", "{not json");
    expect(readCookProgress(slug)).toBeNull();

    localStorage.setItem(
      "pantrypal.cook-progress.v1",
      JSON.stringify({ [slug]: { step: -1, stepCount: 3, servings: 2, savedAt: "x" }, ok: saved }),
    );
    expect(readCookProgress(slug)).toBeNull();
    expect(readCookProgress("ok")).toEqual(saved);
  });

  it("only resumes into a recipe with the same number of steps", () => {
    expect(isResumable(saved, 5)).toBe(true);
    expect(isResumable(saved, 4)).toBe(false);
    expect(isResumable({ ...saved, step: 0 }, 5)).toBe(false);
    expect(isResumable({ ...saved, step: 5 }, 5)).toBe(false);
    expect(isResumable(null, 5)).toBe(false);
  });

  it("round-trips a crew with the progress", () => {
    const crew = {
      cooks: [
        { id: "alex", name: "Alex" },
        { id: "sam", name: "Sam" },
      ],
      owners: ["alex", "alex", "sam", "alex", "sam"],
      positions: { alex: 2, sam: 1 },
    };
    saveCookProgress(slug, { ...saved, crew });

    expect(readCookProgress(slug)?.crew).toEqual(crew);
  });

  it("drops a crew that no longer fits the recipe and keeps the rest", () => {
    const owners = ["alex", "alex", "sam", "alex", "sam"];
    const valid = {
      cooks: [
        { id: "alex", name: "Alex" },
        { id: "sam", name: "Sam" },
      ],
      owners,
      positions: { alex: 1, sam: 0 },
    };

    const invalid = [
      { ...valid, cooks: [{ id: "alex", name: "Alex" }] },
      { ...valid, cooks: [...valid.cooks, { id: "alex", name: "Alex again" }] },
      { ...valid, owners: owners.slice(0, 4) },
      { ...valid, owners: ["alex", "alex", "nobody", "alex", "sam"] },
      { ...valid, positions: { alex: -1, sam: 0 } },
      { ...valid, positions: { alex: 1.5, sam: 0 } },
      { ...valid, positions: { ghost: 1 } },
    ];

    for (const crew of invalid) {
      saveCookProgress(slug, { ...saved, crew });
      const progress = readCookProgress(slug);
      expect(progress).not.toBeNull();
      expect(progress?.step).toBe(saved.step);
      expect(progress?.crew).toBeUndefined();
    }

    saveCookProgress(slug, { ...saved, crew: valid });
    expect(readCookProgress(slug)?.crew).toEqual(valid);
  });

  it("resumes a crew from any cook moving, and solo progress from the step", () => {
    const crew = {
      cooks: [
        { id: "alex", name: "Alex" },
        { id: "sam", name: "Sam" },
      ],
      owners: ["alex", "alex", "sam", "alex", "sam"],
      positions: { alex: 0, sam: 0 },
    };

    expect(isResumable({ ...saved, step: 0, crew }, 5)).toBe(false);
    expect(isResumable({ ...saved, step: 0, crew: { ...crew, positions: { alex: 0, sam: 1 } } }, 5)).toBe(true);
    // The solo rule still applies when a crew is all at their first step.
    expect(isResumable({ ...saved, step: 2, crew }, 5)).toBe(true);
  });
});
