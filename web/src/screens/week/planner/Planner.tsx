import {
  DndContext,
  DragOverlay,
  KeyboardCode,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Button, Emoji, Icon, IconButton, cx, toast } from "@/ui";
import { addDays, daysBetween, monthDay, weekdayName } from "../dates";
import { CORE_MEALS, MEAL_EMOJI, MEAL_LABEL, type MealType } from "../model";
import {
  addBatch,
  addEat,
  addNote,
  moveCook,
  moveEat,
  moveNote,
  removeBatch,
  removeEat,
  setServings,
  type DraftBatch,
  type DraftEat,
  type DraftNote,
  type PlannerProps,
} from "./draft";
import styles from "./Planner.module.css";
import { CookChip, EatChip, NoteChip, Preview, focusChip } from "./Chips";
import { Ctx, useGrid, type Editing, type GridCtx } from "./ctx";
import { Drawer } from "./Drawer";
import { gridKeyboard } from "./keyboard";
import { DayPlanner } from "./mobile/DayView";
import { useSaveDraft, type SaveDraftState } from "./save";
import { firstEatDate, initialDraft, itemName, noteIcon, recipeIcon, restoreBatch, restoreEat, type Item, type Target } from "./model";

const MEAL_ORDER: readonly MealType[] = ["breakfast", "lunch", "dinner", "snack", "dessert"];
const EXTRA_MEALS: readonly MealType[] = ["snack", "dessert"];
const cellKey = (date: string, meal: MealType) => `${date}|${meal}`;
const whenOf = (date: string, meal: MealType) => `${weekdayName(date)} ${meal}`;

/** Spot a dragged thing can land on. */
function Cell({ id, target, label, today, disabled, invalid, suits, empty, className, children }: {
  id: string;
  target: Target;
  label: string;
  today?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  /** The picked or dragged recipe suits this meal. */
  suits?: boolean;
  empty: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const g = useGrid();
  const { setNodeRef, isOver } = useDroppable({ id, data: target, disabled });
  const sel = g.selected;
  const canPlace = sel !== null && (target.type === "cook" ? sel.type === "cook" : sel.type !== "cook");
  return (
    <div
      ref={setNodeRef}
      role="group"
      aria-label={label}
      className={cx(styles.cell, className)}
      data-today={today ? "" : undefined}
      data-over={isOver && !disabled ? "" : undefined}
      data-invalid={invalid ? "" : undefined}
      data-suits={suits ? "" : undefined}
    >
      {!empty && <ul className={styles.stack}>{children}</ul>}
      {canPlace && sel && (
        <button
          type="button"
          data-place=""
          className={styles.place}
          data-fill={empty ? "" : undefined}
          aria-label={`Place ${itemName(sel, g.draft)} on ${label}`}
          onClick={(e) => g.place(sel, target, e.shiftKey)}
        >
          <Icon name="plus" size={14} />
          <span>Place here</span>
        </button>
      )}
    </div>
  );
}

const detect: CollisionDetection = (args) => (args.pointerCoordinates ? pointerWithin(args) : closestCenter(args));

/** Autosave state, sitting beside the page's "Done planning" button. */
function SaveNote({ save }: { save: SaveDraftState }) {
  if (save.status === "idle") return null;
  return (
    <p className={styles.saveBar} data-status={save.status} role="status">
      {save.status === "saving" && "Saving…"}
      {save.status === "saved" && "Saved ✓"}
      {save.status === "error" && (
        <>
          Couldn't save{save.error ? ` (${save.error})` : ""}.
          <Button variant="ghost" onClick={save.retry}>
            Retry
          </Button>
        </>
      )}
      {save.status === "conflict" && (
        <>
          This week changed elsewhere.
          <Button variant="ghost" onClick={save.loadLatest}>
            Load latest
          </Button>
          <Button variant="ghost" onClick={save.keepMine}>
            Keep mine
          </Button>
        </>
      )}
    </p>
  );
}

export function Planner({ plan, recipes, today, header, onWeek, arrival }: PlannerProps) {
  const [draft, setDraft] = useState(() => initialDraft(plan));
  const save = useSaveDraft(plan, draft, setDraft);
  const [narrow, setNarrow] = useState(false);
  const [selected, setSelected] = useState<Item | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [hot, setHot] = useState<string | null>(null);
  const [active, setActive] = useState<Item | null>(null);
  const [shiftDown, setShiftDown] = useState(false);
  const [extraRows, setExtraRows] = useState<readonly MealType[]>([]);
  const [overflowing, setOverflowing] = useState(false);
  const [renaming, setRenaming] = useState<GridCtx["renaming"]>(null);
  const shiftRef = useRef(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: gridKeyboard,
      // Enter is left free: it opens a chip's popover.
      keyboardCodes: { start: [KeyboardCode.Space], cancel: [KeyboardCode.Esc], end: [KeyboardCode.Space] },
    }),
  );

  // Escape drops a tap-to-place selection.
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSelected(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  // Shift while dropping moves the whole batch.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent | PointerEvent) => {
      shiftRef.current = e.shiftKey;
      setShiftDown(e.shiftKey);
    };
    const events = ["keydown", "keyup", "pointermove", "pointerup"] as const;
    for (const ev of events) window.addEventListener(ev, onKey as EventListener);
    return () => {
      for (const ev of events) window.removeEventListener(ev, onKey as EventListener);
    };
  }, [active]);

  // Wide screens: the planner fills the viewport below whatever sits above it (page header, picker) with no page scroll.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const fit = () => {
      // Below 700px the planner swaps to the mobile views; they scroll with the page like any other content.
      const mobile = el.clientWidth > 0 && el.clientWidth < 700;
      setNarrow(mobile);
      if (mobile) {
        el.removeAttribute("data-fit");
        el.style.removeProperty("--planner-h");
        el.style.marginBottom = "";
        return;
      }
      let below = 0;
      for (let n = el.parentElement; n; n = n.parentElement) {
        const cs = getComputedStyle(n);
        below += parseFloat(cs.paddingBottom) + parseFloat(cs.borderBottomWidth) + parseFloat(cs.marginBottom);
      }
      const top = el.getBoundingClientRect().top + window.scrollY;
      // Stop a little short of the bottom edge and let the page's own bottom padding hang below the fold.
      const gap = 16;
      el.style.setProperty("--planner-h", `${Math.max(window.innerHeight - top - gap, 520)}px`);
      el.style.marginBottom = `${gap - below}px`;
      el.toggleAttribute("data-fit", el.clientWidth >= 900);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    for (let n: HTMLElement | null = el; n; n = n.parentElement) if (n.previousElementSibling) ro.observe(n.previousElementSibling);
    window.addEventListener("resize", fit);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setOverflowing(el.scrollWidth > el.clientWidth + 1));
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, []);

  const days = draft.days;
  const weekStart = days[0] ?? plan.weekStart;
  const beforeDate = addDays(weekStart, -1);

  const used = new Set<MealType>([...draft.batches.flatMap((b) => b.eats.map((e) => e.mealType)), ...draft.notes.map((n) => n.mealType)]);
  const meals = MEAL_ORDER.filter((m) => CORE_MEALS.includes(m) || used.has(m) || extraRows.includes(m));

  const eatsAt = new Map<string, { batch: DraftBatch; eat: DraftEat }[]>();
  for (const batch of draft.batches) {
    for (const eat of batch.eats) {
      const k = cellKey(eat.date, eat.mealType);
      eatsAt.set(k, [...(eatsAt.get(k) ?? []), { batch, eat }]);
    }
  }
  const notesAt = new Map<string, DraftNote[]>();
  for (const n of draft.notes) {
    const k = cellKey(n.date, n.mealType);
    notesAt.set(k, [...(notesAt.get(k) ?? []), n]);
  }
  const cooksOn = (date: string) => draft.batches.filter((b) => b.cookDate === date);
  const beforeWeek = draft.batches.filter((b) => b.cookDate < weekStart);

  const refuse = (message: string) => toast.show({ message, durationMs: 3500 });
  // After a move the chip remounts in its new cell; give keyboard users their place back.
  const refocus = (key: string) => window.setTimeout(() => focusChip(key), 80);

  const place: GridCtx["place"] = (item, target, shift) => {
    setSelected(null);
    const d = draft;
    if (target.type === "cook") {
      if (item.type !== "cook") return;
      const b = d.batches.find((x) => x.id === item.batchId);
      if (!b) return;
      const next = moveCook(d, b.id, target.date, shift);
      if (next === d) refuse(shift ? "That would push a meal out of the week." : `The cook day can't come after the first meal (${weekdayName(firstEatDate(b))}).`);
      else setDraft(next);
      refocus(`cook:${b.id}`);
      return;
    }
    switch (item.type) {
      case "recipe": {
        const next = addBatch(d, item.recipe, target.date, target.meal);
        setDraft(next);
        const nb = next.batches[next.batches.length - 1];
        const key = nb?.eats[0]?.id;
        // Wait out dnd-kit's own focus restore, or the popover would lose focus straight away.
        if (nb && key) window.setTimeout(() => setEditing({ batchId: nb.id, key }), 150);
        return;
      }
      case "note": {
        const next = addNote(d, item.kind, item.label, target.date, target.meal);
        setDraft(next);
        const id = next.notes[next.notes.length - 1]?.id;
        if (!id) return;
        if (item.label === "") setRenaming({ id, fresh: true });
        else refocus(id);
        return;
      }
      case "eat": {
        const b = d.batches.find((x) => x.id === item.batchId);
        const eat = b?.eats.find((e) => e.id === item.eatId);
        if (!b || !eat) return;
        if (shift) {
          const next = moveCook(d, b.id, addDays(b.cookDate, daysBetween(eat.date, target.date)), true);
          if (next === d) refuse("That would push a meal out of the week.");
          else setDraft(next);
        } else {
          setDraft(moveEat(d, b.id, eat.id, target.date, target.meal));
        }
        refocus(eat.id);
        return;
      }
      case "placed-note":
        setDraft(moveNote(d, item.noteId, target.date, target.meal));
        refocus(item.noteId);
        return;
      case "cook":
        return;
    }
  };

  const undoable = (message: string, undo: () => void) => toast.show({ message, action: { label: "Undo", onClick: undo } });

  const ctx: GridCtx = {
    draft,
    recipes,
    today,
    hot,
    setHot,
    dragging: active !== null,
    selected,
    editing,
    edit: setEditing,
    renaming,
    rename: (id) => setRenaming({ id, fresh: false }),
    commitRename: (id, label) => {
      setDraft((d) => ({ ...d, notes: d.notes.map((n) => (n.id === id ? { ...n, label } : n)) }));
      setRenaming(null);
      refocus(id);
    },
    cancelRename: () => {
      if (!renaming) return;
      const { id, fresh } = renaming;
      if (fresh) setDraft((d) => ({ ...d, notes: d.notes.filter((n) => n.id !== id) }));
      setRenaming(null);
      if (!fresh) refocus(id);
    },
    place,
    removeEat: (b, e) => {
      setDraft((d) => removeEat(d, b.id, e.id));
      undoable(`Removed ${b.title} from ${whenOf(e.date, e.mealType)}`, () => setDraft((d) => restoreEat(d, b, e)));
    },
    removeBatch: (b) => {
      setDraft((d) => removeBatch(d, b.id));
      undoable(`Removed ${b.title} and its ${b.eats.length === 1 ? "meal" : `${b.eats.length} meals`}`, () => setDraft((d) => restoreBatch(d, b)));
    },
    removeNote: (n) => {
      setDraft((d) => ({ ...d, notes: d.notes.filter((x) => x.id !== n.id) }));
      undoable(`Removed ${n.label} from ${whenOf(n.date, n.mealType)}`, () => setDraft((d) => (d.notes.some((x) => x.id === n.id) ? d : { ...d, notes: [...d.notes, n] })));
    },
    setServings: (id, n) => setDraft((d) => setServings(d, id, n)),
    setCook: (id, date) => setDraft((d) => moveCook(d, id, date)),
    toggleEat: (b, date, meal) => {
      const have = b.eats.find((e) => e.date === date && e.mealType === meal);
      if (!have) setDraft((d) => addEat(d, b.id, date, meal));
      else if (b.eats.length > 1) ctx.removeEat(b, have);
    },
    startMove: (item) => {
      setEditing(null);
      setSelected(item);
      window.setTimeout(() => document.querySelector<HTMLElement>("[data-place]")?.focus(), 0);
    },
  };

  const onDragStart = (e: DragStartEvent) => {
    setActive(e.active.data.current as Item);
    setHot(null);
    setEditing(null);
    setSelected(null);
  };
  const onDragEnd = (e: DragEndEvent) => {
    const item = e.active.data.current as Item | undefined;
    const target = e.over?.data.current as Target | undefined;
    setActive(null);
    setShiftDown(false);
    if (item && target) place(item, target, shiftRef.current);
    shiftRef.current = false;
  };
  const onDragCancel = () => {
    setActive(null);
    setShiftDown(false);
  };

  const nameOf = (a: { data: { current?: unknown } }) => itemName(a.data.current as Item, draft);
  const spotOf = (o: { data: { current?: unknown } }) => {
    const t = o.data.current as Target;
    return t.type === "cook" ? `cook day, ${weekdayName(t.date)}` : whenOf(t.date, t.meal);
  };
  const announcements: Announcements = {
    onDragStart: ({ active: a }) => `Picked up ${nameOf(a)}.`,
    onDragOver: ({ active: a, over }) => (over ? `${nameOf(a)} is over ${spotOf(over)}.` : undefined),
    onDragEnd: ({ active: a, over }) => (over ? `Dropped ${nameOf(a)} on ${spotOf(over)}.` : `Dropped ${nameOf(a)}. Nothing changed.`),
    onDragCancel: ({ active: a }) => `Cancelled. ${nameOf(a)} stays where it was.`,
  };

  const reduceMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const dragBatch = active && (active.type === "eat" || active.type === "cook") ? draft.batches.find((b) => b.id === active.batchId) : undefined;
  const overlayIcon = !active ? "" : active.type === "recipe" ? recipeIcon(active.recipe.title) : active.type === "note" ? active.icon : active.type === "placed-note" ? noteIcon(draft.notes.find((n) => n.id === active.noteId) ?? { kind: "freeform", label: "" }) : recipeIcon(dragBatch?.title ?? "");
  const dragCook = active?.type === "cook";
  const cueItem = active ?? selected;
  const suitMeals = cueItem?.type === "recipe" ? cueItem.recipe.mealTypes : [];

  const selectedVerb = selected?.type === "eat" || selected?.type === "cook" || selected?.type === "placed-note" ? "Moving" : "Placing";

  return (
    <>
    {header(narrow, <SaveNote save={save} />)}
    <Ctx.Provider value={ctx}>
      <DndContext
        sensors={sensors}
        collisionDetection={detect}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable: "Press Space to pick up. Arrow keys jump between meals and cook days. Space drops, Escape cancels. Chips also open details with Enter, and cards have a Place button.",
          },
        }}
      >
        <div ref={wrapRef} className={styles.wrap} data-tab="week">
        {narrow ? (
          <div className={styles.mobile}>
            <DayPlanner draft={draft} setDraft={setDraft} recipes={recipes} today={today} onWeek={onWeek} arrival={arrival} />
          </div>
        ) : (
        <div className={styles.root}>
          <div className={styles.main}>
            <SaveNote save={save} />
            {selected && (
              <span role="status" className={styles.srOnly}>
                {selectedVerb} {itemName(selected, draft)}: choose {selected.type === "cook" ? "a cook day" : "a meal"} in the grid.
              </span>
            )}

            <section className={styles.board} aria-label="Week plan">
              <div ref={scrollerRef} className={styles.scroller} role="region" aria-label="Week grid. Scrolls sideways on small screens." tabIndex={0}>
                <div className={styles.grid} style={{ "--before-w": beforeWeek.length ? "7.5rem" : "3rem" } as CSSProperties}>
                  <div className={styles.corner} />
                  <div className={styles.dayHead} data-before="" title="Cooked before the week starts">
                    <span className={styles.dayName}>Before</span>
                    <span className={styles.dayDate}>{beforeWeek.length ? "the week" : ""}</span>
                  </div>
                  {days.map((d) => (
                    <div key={d} className={styles.dayHead} data-today={d === today ? "" : undefined}>
                      <span className={styles.dayName}>{weekdayName(d, "short")}</span>
                      <span className={styles.dayDate}>{monthDay(d)}</span>
                      {d === today && <span className={styles.flag}>Today</span>}
                    </div>
                  ))}

                  <div className={styles.rowLabel} data-cook="">
                    <Icon name="flame" size={22} />
                    <span>Cook</span>
                  </div>
                  <Cell
                    id="cook:before"
                    target={{ type: "cook", date: beforeDate }}
                    label={`Cook day before the week, ${weekdayName(beforeDate)} ${monthDay(beforeDate)}`}
                    disabled={active !== null && !dragCook}
                    empty={beforeWeek.length === 0}
                    className={styles.cookCell}
                  >
                    {beforeWeek.map((b) => (
                      <li key={b.id}>
                        <CookChip batch={b} weekStart={weekStart} />
                      </li>
                    ))}
                  </Cell>
                  {days.map((d) => {
                    const cooks = cooksOn(d);
                    const bad = dragCook && dragBatch ? d > firstEatDate(dragBatch) : false;
                    return (
                      <Cell
                        key={d}
                        id={`cook:${d}`}
                        target={{ type: "cook", date: d }}
                        label={`Cook day, ${weekdayName(d)} ${monthDay(d)}`}
                        today={d === today}
                        disabled={active !== null && !dragCook}
                        invalid={bad}
                        empty={cooks.length === 0}
                        className={styles.cookCell}
                      >
                        {cooks.map((b) => (
                          <li key={b.id}>
                            <CookChip batch={b} weekStart={weekStart} />
                          </li>
                        ))}
                      </Cell>
                    );
                  })}

                  {meals.map((m) => {
                    const rowEmpty = !used.has(m);
                    return (
                      <Fragment key={m}>
                        <div className={styles.rowLabel} data-suits={suitMeals.includes(m) ? "" : undefined}>
                          <Emoji code={MEAL_EMOJI[m]} size={30} />
                          <span>{MEAL_LABEL[m]}</span>
                          {EXTRA_MEALS.includes(m) && rowEmpty && (
                            <IconButton
                              variant="plain"
                              className={styles.hideRow}
                              label={`Hide ${MEAL_LABEL[m].toLowerCase()} row`}
                              icon={<Icon name="close" />}
                              onClick={() => setExtraRows((r) => r.filter((x) => x !== m))}
                            />
                          )}
                        </div>
                        <div className={styles.beforeFill} aria-hidden="true" />
                        {days.map((d) => {
                          const eats = eatsAt.get(cellKey(d, m)) ?? [];
                          const notes = notesAt.get(cellKey(d, m)) ?? [];
                          return (
                            <Cell
                              key={d}
                              id={`meal:${d}:${m}`}
                              target={{ type: "meal", date: d, meal: m }}
                              label={`${weekdayName(d)} ${monthDay(d)}, ${MEAL_LABEL[m]}`}
                              today={d === today}
                              disabled={dragCook}
                              suits={suitMeals.includes(m)}
                              empty={eats.length + notes.length === 0}
                            >
                              {eats.map(({ batch, eat }) => (
                                <li key={eat.id}>
                                  <EatChip batch={batch} eat={eat} />
                                </li>
                              ))}
                              {notes.map((n) => (
                                <li key={n.id}>
                                  <NoteChip note={n} />
                                </li>
                              ))}
                            </Cell>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                </div>
              </div>
              {overflowing && (
                <p className={styles.scrollHint} aria-hidden="true">
                  ‹ Scroll sideways for the rest of the week ›
                </p>
              )}
              {EXTRA_MEALS.some((m) => !meals.includes(m)) && (
                <div className={styles.addRows}>
                  {EXTRA_MEALS.filter((m) => !meals.includes(m)).map((m) => (
                    <Button key={m} variant="ghost" icon={<Icon name="plus" />} onClick={() => setExtraRows((r) => [...r, m])}>
                      Add {MEAL_LABEL[m].toLowerCase()} row
                    </Button>
                  ))}
                </div>
              )}
            </section>
          </div>

          <Drawer recipes={recipes} selected={selected} onSelect={setSelected} />
        </div>
        )}
        </div>

        <DragOverlay dropAnimation={reduceMotion ? null : undefined}>
          {active && (
            <Preview
              icon={overlayIcon}
              title={itemName(active, draft)}
              hint={active.type === "recipe" || active.type === "note" ? undefined : shiftDown ? "Whole batch moves" : "Hold Shift to move the whole batch"}
            />
          )}
        </DragOverlay>
      </DndContext>
    </Ctx.Provider>
    </>
  );
}
