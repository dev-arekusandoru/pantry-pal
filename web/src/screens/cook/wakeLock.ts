import { useEffect } from "react";

/**
 * Keep the screen awake while `active`. Re-acquires when the tab becomes visible
 * again (the browser drops the lock on hide). Silently does nothing where the
 * API is missing or the page is not a secure context.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    async function acquire() {
      if (sentinel !== null && !sentinel.released) return;
      try {
        const next = await navigator.wakeLock.request("screen");
        if (cancelled) void next.release().catch(() => {});
        else sentinel = next;
      } catch {
        // Denied (insecure context, low battery, hidden tab): cooking works without it.
      }
    }

    function onVisible() {
      if (document.visibilityState === "visible") void acquire();
    }

    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release().catch(() => {});
    };
  }, [active]);
}
