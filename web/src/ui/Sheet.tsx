import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconButton } from "./IconButton";
import styles from "./Sheet.module.css";
import { cx } from "./cx";
import { Icon } from "./icons";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** Dialog title; always set, it is the accessible name. */
  title: string;
  /** Visually hide the title (it stays the accessible name). */
  hideTitle?: boolean;
  /** `bottom` slides up from the bottom edge (default); `center` is a centered dialog on wide screens. */
  variant?: "bottom" | "center";
  /** Sticky area under the scrolling body, for the primary action. */
  footer?: ReactNode;
  children: ReactNode;
}

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

let openSheets = 0;

/** Lock page scroll and make the app root inert while any sheet is open. */
function lockPage(): () => void {
  openSheets += 1;
  document.body.classList.add("scroll-locked");
  const root = document.getElementById("root");
  root?.setAttribute("inert", "");
  return () => {
    openSheets -= 1;
    if (openSheets === 0) {
      document.body.classList.remove("scroll-locked");
      root?.removeAttribute("inert");
    }
  };
}

/**
 * Modal sheet / dialog. Traps focus, closes on Esc and backdrop click, restores
 * focus to the opener, locks page scroll. Rendered in a portal on <body>.
 */
export function Sheet({ open, onClose, title, hideTitle, variant = "bottom", footer, children }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const unlock = lockPage();
    const panel = panelRef.current;
    // Respect `autoFocus` children; otherwise focus the panel itself.
    if (panel && !panel.contains(document.activeElement)) panel.focus();
    return () => {
      unlock();
      opener?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
      e.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === panel)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <div
      className={cx(styles.backdrop, variant === "center" && styles.center)}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className={styles.head}>
          <h2 id={titleId} className={cx(styles.title, hideTitle && "sr-only")}>
            {title}
          </h2>
          <IconButton label="Close" icon={<Icon name="close" />} variant="plain" onClick={onClose} />
        </header>
        <div className={styles.body}>{children}</div>
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
