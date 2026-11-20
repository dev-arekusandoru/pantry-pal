import { useEffect, useRef } from "react";

/**
 * Name the page for the tab bar and screen readers, and move focus to the page
 * heading once the title is known: a route change does not move focus by itself.
 * Pass undefined while the page loads.
 */
export function usePageEntry(title: string | undefined): void {
  const focused = useRef(false);
  useEffect(() => {
    if (title === undefined) return;
    document.title = `${title} · Rakumi`;
    if (focused.current) return;
    focused.current = true;
    const heading = document.querySelector<HTMLElement>("main h1");
    if (heading === null) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }, [title]);
}
