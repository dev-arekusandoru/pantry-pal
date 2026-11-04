import { beforeEach, describe, expect, it } from "vitest";
import { THEME_STORAGE_KEY, applyTheme, readStoredTheme, setTheme } from "./theme";

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe("theme", () => {
  it("defaults to system", () => {
    expect(readStoredTheme()).toBe("system");
  });

  it("persists and applies the preference", () => {
    setTheme("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    setTheme("system");
    expect(document.documentElement.dataset.theme).toBe("system");
  });

  it("ignores garbage in storage", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "purple");
    expect(readStoredTheme()).toBe("system");
    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
