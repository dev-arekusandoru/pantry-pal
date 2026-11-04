import { useSyncExternalStore } from "react";
import { UNREACHABLE_STATUSES } from "./errors";

/**
 * Global "can the browser reach PantryPal" flag. The fetch wrapper in client.ts
 * flips it; the app shell shows a banner and polls /health until it recovers.
 */
type Listener = () => void;

let unreachable = false;
const listeners = new Set<Listener>();

function set(next: boolean): void {
  if (unreachable === next) return;
  unreachable = next;
  for (const l of listeners) l();
}

export const connection = {
  markUnreachable: () => set(true),
  markReachable: () => set(false),
  isUnreachable: () => unreachable,
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useIsUnreachable(): boolean {
  return useSyncExternalStore(connection.subscribe, connection.isUnreachable, () => false);
}

/** Probe the server. Resolves true (and clears the flag) when it answers. */
export async function probeServer(): Promise<boolean> {
  try {
    const res = await fetch("/api/v1/health", { cache: "no-store" });
    if (!UNREACHABLE_STATUSES.has(res.status)) {
      connection.markReachable();
      return true;
    }
  } catch {
    // fall through
  }
  connection.markUnreachable();
  return false;
}
