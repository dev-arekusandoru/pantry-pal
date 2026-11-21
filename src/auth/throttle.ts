/** Attempts allowed per key inside one window. */
const AUTH_LIMIT = 10;
const AUTH_WINDOW_MS = 15 * 60_000;
const MAX_THROTTLE_ENTRIES = 2048;

interface ThrottleWindow {
  count: number;
  resetAt: number;
}

/**
 * Bounded in-memory fixed-window throttle for the account endpoints.
 *
 * Keys are socket peer addresses (never `X-Forwarded-For` or similar headers a
 * client can spoof), prefixed by endpoint group.
 *
 * shortcut: the counters live in this process only, so a restart clears them and
 * several server processes do not share a limit. Move to a shared store when the
 * app runs more than one process.
 */
export class Throttle {
  private readonly buckets = new Map<string, ThrottleWindow>();

  retryAfterSeconds(key: string, nowMs: number = Date.now()): number | null {
    const bucket = this.buckets.get(key);
    if (bucket === undefined || bucket.count < AUTH_LIMIT) return null;
    return bucket.resetAt > nowMs ? Math.max(1, Math.ceil((bucket.resetAt - nowMs) / 1000)) : null;
  }

  record(key: string, nowMs: number = Date.now()): void {
    let bucket = this.buckets.get(key);
    if (bucket === undefined) {
      if (this.buckets.size >= MAX_THROTTLE_ENTRIES) {
        const oldest = this.buckets.keys().next();
        if (!oldest.done) this.buckets.delete(oldest.value);
      }
      bucket = { count: 0, resetAt: nowMs + AUTH_WINDOW_MS };
      this.buckets.set(key, bucket);
    }
    if (bucket.resetAt <= nowMs) {
      bucket.count = 0;
      bucket.resetAt = nowMs + AUTH_WINDOW_MS;
    }
    bucket.count += 1;
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }
}
