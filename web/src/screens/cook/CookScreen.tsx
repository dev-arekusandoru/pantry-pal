import { Link, useCanGoBack, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState, type TouchEvent } from "react";
import { errorMessage } from "@/api";
import { Button, Emoji, EmptyState, ErrorState, Icon, IconButton, Sheet, Skeleton, Sticker, buttonClass, ingredientEmoji, cx, toast } from "@/ui";
import { formatClock, formatDuration, stepSeconds } from "../recipe/duration";
import { formatAmount, formatNumber, localDate } from "../recipe/lib";
import { isNotFound, usePlannedCooks, useRecipe, useScaledIngredients, useSetRecipeStatus } from "../recipe/queries";
import type { EditableStatus } from "../recipe/status";
import { clearCookProgress, isResumable, readCookProgress, saveCookProgress } from "./progress";
import { useFinishCook, useUndoCook, type FinishInput } from "./queries";
import { useStepTimers } from "./timers";
import { useWakeLock } from "./wakeLock";
import styles from "./CookScreen.module.css";

export interface CookScreenProps {
  slug: string;
  /** Planned cook event to complete on finish (`?cookEvent=<id>`). */
  cookEvent?: string;
  /** Servings to cook (`?servings=`). Defaults to the planned cook's, then the recipe's. */
  servings?: number;
  /** Resume saved progress immediately (`?resume`, from the recipe page). */
  resume?: boolean;
  /** Page cook mode was opened from (`?from`), so leaving it can return there. */
  from?: "recipe" | "week";
}

interface DoneState {
  cookEventId: string;
  servings: number;
  movements: number;
  warnings: string[];
}

const SWIPE_MIN_PX = 60;

export function CookScreen({ slug, cookEvent, servings: servingsParam, resume = false, from }: CookScreenProps) {
  const navigate = useNavigate();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  // Where the cook route was pushed from, so "back" returns there without a duplicate.
  const origin = from;
  const recipe = useRecipe(slug);
  const r = recipe.data;

  const [saved] = useState(() => readCookProgress(slug));
  const [resumeState, setResumeState] = useState<"ask" | "resumed" | "restarted">(
    resume && saved !== null ? "resumed" : saved !== null ? "ask" : "restarted",
  );

  const stepCount = r?.steps.length ?? 0;
  const resumable = isResumable(saved, stepCount);
  const resumePending = resumeState === "ask" && resumable;
  const resumed = resumeState === "resumed" && resumable ? saved : null;

  // A saved cook context fills in whatever the URL didn't carry.
  const plannedCookId = cookEvent ?? resumed?.cookEvent;
  const requestedServings = servingsParam ?? resumed?.servings;
  const planned = usePlannedCooks(r?.id);
  const plannedCook = plannedCookId !== undefined ? planned.data?.find((c) => c.id === plannedCookId) : undefined;
  const ready = r !== undefined && (requestedServings !== undefined || plannedCookId === undefined || !planned.isPending);
  const servings = ready ? (requestedServings ?? plannedCook?.plannedServings ?? r.servings) : undefined;
  const scaled = useScaledIngredients(slug, servings);

  const [step, setStep] = useState(0);
  const [ingredientsOpen, setIngredientsOpen] = useState(false);
  const [askPlanned, setAskPlanned] = useState(false);
  const [done, setDone] = useState<DoneState | null>(null);
  const timers = useStepTimers();
  const finish = useFinishCook();
  const undo = useUndoCook();
  const touch = useRef<{ x: number; y: number } | null>(null);

  useWakeLock(done === null);

  const lastStep = Math.max(0, stepCount - 1);
  const atEnd = step >= lastStep;
  const overlayOpen = ingredientsOpen || askPlanned || resumePending;

  // `?resume` jumps straight to the saved step once the recipe (and its step count) is known.
  const resumeApplied = useRef(false);
  useEffect(() => {
    if (!r || resumeState !== "resumed" || resumeApplied.current) return;
    resumeApplied.current = true;
    if (isResumable(saved, r.steps.length)) {
      setStep(Math.min(r.steps.length - 1, saved.step));
    }
  }, [r, resumeState, saved]);

  // Keep the place, servings and planned cook across exits. Not while the resume
  // prompt is open: that would overwrite it with step 0 before the user chooses.
  useEffect(() => {
    if (!r || servings === undefined || done !== null || resumePending || r.steps.length === 0) return;
    saveCookProgress(slug, {
      step: Math.min(step, r.steps.length - 1),
      stepCount: r.steps.length,
      servings,
      ...(plannedCookId !== undefined ? { cookEvent: plannedCookId } : {}),
      savedAt: new Date().toISOString(),
    });
  }, [r, slug, step, servings, done, resumePending, plannedCookId]);

  function go(delta: number) {
    setStep((s) => Math.min(lastStep, Math.max(0, s + delta)));
  }

  // Arrow keys for tablets on a stand and desktop testing.
  const keyGo = useRef(go);
  keyGo.current = go;
  useEffect(() => {
    if (overlayOpen || done !== null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") keyGo.current(1);
      if (e.key === "ArrowLeft") keyGo.current(-1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overlayOpen, done]);

  function onTouchEnd(e: TouchEvent) {
    const start = touch.current;
    touch.current = null;
    const end = e.changedTouches[0];
    if (!start || !end) return;
    const dx = end.clientX - start.x;
    const dy = end.clientY - start.y;
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    go(dx < 0 ? 1 : -1);
  }

  /**
   * Leave cook mode without leaving the cook route under the recipe page: pop it
   * when there is history to pop, otherwise replace it. Back from the recipe then
   * reaches whatever page the user came from.
   */
  function exit() {
    if (canGoBack) {
      router.history.back();
      return;
    }
    void navigate({
      to: "/recipes/$slug",
      params: { slug },
      search: {
        ...(servings !== undefined ? { servings } : {}),
        ...(plannedCookId !== undefined ? { cookEvent: plannedCookId } : {}),
      },
      replace: true,
    });
  }

  /**
   * Course corrections that pop the cook route instead of stacking another copy of
   * the destination, so Back from there reaches the originating page.
   */
  function backToRecipe() {
    if (origin === "recipe" && canGoBack) {
      router.history.back();
      return;
    }
    void navigate({ to: "/recipes/$slug", params: { slug }, replace: true });
  }

  function backToWeek() {
    if (origin === "week" && canGoBack) {
      router.history.back();
      return;
    }
    void navigate({ to: "/", replace: true });
  }

  function resumeAt() {
    if (!resumable || saved === null) return;
    setResumeState("resumed");
    setStep(Math.min(lastStep, Math.max(0, saved.step)));
  }

  function startOver() {
    clearCookProgress(slug);
    setResumeState("restarted");
    setStep(0);
  }

  function undoCook(cookEventId: string) {
    undo.mutate(cookEventId, {
      onSuccess: () => {
        clearCookProgress(slug);
        toast.show({ message: "Cook undone. Pantry restored." });
        backToRecipe();
      },
    });
  }

  function complete(input: FinishInput, allowFallback = true) {
    setAskPlanned(false);
    finish.mutate(input, {
      onSuccess: (res) => {
        clearCookProgress(slug);
        setDone({
          cookEventId: res.cookEvent.id,
          servings: input.servings,
          movements: res.movements.length,
          warnings: res.warnings,
        });
        toast.show({
          message: `${r?.title ?? "Recipe"} is marked cooked`,
          action: { label: "Undo", onClick: () => undoCook(res.cookEvent.id) },
        });
      },
      onError: (error) => {
        // The URL can outlive the cook it points at (a replanned or swapped week,
        // an already-deleted cook). Finish the cook the user is actually making.
        if (allowFallback && input.kind === "planned" && isNotFound(error)) {
          completeFallback();
          return;
        }
        toast.error(errorMessage(error));
      },
    });
  }

  /** Ad-hoc / currently-planned-cook path, used when the URL's cook event is gone. */
  function completeFallback() {
    if (!r || servings === undefined) return;
    const today = localDate();
    const match = planned.data?.find((c) => c.cookDate === today);
    if (match !== undefined) {
      complete({ kind: "planned", cookEventId: match.id, servings }, false);
      return;
    }
    complete({ kind: "adhoc", recipeId: r.id, servings }, false);
  }

  /** Finish: a planned cook from the URL, else ask about tonight's plan, else an ad-hoc cook. */
  function onFinish() {
    if (!r || servings === undefined) return;
    if (plannedCookId !== undefined) {
      return complete({ kind: "planned", cookEventId: plannedCookId, servings });
    }
    const today = localDate();
    if (planned.data?.some((c) => c.cookDate === today)) return setAskPlanned(true);
    complete({ kind: "adhoc", recipeId: r.id, servings });
  }

  if (recipe.isPending) return <CookSkeleton />;
  if (!r || recipe.isError) {
    return (
      <div className={styles.cook}>
        {isNotFound(recipe.error) ? (
          <EmptyState
            emoji="1F37D"
            title="Recipe not found"
            action={
              <Link to="/recipes" className={buttonClass({ variant: "primary" })}>
                Back to recipes
              </Link>
            }
          />
        ) : (
          <ErrorState error={recipe.error} onRetry={() => void recipe.refetch()} />
        )}
      </div>
    );
  }

  if (done !== null) {
    return (
      <DoneScreen
        title={r.title}
        done={done}
        slug={slug}
        askRating={r.status === "want_to_try"}
        onUndo={() => undoCook(done.cookEventId)}
        undoing={undo.isPending}
        onBackToWeek={backToWeek}
        onBackToRecipe={backToRecipe}
      />
    );
  }

  const current = r.steps[step];
  const secs = current ? stepSeconds(current) : null;
  const timer = timers.timers[step];
  const otherTimers = Object.entries(timers.timers)
    .map(([s, t]) => ({ step: Number(s), t }))
    .filter((x) => x.step !== step && !x.t.finished);
  const ingredientRows = r.ingredients.map((ri) => {
    const s = scaled.data?.items.find((x) => x.recipeIngredientId === ri.id) ?? (servings === r.servings ? ri : undefined);
    return { ri, amount: s ? formatAmount(s.qty ?? null, s.qtyMax ?? null, s.unit ?? null) : "" };
  });

  return (
    <div className={styles.cook}>
      <header className={styles.top}>
        <IconButton className={styles.round} label="Exit cook mode" icon={<Icon name="close" />} onClick={exit} />
        <div className={styles.title}>
          <b>{r.title}</b>
          <span>{stepCount > 0 ? `Step ${step + 1} of ${stepCount}` : "No steps"}</span>
        </div>
        <IconButton
          className={styles.round}
          label="Ingredients"
          icon={<Icon name="list" />}
          onClick={() => setIngredientsOpen(true)}
        />
      </header>

      {stepCount > 1 && (
        <div className={styles.progress} aria-hidden="true">
          {r.steps.map((s, i) => (
            <i key={s.id} className={cx(i < step && styles.passed, i === step && styles.now)} />
          ))}
        </div>
      )}

      {timers.ringing.length > 0 && (
        <div className={styles.alerts} role="alert">
          {timers.ringing.map((s) => (
            <div key={s} className={styles.alert}>
              <Icon name="timer" />
              <span>Step {s + 1} timer is done</span>
              {s !== step && (
                <button type="button" onClick={() => (setStep(s), timers.dismiss(s))}>
                  Go to step
                </button>
              )}
              <button type="button" onClick={() => timers.dismiss(s)}>
                Dismiss
              </button>
            </div>
          ))}
        </div>
      )}

      {otherTimers.length > 0 && (
        <ul className={styles.chips} aria-label="Running timers">
          {otherTimers.map(({ step: s }) => (
            <li key={s}>
              <button type="button" onClick={() => setStep(s)}>
                <Icon name="timer" /> Step {s + 1} · {formatClock(timers.remaining(s))}
              </button>
            </li>
          ))}
        </ul>
      )}

      <main
        className={styles.main}
        onTouchStart={(e) => {
          const t = e.touches[0];
          touch.current = t ? { x: t.clientX, y: t.clientY } : null;
        }}
        onTouchEnd={onTouchEnd}
      >
        {current ? (
          <>
            {current.groupLabel && <p className={styles.group}>{current.groupLabel}</p>}
            <p className={styles.text}>{current.text}</p>
            {secs !== null && (
              <div className={styles.timerRow}>
                {timer === undefined || timer.finished ? (
                  <button type="button" className={styles.timer} onClick={() => timers.start(step, secs)}>
                    <Icon name={timer?.finished ? "refresh" : "timer"} />
                    {timer?.finished ? `Done. Restart ${formatDuration(secs)}` : `Start ${formatDuration(secs)} timer`}
                  </button>
                ) : (
                  <>
                    <span className={cx(styles.timer, styles.running)} role="timer" aria-label="Time left">
                      <Icon name="timer" />
                      {formatClock(timers.remaining(step))}
                    </span>
                    <Button variant="ghost" className={styles.cancel} onClick={() => timers.cancel(step)}>
                      Cancel
                    </Button>
                  </>
                )}
              </div>
            )}
          </>
        ) : (
          <p className={styles.text}>This recipe has no steps yet. Use the ingredient list and finish when you're done.</p>
        )}
      </main>

      <footer className={styles.foot}>
        <Button size="lg" icon={<Icon name="back" />} onClick={() => go(-1)} disabled={step === 0}>
          Back
        </Button>
        {atEnd ? (
          <Button
            size="lg"
            variant="primary"
            className={styles.next}
            icon={<Icon name="check" />}
            loading={finish.isPending || servings === undefined}
            onClick={onFinish}
          >
            Finish cooking
          </Button>
        ) : (
          <Button size="lg" variant="primary" className={styles.next} onClick={() => go(1)}>
            Next step
          </Button>
        )}
      </footer>

      <Sheet open={ingredientsOpen} onClose={() => setIngredientsOpen(false)} title="Ingredients">
        <p className={styles.sheetSub}>For {formatNumber(servings ?? r.servings)} servings</p>
        <ul className={styles.ingList}>
          {ingredientRows.map(({ ri, amount }, i) => (
            <li key={ri.id}>
              {ri.groupLabel && ri.groupLabel !== ingredientRows[i - 1]?.ri.groupLabel && <p className={styles.sheetGroup}>{ri.groupLabel}</p>}
              <span className={styles.ingChip}>
                <Sticker emoji={ingredientEmoji(ri.ingredient.name)} tone="butter" size={32} />
                <span>
                  {amount && <b>{amount} </b>}
                  {ri.ingredient.name}
                  {ri.prepNote && <small>, {ri.prepNote}</small>}
                  {ri.optional && <small> (optional)</small>}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </Sheet>

      <Sheet
        open={resumePending && saved !== null}
        onClose={resumeAt}
        title="Pick up where you left off?"
        variant="center"
        footer={
          <>
            <Button onClick={startOver}>Start over</Button>
            <Button variant="primary" onClick={resumeAt}>
              Resume at step {(saved?.step ?? 0) + 1}
            </Button>
          </>
        }
      >
        <p>
          You stopped at step {(saved?.step ?? 0) + 1} of {stepCount}
          {saved !== null ? ` (${formatNumber(saved.servings)} servings)` : ""}.
        </p>
      </Sheet>

      <Sheet
        open={askPlanned}
        onClose={() => setAskPlanned(false)}
        title="Cooking tonight's planned meal?"
        variant="center"
        footer={
          <>
            <Button onClick={() => servings !== undefined && complete({ kind: "adhoc", recipeId: r.id, servings })}>
              No, just cooking
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                const today = localDate();
                const match = planned.data?.find((c) => c.cookDate === today);
                if (match && servings !== undefined) complete({ kind: "planned", cookEventId: match.id, servings });
              }}
            >
              Yes, that one
            </Button>
          </>
        }
      >
        <p>{r.title} is on today's plan. Mark that planned meal as cooked, or record this as a separate cook.</p>
      </Sheet>
    </div>
  );
}

function DoneScreen({
  title,
  done,
  slug,
  askRating,
  onUndo,
  undoing,
  onBackToWeek,
  onBackToRecipe,
}: {
  title: string;
  done: DoneState;
  /** Recipe slug for the status change. */
  slug: string;
  /** True when the recipe is still want-to-try, i.e. not rated yet. */
  askRating: boolean;
  onUndo: () => void;
  undoing: boolean;
  onBackToWeek: () => void;
  onBackToRecipe: () => void;
}) {
  const setStatus = useSetRecipeStatus();
  const [answered, setAnswered] = useState(false);
  const showRating = askRating && !answered;

  function rate(status: EditableStatus) {
    setStatus.mutate({ slug, status }, { onSuccess: () => setAnswered(true) });
  }

  return (
    <div className={cx(styles.cook, styles.done)}>
      <Sticker emoji="1F389" shape="die-cut" size={96} tilt={-8} />
      <h1 className={styles.doneTitle}>Nice cooking!</h1>
      <p className={styles.doneText}>
        {title} ({formatNumber(done.servings)} servings) is done.{" "}
        {done.movements > 0
          ? `${done.movements} pantry ${done.movements === 1 ? "item was" : "items were"} used up or reduced.`
          : "Nothing needed to come out of the pantry."}
      </p>
      {done.warnings.length > 0 && (
        <ul className={styles.warnings} aria-label="Heads up">
          {done.warnings.map((w) => (
            <li key={w}>
              <Emoji code="26A0" size={15} />
              <span>{w}</span>
            </li>
          ))}
        </ul>
      )}
      {showRating && (
        <div className={styles.rate} role="group" aria-label="How was it?">
          <p className={styles.rateTitle}>How was it?</p>
          <div className={styles.rateActions}>
            <Button
              size="lg"
              icon={<Emoji code="1F44D" size={20} />}
              loading={setStatus.isPending && setStatus.variables?.status === "rotation"}
              onClick={() => rate("rotation")}
            >
              Cook it again
            </Button>
            <Button
              size="lg"
              icon={<Emoji code="1F44E" size={20} />}
              loading={setStatus.isPending && setStatus.variables?.status === "never"}
              onClick={() => rate("never")}
            >
              Never again
            </Button>
          </div>
          <Button variant="ghost" onClick={() => setAnswered(true)}>
            Not now
          </Button>
        </div>
      )}
      <div className={styles.doneActions}>
        <Button variant="primary" size="lg" className={styles.next} onClick={onBackToWeek}>
          Back to the week
        </Button>
        <Button size="lg" onClick={onBackToRecipe}>
          Back to the recipe
        </Button>
        <Button size="lg" icon={<Icon name="undo" />} loading={undoing} onClick={onUndo}>
          Undo
        </Button>
      </div>
    </div>
  );
}

function CookSkeleton() {
  return (
    <div className={styles.cook} aria-busy="true" aria-label="Loading recipe">
      <Skeleton height={48} radius={24} />
      <div style={{ height: 40 }} />
      <Skeleton height={36} width="90%" />
      <div style={{ height: 14 }} />
      <Skeleton height={36} width="70%" />
    </div>
  );
}
