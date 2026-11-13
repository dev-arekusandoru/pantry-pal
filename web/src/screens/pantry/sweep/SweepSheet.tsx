import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { errorMessage } from "@/api";
import { recordSweep } from "@/game/missions";
import { useHousehold, weekStartsOnOf } from "@/screens/settings/queries";
import { localToday, weekStartFor } from "@/screens/week/dates";
import { Button, Icon, Pal, Sheet, Sticker, ingredientEmoji, toast } from "@/ui";
import { formatQty, unitLabel } from "../../shop/format";
import { useAddToList, useRemoveListItem, useRestoreItem, useSetQty, useSetStatus, useVerifyItem } from "../queries";
import { STATUS_LABEL, type PantryItem } from "../stock";
import { answerCount, pickDeck, readSnoozes, setSnooze, snoozeUntil, summaryLine, type SweepAnswer, type SweepChoice } from "./sweep";
import styles from "./Sweep.module.css";

const KEYS: Record<string, SweepChoice | "skip"> = {
  "1": "have",
  ArrowRight: "have",
  "2": "low",
  ArrowLeft: "low",
  "3": "out",
  ArrowDown: "out",
  s: "skip",
  ArrowUp: "skip",
};

/** Horizontal travel that counts as a swipe, in px. */
const SWIPE_PX = 80;
/** Card tilt at full pull, in degrees. */
const MAX_TILT = 8;
/** How long a committed card takes to leave, in ms. */
const FLY_MS = 180;

function amountOf(item: PantryItem): string {
  if (item.qty === null) return STATUS_LABEL[item.status];
  return [formatQty(item.qty), unitLabel(item.unit, item.qty)].filter(Boolean).join(" ");
}

function SweepGame({ items, onDone }: { items: readonly PantryItem[]; onDone: () => void }) {
  const household = useHousehold();
  const verify = useVerifyItem();
  const setQty = useSetQty();
  const setStatus = useSetStatus();
  const restore = useRestoreItem();
  const addToList = useAddToList();
  const removeFromList = useRemoveListItem();
  // Fixed when the sweep opens: each answer reorders the live list underneath, and undo needs the old amounts.
  const [deck, setDeck] = useState(() => pickDeck(items, readSnoozes(), new Date()));
  // One entry per card passed, so the current card is always `deck[history.length]`.
  const [history, setHistory] = useState<SweepAnswer[]>([]);
  const [ended, setEnded] = useState(false);
  const [dx, setDx] = useState(0);
  const [animate, setAnimate] = useState(false);
  const [exiting, setExiting] = useState(false);
  // Stock edits and list requests run one at a time, in order: an undo can never overtake the answer it reverses,
  // and two list requests at once could each create a new list.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  // The list item each answer created, so undo can take it off again. Null when the add failed.
  const added = useRef(new Map<string, Promise<{ listId: string; itemId: string } | null>>());
  const drag = useRef<{ x: number; y: number } | null>(null);
  const flyTimer = useRef<number | undefined>(undefined);
  const recorded = useRef(false);

  const item: PantryItem | undefined = deck[history.length];
  const finished = ended || (deck.length > 0 && !item);

  useEffect(() => () => window.clearTimeout(flyTimer.current), []);

  useEffect(() => {
    if (!finished || answerCount(history) === 0 || recorded.current) return;
    recorded.current = true;
    recordSweep(weekStartFor(localToday(), weekStartsOnOf(household.data)));
  }, [finished, history, household.data]);

  const run = <T,>(task: () => Promise<T>): Promise<T> => {
    const next = queue.current.then(task);
    queue.current = next.catch(() => undefined);
    return next;
  };
  const fail = (error: unknown) => toast.error(errorMessage(error));

  const answer = (choice: SweepChoice | "skip") => {
    setDx(0);
    setAnimate(false);
    setExiting(false);
    if (!item || finished) return;
    const entry: SweepAnswer = { id: item.id, choice, listed: choice === "low" || choice === "out" };
    if (choice !== "skip") {
      const snoozes = readSnoozes();
      entry.previousSnooze = snoozes[item.id];
      setSnooze(item.id, snoozeUntil(choice, localToday()));
    }
    if (choice === "have") {
      run(() => verify.mutateAsync(item)).catch(fail);
    } else if (choice !== "skip") {
      // A measured item that is all out has none left; the server then sets "out" itself.
      if (choice === "out" && item.qty !== null) run(() => setQty.mutateAsync({ item, qty: 0 })).catch(fail);
      else run(() => setStatus.mutateAsync({ item, status: choice })).catch(fail);
      added.current.set(
        item.id,
        run(() => addToList.mutateAsync(item)).then(
          ({ list, itemId }) => (itemId === null ? null : { listId: list.id, itemId }),
          (error) => {
            fail(error);
            setHistory((all) => all.map((a) => (a.id === item.id ? { ...a, listed: false } : a)));
            return null;
          },
        ),
      );
    }
    setHistory((all) => [...all, entry]);
  };

  const undo = () => {
    const last = history.at(-1);
    const previous = deck[history.length - 1];
    if (!last || !previous || exiting || finished) return;
    setHistory(history.slice(0, -1));
    if (last.choice === "skip") return;
    setSnooze(last.id, last.previousSnooze);
    // "Still have it" only stamped the row as checked, which is harmless to keep.
    if (last.choice === "have") return;
    run(() => restore.mutateAsync({ item: previous })).catch(fail);
    const listed = added.current.get(last.id);
    added.current.delete(last.id);
    if (listed) {
      run(async () => {
        const target = await listed;
        if (target) await removeFromList.mutateAsync(target);
      }).catch(fail);
    }
  };

  const choose = (choice: SweepChoice | "skip") => {
    if (!exiting) answer(choice);
  };

  useEffect(() => {
    if (finished || !item) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (key === "u") {
        e.preventDefault();
        undo();
        return;
      }
      const choice = KEYS[key];
      if (!choice) return;
      e.preventDefault();
      choose(choice);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (deck.length === 0) {
    return (
      <div className={styles.summary}>
        <Pal mood="happy" size={120} />
        <p className={styles.summaryLine}>Everything was checked lately. Nice and tidy!</p>
        {items.length > 0 && (
          <Button variant="primary" size="lg" autoFocus onClick={() => setDeck(pickDeck(items, {}, new Date()))}>
            Sweep everything anyway
          </Button>
        )}
        <Button variant="ghost" onClick={onDone}>
          Close
        </Button>
      </div>
    );
  }

  if (finished || !item) {
    return (
      <div className={styles.summary}>
        <Pal mood="cheer" size={120} />
        <p className={styles.summaryLine}>{summaryLine(history)}</p>
        <Button variant="primary" size="lg" autoFocus onClick={onDone}>
          Done
        </Button>
      </div>
    );
  }

  const swipe = {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (exiting || (e.pointerType === "mouse" && e.button !== 0)) return;
      drag.current = { x: e.clientX, y: e.clientY };
      e.currentTarget.setPointerCapture?.(e.pointerId);
      setAnimate(false);
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      if (drag.current) setDx(e.clientX - drag.current.x);
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => {
      const start = drag.current;
      drag.current = null;
      if (!start) return;
      const delta = e.clientX - start.x;
      if (Math.abs(delta) < SWIPE_PX || Math.abs(delta) <= 2 * Math.abs(e.clientY - start.y)) {
        setAnimate(true);
        setDx(0);
        return;
      }
      const choice = delta > 0 ? "have" : "low";
      // Reduced motion: jump instead of flying off.
      if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return answer(choice);
      setExiting(true);
      setAnimate(true);
      setDx(Math.sign(delta) * e.currentTarget.offsetWidth * 1.3);
      flyTimer.current = window.setTimeout(() => answer(choice), FLY_MS);
    },
    onPointerCancel: () => {
      drag.current = null;
      setAnimate(true);
      setDx(0);
    },
  };
  const pull = Math.min(Math.abs(dx) / SWIPE_PX, 1);
  const cardStyle = { "--dx": `${dx}px`, "--rot": `${Math.max(-MAX_TILT, Math.min(MAX_TILT, dx / 12))}deg`, "--p": pull } as CSSProperties;
  const name = item.ingredient.name;
  const keyHint = (key: string) => (
    <kbd className={styles.key} aria-hidden="true">
      {key}
    </kbd>
  );

  return (
    <div className={styles.game}>
      <div className={styles.progress}>
        <div className={styles.progressRow}>
          <span className={styles.count}>
            {history.length + 1} of {deck.length}
          </span>
          <Button variant="ghost" onClick={() => !exiting && setEnded(true)}>
            Finish
          </Button>
        </div>
        <div
          className={styles.bar}
          role="progressbar"
          aria-label="Sweep progress"
          aria-valuemin={0}
          aria-valuemax={deck.length}
          aria-valuenow={history.length}
          aria-valuetext={`${history.length} of ${deck.length} checked`}
        >
          <span className={styles.barFill} style={{ width: `${(history.length / deck.length) * 100}%` }} />
        </div>
      </div>
      <div className={styles.stage} {...swipe}>
        <div
          className={styles.card}
          style={cardStyle}
          data-side={dx > 0 ? "have" : dx < 0 ? "low" : undefined}
          data-past={Math.abs(dx) >= SWIPE_PX ? "" : undefined}
          data-animate={animate ? "" : undefined}
          aria-live="polite"
        >
          <span className={`${styles.cue} ${styles.cueHave}`} aria-hidden="true">
            <Icon name="check" size={16} /> Still have it
          </span>
          <span className={`${styles.cue} ${styles.cueLow}`} aria-hidden="true">
            <Icon name="alert" size={16} /> Running low
          </span>
          <div key={item.id} className={styles.cardInner}>
            <Sticker
              emoji={ingredientEmoji(name, item.ingredient.imageUrl)}
              fallback={ingredientEmoji(name)}
              tone="butter"
              size={96}
            />
            <h3 className={styles.name}>{name}</h3>
            <p className={styles.amount}>{amountOf(item)}</p>
          </div>
        </div>
      </div>
      <p className={styles.swipeHint}>Swipe right if you still have it, left if it is running low.</p>
      <div className={styles.answers}>
        <Button variant="primary" size="lg" icon={<Icon name="check" />} aria-keyshortcuts="1" onClick={() => choose("have")}>
          Still have it{keyHint("1")}
        </Button>
        <Button className={styles.low} size="lg" aria-keyshortcuts="2" onClick={() => choose("low")}>
          Running low{keyHint("2")}
        </Button>
        <Button className={styles.out} size="lg" aria-keyshortcuts="3" onClick={() => choose("out")}>
          All out{keyHint("3")}
        </Button>
      </div>
      <div className={styles.minor}>
        <Button variant="ghost" icon={<Icon name="undo" />} aria-keyshortcuts="u" disabled={history.length === 0} onClick={undo}>
          Undo{keyHint("U")}
        </Button>
        <Button variant="ghost" aria-keyshortcuts="s" onClick={() => choose("skip")}>
          Skip{keyHint("S")}
        </Button>
      </div>
    </div>
  );
}

export interface SweepSheetProps {
  open: boolean;
  onClose: () => void;
  items: readonly PantryItem[];
}

/** A relaxed pass over the pantry in random order, one item at a time. Every answer is saved as it is given. */
export function SweepSheet({ open, onClose, items }: SweepSheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title="Pantry sweep">
      <SweepGame items={items} onDone={onClose} />
    </Sheet>
  );
}
