import { useRef, useState, type CSSProperties, type PointerEvent, type MouseEvent } from "react";

const MIN_PX = 72;
const MIN_FRACTION = 0.35;
const FLICK_PX_PER_MS = 0.6;
const START_PX = 8;
const INTERACTIVE = "button:not([role='checkbox']), input, a, select, textarea";

/** Rightward drags commit past 72px and 35% of the row, or on a fast flick that moved at least 24px. */
export function swipeOutcome(dx: number, width: number, velocity: number): "commit" | "cancel" {
  if (dx <= 0) return "cancel";
  if (dx >= MIN_PX && dx >= width * MIN_FRACTION) return "commit";
  return velocity >= FLICK_PX_PER_MS && dx >= 24 ? "commit" : "cancel";
}

export function useSwipeRow({ onCommit, disabled = false }: { onCommit: () => void; disabled?: boolean }) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const track = useRef<{ x: number; y: number; t: number; id: number; active: boolean; width: number } | null>(null);
  const moved = useRef(false);

  function end(e: PointerEvent<HTMLElement>, commit: boolean) {
    const t = track.current;
    track.current = null;
    if (!t) return;
    if (t.active) {
      e.currentTarget.releasePointerCapture?.(t.id);
      const velocity = (e.clientX - t.x) / Math.max(1, e.timeStamp - t.t);
      if (commit && swipeOutcome(dx, t.width, velocity) === "commit") onCommit();
      setTimeout(() => (moved.current = false), 0);
    }
    setDragging(false);
    setDx(0);
  }

  const rowProps = {
    onPointerDown(e: PointerEvent<HTMLElement>) {
      if (disabled || (e.pointerType === "mouse" && e.button !== 0)) return;
      if ((e.target as Element).closest(INTERACTIVE)) return;
      moved.current = false;
      track.current = { x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId, active: false, width: e.currentTarget.offsetWidth };
    },
    onPointerMove(e: PointerEvent<HTMLElement>) {
      const t = track.current;
      if (!t) return;
      const mx = e.clientX - t.x;
      if (!t.active) {
        const my = Math.abs(e.clientY - t.y);
        if (my > START_PX && my > Math.abs(mx)) {
          track.current = null;
          return;
        }
        if (Math.abs(mx) < START_PX || Math.abs(mx) < my) return;
        t.active = true;
        moved.current = true;
        e.currentTarget.setPointerCapture?.(t.id);
        setDragging(true);
      }
      setDx(Math.min(Math.max(mx, 0), t.width * 0.6));
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => end(e, true),
    onPointerCancel: (e: PointerEvent<HTMLElement>) => end(e, false),
    onClickCapture(e: MouseEvent<HTMLElement>) {
      if (!moved.current) return;
      e.preventDefault();
      e.stopPropagation();
    },
  };

  const style: CSSProperties = {
    touchAction: "pan-y",
    transform: dx ? `translateX(${dx}px)` : undefined,
    transition: dragging ? "none" : undefined,
  };
  return { rowProps, style, dragging, dx, progress: Math.min(1, dx / MIN_PX) };
}
