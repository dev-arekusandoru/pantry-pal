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
});
