import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Dialog, VisuallyHidden } from "radix-ui";
import { IconButton } from "./IconButton";
import styles from "./Sheet.module.css";
import { Icon } from "./icons";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** Dialog title; always set, it is the accessible name. */
  title: string;
  /** Visually hide the title (it stays the accessible name). */
  hideTitle?: boolean;
  /** Sticky area under the scrolling body, for the primary action. */
  footer?: ReactNode;
  children: ReactNode;
}

/**
 * Modal sheet: a bottom sheet on phones, a centered dialog from 700px up. On
 * Radix Dialog, so it has a focus trap, scroll lock, an inert background, Esc
 * and backdrop dismissal, and focus restored to the opener. Rendered in a
 * portal on <body>.
 *
 * Footer contract: secondary actions first, the primary last. Each button
 * stretches to an equal share below 400px, so a two-button footer fills the
 * sheet instead of floating in the middle.
 */
export function Sheet({ open, onClose, title, hideTitle, footer, children }: SheetProps) {
  const openerRef = useRef<HTMLElement | null>(null);

  // Runs before Radix moves focus into the dialog, so this captures the opener.
  useLayoutEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, [open]);

  const heading = (
    <Dialog.Title asChild>
      <h2 className={styles.title}>{title}</h2>
    </Dialog.Title>
  );

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.backdrop} />
        <Dialog.Content
          className={styles.viewport}
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            // Radix would focus its Trigger; this sheet has none, so return to the opener.
            event.preventDefault();
            const opener = openerRef.current;
            openerRef.current = null;
            opener?.focus?.();
          }}
        >
          <div className={styles.panel}>
            <header className={styles.head}>
              {hideTitle ? <VisuallyHidden.Root asChild>{heading}</VisuallyHidden.Root> : heading}
              <IconButton label="Close" icon={<Icon name="close" />} variant="plain" onClick={onClose} />
            </header>
            <div className={styles.body}>{children}</div>
            {footer && <div className={styles.footer}>{footer}</div>}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
