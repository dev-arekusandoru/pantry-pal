import type { KeyboardCoordinateGetter } from "@dnd-kit/core";

const DIRS: Record<string, [number, number]> = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] };

/** Arrow keys jump the dragged item to the nearest drop spot in that direction (default is 25px nudges). */
export const gridKeyboard: KeyboardCoordinateGetter = (event, { context: { droppableRects, droppableContainers, collisionRect }, currentCoordinates }) => {
  const dir = DIRS[event.code];
  if (!dir || !collisionRect) return undefined;
  event.preventDefault();
  const cx = collisionRect.left + collisionRect.width / 2;
  const cy = collisionRect.top + collisionRect.height / 2;
  let best: { x: number; y: number } | undefined;
  let bestScore = Infinity;
  for (const c of droppableContainers.getEnabled()) {
    const r = droppableRects.get(c.id);
    if (!r) continue;
    // The spot we are already over does not count.
    if (cx >= r.left && cx <= r.left + r.width && cy >= r.top && cy <= r.top + r.height) continue;
    const dx = r.left + r.width / 2 - cx;
    const dy = r.top + r.height / 2 - cy;
    const along = dx * dir[0] + dy * dir[1];
    if (along <= 0) continue;
    const across = Math.abs(dx * dir[1]) + Math.abs(dy * dir[0]);
    const score = along + across * 2;
    if (score < bestScore) {
      bestScore = score;
      best = { x: currentCoordinates.x + dx, y: currentCoordinates.y + dy };
    }
  }
  return best;
};
