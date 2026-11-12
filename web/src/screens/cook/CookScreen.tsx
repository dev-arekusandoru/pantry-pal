import { Link, useCanGoBack, useNavigate, useRouter } from "@tanstack/react-router";
import { Progress } from "radix-ui";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type TouchEvent } from "react";
import { errorMessage } from "@/api";
import { Button, Emoji, EmptyState, ErrorState, Icon, IconButton, Sheet, Skeleton, Sticker, buttonClass, ingredientEmoji, cx, toast } from "@/ui";
import { formatClock, stepSeconds } from "../recipe/duration";
import { formatAmount, formatNumber, localDate, type RecipeStepLink } from "../recipe/lib";
import { isNotFound, usePlannedCooks, useRecipe, useScaledIngredients, useSetRecipeStatus } from "../recipe/queries";
import type { EditableStatus } from "../recipe/status";
import { useMembers } from "../settings/queries";
import {
  MAX_COOKS,
  allDone,
  assignedSteps,
  cookNames,
  cooksDone,
  defaultOwners,
  focusCookStep,
  lowestUnfinishedStep,
  moveCook,
  passedSteps,
  setCookPosition,
  type Crew,
  type CrewCook,
} from "./crew";
import { AssignSteps, WhoCookingSheet } from "./CrewSetup";
import { CrewPanels } from "./CrewView";
import { clearCookProgress, isResumable, readCookProgress, saveCookProgress } from "./progress";
import { useFinishCook, useUndoCook, type FinishInput } from "./queries";
import { stepPillRows } from "./stepPills";
import { StepPills } from "./StepPills";
import { StepTimerRow } from "./StepTimerRow";
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

/** Time the cook screen may settle before a prompt covers it; matches the shell's own enter. */
const PROMPT_SETTLE_MS = 300;

/**
 * Ghosts left by exits are dropped on `animationend`; this is the backstop for
 * when animations never run at all (so nothing stays painted or announced).
 */
const EXIT_FALLBACK_MS = 320;

interface StepLayer {
  /** Step index. */
  index: number;
  /** The step the screen just left: painted once more while it fades away. */
  leaving: boolean;
  /** Entered by a step change, so it animates in (the first paint does not). */
  entering: boolean;
}

interface StepLayers {
  layers: StepLayer[];
  /** 1 when the step advanced, -1 when it went back; drives the enter offset. */
  direction: 1 | -1;
  drop: (index: number) => void;
}

/**
 * The step on screen plus the one it replaces while that one fades. Swapping
 * them in the same commit keeps the outgoing text from blinking out, and the
 * outgoing copy leaves the layout (`position: absolute` in the CSS) so the
 * stack never changes height mid-fade.
 */
function useStepLayers(step: number): StepLayers {
  const [state, setState] = useState<{ layers: StepLayer[]; direction: 1 | -1 }>(() => ({
    layers: [{ index: step, leaving: false, entering: false }],
    direction: 1,
  }));

  const shown = state.layers.find((layer) => !layer.leaving)?.index;
  if (shown !== undefined && step !== shown) {
    setState({
      layers: [
        ...state.layers.filter((layer) => !layer.leaving).map((layer) => ({ ...layer, leaving: true, entering: false })),
        { index: step, leaving: false, entering: true },
      ],
      direction: step > shown ? 1 : -1,
    });
  }

  const drop = useCallback((index: number) => {
    setState((current) => ({
      ...current,
      layers: current.layers.filter((layer) => !(layer.index === index && layer.leaving)),
    }));
  }, []);

  const fading = state.layers.some((layer) => layer.leaving);
  useEffect(() => {
    if (!fading) return;
    const id = window.setTimeout(() => {
      setState((current) => ({ ...current, layers: current.layers.filter((layer) => !layer.leaving) }));
    }, EXIT_FALLBACK_MS);
    return () => window.clearTimeout(id);
  }, [fading, state.layers]);

  return { layers: state.layers, direction: state.direction, drop };
}

/**
 * Items that just disappeared, kept for one exit animation. Callers paint them
 * with a fading class and drop each on `animationend`.
 */
function useLeaving<T>(items: readonly T[], keyOf: (item: T) => number) {
  const [leaving, setLeaving] = useState<readonly T[]>([]);
  const previous = useRef<readonly T[]>(items);

  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = items;
    const present = new Set(items.map(keyOf));
    const gone = before.filter((item) => !present.has(keyOf(item)));
    if (gone.length === 0 && leaving.length === 0) return;
    setLeaving((current) => {
      // Drop ghosts whose item is back, then add what just left.
      const kept = current.filter((item) => !present.has(keyOf(item)));
      if (gone.length === 0 && kept.length === current.length) return current;
      return [
        ...kept.filter((item) => !gone.some((other) => keyOf(other) === keyOf(item))),
        ...gone,
      ];
    });
    for (const item of gone) {
      const key = keyOf(item);
      // Backstop for exits whose animation never runs: never keep a ghost.
      window.setTimeout(
        () => setLeaving((current) => current.filter((entry) => keyOf(entry) !== key)),
        EXIT_FALLBACK_MS,
      );
    }
  });

  const drop = useCallback(
    (key: number) => setLeaving((current) => current.filter((item) => keyOf(item) !== key)),
    [keyOf],
  );

  return { leaving, drop };
}

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

  const members = useMembers();
  const memberCooks: CrewCook[] = (members.data ?? []).map((member) => ({ id: member.id, name: member.name }));
  // Saved cooks survive a member being deleted, so a crew can outlive the list.
  const canPickCooks = memberCooks.length >= 2;

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

  const [step, setStep] = useState(() =>
    resume && saved !== null && isResumable(saved, saved.stepCount) ? saved.step : 0,
  );
  const [crew, setCrew] = useState<Crew | null>(() => {
    if (!resume || saved === null || saved.crew === undefined) return null;
    return isResumable(saved, saved.stepCount) ? saved.crew : null;
  });
  const [cooksOpen, setCooksOpen] = useState(false);
  // The picker opens by itself once per visit, so a household never has to hunt for it.
  const [cooksAsked, setCooksAsked] = useState(false);
  const [draftCooks, setDraftCooks] = useState<CrewCook[]>([]);
  const [assign, setAssign] = useState<{ cooks: CrewCook[]; owners: string[] } | null>(null);
  const [ingredientsOpen, setIngredientsOpen] = useState(false);
  const [askPlanned, setAskPlanned] = useState(false);
  const [done, setDone] = useState<DoneState | null>(null);
  const timers = useStepTimers();
  const finish = useFinishCook();
  const undo = useUndoCook();
  const touch = useRef<{ x: number; y: number } | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);

  useWakeLock(done === null);

  const lastStep = Math.max(0, stepCount - 1);
  const atEnd = step >= lastStep;
  const crewPassed = crew !== null ? passedSteps(crew) : [];
  const overlayOpen = ingredientsOpen || askPlanned || resumePending || cooksOpen;

  const { layers, direction, drop: dropStep } = useStepLayers(step);

  // Timers: the alert list and the chips for the other steps are kept mounted for
  // one exit fade after they disappear.
  const alerts = timers.ringing.map((s) => ({ step: s }));
  // A timer already on screen (the solo step, or a crew panel's step) lives in its step.
  // Chips are only for clocks nobody is looking at, such as a cook who moved on.
  const crewShown = new Set<number>();
  for (const cook of crew?.cooks ?? []) {
    const owned = assignedSteps(crew?.owners ?? [], cook.id);
    const shown = owned[Math.min(crew?.positions[cook.id] ?? 0, owned.length)];
    if (shown !== undefined) crewShown.add(shown);
  }
  const chips = Object.entries(timers.timers)
    .map(([s, t]) => ({ step: Number(s), t }))
    .filter((x) => !x.t.finished && !(crew === null ? x.step === step : crewShown.has(x.step)))
    .map(({ step: s }) => ({ step: s, label: formatClock(timers.remaining(s)) }));
  const { leaving: leavingAlerts, drop: dropAlert } = useLeaving(alerts, (a) => a.step);
  const { leaving: leavingChips, drop: dropChip } = useLeaving(chips, (c) => c.step);

  // The placeholder stays painted for one exit animation so the recipe
  // crossfades in over it instead of hard-cutting from skeleton to content.
  const [skeletonPhase, setSkeletonPhase] = useState<"shown" | "leaving" | "gone">(() =>
    recipe.isPending ? "shown" : "gone",
  );
  if (recipe.isPending) {
    if (skeletonPhase !== "shown") setSkeletonPhase("shown");
  } else if (skeletonPhase === "shown") {
    setSkeletonPhase("leaving");
  }
  // If the exit animation never runs, still take the placeholder away.
  useEffect(() => {
    if (skeletonPhase !== "leaving") return;
    const id = window.setTimeout(() => setSkeletonPhase("gone"), EXIT_FALLBACK_MS);
    return () => window.clearTimeout(id);
  }, [skeletonPhase]);

  // Ask who is cooking as soon as the recipe is on screen. A saved cook gets its resume
  // prompt first; "Start over" (or no saved cook) then lands here.
  useEffect(() => {
    if (cooksAsked || !canPickCooks || skeletonPhase !== "gone" || !r || r.steps.length < 2) return;
    if (resumePending || resumeState === "resumed" || crew !== null || done !== null) return;
    setCooksAsked(true);
    setDraftCooks([]);
    setCooksOpen(true);
  }, [cooksAsked, canPickCooks, skeletonPhase, r, resumePending, resumeState, crew, done]);

  // Let the screen settle before a prompt covers it: opening the resume sheet
  // over the skeleton (or mid route transition) is the flash this avoids.
  const [promptReady, setPromptReady] = useState(false);
  useEffect(() => {
    if (!resumePending) {
      setPromptReady(false);
      return;
    }
    const settle =
      typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? 0
        : PROMPT_SETTLE_MS;
    const id = window.setTimeout(() => setPromptReady(true), settle);
    return () => window.clearTimeout(id);
  }, [resumePending]);

  // A new step starts at the top: landing mid-scroll reads as a jump.
  useLayoutEffect(() => {
    const main = mainRef.current;
    if (main !== null) main.scrollTop = 0;
  }, [step]);

  // `?resume` jumps straight to the saved step once the recipe (and its step count) is known.
  const resumeApplied = useRef(false);
  useEffect(() => {
    if (!r || resumeState !== "resumed" || resumeApplied.current) return;
    resumeApplied.current = true;
    if (isResumable(saved, r.steps.length)) {
      setStep(Math.min(r.steps.length - 1, saved.step));
      if (saved.crew !== undefined) setCrew(saved.crew);
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
      ...(crew !== null ? { crew } : {}),
      savedAt: new Date().toISOString(),
    });
  }, [r, slug, step, servings, done, resumePending, plannedCookId, crew]);

  function go(delta: number) {
    setStep((s) => Math.min(lastStep, Math.max(0, s + delta)));
  }

  // Arrow keys for tablets on a stand and desktop testing.
  const keyGo = useRef(go);
  keyGo.current = go;
  useEffect(() => {
    if (overlayOpen || done !== null || crew !== null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") keyGo.current(1);
      if (e.key === "ArrowLeft") keyGo.current(-1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overlayOpen, done, crew]);

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
    setCrew(saved.crew ?? null);
    setStep(Math.min(lastStep, Math.max(0, saved.step)));
  }

  function startOver() {
    clearCookProgress(slug);
    setResumeState("restarted");
    setCrew(null);
    setAssign(null);
    setDraftCooks([]);
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

  function openCooks() {
    setDraftCooks(crew?.cooks ?? []);
    setCooksOpen(true);
  }

  function toggleDraftCook(cook: CrewCook) {
    setDraftCooks((current) => {
      if (current.some((chosen) => chosen.id === cook.id)) return current.filter((chosen) => chosen.id !== cook.id);
      return current.length >= MAX_COOKS ? current : [...current, cook];
    });
  }

  /** Picker "Next": start from a fair split the user can then adjust step by step. */
  function beginAssign() {
    if (!r || draftCooks.length < 2) return;
    // Renamed members get their current name; deleted ones keep the saved one.
    const cooks = draftCooks.map((cook) => memberCooks.find((member) => member.id === cook.id) ?? cook);
    setCooksOpen(false);
    setAssign({ cooks, owners: defaultOwners(r.steps, cooks) });
  }

  function startCrew() {
    if (assign === null) return;
    const positions: Record<string, number> = {};
    for (const cook of assign.cooks) positions[cook.id] = 0;
    setCrew({ cooks: assign.cooks, owners: assign.owners, positions });
    setAssign(null);
    setDraftCooks([]);
    setStep(0);
  }

  /** Solo again: navigation picks up at the lowest step nobody has passed. */
  function justMe() {
    if (crew !== null && r !== undefined) setStep(lowestUnfinishedStep(crew, r.steps.length));
    setCrew(null);
    setCooksOpen(false);
    setDraftCooks([]);
  }

  function updateCrew(update: (current: Crew) => Crew) {
    setCrew((current) => (current === null ? null : update(current)));
  }

  function moveCookPanel(cookId: string, delta: number) {
    updateCrew((current) => moveCook(current, cookId, delta));
  }

  function markCookDone(cookId: string) {
    updateCrew((current) => setCookPosition(current, cookId, assignedSteps(current.owners, cookId).length));
  }

  function reopenCook(cookId: string) {
    updateCrew((current) => setCookPosition(current, cookId, assignedSteps(current.owners, cookId).length - 1));
  }

  function jumpToCookStep(cookId: string, stepIndex: number) {
    updateCrew((current) => focusCookStep(current, cookId, stepIndex));
  }

  function cookForStep(stepIndex: number): CrewCook | undefined {
    return crew?.cooks.find((cook) => cook.id === crew.owners[stepIndex]);
  }

  // The skeleton is an overlay: it fades out over the loaded screen so the two
  // states crossfade instead of cutting, and it can never block a tap.
  function stage(content: ReactNode) {
    return (
      <>
        {content}
        {skeletonPhase !== "gone" && (
          <div
            className={cx(styles.skeletonShell, skeletonPhase === "leaving" && styles.leaving)}
            aria-hidden={skeletonPhase === "leaving" || undefined}
            onAnimationEnd={(event) => {
              if (event.target === event.currentTarget) setSkeletonPhase("gone");
            }}
          >
            <CookSkeleton />
          </div>
        )}
      </>
    );
  }

  if (recipe.isPending) return stage(null);
  if (!r || recipe.isError) {
    return stage(
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
      </div>,
    );
  }

  if (done !== null) {
    return stage(
      <DoneScreen
        title={r.title}
        done={done}
        slug={slug}
        askRating={r.status === "want_to_try"}
        onUndo={() => undoCook(done.cookEventId)}
        undoing={undo.isPending}
        onBackToWeek={backToWeek}
        onBackToRecipe={backToRecipe}
      />,
    );
  }

  if (assign !== null) {
    return stage(
      <AssignSteps
        steps={r.steps}
        cooks={assign.cooks}
        owners={assign.owners}
        onChange={(owners) => setAssign((current) => (current === null ? current : { ...current, owners }))}
        onBack={() => {
          setAssign(null);
          setCooksOpen(true);
        }}
        onStart={startCrew}
        onExit={exit}
      />,
    );
  }

  const ingredientRows = r.ingredients.map((ri) => {
    const s = scaled.data?.items.find((x) => x.recipeIngredientId === ri.id) ?? (servings === r.servings ? ri : undefined);
    return { ri, amount: s ? formatAmount(s.qty ?? null, s.qtyMax ?? null, s.unit ?? null) : "" };
  });
  const resumeCrewNames = saved?.crew !== undefined ? cookNames(saved.crew.cooks) : null;

  // Step pills scale like the ingredient lines: exempt lines stay, a null link
  // qty follows the whole (already scaled) line.
  const pillsFor = (links: RecipeStepLink[]) =>
    stepPillRows(links, r.ingredients, scaled.data?.items ?? [], servings ?? r.servings, r.servings);

  return (
    <div className={cx(styles.cook, crew !== null && styles.wide)}>
      <header className={styles.top}>
        <IconButton className={styles.round} label="Exit cook mode" icon={<Icon name="close" />} onClick={exit} />
        <div className={styles.title}>
          <h1>{r.title}</h1>
          <span>
            {crew !== null
              ? `Cooking with ${cookNames(crew.cooks)}`
              : stepCount > 0
                ? `Step ${step + 1} of ${stepCount}`
                : "No steps"}
          </span>
        </div>
        <IconButton
          className={styles.round}
          label="Ingredients"
          icon={<Icon name="list" />}
          onClick={() => setIngredientsOpen(true)}
        />
        {(canPickCooks || crew !== null) && (
          <IconButton className={styles.round} label="Cooks" icon={<Icon name="people" />} onClick={openCooks} />
        )}
      </header>

      {stepCount > 1 &&
        (crew === null ? (
          <Progress.Root
            className={styles.progress}
            value={step + 1}
            max={stepCount}
            getValueLabel={(value, max) => `Step ${value} of ${max}`}
            aria-label="Step progress"
          >
            {r.steps.map((s, i) => (
              <i key={s.id} aria-hidden="true" className={cx(i < step && styles.passed, i === step && styles.now)} />
            ))}
          </Progress.Root>
        ) : (
          /* A crew has no single current step: a step is done once its owner passes it. */
          <div className={styles.progress} aria-hidden="true">
            {r.steps.map((s, i) => (
              <i key={s.id} className={cx(crewPassed[i] && styles.passed)} />
            ))}
          </div>
        ))}

      {alerts.length + leavingAlerts.length > 0 && (
        <div className={styles.alerts}>
          {alerts.map(({ step: s }) => {
            const owner = cookForStep(s);
            return (
              <div key={s} className={styles.alertSlot} role="alert">
                <div className={styles.alert}>
                  <Icon name="timer" />
                  <span>
                    {owner !== undefined ? `${owner.name} · ` : ""}Step {s + 1} timer is done
                  </span>
                  {(owner !== undefined || s !== step) && (
                    <button
                      type="button"
                      aria-label={`Go to step ${s + 1}`}
                      onClick={() => {
                        if (owner !== undefined) jumpToCookStep(owner.id, s);
                        else setStep(s);
                        timers.dismiss(s);
                      }}
                    >
                      Go to step
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={`Dismiss step ${s + 1} timer alert`}
                    onClick={() => timers.dismiss(s)}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            );
          })}
          {leavingAlerts.map(({ step: s }) => (
            <div
              key={`left-${s}`}
              className={cx(styles.alertSlot, styles.leaving)}
              aria-hidden="true"
              onAnimationEnd={(event) => {
                if (event.target === event.currentTarget) dropAlert(s);
              }}
            >
              <div className={styles.alert}>
                <Icon name="timer" />
                <span>Step {s + 1} timer is done</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {chips.length + leavingChips.length > 0 && (
        <ul className={styles.chips} aria-label="Running timers">
          {chips.map(({ step: s, label }) => {
            const owner = cookForStep(s);
            return (
              <li key={s}>
                <button type="button" onClick={() => (owner !== undefined ? jumpToCookStep(owner.id, s) : setStep(s))}>
                  <Icon name="timer" /> {owner !== undefined ? `${owner.name} · ` : ""}Step {s + 1} · {label}
                </button>
              </li>
            );
          })}
          {leavingChips.map(({ step: s, label }) => (
            <li
              key={`left-${s}`}
              className={styles.leaving}
              aria-hidden="true"
              onAnimationEnd={(event) => {
                if (event.target === event.currentTarget) dropChip(s);
              }}
            >
              <button type="button" tabIndex={-1}>
                <Icon name="timer" /> Step {s + 1} · {label}
              </button>
            </li>
          ))}
        </ul>
      )}

      {crew !== null ? (
        <main className={styles.crewMain}>
          <CrewPanels
            crew={crew}
            steps={r.steps}
            timers={timers}
            pillsFor={pillsFor}
            onMove={moveCookPanel}
            onDone={markCookDone}
            onReopen={reopenCook}
          />
        </main>
      ) : (
        <main
          className={styles.main}
          ref={mainRef}
          onTouchStart={(e) => {
            const t = e.touches[0];
            touch.current = t ? { x: t.clientX, y: t.clientY } : null;
          }}
          onTouchEnd={onTouchEnd}
        >
          {stepCount === 0 || r.steps[step] === undefined ? (
            <p className={styles.text}>
              This recipe has no steps yet. Use the ingredient list and finish when you're done.
            </p>
          ) : (
            /* Polite live region, kept mounted across steps so the new text is announced. */
            <div className={styles.stack} aria-live="polite">
              {layers.map((layer) => {
                const s = r.steps[layer.index];
                if (s === undefined) return null;
                const seconds = stepSeconds(s);
                return (
                  <div
                    key={layer.index}
                    className={cx(
                      styles.step,
                      layer.leaving
                        ? styles.leaving
                        : layer.entering
                          ? direction === 1
                            ? styles.stepNext
                            : styles.stepPrev
                          : undefined,
                    )}
                    aria-hidden={layer.leaving || undefined}
                    onAnimationEnd={
                      layer.leaving
                        ? (event) => {
                            if (event.target === event.currentTarget) dropStep(layer.index);
                          }
                        : undefined
                    }
                  >
                    {s.groupLabel && <p className={styles.group}>{s.groupLabel}</p>}
                    <p className={styles.text}>{s.text}</p>
                    <StepPills pills={pillsFor(s.links)} />
                    {seconds !== null && (
                      <StepTimerRow index={layer.index} seconds={seconds} timers={timers} leaving={layer.leaving} />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </main>
      )}

      {crew !== null ? (
        <footer className={styles.crewFoot}>
          {allDone(crew) ? (
            <Button
              size="lg"
              variant="primary"
              className={cx(styles.next, styles.crewFinish)}
              icon={<Icon name="check" />}
              loading={finish.isPending || servings === undefined}
              onClick={onFinish}
            >
              Finish cooking
            </Button>
          ) : (
            <p className={styles.crewNote}>
              {cooksDone(crew)} of {crew.cooks.length} cooks done
            </p>
          )}
        </footer>
      ) : (
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
      )}

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

      <WhoCookingSheet
        open={cooksOpen}
        cooks={[
          ...memberCooks,
          // A deleted member's saved cook stays pickable so they can be removed.
          ...(crew?.cooks ?? []).filter(
            (saved) => draftCooks.some((chosen) => chosen.id === saved.id) && !memberCooks.some((m) => m.id === saved.id),
          ),
        ]}
        selected={draftCooks}
        onToggle={toggleDraftCook}
        onClose={() => setCooksOpen(false)}
        onJustMe={justMe}
        onNext={beginAssign}
      />

      <Sheet
        open={resumePending && promptReady && saved !== null}
        onClose={resumeAt}
        title="Pick up where you left off?"
        footer={
          <>
            <Button onClick={startOver}>Start over</Button>
            <Button variant="primary" onClick={resumeAt}>
              {resumeCrewNames !== null ? "Resume" : `Resume at step ${(saved?.step ?? 0) + 1}`}
            </Button>
          </>
        }
      >
        {resumeCrewNames !== null ? (
          <p>You were cooking with {resumeCrewNames}.</p>
        ) : (
          <p>
            You stopped at step {(saved?.step ?? 0) + 1} of {stepCount}
            {saved !== null ? ` (${formatNumber(saved.servings)} servings)` : ""}.
          </p>
        )}
      </Sheet>

      <Sheet
        open={askPlanned}
        onClose={() => setAskPlanned(false)}
        title="Cooking tonight's planned meal?"
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
              variant="dangerGhost"
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

/**
 * Same boxes as the loaded screen (header, progress bar, centred step type,
 * footer) so the recipe fades in over the placeholder without anything moving.
 */
function CookSkeleton() {
  return (
    <div className={styles.cook} aria-busy="true" aria-label="Loading recipe">
      <div className={styles.top}>
        <Skeleton width={48} height={48} radius={999} />
        <div className={cx(styles.title, styles.skTitle)}>
          <Skeleton height={24} width="62%" radius={12} />
          <Skeleton height={16} width="34%" radius={8} />
        </div>
        <Skeleton width={48} height={48} radius={999} />
      </div>
      <div className={styles.progress}>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className={styles.skBar} height={12} radius={999} />
        ))}
      </div>
      <div className={styles.main}>
        <div className={styles.skText}>
          <Skeleton height="0.62em" radius={16} />
          <Skeleton height="0.62em" radius={16} width="88%" />
          <Skeleton height="0.62em" radius={16} width="54%" />
        </div>
      </div>
      <div className={styles.foot}>
        <Skeleton height={60} radius={999} />
        <Skeleton height={60} radius={999} />
      </div>
    </div>
  );
}
