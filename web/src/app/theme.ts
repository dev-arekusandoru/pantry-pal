import { useSyncExternalStore } from "react";

export type ThemePreference = "light" | "dark" | "system";

/** Keep in sync with the inline script in index.html (applies the theme before first paint). */
export const THEME_STORAGE_KEY = "pantrypal.theme";

const listeners = new Set<() => void>();

function isPreference(v: unknown): v is ThemePreference {
  return v === "light" || v === "dark" || v === "system";
}

export function readStoredTheme(): ThemePreference {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return isPreference(v) ? v : "system";
  } catch {
    return "system";
  }
}

/** Write the preference to <html data-theme>. "system" lets tokens.css follow prefers-color-scheme. */
export function applyTheme(pref: ThemePreference): void {
  document.documentElement.dataset.theme = pref;
}

let current: ThemePreference = readStoredTheme();

export function setTheme(pref: ThemePreference): void {
  current = pref;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // Private mode etc.: the choice still applies for this session.
  }
  applyTheme(pref);
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Call once at startup (main.tsx), after the inline script ran. */
export function initTheme(): void {
  current = readStoredTheme();
  applyTheme(current);
}

function systemPrefersDark(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
}

function subscribeSystem(l: () => void): () => void {
  if (typeof matchMedia !== "function") return () => {};
  const mq = matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", l);
  return () => mq.removeEventListener("change", l);
}

export interface UseTheme {
  /** The stored preference. */
  theme: ThemePreference;
  /** What is actually showing right now (system resolved). */
  resolved: "light" | "dark";
  setTheme: (pref: ThemePreference) => void;
}

export function useTheme(): UseTheme {
  const theme = useSyncExternalStore(subscribe, () => current, () => "system" as const);
  const systemDark = useSyncExternalStore(subscribeSystem, systemPrefersDark, () => false);
  const resolved = theme === "system" ? (systemDark ? "dark" : "light") : theme;
  return { theme, resolved, setTheme };
}
