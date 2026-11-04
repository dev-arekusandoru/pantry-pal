import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { probeServer, useIsUnreachable } from "../api";
import { Button, Icon } from "../ui";
import styles from "./ConnectionBanner.module.css";

const POLL_MS = 5000;

/**
 * Global "can't reach PantryPal" notice. Shown whenever any request failed at the
 * network level; polls the health endpoint until the server answers, then refetches
 * everything. Screens still show their own ErrorState for their failed queries.
 */
export function ConnectionBanner() {
  const unreachable = useIsUnreachable();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!unreachable) return;
    let cancelled = false;
    const check = async () => {
      if (await probeServer()) {
        if (!cancelled) void queryClient.invalidateQueries();
      }
    };
    const timer = setInterval(() => void check(), POLL_MS);
    window.addEventListener("online", check);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("online", check);
    };
  }, [unreachable, queryClient]);

  if (!unreachable) return null;

  return (
    <div className={styles.banner} role="alert">
      <Icon name="offline" size={22} />
      <span>Can't reach PantryPal. Trying again…</span>
      <Button
        variant="ghost"
        onClick={async () => {
          if (await probeServer()) void queryClient.invalidateQueries();
        }}
      >
        Retry now
      </Button>
    </div>
  );
}
