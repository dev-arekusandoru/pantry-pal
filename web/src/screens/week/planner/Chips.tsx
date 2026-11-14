import { useDraggable } from "@dnd-kit/core";
import { Popover } from "radix-ui";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Emoji, Icon } from "@/ui";
import { monthDay, weekdayName } from "../dates";
import type { DraftBatch, DraftEat, DraftNote } from "./draft";
import styles from "./Planner.module.css";
import { BatchEditor } from "./BatchEditor";
import { useGrid } from "./ctx";
import { feedsLine, noteIcon, recipeIcon, sameItem, type Item } from "./model";

export const focusChip = (key: string) => document.querySelector<HTMLElement>(`[data-chip="${CSS.escape(key)}"]`)?.focus();

interface FrameProps {
  dragId: string;
  item: Item;
  focusKey: string;
  kind: "cook" | "eat" | "note";
  batch?: DraftBatch;
  /** Set on chips whose click/Enter opens the batch popover. */
  editorKey?: string;
  label: string;
  title: string;
  removeLabel: string;
  onRemove: () => void;
  onActivate?: () => void;
  children: ReactNode;
}

/** Draggable chip: a body button (drag handle, opens the popover) with an X sibling. */
function ChipFrame({ dragId, item, focusKey, kind, batch, editorKey, label, title, removeLabel, onRemove, onActivate, children }: FrameProps) {
  const g = useGrid();
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, isDragging } = useDraggable({ id: dragId, data: item });
  const batchId = batch?.id;
  const editing = batch && editorKey !== undefined && g.editing?.batchId === batch.id ? g.editing : null;
  const open = editing !== null && editing.key === editorKey;
  const lit = batchId !== undefined && (g.hot === batchId || g.editing?.batchId === batchId);
  const chip = (
    <div
      ref={setNodeRef}
      className={styles.chip}
      data-kind={kind}
      data-hue={batch?.hue}
      data-hot={lit ? "" : undefined}
      data-dragging={isDragging ? "" : undefined}
      data-selected={g.selected && sameItem(g.selected, item) ? "" : undefined}
      onPointerEnter={() => batchId !== undefined && !g.dragging && g.setHot(batchId)}
      onPointerLeave={() => g.setHot(null)}
      onFocus={() => batchId !== undefined && !g.dragging && g.setHot(batchId)}
      onBlur={() => g.setHot(null)}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        className={kind === "cook" ? styles.bodyCook : styles.bodyCol}
        data-chip={focusKey}
        aria-label={label}
        title={title}
        aria-description={kind === "eat" || kind === "cook" ? "Hold Shift while dropping to move the whole batch." : undefined}
        onClick={onActivate ?? (batch && editorKey !== undefined ? () => g.edit({ batchId: batch.id, key: editorKey, fresh: false }) : undefined)}
        {...attributes}
        {...listeners}
      >
        {children}
      </button>
      <button type="button" className={styles.chipX} aria-label={removeLabel} title={removeLabel} onClick={onRemove}>
        <Icon name="close" size={14} />
      </button>
    </div>
  );
  if (!batch || editorKey === undefined) return chip;
  return (
    <Popover.Root open={open} onOpenChange={(o) => !o && g.edit(null)}>
      <Popover.Anchor asChild>{chip}</Popover.Anchor>
      {open && editing && (
        <Popover.Portal>
          <Popover.Content
            className={styles.pop}
            side="bottom"
            align="start"
            sideOffset={8}
            collisionPadding={8}
            aria-label={`Edit ${batch.title}`}
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              focusChip(focusKey);
            }}
          >
            <BatchEditor batch={batch} eatKey={editorKey} fresh={editing.fresh} />
          </Popover.Content>
        </Popover.Portal>
      )}
    </Popover.Root>
  );
}

/** Recipe photo (rounded square, hue-bordered) with a small food-icon badge; the bare icon when there is no photo. */
function Pic({ recipeId, title, size, badge }: { recipeId: string; title: string; size: number; badge: number }) {
  const g = useGrid();
  const [failed, setFailed] = useState(false);
  const url = g.recipes?.get(recipeId)?.imageUrl;
  const icon = recipeIcon(title);
  if (!url || failed) return <Emoji code={icon} size={Math.round(size * 0.65)} />;
  return (
    <span className={styles.pic} style={{ "--pic": `${size}px`, "--badge": `${badge}px` } as CSSProperties} aria-hidden="true">
      <img src={url} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />
      <span className={styles.picBadge}>
        <Emoji code={icon} size={Math.round(badge * 0.8)} />
      </span>
    </span>
  );
}

export function EatChip({ batch, eat }: { batch: DraftBatch; eat: DraftEat }) {
  const g = useGrid();
  const from = batch.cookDate === eat.date ? "cook day" : `from ${weekdayName(batch.cookDate, "short")}`;
  const when = `${weekdayName(eat.date)} ${eat.mealType}`;
  return (
    <ChipFrame
      dragId={`eat:${eat.id}`}
      item={{ type: "eat", batchId: batch.id, eatId: eat.id }}
      focusKey={eat.id}
      kind="eat"
      batch={batch}
      editorKey={eat.id}
      label={`${batch.title}, ${when}, ${from}`}
      title={`${batch.title} (${from})`}
      removeLabel={`Remove ${batch.title} from ${when}`}
      onRemove={() => g.removeEat(batch, eat)}
    >
      <Pic recipeId={batch.recipeId} title={batch.title} size={36} badge={16} />
      <span className={styles.chipTitle}>{batch.title}</span>
    </ChipFrame>
  );
}

export function CookChip({ batch, weekStart }: { batch: DraftBatch; weekStart: string }) {
  const g = useGrid();
  const feeds = feedsLine(batch);
  const early = batch.cookDate < weekStart;
  const when = `${weekdayName(batch.cookDate)} ${monthDay(batch.cookDate)}`;
  return (
    <ChipFrame
      dragId={`cook:${batch.id}`}
      item={{ type: "cook", batchId: batch.id }}
      focusKey={`cook:${batch.id}`}
      kind="cook"
      batch={batch}
      editorKey="cook"
      label={`Cook ${batch.title} on ${when}${early ? " (before the week)" : ""}, serves ${batch.servings}, ${feeds}`}
      title={`${batch.title}: ${feeds}`}
      removeLabel={`Remove ${batch.title} and its ${batch.eats.length} ${batch.eats.length === 1 ? "meal" : "meals"}`}
      onRemove={() => g.removeBatch(batch)}
    >
      <span className={styles.cookTop}>
        <Pic recipeId={batch.recipeId} title={batch.title} size={26} badge={13} />
        <span className={styles.srv}>
          <Icon name="people" size={11} />
          {batch.servings}
        </span>
      </span>
      <span className={styles.cookTitle}>{batch.title}</span>
    </ChipFrame>
  );
}

/** Inline name field on a note chip. Enter saves; Esc or an empty blur cancels (a just-placed chip is removed). */
function NoteEdit({ note }: { note: DraftNote }) {
  const g = useGrid();
  const ref = useRef<HTMLInputElement>(null);
  const ready = useRef(false);
  const done = useRef(false);
  // Wait out dnd-kit's own focus restore after a drop, or it would steal focus straight back.
  useEffect(() => {
    const t = window.setTimeout(() => {
      ready.current = true;
      ref.current?.focus();
      ref.current?.select();
    }, 150);
    return () => window.clearTimeout(t);
  }, []);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    const v = ref.current?.value.trim() ?? "";
    if (save && v) g.commitRename(note.id, v);
    else g.cancelRename();
  };
  return (
    <div className={styles.chip} data-kind="note" data-editing="">
      <input
        ref={ref}
        className={styles.noteEdit}
        aria-label={`Name for ${weekdayName(note.date)} ${note.mealType}`}
        placeholder="Write it here"
        maxLength={40}
        defaultValue={note.label}
        onKeyDown={(e) => {
          if (e.key === "Enter") finish(true);
          else if (e.key === "Escape") {
            e.stopPropagation();
            finish(false);
          }
        }}
        onBlur={() => ready.current && finish(true)}
      />
    </div>
  );
}

export function NoteChip({ note }: { note: DraftNote }) {
  const g = useGrid();
  if (g.renaming?.id === note.id) return <NoteEdit note={note} />;
  const when = `${weekdayName(note.date)} ${note.mealType}`;
  return (
    <ChipFrame
      dragId={`note:${note.id}`}
      item={{ type: "placed-note", noteId: note.id }}
      focusKey={note.id}
      kind="note"
      label={`${note.label}, ${when}. Press Enter to rename.`}
      title={`${note.label} (click to rename)`}
      removeLabel={`Remove ${note.label} from ${when}`}
      onRemove={() => g.removeNote(note)}
      onActivate={() => g.rename(note.id)}
    >
      <Emoji code={noteIcon(note)} size={24} />
      <span className={styles.chipTitle}>{note.label}</span>
    </ChipFrame>
  );
}

/** What follows the pointer while dragging. */
export function Preview({ icon, title, hint }: { icon: string; title: string; hint?: string }) {
  return (
    <div className={styles.overlay}>
      <Emoji code={icon} size={30} />
      <span>
        <span className={styles.chipTitle}>{title}</span>
        {hint && <span className={styles.chipNote}>{hint}</span>}
      </span>
    </div>
  );
}
