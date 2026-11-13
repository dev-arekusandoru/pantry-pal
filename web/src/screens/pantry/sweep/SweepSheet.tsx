import { useEffect, useRef, useState, type PointerEvent } from "react";
import { errorMessage } from "@/api";
import { recordSweep } from "@/game/missions";
import { useHousehold, weekStartsOnOf } from "@/screens/settings/queries";
import { localToday, weekStartFor } from "@/screens/week/dates";
import { Button, Icon, Pal, Sheet, Sticker, ingredientEmoji, toast } from "@/ui";
import { formatQty, unitLabel } from "../../shop/format";
import { useAddToList, useSetQty, useSetStatus, useVerifyItem } from "../queries";
import { STATUS_LABEL, type PantryItem } from "../stock";
import { SWEEP_SECONDS, summaryLine, sweepOrder, type SweepAnswer, type SweepChoice } from "./sweep";
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

const RING = 2 * Math.PI * 22;

function amountOf(item: PantryItem): string {
  if (item.qty === null) return STATUS_LABEL[item.status];
  return [formatQty(item.qty), unitLabel(item.unit, item.qty)].filter(Boolean).join(" ");
}

function SweepGame({ items, onDone }: { items: readonly PantryItem[]; onDone: () => void }) {
  const household = useHousehold();
  const verify = useVerifyItem();
  const setQty = useSetQty();
  const setStatus = useSetStatus();
  const addToList = useAddToList();
  // Fixed when the sweep opens: each answer reorders the live list underneath.
  const [deck] = useState(() => sweepOrder(items));
  const [deadline] = useState(() => Date.now() + SWEEP_SECONDS * 1000);
  const [left, setLeft] = useState(SWEEP_SECONDS);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<SweepAnswer[]>([]);
  // One list request at a time: two at once could each create a new list.
  const listQueue = useRef<Promise<void>>(Promise.resolve());
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const recorded = useRef(false);

  const item: PantryItem | undefined = deck[index];
  const finished = !item || left <= 0;

  useEffect(() => {
    if (finished) return;
    const tick = setInterval(() => setLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))), 250);
    return () => clearInterval(tick);
  }, [finished, deadline]);

  useEffect(() => {
    if (!finished || answers.length === 0 || recorded.current) return;
    recorded.current = true;
    recordSweep(weekStartFor(localToday(), weekStartsOnOf(household.data)));
  }, [finished, answers.length, household.data]);

  const answer = (choice: SweepChoice | "skip") => {
    if (finished || !item) return;
    setIndex(index + 1);
    if (choice === "skip") return;
    const fail = (error: unknown) => toast.error(errorMessage(error));
    if (choice === "have") {
      verify.mutateAsync(item).catch(fail);
    } else {
      // A measured item that is all out has none left; the server then sets "out" itself.
      if (choice === "out" && item.qty !== null) setQty.mutateAsync({ item, qty: 0 }).catch(fail);
      else setStatus.mutateAsync({ item, status: choice }).catch(fail);
      listQueue.current = listQueue.current
        .then(() => addToList.mutateAsync(item))
        .then(
          () => undefined,
          (error) => {
            fail(error);
            setAnswers((all) => all.map((a) => (a.id === item.id ? { ...a, listed: false } : a)));
          },
        );
    }
    setAnswers((all) => [...all, { id: item.id, choice, listed: choice !== "have" }]);
  };

  useEffect(() => {
    if (finished) return;
    const onKey = (e: KeyboardEvent) => {
      const choice = KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
      if (!choice || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      answer(choice);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (finished) {
    return (
      <div className={styles.summary}>
        <Pal mood="cheer" size={120} />
        <p className={styles.summaryLine}>{summaryLine(answers)}</p>
        <Button variant="primary" size="lg" autoFocus onClick={onDone}>
          Done
        </Button>
      </div>
    );
  }

  const swipe = {
    onPointerDown: (e: PointerEvent) => {
      swipeStart.current = { x: e.clientX, y: e.clientY };
    },
    onPointerUp: (e: PointerEvent) => {
      const start = swipeStart.current;
      swipeStart.current = null;
      if (!start) return;
      const dx = e.clientX - start.x;
      if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > 2 * Math.abs(e.clientY - start.y)) answer(dx > 0 ? "have" : "low");
    },
    onPointerCancel: () => {
      swipeStart.current = null;
    },
  };
  const name = item.ingredient.name;
  const keyHint = (key: string) => (
    <kbd className={styles.key} aria-hidden="true">
      {key}
    </kbd>
  );

  return (
    <div className={styles.game}>
      <div className={styles.timer} role="timer">
        <svg className={styles.ring} viewBox="0 0 50 50" aria-hidden="true">
          <circle className={styles.ringTrack} cx="25" cy="25" r="22" />
          <circle
            className={styles.ringLeft}
            cx="25"
            cy="25"
            r="22"
            strokeDasharray={RING}
            strokeDashoffset={RING * (1 - left / SWEEP_SECONDS)}
          />
        </svg>
        <span>
          {left} {left === 1 ? "second" : "seconds"} left
        </span>
        <span className={styles.count}>
          {index + 1} of {deck.length}
        </span>
      </div>
      <div className={styles.card} aria-live="polite" {...swipe}>
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
      <p className={styles.swipeHint}>Swipe right if you still have it, left if it is running low.</p>
      <div className={styles.answers}>
        <Button variant="primary" size="lg" icon={<Icon name="check" />} aria-keyshortcuts="1" onClick={() => answer("have")}>
          Still have it{keyHint("1")}
        </Button>
        <Button className={styles.low} size="lg" aria-keyshortcuts="2" onClick={() => answer("low")}>
          Running low{keyHint("2")}
        </Button>
        <Button className={styles.out} size="lg" aria-keyshortcuts="3" onClick={() => answer("out")}>
          All out{keyHint("3")}
        </Button>
      </div>
      <Button variant="ghost" aria-keyshortcuts="s" onClick={() => answer("skip")}>
        Skip{keyHint("S")}
      </Button>
    </div>
  );
}

export interface SweepSheetProps {
  open: boolean;
  onClose: () => void;
  items: readonly PantryItem[];
}

/** A 60-second pass over the pantry, one item at a time. Every answer is saved as it is given. */
export function SweepSheet({ open, onClose, items }: SweepSheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title="Pantry sweep">
      <SweepGame items={items} onDone={onClose} />
    </Sheet>
  );
}
